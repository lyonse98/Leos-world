import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, EyeOff, Play, MapPin, Wifi, WifiOff, Download, Clock, Compass, VolumeX, Moon, XCircle, Share2, Music, Send, Heart } from 'lucide-react';
import { useVoice } from './hooks/useVoice';
import { useGeolocation, Position } from './hooks/useGeolocation';
import { useWakeLock } from './hooks/useWakeLock';
import { geminiService } from './services/gemini';
import { storyCache, CachedStory } from './services/storyCache';
import { locationTracker } from './services/locationTracker';
import { adManager } from './services/adManager';
import { analytics } from './services/analytics';
import { subscriptions } from './services/subscriptions';
import { placesService } from './services/placesService';
import { getIntro } from './services/intros';
import { heardStories } from './services/heardStories';
import { tasteProfile } from './services/tasteProfile';
import { storyCoverage } from './services/storyCoverage';

import { ambientAudio } from './services/ambientAudio';
import { storyLikes } from './services/storyLikes';
import { geminiAudio } from './services/geminiAudio';

const RESUME_SESSION_KEY = 'leo_active_session';
const RESUME_SESSION_TTL_MS = 30 * 60 * 1000;
const AMBIENT_KEY = 'leo_ambient_on';

interface SavedTourSession {
  savedAt: number;
}

