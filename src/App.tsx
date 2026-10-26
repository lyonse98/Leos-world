import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, EyeOff, Play, MapPin, Wifi, WifiOff, Download, Clock, Compass, VolumeX, Moon, XCircle, Share2, Music, Send, Heart, AlertTriangle, Mic, Smartphone } from 'lucide-react';
import { useVoice, StoryTiming } from './hooks/useVoice';
import { useGeolocation, Position } from './hooks/useGeolocation';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useWakeLock } from './hooks/useWakeLock';
import { geminiService } from './services/gemini';
import { storyCache, CachedStory } from './services/storyCache';
import { locationTracker } from './services/locationTracker';
import { analytics } from './services/analytics';
import { placesService } from './services/placesService';
import { getIntro } from './services/intros';
import { heardStories, rotateUserKey } from './services/heardStories';
import { tasteProfile } from './services/tasteProfile';
import { storyCoverage, landmarkSubjectKey } from './services/storyCoverage';

import { ambientAudio } from './services/ambientAudio';
import { storyLikes } from './services/storyLikes';
import { LEO_MODEL_ID, LEO_QA_MODEL_ID } from './services/leoPersona';
import { geminiAudio } from './services/geminiAudio';
import { SUPABASE_CONFIGURED } from './services/supabase';
import LeoFigure, { LeoPose } from './components/LeoFigure';
import SdBeach from './components/SdBeach';
import { isStandalone, detectInstallPlatform, canNativeInstall, nativeInstall, InstallPlatform } from './utils/install';

// Platform-specific "add to home screen" guidance, shared by the landing
// tip and the post-tour nudge. Until there is a native app, the home-
// screen icon is the product's front door — and on iOS only Safari can
// create it, which the ios-other-browser branch says out loud.
function InstallHelp({ platform, nativeReady, onNativeInstall }: {
  platform: InstallPlatform;
  nativeReady: boolean;
  onNativeInstall: () => void;
}) {
  const stepClass = "list-decimal list-inside space-y-1 text-xs text-slate-300 leading-relaxed";
  if (platform === 'ios-safari') {
    return (
      <ol className={stepClass}>
        <li>Tap the <span className="text-slate-100 font-medium">Share</span> icon in Safari's toolbar</li>
        <li>Scroll down and tap <span className="text-slate-100 font-medium">Add to Home Screen</span></li>
        <li>Tap <span className="text-slate-100 font-medium">Add</span> — Leo gets his own icon, full-screen</li>
      </ol>
    );
  }
  if (platform === 'ios-other-browser') {
    return (
      <p className="text-xs text-slate-300 leading-relaxed">
        This only works in Safari: open Leo's World in <span className="text-slate-100 font-medium">Safari</span>,
        then tap <span className="text-slate-100 font-medium">Share → Add to Home Screen → Add</span>.
      </p>
    );
  }
  if (platform === 'android') {
    if (nativeReady) {
      return (
        <button
          onClick={onNativeInstall}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 text-white text-sm font-semibold hover:from-amber-500 hover:to-amber-400 transition-all active:scale-95 shadow-md"
        >
          Install Leo
        </button>
      );
    }
    return (
      <ol className={stepClass}>
        <li>Tap the browser menu (<span className="text-slate-100 font-medium">three dots</span>, top right)</li>
        <li>Tap <span className="text-slate-100 font-medium">Add to Home screen</span> (or <span className="text-slate-100 font-medium">Install app</span>)</li>
        <li>Confirm — Leo lands on your home screen</li>
      </ol>
    );
  }
  return (
    <p className="text-xs text-slate-300 leading-relaxed">
      Use your browser's menu and choose <span className="text-slate-100 font-medium">Add to Home Screen</span> or
      <span className="text-slate-100 font-medium"> Install</span> — Leo runs like an app, no store needed.
    </p>
  );
}

// The sky over San Diego, by the clock. Still just a gradient — no image,
// no weight — but the app sits in the same light the driver is in.
function daySkyGradient(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 8) return 'linear-gradient(to bottom, #0b1226 0%, #27355c 55%, #6b3a1e 135%)';
  if (h >= 8 && h < 17) return 'linear-gradient(to bottom, #0a1f33 0%, #155e75 60%, #0f766e 140%)';
  if (h >= 17 && h < 20) return 'linear-gradient(to bottom, #150f2e 0%, #46224d 55%, #8a3b16 135%)';
  return 'linear-gradient(to bottom, #020617 0%, #1e293b 55%, #020617 100%)';
}

const RESUME_SESSION_KEY = 'leo_active_session';
const RESUME_SESSION_TTL_MS = 30 * 60 * 1000;
const AMBIENT_KEY = 'leo_ambient_on';

interface SavedTourSession {
  savedAt: number;
}

