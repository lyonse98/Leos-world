import { useState, useCallback, useRef, useEffect } from 'react';
import {
  calculateDistance,
  resolveMovementMode,
  MovementModeHysteresis,
} from '../utils/geo';
import { tasteProfile } from '../services/tasteProfile';
import { geminiAudio, TTS_MODEL } from '../services/geminiAudio';
import { quotaGuard } from '../services/quotaGuard';
import { analytics } from '../services/analytics';

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
  // Speak through the local (browser) voice FIRST, never Gemini TTS.
  // Reserved for the canned opener lines: they must sound immediately
  // at tour start — no synthesis wait, no quota spend, no dependence on
  // the TTS cache — while the story pipeline warms up behind them.
  // This was the opener's historical behavior, and its loss was the
  // Oct 26 field regression: routed through Gemini, the fixed intro
  // texts were the surest victims of the poisoned TTS cache.
  localVoice?: boolean;
  // How many times this item has been dequeued for playback. Bounded by
  // MAX_PLAYBACK_ATTEMPTS: a blocked or failing item is retried, never
  // looped forever (the Oct 26 fallback-voice repeat).
  attempts?: number;
  // The landmark or subject the story is about, when it has one. Carried so a
  // rating taken while the story plays can be filed against the right subject.
  topic?: string;
  // A story about a truly major landmark. Priority changes the waiting
  // order only — it never interrupts the story currently playing.
  priority?: boolean;
  // Pre-made audio (curated library episode): playback uses this URL
  // directly and pre-synthesis skips the item entirely — the audio
  // already exists, so no quota is ever spent on it.
  audioUrl?: string;
  // Per-item playback lifecycle, for items whose delivery must be
  // CONFIRMED rather than assumed (the Q&A answer). onPlaybackStart
  // fires when audio actually begins for this item; onPlaybackEnd
  // fires exactly once when the item leaves the player, reporting
  // whether it ever sounded. Queue movement alone proves nothing —
  // a failed item advances the queue exactly like a finished one.
  onPlaybackStart?: () => void;
  onPlaybackEnd?: (sounded: boolean) => void;
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

// Freeway staleness gate (Erik field report, Oct 24): the behind-you exemption
// above is right at city speeds — absolute framing keeps a passed landmark
// worth hearing. At freeway speed it breaks down: a story can air up to the
// full 2 km reach BEHIND the listener, over a minute of road already gone,
// and it lands as out-of-area. So at freeway speed only, an anchor far behind
// the direction of travel is stale and the story is dropped instead.
const FREEWAY_SPEED_MPS = 20; // ~45 mph
const STALE_BEHIND_FREEWAY_M = 1500;

// Deliberate silence between stories, by movement mode. The gap is measured
// from the previous story's last audio frame to the next story's first. Too
// short and Leo feels manic; too long and the listener thinks the tour died.
const GAP_AFTER_SPEECH_MS: Record<'driving' | 'walking' | 'stationary', number> = {
  driving: 8000,
  walking: 4000,
  stationary: 3000,
};

// Bound on one TTS synthesis inside playback. Measured synthesis runs
// ~6 s; a call still pending at 30 s is hung, not slow, and an item
// waiting on it would otherwise never settle — the watchdog only
// starts once audio exists. On timeout the browser voice takes over.
const TTS_SYNTH_TIMEOUT_MS = 30000;

// How long a location story's synthesis may run, inside the player,
// before a one-line local-voice bridge covers the wait. Long enough
// that the common case (pre-synthesized during the opener, or a ~6 s
// synthesis) rarely triggers it; short enough that a cold first story
// never leaves the listener in unexplained silence.
const BRIDGE_AFTER_MS = 4000;