function App() {
  const [isTourStarted, setIsTourStarted] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isProcessingQuestion, setIsProcessingQuestion] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [storiesCount, setStoriesCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [cacheCount, setCacheCount] = useState<number>(0);
  const [missedQueueCount, setMissedQueueCount] = useState<number>(0);
  const [lastStorySource, setLastStorySource] = useState<'live' | 'cache' | null>(null);
  const [catchUpActive, setCatchUpActive] = useState<boolean>(false);
  const [prefetching, setPrefetching] = useState<boolean>(false);
  const [resumableSession, setResumableSession] = useState<SavedTourSession | null>(() => {
    try {
      const raw = localStorage.getItem(RESUME_SESSION_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw) as SavedTourSession;
      if (Date.now() - saved.savedAt < RESUME_SESSION_TTL_MS) return saved;
      localStorage.removeItem(RESUME_SESSION_KEY);
    } catch {
      localStorage.removeItem(RESUME_SESSION_KEY);
    }
    return null;
  });
  const [pocketMode, setPocketMode] = useState<boolean>(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<string>('idle');
  const [showSpotifyPrompt, setShowSpotifyPrompt] = useState<boolean>(() => {
    try {
      return localStorage.getItem('leo_spotify_prompted') !== 'true';
    } catch {
      return true;
    }
  });
  // The story on air and what the listener has said about it. The control only
  // ever rates the story that is actually playing, so a rating can never land
  // on the wrong one.
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [hasLikedStory, setHasLikedStory] = useState<boolean>(false);
  const [likeAnimating, setLikeAnimating] = useState<boolean>(false);
  const [ambientOn, setAmbientOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AMBIENT_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const voice = useVoice();
  const geolocation = useGeolocation();
  useWakeLock(isTourStarted);

  // What Leo is doing right now, reduced to one glanceable state. Nothing here
  // needs reading — the colour and the orb tell the listener everything from
  // arm's length, which is the whole point on a drive.
  const leoStatus = isProcessingQuestion
    ? { label: 'LEO IS THINKING', orb: 'from-amber-900/60 to-slate-900 border-amber-600/50', glow: 'bg-amber-500/25', ring: 'border-amber-400/30', icon: 'text-amber-300', text: 'text-amber-300' }
    : voice.isSpeaking
      ? { label: 'LEO IS SHARING', orb: 'from-blue-900/60 to-slate-900 border-blue-600/50', glow: 'bg-blue-500/25', ring: 'border-blue-400/30', icon: 'text-blue-300', text: 'text-blue-300' }
      : voice.wasInterrupted
        ? { label: 'TAP TO RESUME', orb: 'from-cyan-900/60 to-slate-900 border-cyan-600/50', glow: 'bg-cyan-500/25', ring: 'border-cyan-400/30', icon: 'text-cyan-300', text: 'text-cyan-300' }
        : { label: 'ON TOUR', orb: 'from-slate-800 to-slate-900 border-slate-600/50', glow: 'bg-cyan-500/10', ring: 'border-slate-500/25', icon: 'text-slate-400', text: 'text-slate-500' };

  const requestTokenRef = useRef<number>(0);
  const kickoffFiredRef = useRef(false);

  // Step the ambient bed back whenever a voice is present, so it never fights
  // Leo or the listener for attention.
  useEffect(() => {
    ambientAudio.setDucked(voice.isSpeaking || isProcessingQuestion);
  }, [voice.isSpeaking, isProcessingQuestion]);

  // The bed needs a tap to start, so it follows the tour rather than
  // autoplaying on load.
  useEffect(() => {
    if (isTourStarted && ambientOn) {
      ambientAudio.start();
    } else {
      ambientAudio.stop();
    }
  }, [isTourStarted, ambientOn]);

  // Dead-air pacing. Every filler line goes through this clock so exactly one
  // plays per silence, and so the quiet stretches Leo promises actually happen.
  const lastSpeechEndRef = useRef<number>(0);

  useEffect(() => {
    storyCache.setNetworkStatusCallback((online) => setIsOnline(online));
    storyCache.setCacheChangeCallback((cache: CachedStory[]) => {
      setCacheCount(cache.filter(s => !s.played).length);
    });
    storyCache.setMissedQueueChangeCallback((count) => setMissedQueueCount(count));
    // Pre-warm the Google Maps SDK so the first story doesn't wait for it.
    placesService.prewarm();
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      console.log('[Network] Back online');
      storyCache.setOnline(true);
    };
    const handleOffline = () => {
      console.log('[Network] Gone offline');
      storyCache.setOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    storyCache.setOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const persist = () => {
      if (isTourStarted) {
        localStorage.setItem(RESUME_SESSION_KEY, JSON.stringify({ savedAt: Date.now() }));
      }
    };
    const timer = setInterval(persist, 60_000);
    persist();
    return () => {
      clearInterval(timer);
      localStorage.removeItem(RESUME_SESSION_KEY);
    };
  }, [isTourStarted]);

  // Phones routinely kill the position watch while the page is hidden. Without
  // this the tour comes back holding a stale position and stops narrating.
  const restartTracking = geolocation.restartTracking;

  useEffect(() => {
    if (!isTourStarted) return;

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      restartTracking();
      ambientAudio.resumeIfNeeded();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isTourStarted, restartTracking]);

  const handleSubmitQuestion = () => {
    const question = userInput.trim();
    if (!question || isProcessingQuestion || !geolocation.position) return;
    setUserInput('');
    requestTokenRef.current = geminiService.currentRequestToken();
    geminiService.cancelAllRequests();
    voice.stop();
    setIsProcessingQuestion(true);
    handleUserQuestion(question);
  };

  const handleToggleAmbient = () => {
    setAmbientOn(prev => {
      const next = !prev;
      try {
        localStorage.setItem(AMBIENT_KEY, String(next));
      } catch {
        // storage unavailable — the choice just won't survive a reload
      }
      return next;
    });
  };

  // Lifting the audio block also gives the ambient bed its gesture back after
  // a trip to another app.
  const handleUnlockAudio = () => {
    voice.unlock();
    ambientAudio.resumeIfNeeded();
  };

  // Full quit: silence Leo, drop queued stories, cancel in-flight requests,
  // stop GPS. Tour state resets so the next open is a fresh start.
  const handleShare = async () => {
    const text = "Check out Leo's World \u2014 an AI tour guide that narrates the hidden stories of wherever you are, in real time.";
    const shareData = {
      title: "Leo's World",
      text,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
        setShareToast('Copied to clipboard');
        setTimeout(() => setShareToast(null), 2500);
      }
    } catch {
      // user dismissed share sheet or clipboard blocked \u2014 silent no-op
    }
  };

  const handleEndTour = () => {
    geminiService.cancelAllRequests();
    voice.muteForMinutes(0);
    voice.stop();
    geolocation.stopTracking();
    localStorage.removeItem(RESUME_SESSION_KEY);
    setResumableSession(null);
    setIsTourStarted(false);
    kickoffFiredRef.current = false;
  };

  const handleUserQuestion = useCallback(async (question: string) => {
    if (!geolocation.position) return;

    const token = geminiService.issueRequestToken();

    try {
      let fullAnswer = '';
      const nearby = geolocation.position
        ? (await placesService.getNearbyLandmarks(geolocation.position, 100)).slice(0, 5).map(p => p.name)
        : [];
      fullAnswer = await geminiService.answerQuestion(
        question,
        geolocation.position,
        undefined,
        {
          lastSpokenSentences: voice.getLastSpokenSentences(),
          nearbyLandmarks: nearby,
        }
      );
      if (token !== geminiService.currentRequestToken()) return;
      if (fullAnswer.trim().length > 0) {
        voice.recordSpokenText(fullAnswer);
        voice.speak(fullAnswer);
      }
    } catch (error) {
      console.error('Error answering question:', error);
      if (token === geminiService.currentRequestToken()) {
        voice.speak("Sorry, couldn't process that. Try asking again.");
      }
    } finally {
      setTimeout(() => setIsProcessingQuestion(false), 2000);
    }
  }, [geolocation.position, voice]);

  // These refs are declared BEFORE handleIntervalUpdate because the callback
  // reads them at call time, not capture time. The GPS interval can fire its
  // first fix in the same tick as setIsTourStarted(true) — before React
  // re-renders and re-creates the callback with the updated closure. Reading
  // the ref instead of the closure variable means the first fix always sees
  // isTourStarted as true and actually fetches a story.
  const isTourStartedRef = useRef(isTourStarted);
  isTourStartedRef.current = isTourStarted;
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const lastFetchTimeRef = useRef<number>(0);

  const handleIntervalUpdate = useCallback(async (position: Position | null) => {
    if (!position || !isTourStartedRef.current) {
      console.log('[Tour] Skipping story - position:', position, 'isTourStarted:', isTourStartedRef.current);
      return;
    }

    console.log('[Tour] Getting story for position:', position);
    setPipelineStatus('fetching landmarks');

    // Tier 1 landmark preemption: if a world/national-caliber landmark is
    // close by and unhearing, it jumps the queue. We don't hard-abort audio
    // mid-playback (that corrupts the speech queue); instead we skip the
    // current Tier 2 story so the Tier 1 story plays next. This keeps the
    // handoff clean while still ensuring you never drive past the Alamo
    // listening to a story about a parking lot.
    try {
      const nearby = await placesService.getNearbyLandmarks(position, 150);
      const tier1 = nearby.find(p =>
        placesService.isTier1Landmark(p) &&
        p.distance <= 150 &&
        !heardStories.hasHeard(p.name)
      );
      if (tier1 && voice.isPlayingStory()) {
        const currentTopic = voice.getCurrentStoryTopic();
        if (currentTopic && currentTopic !== tier1.name) {
          console.log(`[Tour] Tier 1 preemption: skipping "${currentTopic}" for "${tier1.name}"`);
          voice.skipCurrent();
        }
      }
    } catch {
      // Places lookup failure is non-fatal — the normal story path still runs.
    }

    // Capture the epoch before the request. If the user grabs the mic while
    // Leo is generating, the epoch moves and this story is kept out of the
    // audio queue — but it was still written to the shared cache, so the work
    // is not wasted.
    const epoch = geminiService.currentRequestToken();

    // No bridge filler — silence during generation is fine. The story's own
    // transition line will acknowledge the gap when it arrives.
    let bridgeTimer: number | null = null;

    try {
      setPipelineStatus('requesting story');
      const result = await storyCache.tryGetStoryForPosition(position, position.speed !== null && position.speed >= 6.0 ? 'driving' : 'walking');

      if (bridgeTimer !== null) clearTimeout(bridgeTimer);

      if (epoch !== geminiService.currentRequestToken()) {
        console.log('[Tour] Story generation superseded (mic or skip) — cached, not spoken');
        return;
      }

      if (result && result.story.trim().length > 0) {
        setPipelineStatus('story queued');
        setStoriesCount(prev => prev + 1);
        setLastStorySource(result.fromCache ? 'cache' : 'live');
        if (geminiError) { geminiService.clearError(); setGeminiError(null); }

        // A rotation story has now actually reached the listener, so this angle
        // on this subject is spent. Recorded here, at the moment it plays,
        // rather than when it was generated — a story written for a road the
        // listener never drove must not count as heard.
        if (result.rotation) {
          locationTracker.recordRotationStory(result.rotation, result.topic, position, result.story);
        }

        // Feeds the "what you just told them" context Leo gets when answering a
        // question, so his answers can refer back to the story in progress.
        voice.recordSpokenText(result.story);

        console.log(`[Tour] Story from ${result.fromCache ? 'CACHE' : 'LIVE'}, length: ${result.story.length}, queueing`);

        analytics.track('story_played', position, position.speed !== null && position.speed >= 6.0 ? 'driving' : 'walking', {
          source: result.fromCache ? 'cache' : 'live',
          topic: result.topic,
        });
        adManager.recordStoryPlayed();

        // Gemini now writes its own transition into the opening of each
        // story, so we queue directly — no app-side filler needed.
        const isRoad = position.speed !== null && position.speed >= 6.0;
        voice.queueStory(result.story, position.lat, position.lng, isRoad, undefined, result.subject);

        // Ad insertion point: after every Nth story, check for an active ad campaign.
        // No-op until ad campaigns are added to the database. Skipped for ad-free tiers.
        if (!subscriptions.isAdFree() && adManager.shouldInsertAd() && isOnlineRef.current) {
          const ad = await adManager.getAd(position, position.speed !== null && position.speed >= 6.0 ? 'driving' : 'walking');
          if (ad) {
            voice.queueStory(ad.text);
            analytics.track('ad_played', position, position.speed !== null && position.speed >= 6.0 ? 'driving' : 'walking', {
              campaign_id: ad.campaignId,
            });
          }
        }

        // Trigger prefetch in the background so the next story is ready.
        storyCache.prefetchForPosition(position, position.speed !== null && position.speed >= 6.0 ? 'driving' : 'walking').catch(() => {});
      } else if (!isOnlineRef.current) {
        setPipelineStatus('offline, no cache');
        console.log('[Tour] Offline - no cached story available, queued position');
      } else {
        // Story came back empty and we're online — Gemini likely failed.
        const err = geminiService.getLastError();
        const detail = err || 'no error set — shouldTell may have returned false or generateStory returned empty';
        setPipelineStatus('EMPTY: ' + detail.slice(0, 50));
        console.error('[Tour] Story came back EMPTY. result:', result, 'lastError:', err);
        if (err) {
          setGeminiError(err);
        }
      }
    } catch (error) {
      setPipelineStatus('ERROR: ' + (error instanceof Error ? error.message : String(error)).slice(0, 50));
      console.error('Error getting narration:', error);
      setGeminiError(error instanceof Error ? error.message : String(error));
    }
  }, [voice]);

  // When the story queue empties, fetch the next story so Leo keeps talking
  const positionRef = useRef(geolocation.position);
  positionRef.current = geolocation.position;

  const isProcessingQuestionRef = useRef(isProcessingQuestion);
  isProcessingQuestionRef.current = isProcessingQuestion;

  useEffect(() => {
    voice.setOnStoryComplete(() => {
      const pos = positionRef.current;
      if (!pos || !isTourStartedRef.current) return;

      // The anchor for "how long has it been quiet" is the end of the last
      // thing Leo actually said — not the last fetch, which would make a long
      // story look like silence and have him talk over his own gap.
      lastSpeechEndRef.current = Date.now();

      // Standing still for a while earns a deeper dive: shorter silence, and
      // Leo told to go long. This is the reward for stopping to actually look.
      locationTracker.noteDwell(pos);
      const dwellLevel = locationTracker.getDwellDepthLevel();
      if (dwellLevel !== null) {
        console.log(`[Dwell] Settled for ${locationTracker.getDwellMinutes()} min — deep cut`);
      }

      // Cooldown: don't hammer the API if the last fetch was recent
      // Scale with speed — driving needs longer gaps than walking
      const now = Date.now();
      const cooldownMs = pos.speed !== null && pos.speed >= 5.5 ? 30000 : dwellLevel !== null ? 3000 : 8000;
      if (now - lastFetchTimeRef.current < cooldownMs) {
        console.log('[Tour] Queue empty but cooldown active, waiting');
        const wait = cooldownMs - (now - lastFetchTimeRef.current);
        setTimeout(() => {
          if (voice.getQueueLength() === 0 && !voice.isPlayingStory()) {
            const p = positionRef.current;
            if (p && isTourStartedRef.current) handleIntervalUpdate(p);
          }
        }, wait);
        return;
      }

      // If offline, wait silently — the next GPS interval or reconnect will
      // pick the story queue back up. No filler lines; Leo returns naturally
      // with a transition that acknowledges the gap.
      if (!isOnlineRef.current) return;

      console.log('[Tour] Story queue empty, fetching next story');
      lastFetchTimeRef.current = Date.now();
      handleIntervalUpdate(pos).then(() => {
        // If nothing was queued (Gemini returned empty, shouldTell was false,
        // or the API errored), schedule a retry so Leo doesn't go silent
        // indefinitely waiting for the next GPS interval.
        if (voice.getQueueLength() === 0 && !voice.isPlayingStory()) {
          console.log('[Tour] No story queued after fetch, retrying in 8s');
          setTimeout(() => {
            if (!isTourStartedRef.current) return;
            if (voice.isPlayingStory() || voice.getQueueLength() > 0) return;
            const p = positionRef.current;
            if (p) handleIntervalUpdate(p);
          }, 8000);
        }
      });
    });
  }, [voice, handleIntervalUpdate]);

  // No silence fillers. When a story arrives after a quiet gap, the transition
  // line acknowledges the pause naturally. Silence lets the listener look around.

  const cacheCountRef = useRef(cacheCount);
  cacheCountRef.current = cacheCount;

  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    if (!isTourStarted || !isOnline) return;

    const prefetchTimer = setInterval(async () => {
      if (!geolocation.position || !isOnline) return;
      if (cacheCountRef.current >= 500) return;
      if (voiceRef.current.isPlayingStory() || voiceRef.current.getQueueLength() > 0) return;

      setPrefetching(true);
      try {
        // Stock the road ahead while there is signal — this is what keeps Leo
        // talking through dead zones on a long drive.
        const generated = await storyCache.prefetchRouteAhead(geolocation.position, geolocation.movementMode);
        if (generated === 0) {
          await storyCache.prefetchForPosition(geolocation.position, geolocation.movementMode);
        }
      } catch (error) {
        console.error('[Prefetch] Error:', error);
      } finally {
        setPrefetching(false);
      }
    }, 30000);

    return () => clearInterval(prefetchTimer);
  }, [isTourStarted, isOnline, geolocation.position, geolocation.movementMode]);

  const prevOnlineRef = useRef(isOnline);
  useEffect(() => {
    const wasOffline = !prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    if (isOnline && wasOffline && missedQueueCount > 0 && isTourStarted) {
      console.log('[Catch-up] Back online with', missedQueueCount, 'missed stories');
      setCatchUpActive(true);

      const playCatchUp = async () => {
        await storyCache.processMissedQueue();
        const cache = storyCache.getCache();
        const unplayed = cache.filter(s => !s.played);

        if (unplayed.length > 0) {
          const intro = "Got some stories I couldn't share earlier while we lost signal. Let me catch you up.";
          voice.queueStory(intro);
          // Catch-up is a deliberate replay of stories missed in the dead zone,
          // so these are queued as scripted lines — they keep their order and
          // are not subject to the live freshness gate.
          for (const story of unplayed) {
            story.played = true;
            voice.queueStory(story.text);
          }

          setStoriesCount(prev => prev + unplayed.length);
          setLastStorySource('cache');
          setCatchUpActive(false);
        } else {
          setCatchUpActive(false);
        }
      };

      playCatchUp();
    }
  }, [isOnline, missedQueueCount, isTourStarted, voice]);

  useEffect(() => {
    voice.setOnStoryStart(() => {
      setHasLikedStory(false);
    });
  }, [voice]);

  useEffect(() => {
    voice.setCurrentPositionProvider(() => {
      const pos = geolocation.position;
      if (!pos) return null;
      return { lat: pos.lat, lng: pos.lng, speed: pos.speed, heading: pos.heading };
    });
  }, [voice, geolocation.position]);

  useEffect(() => {
    geolocation.setOnInterval(handleIntervalUpdate);
  }, [handleIntervalUpdate, geolocation]);

  // Kickoff: the first story doesn't come from the GPS interval (which may
  // fire before setOnInterval is wired) or from onStoryComplete (which only
  // fires after a queued story ends, not after the intro). Once the tour is
  // started and we have a real position, fetch the first story directly.
  useEffect(() => {
    if (!isTourStarted || !geolocation.position || kickoffFiredRef.current) return;
    kickoffFiredRef.current = true;
    console.log('[Tour] Kickoff — fetching first story for position');
    lastFetchTimeRef.current = Date.now();
    handleIntervalUpdate(geolocation.position);
  }, [isTourStarted, geolocation.position, handleIntervalUpdate]);

  const handleStartTour = async (resume: boolean = false) => {
    try {
      geminiService.initialize();
      try { geminiAudio.initialize(); } catch (e) { console.error('[Tour] Gemini TTS init failed:', e); }

      const initialized = voice.initializeVoice();
      if (!initialized) {
        alert('Voice synthesis not available in your browser.');
        return;
      }

      // Speech must be requested inside this tap. The voice list is resolved
      // first: it usually loads within a frame, and waiting for it means the
      // whole opening line plays in Leo's voice instead of swapping speakers
      // mid-sentence when the list finally arrives.
      const intro = getIntro(resume);
      await voice.ensureVoiceReady();
      voice.unlock();
      voice.speak(intro);
      if (ambientOn) ambientAudio.start();

      // Flip to the tour view immediately. The intro is already playing — the
      // listener should see the tour screen, not the landing page or the resume
      // prompt. The database hydration below still completes before GPS starts,
      // so the first story fetch has the full heard-story and taste history.
      setResumableSession(null);
      localStorage.removeItem(RESUME_SESSION_KEY);
      setIsTourStarted(true);

      if (!resume) {
        storyCache.reset();
        adManager.reset();
        subscriptions.reset();
      }
      locationTracker.reset();
      storyCache.setOnline(navigator.onLine);

      const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      sessionStorage.setItem('leo_session_id', sessionId);
      analytics.init(sessionId);
      analytics.track('session_start', null, 'stationary');

      // These complete before GPS starts, so the first story fetch has the
      // full history. The UI is already on the tour screen by now.
      await heardStories.hydrate();
      tasteProfile.setSession(sessionId);
      await tasteProfile.hydrate();

      await geolocation.startTracking();
    } catch (error) {
      // Internal failure detail stays in the console. The listener gets a
      // plain message, so database and service errors are never shown.
      console.error('[Tour] Failed to start tour:', error);
      alert("Leo couldn't start the tour. Please check that location access is allowed and try again.");
    }
  };

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-200 flex flex-col overflow-hidden relative">
      {resumableSession && !isTourStarted && (
        <div className="absolute inset-0 z-30 bg-slate-950/85 backdrop-blur-md flex items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <div className="mb-6 flex justify-center relative">
              <div className="absolute inset-0 rounded-2xl bg-blue-500/20 blur-2xl" />
              <div className="relative w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-600/60 flex items-center justify-center shadow-2xl">
                <Compass className="text-blue-400" size={32} strokeWidth={1.5} />
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-2 text-white tracking-tight">Tour in progress</h2>
            <p className="text-sm text-slate-400 mb-6">You had a tour going recently. Pick up where you left off?</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleStartTour(true)}
                className="px-8 py-3.5 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-xl text-lg font-semibold text-white hover:from-blue-500 hover:to-cyan-400 transition-all active:scale-95 shadow-xl shadow-blue-900/40"
              >
                <Play className="inline-block mr-2" size={18} />
                RESUME TOUR
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem(RESUME_SESSION_KEY);
                  setResumableSession(null);
                }}
                className="px-8 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-sm font-semibold text-slate-300 hover:bg-slate-700 transition-all active:scale-95"
              >
                Start Fresh
              </button>
            </div>
          </div>
        </div>
      )}
      {!isTourStarted ? (
        <div className="flex-1 flex items-center justify-center bg-slate-900 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-800 to-slate-950" />
          <div className="absolute inset-0 leo-grid" />
          <div className="absolute top-[15%] left-[10%] w-[28rem] h-[28rem] bg-amber-600 rounded-full opacity-[0.06] blur-[120px] leo-float" />
          <div className="absolute bottom-[10%] right-[8%] w-[24rem] h-[24rem] bg-cyan-500 rounded-full opacity-[0.05] blur-[120px] leo-float-slow" />
          <div className="absolute top-[50%] left-[55%] w-[20rem] h-[20rem] bg-amber-400 rounded-full opacity-[0.03] blur-[100px] leo-float" />

          <div className="text-center px-6 relative z-10">
            <div className="mb-8 flex justify-center relative">
              <div className="absolute rounded-full border border-amber-400/30 leo-ring" style={{ width: 80, height: 80 }} />
              <div className="absolute rounded-full border border-cyan-400/20 leo-ring-delay" style={{ width: 80, height: 80 }} />
              <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 border border-amber-600/30 flex items-center justify-center shadow-2xl">
                <Compass className="text-amber-400" size={44} strokeWidth={1.5} />
              </div>
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold mb-3 tracking-tight leo-shimmer-amber bg-gradient-to-r from-amber-200 via-white to-amber-300 bg-clip-text text-transparent" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
              LEO'S WORLD
            </h1>
            <p className="text-lg mb-10 text-slate-400 font-light tracking-wide">
              Your AI guide for the road
            </p>
            <button
              onClick={() => handleStartTour(false)}
              className="px-10 py-3.5 bg-gradient-to-r from-amber-600 to-amber-500 rounded-xl text-lg font-semibold text-white hover:from-amber-500 hover:to-amber-400 transition-all transform hover:scale-105 active:scale-95 shadow-xl shadow-amber-900/40"
            >
              <Play className="inline-block mr-2" size={20} />
              START TOUR
            </button>
            <p className="mt-6 text-xs text-slate-500 tracking-wide">
              Enables voice, location, and AI features
            </p>
            <p className="mt-2 text-[11px] text-slate-600 max-w-sm mx-auto leading-relaxed">
              Leo is an informational audio guide. Always keep your eyes on the road and stay aware of your surroundings.
            </p>
            <div className="mt-8 flex items-center gap-3 justify-center">
              <button
                onClick={() => handleShare()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/60 border border-slate-700/60 text-slate-300 hover:bg-slate-700 transition-all active:scale-95 text-sm font-medium shadow-md backdrop-blur-sm"
              >
                <Share2 size={16} />
                Share Leo's World
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* TOP ZONE — status pill + quick toggles */}
          <div className="safe-top shrink-0 bg-slate-900/95 backdrop-blur-md border-b border-slate-800/80 px-4 pt-3 pb-2 relative z-20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 bg-slate-800/80 border border-amber-800/40 px-3 py-1.5 rounded-full shadow-md">
                <span className="w-2 h-2 rounded-full bg-amber-500 leo-live" />
                <span className="text-[11px] font-bold tracking-widest text-slate-200">LEO'S WORLD</span>
              </div>

              <div className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border transition-colors ${
                  isOnline ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60' : 'text-red-400 bg-red-950/60 border-red-800/60'
                }`}>
                  {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
                </div>
                {geolocation.isTracking && (
                  <div className="flex items-center gap-1.5 text-blue-400 bg-slate-800/80 border border-slate-700/60 px-2.5 py-1.5 rounded-full shadow-md">
                    <MapPin size={14} className="animate-pulse" />
                  </div>
                )}
                <button
                  onClick={handleToggleAmbient}
                  title={ambientOn ? 'Turn ambient background audio off' : 'Turn ambient background audio on'}
                  className={`p-1.5 rounded-full transition-all border ${
                    ambientOn
                      ? 'bg-cyan-950/80 border-cyan-700/60 text-cyan-300'
                      : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  <Music size={16} />
                </button>
                <button
                  onClick={() => setPocketMode(!pocketMode)}
                  title="Pocket Mode"
                  className={`p-1.5 rounded-full transition-all border ${
                    pocketMode
                      ? 'bg-slate-700 border-slate-600 text-slate-200'
                      : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  <Moon size={16} />
                </button>
                <button
                  onClick={() => setShowDiagnostics(!showDiagnostics)}
                  className="p-1.5 rounded-full bg-slate-800/80 border border-slate-700/60 hover:bg-slate-700 transition-all text-slate-400"
                >
                  {showDiagnostics ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </div>

          {/* MIDDLE ZONE — narrative card */}
          <div className="flex-1 relative bg-gradient-to-b from-slate-800 via-slate-850 to-slate-900 flex items-center justify-center overflow-hidden px-5">
            <div className="absolute inset-0 leo-grid opacity-50" />
            <div className="absolute top-10 left-10 w-64 h-64 bg-amber-700 rounded-full opacity-[0.07] blur-[100px] leo-float" />
            <div className="absolute bottom-16 right-16 w-72 h-72 bg-cyan-600 rounded-full opacity-[0.05] blur-[100px] leo-float-slow" />
            <div className="absolute top-[40%] right-[20%] w-48 h-48 bg-amber-500 rounded-full opacity-[0.04] blur-[80px] leo-float" />

            {showDiagnostics && (
              <div className="absolute top-3 right-3 bg-slate-800/90 backdrop-blur-md border border-slate-700/70 p-3 rounded-xl z-30 text-xs max-w-[220px] shadow-2xl">
                <h3 className="font-bold mb-2 text-blue-400 text-[10px] tracking-widest">DIAGNOSTICS</h3>
                <div className="space-y-1 text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${voice.isInitialized ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <span>Voice: {voice.isInitialized ? 'OK' : 'Off'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${geolocation.isTracking ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <span>GPS: {geolocation.isTracking ? 'On' : 'Off'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${geolocation.position ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span>Pos: {geolocation.position ? 'Locked' : 'Search'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <span>Net: {isOnline ? 'Online' : 'Off'}</span>
                  </div>
                </div>
                {geolocation.position && (
                  <div className="mt-2 pt-2 border-t border-slate-700 text-[10px] text-slate-500">
                    <p>{geolocation.position.lat.toFixed(4)}, {geolocation.position.lng.toFixed(4)}</p>
                    <p>±{geolocation.position.accuracy.toFixed(0)}m</p>
                  </div>
                )}
                <div className="mt-2 pt-2 border-t border-slate-700 text-[10px]">
                  <p className="text-slate-500">Stories: {storiesCount}</p>
                  <p className="text-slate-500">Source: {lastStorySource || 'none'}</p>
                  <p className="text-slate-500">Cache: {cacheCount}</p>
                  <p className="text-slate-500">Missed: {missedQueueCount}</p>
                  <p className="text-slate-500">Speaking: {voice.isSpeaking ? 'Y' : 'N'}</p>
                  <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-slate-700">
                    <div className={`w-2 h-2 rounded-full ${geminiService.hasModel() ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <span className="text-slate-500">Gemini: {geminiService.hasModel() ? 'Init' : 'Off'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className={`w-2 h-2 rounded-full ${voice.ttsStatus === 'gemini' ? 'bg-emerald-500' : voice.ttsStatus.startsWith('fallback') ? 'bg-amber-500' : 'bg-slate-600'}`} />
                    <span className="text-slate-500">TTS: {voice.ttsStatus}</span>
                  </div>
                  {geminiError && (
                    <p className="text-red-400 text-[9px] mt-1 leading-tight">{geminiError.slice(0, 80)}</p>
                  )}
                  {!geminiError && storiesCount === 0 && isTourStarted && (
                    <p className="text-amber-400 text-[9px] mt-1 leading-tight">No stories generated — check console for [Tour] logs</p>
                  )}
                  <p className="text-cyan-400 text-[9px] mt-1 leading-tight">Pipeline: {pipelineStatus}</p>
                  {geolocation.position && (
                    <p className="text-slate-500">
                      Angles covered: {storyCoverage.getTotalAnglesCovered()} across {storyCoverage.getSubjectCount()} subjects
                    </p>
                  )}
                  <p className="text-slate-500">Taste tags: {tasteProfile.getTagCount()}</p>
                </div>
              </div>
            )}

            <div className="max-w-xl w-full relative z-10 text-center">
              {geolocation.error && (
                <div className="mb-4 bg-red-950/70 backdrop-blur border border-red-800/70 p-3 rounded-xl">
                  <p className="text-sm text-red-300">{geolocation.error}</p>
                </div>
              )}

              {catchUpActive && (
                <div className="flex items-center gap-2 justify-center mb-4 bg-amber-950/80 backdrop-blur border border-amber-800/70 px-4 py-2 rounded-xl">
                  <Clock size={16} className="text-amber-500 animate-pulse" />
                  <span className="text-xs font-semibold text-amber-400">Catching up...</span>
                </div>
              )}

              {showSpotifyPrompt && isTourStarted && (
                <div className="mb-4 bg-emerald-950/80 backdrop-blur border border-emerald-800/70 px-4 py-3 rounded-xl flex items-center gap-3">
                  <Music size={18} className="text-emerald-400 shrink-0" />
                  <div className="flex-1 text-left">
                    <p className="text-xs font-semibold text-emerald-300">Want music while you tour?</p>
                    <p className="text-[10px] text-emerald-500/80">Open Spotify and Leo will duck when he talks.</p>
                  </div>
                  <button
                    onClick={() => {
                      window.open('https://open.spotify.com', '_blank');
                      try { localStorage.setItem('leo_spotify_prompted', 'true'); } catch { /* storage unavailable */ }
                      setShowSpotifyPrompt(false);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors active:scale-95 shrink-0"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => {
                      try { localStorage.setItem('leo_spotify_prompted', 'true'); } catch { /* storage unavailable */ }
                      setShowSpotifyPrompt(false);
                    }}
                    className="p-1.5 rounded-lg text-emerald-500/60 hover:text-emerald-400 transition-colors shrink-0"
                  >
                    <XCircle size={16} />
                  </button>
                </div>
              )}

              {!isOnline && (
                <div className="flex items-center gap-2 justify-center mb-4 bg-red-950/80 backdrop-blur border border-red-800/70 px-4 py-2 rounded-xl">
                  <WifiOff size={16} className="text-red-400" />
                  <span className="text-xs font-semibold text-red-300">No signal — playing from cache</span>
                </div>
              )}

              {voice.audioBlocked && (
                <button
                  onClick={handleUnlockAudio}
                  className="w-full flex items-center gap-2 justify-center mb-4 bg-amber-950/80 backdrop-blur border border-amber-800/70 px-4 py-2.5 rounded-xl hover:bg-amber-900/80 transition-colors active:scale-95"
                >
                  <VolumeX size={16} className="text-amber-500 shrink-0" />
                  <span className="text-xs font-semibold text-amber-300">
                    Your browser muted Leo. Tap here to turn the sound back on.
                  </span>
                </button>
              )}

              {voice.wasInterrupted && !voice.audioBlocked && (
                <button
                  onClick={handleUnlockAudio}
                  className="w-full flex items-center gap-2 justify-center mb-4 bg-cyan-950/80 backdrop-blur border border-cyan-800/70 px-4 py-2.5 rounded-xl hover:bg-cyan-900/80 transition-colors active:scale-95"
                >
                  <Play size={16} className="text-cyan-400 shrink-0" />
                  <span className="text-xs font-semibold text-cyan-300">
                    Welcome back. Tap to keep the tour going.
                  </span>
                </button>
              )}

              {isOnline && cacheCount > 0 && (
                <div className="flex items-center gap-1.5 justify-center mb-4 text-emerald-500">
                  <Download size={12} className={prefetching ? 'animate-bounce' : ''} />
                  <span className="text-[11px] font-medium">{cacheCount} stories ready offline</span>
                </div>
              )}

              {/* Distraction-free by design: no story text on screen. The orb
                  carries the state so the listener never has to read. */}
              <div className="flex flex-col items-center">
                <div className="relative flex items-center justify-center mb-6" style={{ width: 128, height: 128 }}>
                  <div className={`absolute rounded-full border leo-ring ${leoStatus.ring}`} style={{ width: 128, height: 128 }} />
                  <div className={`absolute rounded-full border leo-ring-delay ${leoStatus.ring}`} style={{ width: 128, height: 128 }} />
                  <div className={`absolute w-24 h-24 rounded-full blur-2xl transition-colors duration-700 ${leoStatus.glow}`} />
                  <div className={`relative w-24 h-24 rounded-full bg-gradient-to-br border flex items-center justify-center shadow-2xl transition-colors duration-500 ${leoStatus.orb}`}>
                    {isProcessingQuestion
                      ? <Send size={30} className={leoStatus.icon} strokeWidth={1.5} />
                      : <Compass size={34} className={leoStatus.icon} strokeWidth={1.5} />}
                  </div>
                </div>

                {voice.isSpeaking && (
                  <div className="flex items-center gap-[3px] h-5 mb-4">
                    {[0, 1, 2, 3, 4].map(i => (
                      <span
                        key={i}
                        className="w-[3px] h-full bg-gradient-to-t from-amber-500 to-amber-300 rounded-full leo-wave-bar"
                        style={{ animationDelay: `${i * 0.12}s` }}
                      />
                    ))}
                  </div>
                )}

                <p className={`text-[11px] font-bold tracking-[0.25em] transition-colors duration-500 ${leoStatus.text}`}>
                  {leoStatus.label}
                </p>

                <div className="mt-5 flex items-center gap-3">
                  <button
                    onClick={() => {
                      if (hasLikedStory || likeAnimating) return;
                      setHasLikedStory(true);
                      setLikeAnimating(true);
                      setTimeout(() => setLikeAnimating(false), 600);
                      const topic = voice.getCurrentStoryTopic();
                      const pos = geolocation.position;
                      if (topic && pos) {
                        const sessionId = sessionStorage.getItem('leo_session_id');
                        storyLikes.record(topic, '', pos.lat, pos.lng, sessionId);
                      }
                    }}
                    disabled={!voice.isSpeaking || hasLikedStory}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all active:scale-95 text-sm font-medium shadow-md disabled:opacity-30 disabled:cursor-not-allowed ${
                      hasLikedStory
                        ? 'bg-rose-600/20 border-rose-500/50 text-rose-300'
                        : 'bg-slate-800/60 backdrop-blur-sm border-slate-700/60 text-slate-300 hover:bg-slate-700'
                    } ${likeAnimating ? 'scale-110' : ''}`}
                    title="Like this story"
                  >
                    <Heart size={16} className={hasLikedStory ? 'fill-rose-400 text-rose-400' : ''} />
                    {hasLikedStory ? 'Liked' : 'Like'}
                  </button>
                  <button
                    onClick={() => handleShare()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 text-slate-300 hover:bg-slate-700 transition-all active:scale-95 text-sm font-medium shadow-md"
                  >
                    <Share2 size={16} />
                    Share
                  </button>
                </div>

              </div>
            </div>

            {pocketMode && (
              <div
                className="absolute inset-0 z-40 bg-black flex items-center justify-center"
                onClick={() => setPocketMode(false)}
              >
                <div className="text-center">
                  <Moon size={28} className="mx-auto mb-3 text-slate-700" />
                  <p className="text-xs text-slate-600 tracking-wide">Pocket mode — tap anywhere to wake</p>
                </div>
              </div>
            )}
          </div>

          {/* BOTTOM DOCK — ask Leo anything */}
          <div className="bg-slate-950/95 backdrop-blur-md border-t border-slate-800/80 safe-bottom px-4 pt-3 pb-3 relative shrink-0 z-30">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitQuestion(); }}
                placeholder="Ask Leo about this area…"
                disabled={isProcessingQuestion}
                className="flex-1 px-4 py-3 rounded-xl bg-slate-800/80 border border-slate-700/60 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-600/50 focus:ring-1 focus:ring-amber-500/30 transition-all"
              />
              <button
                onClick={handleSubmitQuestion}
                disabled={!userInput.trim() || isProcessingQuestion}
                className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 text-white hover:from-amber-500 hover:to-amber-400 transition-all active:scale-95 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {isProcessingQuestion
                  ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <Send size={18} />}
              </button>
            </div>

            <div className="flex justify-center mt-3">
              <button
                onClick={handleEndTour}
                title="End tour — Leo stops and GPS turns off"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/60 border border-red-900/60 text-red-400 hover:bg-red-900 transition-all active:scale-95 text-xs font-medium"
              >
                <XCircle size={14} />
                <span>End Tour</span>
              </button>
            </div>
          </div>
        </>
      )}

      {shareToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-slate-800/95 border border-slate-600/60 text-slate-200 text-xs font-medium px-4 py-2.5 rounded-xl shadow-2xl leo-fade-up">
          {shareToast}
        </div>
      )}
    </div>
  );
}

export default App;