function App() {
  const [isTourStarted, setIsTourStarted] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [isProcessingQuestion, setIsProcessingQuestion] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [storiesCount, setStoriesCount] = useState<number>(0);
  const [isInstalled] = useState<boolean>(() => isStandalone());
  const [installPlatform] = useState<InstallPlatform>(() => detectInstallPlatform());
  const [installTipOpen, setInstallTipOpen] = useState(false);
  const [showInstallNudge, setShowInstallNudge] = useState(false);
  const [nativeReady, setNativeReady] = useState(false);

  const handleNativeInstall = async () => {
    const accepted = await nativeInstall();
    if (accepted) {
      setShowInstallNudge(false);
      setInstallTipOpen(false);
    }
    setNativeReady(canNativeInstall());
  };
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [cacheCount, setCacheCount] = useState<number>(0);
  const [missedQueueCount, setMissedQueueCount] = useState<number>(0);
  const [lastStorySource, setLastStorySource] = useState<'live' | 'cache' | 'library' | null>(null);
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
  const [backendBannerDismissed, setBackendBannerDismissed] = useState<boolean>(false);

  const voice = useVoice();
  const geolocation = useGeolocation();
  const speech = useSpeechRecognition();
  // While a push-to-talk question is being asked or answered, location
  // stories must not be queued — Leo stays quiet so the driver can ask,
  // hear the answer, and only then get the tour back.
  const pttHoldRef = useRef<boolean>(false);
  useWakeLock(isTourStarted);

  // What Leo is doing right now, reduced to one glanceable state. Nothing here
  // needs reading — the colour and the orb tell the listener everything from
  // arm's length, which is the whole point on a drive.
  const leoStatus = speech.isListening
    ? { label: 'LISTENING — ASK AWAY', pose: 'listening' as const, orb: 'from-rose-900/60 to-slate-900 border-rose-600/50', glow: 'bg-rose-500/25', ring: 'border-rose-400/30', icon: 'text-rose-300', text: 'text-rose-300' }
    : isProcessingQuestion
    ? { label: 'LEO IS THINKING', pose: 'thinking' as const, orb: 'from-amber-900/60 to-slate-900 border-amber-600/50', glow: 'bg-amber-500/25', ring: 'border-amber-400/30', icon: 'text-amber-300', text: 'text-amber-300' }
    : voice.isSpeaking
      ? { label: 'LEO IS SHARING', pose: 'speaking' as const, orb: 'from-blue-900/60 to-slate-900 border-blue-600/50', glow: 'bg-blue-500/25', ring: 'border-blue-400/30', icon: 'text-blue-300', text: 'text-blue-300' }
      : voice.wasInterrupted
        ? { label: 'TAP TO RESUME', pose: 'idle' as const, orb: 'from-cyan-900/60 to-slate-900 border-cyan-600/50', glow: 'bg-cyan-500/25', ring: 'border-cyan-400/30', icon: 'text-cyan-300', text: 'text-cyan-300' }
        : { label: 'ON TOUR', pose: 'idle' as const, orb: 'from-slate-800 to-slate-900 border-slate-600/50', glow: 'bg-cyan-500/10', ring: 'border-slate-500/25', icon: 'text-slate-400', text: 'text-slate-500' };

  // Brief pose breakouts that outrank the state pose: Leo points when a
  // major landmark's story jumps the queue, and throws a thumbs-up when a
  // story is liked. Pure theatre — timed, then the state pose resumes.
  const [poseFlash, setPoseFlash] = useState<LeoPose | null>(null);
  const skyGradient = daySkyGradient();
  const poseFlashTimerRef = useRef<number | null>(null);
  const flashPose = useCallback((pose: LeoPose, ms: number) => {
    setPoseFlash(pose);
    if (poseFlashTimerRef.current) window.clearTimeout(poseFlashTimerRef.current);
    poseFlashTimerRef.current = window.setTimeout(() => setPoseFlash(null), ms);
  }, []);

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

  // Per-story timing — fetch and text phases recorded here, synth phases
  // recorded in useVoice. Merged for the diagnostics panel after each story.
  // The two fetch markers live in ONE record, written atomically by the
  // fetch that produced them: they used to be separate refs, and
  // overlapping fetches (an interval fetch starting while a slow one was
  // still in flight) overwrote the start marker after the ready marker
  // was set — pairing one fetch's start with another's finish and
  // recording negative fetch times (-149.1s in the field). A matched
  // pair cannot go negative.
  const fetchCycleRef = useRef<{ startAt: number; readyAt: number } | null>(null);
  const [lastStoryTiming, setLastStoryTiming] = useState<string>('');
  const prevStoryTimingEndRef = useRef<number | null>(null);
  const isFetchingStoryRef = useRef<boolean>(false);

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

  // One question pipeline for typed and spoken questions alike. Returns
  // true when the question was accepted and processing has begun.
  // Strict Q&A serialization (Erik's model): one question + answer at a
  // time, across BOTH inputs. isProcessingQuestion is the single lock —
  // the text box and Send button already disable on it, and the Leo
  // press already refuses on it. The lock spans the whole answer cycle
  // and is released by releaseQuestionLock.
  //
  // The cycle is driven by CONFIRMED playback, never by queue movement
  // (Oct 25 lost-answer fix): the answer is spoken via speakTracked,
  // and only when the player reports the answer item has ENDED — with
  // proof it sounded — is the bridge line queued and the tour resumed;
  // the lock then releases when the next line goes on air. An answer
  // that ends without ever sounding (both voice engines failed) gets
  // an honest spoken apology and a clean release instead. The earlier
  // design inferred completion from the next queue item starting,
  // which cannot tell a finished answer from a dropped one — it
  // played "Alright, let's get back to it" over an answer that never
  // aired and released the lock as if all was well. The failsafe below
  // remains as a backstop, and tour end releases too. No path may
  // leave the lock set — a stuck lock bricks both inputs, which is
  // worse than any overlap it prevents.
  const answerPhaseRef = useRef<'awaiting-answer' | 'awaiting-resume' | null>(null);
  const answerCycleRef = useRef(0);
  const answerFailsafeRef = useRef<number | null>(null);
  const releaseQuestionLock = useCallback(() => {
    answerPhaseRef.current = null;
    if (answerFailsafeRef.current) {
      window.clearTimeout(answerFailsafeRef.current);
      answerFailsafeRef.current = null;
    }
    setIsProcessingQuestion(false);
    pttHoldRef.current = false;
  }, []);

  const submitQuestion = (raw: string): boolean => {
    const question = raw.trim();
    if (!question || isProcessingQuestion) return false;
    if (!geolocation.position) {
      setShareToast('Leo needs your location to answer — check location is enabled');
      setTimeout(() => setShareToast(null), 3500);
      return false;
    }
    analytics.track('question_asked', geolocation.position, geolocation.position.speed !== null && geolocation.position.speed >= 6.0 ? 'driving' : 'walking', { question: question.slice(0, 500), model: LEO_QA_MODEL_ID });
    requestTokenRef.current = geminiService.currentRequestToken();
    geminiService.cancelAllRequests();
    setIsProcessingQuestion(true);
    handleUserQuestion(question);
    return true;
  };

  const handleSubmitQuestion = () => {
    if (submitQuestion(userInput)) {
      setUserInput('');
    }
  };

  // Push-to-talk: tap the orb and Leo stops talking so the driver can ask
  // a question out loud — the driving-safe form of the typed Q&A box. The
  // transcript feeds the exact same submitQuestion pipeline; nothing about
  // how questions are answered changes.
  const handleOrbPress = () => {
    if (isProcessingQuestion) {
      // The lock is visible here too: a press that does nothing reads
      // as a broken button (the field test's silent-drop lesson), so
      // say why, once, in plain language.
      setShareToast("Leo's finishing your last answer — one moment");
      setTimeout(() => setShareToast(null), 3000);
      return;
    }
    if (!speech.isSupported || speech.isListening) return;
    if (!geolocation.position) {
      setShareToast('Leo needs your location to answer — check location is enabled');
      setTimeout(() => setShareToast(null), 3500);
      return;
    }
    // Stop Leo first: he must not talk over the question, and the mic must
    // not transcribe his own voice coming through the car speakers.
    if (voice.isPlayingStory()) {
      voice.skipCurrent();
    }
    pttHoldRef.current = true;
    speech.startListening();
  };

  // Press-and-hold is the interaction: finger down, Leo listens; finger
  // up, he stops and the utterance submits. A quick tap still works —
  // the mic simply runs until the pause, as before.
  const pressStartRef = useRef<number>(0);
  const handleLeoPressStart = () => {
    pressStartRef.current = Date.now();
    handleOrbPress();
  };
  const handleLeoPressEnd = () => {
    if (speech.isListening) {
      speech.stopListening();
      return;
    }
    if (!isProcessingQuestion && Date.now() - pressStartRef.current < 400) {
      setShareToast('Press and hold Leo while you talk — release to send');
      setTimeout(() => setShareToast(null), 3500);
    }
  };

  // Mic failures used to reset silently, which reads as "the button is
  // broken". Say what happened and what to do about it instead.
  const { error: speechError, clearError: clearSpeechError } = speech;
  useEffect(() => {
    if (!speechError) return;
    const msg =
      speechError === 'not-allowed' || speechError === 'service-not-allowed'
        ? "Leo can't use the microphone. Allow mic access for this site in Safari — and if you're on the home-screen icon, try Leo in the Safari app, where iOS allows the mic."
        : speechError === 'no-speech'
          ? "Leo didn't hear anything — hold him down, speak, then release."
          : speechError === 'audio-capture'
            ? 'No microphone is available for Leo to hear you.'
            : 'Microphone hiccup — try holding Leo again.';
    setShareToast(msg);
    setTimeout(() => setShareToast(null), 6000);
    pttHoldRef.current = false;
    clearSpeechError();
  }, [speechError, clearSpeechError]);

  // A finished utterance becomes a submitted question.
  useEffect(() => {
    if (!speech.transcript) return;
    const question = speech.transcript;
    speech.clearTranscript();
    if (!submitQuestion(question)) {
      pttHoldRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.transcript]);

  // If listening ends with nothing heard (silence, error, accidental tap),
  // release the hold so the tour resumes instead of waiting forever.
  const prevListeningRef = useRef<boolean>(false);
  useEffect(() => {
    if (prevListeningRef.current && !speech.isListening && !speech.transcript && !isProcessingQuestion) {
      pttHoldRef.current = false;
    }
    prevListeningRef.current = speech.isListening;
  }, [speech.isListening, speech.transcript, isProcessingQuestion]);

  // Diagnostics-only full reset of Leo's memory of this listener: angle
  // coverage wiped locally, heard set cleared, and the anonymous device
  // key rotated so the server-side heard history no longer applies.
  // Two-tap arming instead of a modal — it lives behind the diagnostics
  // toggle, and the second tap is confirmation enough there.
  const handleResetStoryMemory = () => {
    if (!resetArmed) {
      setResetArmed(true);
      setTimeout(() => setResetArmed(false), 3000);
      return;
    }
    storyCoverage.resetAll();
    heardStories.reset();
    rotateUserKey();
    void heardStories.hydrate();
    setResetArmed(false);
    setShareToast('Story memory cleared — Leo will treat every place as new');
    setTimeout(() => setShareToast(null), 3500);
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
    speech.stopListening();
    pttHoldRef.current = false;
    // Retire any in-flight answer cycle BEFORE stopping the player:
    // the stop settles the answer item, and its callback must find the
    // cycle already gone rather than queueing a bridge into a dead tour.
    answerCycleRef.current++;
    releaseQuestionLock();
    voice.muteForMinutes(0);
    voice.stop();
    geolocation.stopTracking();
    localStorage.removeItem(RESUME_SESSION_KEY);
    setResumableSession(null);
    // Ask for the home screen once, at the moment of proven value: a tour
    // that heard at least one story and ended. Never twice, never if
    // already installed — an icon is what turns a link click into a
    // second drive.
    if (storiesCount > 0 && !isInstalled) {
      try {
        if (!localStorage.getItem('leo_install_nudge_seen')) {
          localStorage.setItem('leo_install_nudge_seen', '1');
          setNativeReady(canNativeInstall());
          setShowInstallNudge(true);
        }
      } catch {
        // Storage unavailable (private mode) — skip the nudge silently.
      }
    }
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
        // Arm the answer cycle BEFORE speaking, with the failsafe as
        // backstop. What happens next is decided by the tracked
        // playback callbacks below — not by watching the queue move.
        answerPhaseRef.current = 'awaiting-answer';
        if (answerFailsafeRef.current) window.clearTimeout(answerFailsafeRef.current);
        answerFailsafeRef.current = window.setTimeout(() => releaseQuestionLock(), 120_000);
        const cycle = ++answerCycleRef.current;
        voice.speakTracked(fullAnswer, {
          onPlaybackEnd: (sounded: boolean) => {
            // Stale cycle (a newer question, a tour end) or an already
            // settled phase (failsafe beat us): nothing to do.
            if (cycle !== answerCycleRef.current) return;
            if (answerPhaseRef.current !== 'awaiting-answer') return;
            if (sounded) {
              // The answer genuinely aired and has now ended. Only
              // NOW queue the bridge back into the tour, and kick the
              // next story fetch so the gap is minimal. The lock
              // releases when the next line (bridge or story) goes on
              // air — the answer has fully played AND the tour has
              // resumed, per the serialization rule.
              answerPhaseRef.current = 'awaiting-resume';
              const pos = geolocation.position;
              if (pos) {
                voice.queueStory("Alright, let's get back to it.", undefined, undefined, undefined, 'scripted');
                lastFetchTimeRef.current = Date.now();
                handleIntervalUpdate(pos);
              } else {
                releaseQuestionLock();
              }
            } else {
              // The answer never sounded — both engines failed under
              // it. Say so honestly, out loud, and release cleanly;
              // never bridge over a hole and call it an answer.
              answerPhaseRef.current = null;
              voice.speak("Sorry — that answer didn't come through. Ask me again.");
              releaseQuestionLock();
            }
          },
        });
      }
    } catch (error) {
      console.error('Error answering question:', error);
      if (token === geminiService.currentRequestToken()) {
        voice.speak("Sorry, couldn't process that. Try asking again.");
      }
    } finally {
      // Paths that never armed a cycle (stale token, empty answer,
      // generation error) end here. An armed cycle deliberately keeps
      // the lock past this point — it ends in the tracked playback
      // callback when the answer's fate is known, or at the failsafe.
      if (answerPhaseRef.current === null) {
        releaseQuestionLock();
      }
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
  // A truly major landmark detected nearby. Its story — when it is the
  // story that comes back — goes to the front of the waiting queue. The
  // ref survives one fetch cycle in case an unrelated cached story is
  // served first; it expires quickly so a landmark left behind cannot
  // hijack the queue later.
  const queueJumpLandmarkRef = useRef<{ name: string; detectedAt: number } | null>(null);

  const handleIntervalUpdate = useCallback(async (position: Position | null) => {
    if (!position || !isTourStartedRef.current) {
      console.log('[Tour] Skipping story - position:', position, 'isTourStarted:', isTourStartedRef.current);
      return;
    }

    console.log('[Tour] Getting story for position:', position);
    setPipelineStatus('fetching landmarks');
    // This fetch's start, held LOCALLY until its own result lands —
    // the timing pair is only ever written whole (see fetchCycleRef).
    const fetchStartAt = Date.now();
    isFetchingStoryRef.current = true;

    // Major-landmark queue priority: if a truly important landmark is close
    // by and unheard, its story belongs at the front of the waiting queue.
    // The story currently playing is NEVER cut off — it finishes, and the
    // major landmark is simply next. Only the strict Tier 1 test qualifies;
    // ordinary landmarks wait their normal turn.
    let queueJumpTargetName: string | null = null;
    try {
      const nearby = await placesService.getNearbyLandmarks(position, 150);
      const tier1 = nearby.find(p =>
        placesService.isTier1Landmark(p) &&
        p.distance <= 150 &&
        !heardStories.hasHeardSubject(p.name)
      );
      if (tier1) {
        const currentTopic = voice.getCurrentStoryTopic();
        const currentBase = currentTopic?.split(' — ')[0].trim().toLowerCase();
        if (currentBase !== tier1.name.toLowerCase()) {
          queueJumpTargetName = tier1.name;
          queueJumpLandmarkRef.current = { name: tier1.name, detectedAt: Date.now() };
          console.log(`[Tour] Major landmark nearby: "${tier1.name}" — its story will go to the front of the queue (current story finishes first)`);
        }
      } else if (
        queueJumpLandmarkRef.current &&
        Date.now() - queueJumpLandmarkRef.current.detectedAt < 120_000
      ) {
        queueJumpTargetName = queueJumpLandmarkRef.current.name;
      } else {
        queueJumpLandmarkRef.current = null;
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
        fetchCycleRef.current = { startAt: fetchStartAt, readyAt: Date.now() };
        isFetchingStoryRef.current = false;
        setStoriesCount(prev => prev + 1);
        setLastStorySource(result.fromLibrary ? 'library' : result.fromCache ? 'cache' : 'live');
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

        if (pttHoldRef.current) {
          // A push-to-talk question owns the audio right now. The fetched
          // story is dropped, not queued — the next cycle refetches, and
          // the shared caches make that cheap.
          console.log('[Tour] Story fetched but not queued — push-to-talk question in progress');
        } else {
          console.log(`[Tour] Story from ${result.fromLibrary ? 'LIBRARY' : result.fromCache ? 'CACHE' : 'LIVE'}, length: ${result.story.length}, queueing`);

          analytics.track('story_played', position, position.speed !== null && position.speed >= 6.0 ? 'driving' : 'walking', {
            source: result.fromLibrary ? 'library' : result.fromCache ? 'cache' : 'live',
            topic: result.topic,
          });

          // Gemini now writes its own transition into the opening of each
          // story, so we queue directly — no app-side filler needed.
          const isRoad = position.speed !== null && position.speed >= 6.0;
          // Library stories anchor at the place itself (the freshness gates
          // measure against the entry's coordinates); every other source
          // anchors at the fetch position, exactly as before.
          const originLat = result.anchorLat ?? position.lat;
          const originLng = result.anchorLng ?? position.lng;
          const resultBase = (result.subject || result.topic).split(' — ')[0].trim().toLowerCase();
          const isQueueJump =
            queueJumpTargetName !== null &&
            resultBase === queueJumpTargetName.toLowerCase();
          if (isQueueJump) {
            // Front of the waiting queue — behind nothing but any scripted
            // line already in flight, and always after the current story.
            voice.queuePriorityStory(result.story, originLat, originLng, isRoad, result.subject, result.audioUrl);
            flashPose('pointing', 5000);
            queueJumpLandmarkRef.current = null;
            console.log(`[Tour] Major-landmark story queued at the front: "${result.subject}"`);
          } else {
            voice.queueStory(result.story, originLat, originLng, isRoad, undefined, result.subject, result.audioUrl);
          }
        }

        // Trigger prefetch in the background so the next story is ready.
        storyCache.prefetchForPosition(position, position.speed !== null && position.speed >= 6.0 ? 'driving' : 'walking').catch(() => {});
      } else if (!isOnlineRef.current) {
        setPipelineStatus('offline, no cache');
        isFetchingStoryRef.current = false;
        console.log('[Tour] Offline - no cached story available, queued position');
      } else {
        isFetchingStoryRef.current = false;
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
      isFetchingStoryRef.current = false;
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
      const speechEndNow = Date.now();
      lastSpeechEndRef.current = speechEndNow;

      // Merge this story's timings: fetch + text (recorded here) with synth +
      // onplaying + playbackEnd (recorded in useVoice). Log one line and set
      // the diagnostics display string.
      const voiceTiming: StoryTiming = voice.getStoryTiming();
      const fetchTextS = fetchCycleRef.current
        ? ((fetchCycleRef.current.readyAt - fetchCycleRef.current.startAt) / 1000).toFixed(1)
        : null;
      const synthS = voiceTiming.synthRequestAt && voiceTiming.synthResolvedAt
        ? ((voiceTiming.synthResolvedAt - voiceTiming.synthRequestAt) / 1000).toFixed(1)
        : null;
      const cacheHit = voiceTiming.synthCacheHit;
      // True silence: this story's first audio frame minus the previous story's
      // last audio frame. Not speech-end to speech-end (that includes story
      // duration, making the gap look huge for long stories).
      const gapS = (prevStoryTimingEndRef.current && voiceTiming.onPlayingAt)
        ? ((voiceTiming.onPlayingAt - prevStoryTimingEndRef.current) / 1000).toFixed(1)
        : null;

      if (fetchTextS || synthS) {
        const timingStr = `Fetch+Text: ${fetchTextS ?? '-'}s · Synth: ${synthS ?? '-'}s (cache: ${cacheHit === true ? 'Y' : cacheHit === false ? 'N' : '-'}) · Gap: ${gapS ?? '-'}s`;
        setLastStoryTiming(timingStr);
        console.log(`[Timing] fetchText=${fetchTextS ?? '-'}s synth=${synthS ?? '-'}s cacheHit=${cacheHit === true ? 'Y' : cacheHit === false ? 'N' : '-'} gap=${gapS ?? '-'}s`);
      }
      // Persist the timing, not just display it: latency and silence are
      // the product's vital signs, and console logs die with the session.
      // After real drives, these rows answer "how long was the quiet,
      // really?" across every story, not just the last one.
      if (fetchTextS || synthS || gapS) {
        analytics.track('story_timing', pos, pos.speed !== null && pos.speed >= 6.0 ? 'driving' : 'walking', {
          fetchTextS: fetchTextS ? parseFloat(fetchTextS) : null,
          synthS: synthS ? parseFloat(synthS) : null,
          cacheHit,
          gapS: gapS ? parseFloat(gapS) : null,
          model: LEO_MODEL_ID,
        });
      }
      prevStoryTimingEndRef.current = voiceTiming.playbackEndAt ?? speechEndNow;
      fetchCycleRef.current = null;

      // Standing still for a while earns a deeper dive: shorter silence, and
      // Leo told to go long. This is the reward for stopping to actually look.
      locationTracker.noteDwell(pos);
      const dwellLevel = locationTracker.getDwellDepthLevel();
      if (dwellLevel !== null) {
        console.log(`[Dwell] Settled for ${locationTracker.getDwellMinutes()} min — deep cut`);
      }

      // API guard: don't hammer the API if the last fetch was under 3 seconds
      // ago. Pacing between stories is handled by the gap timer in useVoice;
      // this only prevents a tight retry loop from spamming Gemini.
      const now = Date.now();
      const cooldownMs = 3000;
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

  // First-90-seconds guarantee, part 1: warm the story cache while the
  // listener is still on the landing page. The seconds spent reading the
  // landing page become generation time, so the first fetch after START
  // is a cache hit or a fast live call instead of a cold pipeline. The
  // prefetch guards (buffer level, min interval, 50m movement) keep this
  // from ever generating more than the tour itself would. Coverage is
  // recorded at play time, so warming never burns an unheard story.
  const landingWarmupAtRef = useRef<number>(0);
  useEffect(() => {
    if (isTourStarted || !geolocation.position || !isOnline) return;
    if (Date.now() - landingWarmupAtRef.current < 60_000) return;
    landingWarmupAtRef.current = Date.now();
    storyCache.prefetchForPosition(geolocation.position, geolocation.movementMode).catch(() => {});
  }, [isTourStarted, geolocation.position, geolocation.movementMode, isOnline]);

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
    }, 15000);

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
          // are not subject to the live freshness gate. The session lockout
          // still applies WITHIN the batch: two buffered angles of the same
          // place must not both replay back to back, and a place told
          // earlier this session stays told. Each queued landmark locks
          // its subject as it goes (moving only — parked catch-up keeps
          // the dwell rotation freedom).
          const speed = geolocation.position?.speed ?? null;
          const moving = !(speed !== null && speed < 1.0);
          let queuedCount = 0;
          for (const story of unplayed) {
            story.played = true;
            const subjectKey = story.rotation?.subjectKey
              ?? landmarkSubjectKey(story.topic.split(' — ')[0].trim());
            if (moving && subjectKey.startsWith('landmark:')) {
              if (storyCoverage.isSubjectLockedForSession(subjectKey)) continue;
              storyCoverage.lockSubjectForSession(subjectKey);
              // Counted here (all angles): catch-up plays bypass the
              // recordRotationStory funnel other rotation plays use.
              storyCoverage.recordDailyTelling(subjectKey);
            }
            voice.queueStory(story.text);
            queuedCount++;
          }
          storyCache.refreshPendingSubjects();

          setStoriesCount(prev => prev + queuedCount);
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
    voice.setOnStoryStart((topic: string | null) => {
      // Answer-cycle bookkeeping: the lock releases when the first
      // line AFTER a confirmed answer goes on air — the bridge line or
      // a resumed story. Starts while the phase is 'awaiting-answer'
      // (the answer item itself dequeuing, or anything else) prove
      // nothing about the answer and are ignored; confirmation comes
      // from the tracked playback callback in handleUserQuestion.
      if (answerPhaseRef.current === 'awaiting-resume') {
        releaseQuestionLock();
      }
      setHasLikedStory(false);

      // When a location story starts playing, fetch the next story's text
      // during playback so generation overlaps with audio — the listener
      // never hears the fetch latency as silence. The story-complete handler
      // stays as fallback if the queue is still empty when this story ends.
      // Scripted lines (topic === null) are exempt.
      if (topic !== null && isTourStartedRef.current && isOnlineRef.current) {
        if (voice.getQueueLength() === 0 && !isFetchingStoryRef.current) {
          const pos = positionRef.current;
          if (pos) {
            console.log('[Tour] Pre-fetching next story during playback');
            lastFetchTimeRef.current = Date.now();
            handleIntervalUpdate(pos);
          }
        }
      }
    });
  }, [voice, handleIntervalUpdate]);

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
      // Prime the audio element FIRST, synchronously inside this tap.
      // iOS Safari's user-activation window is short, and everything
      // below (init, voice loading, the ensureVoiceReady await) can
      // burn it — a prime that lands after the window closes leaves
      // every story's play() blocked for the whole tour.
      voice.unlock();
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
      }
      storyCache.armOpener();
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
        <div className="flex-1 relative overflow-hidden">
          {/* The scene (sky, grid, beach, glows) is glued to this frame and
              never scrolls. The content lives in its own scroll layer on
              top: when the column is taller than the viewport it scrolls
              WITHIN the scene instead of pushing the caption/disclaimer
              below the beach graphic, as the previous single scroll
              container did (absolute children anchor to the scroll
              origin, so the beach stayed a screenful up while the text
              flowed past it). */}
          <div className="absolute inset-0" style={{ background: skyGradient }} />
          <div className="absolute inset-0 leo-grid" />
          <SdBeach className="absolute bottom-0 left-0 w-full h-28 sm:h-36 text-slate-950/60 pointer-events-none" />
          <div className="absolute top-[15%] left-[10%] w-[28rem] h-[28rem] bg-amber-600 rounded-full opacity-[0.06] blur-[120px] leo-float" />
          <div className="absolute bottom-[10%] right-[8%] w-[24rem] h-[24rem] bg-cyan-500 rounded-full opacity-[0.05] blur-[120px] leo-float-slow" />
          <div className="absolute top-[50%] left-[55%] w-[20rem] h-[20rem] bg-amber-400 rounded-full opacity-[0.03] blur-[100px] leo-float" />

          <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
            <div className="relative z-10 min-h-full flex flex-col items-center justify-center text-center px-6 py-4 sm:py-8">
            <div className="mb-1 flex justify-center">
              {/* Leo himself, full body, standing in the screen and waving
                  hello — a still portrait, deliberately unanimated. His
                  face is also the home-screen icon. Rendering the figure
                  here quietly preloads his tour poses, so when the tour
                  starts his speaking/listening/thinking swaps are instant.
                  The wrapper is min-h-full flex centering inside a
                  scrollable zone: when the column is taller than the
                  viewport it scrolls from the top instead of the old
                  overflow-hidden clip that ate Leo's head. */}
              <LeoFigure pose="wave" className="h-44 sm:h-72" />
            </div>
            <h1 className="text-4xl sm:text-6xl font-bold mb-2 sm:mb-3 tracking-tight leo-shimmer-amber bg-gradient-to-r from-amber-200 via-white to-amber-300 bg-clip-text text-transparent" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
              LEO'S WORLD
            </h1>
            <p className="text-base sm:text-lg mb-6 sm:mb-10 text-slate-400 font-light tracking-wide">
              Your AI guide for the road
            </p>
            {!SUPABASE_CONFIGURED && !backendBannerDismissed && (
              <div className="mb-6 bg-amber-950/80 border border-amber-800/70 rounded-xl px-4 py-3 flex items-start gap-3 max-w-md mx-auto">
                <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 text-left">
                  <p className="text-xs font-semibold text-amber-300">Backend not configured in this environment</p>
                  <p className="text-[11px] text-amber-500/80 mt-0.5">Stories will be unavailable. Check Supabase environment variables.</p>
                </div>
                <button
                  onClick={() => setBackendBannerDismissed(true)}
                  className="p-1 rounded-lg text-amber-500/60 hover:text-amber-400 transition-colors shrink-0"
                >
                  <XCircle size={16} />
                </button>
              </div>
            )}
            <button
              onClick={() => handleStartTour(false)}
              className="px-10 py-3.5 bg-gradient-to-r from-amber-600 to-amber-500 rounded-xl text-lg font-semibold text-white hover:from-amber-500 hover:to-amber-400 transition-all transform hover:scale-105 active:scale-95 shadow-xl shadow-amber-900/40"
            >
              <Play className="inline-block mr-2" size={20} />
              START TOUR
            </button>
            <p className="mt-4 sm:mt-6 text-sm text-slate-400 tracking-wide">
              Enables voice, location, and AI features
            </p>
            <p className="mt-2 text-xs text-slate-300 max-w-sm mx-auto leading-relaxed">
              Leo is an informational audio guide. Always keep your eyes on the road and stay aware of your surroundings.
            </p>
            <div className="mt-5 sm:mt-8 flex items-center gap-3 justify-center">
              <button
                onClick={() => handleShare()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/60 border border-slate-700/60 text-slate-300 hover:bg-slate-700 transition-all active:scale-95 text-sm font-medium shadow-md backdrop-blur-sm"
              >
                <Share2 size={16} />
                Share Leo's World
              </button>
            </div>
            {!isInstalled && showInstallNudge && (
              <div className="mt-5 max-w-sm mx-auto w-full bg-slate-800/70 border border-amber-800/40 rounded-2xl px-4 py-3.5 text-left shadow-xl backdrop-blur-sm relative">
                <button
                  onClick={() => setShowInstallNudge(false)}
                  aria-label="Dismiss"
                  className="absolute top-2.5 right-2.5 p-1 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <XCircle size={16} />
                </button>
                <p className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Smartphone size={15} className="text-amber-400" />
                  Put Leo on your home screen
                </p>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  One tap to start your next drive — no app store needed.
                </p>
                <div className="mt-2.5">
                  <InstallHelp platform={installPlatform} nativeReady={nativeReady} onNativeInstall={handleNativeInstall} />
                </div>
              </div>
            )}
            {!isInstalled && (
              <div className="mt-4">
                <button
                  onClick={() => { setInstallTipOpen(!installTipOpen); setNativeReady(canNativeInstall()); }}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-300 transition-colors underline decoration-slate-600 underline-offset-4"
                >
                  <Smartphone size={13} />
                  Add Leo to your home screen
                </button>
                {installTipOpen && (
                  <div className="mt-2.5 max-w-sm mx-auto text-left bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3">
                    <InstallHelp platform={installPlatform} nativeReady={nativeReady} onNativeInstall={handleNativeInstall} />
                  </div>
                )}
              </div>
            )}
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
          <div className="flex-1 relative flex items-center justify-center overflow-hidden px-3 sm:px-5" style={{ background: skyGradient }}>
            <div className="absolute inset-0 leo-grid opacity-50" />
            <SdBeach className="absolute bottom-0 left-0 w-full h-24 sm:h-28 text-slate-950/50 pointer-events-none" />
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
                  {lastStoryTiming && (
                    <p className="text-amber-400 text-[9px] mt-1 leading-tight">{lastStoryTiming}</p>
                  )}
                  {geolocation.position && (
                    <p className="text-slate-500">
                      Angles covered: {storyCoverage.getTotalAnglesCovered()} across {storyCoverage.getSubjectCount()} subjects
                    </p>
                  )}
                  <p className="text-slate-500">Taste tags: {tasteProfile.getTagCount()}</p>
                  <button
                    onClick={handleResetStoryMemory}
                    className={`mt-2 w-full px-2 py-1.5 rounded-lg border text-[10px] font-semibold tracking-wide transition-colors ${
                      resetArmed
                        ? 'bg-red-950/80 border-red-700 text-red-300'
                        : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {resetArmed ? 'TAP AGAIN TO CONFIRM RESET' : 'RESET STORY MEMORY'}
                  </button>
                </div>
              </div>
            )}

            <div className="max-w-3xl w-full relative z-10 text-center">
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
                    {voice.audioBlockedKind === 'blocked'
                      ? 'Sound is blocked — tap to turn it on.'
                      : "Leo's voice hit a snag — tap to retry."}
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
                    Audio paused — tap to continue.
                  </span>
                </button>
              )}

              {isOnline && cacheCount > 0 && (
                <div className="flex items-center gap-1.5 justify-center mb-4 text-emerald-500">
                  <Download size={12} className={prefetching ? 'animate-bounce' : ''} />
                  <span className="text-[11px] font-medium">{cacheCount} stories ready offline</span>
                </div>
              )}

              {/* Distraction-free by design: no story text on screen. Leo's
                  pose and the orb carry the state so the listener never has
                  to read. */}
              {/* Leo stands beside the microphone, basically full length —
                  a row, not a stack, so his head can never slide under the
                  header ribbon and the like/share row can never slide
                  under the bottom dock, on phone or desktop alike. */}
              <div className="flex flex-row items-center justify-center gap-2 sm:gap-6 w-full">
                {/* Leo IS the button now. Tapping the orb was an abstraction;
                    tapping Leo is a shoulder-tap — he stops, leans in, and
                    listens. The mic badge on his hip teaches the tap once;
                    his pose and the label carry the state from there. */}
                <button
                  type="button"
                  onPointerDown={(e) => { e.preventDefault(); handleLeoPressStart(); }}
                  onPointerUp={handleLeoPressEnd}
                  onPointerCancel={handleLeoPressEnd}
                  onPointerLeave={handleLeoPressEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  onKeyDown={(e) => { if (!e.repeat && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); handleLeoPressStart(); } }}
                  onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleLeoPressEnd(); } }}
                  aria-label="Hold Leo to ask him a question by voice"
                  className="relative shrink-0 rounded-[2rem] transition-transform duration-200 active:scale-[0.98] focus:outline-none touch-none select-none [-webkit-touch-callout:none]"
                >
                  <div className={`absolute inset-x-6 top-6 bottom-10 rounded-full blur-3xl transition-colors duration-700 ${leoStatus.glow}`} />
                  <LeoFigure pose={poseFlash ?? leoStatus.pose} className="relative h-[44vh] sm:h-[56vh] min-h-[240px] max-h-[540px]" />
                  <span className={`absolute bottom-[7%] right-[1%] flex items-center justify-center w-11 h-11 rounded-full border border-white/25 shadow-xl text-white transition-colors duration-500 ${
                    leoStatus.pose === 'listening' ? 'bg-rose-500' : leoStatus.pose === 'speaking' ? 'bg-blue-500' : 'bg-amber-500'
                  }`}>
                    <Mic size={20} />
                  </span>
                </button>
                <div className="flex flex-col items-center min-w-0">
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

                <p className={`text-sm font-bold tracking-[0.22em] transition-colors duration-500 ${leoStatus.text}`}>
                  {leoStatus.label}
                </p>

                {speech.isSupported && !speech.isListening && (
                  <p className="mt-2.5 text-sm tracking-wide text-slate-400">
                    Hold Leo to ask him a question
                  </p>
                )}

                <div className="mt-4 flex flex-wrap justify-center items-center gap-3">
                  <button
                    onClick={() => {
                      if (hasLikedStory || likeAnimating) return;
                      setHasLikedStory(true);
                      setLikeAnimating(true);
                      flashPose('liked', 2000);
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