// Total playback attempts for one queue item across ALL failure exits
// (blocked, engine failure, watchdog advance). When the bound is hit
// the item is dropped and the queue moves on: a line that cannot be
// heard must never wedge or loop the tour (Oct 26: fallback voice
// repeating the same line because a failing item kept being requeued
// and re-attempted on every fetch-cycle trigger).
const MAX_PLAYBACK_ATTEMPTS = 3;

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
  // The queue item currently in the player, with its lifecycle state.
  // Settled exactly once — by natural completion, a watchdog advance, a
  // skip, or a stop — so a tracked item's owner always learns whether
  // it sounded, and never hears twice. The success it reports is
  // `sounded && completed`: an item that was cut short — watchdog
  // advance, engine error, exhausted retries — reports NOT delivered
  // even if part of it was heard. The only tracked consumer is the
  // Q&A cycle, and a partial answer reported as answered is exactly
  // the lost-answer failure (Oct 25) wearing a new coat: the bridge
  // played, the lock released, and the listener never heard the end
  // of what they asked (Oct 26 field test: input unlocked mid-answer).
  const currentPlaybackRef = useRef<{
    gen: number;
    sounded: boolean;
    completed: boolean;
    onEnd?: (sounded: boolean) => void;
  } | null>(null);
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
  // WHY the audio is blocked, so the banner can tell the truth: 'blocked' is
  // a genuine platform refusal (autoplay/permission — the user CAN fix it
  // with a tap); 'error' is everything else (a synthesis failure, a quota
  // cascade into the fallback voice, speech that never began). The old
  // banner claimed "your browser muted Leo" for all of them, which was
  // wrong in the majority of field cases (Erik, Oct 24).
  const [audioBlockedKind, setAudioBlockedKind] = useState<'blocked' | 'error'>('error');
  const markAudioBlocked = (kind: 'blocked' | 'error') => {
    audioBlockedRef.current = true;
    setAudioBlockedKind(kind);
    setAudioBlocked(true);
    // Observational only: count audio blocks for the daily rollup.
    try {
      analytics.track('audio_blocked', null, undefined, { source: kind, kind });
    } catch { /* a metric must never break the banner */ }
  };
  // Set when the listener returns to a tour whose audio the platform paused.
  // Surfaces as "tap to resume" instead of leaving them in unexplained silence.
  const [wasInterrupted, setWasInterrupted] = useState<boolean>(false);
  // Tracks whether Gemini TTS is active or why it fell back, surfaced in
  // diagnostics so the reason for browser voice is visible.
  const [ttsStatus, setTtsStatus] = useState<string>('idle');
  const backgroundedRef = useRef<boolean>(false);
  // A line requested before the first gesture is held here and spoken the
  // instant the listener taps, since that tap is what permits sound.
  const pendingSpeechRef = useRef<{ text: string; localVoice?: boolean } | null>(null);
  const speakRef = useRef<(text: string, opts?: { localVoice?: boolean }) => void>(() => {});
  const pendingTrackedRef = useRef<{
    text: string;
    onPlaybackStart?: () => void;
    onPlaybackEnd?: (sounded: boolean) => void;
    front?: boolean;
  } | null>(null);
  const speakTrackedRef = useRef<(
    text: string,
    cbs: { onPlaybackStart?: () => void; onPlaybackEnd?: (sounded: boolean) => void },
    opts?: { front?: boolean }
  ) => void>(() => {});

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
        // The prime just landed — NOW any line being held can actually
        // be heard. Flush it here, not only in unlock(): the tour-start
        // flow speaks the intro after its last unlock() call, and if
        // the prime hadn't resolved yet the intro was held in
        // pendingSpeechRef with no further unlock coming — in a car,
        // possibly no tap ever — so the welcome simply never sounded.
        // A held line must be spoken the moment the engine unlocks,
        // whoever's call made it happen.
        const held = pendingSpeechRef.current;
        if (held) {
          pendingSpeechRef.current = null;
          speakRef.current(held.text, { localVoice: held.localVoice });
        }
        const heldTracked = pendingTrackedRef.current;
        if (heldTracked) {
          pendingTrackedRef.current = null;
          speakTrackedRef.current(heldTracked.text, heldTracked, { front: heldTracked.front });
        }
      }).catch(() => {
        audio.muted = false;
        audio.removeAttribute('src');
        unlockedRef.current = false;
      });
    }

    const pending = pendingSpeechRef.current;
    if (pending) {
      pendingSpeechRef.current = null;
      speakRef.current(pending.text, { localVoice: pending.localVoice });
    }
    const pendingTracked = pendingTrackedRef.current;
    if (pendingTracked) {
      pendingTrackedRef.current = null;
      speakTrackedRef.current(pendingTracked.text, pendingTracked, { front: pendingTracked.front });
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
  //
  // The retry is a BLIND re-speak of the same utterance object: when the
  // start was merely late (not blocked), the engine ends up holding two
  // copies, the second still sounding after the first copy's end events
  // have advanced — and for a tracked item, settled — the player. That
  // is the fallback "repeating itself" Erik heard in the field (Oct 26)
  // and one way a Q&A answer could report completion while its tail
  // was still coming out of the speaker. Callers whose item lifecycle
  // is tracked (the story queue's sentence chain) pass allowRetry=false:
  // a sentence that never begins routes to the blocked path and the
  // bounded attempt economy instead of a duplicate.
  const dispatchSpeech = useCallback((
    utterance: SpeechSynthesisUtterance,
    hasStarted: () => boolean,
    onBlocked?: () => void,
    allowRetry: boolean = true
  ) => {
    const synth = synthRef.current;
    if (!synth) return;

    const attempt = (mayRetry: boolean) => {
      synth.resume();
      synth.speak(utterance);

      window.setTimeout(() => {
        if (hasStarted()) return;
        if (mayRetry && allowRetry) {
          console.log('[Voice] Speech did not begin — retrying once');
          attempt(false);
          return;
        }
        console.warn('[Voice] Speech never began — audio appears to be blocked');
        markAudioBlocked('error');
        onBlocked?.();
      }, 3000);
    };

    attempt(true);
  }, []);

  // Play a line that must finish before anything else is heard. Unlike a
  // queued story, this owns the queue: an arriving story waits its turn
  // instead of cutting the line off mid-sentence.
  const speakPriority = useCallback((text: string, cbs?: {
    onPlaybackStart?: () => void;
    onPlaybackEnd?: (sounded: boolean) => void;
  }, opts?: { localVoice?: boolean; front?: boolean }) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const item: StoryQueueItem = {
      text: trimmed,
      generatedAt: Date.now(),
      isLocationStory: false,
      localVoice: opts?.localVoice,
      onPlaybackStart: cbs?.onPlaybackStart,
      onPlaybackEnd: cbs?.onPlaybackEnd,
    };

    if (opts?.front) {
      // Conversational glue belongs ahead of waiting location stories —
      // the queue's own doctrine (see enqueue's priority branch) —
      // without displacing anything already waiting. The Q&A bridge is
      // the case that needs it: it must be the NEXT line after the
      // answer, not trail behind a story fetched while the answer was
      // generating, or the resume the lock waits for happens in the
      // wrong order.
      const idx = storyQueueRef.current.findIndex(i => i.isLocationStory);
      if (idx === -1) storyQueueRef.current.push(item);
      else storyQueueRef.current.splice(idx, 0, item);
    } else {
      storyQueueRef.current.push(item);
    }

    if (!isPlayingStoryRef.current) {
      playStoryFromQueueRef.current();
    }
  }, []);

  const speak = useCallback((text: string, opts?: { localVoice?: boolean }) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Before the first gesture nothing can be heard anyway, so hold the line
    // and let the unlock step speak it. Dropping it here would silently lose
    // whatever the app most wanted to say.
    if (!unlockedRef.current) {
      pendingSpeechRef.current = { text: trimmed, localVoice: opts?.localVoice };
      return;
    }

    speakPriority(trimmed, undefined, opts);
  }, [speakPriority]);

  speakRef.current = speak;

  // Speak a line whose delivery the caller must be able to CONFIRM:
  // the callbacks report when it actually starts sounding and when it
  // leaves the player, with whether it ever sounded at all. Used for
  // the Q&A answer, where assuming delivery from queue movement alone
  // once let the bridge line play over an answer that never aired.
  // If audio is not yet unlocked, the line is held (like speak) and
  // flushed by unlock with its callbacks intact.
  const speakTracked = useCallback((text: string, cbs: {
    onPlaybackStart?: () => void;
    onPlaybackEnd?: (sounded: boolean) => void;
  }, opts?: { front?: boolean }) => {
    const trimmed = text.trim();
    if (!trimmed) {
      cbs.onPlaybackEnd?.(false);
      return;
    }

    if (!unlockedRef.current) {
      pendingTrackedRef.current = { text: trimmed, ...cbs, front: opts?.front };
      return;
    }

    speakPriority(trimmed, cbs, { front: opts?.front });
  }, [speakPriority]);

  speakTrackedRef.current = speakTracked;

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // Settle the item currently in the player: fire its onPlaybackEnd
  // exactly once with whether it FULLY delivered (sounded AND ran to
  // natural completion — see currentPlaybackRef), and forget it. Every
  // exit path from the player — natural end, watchdog advance, skip,
  // stop — goes through here, so a tracked item can neither be lost
  // silently nor reported twice, and a truncated item can never be
  // reported as delivered.
  const settleCurrentPlayback = useCallback(() => {
    const pb = currentPlaybackRef.current;
    if (!pb) return;
    currentPlaybackRef.current = null;
    pb.onEnd?.(pb.sounded && pb.completed);
  }, []);

  const stop = useCallback(() => {
    playGenRef.current += 1;
    settleCurrentPlayback();
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
  }, [clearWatchdog, settleCurrentPlayback]);

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
      if (synthRef.current?.speaking || synthRef.current?.pending) {
        // pending matters for the browser voice: iOS routinely reports
        // speaking=false between (and during) queued utterances of a
        // multi-sentence line, and on that false negative the watchdog
        // force-advanced healthy openers mid-line (Oct 26, start #3 —
        // the welcome cut off). A queued utterance is progress too.
        lastProgressAtRef.current = now;
      }

      if (now - lastProgressAtRef.current > maxSilence) {
        console.warn('[Voice] Watchdog: playback position frozen for 8s, forcing queue advance');
        isPlayingStoryRef.current = false;
        clearWatchdog();
        setIsSpeaking(false);
        // Silence the engines BEFORE settling. A settle is the player
        // declaring this item over, and it must be true at the speaker
        // too: the old order settled first and left the still-loaded
        // audio element / still-speaking utterance to be stopped by
        // the NEXT dequeue — on exactly the false-negative this
        // watchdog exists for (iOS reporting not-speaking mid-utterance),
        // a tracked item's owner was told "ended" while its audio was
        // still coming out, and the Q&A lock released under a
        // still-playing answer (Oct 26 field test).
        if (audio) {
          audio.pause();
          audio.removeAttribute('src');
        }
        if (ttsUrlRef.current) {
          URL.revokeObjectURL(ttsUrlRef.current);
          ttsUrlRef.current = null;
        }
        try { synthRef.current?.cancel(); } catch { /* engine missing */ }
        playbackStartedRef.current = false;
        // The item being abandoned still settles: if it never sounded,
        // its owner (e.g. the Q&A cycle) must learn that now, not from
        // watching the next item start.
        settleCurrentPlayback();
        setTimeout(() => playStoryFromQueueRef.current(), 300);
        return;
      }
      watchdogRef.current = window.setTimeout(check, checkInterval);
    };

    watchdogRef.current = window.setTimeout(check, checkInterval);
  }, [clearWatchdog, settleCurrentPlayback]);

  // --- Freshness gate ---

  // A story is only worth playing if the listener is still near where it was
  // written, heading toward it (not away), and it has not gone stale.
  // Direction of travel for the freeway staleness gate: GPS heading when the
  // provider supplies one, otherwise derived from recent movement (≥25 m of
  // displacement between provider readings). Null when neither is known —
  // the gate then stays inert rather than dropping stories blind.
  const lastTravelPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const resolveTravelHeading = (current: CurrentPosition): number | null => {
    if (typeof current.heading === 'number' && Number.isFinite(current.heading)) {
      return current.heading;
    }
    const last = lastTravelPosRef.current;
    if (last) {
      const moved = calculateDistance(last.lat, last.lng, current.lat, current.lng);
      if (moved >= 25) {
        const dLng = (current.lng - last.lng) * Math.cos((current.lat * Math.PI) / 180);
        const heading = (Math.atan2(dLng, current.lat - last.lat) * 180) / Math.PI;
        lastTravelPosRef.current = { lat: current.lat, lng: current.lng };
        return (heading + 360) % 360;
      }
    } else {
      lastTravelPosRef.current = { lat: current.lat, lng: current.lng };
    }
    return null;
  };

  // True only at freeway speed, with a known direction of travel, when the
  // story's anchor sits far BEHIND the listener (>90° off heading, beyond
  // STALE_BEHIND_FREEWAY_M). Conservative by design: any unknown → false.
  const isFarBehindAtFreeway = (item: StoryQueueItem, current: CurrentPosition, d: number): boolean => {
    if (item.lat === undefined || item.lng === undefined) return false;
    if (typeof current.speed !== 'number' || current.speed < FREEWAY_SPEED_MPS) return false;
    if (d <= STALE_BEHIND_FREEWAY_M) return false;
    const heading = resolveTravelHeading(current);
    if (heading === null) return false;
    const dLng = (item.lng - current.lng) * Math.cos((current.lat * Math.PI) / 180);
    const bearing = ((Math.atan2(dLng, item.lat - current.lat) * 180) / Math.PI + 360) % 360;
    const diff = Math.abs(((bearing - heading + 360) % 360) - 180);
    return diff < 90; // |bearing − heading| in (90°, 270°): rear hemisphere
  };

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

    // Freeway exception to the behind-you exemption below: at freeway speed
    // an anchor far behind the direction of travel is out of the area the
    // listener is in — drop it rather than narrate yesterday's road.
    if (isFarBehindAtFreeway(item, current, d)) {
      console.log(`[Voice] Dropping stale highway story — anchor ${Math.round(d)}m behind at freeway speed`);
      // Observational only: count stale drops for the daily rollup.
      try {
        analytics.track('story_dropped', null, undefined, { source: 'stale_highway', topic: item.topic ?? '' });
      } catch { /* a metric must never break the gate */ }
      return false;
    }

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
    // Circuit breaker: no pre-synthesis while the TTS lane is tripped.
    if (quotaGuard.isTripped('tts', TTS_MODEL)) return;
    if (!geminiAudio.hasModel()) {
      try { geminiAudio.initialize(); } catch { return; }
    }
    if (!geminiAudio.hasModel()) return;

    const next = storyQueueRef.current[0];
    if (!next) return;

    // Library stories arrive with their audio already made — never spend
    // synthesis quota warming them.
    if (next.audioUrl) return;

    // Don't spend synthesis (quota) on a story the freeway staleness gate
    // will drop at dequeue — at highway speed a far-behind next story is
    // exactly the one most likely never to air.
    const presynthPos = currentPositionProviderRef.current?.();
    if (presynthPos && next.lat !== undefined && next.lng !== undefined) {
      const dNext = calculateDistance(presynthPos.lat, presynthPos.lng, next.lat, next.lng);
      if (isFarBehindAtFreeway(next, presynthPos, dNext)) {
        console.log('[Voice] Skipping pre-synthesis — next story is stale highway content');
        return;
      }
    }

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

  const playSegmentsWithGemini = useCallback(async (fullText: string, onDone: (blocked: boolean) => void, providedUrl?: string, onAir?: () => void, isLocationStory?: boolean, tracked?: boolean) => {
    // Runway bridge state (see the arming site below): declared first
    // because finish() — which can fire synchronously on the init-fail
    // path — must be able to cancel it.
    let bridgeTimer: number | null = null;
    let bridgeUtterance: SpeechSynthesisUtterance | null = null;
    const cancelBridge = () => {
      if (bridgeTimer !== null) {
        clearTimeout(bridgeTimer);
        bridgeTimer = null;
      }
      if (bridgeUtterance) {
        bridgeUtterance = null;
        try { synthRef.current?.cancel(); } catch { /* engine missing */ }
      }
    };

    let finished = false;
    const finish = (blocked: boolean) => {
      if (finished) return;
      finished = true;
      cancelBridge();
      onDone(blocked);
    };

    const fallbackToBrowser = (reason: string) => {
      if (playbackStartedRef.current) {
        if (tracked) {
          // A tracked line (the Q&A answer) that dies mid-playback has
          // NOT delivered — the listener heard a fragment. Settling it
          // as done would let its owner bridge over the hole and
          // release the question lock over an answer that never
          // finished (the Oct 25 failure, re-entering through the
          // error path). Route it through the blocked path instead:
          // the bounded attempt economy replays it whole, or settles
          // it honestly as not delivered.
          console.log('[Voice] Gemini audio errored mid-playback on a tracked line — requeueing for a whole replay');
          finish(true);
          return;
        }
        console.log('[Voice] Gemini audio errored mid-playback — skipping replay, moving on');
        finish(false);
        return;
      }
      console.log('[Voice] Gemini TTS fallback:', reason);
      setTtsStatus('fallback: ' + reason);
      playSegmentsBrowser([fullText], finish, onAir, tracked);
    };

    // Pre-made audio (library episode) needs no TTS model at all — skip the
    // init gate; the audio element plays the URL directly.
    if (!providedUrl) {
      if (!geminiAudio.hasModel()) {
        try { geminiAudio.initialize(); } catch (e) { fallbackToBrowser('init failed: ' + (e instanceof Error ? e.message : String(e))); return; }
      }
      if (!geminiAudio.hasModel()) {
        fallbackToBrowser('no model after init');
        return;
      }
    }

    // Arm the runway bridge for a location story that must synthesize:
    // if the audio is not in hand within a few seconds, one short
    // local-voice line covers the wait so the listener never sits in
    // uncovered silence wondering whether the tour died (Oct 26, start
    // #3 — a long hush before the first story while its synthesis ran
    // serialized in the player). The bridge never enters the queue, is
    // spoken at most once per story, and is cancelled the instant the
    // real audio starts or the item settles.
    if (isLocationStory && !providedUrl) {
      bridgeTimer = window.setTimeout(() => {
        bridgeTimer = null;
        if (finished || playbackStartedRef.current) return;
        const synth = synthRef.current;
        if (!synth) return;
        bridgeUtterance = new SpeechSynthesisUtterance('Hang on — let me get my bearings here.');
        pickVoice();
        if (voiceRef.current) bridgeUtterance.voice = voiceRef.current;
        bridgeUtterance.pitch = 0.95;
        bridgeUtterance.rate = 0.95;
        try { synth.speak(bridgeUtterance); } catch { /* best-effort cover */ }
      }, BRIDGE_AFTER_MS);
    }

    try {
      storyTimingRef.current.synthRequestAt = Date.now();
      let url: string;
      if (providedUrl) {
        // The audio existed before the story was even asked for: the synth
        // segment measures ~0 and counts as a cache hit.
        storyTimingRef.current.synthResolvedAt = Date.now();
        storyTimingRef.current.synthCacheHit = true;
        url = providedUrl;
      } else {
        const ttsResult = await Promise.race([
          geminiAudio.textToAudioUrl(fullText),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('TTS synthesis timed out')), TTS_SYNTH_TIMEOUT_MS)
          ),
        ]);
        storyTimingRef.current.synthResolvedAt = Date.now();
        storyTimingRef.current.synthCacheHit = ttsResult.cacheHit;
        url = ttsResult.url;
      }
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
        cancelBridge();
        onAir?.();
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
      await audio.play().catch((playError: unknown) => {
        playbackStartedRef.current = false;
        markAudioBlocked(
          playError instanceof DOMException && playError.name === 'NotAllowedError'
            ? 'blocked'
            : 'error'
        );
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
  const playSegmentsBrowser = useCallback((segments: string[], onDone: (blocked: boolean) => void, onAir?: () => void, tracked?: boolean) => {
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

    // The chain advances exactly once per sentence, whichever event
    // gets there first. A duplicated utterance — dispatchSpeech's
    // retry can re-speak an utterance whose start was merely late —
    // fires its end events twice, and two interleaved chains speaking
    // the same text was the audible "fallback on repeat" (Oct 26).
    // Two further guards on the same theme: the chain dispatches with
    // the retry disabled (a never-started sentence enters the attempt
    // economy instead of being re-spoken blind), and once the chain
    // has finished — for ANY reason, including a blocked settle that
    // requeued the item — it never advances again. A late-starting
    // utterance may finish its own sentence, but it cannot resurrect
    // the chain and speak the rest of an item the player has settled.
    let advancedThrough = -1;
    const advanceTo = (index: number) => {
      if (finished) return;
      if (index <= advancedThrough) return;
      advancedThrough = index;
      playSentence(index);
    };

    const playSentence = (index: number) => {
      if (finished) return;
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
        onAir?.();
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
        setTimeout(() => advanceTo(index + 1), pauseMs);
      };
      utterance.onerror = (event) => {
        playbackStartedRef.current = false;
        if (event.error === 'not-allowed') {
          markAudioBlocked('blocked');
          finish(true);
          return;
        }
        if (event.error !== 'interrupted' && event.error !== 'canceled') {
          console.error('Story speech error:', event);
        }
        if (tracked) {
          // A tracked line (the Q&A answer/bridge) that errors
          // mid-chain has NOT fully delivered, however many sentences
          // already sounded. Settling it as complete would report a
          // truncated answer as answered — re-enter the bounded
          // attempt economy instead, which either replays it whole or
          // settles it honestly as not delivered.
          finish(true);
          return;
        }
        finish(false);
      };

      // No blind retry in the queue chain: a sentence whose start is
      // merely late must not be duplicated (see dispatchSpeech), and
      // one that never starts enters the attempt economy via onBlocked.
      dispatchSpeech(utterance, () => started, () => finish(true), false);
    };

    advanceTo(0);
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

    // Every dequeue is one playback attempt, whatever exit it takes.
    // The blocked path below requeues the item, and this count is what
    // keeps that retry economy finite.
    item.attempts = (item.attempts ?? 0) + 1;

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

    // Lifecycle record for this dequeue. markSounded is the ONLY way
    // `sounded` becomes true — an engine event proving audio began —
    // and the record settles exactly once when the item leaves the
    // player (see onDone, the watchdog, skip, and stop). `completed`
    // is set ONLY by onDone's natural-completion path below: success
    // reported to a tracked owner means sounded AND finished, never
    // merely started.
    const playback = { gen, sounded: false, completed: false, onEnd: item.onPlaybackEnd };
    currentPlaybackRef.current = playback;
    // A tracked item (one carrying lifecycle callbacks — the Q&A
    // answer and bridge) gets honest-partial handling in both engines:
    // a mid-playback failure re-enters the attempt economy rather than
    // settling a fragment as delivered.
    const tracked = !!item.onPlaybackEnd;
    const markSounded = () => {
      if (playback.sounded) return;
      playback.sounded = true;
      item.onPlaybackStart?.();
    };

    // All playback gets Leo's real voice via Gemini TTS. Falls back to browser
    // voice if Gemini TTS is unavailable or fails.
    const useGeminiTTS = fullText.length > 0;

    const onDone = (blocked: boolean) => {
      if (gen !== playGenRef.current) return;

      isPlayingStoryRef.current = false;
      clearWatchdog();
      setIsSpeaking(false);

      if (blocked) {
        if ((item.attempts ?? 0) >= MAX_PLAYBACK_ATTEMPTS) {
          // Retry bound hit: this line cannot be heard right now, and
          // requeuing it forever was the Oct 26 fallback loop — the same
          // item re-attempted (and re-spoken) on every fetch trigger.
          // Settle it honestly (owner learns it never sounded) and let
          // the queue move on.
          console.warn('[Voice] Playback attempts exhausted — dropping this line and moving on');
          settleCurrentPlayback();
          setTimeout(() => playStoryFromQueueRef.current(), 100);
          return;
        }
        // Not an ending: the item goes back to the front of the queue
        // to be retried once sound is allowed, and its lifecycle
        // record goes with it — it will settle when it finally plays
        // (or leaves) on the next dequeue. Discard this dequeue's
        // record WITHOUT firing.
        if (currentPlaybackRef.current === playback) {
          currentPlaybackRef.current = null;
        }
        storyQueueRef.current.unshift(item);
        console.log('[Voice] Audio blocked — holding this story until sound is allowed');
        return;
      }

      // Natural completion: the engine ran the item to its end. Only
      // this path may mark the record completed — every other exit
      // (blocked above, watchdog, skip, stop) settles a tracked item
      // as not delivered.
      if (currentPlaybackRef.current === playback) {
        playback.completed = true;
      }
      settleCurrentPlayback();
      setTimeout(() => playStoryFromQueueRef.current(), 100);
    };

    if (item.localVoice) {
      // Canned opener lines are local-voice BY DESIGN: immediate (no
      // synthesis wait), quota-free, and immune to the TTS lane's state
      // — they speak while the story pipeline warms up behind them.
      playSegmentsBrowser([fullText], onDone, markSounded, tracked);
    } else if (useGeminiTTS) {
      playSegmentsWithGemini(fullText, onDone, item.audioUrl, markSounded, item.isLocationStory, tracked);
    } else {
      playSegmentsBrowser([fullText], onDone, markSounded, tracked);
    }
  }, [isStillRelevant, playSegmentsBrowser, playSegmentsWithGemini, clearWatchdog, settleCurrentPlayback]);

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
    } else {
      // Warm the next story's audio while the current item plays — this
      // overlap IS the runway: story #1's synthesis must run during the
      // opener, not serialized after it ends. The old gate (only once
      // playback had audibly started) left the common tour-start case —
      // story text ready while the intro's first utterance was still
      // spinning up — with a cold synthesis and a long silence after
      // the intro (Oct 26, start #3).
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
    topic?: string,
    audioUrl?: string
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
      audioUrl,
    });
  }, [enqueue]);

  // Queue a major-landmark story at the front of the waiting line. The
  // current story always finishes first; this only decides what comes next.
  const queuePriorityStory = useCallback((
    text: string,
    originLat?: number,
    originLng?: number,
    regionAnchored?: boolean,
    topic?: string,
    audioUrl?: string
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
      audioUrl,
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
    settleCurrentPlayback();
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
  }, [clearWatchdog, settleCurrentPlayback]);

  const muteForMinutes = useCallback((minutes: number) => {
    mutedUntilRef.current = Date.now() + minutes * 60_000;
    console.log(`[Voice] Muted for ${minutes} minutes`);
    playGenRef.current += 1;
    settleCurrentPlayback();
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
  }, [clearWatchdog, settleCurrentPlayback]);

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
    audioBlockedKind,
    wasInterrupted,
    unlock,
    ensureVoiceReady,
    initializeVoice,
    speak,
    speakTracked,
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
