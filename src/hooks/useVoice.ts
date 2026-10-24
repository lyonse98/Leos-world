import { useState, useCallback, useRef, useEffect } from 'react';
import {
  calculateDistance,
  resolveMovementMode,
  MovementModeHysteresis,
} from '../utils/geo';
import { tasteProfile } from '../services/tasteProfile';
import { geminiAudio } from '../services/geminiAudio';

interface StoryQueueItem {
  text: string;
  transitionText?: string;
  lat?: number;
  lng?: number;
  // When and in what mode this story was generated. Used by the freshness
  // gate so a story written for a spot the listener has left never plays.
  generatedAt: number;
  // Rural/highway stories are anchored to the region, not a point, so the
  // behind-you check does not apply to them.
  regionAnchored?: boolean;
  // Location stories compete for the single waiting slot; scripted lines do not.
  isLocationStory: boolean;
  // The landmark or subject the story is about, when it has one. Carried so a
  // rating taken while the story plays can be filed against the right subject.
  topic?: string;
  // A story about a truly major landmark. Priority changes the waiting
  // order only — it never interrupts the story currently playing.
  priority?: boolean;
}

interface CurrentPosition {
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
}

export interface StoryTiming {
  synthRequestAt: number | null;
  synthResolvedAt: number | null;
  synthCacheHit: boolean | null;
  onPlayingAt: number | null;
  playbackEndAt: number | null;
}

// Preference order for Leo's speaking voice. Resolved in one place so every
// playback path agrees on who Leo sounds like.
const PREFERRED_VOICE_NAMES = [
  'Google US English',
  'Google UK English Male',
  'Alex',
  'Daniel',
  'Aaron',
  'Oliver',
  'Arthur',
  'Tom',
  'Reed',
  'Rocko',
  'Jorge',
];

function selectPreferredVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) return undefined;

  for (const name of PREFERRED_VOICE_NAMES) {
    const match = voices.find(v => v.name.includes(name));
    if (match) return match;
  }

  return (
    voices.find(v => v.name.includes('Male')) ??
    voices.find(v => v.name.toLowerCase().includes('male')) ??
    voices.find(v => v.lang.startsWith('en')) ??
    voices[0]
  );
}

  // One waiting slot is reserved for the freshest location story, so a newer
  // story replaces a stale one instead of stacking up. Scripted lines (intros,
  // fillers, ads, catch-up) always append — they are deliberate and short.
  const MAX_PENDING_LOCATION_STORIES = 1;

// A buffered story that has outlived its moment by this much is dropped
// rather than narrated about a place the listener has long since passed.
const MAX_AGE_DRIVING_MS = 180_000;
const MAX_AGE_WALKING_MS = 180_000;

// How far a story may be from the listener and still be worth playing.
// Driving reach is generous — with absolute framing, a story about a landmark
// the listener has passed is still worth hearing.
const REACH_DRIVING_M = 2000;
const REACH_WALKING_M = 100;
const REACH_STATIONARY_M = 30;

// Deliberate silence between stories, by movement mode. The gap is measured
// from the previous story's last audio frame to the next story's first. Too
// short and Leo feels manic; too long and the listener thinks the tour died.
const GAP_AFTER_SPEECH_MS: Record<'driving' | 'walking' | 'stationary', number> = {
  driving: 8000,
  walking: 4000,
  stationary: 3000,
};

