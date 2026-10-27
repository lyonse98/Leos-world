import { useState, useCallback, useRef, useEffect } from 'react';
import {
  calculateDistance,
  bearingDegrees,
  headingDelta,
  resolveMovementMode,
  MovementModeHysteresis,
  estimateSpeechDurationS,
  storyReachM,
  storyBehindM,
  storyMaxAgeS,
} from '../utils/geo';
import { tasteProfile } from '../services/tasteProfile';
import { geminiAudio, TTS_MODEL } from '../services/geminiAudio';
import { quotaGuard } from '../services/quotaGuard';
import { audioHealth } from '../services/audioHealth';
import { latencyModel } from '../services/latencyModel';
import { analytics, trackDiag } from '../services/analytics';
// Depth-2 presynth peek (pre-publish stack Item 3): the buffered
// next-next story lives in storyCache. Acyclic — storyCache imports
// gemini/locationTracker/etc., never this hook.
import { storyCache } from '../services/storyCache';
import { pickStallPhrase, stallPhraseAudioUrl } from '../services/stallPhrases';

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
  // The reserved neighborhood-welcome serve (Pass 1, Oct 27, 2026). An
  // introServe item is protected in the queue: the single-slot
  // replacement and priority splices must not displace it before it
  // airs, and while the opener gate is armed it is the ONLY location
  // story allowed to start. Its settle releases the gate.
  introServe?: boolean;
  // Pre-made audio (curated library episode): playback uses this URL
  // directly and pre-synthesis skips the item entirely — the audio
  // already exists, so no quota is ever spent on it.
  audioUrl?: string;
  // Tell-geometry correlation (Area G, Oct 26, 2026): the per-story id
  // minted at the serve/prefetch decision, the projected center the
  // story was fetched for, and the horizon used — carried so playback
  // and drop events can report WHERE the subject was relative to the
  // listener and how wrong the prediction was. enqueuedAt/queueDepth
  // are stamped by enqueue() itself.
  storyId?: string;
  projectedCenter?: { lat: number; lng: number };
  horizonS?: number;
  enqueuedAt?: number;
  queueDepth?: number;
  // Per-item playback lifecycle, for items whose delivery must be
  // CONFIRMED rather than assumed (the Q&A answer). onPlaybackStart
  // fires when audio actually begins for this item; onPlaybackEnd
  // fires exactly once when the item leaves the player, reporting
  // whether it ever sounded. Queue movement alone proves nothing —
  // a failed item advances the queue exactly like a finished one.
  onPlaybackStart?: () => void;
  onPlaybackEnd?: (sounded: boolean) => void;
  // Full settle truth (Oct 26, 2026), fired alongside onPlaybackEnd
  // for items whose owner needs the details for analytics: whether
  // the item ran to natural completion, which engine actually
  // sounded it, how many attempts it took, and how long it sounded.
  onSettleDetail?: (info: PlaybackSettle) => void;
}

/** The complete truth about one item's final dequeue, at settle. */
export interface PlaybackSettle {
  sounded: boolean;
  completed: boolean;
  engine: 'gemini' | 'browser' | null;
  attempts: number;
  soundedMs: number;
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

// Behind-me staleness gate (Erik field report, Oct 24; generalized by
// Area D, Oct 26, 2026): the behind-you exemption is right at walking
// and dwell — absolute framing keeps a passed landmark worth hearing
// when you are barely moving. At freeway speed it broke down first (a
// story airing up to the full 2 km reach BEHIND the listener, over a
// minute of road already gone), so the original gate fired only there.
// The Oct 26 drive showed the same failure at surface-street speeds —
// stories narrated about places already passed — with no gate at all.
// Pass 1 started the 1500m band at 15 m/s and exempted region-anchored
// items from the rear cut entirely.
//
// Fix stack (RC-3, Oct 27, 2026): the gate's CONSTANTS are gone. Reach,
// max age, and the behind band are computed per item in utils/geo
// (storyReachM / storyMaxAgeS / storyBehindM), scaled by the item's
// estimated duration × the listener's speed — the fixed numbers were
// sized for short stories, and Pass 2's 75–110s highway tellings died
// against them mid-pipeline. The 15 m/s freeway band start and the
// region-anchor exemption survive inside the helpers. FREEWAY_SPEED_MPS
// stays 20 for the story_dropped source NAME ('stale_highway'), so
// drop-source comparisons across field tests stay apples-to-apples.
const FREEWAY_SPEED_MPS = 20; // ~45 mph — story_dropped source naming only

// Opener gate backstop (Pass 1, Oct 27, 2026): the gate holds landmark
// stories until the neighborhood welcome airs. If the welcome cannot
// be produced at all — generation keeps failing — the gate must not
// deadlock the tour: after this long armed, it releases itself and the
// tour proceeds with normal queueing. Three minutes is far beyond any
// healthy opener (welcome + clip + first generation ≈ 90s), so a
// release at the backstop is unambiguous evidence of a broken opener.
const OPENER_GATE_TIMEOUT_MS = 180_000;

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
// before a stored Puck stall phrase covers the wait. Long enough
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
  // The stall-phrase clip currently sounding, if any (see the arming
  // site in playSegmentsWithGemini). Hook-level so skip/mute — which
  // stop every other sound source individually — can stop it too.
  const stallAudioRef = useRef<HTMLAudioElement | null>(null);
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
    engine: 'gemini' | 'browser' | null;
    soundedAt: number | null;
    attempts: number;
    isLocationStory: boolean;
    topic: string | null;
    // The reserved neighborhood-welcome serve (Pass 1): its settle —
    // delivered or not — is what releases the opener gate, because the
    // gate's question ("has the welcome aired?") is answered either
    // way once the intro has had its dequeue.
    introServe?: boolean;
    onEnd?: (sounded: boolean) => void;
    onSettleDetail?: (info: PlaybackSettle) => void;
    // Tell geometry captured at dequeue (Area G): the item's
    // correlation fields plus the listener-relative measurements taken
    // at play start. Nulls mean "not measurable" (no anchor, no
    // position) and are simply absent from the settle event.
    storyId?: string;
    subjectLat?: number;
    subjectLng?: number;
    distanceM?: number;
    bearingOffsetDeg?: number;
    speedMps?: number | null;
    headingDeg?: number | null;
    queueDepth?: number;
    timeInQueueS?: number;
    toldLate?: boolean;
    horizonS?: number;
    predictionErrorM?: number;
  } | null>(null);
  const currentPositionProviderRef = useRef<(() => CurrentPosition | null) | null>(null);
  const lastKnownModeRef = useRef<MovementModeHysteresis>('stationary');
  // Audio is only permitted after a real user gesture. This records that the
  // engine has been woken once, so we do not waste the gesture.
  const unlockedRef = useRef<boolean>(false);
  // Latched forever once ANY prime (or any real playback) has succeeded:
  // the platform's unlock, once earned, is not lost — but a later prime
  // attempt can still REJECT (its play() lands outside a user-activation
  // window), and the old catch path wrote that rejection back into
  // unlockedRef, un-latching a good unlock. On the Oct 26, 2026 test
  // drive that is how whole tours lost their sonic floor: tour start
  // primes inside the tap, awaits the voice list (~2s), primes AGAIN —
  // the second prime's rejection cleared the first prime's unlock, the
  // welcome and opener sat held in pendingSpeechRef forever (no further
  // tap ever came in a moving car), and every story burned its three
  // attempts against a still-locked element. Once earned, never revoked.
  const everUnlockedRef = useRef<boolean>(false);
  // Generation counter for the audio-element prime in unlock(). Every
  // unlock() re-primes, and re-assigning the element's src ABORTS the
  // previous prime's play() — its promise then rejects and, unguarded,
  // the stale rejection landed AFTER the newer prime succeeded: it set
  // unlockedRef back to false and stripped the src out from under the
  // live prime, so a line already spoken (the tour-start welcome) sat
  // held in pendingSpeechRef waiting for an unlock that had, on paper,
  // already happened. Only the LATEST prime may write state or flush.
  const primeGenRef = useRef<number>(0);
  const audioBlockedRef = useRef<boolean>(false);
  // Increments every time playback ownership changes (new story, skip, mute).
  // Callbacks from a story that no longer owns the queue check this and bail,
  // so a cancelled story can never advance the queue out from under a newer one.
  const playGenRef = useRef<number>(0);
  // Tracks the text currently being pre-synthesized so we don't kick off
  // duplicate TTS calls for the same story.
  const preSynthTextRef = useRef<string | null>(null);
  // Presynth depth 2 + readiness (pre-publish stack Item 3, Oct 27,
  // 2026): the depth-2 text has its OWN dedupe slot (one text per
  // depth — sharing the depth-1 slot would let the two depths starve
  // each other's dedupe); warmedTextRef records the text whose
  // depth-1 synthesis actually RESOLVED, which is what "warm" means
  // for the readiness check (a fired-but-failed presynth is not
  // warm); presynthMissRef dedupes the miss diagnostic + escalation
  // to once per next-item text.
  const preSynthText2Ref = useRef<string | null>(null);
  const warmedTextRef = useRef<string | null>(null);
  const presynthMissRef = useRef<string | null>(null);
  // The readiness check is defined late in the hook (it needs
  // getCurrentStoryRemainingS) but runs from the watchdog — the ref
  // bridge is the same pattern as preSynthesizeNextRef.
  const checkPresynthReadinessRef = useRef<(() => void) | null>(null);
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
    // stage/reason/message ride along (Oct 26, 2026) so the block is
    // readable per-event through the recent-events view, in the same
    // vocabulary as pipeline_diag, instead of existing only as a
    // banner Erik had to describe from memory.
    try {
      analytics.track('audio_blocked', null, undefined, {
        source: kind,
        kind,
        stage: 'playback',
        reason: kind,
        message: kind === 'blocked'
          ? 'audio blocked by the platform (autoplay/permission)'
          : 'audio error (synthesis or playback failure)',
      });
    } catch { /* a metric must never break the banner */ }
  };
  // Set when the listener returns to a tour whose audio the platform paused.
  // Surfaces as "tap to resume" instead of leaving them in unexplained silence.
  const [wasInterrupted, setWasInterrupted] = useState<boolean>(false);
  // Tracks whether Gemini TTS is active or why it fell back, surfaced in
  // diagnostics so the reason for browser voice is visible.
  const [ttsStatus, setTtsStatus] = useState<string>('idle');
  const backgroundedRef = useRef<boolean>(false);
  // Opener gate state (Pass 1, Oct 27, 2026): armed by the app at tour
  // start via beginOpenerGate(); while armed, playStoryFromQueue may
  // start ONLY the introServe item (plus scripted lines, which are the
  // welcome/clip the gate exists to protect). Released by the intro's
  // settle, by the intro being stale-dropped, or by the timeout
  // backstop timer — never by an ordinary story starting.
  const openerGateRef = useRef<{ armedAt: number } | null>(null);
  const openerGateTimerRef = useRef<number | null>(null);
  // T6 order guard (fix stack, Oct 27, 2026): latched the moment an
  // introServe item is dequeued into the player. Held welcome/opener
  // lines belong BEFORE the neighborhood intro; once the intro has
  // started they must never flush after it (the sim-proven hole:
  // primes never land, the intro sounds through the element, the
  // flush fires late and the welcome talks over the intro's tail).
  // flushHeldLines settles held lines undelivered instead once this
  // is set. Reset at every gate-begin (a new tour's opener).
  const introStartedRef = useRef<boolean>(false);
  // The queue item currently in the player, retained so a return from
  // backgrounding can restart IT (replay/re-speak) instead of abandoning
  // it to the watchdog. Set at dequeue; cleared at settle, and on the
  // blocked-requeue discard (where the item returns to the queue).
  const currentItemRef = useRef<StoryQueueItem | null>(null);
  // Topic of the location story that was mid-play when the page last
  // hid. If that story settles not-delivered, the app is told (via
  // onStoryInterruptedRef) so it can release the story from the told
  // set / session lock — a story the platform killed can be retold
  // later in the drive instead of being lost having never been heard.
  const backgroundedTopicRef = useRef<string | null>(null);
  const onStoryInterruptedRef = useRef<((topic: string) => void) | null>(null);
  // A line requested before the first gesture is held here and spoken the
  // instant the listener taps, since that tap is what permits sound.
  // Held lines are an ordered QUEUE, not a single slot: tour start speaks
  // two lines back-to-back inside the tap (the canned local welcome, then
  // the pre-rendered Puck opener), and both can land here while the prime
  // is still resolving — a single slot would have overwritten the welcome
  // with the opener and lost it.
  const pendingSpeechRef = useRef<Array<{ text: string; localVoice?: boolean; audioUrl?: string; onSettle?: (info: PlaybackSettle) => void }>>([]);
  const speakRef = useRef<(text: string, opts?: { localVoice?: boolean; audioUrl?: string; onSettle?: (info: PlaybackSettle) => void }) => void>(() => {});
  const pendingTrackedRef = useRef<{
    text: string;
    onPlaybackStart?: () => void;
    onPlaybackEnd?: (sounded: boolean) => void;
    onSettleDetail?: (info: PlaybackSettle) => void;
    front?: boolean;
  } | null>(null);
  const speakTrackedRef = useRef<(
    text: string,
    cbs: { onPlaybackStart?: () => void; onPlaybackEnd?: (sounded: boolean) => void; onSettleDetail?: (info: PlaybackSettle) => void },
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
  // Speak everything being held for the unlock, in order, with callbacks
  // intact. Called from every path that establishes or re-asserts the
  // unlock: a prime landing, a later unlock() call, and — the self-healing
  // path — any playback that PROVES the element is unlocked by sounding.
  const flushHeldLines = useCallback(() => {
    const held = pendingSpeechRef.current;
    if (held.length > 0) {
      pendingSpeechRef.current = [];
      if (introStartedRef.current) {
        // Order guard (fix stack, sim hole T6): the neighborhood
        // intro has already started, so these held welcome/opener
        // lines can no longer take their place in the sequence —
        // speaking them now would put the welcome AFTER the intro it
        // exists to precede. Settle them undelivered instead: their
        // owners record an honest no-sound, and nothing held can
        // ever flush late again.
        const undelivered: PlaybackSettle = {
          sounded: false, completed: false, engine: null, attempts: 0, soundedMs: 0,
        };
        for (const line of held) {
          line.onSettle?.(undelivered);
        }
        try {
          trackDiag('playback', 'opener-order-guard', `${held.length} held opener line(s) suppressed — the intro had already started`);
        } catch { /* diagnostics only */ }
      } else {
        for (const line of held) {
          speakRef.current(line.text, { localVoice: line.localVoice, audioUrl: line.audioUrl, onSettle: line.onSettle });
        }
      }
    }
    const heldTracked = pendingTrackedRef.current;
    if (heldTracked) {
      pendingTrackedRef.current = null;
      speakTrackedRef.current(heldTracked.text, heldTracked, { front: heldTracked.front });
    }
  }, []);

  // Playback that actually sounded IS an unlock, whatever the prime
  // bookkeeping believes: latch it and flush anything still held, so a
  // tour whose primes all missed still gets its welcome and opener the
  // moment the first story proves the speaker works (Area A, Oct 26,
  // 2026: on the test drive the primes never landed, the held welcome
  // and opener never fired, and no opener event existed for any tour).
  const markProvenUnlock = useCallback(() => {
    everUnlockedRef.current = true;
    unlockedRef.current = true;
    flushHeldLines();
  }, [flushHeldLines]);

  const unlock = useCallback(() => {
    // Resume the speech synth in case the platform paused it while
    // backgrounded — needed on every call, latched or not.
    const synth = synthRef.current;
    if (synth) {
      try { synth.resume(); } catch { /* engine missing */ }
    }

    // Once an unlock has been EARNED (a prime landed, or real audio
    // sounded), never prime again: the element stays unlocked for the
    // session, and a fresh prime can only do harm — its src assignment
    // churns the very element stories play on, and its rejection (the
    // call landing outside a user-activation window — tour start primes
    // in the tap, awaits the voice list for up to 2s, then primes AGAIN)
    // used to write unlockedRef back to false, un-latching the earned
    // unlock and stranding every held line for the rest of the tour.
    // Before the first earned unlock, priming still runs on EVERY call:
    // the old first-prime latch made the "your browser muted Leo" banner
    // a dead end (a prime that missed the activation window latched
    // anyway, and later banner taps early-returned without re-priming),
    // so the latch below is set only by a prime that actually succeeds.
    if (everUnlockedRef.current) {
      unlockedRef.current = true;
      flushHeldLines();
      return;
    }

    const audio = audioElRef.current;
    if (audio) {
      const primeGen = ++primeGenRef.current;
      audio.muted = true;
      audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      audio.play().then(() => {
        // A newer unlock() has re-primed since this attempt began; this
        // settlement belongs to a dead prime and must not touch state.
        if (primeGen !== primeGenRef.current) return;
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        audio.removeAttribute('src');
        everUnlockedRef.current = true;
        unlockedRef.current = true;
        // The prime just landed — NOW any line being held can actually
        // be heard. Flush it here, not only in unlock(): the tour-start
        // flow speaks the intro after its last unlock() call, and if
        // the prime hadn't resolved yet the intro was held in
        // pendingSpeechRef with no further unlock coming — in a car,
        // possibly no tap ever — so the welcome simply never sounded.
        // A held line must be spoken the moment the engine unlocks,
        // whoever's call made it happen.
        flushHeldLines();
      }).catch(() => {
        // Same generation guard as the success path: an aborted prime
        // (killed by the next unlock's src assignment) must not reset
        // the unlock a newer prime already earned, nor strip its src.
        if (primeGen !== primeGenRef.current) return;
        audio.muted = false;
        audio.removeAttribute('src');
        // A failed prime proves only that THIS attempt failed. It must
        // never revoke an unlock an earlier prime — or real playback —
        // already earned.
        if (!everUnlockedRef.current) unlockedRef.current = false;
      });
    }

    flushHeldLines();
  }, [flushHeldLines]);

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

    // Ended flag (fix stack RC-5): if the utterance ends or errors
    // before a never-began check fires, the check stands down — the
    // utterance's own handlers already settled this attempt, and the
    // timer's markAudioBlocked double-counted one failure as two
    // audio_blocked events (different kinds, same attempt). The
    // caller's handlers are wrapped, not replaced.
    let ended = false;
    const prevOnEnd = utterance.onend;
    const prevOnError = utterance.onerror;
    utterance.onend = (event) => {
      ended = true;
      if (prevOnEnd) prevOnEnd.call(utterance, event);
    };
    utterance.onerror = (event) => {
      ended = true;
      if (prevOnError) prevOnError.call(utterance, event);
    };

    const declareBlocked = () => {
      console.warn('[Voice] Speech never began — audio appears to be blocked');
      markAudioBlocked('error');
      onBlocked?.();
    };

    const attempt = (mayRetry: boolean) => {
      synth.resume();
      synth.speak(utterance);

      window.setTimeout(() => {
        if (hasStarted() || ended) return;
        if (mayRetry && allowRetry) {
          console.log('[Voice] Speech did not begin — retrying once');
          attempt(false);
          return;
        }
        // Never-began verdict (fix stack RC-5): the old check
        // convicted on !hasStarted() alone — but a start can be
        // merely LATE, which the watchdog already knows: an engine
        // reporting speaking/pending is working, not blocked. A busy
        // engine earns ONE recheck (+3s); only an idle engine — or a
        // still-silent one at the recheck — is declared blocked.
        // Detector and watchdog now read the same evidence the same
        // way, so audio_blocked means failure, not slowness.
        if (synth.speaking || synth.pending) {
          window.setTimeout(() => {
            if (hasStarted() || ended) return;
            declareBlocked();
          }, 3000);
          return;
        }
        declareBlocked();
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
    onSettleDetail?: (info: PlaybackSettle) => void;
  }, opts?: { localVoice?: boolean; front?: boolean; audioUrl?: string }) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const item: StoryQueueItem = {
      text: trimmed,
      generatedAt: Date.now(),
      isLocationStory: false,
      localVoice: opts?.localVoice,
      audioUrl: opts?.audioUrl,
      onPlaybackStart: cbs?.onPlaybackStart,
      onPlaybackEnd: cbs?.onPlaybackEnd,
      onSettleDetail: cbs?.onSettleDetail,
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

  const speak = useCallback((text: string, opts?: { localVoice?: boolean; audioUrl?: string; onSettle?: (info: PlaybackSettle) => void }) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Before the first gesture nothing can be heard anyway, so hold the line
    // and let the unlock step speak it. Dropping it here would silently lose
    // whatever the app most wanted to say.
    if (!unlockedRef.current) {
      pendingSpeechRef.current.push({ text: trimmed, localVoice: opts?.localVoice, audioUrl: opts?.audioUrl, onSettle: opts?.onSettle });
      return;
    }

    speakPriority(trimmed, opts?.onSettle ? { onSettleDetail: opts.onSettle } : undefined, opts);
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
    onSettleDetail?: (info: PlaybackSettle) => void;
  }, opts?: { front?: boolean }) => {
    const trimmed = text.trim();
    if (!trimmed) {
      cbs.onPlaybackEnd?.(false);
      return;
    }

    if (!unlockedRef.current) {
      // The held slot holds ONE tracked line. Replacing it must settle
      // the line it displaces (terminal guarantee): a held Q&A answer
      // overwritten by a later tracked line used to vanish exactly like
      // a queue-cleared one — its owner waiting on callbacks that would
      // never fire.
      const displaced = pendingTrackedRef.current;
      if (displaced) {
        const info: PlaybackSettle = { sounded: false, completed: false, engine: null, attempts: 0, soundedMs: 0 };
        displaced.onSettleDetail?.(info);
        displaced.onPlaybackEnd?.(false);
      }
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

  // Opener gate (Pass 1, Oct 27, 2026). Erik's required sequence is
  // generic welcome → neighborhood welcome → landmarks, and on the
  // Oct 27 commute the first audible thing was a landmark: the reserved
  // intro serve could be displaced in the queue, consumed by a failed
  // generation, or simply beaten to the speaker. The gate makes the
  // order structural instead of hopeful: from tour start until the
  // neighborhood welcome has aired, no landmark/area story may START.
  // Release is always on the record (pipeline_diag), whatever the path.
  const beginOpenerGate = useCallback(() => {
    openerGateRef.current = { armedAt: Date.now() };
    introStartedRef.current = false;
    // Backstop armed HERE, at gate-begin (fix stack D2, Oct 27,
    // 2026). Pass 1 armed this timer lazily inside playStoryFromQueue
    // — only when a landmark head happened to reach the gate check —
    // so in the locked state the audit reproduced (intro blocked and
    // requeued, nothing else ever dequeuing) the timer was never
    // armed at all and the gate could hold landmarks hostage far
    // past its own backstop. The release now lands at the backstop
    // whatever the queue does.
    if (openerGateTimerRef.current !== null) {
      clearTimeout(openerGateTimerRef.current);
    }
    openerGateTimerRef.current = window.setTimeout(() => {
      openerGateTimerRef.current = null;
      releaseOpenerGate('timeout');
      playStoryFromQueueRef.current();
    }, OPENER_GATE_TIMEOUT_MS);
  }, []);

  const releaseOpenerGate = useCallback((reason: string) => {
    if (!openerGateRef.current) return;
    openerGateRef.current = null;
    if (openerGateTimerRef.current !== null) {
      clearTimeout(openerGateTimerRef.current);
      openerGateTimerRef.current = null;
    }
    try { trackDiag('playback', 'opener-gate-release', reason); } catch { /* diagnostics only */ }
    console.log(`[Voice] Opener gate released (${reason})`);
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
    currentItemRef.current = null;
    const delivered = pb.sounded && pb.completed;
    // Opener gate release (Pass 1): the welcome has aired (or had its
    // chance and failed) — landmarks may start now either way. If the
    // intro FAILED, proceeding beats deadlocking the tour in silence.
    if (pb.introServe) {
      releaseOpenerGate(delivered ? 'intro-aired' : 'intro-settled-undelivered');
    }
    // Backgrounding release (Pass 1): a location story that was
    // mid-play when the page hid and now settles NOT delivered was
    // killed by the platform, not heard. Tell the app its topic so it
    // can be released from the told set / session lock and retold
    // later in the drive.
    if (pb.isLocationStory && pb.topic && backgroundedTopicRef.current === pb.topic) {
      backgroundedTopicRef.current = null;
      if (!delivered) {
        onStoryInterruptedRef.current?.(pb.topic);
      }
    }
    const settle: PlaybackSettle = {
      sounded: pb.sounded,
      completed: pb.completed,
      engine: pb.engine,
      attempts: pb.attempts,
      soundedMs: pb.soundedAt !== null ? Math.max(0, Date.now() - pb.soundedAt) : 0,
    };
    // Per-story settle truth (Oct 26, 2026): story_timing proves a
    // story's generation latency, but nothing recorded whether its
    // playback actually completed or was cut — truncations were only
    // visible as aggregate audio_blocked counts. Location stories now
    // settle on the record, so a cut-off is countable per event.
    if (pb.isLocationStory) {
      try {
        // Tell geometry rides the settle (Area G): RELATIVE geometry
        // only — subject anchor (public place coordinates), distance,
        // bearing offset, speed/heading, queue wait, lateness, and the
        // prediction error of the fetch that produced the story. The
        // listener's own coordinates are never in the payload (they
        // exist only in the sealed table's lat/lng columns).
        const payload: Record<string, unknown> = {
          completed: settle.completed,
          engine: settle.engine ?? 'none',
          attempts: settle.attempts,
          topic: pb.topic ?? '',
        };
        if (pb.storyId) payload.story_id = pb.storyId;
        if (pb.subjectLat !== undefined && pb.subjectLng !== undefined) {
          payload.subject_lat = pb.subjectLat;
          payload.subject_lng = pb.subjectLng;
        }
        if (pb.distanceM !== undefined) payload.distance_m = Math.round(pb.distanceM);
        if (pb.bearingOffsetDeg !== undefined) payload.bearing_offset_deg = Math.round(pb.bearingOffsetDeg);
        if (pb.speedMps !== undefined) payload.speed_mps = pb.speedMps === null ? null : Math.round(pb.speedMps * 10) / 10;
        if (pb.headingDeg !== undefined) payload.heading_deg = pb.headingDeg === null ? null : Math.round(pb.headingDeg);
        if (pb.queueDepth !== undefined) payload.queue_depth = pb.queueDepth;
        if (pb.timeInQueueS !== undefined) payload.time_in_queue_s = Math.round(pb.timeInQueueS * 10) / 10;
        if (pb.toldLate !== undefined) payload.told_late = pb.toldLate;
        if (pb.horizonS !== undefined) payload.horizon_s = pb.horizonS;
        if (pb.predictionErrorM !== undefined) payload.prediction_error_m = Math.round(pb.predictionErrorM);
        // Exit-corridor readiness (fix stack item 9, Oct 27, 2026):
        // told_late judges the story at its START (rear hemisphere
        // while driving). This judges it at its END: where the subject
        // sits relative to the listener when the telling finishes,
        // and whether it is still inside the duration×speed reach —
        // the measure the highway doctrine (banked/region material
        // over cold generation that cannot land) is tuned against.
        // Only for stories that actually sounded.
        if (pb.sounded && pb.subjectLat !== undefined && pb.subjectLng !== undefined) {
          const endPos = currentPositionProviderRef.current?.();
          if (endPos) {
            const endDistM = calculateDistance(endPos.lat, endPos.lng, pb.subjectLat, pb.subjectLng);
            payload.end_distance_m = Math.round(endDistM);
            if (typeof endPos.heading === 'number') {
              payload.end_bearing_offset_deg = Math.round(
                headingDelta(bearingDegrees(endPos, { lat: pb.subjectLat, lng: pb.subjectLng }), endPos.heading)
              );
            }
            const endMode = resolveMovementMode(endPos.speed, lastKnownModeRef.current);
            payload.corridor_ok =
              endDistM <= storyReachM(endMode, endPos.speed ?? 0, Math.max(10, settle.soundedMs / 1000));
          }
        }
        analytics.track('story_playback', null, undefined, payload);
      } catch { /* a metric must never break a settle */ }
      // Feed the adaptive look-ahead (Area D): how long stories
      // actually sound is one of its three inputs.
      if (settle.sounded && settle.soundedMs > 0) {
        latencyModel.recordStoryDuration(settle.soundedMs / 1000);
      }
    }
    pb.onSettleDetail?.(settle);
    pb.onEnd?.(delivered);
  }, []);

  // Settle everything that will never reach the player because the
  // queue is being torn down — the terminal guarantee (Area B, Oct 26,
  // 2026). settleCurrentPlayback covers the item IN the player; items
  // still WAITING, and lines still HELD for the unlock, used to be
  // discarded silently when stop()/skip/mute cleared the queue. That
  // is how the test drive's Q&A answer vanished without a trace:
  // generated in 4.1s, handed to a tracked slot that never dequeued,
  // then the tour ended and the queue clear dropped it — no
  // question_playback (its settle never fired) and no observable lock
  // release. Now every tracked item settles exactly once on EVERY
  // exit: played, exhausted, or torn down.
  //
  // Fix stack (RC-2 invariant, Oct 27, 2026): a WAITING location story
  // torn down here also emits its story_dropped terminal record, so
  // every story_played the app emitted reaches exactly one terminal
  // record (story_playback or story_dropped) — teardown used to be
  // the silent third outcome. The origin names the exit so a drop is
  // attributable: tour end, skip flush, or mute flush.
  const settleQueuedTrackedItems = useCallback((origin: string = 'teardown') => {
    const undelivered: PlaybackSettle = {
      sounded: false, completed: false, engine: null, attempts: 0, soundedMs: 0,
    };
    for (const item of storyQueueRef.current) {
      if (item.isLocationStory) {
        try {
          analytics.track('story_dropped', null, undefined, {
            source: origin,
            topic: item.topic ?? '',
            story_id: item.storyId ?? '',
            distance_m: null,
            bearing_offset_deg: null,
          });
        } catch { /* a metric must never break a teardown */ }
        if (item.introServe) releaseOpenerGate('intro-dropped-teardown');
      }
      if (!item.onPlaybackEnd && !item.onSettleDetail) continue;
      const info: PlaybackSettle = { ...undelivered, attempts: item.attempts ?? 0 };
      item.onSettleDetail?.(info);
      item.onPlaybackEnd?.(false);
    }
    const heldTracked = pendingTrackedRef.current;
    if (heldTracked) {
      pendingTrackedRef.current = null;
      heldTracked.onSettleDetail?.(undelivered);
      heldTracked.onPlaybackEnd?.(false);
    }
    // Held scripted lines carrying a settle (the tour-start welcome and
    // opener) settle too: torn down before the unlock is still a
    // terminal state, and the opener audit must be able to see it.
    const heldLines = pendingSpeechRef.current;
    pendingSpeechRef.current = [];
    for (const line of heldLines) {
      line.onSettle?.(undelivered);
    }
  }, []);

  const stop = useCallback(() => {
    playGenRef.current += 1;
    settleCurrentPlayback();
    settleQueuedTrackedItems('tour-ended');
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
    preSynthText2Ref.current = null;
    presynthMissRef.current = null;
    playbackStartedRef.current = false;
    // Tour teardown retires the opener machinery with everything else:
    // a stopped tour must not leave a gate (or its backstop timer)
    // armed against the next tour's first story.
    openerGateRef.current = null;
    introStartedRef.current = false;
    if (openerGateTimerRef.current !== null) {
      clearTimeout(openerGateTimerRef.current);
      openerGateTimerRef.current = null;
    }
    currentItemRef.current = null;
    backgroundedTopicRef.current = null;
    clearWatchdog();
  }, [clearWatchdog, settleCurrentPlayback, settleQueuedTrackedItems]);

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

      // Presynth readiness (pre-publish stack Item 3): the watchdog's
      // 2s tick is the player's heartbeat — the natural place to
      // notice the next story's audio will not be warm in time.
      checkPresynthReadinessRef.current?.();

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

  // True at driving speeds, with a known direction of travel, when the
  // story's anchor sits far BEHIND the listener (>90° off heading,
  // beyond the duration×speed threshold from utils/geo storyBehindM).
  // Conservative by design: any unknown → false. Region-anchored items
  // are EXEMPT (Pass 1, Oct 27, 2026): a driving serve is anchored to
  // the region the listener is travelling through, not to a point that
  // can be passed — the rear cut was documented as removed for exactly
  // these items but ran unconditionally, and at ~40 mph it killed
  // stories ~35s into the pipeline. Their outer limits are the reach
  // bound and the max age, both enforced in isStillRelevant.
  const isFarBehindAtSpeed = (item: StoryQueueItem, current: CurrentPosition, d: number): boolean => {
    if (item.regionAnchored) return false;
    if (item.lat === undefined || item.lng === undefined) return false;
    if (typeof current.speed !== 'number') return false;
    const threshold = storyBehindM(current.speed, estimateSpeechDurationS(item.text));
    if (!Number.isFinite(threshold) || d <= threshold) return false;
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

    // Duration×speed geometry (fix stack RC-3): every bound below is
    // scaled by THIS item's estimated telling length — a 100-second
    // highway story is still describing the listener's road when a
    // 30-second story about the same anchor would be stale. And
    // item.generatedAt is now the story's true generation time
    // (threaded from the serve, not re-stamped at enqueue), so the
    // age bound measures generation age, never queue wait alone.
    const durationS = estimateSpeechDurationS(item.text);
    const speed = current.speed ?? 0;

    const d = calculateDistance(current.lat, current.lng, item.lat, item.lng);
    if (d > storyReachM(mode, speed, durationS)) return false;

    // Behind-me cut (point-anchored items only — isFarBehindAtSpeed
    // exempts region-anchored ones): at driving speeds an anchor far
    // behind the direction of travel is out of the area the listener
    // is in — drop it rather than narrate yesterday's road. The drop
    // itself is reported by the dequeue loop (single emit point, with
    // tell geometry — Area G).
    if (isFarBehindAtSpeed(item, current, d)) {
      return false;
    }

    // Region-anchored stories have no single spot to pass: with
    // absolute geographic framing, a story about the area stays worth
    // hearing across the whole reach. They are bounded by the reach
    // check above and the age check below — nothing else.

    const age = Date.now() - item.generatedAt;
    if (age > storyMaxAgeS(durationS) * 1000) return false;

    return true;
  }, []);

  // --- Story queue system ---

  // Play story text with Gemini native TTS (Leo's real voice). Falls back to
  // browser SpeechSynthesis if Gemini TTS is unavailable or fails — so the
  // tour still works offline or before the audio service initializes.
  const preSynthesizeNext = useCallback(() => {
    // Circuit breaker: no pre-synthesis while the TTS lane is tripped.
    if (quotaGuard.isTripped('tts', TTS_MODEL)) return;
    // Storm economy (Area B): while the GEMINI engine is tripped,
    // warming live audio spends quota on sound that engine currently
    // cannot play (preferBanked() is the Gemini-engine trip, fix
    // stack RC-6). Banked items never reach this path (they skip
    // below), so pausing here costs the tour nothing it could hear.
    if (audioHealth.preferBanked()) return;
    if (!geminiAudio.hasModel()) {
      try { geminiAudio.initialize(); } catch { return; }
    }
    if (!geminiAudio.hasModel()) return;

    const presynthPos = currentPositionProviderRef.current?.();

    // One warming path for both depths (pre-publish stack Item 3):
    // dedupe by text per depth, record warmth on resolve, and clear
    // the dedupe slot when a synthesis FAILS so a later trigger may
    // retry it (previously a failed depth-1 presynth could never be
    // re-attempted for that text — the readiness check below exists
    // precisely for that hole).
    const warmText = (fullText: string, slot: { current: string | null }, isDepth1: boolean) => {
      if (!fullText || fullText.trim().length === 0) return;
      if (slot.current === fullText) return;
      slot.current = fullText;
      console.log(`[Voice] Pre-synthesizing ${isDepth1 ? 'next' : 'depth-2'} story audio`);
      geminiAudio.textToAudioUrl(fullText).then((result) => {
        if (isDepth1) warmedTextRef.current = fullText;
        if (result.cacheHit) {
          console.log('[Voice] Pre-synthesis was a cache hit — already warm');
        }
      }).catch(() => {
        // Best-effort — a failed pre-synthesis just means the story
        // synthesizes on demand as before. The slot clears so the
        // failure is retryable rather than latched.
        if (slot.current === fullText) slot.current = null;
      });
    };

    const next = storyQueueRef.current[0];
    let depth1WarmOrWarming = false;
    if (next && !next.audioUrl) {
      // Library stories arrive with their audio already made — never
      // spend synthesis quota warming them. (audioUrl set = banked =
      // already warm by definition; it also satisfies depth 2's
      // priority rule below.)
      // Don't spend synthesis (quota) on a story the behind-me
      // staleness gate will drop at dequeue — a far-behind next story
      // is exactly the one most likely never to air.
      let stale = false;
      if (presynthPos && next.lat !== undefined && next.lng !== undefined) {
        const dNext = calculateDistance(presynthPos.lat, presynthPos.lng, next.lat, next.lng);
        if (isFarBehindAtSpeed(next, presynthPos, dNext)) {
          console.log('[Voice] Skipping pre-synthesis — next story is stale behind-me content');
          stale = true;
        }
      }
      if (!stale) {
        const fullText = next.transitionText ? `${next.transitionText} ${next.text}` : next.text;
        warmText(fullText, preSynthTextRef, true);
        depth1WarmOrWarming =
          warmedTextRef.current === fullText || preSynthTextRef.current === fullText;
      }
    } else if (next?.audioUrl) {
      depth1WarmOrWarming = true; // banked: nothing to warm
    }

    // Depth 2 (Item 3): warm the story AFTER the queued one, in
    // queue order (Item 7 coherence, Oct 27, 2026). The waiting
    // queue usually holds ONE location story
    // (MAX_PENDING_LOCATION_STORIES = 1), but a warm-head-inserted
    // priority item sits at position 2 — and it is the item depth 2
    // exists for: when the head drops as stale, the priority item
    // advances early and must already be warm. So depth 2 targets
    // storyQueue[1] first when it is a location story; only when
    // the queue holds nothing behind the head does depth 2 reach
    // into the story buffer (storyCache.peekNextBufferedStory —
    // the entry that would serve next, peek-only). Priority
    // discipline: depth 2 spends ONLY when depth 1 is already warm
    // or warming (or the queue is empty, i.e. depth 1 does not
    // exist) — the second story never competes with the first for
    // the synthesis lane. Every stand-down above (quota trip,
    // engine trip) already returned, so depth collapses under
    // pressure exactly as depth 1 does today.
    const second = storyQueueRef.current[1];
    if ((depth1WarmOrWarming || !next) && second?.isLocationStory && !second.audioUrl) {
      let staleSecond = false;
      if (presynthPos && second.lat !== undefined && second.lng !== undefined) {
        const dSecond = calculateDistance(presynthPos.lat, presynthPos.lng, second.lat, second.lng);
        if (isFarBehindAtSpeed(second, presynthPos, dSecond)) staleSecond = true;
      }
      if (!staleSecond) {
        const secondText = second.transitionText ? `${second.transitionText} ${second.text}` : second.text;
        warmText(secondText, preSynthText2Ref, false);
      }
    } else if ((depth1WarmOrWarming || !next) && presynthPos) {
      // The peek reads lat/lng/speed only; accuracy is the one
      // Position field the player's own position type does not carry,
      // and nothing in the peek path consults it.
      const peek = storyCache.peekNextBufferedStory(
        { lat: presynthPos.lat, lng: presynthPos.lng, speed: presynthPos.speed, heading: presynthPos.heading, accuracy: 0 },
        next?.storyId
      );
      if (peek && !peek.audioUrl) {
        const pseudoItem = {
          text: peek.text,
          lat: peek.lat,
          lng: peek.lng,
          regionAnchored: peek.regionAnchored,
        } as StoryQueueItem;
        const dPeek = calculateDistance(presynthPos.lat, presynthPos.lng, peek.lat, peek.lng);
        if (!isFarBehindAtSpeed(pseudoItem, presynthPos, dPeek)) {
          warmText(peek.text, preSynthText2Ref, false);
        }
      }
    }
  }, []);

  const preSynthesizeNextRef = useRef(preSynthesizeNext);
  preSynthesizeNextRef.current = preSynthesizeNext;

  const playSegmentsWithGemini = useCallback(async (fullText: string, onDone: (blocked: boolean) => void, providedUrl?: string, onAir?: (engine: 'gemini' | 'browser') => void, isLocationStory?: boolean, tracked?: boolean) => {
    // Stall-phrase state (see the arming site below): declared first
    // because finish() — which can fire synchronously on the init-fail
    // path — must be able to cancel it.
    let bridgeTimer: number | null = null;
    let bridgeAudio: HTMLAudioElement | null = null;
    let bridgeFadeTimer: number | null = null;
    const retireBridgeEl = (el: HTMLAudioElement) => {
      if (bridgeAudio === el) bridgeAudio = null;
      if (stallAudioRef.current === el) stallAudioRef.current = null;
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch { /* element already gone */ }
    };
    // Hard exit — every cancel except "the story's own audio just
    // started" lands here: immediate silence, nothing lingers.
    const cancelBridge = () => {
      if (bridgeTimer !== null) {
        clearTimeout(bridgeTimer);
        bridgeTimer = null;
      }
      if (bridgeFadeTimer !== null) {
        clearInterval(bridgeFadeTimer);
        bridgeFadeTimer = null;
      }
      if (bridgeAudio) retireBridgeEl(bridgeAudio);
    };
    // Duck exit — ONLY for the moment the story's own Gemini audio
    // starts (audio.onplaying): the phrase ramps to zero over ~250 ms
    // under the story's first quarter-second instead of chopping
    // mid-word (Erik, Oct 26: a fade reads as a deliberate duck; a
    // hard cut reads as a glitch). Any hard cancel during the ramp
    // clears the interval and silences the element at once, so a fade
    // can never leak past a skip, a settle, or a fallback.
    const fadeBridge = () => {
      if (bridgeTimer !== null) {
        clearTimeout(bridgeTimer);
        bridgeTimer = null;
      }
      const el = bridgeAudio;
      if (!el || bridgeFadeTimer !== null) return;
      const startVolume = el.volume;
      const steps = 10;
      let step = 0;
      bridgeFadeTimer = window.setInterval(() => {
        step++;
        if (bridgeAudio !== el || el.paused) {
          // Retired, stopped, or replaced mid-ramp — the exit is
          // owned elsewhere now; just stop ticking.
          if (bridgeFadeTimer !== null) { clearInterval(bridgeFadeTimer); bridgeFadeTimer = null; }
          return;
        }
        try { el.volume = Math.max(0, startVolume * (1 - step / steps)); } catch { /* element already gone */ }
        if (step >= steps) {
          if (bridgeFadeTimer !== null) { clearInterval(bridgeFadeTimer); bridgeFadeTimer = null; }
          retireBridgeEl(el);
        }
      }, 25);
    };

    let finished = false;
    const finish = (blocked: boolean) => {
      if (finished) return;
      finished = true;
      cancelBridge();
      onDone(blocked);
    };

    const fallbackToBrowser = (reason: string) => {
      // The browser voice is about to speak this item — a stall phrase
      // must never talk over it. (With the old device-voice bridge this
      // was free: both lines shared the one speech queue. A stored
      // audio clip plays on its own element, so it is cut explicitly.)
      cancelBridge();
      // Capture the failure into the event stream (Oct 26, 2026): a
      // TTS failure used to exist only as this console line and the
      // diagnostics-panel status, both gone with the session. Now it
      // is a pipeline_diag row — stage 'tts', reason 'fallback' when
      // the browser lane engages for the item, 'tts-error' when the
      // Gemini audio died mid-playback — readable per-event through
      // the recent-events view. Message is sanitized centrally.
      trackDiag('tts', playbackStartedRef.current ? 'tts-error' : 'fallback', reason);
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

    // Arm the stall phrase for a location story that must synthesize:
    // if the audio is not in hand within a few seconds, one short
    // STORED Puck clip (services/stallPhrases) covers the wait so the
    // listener never sits in uncovered silence wondering whether the
    // tour died (Oct 26, start #3 — a long hush before the first story
    // while its synthesis ran serialized in the player). This slot was
    // originally a device-voice line ("Hang on — let me get my
    // bearings here."); Erik replaced it with stored phrases the same
    // day — bearings language belongs to the intro period, and a stall
    // mid-tour should sound like Leo, not like the phone. The phrase
    // never enters the queue, plays at most once per story, and is
    // ducked out (~250 ms fade) the moment the real audio starts —
    // hard-cut if the item settles or the browser voice engages.
    // If no phrase is available (rotation spent) or the clip fails to
    // play, nothing fires — silence beats the wrong voice here.
    if (isLocationStory && !providedUrl) {
      const genAtArm = playGenRef.current;
      bridgeTimer = window.setTimeout(() => {
        bridgeTimer = null;
        if (finished || playbackStartedRef.current) return;
        if (playGenRef.current !== genAtArm) return; // skipped/stopped while waiting
        const phrase = pickStallPhrase();
        if (!phrase) return;
        // On the record (Oct 26 instrumentation): a fired stall is a
        // pipeline_diag row — stage 'playback', reason 'stall-phrase',
        // message = the phrase id — readable per-event in the view.
        try { trackDiag('playback', 'stall-phrase', phrase.id); } catch { /* a metric must never break cover */ }
        const el = new Audio(stallPhraseAudioUrl(phrase));
        el.volume = 1; // every phrase starts at full level — a prior phrase's fade-out lived on its own element
        bridgeAudio = el;
        stallAudioRef.current = el;
        const release = () => {
          if (bridgeAudio === el) bridgeAudio = null;
          if (stallAudioRef.current === el) stallAudioRef.current = null;
        };
        el.onended = release;
        el.onerror = release;
        el.play().catch(release);
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
        // Feed the adaptive look-ahead (Area D): real synthesis time is
        // one of its inputs. Cache hits are not synthesis — skip them,
        // or the median would claim the pipeline is instant.
        if (!ttsResult.cacheHit && storyTimingRef.current.synthRequestAt) {
          latencyModel.recordSynth(
            (storyTimingRef.current.synthResolvedAt - storyTimingRef.current.synthRequestAt) / 1000
          );
        }
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
        // Sound coming out of the element is proof of unlock — latch it
        // and flush any lines still held for one (the welcome/opener
        // recovery path; see markProvenUnlock).
        markProvenUnlock();
        fadeBridge(); // duck a playing stall phrase out under the story's start
        onAir?.('gemini');
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
        audioHealth.recordFailure('gemini');
        fallbackToBrowser('audio error');
      };

      setTtsStatus('gemini');
      await audio.play().catch((playError: unknown) => {
        playbackStartedRef.current = false;
        audioHealth.recordFailure('gemini');
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
  }, [startWatchdog, markProvenUnlock]);

  // Browser SpeechSynthesis playback — the original sentence-by-sentence path.
  // Used as a fallback when Gemini TTS is unavailable, and for short scripted
  // lines that don't justify a TTS API call.
  const playSegmentsBrowser = useCallback((segments: string[], onDone: (blocked: boolean) => void, onAir?: (engine: 'gemini' | 'browser') => void, tracked?: boolean) => {
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
        // The browser voice sounding is also proof of unlock (see
        // markProvenUnlock) — held lines flush behind this one.
        markProvenUnlock();
        onAir?.('browser');
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
          audioHealth.recordFailure('browser');
          markAudioBlocked('blocked');
          finish(true);
          return;
        }
        if (event.error !== 'interrupted' && event.error !== 'canceled') {
          audioHealth.recordFailure('browser');
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
      dispatchSpeech(utterance, () => started, () => {
        audioHealth.recordFailure('browser');
        finish(true);
      }, false);
    };

    advanceTo(0);
  }, [dispatchSpeech, startWatchdog, markProvenUnlock]);

  const playStoryFromQueue = useCallback(() => {
    if (isPlayingStoryRef.current) return;

    // Drop any waiting story that no longer describes where the listener is.
    while (storyQueueRef.current.length > 0) {
      const next = storyQueueRef.current[0];
      if (isStillRelevant(next)) break;
      storyQueueRef.current.shift();
      // If the stale item IS the reserved welcome, the gate's wait is
      // over: a welcome that can no longer be heard must not hold the
      // tour hostage (Pass 1 safety valve).
      if (next.introServe) releaseOpenerGate('intro-dropped-stale');
      console.log('[Voice] Stale story dropped — no longer describes the listener\'s location');
      // The drop, on the record with tell geometry (Area G): which
      // story, how far its anchor sits, and at what bearing — relative
      // geometry only, like every geometry event. The behind-me case
      // keeps its source names ('stale_highway' at freeway speed,
      // 'stale_behind' below it); reach/age drops report 'stale_queue'.
      try {
        const pos = currentPositionProviderRef.current?.();
        let source = 'stale_queue';
        let distanceM: number | undefined;
        let bearingOffset: number | undefined;
        if (pos && next.lat !== undefined && next.lng !== undefined) {
          distanceM = calculateDistance(pos.lat, pos.lng, next.lat, next.lng);
          if (typeof pos.heading === 'number') {
            bearingOffset = headingDelta(bearingDegrees(pos, { lat: next.lat, lng: next.lng }), pos.heading);
          }
          if (isFarBehindAtSpeed(next, pos, distanceM)) {
            source = typeof pos.speed === 'number' && pos.speed >= FREEWAY_SPEED_MPS ? 'stale_highway' : 'stale_behind';
          }
        }
        analytics.track('story_dropped', null, undefined, {
          source,
          topic: next.topic ?? '',
          story_id: next.storyId ?? '',
          distance_m: distanceM !== undefined ? Math.round(distanceM) : null,
          bearing_offset_deg: bearingOffset !== undefined ? Math.round(bearingOffset) : null,
        });
      } catch { /* a metric must never break the gate */ }
      // The drop is also a SETTLE for the item's owner (fix stack
      // RC-2): a tracked item dropped here must resolve its callbacks
      // undelivered, or its owner's bookkeeping (the app's hearing
      // funnel, the Q&A cycle) waits forever on a story that has
      // already reached its terminal record above.
      if (next.onPlaybackEnd || next.onSettleDetail) {
        const info: PlaybackSettle = {
          sounded: false, completed: false, engine: null, attempts: next.attempts ?? 0, soundedMs: 0,
        };
        next.onSettleDetail?.(info);
        next.onPlaybackEnd?.(false);
      }
    }

    // Opener gate (Pass 1): until the neighborhood welcome has aired,
    // a landmark/area story may not START. Scripted lines and the
    // intro serve itself pass. The intro is protected at enqueue
    // (piece 3a) so it sits ahead of any waiting landmark — holding
    // here simply waits for it; its settle re-enters this function
    // through the normal onDone chain. Safety valve: past the
    // backstop, release and proceed rather than deadlock the tour.
    // The backstop timer itself is armed at gate-begin (fix stack
    // D2) — this check remains only as the in-band fast path for a
    // dequeue that happens to land past the deadline first.
    const gateHead = storyQueueRef.current[0];
    if (openerGateRef.current && gateHead && gateHead.isLocationStory && !gateHead.introServe) {
      const armedFor = Date.now() - openerGateRef.current.armedAt;
      if (armedFor < OPENER_GATE_TIMEOUT_MS) {
        console.log('[Voice] Opener gate: holding a landmark story until the neighborhood welcome airs');
        return;
      }
      releaseOpenerGate('timeout');
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

    // Lifecycle record for this dequeue. markSounded is the ONLY way
    // `sounded` becomes true — an engine event proving audio began —
    // and the record settles exactly once when the item leaves the
    // player (see onDone, the watchdog, skip, and stop). `completed`
    // is set ONLY by onDone's natural-completion path below: success
    // reported to a tracked owner means sounded AND finished, never
    // merely started. The engine that actually sounded the item
    // records itself here (Oct 26, 2026): a Gemini item that fell
    // back to the browser voice reports 'browser', because that is
    // what the listener heard — settle analytics must describe the
    // ear, not the intention.
    // Tell geometry at play start (Area G): where the subject sits
    // relative to the listener RIGHT NOW — the measurement the whole
    // predictive machinery is judged by. Bearing offset is only
    // meaningful with a trustworthy heading (driving speeds); told_late
    // is the simple verdict: rear hemisphere (>120°) while driving.
    // Prediction error compares the fetch's projected center against
    // the actual position at this moment.
    const playPos = currentPositionProviderRef.current?.();
    let playGeo: Partial<{
      distanceM: number; bearingOffsetDeg: number; speedMps: number | null;
      headingDeg: number | null; toldLate: boolean; predictionErrorM: number;
    }> = {};
    if (playPos && item.lat !== undefined && item.lng !== undefined) {
      const distanceM = calculateDistance(playPos.lat, playPos.lng, item.lat, item.lng);
      const driving = typeof playPos.speed === 'number' && playPos.speed >= 6;
      const bearingOffsetDeg = typeof playPos.heading === 'number'
        ? headingDelta(bearingDegrees(playPos, { lat: item.lat, lng: item.lng }), playPos.heading)
        : undefined;
      playGeo = {
        distanceM,
        bearingOffsetDeg,
        speedMps: playPos.speed,
        headingDeg: playPos.heading,
        toldLate: driving && bearingOffsetDeg !== undefined ? bearingOffsetDeg > 120 : undefined,
        predictionErrorM: item.projectedCenter
          ? calculateDistance(playPos.lat, playPos.lng, item.projectedCenter.lat, item.projectedCenter.lng)
          : undefined,
      };
    }

    // Attempts count at the first PLAYBACK attempt (fix stack RC-5),
    // not at dequeue: the gap-pacing deferral above unshifts the item
    // and returns without playing anything, and counting there burned
    // the bounded attempt economy on silence — items exhausted their
    // attempts in pacing waits and settled as failures without ever
    // being tried. From this line the item WILL be attempted; the
    // blocked path's requeue economy counts from here.
    item.attempts = (item.attempts ?? 0) + 1;

    const playback = {
      gen,
      sounded: false,
      completed: false,
      engine: null as 'gemini' | 'browser' | null,
      soundedAt: null as number | null,
      attempts: item.attempts ?? 1,
      isLocationStory: item.isLocationStory,
      topic: item.topic ?? null,
      introServe: item.introServe === true,
      onEnd: item.onPlaybackEnd,
      onSettleDetail: item.onSettleDetail,
      storyId: item.storyId,
      subjectLat: item.lat,
      subjectLng: item.lng,
      queueDepth: item.queueDepth,
      timeInQueueS: item.enqueuedAt !== undefined ? (Date.now() - item.enqueuedAt) / 1000 : undefined,
      horizonS: item.horizonS,
      ...playGeo,
    };
    currentPlaybackRef.current = playback;
    // T6 order guard latch (fix stack): the intro has STARTED — held
    // welcome/opener lines may no longer flush behind it.
    if (item.introServe) introStartedRef.current = true;
    // Retain the item itself for the leave/return restart (Pass 1):
    // the lifecycle record knows how the dequeue ended, but only the
    // item can be replayed.
    currentItemRef.current = item;
    // A tracked item (one carrying lifecycle callbacks — the Q&A
    // answer and bridge) gets honest-partial handling in both engines:
    // a mid-playback failure re-enters the attempt economy rather than
    // settling a fragment as delivered.
    const tracked = !!item.onPlaybackEnd;
    const markSounded = (engine: 'gemini' | 'browser') => {
      if (playback.sounded) return;
      playback.sounded = true;
      playback.engine = engine;
      playback.soundedAt = Date.now();
      // Sound happened: THIS engine's audio-health failure streak
      // ends here (per-engine streaks, fix stack RC-6 — a browser
      // success must not clear a Gemini storm, or vice versa).
      audioHealth.recordSuccess(engine);
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
        // Storm economy (Area B, Oct 26, 2026): while the audio-health
        // breaker is open, one attempt is all an item gets — in the
        // drive's failure storm the 3-attempt economy meant a doomed
        // story held the queue's single waiting slot through minutes of
        // retries while banked material waited. Surrender fast, free
        // the queue immediately, let the next item (preferably banked)
        // try the speaker instead.
        const maxAttempts = audioHealth.anyTripped() ? 1 : MAX_PLAYBACK_ATTEMPTS;
        if ((item.attempts ?? 0) >= maxAttempts) {
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
        // The item is back to waiting, not in the player — the
        // leave/return restart must not mistake it for a mid-play item.
        currentItemRef.current = null;
        storyQueueRef.current.unshift(item);
        console.log('[Voice] Audio blocked — holding this story until sound is allowed');
        // Re-enter the player on a timer (fix stack D2): the blocked
        // exit produces no settle, and until now nothing guaranteed
        // another dequeue — in the locked state the item (the intro,
        // in the field failure) sat requeued forever, its attempts
        // never exhausted, its settle never fired, and the opener
        // gate's release — which rides the intro's settle — never
        // landed. The retry is generation-guarded like the gap timer:
        // a skip/stop/mute that moves ownership cancels it, and the
        // bounded attempt economy above guarantees the item settles
        // within a few cycles instead of blacking out the gate.
        const retryGen = playGenRef.current;
        window.setTimeout(() => {
          if (retryGen !== playGenRef.current) return;
          if (isPlayingStoryRef.current) return;
          playStoryFromQueueRef.current();
        }, 1500);
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

  // Restart the item that was mid-play when the page hid (Pass 1,
  // Oct 27, 2026). iOS suspends the page wholesale: timers throttle,
  // utterances are killed, the audio element is paused — while the
  // in-memory state still says "playing", and the old resume path
  // merely re-armed the watchdog, which then force-advanced and
  // dropped the half-heard story. Instead the retained item goes back
  // to the front of the queue and replays from the start: for
  // file-backed items the dequeue re-runs playback against the same
  // URL (or the warm TTS cache); for browser-voice items it is a clean
  // re-speak. The current dequeue is discarded WITHOUT settling —
  // the same no-fire discard as the blocked-requeue path — because
  // the item neither finished nor failed; if the replay later settles
  // not-delivered, the backgrounding release (settleCurrentPlayback)
  // still fires, since backgroundedTopicRef survives the restart.
  const restartCurrentItem = useCallback((): boolean => {
    const item = currentItemRef.current;
    if (!item) return false;
    playGenRef.current += 1;
    if (currentPlaybackRef.current) currentPlaybackRef.current = null;
    currentItemRef.current = null;
    clearWatchdog();
    if (synthRef.current) {
      try { synthRef.current.cancel(); } catch { /* engine missing */ }
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
    }
    if (stallAudioRef.current) {
      stallAudioRef.current.pause();
      stallAudioRef.current.removeAttribute('src');
      stallAudioRef.current = null;
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    playbackStartedRef.current = false;
    isPlayingStoryRef.current = false;
    setIsSpeaking(false);
    setWasInterrupted(false);
    storyQueueRef.current.unshift(item);
    console.log('[Voice] Restarting the item that was mid-play when the page hid');
    playStoryFromQueueRef.current();
    return true;
  }, [clearWatchdog]);

  // Coming back from another app: the platform has paused speech and
  // the watchdog's timers were throttled while hidden, so its idea of
  // "silence" is meaningless. Restart what was interrupted — promptly,
  // with an immediate progress check rather than the watchdog's 8s of
  // grace — and pick the queue back up if nothing was playing.
  const resumeFromBackground = useCallback(() => {
    const synth = synthRef.current;
    if (synth) {
      try {
        synth.resume();
      } catch {
        // Engine missing — nothing to resume
      }
    }

    if (isPlayingStoryRef.current) {
      const item = currentItemRef.current;
      const audio = audioElRef.current;
      if (item && audio && audio.src && !audio.ended) {
        // File-backed item with its source intact: try the cheap
        // in-place resume first, then verify with an immediate
        // progress check (~700ms) — if the element is not actually
        // advancing, fall through to a full restart of the item.
        audio.play().catch(() => { /* the progress check decides */ });
        window.setTimeout(() => {
          if (!isPlayingStoryRef.current) return;
          const a = audioElRef.current;
          const advancing = !!a && !!a.src && !a.paused && !a.ended;
          const synthAlive = !!(synthRef.current?.speaking || synthRef.current?.pending);
          if (advancing || synthAlive) {
            startWatchdog();
            setWasInterrupted(false);
          } else if (!restartCurrentItem()) {
            startWatchdog();
            setWasInterrupted(true);
          }
        }, 700);
        return;
      }
      if (item) {
        // Browser-voice item (utterances never survive suspension) or
        // a file item whose element lost its source: clean restart.
        if (restartCurrentItem()) return;
      }
      // Playing with no retained item — the pre-Pass-1 behavior.
      startWatchdog();
      // Audio stays paused until the listener taps, so say so rather than
      // letting them sit in silence wondering whether the tour died.
      setWasInterrupted(true);
      return;
    }

    if (storyQueueRef.current.length > 0) {
      playStoryFromQueueRef.current();
    }
  }, [startWatchdog, restartCurrentItem]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        backgroundedRef.current = true;
        // Remember WHAT was on air as the page hid: if that story
        // settles not-delivered, it was the platform that killed it,
        // and it earns a release for retelling (see settle).
        const pb = currentPlaybackRef.current;
        if (pb?.isLocationStory && pb.topic) {
          backgroundedTopicRef.current = pb.topic;
        }
        return;
      }
      if (!backgroundedRef.current) return;
      backgroundedRef.current = false;
      resumeFromBackground();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [resumeFromBackground]);

  // --- Media Session (Pass 1, Oct 27, 2026) ---
  // Lock-screen / car-stereo controls. Before this, leaving the app
  // (or the car's head unit) had no Leo's World presence at all: no
  // title, no transport buttons — the driver had to unlock the phone
  // to recover the tour. Metadata is set at tour start; the handlers
  // wire to the same resume/pause mechanics the on-screen controls
  // use (the tap-to-resume unlock flow and engine pause). Pure
  // garnish by design: every call is guarded, and a platform without
  // the API simply never sees it.
  const pausePlaybackForMedia = useCallback(() => {
    if (audioElRef.current && audioElRef.current.src) {
      try { audioElRef.current.pause(); } catch { /* element gone */ }
    }
    if (synthRef.current) {
      try { synthRef.current.pause(); } catch { /* engine missing */ }
    }
    clearWatchdog();
    setWasInterrupted(true);
    try {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    } catch { /* garnish */ }
  }, [clearWatchdog]);

  const resumePlaybackForMedia = useCallback(() => {
    unlock();
    const audio = audioElRef.current;
    const elementPaused = !!audio && !!audio.src && audio.paused && !audio.ended;
    const synthPaused = !!synthRef.current?.paused;
    if (isPlayingStoryRef.current && (elementPaused || synthPaused)) {
      if (elementPaused) audio!.play().catch(() => setWasInterrupted(true));
      if (synthPaused) {
        try { synthRef.current?.resume(); } catch { /* engine missing */ }
      }
      setWasInterrupted(false);
      startWatchdog();
    } else {
      // Nothing mid-play to unpause: mirror the tap-to-resume flow —
      // clear the interrupted/blocked state and pick the queue up.
      audioBlockedRef.current = false;
      setAudioBlocked(false);
      setWasInterrupted(false);
      if (!isPlayingStoryRef.current && storyQueueRef.current.length > 0) {
        playStoryFromQueueRef.current();
      }
    }
    try {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    } catch { /* garnish */ }
  }, [unlock, startWatchdog]);

  const activateMediaSession = useCallback(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Leo's World",
        artist: 'Leo — your AI tour guide',
        album: "Leo's World",
      });
      navigator.mediaSession.setActionHandler('play', () => resumePlaybackForMedia());
      navigator.mediaSession.setActionHandler('pause', () => pausePlaybackForMedia());
    } catch { /* garnish — never break a tour start for it */ }
  }, [resumePlaybackForMedia, pausePlaybackForMedia]);

  const deactivateMediaSession = useCallback(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    } catch { /* garnish */ }
  }, []);

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

  // Displacement is a terminal outcome, and it is LOUD (fix stack
  // RC-2): a waiting location story spliced out by a priority serve
  // or a fresher story used to vanish with no event and no settle —
  // its story_played had no terminal record and its owner never
  // learned its fate. Now it emits story_dropped with the reason and
  // settles its callbacks undelivered, exactly like a teardown, so
  // the invariant holds on this exit too: every story_played reaches
  // exactly one terminal record.
  const settleDisplacedItem = (item: StoryQueueItem, reason: string) => {
    if (item.isLocationStory) {
      try {
        analytics.track('story_dropped', null, undefined, {
          source: reason,
          topic: item.topic ?? '',
          story_id: item.storyId ?? '',
          distance_m: null,
          bearing_offset_deg: null,
        });
      } catch { /* a metric must never break the queue */ }
    }
    if (item.onPlaybackEnd || item.onSettleDetail) {
      const info: PlaybackSettle = {
        sounded: false, completed: false, engine: null, attempts: item.attempts ?? 0, soundedMs: 0,
      };
      item.onSettleDetail?.(info);
      item.onPlaybackEnd?.(false);
    }
  };

  const enqueue = useCallback((item: StoryQueueItem) => {
    const queue = storyQueueRef.current;
    // Tell-geometry stamps (Area G): when this item joined the queue,
    // and how deep the queue was once it had — the settle reports the
    // wait; until now queue time per story was invisible.
    item.enqueuedAt = Date.now();

    if (item.priority) {
      // Warm-head insertion (pre-publish stack Item 7, Oct 27, 2026;
      // Erik's identification): the old rule displaced EVERY waiting
      // location story and spliced the priority item to the head —
      // cold. Its synthesis had never run (presynth was aimed at the
      // previous head), so the priority story synthesized in-player
      // while the displaced head's completed warm work was thrown
      // away. The rule now: a priority item inserts BEHIND a warm or
      // warming waiting head — the head keeps its slot and its warm
      // audio, the priority item takes position 2 and is exactly
      // what depth-2 presynth voices next (Item 3), so it is warm
      // when it advances. A COLD head is displaced as before and
      // the priority item takes the head. The currently playing
      // story is never touched — priority only reorders what waits.
      // Pass 1 exception (unchanged): the reserved neighborhood
      // welcome (introServe) is NEVER displaced or spliced around.
      // FIFO within the priority lane: an already-waiting priority
      // item is never displaced by a newer one, warm or cold — the
      // newcomer lines up behind it. Tiebreak between two warm
      // items: arrival order — a warm priority item does not jump a
      // warm head that was queued before it.
      const fullTextOf = (it: StoryQueueItem) =>
        it.transitionText ? `${it.transitionText} ${it.text}` : it.text;
      const isWarmOrWarming = (it: StoryQueueItem): boolean => {
        if (it.audioUrl) return true; // banked audio (library) — warm by definition
        const ft = fullTextOf(it);
        return warmedTextRef.current === ft || preSynthTextRef.current === ft;
      };
      const locEntries = queue
        .map((q, i) => ({ q, i }))
        .filter(x => x.q.isLocationStory && !x.q.introServe);
      const head = locEntries[0]?.q ?? null;
      const keep = new Set<StoryQueueItem>();
      if (head && isWarmOrWarming(head)) keep.add(head);
      for (const { q } of locEntries) if (q.priority) keep.add(q);
      for (let i = queue.length - 1; i >= 0; i--) {
        const q = queue[i];
        if (q.isLocationStory && !q.introServe && !keep.has(q)) {
          const [displaced] = queue.splice(i, 1);
          settleDisplacedItem(displaced, 'displaced-priority');
        }
      }
      // Insert after the last kept waiting item (the warm head
      // and/or the priority lane's FIFO run); with nothing kept,
      // fall back to the historical slot — ahead of the first
      // ordinary location story, behind any protected intro.
      let insertAt = -1;
      if (keep.size > 0) {
        for (let i = queue.length - 1; i >= 0; i--) {
          if (keep.has(queue[i])) { insertAt = i + 1; break; }
        }
      }
      if (insertAt === -1) {
        const firstLocationIndex = queue.findIndex(i => i.isLocationStory && !i.introServe);
        insertAt = firstLocationIndex === -1 ? queue.length : firstLocationIndex;
      }
      queue.splice(insertAt, 0, item);
      // The item took the head iff no other location story (the
      // protected intro included) waits ahead of it in the final
      // queue — scripted glue ahead of it does not change which
      // story leads, so it does not count.
      const itemIdx = queue.indexOf(item);
      const tookHead = !queue.slice(0, itemIdx).some(q => q.isLocationStory);
      if (tookHead) {
        // The next-item changed identity only when the priority
        // item actually becomes the head: the old head's presynth
        // dedupe and any miss filed for it belong to a story that
        // no longer leads. Behind a warm head, both stay valid.
        preSynthTextRef.current = null;
        presynthMissRef.current = null;
      }
      console.log(
        tookHead
          ? '[Voice] Priority story moved to the front of the waiting queue'
          : '[Voice] Priority story inserted behind the warm waiting head'
      );
    } else if (item.isLocationStory) {
      const waitingCount = queue.filter(i => i.isLocationStory).length;
      if (waitingCount >= MAX_PENDING_LOCATION_STORIES) {
        // The single waiting slot goes to the fresher story — unless
        // every waiting location story is the protected intro, in
        // which case the newcomer queues BEHIND it (a brief depth-2
        // queue during the opener only) rather than replacing the
        // welcome before it airs.
        const replaceableIndex = queue.findIndex(i => i.isLocationStory && !i.introServe);
        if (replaceableIndex !== -1) {
          const [displaced] = queue.splice(replaceableIndex, 1);
          settleDisplacedItem(displaced, 'displaced-fresher');
          console.log('[Voice] Replacing the waiting story with a fresher one');
        }
      }
      queue.push(item);
    } else {
      queue.push(item);
    }

    item.queueDepth = queue.length;
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
    audioUrl?: string,
    geo?: { storyId?: string; projectedCenter?: { lat: number; lng: number }; horizonS?: number; introServe?: boolean; onSettleDetail?: (info: PlaybackSettle) => void; generatedAt?: number }
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
      // Honest age (fix stack RC-3): the story's GENERATION time as
      // reported by the serve — the freshness gate's age bound used
      // to be stamped here, at enqueue, so it measured queue wait
      // only and a story generated a full telling ago looked newborn.
      generatedAt: geo?.generatedAt ?? Date.now(),
      regionAnchored,
      isLocationStory: kind ? kind === 'location' : hasCoords,
      audioUrl,
      introServe: geo?.introServe === true,
      storyId: geo?.storyId,
      projectedCenter: geo?.projectedCenter,
      horizonS: geo?.horizonS,
      onSettleDetail: geo?.onSettleDetail,
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
    audioUrl?: string,
    geo?: { storyId?: string; projectedCenter?: { lat: number; lng: number }; horizonS?: number; introServe?: boolean; onSettleDetail?: (info: PlaybackSettle) => void; generatedAt?: number }
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
      generatedAt: geo?.generatedAt ?? Date.now(),
      regionAnchored,
      isLocationStory: true,
      priority: true,
      audioUrl,
      introServe: geo?.introServe === true,
      storyId: geo?.storyId,
      projectedCenter: geo?.projectedCenter,
      horizonS: geo?.horizonS,
      onSettleDetail: geo?.onSettleDetail,
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
    settleQueuedTrackedItems('skip-flush');
    synthRef.current?.cancel();
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
    }
    if (stallAudioRef.current) {
      stallAudioRef.current.pause();
      stallAudioRef.current.removeAttribute('src');
      stallAudioRef.current = null;
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
    preSynthText2Ref.current = null;
    presynthMissRef.current = null;
    playbackStartedRef.current = false;
    clearWatchdog();
    setIsSpeaking(false);
    setTimeout(() => onStoryCompleteRef.current?.(), 50);
  }, [clearWatchdog, settleCurrentPlayback, settleQueuedTrackedItems]);

  const muteForMinutes = useCallback((minutes: number) => {
    mutedUntilRef.current = Date.now() + minutes * 60_000;
    console.log(`[Voice] Muted for ${minutes} minutes`);
    playGenRef.current += 1;
    settleCurrentPlayback();
    settleQueuedTrackedItems('mute-flush');
    synthRef.current?.cancel();
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
    }
    if (stallAudioRef.current) {
      stallAudioRef.current.pause();
      stallAudioRef.current.removeAttribute('src');
      stallAudioRef.current = null;
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
    preSynthText2Ref.current = null;
    presynthMissRef.current = null;
    playbackStartedRef.current = false;
    clearWatchdog();
    setIsSpeaking(false);
  }, [clearWatchdog, settleCurrentPlayback, settleQueuedTrackedItems]);

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

  // Estimated seconds until the story on air finishes — the adaptive
  // look-ahead's "current story remaining" input (Area D). Leo speaks
  // ~13 chars/sec (the same rate the Q&A failsafe sizes from); the
  // estimate only steers geometry, so roughness is fine. Null when
  // nothing is on air.
  const getCurrentStoryRemainingS = useCallback((): number | null => {
    const current = currentSpokenRef.current;
    if (!current || !current.text) return null;
    const totalEstS = current.text.length / 13;
    const elapsedS = (Date.now() - current.startedAt) / 1000;
    return Math.max(0, totalEstS - elapsedS);
  }, []);

  // Median-timed presynth readiness (pre-publish stack Item 3,
  // Oct 27, 2026): Erik's concern was that presynth fires but lands
  // late, and nothing noticed. The deadline is the latency model's
  // rolling SYNTH median — the same measurement discipline as the
  // discovery horizon: when the story on air has less time left than
  // a typical synthesis takes, the next story's audio must already
  // be warm, or the handoff will gap. Warm means: banked (audioUrl),
  // its synthesis resolved (warmedTextRef), or its synthesis in
  // flight (preSynthTextRef — a cache-hit resolution is near-instant
  // and a live one was started at queue time, the earliest honest
  // moment). A miss is filed ONCE per next-item (presynth_miss) and
  // escalated by re-firing the presynth — cheap because the re-fire
  // dedupes per depth and stands down under any trip. Runs from the
  // watchdog's 2s tick while a story plays.
  const checkPresynthReadiness = useCallback((): void => {
    if (!isPlayingStoryRef.current) return;
    const next = storyQueueRef.current[0];
    if (!next || next.audioUrl) return;
    const nextText = next.transitionText ? `${next.transitionText} ${next.text}` : next.text;
    if (!nextText || nextText.trim().length === 0) return;
    if (warmedTextRef.current === nextText || preSynthTextRef.current === nextText) return;
    const remainingS = getCurrentStoryRemainingS();
    if (remainingS === null) return;
    const medianSynthS = latencyModel.medians().synthS;
    if (remainingS >= medianSynthS) return;
    if (presynthMissRef.current === nextText) return;
    presynthMissRef.current = nextText;
    trackDiag(
      'playback',
      'presynth-miss',
      `next story audio not warm with ${remainingS.toFixed(1)}s left on air (median synth ${medianSynthS.toFixed(1)}s)`
    );
    preSynthesizeNextRef.current();
  }, [getCurrentStoryRemainingS]);
  checkPresynthReadinessRef.current = checkPresynthReadiness;

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

  // Pass 1: the app registers here to learn when a location story was
  // killed by backgrounding (settled not-delivered after being mid-play
  // at hide time), so it can release the story for retelling.
  const setOnStoryInterrupted = useCallback((cb: ((topic: string) => void) | null) => {
    onStoryInterruptedRef.current = cb;
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
    getCurrentStoryRemainingS,
    getCurrentStoryTopic,
    setOnStoryStart,
    getLastSpokenSentences,
    isPlayingStory,
    setOnStoryComplete,
    setOnStoryInterrupted,
    beginOpenerGate,
    activateMediaSession,
    deactivateMediaSession,
    getQueueLength,
    getStoryTiming,
    setCurrentPositionProvider,
    ttsStatus,
  };
};

export default useVoice;