export const useVoice = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  const streamBufferRef = useRef<string>('');
  const sentenceQueueRef = useRef<string[]>([]);
  const isProcessingQueueRef = useRef<boolean>(false);

  // Story queue: stories wait their turn instead of interrupting
  const storyQueueRef = useRef<StoryQueueItem[]>([]);
  const isPlayingStoryRef = useRef<boolean>(false);
  const onStoryCompleteRef = useRef<(() => void) | null>(null);
  const watchdogRef = useRef<number | null>(null);
  // Last moment playback demonstrably advanced — an audio timeupdate, an
  // onplaying event, or a speech boundary. The watchdog trusts progress,
  // never status flags: in a car (Bluetooth, locked screen, throttled
  // timers) paused/speaking flags can read "not playing" while sound is
  // coming out, and the old flag-based watchdog executed healthy stories.
  const lastProgressAtRef = useRef<number>(0);
  const lastAudioTimeRef = useRef<number>(-1);
  const mutedUntilRef = useRef<number>(0);
  const recentSpokenRef = useRef<string[]>([]);
  // What is on air right now. A rating needs to know which story it refers to
  // and how long it had been playing, and the queue no longer holds it once
  // playback has started.
  const currentSpokenRef = useRef<{ topic: string; text: string; startedAt: number } | null>(null);
  const currentPositionProviderRef = useRef<(() => CurrentPosition | null) | null>(null);
  const lastKnownModeRef = useRef<MovementModeHysteresis>('stationary');
  // Audio is only permitted after a real user gesture. This records that the
  // engine has been woken once, so we do not waste the gesture.
  const unlockedRef = useRef<boolean>(false);
  const audioBlockedRef = useRef<boolean>(false);
  // Increments every time playback ownership changes (new story, skip, mute).
  // Callbacks from a story that no longer owns the queue check this and bail,
  // so a cancelled story can never advance the queue out from under a newer one.
  const playGenRef = useRef<number>(0);
  // Tracks the text currently being pre-synthesized so we don't kick off
  // duplicate TTS calls for the same story.
  const preSynthTextRef = useRef<string | null>(null);
  // True only while audio is actually coming out of the speaker — set in
  // onplaying/onstart, cleared on end/error/stop. Gates pre-synthesis so we
  // don't warm the TTS cache while the engine is still loading or blocked.
  const playbackStartedRef = useRef<boolean>(false);
  // Per-story timing — set during playback, read by the app for diagnostics.
  const storyTimingRef = useRef<StoryTiming>({
    synthRequestAt: null,
    synthResolvedAt: null,
    synthCacheHit: null,
    onPlayingAt: null,
    playbackEndAt: null,
  });
  // When the previous story's audio ended — the anchor for the deliberate
  // gap. Survives the per-story storyTimingRef reset so the next story can
  // measure silence from it.
  const lastPlaybackEndRef = useRef<number | null>(null);
  // Active gap-deferral timer, cleared on stop/skip so a cancelled wait never
  // fires into a queue it no longer owns.
  const gapTimerRef = useRef<number | null>(null);
  const [audioBlocked, setAudioBlocked] = useState<boolean>(false);
  // Set when the listener returns to a tour whose audio the platform paused.
  // Surfaces as "tap to resume" instead of leaving them in unexplained silence.
  const [wasInterrupted, setWasInterrupted] = useState<boolean>(false);
  // Tracks whether Gemini TTS is active or why it fell back, surfaced in
  // diagnostics so the reason for browser voice is visible.
  const [ttsStatus, setTtsStatus] = useState<string>('idle');
  const backgroundedRef = useRef<boolean>(false);
  // A line requested before the first gesture is held here and spoken the
  // instant the listener taps, since that tap is what permits sound.
  const pendingSpeechRef = useRef<string | null>(null);
  const speakRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
    }
    audioElRef.current = new Audio();
    audioElRef.current.addEventListener('ended', () => {
      if (ttsUrlRef.current) {
        URL.revokeObjectURL(ttsUrlRef.current);
        ttsUrlRef.current = null;
      }
    });
    return () => {
      if (ttsUrlRef.current) {
        URL.revokeObjectURL(ttsUrlRef.current);
        ttsUrlRef.current = null;
      }
      audioElRef.current = null;
    };
  }, []);

  // Wake both speech engines from inside a user gesture. iOS Safari and
  // several Android builds silently block audio that wasn't primed by a tap:
  // SpeechSynthesis hands back a paused engine, and HTMLAudioElement refuses
  // to play at all. A single silent prime on the audio element satisfies the
  // autoplay policy so Gemini TTS can use it later without being blocked.
  const unlock = useCallback(() => {
    // Resume the speech synth in case the platform paused it while
    // backgrounded — needed on every call, latched or not.
    const synth = synthRef.current;
    if (synth) {
      try { synth.resume(); } catch { /* engine missing */ }
    }

    // Prime the HTMLAudioElement inside this gesture so Safari/DuckDuckGo
    // allow future programmatic plays for Gemini TTS audio. This runs on
    // EVERY unlock call, not just the first. The old latch made the
    // "your browser muted Leo" banner a dead end: the first prime could
    // miss the tap's activation window (one await before it is enough),
    // the latch set anyway, every later banner tap early-returned
    // without re-priming, and each queued story's play() rejected in
    // turn — the banner flashing off as a story was attempted and back
    // on as it was blocked and dropped. Now the latch is set only when
    // a prime actually succeeds, and a banner tap genuinely re-primes.
    const audio = audioElRef.current;
    if (audio) {
      audio.muted = true;
      audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        audio.removeAttribute('src');
        unlockedRef.current = true;
      }).catch(() => {
        audio.muted = false;
        audio.removeAttribute('src');
        unlockedRef.current = false;
      });
    }

    const pending = pendingSpeechRef.current;
    if (pending) {
      pendingSpeechRef.current = null;
      speakRef.current(pending);
    }
  }, []);

  const initializeVoice = useCallback(() => {
    if (!synthRef.current) return false;

    const loadVoices = () => {
      const selected = selectPreferredVoice(synthRef.current!.getVoices());
      if (!selected) return;

      voiceRef.current = selected;
      setIsInitialized(true);
    };

    loadVoices();

    if (synthRef.current.getVoices().length === 0) {
      synthRef.current.addEventListener('voiceschanged', loadVoices);
    }

    // Voice selection itself must never be the reason a tour fails to start:
    // report ready now and let ensureVoiceReady resolve the voice before the
    // opening line, with a bounded wait.
    setIsInitialized(true);
    return true;
  }, []);

  const pickVoice = () => {
    if (voiceRef.current) return;
    const selected = selectPreferredVoice(synthRef.current?.getVoices() ?? []);
    if (selected) voiceRef.current = selected;
  };

  // Resolve Leo's voice once, before the first word is spoken. Waiting on the
  // browser's voice list matters: the default voice is used until it arrives,
  // and if the first sentence goes out on the default, the listener hears a
  // stranger mid-sentence when the real voice loads. A short bounded wait is
  // worth it, but never block the tour on a browser that never populates it.
  const ensureVoiceReady = useCallback(async (): Promise<void> => {
    const synth = synthRef.current;
    if (!synth || voiceRef.current) return;

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const selected = selectPreferredVoice(synth.getVoices());
      if (selected) {
        voiceRef.current = selected;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('[Voice] Voice list never populated — using the browser default');
  }, []);

  // Hand an utterance to the engine and confirm it actually began. Browsers
  // will happily accept a request and then never start it — no error, no
  // event — which leaves the queue waiting forever for an onend that never
  // arrives. Nudge once, then report the blockage instead of hanging.
  const dispatchSpeech = useCallback((
    utterance: SpeechSynthesisUtterance,
    hasStarted: () => boolean,
    onBlocked?: () => void
  ) => {
    const synth = synthRef.current;
    if (!synth) return;

    const attempt = (mayRetry: boolean) => {
      synth.resume();
      synth.speak(utterance);

      window.setTimeout(() => {
        if (hasStarted()) return;
        if (mayRetry) {
          console.log('[Voice] Speech did not begin — retrying once');
          attempt(false);
          return;
        }
        console.warn('[Voice] Speech never began — audio appears to be blocked');
        audioBlockedRef.current = true;
        setAudioBlocked(true);
        onBlocked?.();
      }, 3000);
    };

    attempt(true);
  }, []);

  // Play a line that must finish before anything else is heard. Unlike a
  // queued story, this owns the queue: an arriving story waits its turn
  // instead of cutting the line off mid-sentence.
  const speakPriority = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    storyQueueRef.current.push({
      text: trimmed,
      generatedAt: Date.now(),
      isLocationStory: false,
    });

    if (!isPlayingStoryRef.current) {
      playStoryFromQueueRef.current();
    }
  }, []);

  const speak = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Before the first gesture nothing can be heard anyway, so hold the line
    // and let the unlock step speak it. Dropping it here would silently lose
    // whatever the app most wanted to say.
    if (!unlockedRef.current) {
      pendingSpeechRef.current = trimmed;
      return;
    }

    speakPriority(trimmed);
  }, [speakPriority]);

  speakRef.current = speak;

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    playGenRef.current += 1;
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    if (gapTimerRef.current !== null) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    setIsSpeaking(false);
    isProcessingQueueRef.current = false;
    streamBufferRef.current = '';
    sentenceQueueRef.current = [];
    storyQueueRef.current = [];
    isPlayingStoryRef.current = false;
    preSynthTextRef.current = null;
    playbackStartedRef.current = false;
    clearWatchdog();
  }, [clearWatchdog]);

  const processQueue = useCallback(() => {
    if (isProcessingQueueRef.current || sentenceQueueRef.current.length === 0) {
      return;
    }

    isProcessingQueueRef.current = true;
    const sentence = sentenceQueueRef.current.shift()!;

    if (!synthRef.current) {
      isProcessingQueueRef.current = false;
      return;
    }

    const utterance = new SpeechSynthesisUtterance(sentence);
    pickVoice();
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.pitch = 0.95;
    utterance.rate = 0.95;
    utterance.volume = 1.0;

    let started = false;
    utterance.onstart = () => {
      started = true;
      audioBlockedRef.current = false;
      setAudioBlocked(false);
      setIsSpeaking(true);
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      isProcessingQueueRef.current = false;
      processQueue();
    };
    utterance.onerror = (event) => {
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        console.error('Speech error:', event);
      }
      setIsSpeaking(false);
      isProcessingQueueRef.current = false;
      processQueue();
    };

    dispatchSpeech(utterance, () => started, () => {
      isProcessingQueueRef.current = false;
    });
  }, [dispatchSpeech]);

  const cleanTextForSpeech = (text: string): string => {
    return text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/\[/g, '')
      .replace(/\]/g, '')
      .replace(/\{/g, '')
      .replace(/\}/g, '')
      .replace(/#/g, '')
      .replace(/\\/g, '')
      .trim();
  };

  // Watchdog: detects a genuinely stuck player — playback position frozen
  // for 8s while a story is "playing". Progress is the only evidence: the
  // audio element's currentTime advancing, engine events firing, or the
  // browser voice mid-utterance. A story whose position is moving is alive
  // and is never advanced, however its status flags read.
  const startWatchdog = useCallback(() => {
    clearWatchdog();
    const checkInterval = 2000;
    const maxSilence = 8000;
    // Seed the clock so the synthesis-to-play handoff gets the same grace
    // as any inter-sentence pause.
    lastProgressAtRef.current = Date.now();
    lastAudioTimeRef.current = -1;

    const check = () => {
      if (!isPlayingStoryRef.current) return;

      const now = Date.now();
      const audio = audioElRef.current;
      if (audio && audio.src && !audio.ended) {
        const t = audio.currentTime;
        if (lastAudioTimeRef.current >= 0 && t > lastAudioTimeRef.current + 0.05) {
          lastProgressAtRef.current = now;
        }
        lastAudioTimeRef.current = t;
      }
      if (synthRef.current?.speaking) {
        lastProgressAtRef.current = now;
      }

      if (now - lastProgressAtRef.current > maxSilence) {
        console.warn('[Voice] Watchdog: playback position frozen for 8s, forcing queue advance');
        isPlayingStoryRef.current = false;
        clearWatchdog();
        setIsSpeaking(false);
        setTimeout(() => playStoryFromQueueRef.current(), 300);
        return;
      }
      watchdogRef.current = window.setTimeout(check, checkInterval);
    };

    watchdogRef.current = window.setTimeout(check, checkInterval);
  }, [clearWatchdog]);

  // --- Freshness gate ---

  // A story is only worth playing if the listener is still near where it was
  // written, heading toward it (not away), and it has not gone stale.
  const isStillRelevant = useCallback((item: StoryQueueItem): boolean => {
    if (item.lat === undefined || item.lng === undefined) return true;
    const current = currentPositionProviderRef.current?.();
    if (!current) return true;

    const mode = resolveMovementMode(current.speed, lastKnownModeRef.current);
    lastKnownModeRef.current = mode;

    const d = calculateDistance(current.lat, current.lng, item.lat, item.lng);
    const reach =
      mode === 'driving' ? REACH_DRIVING_M : mode === 'walking' ? REACH_WALKING_M : REACH_STATIONARY_M;
    if (d > reach) return false;

    // Region-anchored stories have no single spot to pass.
    // The behind-you check is intentionally removed for driving mode: with
    // absolute geographic framing, a story about a landmark the listener has
    // already passed is still worth hearing — the story describes what the
    // place IS, not where it is relative to the listener.

    const age = Date.now() - item.generatedAt;
    const maxAge = mode === 'driving' ? MAX_AGE_DRIVING_MS : MAX_AGE_WALKING_MS;
    if (age > maxAge) return false;

    return true;
  }, []);

  // --- Story queue system ---

  // Play story text with Gemini native TTS (Leo's real voice). Falls back to
  // browser SpeechSynthesis if Gemini TTS is unavailable or fails — so the
  // tour still works offline or before the audio service initializes.
  const preSynthesizeNext = useCallback(() => {
    if (!geminiAudio.hasModel()) {
      try { geminiAudio.initialize(); } catch { return; }
    }
    if (!geminiAudio.hasModel()) return;

    const next = storyQueueRef.current[0];
    if (!next) return;

    const fullText = next.transitionText ? `${next.transitionText} ${next.text}` : next.text;
    if (!fullText || fullText.trim().length === 0) return;
    if (preSynthTextRef.current === fullText) return;
    preSynthTextRef.current = fullText;

    geminiAudio.textToAudioUrl(fullText).then((result) => {
      if (result.cacheHit) {
        console.log('[Voice] Pre-synthesis was a cache hit — already warm');
      }
    }).catch(() => {
      // Best-effort — a failed pre-synthesis just means the next story
      // synthesizes on demand as before.
    });
    console.log('[Voice] Pre-synthesizing next story audio');
  }, []);

  const preSynthesizeNextRef = useRef(preSynthesizeNext);
  preSynthesizeNextRef.current = preSynthesizeNext;

  const playSegmentsWithGemini = useCallback(async (fullText: string, onDone: (blocked: boolean) => void) => {
    let finished = false;
    const finish = (blocked: boolean) => {
      if (finished) return;
      finished = true;
      onDone(blocked);
    };

    const fallbackToBrowser = (reason: string) => {
      if (playbackStartedRef.current) {
        console.log('[Voice] Gemini audio errored mid-playback — skipping replay, moving on');
        finish(false);
        return;
      }
      console.log('[Voice] Gemini TTS fallback:', reason);
      setTtsStatus('fallback: ' + reason);
      playSegmentsBrowser([fullText], finish);
    };

    if (!geminiAudio.hasModel()) {
      try { geminiAudio.initialize(); } catch (e) { fallbackToBrowser('init failed: ' + (e instanceof Error ? e.message : String(e))); return; }
    }
    if (!geminiAudio.hasModel()) {
      fallbackToBrowser('no model after init');
      return;
    }

    try {
      storyTimingRef.current.synthRequestAt = Date.now();
      const ttsResult = await geminiAudio.textToAudioUrl(fullText);
      storyTimingRef.current.synthResolvedAt = Date.now();
      storyTimingRef.current.synthCacheHit = ttsResult.cacheHit;
      const url = ttsResult.url;
      const audio = audioElRef.current;
      if (!audio) { finish(false); return; }

      if (ttsUrlRef.current) {
        URL.revokeObjectURL(ttsUrlRef.current);
      }
      ttsUrlRef.current = url;
      audio.src = url;

      audioBlockedRef.current = false;
      setAudioBlocked(false);
      setWasInterrupted(false);
      setIsSpeaking(true);
      startWatchdog();

      audio.onplaying = () => {
        playbackStartedRef.current = true;
        storyTimingRef.current.onPlayingAt = Date.now();
        lastProgressAtRef.current = Date.now();
        preSynthesizeNextRef.current();
      };
      audio.ontimeupdate = () => {
        lastProgressAtRef.current = Date.now();
      };
      audio.onended = () => {
        playbackStartedRef.current = false;
        storyTimingRef.current.playbackEndAt = Date.now();
        lastPlaybackEndRef.current = storyTimingRef.current.playbackEndAt;
        if (ttsUrlRef.current) {
          URL.revokeObjectURL(ttsUrlRef.current);
          ttsUrlRef.current = null;
        }
        finish(false);
      };
      audio.onerror = () => {
        playbackStartedRef.current = false;
        console.error('[Voice] Audio playback error');
        fallbackToBrowser('audio error');
      };

      setTtsStatus('gemini');
      await audio.play().catch(() => {
        playbackStartedRef.current = false;
        audioBlockedRef.current = true;
        setAudioBlocked(true);
        finish(true);
      });
    } catch (error) {
      console.error('[Voice] Gemini TTS failed:', error);
      fallbackToBrowser('API error: ' + (error instanceof Error ? error.message : String(error)));
    }
  }, [startWatchdog]);

  // Browser SpeechSynthesis playback — the original sentence-by-sentence path.
  // Used as a fallback when Gemini TTS is unavailable, and for short scripted
  // lines that don't justify a TTS API call.
  const playSegmentsBrowser = useCallback((segments: string[], onDone: (blocked: boolean) => void) => {
    const sentenceGroups = segments
      .map(seg => {
        const cleaned = cleanTextForSpeech(seg);
        const matched = cleaned.match(/[^.!?]+[.!?]+/g);
        return matched && matched.length > 0
          ? matched.map(s => s.trim()).filter(s => s.length > 0)
          : [cleaned.trim()].filter(s => s.length > 0);
      })
      .flat();

    let finished = false;
    const finish = (blocked: boolean) => {
      if (finished) return;
      finished = true;
      onDone(blocked);
    };

    const playSentence = (index: number) => {
      if (index >= sentenceGroups.length || !synthRef.current) {
        finish(false);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(sentenceGroups[index]);
      pickVoice();
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.pitch = 0.95;
      utterance.rate = 0.95;
      utterance.volume = 1.0;

      let started = false;
      utterance.onstart = () => {
        started = true;
        playbackStartedRef.current = true;
        storyTimingRef.current.onPlayingAt = Date.now();
        lastProgressAtRef.current = Date.now();
        preSynthesizeNextRef.current();
        audioBlockedRef.current = false;
        setAudioBlocked(false);
        setWasInterrupted(false);
        setIsSpeaking(true);
        startWatchdog();
      };

      utterance.onboundary = () => {
        lastProgressAtRef.current = Date.now();
      };

      utterance.onend = () => {
        if (index >= sentenceGroups.length - 1) {
          playbackStartedRef.current = false;
          storyTimingRef.current.playbackEndAt = Date.now();
          lastPlaybackEndRef.current = storyTimingRef.current.playbackEndAt;
        }
        const pauseMs = index === 0 ? 500 : 350;
        setTimeout(() => playSentence(index + 1), pauseMs);
      };
      utterance.onerror = (event) => {
        playbackStartedRef.current = false;
        if (event.error === 'not-allowed') {
          audioBlockedRef.current = true;
          setAudioBlocked(true);
          finish(true);
          return;
        }
        if (event.error !== 'interrupted' && event.error !== 'canceled') {
          console.error('Story speech error:', event);
        }
        finish(false);
      };

      dispatchSpeech(utterance, () => started, () => finish(true));
    };

    playSentence(0);
  }, [dispatchSpeech, startWatchdog]);

  const playStoryFromQueue = useCallback(() => {
    if (isPlayingStoryRef.current) return;

    // Drop any waiting story that no longer describes where the listener is.
    while (storyQueueRef.current.length > 0) {
      const next = storyQueueRef.current[0];
      if (isStillRelevant(next)) break;
      storyQueueRef.current.shift();
      console.log('[Voice] Stale story dropped — no longer describes the listener\'s location');
    }

    const item = storyQueueRef.current.shift();
    if (!item) {
      isPlayingStoryRef.current = false;
      onStoryCompleteRef.current?.();
      return;
    }

    // Deliberate gap: location stories wait for a minimum silence after the
    // previous story ended. Scripted lines (intros, fillers, Q&A answers) and
    // the first story of a tour play immediately — there's no previous speech
    // to space from.
    if (item.isLocationStory && lastPlaybackEndRef.current !== null) {
      const pos = currentPositionProviderRef.current?.();
      const speed = pos?.speed ?? null;
      const bucket: 'driving' | 'walking' | 'stationary' =
        speed !== null && speed >= 5.5 ? 'driving' : speed !== null && speed > 0.5 ? 'walking' : 'stationary';
      const requiredGap = GAP_AFTER_SPEECH_MS[bucket];
      const elapsed = Date.now() - lastPlaybackEndRef.current;
      if (elapsed < requiredGap) {
        const wait = requiredGap - elapsed;
        console.log(`[Voice] Gap pacing: waiting ${wait}ms before next story (${bucket})`);
        storyQueueRef.current.unshift(item);
        isPlayingStoryRef.current = false;
        const gen = playGenRef.current;
        gapTimerRef.current = window.setTimeout(() => {
          gapTimerRef.current = null;
          // Ownership check: a skip/stop/mute that happened during the wait
          // must not let this timer advance a stale queue.
          if (gen !== playGenRef.current) return;
          if (isPlayingStoryRef.current) return;
          playStoryFromQueueRef.current();
        }, wait);
        return;
      }
    }

    isPlayingStoryRef.current = true;

    // Reset the per-story timing tracker for the story about to play.
    storyTimingRef.current = {
      synthRequestAt: null,
      synthResolvedAt: null,
      synthCacheHit: null,
      onPlayingAt: null,
      playbackEndAt: null,
    };

    // Record what is going on air, so a thumb tap or a skip knows exactly
    // which story it is rating and how long it ran. Scripted lines and ads
    // clear it: they are not stories and rating one would be meaningless.
    currentSpokenRef.current = item.isLocationStory
      ? { topic: item.topic ?? '', text: item.text, startedAt: Date.now() }
      : null;

    // Tell the app what just went on air, so the rating control points at the
    // story actually playing rather than the one most recently queued.
    onStoryStartRef.current?.(item.isLocationStory ? (item.topic ?? null) : null);

    // Cut diagnostic: if the previous item's audio file was still mid-play
    // when this story takes over, something advanced the queue early. Log
    // the exact position — field tests use this to prove whether story
    // cut-offs happen inside the app or outside it (car audio routing,
    // a second app instance). A healthy handoff never logs this: the
    // previous file has ended (ended=true or currentTime ~= duration).
    const prevAudio = audioElRef.current;
    if (
      prevAudio && prevAudio.src && !prevAudio.ended &&
      Number.isFinite(prevAudio.duration) && prevAudio.duration > 0 &&
      prevAudio.currentTime > 0.25 && prevAudio.currentTime < prevAudio.duration - 1.5
    ) {
      console.warn(
        `[Voice] CUT DIAGNOSTIC: new story starting while previous audio was mid-file ` +
        `at ${prevAudio.currentTime.toFixed(1)}s of ${prevAudio.duration.toFixed(1)}s`
      );
    }

    // Cancel any streaming speech, then play the queued story
    synthRef.current?.cancel();
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    sentenceQueueRef.current = [];
    streamBufferRef.current = '';
    isProcessingQueueRef.current = false;

    // Claim ownership of playback. Any callback still pending from a story
    // that was skipped or force-advanced will see a stale generation and stop.
    const gen = ++playGenRef.current;
    const fullText = item.transitionText ? `${item.transitionText} ${item.text}` : item.text;

    // All playback gets Leo's real voice via Gemini TTS. Falls back to browser
    // voice if Gemini TTS is unavailable or fails.
    const useGeminiTTS = fullText.length > 0;

    const onDone = (blocked: boolean) => {
      if (gen !== playGenRef.current) return;

      isPlayingStoryRef.current = false;
      clearWatchdog();
      setIsSpeaking(false);

      if (blocked) {
        storyQueueRef.current.unshift(item);
        console.log('[Voice] Audio blocked — holding this story until sound is allowed');
        return;
      }

      setTimeout(() => playStoryFromQueueRef.current(), 100);
    };

    if (useGeminiTTS) {
      playSegmentsWithGemini(fullText, onDone);
    } else {
      playSegmentsBrowser([fullText], onDone);
    }
  }, [isStillRelevant, playSegmentsBrowser, playSegmentsWithGemini, clearWatchdog]);

  const playStoryFromQueueRef = useRef(playStoryFromQueue);
  playStoryFromQueueRef.current = playStoryFromQueue;

  // Coming back from another app: the platform has paused speech and the
  // watchdog's timers were throttled while hidden, so its idea of "silence" is
  // meaningless. Unpause, restart the clock, and pick the queue back up if the
  // utterance was killed outright.
  const resumeFromBackground = useCallback(() => {
    const synth = synthRef.current;
    if (synth) {
      try {
        synth.resume();
      } catch {
        // Engine missing — nothing to resume
      }
    }
    if (audioElRef.current && audioElRef.current.src) {
      audioElRef.current.play().catch(() => {
        setWasInterrupted(true);
      });
    }

    if (isPlayingStoryRef.current) {
      startWatchdog();
      // Audio stays paused until the listener taps, so say so rather than
      // letting them sit in silence wondering whether the tour died.
      setWasInterrupted(true);
      return;
    }

    if (storyQueueRef.current.length > 0) {
      playStoryFromQueueRef.current();
    }
  }, [startWatchdog]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        backgroundedRef.current = true;
        return;
      }
      if (!backgroundedRef.current) return;
      backgroundedRef.current = false;
      resumeFromBackground();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [resumeFromBackground]);

  // A tap anywhere means a fresh gesture. Use it to wake the engine and, if
  // audio was blocked, to pick the held story back up.
  useEffect(() => {
    const onInteraction = () => {
      unlock();
      setWasInterrupted(false);
      if (!audioBlockedRef.current) return;
      audioBlockedRef.current = false;
      setAudioBlocked(false);
      if (!isPlayingStoryRef.current && storyQueueRef.current.length > 0) {
        playStoryFromQueueRef.current();
      }
    };

    window.addEventListener('pointerdown', onInteraction);
    window.addEventListener('touchstart', onInteraction);
    window.addEventListener('keydown', onInteraction);
    return () => {
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('touchstart', onInteraction);
      window.removeEventListener('keydown', onInteraction);
    };
  }, [unlock]);

  const enqueue = useCallback((item: StoryQueueItem) => {
    const queue = storyQueueRef.current;

    if (item.priority) {
      // A major-landmark story displaces ordinary waiting location stories
      // and becomes the first location story in line. Scripted lines stay
      // ahead of it because they are conversational glue for what is already
      // happening. Most importantly, the currently playing story is never
      // touched — priority only reorders what waits.
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].isLocationStory) queue.splice(i, 1);
      }
      const firstLocationIndex = queue.findIndex(i => i.isLocationStory);
      if (firstLocationIndex === -1) queue.push(item);
      else queue.splice(firstLocationIndex, 0, item);
      preSynthTextRef.current = null;
      console.log('[Voice] Priority story moved to the front of the waiting queue');
    } else if (item.isLocationStory) {
      const waitingIndex = queue.findIndex(i => i.isLocationStory);
      const waitingCount = queue.filter(i => i.isLocationStory).length;
      if (waitingCount >= MAX_PENDING_LOCATION_STORIES && waitingIndex !== -1) {
        queue.splice(waitingIndex, 1);
        console.log('[Voice] Replacing the waiting story with a fresher one');
      }
      queue.push(item);
    } else {
      queue.push(item);
    }

    console.log(
      `[Voice] Story queued (waiting: ${queue.length}, currently playing: ${isPlayingStoryRef.current})`
    );
    if (!isPlayingStoryRef.current) {
      playStoryFromQueueRef.current();
    } else if (playbackStartedRef.current) {
      preSynthesizeNextRef.current();
    }
  }, []);

  // Queue a story — if Leo is speaking, it waits; if not, it plays immediately.
  // originLat/originLng let the playback gate drop stories for places the
  // listener has moved past. Pass kind 'scripted' for lines that must not be
  // replaced by an incoming location story.
  const queueStory = useCallback((
    text: string,
    originLat?: number,
    originLng?: number,
    regionAnchored?: boolean,
    kind?: 'location' | 'scripted',
    topic?: string
  ) => {
    if (Date.now() < mutedUntilRef.current) {
      console.log('[Voice] Muted — dropping queued story');
      return;
    }
    const hasCoords = originLat !== undefined && originLng !== undefined;
    enqueue({
      text,
      topic,
      lat: originLat,
      lng: originLng,
      generatedAt: Date.now(),
      regionAnchored,
      isLocationStory: kind ? kind === 'location' : hasCoords,
    });
  }, [enqueue]);

  // Queue a major-landmark story at the front of the waiting line. The
  // current story always finishes first; this only decides what comes next.
  const queuePriorityStory = useCallback((
    text: string,
    originLat?: number,
    originLng?: number,
    regionAnchored?: boolean,
    topic?: string
  ) => {
    if (Date.now() < mutedUntilRef.current) {
      console.log('[Voice] Muted — dropping priority story');
      return;
    }
    enqueue({
      text,
      topic,
      lat: originLat,
      lng: originLng,
      generatedAt: Date.now(),
      regionAnchored,
      isLocationStory: true,
      priority: true,
    });
  }, [enqueue]);

  // Queue a story with a smooth transition intro before it
  const queueStoryWithTransition = useCallback((
    text: string,
    transitionText: string,
    originLat?: number,
    originLng?: number,
    regionAnchored?: boolean,
    kind?: 'location' | 'scripted',
    topic?: string
  ) => {
    if (Date.now() < mutedUntilRef.current) {
      console.log('[Voice] Muted — dropping queued story');
      return;
    }
    const hasCoords = originLat !== undefined && originLng !== undefined;
    enqueue({
      text,
      topic,
      transitionText,
      lat: originLat,
      lng: originLng,
      generatedAt: Date.now(),
      regionAnchored,
      isLocationStory: kind ? kind === 'location' : hasCoords,
    });
  }, [enqueue]);

  // Skip the currently playing story and flush the queue. Leo goes quiet
  // immediately; the on-story-complete callback still fires so the app can
  // decide what comes next.
  const skipCurrent = useCallback(() => {
    console.log('[Voice] Skip requested');
    playGenRef.current += 1;
    synthRef.current?.cancel();
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    if (gapTimerRef.current !== null) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    storyQueueRef.current = [];
    isPlayingStoryRef.current = false;
    sentenceQueueRef.current = [];
    streamBufferRef.current = '';
    isProcessingQueueRef.current = false;
    preSynthTextRef.current = null;
    playbackStartedRef.current = false;
    clearWatchdog();
    setIsSpeaking(false);
    setTimeout(() => onStoryCompleteRef.current?.(), 50);
  }, [clearWatchdog]);

  const muteForMinutes = useCallback((minutes: number) => {
    mutedUntilRef.current = Date.now() + minutes * 60_000;
    console.log(`[Voice] Muted for ${minutes} minutes`);
    playGenRef.current += 1;
    synthRef.current?.cancel();
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    if (gapTimerRef.current !== null) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    storyQueueRef.current = [];
    isPlayingStoryRef.current = false;
    sentenceQueueRef.current = [];
    streamBufferRef.current = '';
    isProcessingQueueRef.current = false;
    preSynthTextRef.current = null;
    playbackStartedRef.current = false;
    clearWatchdog();
    setIsSpeaking(false);
  }, [clearWatchdog]);

  const isMuted = useCallback(() => Date.now() < mutedUntilRef.current, []);

  const unmute = useCallback(() => {
    mutedUntilRef.current = 0;
  }, []);

  // Track the last two spoken sentences for Q&A context injection
  const recordSpokenText = useCallback((text: string) => {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    recentSpokenRef.current = [...recentSpokenRef.current, ...sentences.map(s => s.trim())]
      .filter(s => s.length > 0)
      .slice(-2);
  }, []);

  // Note what is being narrated, along with the tags that describe it. The
  // tags are what a rating is stored against, so they are derived here — next
  // to the text — rather than at the moment of the tap.
  const onStoryStartRef = useRef<((topic: string | null) => void) | null>(null);

  const setOnStoryStart = useCallback((cb: ((topic: string | null) => void) | null) => {
    onStoryStartRef.current = cb;
  }, []);

  // How the listener felt about what just played. Value 1 is a thumbs up, -1
  // a thumbs down, 0 undoes an earlier rating. Returns the tags the rating was
  // filed under, so the caller can confirm it back to the listener.
  const rateCurrentStory = useCallback((value: 1 | -1 | 0, source: 'explicit' | 'skip' = 'explicit') => {
    const current = currentSpokenRef.current;
    if (!current || !current.topic) {
      console.log('[Voice] Nothing on air to rate');
      return [];
    }

    const skipSeconds =
      source === 'skip' ? (Date.now() - current.startedAt) / 1000 : undefined;

    return tasteProfile.record({
      topic: current.topic,
      text: current.text,
      value,
      source,
      skipSeconds,
    });
  }, []);

  // Seconds the current story has been playing, or null if nothing is on air.
  const getCurrentStorySeconds = useCallback((): number | null => {
    const current = currentSpokenRef.current;
    if (!current) return null;
    return (Date.now() - current.startedAt) / 1000;
  }, []);

  // The subject of the story on air, or null. Used to tell whether a second
  // tap on the same thumb refers to the same story or a new one.
  const getCurrentStoryTopic = useCallback((): string | null => {
    return currentSpokenRef.current?.topic || null;
  }, []);

  const getLastSpokenSentences = useCallback(() => recentSpokenRef.current.join(' '), []);

  const isPlayingStory = useCallback(() => isPlayingStoryRef.current, []);

  const setOnStoryComplete = useCallback((cb: (() => void) | null) => {
    onStoryCompleteRef.current = cb;
  }, []);

  const getQueueLength = useCallback(() => storyQueueRef.current.length, []);

  const getStoryTiming = useCallback((): StoryTiming => storyTimingRef.current, []);

  const setCurrentPositionProvider = useCallback((provider: (() => CurrentPosition | null) | null) => {
    currentPositionProviderRef.current = provider;
  }, []);

  return {
    isInitialized,
    isSpeaking,
    audioBlocked,
    wasInterrupted,
    unlock,
    ensureVoiceReady,
    initializeVoice,
    speak,
    stop,
    queueStory,
    queuePriorityStory,
    queueStoryWithTransition,
    skipCurrent,
    muteForMinutes,
    isMuted,
    unmute,
    recordSpokenText,
    rateCurrentStory,
    getCurrentStorySeconds,
    getCurrentStoryTopic,
    setOnStoryStart,
    getLastSpokenSentences,
    isPlayingStory,
    setOnStoryComplete,
    getQueueLength,
    getStoryTiming,
    setCurrentPositionProvider,
    ttsStatus,
  };
};

export default useVoice;
