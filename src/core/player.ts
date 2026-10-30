// The Player — the fresh shell's only audio writer.
//
// Owns the one shared audio element (spec P1), the unlock latch and
// its proofs (P5–P10), the hold discipline (P2–P4), the audible queue
// (promised lines + the single location-story waiting slot, §3), the
// playback attempt economy (P12, E1–E3 hooks), and settle-exactly-once
// for every audible item (O5, §8 terminal records).
//
// The Player is environment-free: the element, the clock, audio
// resolution, and telemetry arrive as injected ports, so the bench
// harness drives the identical code the phone runs.

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: id => clearInterval(id as ReturnType<typeof setInterval>),
};

/** The element, abstracted. The browser adapter is at the bottom of this file. */
export interface AudioPort {
  load(src: string | null): void;
  play(): Promise<void>;
  pause(): void;
  seekBy(sec: number): void;
  timeSec(): number;
  setEndedHandler(cb: (() => void) | null): void;
  setErrorHandler(cb: (() => void) | null): void;
}

export type ItemKind = 'greeting' | 'opener' | 'story' | 'answer' | 'bridge' | 'filler' | 'commentary';

export type AudioSource =
  | { kind: 'url'; url: string }
  | { kind: 'synth'; text: string };

export interface SettleRecord {
  sounded: boolean;
  completed: boolean;
  soundedMs: number;
  failKind: 'blocked' | 'error' | 'synthesis' | 'none';
  /** True when the item ended by exhausting its attempt cap. */
  exhausted: boolean;
  /** Set when the engine drops the item before any playback (queue-level terminal). */
  dropReason: string | null;
  skipped: boolean;
}

export interface AudibleItem {
  id: string;
  kind: ItemKind;
  label: string;
  source: AudioSource;
  /** Known or estimated duration, seconds (freshness math, stall timing). */
  durationSec: number;
  attempts: number;
  settled: boolean;
  /** §8 commitment: a location story is committed when it takes the waiting slot (or the element). Only committed stories file story_played → story_playback/story_dropped. */
  committed?: boolean;
  /** Silent settle: coverage bookkeeping only, no §8 terminal events (an uncommitted item the engine withdraws, e.g. into the prefetch buffer). */
  silent?: boolean;
  onSettle: (rec: SettleRecord) => void;
  /** F3 proof items may attempt while the latch is unearned; all others hold. */
  proof?: boolean;
  /** Tier-1 story (Q4) / reserved WELCOME (O8): displacement protection (Q6). */
  tier1?: boolean;
  reserved?: boolean;
  // Story-carried fields (kind === 'story'); ignored otherwise.
  subject?: string;
  angleOf?: string;
  storySource?: string;
  anchor?: { lat: number; lng: number } | null;
  regionAnchored?: boolean;
  corridorSegmentId?: string | null;
  segmentExit?: { lat: number; lng: number } | null;
  generatedAt?: number;
  text?: string | null;
  // Engine-filled telemetry stamps (P1 salvage); the Player ignores them.
  /** Lead fact captured at live generation (P3: the thread feed). */
  signatureFact?: string | null;
  /** Live text-generation duration for this story, ms (null for shelf/cache serves). */
  fetchMs?: number | null;
  /** Synthesis duration when this item's audio was minted, ms. */
  synthMs?: number | null;
  /** True when this item's audio resolved from the on-device cache. */
  audioCacheHit?: boolean | null;
  // Opener clip identity (P1: the opener_clip settle record).
  openerClipId?: string;
  openerLengthClass?: string;
}

export type LatchState = 'unearned' | 'earned' | 'lost';
export type LatchSource = 'prime' | 'playback-proof' | 'gesture-retry';

export interface PlayerHooks {
  /** Resolve an item's audio source to a playable URL. May throw (synthesis failure). */
  resolveUrl(item: AudibleItem): Promise<string>;
  /** Stall-phrase cover for a story whose audio is slow (S12); null = no cover available. */
  stallSource(): { url: string; durationSec: number } | null;
  /** Telemetry sink (spec §8): prime_attempt is emitted by the Player itself. */
  emit(type: string, payload: Record<string, unknown>): void;
  /** First latch of the tour (unlock_latched is the engine's to file, with tour timing). */
  onFirstLatch(source: LatchSource): void;
  /** A prime-carrier item's play attempt was refused; the engine runs the fallback prime (O3/P7). */
  onPrimeCarrierFailed(blocked: boolean): void;
  onLatchLost(): void;
  onLatchRestored(): void;
  /** 3 consecutive playback failures (E3): the engine enters storm economy. */
  onFailureStreak(): void;
  /** Current attempt cap: 3 normally, 1 in storm economy (E1/E3). */
  attemptCap(): number;
  /** Engine's freshness judgment at story dequeue (Q8–Q11). */
  judgeStory(item: AudibleItem): { ok: true } | { ok: false; reason: string };
  /** Engine's displacement ruling (Q4/Q6). */
  mayDisplace(waiter: AudibleItem, newcomer: AudibleItem, kind: 'priority' | 'fresher'): boolean;
  /** The waiting slot emptied and nothing is pending: a serve cycle may refill it (S2). */
  onSlotEmpty(): void;
  /** A location story has been committed (§8 story_played): it took the waiting slot or the element. Fires exactly once per committed story. */
  onStoryCommitted(item: AudibleItem): void;
  /** An item's sound has actually started (its play() resolved). */
  onSoundStart(item: AudibleItem): void;
  /** A location story entered the waiting slot: the engine may presynthesize it (S11). */
  onWaiting(item: AudibleItem): void;
  /** An item has been taken as current and its playback drive has begun. */
  onCommit(item: AudibleItem): void;
  /** Any state change the UI cares about. */
  onState(): void;
}

const GAP_MS = 600;
const RETRY_MS = 1200;
const STALL_AFTER_MS = 4000;
/**
 * A play() promise that neither resolves nor rejects within this
 * window is treated as a failed attempt (P5's hung prime): the
 * attempt loop moves on, and the generation guard makes the orphaned
 * promise's late settlement harmless. Sized well above any slow
 * start (T8a's 20 s delay) and well under the 180 s opening gate.
 */
const PLAY_WATCHDOG_MS = 45_000;
const BLOCKED_BURST_WINDOW_MS = 10_000;
const PROBE_MS = 20_000;
const HELD_BANNER_MS = 3000;
/** A synthesis/resolve that has not returned in this window counts as a failed resolve (the stall lesson: hung requests must settle). */
const RESOLVE_WATCHDOG_MS = 45_000;
/** After sound starts, an item that neither ends nor errors within its expected duration plus this slack is force-failed — a stalled stream must not wedge the player. */
const PROGRESS_SLACK_MS = 45_000;

/** The real-sample fallback prime (O3): ~200 ms of 220 Hz at ≈ −58 dB, as a blob URL. */
export function makePrimeUrl(): string {
  const sampleRate = 8000;
  const frames = Math.floor(sampleRate * 0.2);
  const pcm = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    pcm[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 40);
  }
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

let itemSeq = 0;
export function nextItemId(prefix: string): string {
  itemSeq += 1;
  return `${prefix}-${itemSeq}`;
}

export class Player {
  private audio: AudioPort;
  private clock: Clock;
  private hooks: PlayerHooks;

  current: AudibleItem | null = null;
  promised: AudibleItem[] = [];
  waitingStory: AudibleItem | null = null;
  private pendingPriority: AudibleItem[] = [];

  latch: LatchState = 'unearned';
  private latchedOnce = false;

  private primeInFlight: Promise<void> | null = null;
  private primeUrl: string | null = null;
  private failureStreak = 0;
  private blockedAt: number[] = [];
  private lossDeclared = false;
  private probeTimer: unknown = null;
  private gapTimer: unknown = null;
  private retryTimer: unknown = null;
  private driveGen = 0;
  private stallUsedFor = new Set<string>();
  /** True while the fallback sample prime owns the element: element-level ended/error events belong to the prime, never to a resting current item. */
  private primeActive = false;
  private progressTimer: unknown = null;
  private progressFor: string | null = null;
  private soundStartAt: number | null = null;
  private userPaused = false;
  private heldSince: number | null = null;
  private tornDown = false;

  constructor(audio: AudioPort, clock: Clock, hooks: PlayerHooks) {
    this.audio = audio;
    this.clock = clock;
    this.hooks = hooks;
    this.audio.setEndedHandler(() => this.handleEnded());
    this.audio.setErrorHandler(() => this.handleElementError());
  }

  // ---------------------------------------------------------- state views

  /**
   * Hold (P3/P4, §9's one admission rule): while the latch is unearned
   * or lost, no audible item attempts, is swept, or is displaced —
   * the only exceptions are the designated prime carrier (P2) and an
   * F3 proof pair, which attempt precisely to earn the latch.
   */
  holdActive(): boolean {
    return this.latch !== 'earned';
  }

  isPlaying(): boolean {
    return this.current !== null && this.soundStartAt !== null;
  }

  hasHeldMaterial(): boolean {
    return this.current !== null || this.promised.length > 0 || this.waitingStory !== null;
  }

  heldBannerDue(): boolean {
    return (
      this.holdActive() &&
      this.hasHeldMaterial() &&
      this.heldSince !== null &&
      this.clock.now() - this.heldSince >= HELD_BANNER_MS
    );
  }

  snapshot() {
    return {
      latch: this.latch,
      hold: this.holdActive(),
      currentLabel: this.current?.label ?? null,
      currentKind: this.current?.kind ?? null,
      promisedCount: this.promised.length,
      waitingLabel: this.waitingStory?.label ?? null,
      bannerDue: this.heldBannerDue(),
      userPaused: this.userPaused,
    };
  }

  // ---------------------------------------------------------- queue intake

  /** Promised lines (greeting/opener/answer/filler pair parts) join the FIFO. */
  enqueuePromised(item: AudibleItem): void {
    if (this.tornDown) {
      // Post-teardown arrivals settle immediately and exactly once
      // (O13 completeness): nothing may lodge in a dead player.
      this.settleItem(item, {
        sounded: false,
        completed: false,
        soundedMs: 0,
        failKind: 'none',
        exhausted: false,
        dropReason: item.kind === 'story' ? 'teardown' : null,
        skipped: false,
      });
      return;
    }
    this.promised.push(item);
    this.markHeldIfNeeded();
    this.pump();
    this.hooks.onState();
  }

  /**
   * Offer a location story. Returns where it landed:
   * 'slotted' (the one waiting slot), 'pending' (Tier-1 awaiting the
   * slot), or 'buffer' (the engine keeps it as a prefetch candidate).
   */
  offerStory(item: AudibleItem, tier1: boolean): 'slotted' | 'pending' | 'buffer' {
    if (this.tornDown) {
      this.settleItem(item, {
        sounded: false,
        completed: false,
        soundedMs: 0,
        failKind: 'none',
        exhausted: false,
        dropReason: 'teardown',
        skipped: false,
      });
      return 'buffer';
    }
    if (!this.waitingStory) {
      this.waitingStory = item;
      this.commitStory(item);
      this.hooks.onWaiting(item);
      this.markHeldIfNeeded();
      this.pump();
      this.hooks.onState();
      return 'slotted';
    }
    if (tier1) {
      if (!this.holdActive() && this.hooks.mayDisplace(this.waitingStory, item, 'priority')) {
        const waiter = this.waitingStory;
        this.waitingStory = item;
        this.commitStory(item);
        this.hooks.onWaiting(item);
        this.settleItem(waiter, this.dropRecord('displaced-priority'));
        this.hooks.onState();
        return 'slotted';
      }
      // A pending Tier-1 is an unqueued serve candidate (Q4): not
      // committed until it takes the slot at refill.
      this.pendingPriority.push(item);
      this.hooks.onState();
      return 'pending';
    }
    if (!this.holdActive() && this.hooks.mayDisplace(this.waitingStory, item, 'fresher')) {
      const waiter = this.waitingStory;
      this.waitingStory = item;
      this.commitStory(item);
      this.hooks.onWaiting(item);
      this.settleItem(waiter, this.dropRecord('displaced-fresher'));
      this.hooks.onState();
      return 'slotted';
    }
    return 'buffer';
  }

  /** §8 commitment bookkeeping: file story_played's trigger exactly once per story. */
  private commitStory(item: AudibleItem): void {
    if (item.kind !== 'story' || item.committed) return;
    item.committed = true;
    this.hooks.onStoryCommitted(item);
  }

  /**
   * Withdraw an item the engine never committed (e.g. a story that
   * landed 'buffer' and was retained as prefetch text): settles it
   * exactly once through its own handler, silently (the tour marks
   * it `silent` first; uncommitted items file no §8 terminal event).
   */
  abandon(item: AudibleItem): void {
    this.settleItem(item, {
      sounded: false,
      completed: false,
      soundedMs: 0,
      failKind: 'none',
      exhausted: false,
      dropReason: null,
      skipped: false,
    });
  }

  // ---------------------------------------------------------- primes & latch (P5–P10)

  /**
   * Attempt a prime carried by an audible item (the GREETING clip at
   * START, or its gesture retry). The item must already be the
   * player's current item (see beginWithItem) or at the promised head;
   * its first play attempt IS the prime attempt.
   */
  primeWithItem(item: AudibleItem, source: 'prime' | 'gesture-retry'): void {
    if (this.primeInFlight) return;
    if (this.current !== null && this.current !== item) {
      // The carrier flag must never attach to an item that is not
      // the element's current writer (P2): fall back to the sample.
      this.attemptSamplePrime(source);
      return;
    }
    const started = this.clock.now();
    const p = (async () => {
      // The item's own drive loop performs the attempt; watch for its
      // first play resolution via the latch bookkeeping below.
      this.primeCarrier = { item, source, started };
      if (this.current !== item) {
        // Pull the item to current without disturbing settle order of others.
        const idx = this.promised.indexOf(item);
        if (idx >= 0) this.promised.splice(idx, 1);
        if (this.current === null) this.current = item;
      }
      this.driveCurrent();
    })();
    this.primeInFlight = p.finally(() => {
      this.primeInFlight = null;
    });
  }

  private primeCarrier: { item: AudibleItem; source: 'prime' | 'gesture-retry'; started: number } | null =
    null;

  /** Attempt the real-sample fallback prime (O3). Coalesces with an in-flight prime (P8). */
  attemptSamplePrime(source: 'prime' | 'gesture-retry'): void {
    if (this.primeInFlight) return;
    if (this.current !== null && this.soundStartAt !== null) return; // something is sounding; latch is proven by it
    // Element isolation (P1/P2): the sample prime must never share
    // the element — or its ended/error handlers — with a resting
    // current item. Park the item unsettled first; it redrives
    // cleanly once the prime settles.
    if (this.current !== null) this.parkCurrent();
    const started = this.clock.now();
    const p = (async () => {
      this.primeActive = true;
      try {
        if (!this.primeUrl) this.primeUrl = makePrimeUrl();
        this.audio.load(this.primeUrl);
        await this.audio.play();
        this.hooks.emit('prime_attempt', { source, result: 'resolved', ms: this.clock.now() - started });
        this.noteSoundProof(source);
      } catch (err) {
        this.hooks.emit('prime_attempt', { source, result: 'rejected', ms: this.clock.now() - started });
        if (isBlockedError(err)) this.noteBlocked();
      } finally {
        this.primeActive = false;
        if (this.current === null) this.audio.load(null);
        // Whatever was parked (or held behind the prime) drives now:
        // on a proof this flushes the opening in order (O11); on a
        // refusal the hold simply keeps it parked.
        this.retryDrive();
      }
    })();
    this.primeInFlight = p.finally(() => {
      this.primeInFlight = null;
    });
  }

  /** Every in-tour gesture is a re-prime opportunity (P8). */
  noteGesture(heldFirstSound: AudibleItem | null): void {
    if (this.tornDown) return;
    if (this.latch === 'earned') return;
    if (heldFirstSound && !heldFirstSound.settled) {
      this.primeWithItem(heldFirstSound, 'gesture-retry');
    } else {
      this.attemptSamplePrime('gesture-retry');
    }
    this.stopProbe();
    if (this.latch === 'lost') this.startProbe();
  }

  /** Begin the tour with the GREETING as current + prime carrier (O1/O2). */
  beginWithItem(item: AudibleItem): void {
    this.current = item;
    this.markHeldIfNeeded();
    this.primeWithItem(item, 'prime');
    this.hooks.onState();
  }

  private noteSoundProof(source: LatchSource): void {
    const wasLost = this.latch === 'lost';
    this.latch = 'earned';
    this.failureStreak = 0;
    this.blockedAt = [];
    if (!this.latchedOnce) {
      this.latchedOnce = true;
      this.hooks.onFirstLatch(source);
    }
    if (wasLost) {
      this.lossDeclared = false;
      this.stopProbe();
      this.hooks.onLatchRestored();
    }
    this.heldSince = null;
  }

  private noteBlocked(): void {
    // P1 salvage: every platform refusal is countable in the record,
    // in A's vocabulary (A's Oct 29 morning failure was diagnosed
    // from audio_blocked counts; B filed nothing).
    this.hooks.emit('audio_blocked', {
      source: 'blocked',
      kind: 'blocked',
      stage: 'playback',
      reason: 'blocked',
      message: 'audio blocked by the platform (autoplay/permission)',
    });
    const now = this.clock.now();
    this.blockedAt = [...this.blockedAt.filter(t => now - t <= BLOCKED_BURST_WINDOW_MS), now];
    if (this.latch === 'earned' && !this.lossDeclared && this.blockedAt.length >= 2) {
      this.lossDeclared = true;
      this.latch = 'lost';
      this.markHeldIfNeeded();
      this.hooks.onLatchLost();
      this.startProbe();
    }
  }

  private startProbe(): void {
    this.stopProbe();
    this.probeTimer = this.clock.setInterval(() => {
      if (this.latch !== 'lost') {
        this.stopProbe();
        return;
      }
      this.attemptSamplePrime('prime');
    }, PROBE_MS);
  }

  private stopProbe(): void {
    if (this.probeTimer !== null) {
      this.clock.clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }

  // ---------------------------------------------------------- F3 filler proof path

  /**
   * Attempt a bridge+filler pair ahead of held debt to prove the
   * unlock (F3). The pair becomes current in order; debt stays
   * promised and flushes after the pair under the normal pump (O11).
   */
  proofPair(bridge: AudibleItem, filler: AudibleItem): void {
    if (this.current !== null) return;
    bridge.proof = true;
    filler.proof = true;
    this.proofChain = [bridge, filler];
    // The bridge leaves the chain as it becomes current — leaving it
    // in would re-take the settled bridge on the next pump and jam
    // the player on a finished item.
    this.current = this.proofChain.shift() as AudibleItem;
    this.driveCurrent();
    this.hooks.onState();
  }

  private proofChain: AudibleItem[] | null = null;

  // ---------------------------------------------------------- transport controls

  pauseByUser(): void {
    this.userPaused = true;
    this.audio.pause();
    this.hooks.onState();
  }

  resumeByUser(): void {
    this.userPaused = false;
    if (this.current && this.soundStartAt !== null) {
      void this.audio.play().catch(() => undefined);
    } else {
      this.pump();
    }
    this.hooks.onState();
  }

  /** Listener skip: ends position 1 (Q1) and advances. */
  skipCurrent(): void {
    if (!this.current) return;
    const item = this.current;
    this.current = null;
    this.driveGen += 1;
    this.audio.pause();
    this.settleItem(item, {
      sounded: this.soundStartAt !== null,
      completed: false,
      soundedMs: this.soundedMs(),
      failKind: 'none',
      exhausted: false,
      dropReason: null,
      skipped: true,
    });
    this.soundStartAt = null;
    this.afterSettle();
  }

  /**
   * Colour commentary yields to a committed story (B·Miles lane,
   * Oct 29, 2026): if the current item is commentary, cut it now via
   * the skip mechanics so the story takes the element with no delay.
   * Commentary is the only cuttable kind — stories, fillers and
   * promised lines are never cut. Returns whether a cut happened.
   */
  preemptCommentary(): boolean {
    if (!this.current || this.current.kind !== 'commentary') return false;
    this.skipCurrent();
    return true;
  }

  seekBy(sec: number): void {
    this.audio.seekBy(sec);
  }

  /** Tour teardown: every unsettled item settles exactly once (O13). */
  teardown(): void {
    this.tornDown = true;
    this.driveGen += 1;
    this.stopProbe();
    this.clearProgressWatchdog();
    if (this.gapTimer !== null) this.clock.clearTimeout(this.gapTimer);
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    this.audio.pause();
    this.audio.load(null);
    const currentItem = this.current;
    const currentSoundedMs = this.soundedMs();
    const all: AudibleItem[] = [];
    if (currentItem) all.push(currentItem);
    all.push(...this.promised, ...this.pendingPriority);
    if (this.waitingStory) all.push(this.waitingStory);
    if (this.proofChain) all.push(...this.proofChain.filter(i => i !== currentItem));
    this.current = null;
    this.promised = [];
    this.pendingPriority = [];
    this.waitingStory = null;
    this.proofChain = null;
    for (const item of all) {
      const wasCurrent = item === currentItem;
      this.settleItem(item, {
        sounded: wasCurrent && this.soundStartAt !== null,
        completed: false,
        soundedMs: wasCurrent ? currentSoundedMs : 0,
        failKind: 'none',
        exhausted: false,
        dropReason: item.kind === 'story' ? 'teardown' : null,
        skipped: false,
      });
    }
    this.soundStartAt = null;
    this.hooks.onState();
  }

  // ---------------------------------------------------------- the drive loop

  private markHeldIfNeeded(): void {
    if (this.holdActive() && this.hasHeldMaterial() && this.heldSince === null) {
      this.heldSince = this.clock.now();
    }
    if (!this.holdActive()) this.heldSince = null;
  }

  private pump(): void {
    if (this.tornDown || this.userPaused) return;
    if (this.current !== null) return;
    if (this.holdActive() && !(this.proofChain && this.proofChain.length > 0)) {
      this.markHeldIfNeeded();
      this.hooks.onState();
      return;
    }
    const next = this.takeNext();
    if (!next) {
      this.hooks.onState();
      return;
    }
    this.current = next;
    this.driveCurrent();
    this.hooks.onState();
  }

  private takeNext(): AudibleItem | null {
    // Proof chain continuation (F3): the filler follows its bridge.
    if (this.proofChain && this.proofChain.length > 0) {
      return this.proofChain.shift() as AudibleItem;
    }
    if (this.proofChain && this.proofChain.length === 0) this.proofChain = null;
    // One admission rule: nothing else is taken while the latch is
    // unearned or lost; held items wait with attempts untouched.
    if (this.latch !== 'earned') return null;
    const promisedHead = this.promised.shift();
    if (promisedHead) return promisedHead;
    // Location story: judge freshness at dequeue (Q8).
    while (this.waitingStory) {
      const item = this.waitingStory;
      const verdict = this.hooks.judgeStory(item);
      if (verdict.ok) {
        this.waitingStory = null;
        this.refillSlotFromPending();
        return item;
      }
      this.waitingStory = null;
      this.settleItem(item, this.dropRecord(verdict.reason));
      this.refillSlotFromPending();
      if (!this.waitingStory) this.hooks.onSlotEmpty();
    }
    return null;
  }

  private refillSlotFromPending(): void {
    if (!this.waitingStory && this.pendingPriority.length > 0) {
      this.waitingStory = this.pendingPriority.shift() as AudibleItem;
      // Taking the slot is the pending Tier-1's commitment (Q4/§8).
      this.commitStory(this.waitingStory);
      this.hooks.onWaiting(this.waitingStory);
    }
  }

  private dropRecord(reason: string): SettleRecord {
    return {
      sounded: false,
      completed: false,
      soundedMs: 0,
      failKind: 'none',
      exhausted: false,
      dropReason: reason,
      skipped: false,
    };
  }

  private soundedMs(): number {
    return this.soundStartAt !== null ? this.clock.now() - this.soundStartAt : 0;
  }

  private commitMarked = new Set<string>();

  private async driveCurrent(): Promise<void> {
    const item = this.current;
    if (!item || item.settled) return;
    const gen = ++this.driveGen;
    const stale = () => this.tornDown || gen !== this.driveGen || this.current !== item;
    if (!this.commitMarked.has(item.id)) {
      this.commitMarked.add(item.id);
      this.hooks.onCommit(item);
    }

    // Resolve audio: a synthesis failure is not a playback attempt
    // (E7) and not a playback failure either — it never feeds the
    // E3 streak (P13: penalty signals stay scoped to their path).
    // The engine runs its own stand-down economy off failKind.
    let url: string;
    if (item.source.kind === 'url' && item.kind !== 'bridge' && item.kind !== 'filler') {
      // Stored-clip fast path (O1/M1): a plain URL source resolves
      // synchronously — no await may intervene between the caller's
      // gesture and the element for the prime carrier, and no
      // machinery is needed for library/opener audio. (Bridges and
      // fillers detour through the pinned-cache lookup, F4.)
      url = item.source.url;
    } else {
      // Stall cover races the wait (S12): the 4 s timer starts at
      // commit; if it fires while resolution is still pending, the
      // phrase plays concurrently and the story proceeds the moment
      // its audio lands — the phrase never plays after the wait it
      // was meant to cover.
      let stallPromise: Promise<void> | null = null;
      let stallTimer: unknown = null;
      if (item.kind === 'story' && !this.stallUsedFor.has(item.id)) {
        stallTimer = this.clock.setTimeout(() => {
          if (stale() || this.stallUsedFor.has(item.id)) return;
          const stall = this.hooks.stallSource();
          if (!stall) return;
          this.stallUsedFor.add(item.id);
          stallPromise = this.playClip(stall.url, stall.durationSec, gen);
        }, STALL_AFTER_MS);
      }
      // Resolution retries are paced and capped exactly like
      // playback attempts: an unpaced mint-fail-remint cycle
      // against a synthesis outage would spin at promise speed
      // (and burn generation quota in production). The tour's
      // synthesis stand-down economy engages off these settles.
      let resolved: string | null = null;
      let synthTries = 0;
      while (resolved === null) {
        let resolveWatchdog: unknown = null;
        try {
          resolved = await Promise.race([
            this.hooks.resolveUrl(item),
            new Promise<never>((_resolve, reject) => {
              resolveWatchdog = this.clock.setTimeout(
                () =>
                  reject(
                    Object.assign(new Error('audio resolution did not settle'), {
                      name: 'ResolveTimeout',
                    }),
                  ),
                RESOLVE_WATCHDOG_MS,
              );
            }),
          ]);
        } catch (err) {
          void err;
          synthTries += 1;
        } finally {
          if (resolveWatchdog !== null) this.clock.clearTimeout(resolveWatchdog);
        }
        if (resolved === null) {
          if (stale()) {
            if (stallTimer !== null) this.clock.clearTimeout(stallTimer);
            return;
          }
          if (synthTries >= this.hooks.attemptCap()) break;
          await this.wait(RETRY_MS);
          if (stale()) {
            if (stallTimer !== null) this.clock.clearTimeout(stallTimer);
            return;
          }
        }
      }
      if (stallTimer !== null) this.clock.clearTimeout(stallTimer);
      if (resolved === null) {
        if (stale()) return;
        this.current = null;
        this.settleItem(item, {
          sounded: false,
          completed: false,
          soundedMs: 0,
          failKind: 'synthesis',
          exhausted: true,
          // §8's closed reason vocabulary has no synthesis value;
          // an undelivered synth story files under the player's
          // terminal-unsounded bucket (documented contract gap).
          dropReason: item.kind === 'story' ? 'attempts-exhausted' : null,
          skipped: false,
        });
        this.afterSettle();
        return;
      }
      url = resolved;
      if (stale()) return;
      // The phrase yields to the story's own audio as soon as it
      // exists — but a phrase already sounding finishes its breath
      // rather than being cut mid-word (it is ≤ ~4 s, self-bounded
      // inside playClip).
      if (stallPromise) {
        await stallPromise;
        if (stale()) return;
      }
    }

    // Attempt loop (P12: attempts counted at commit to play).
    for (;;) {
      if (stale()) return;
      // Listener pause is authoritative inside the loop too: an
      // in-flight resolve or retry beat must not sound into a
      // paused tour.
      while (this.userPaused && !stale()) {
        await this.wait(200);
      }
      if (stale()) return;
      if (this.holdActive() && !this.isPrimeCarrierItem(item) && !item.proof) {
        // Hold engaged: wait unattempted (P3/P4). The prime carrier
        // and F3 proof items are the only writers allowed inside the
        // window — they attempt in order to end it (P2, F3).
        this.markHeldIfNeeded();
        this.hooks.onState();
        return;
      }
      item.attempts += 1;
      const attemptStart = this.clock.now();
      this.audio.load(url);
      let playError: unknown = null;
      let watchdog: unknown = null;
      const watchdogP = new Promise<never>((_resolve, reject) => {
        watchdog = this.clock.setTimeout(
          () =>
            reject(
              Object.assign(new Error('play() did not settle'), {
                name: 'WatchdogTimeout',
              }),
            ),
          PLAY_WATCHDOG_MS,
        );
      });
      try {
        await Promise.race([this.audio.play(), watchdogP]);
      } catch (err) {
        playError = err;
      } finally {
        this.clock.clearTimeout(watchdog);
      }
      if (stale()) return;

      if (playError === null) {
        // Sounding.
        if (this.soundStartAt === null) this.soundStartAt = this.clock.now();
        this.armProgressWatchdog(item);
        this.hooks.onSoundStart(item);
        if (this.isPrimeCarrierItem(item)) {
          const carrier = this.primeCarrier as { source: 'prime' | 'gesture-retry'; started: number };
          this.hooks.emit('prime_attempt', {
            source: carrier.source,
            result: 'resolved',
            ms: this.clock.now() - carrier.started,
          });
          this.primeCarrier = null;
          this.noteSoundProof(carrier.source);
        } else {
          this.noteSoundProof('playback-proof');
        }
        this.hooks.onState();
        return; // settle arrives via the ended handler
      }

      // Failure exits.
      const blocked = isBlockedError(playError);
      if (this.isPrimeCarrierItem(item)) {
        const carrier = this.primeCarrier as { source: 'prime' | 'gesture-retry'; started: number };
        this.hooks.emit('prime_attempt', {
          source: carrier.source,
          result: 'rejected',
          ms: this.clock.now() - carrier.started,
        });
        this.primeCarrier = null;
        if (blocked) this.noteBlocked();
        // The carrier item stays current and unattempted-in-effect: its
        // prime attempt does not consume its playback economy — reset
        // and hand control to the engine's recovery (fallback prime /
        // hold). The engine re-drives via retryDrive().
        item.attempts -= 1;
        this.audio.load(null);
        this.hooks.onState();
        this.hooks.onPrimeCarrierFailed(blocked);
        return;
      }
      void attemptStart;
      if (blocked) this.noteBlocked();
      this.failureStreak += 1;
      // E3 trips on the crossing only; failures past the trip must
      // not keep re-tripping (and re-doubling) the storm.
      if (this.failureStreak === 3) this.hooks.onFailureStreak();
      if (this.latch === 'lost') {
        // Hold re-engaged mid-item: stop attempting, keep the item (P4).
        this.markHeldIfNeeded();
        this.hooks.onState();
        return;
      }
      if (item.attempts >= this.hooks.attemptCap()) {
        if (!blocked) {
          // P1 salvage: a non-blocked playback failure that exhausts
          // its economy files audio_blocked in A's 'error' kind (a
          // blocked exhaustion already filed per refusal, above).
          this.hooks.emit('audio_blocked', {
            source: 'error',
            kind: 'error',
            stage: 'playback',
            reason: 'error',
            message: 'audio error (synthesis or playback failure)',
          });
        }
        this.current = null;
        this.audio.load(null);
        this.settleItem(item, {
          sounded: this.soundStartAt !== null,
          completed: false,
          soundedMs: this.soundedMs(),
          failKind: blocked ? 'blocked' : 'error',
          exhausted: true,
          dropReason: item.kind === 'story' ? 'attempts-exhausted' : null,
          skipped: false,
        });
        this.soundStartAt = null;
        this.afterSettle();
        return;
      }
      // Bounded retry after a beat.
      await this.wait(RETRY_MS);
    }
  }

  private isPrimeCarrierItem(item: AudibleItem): boolean {
    return this.primeCarrier !== null && this.primeCarrier.item === item;
  }

  /** Engine recovery hook: re-drive the current item after a prime-carrier failure or a latch restore. */
  retryDrive(): void {
    if (this.current && !this.current.settled && this.soundStartAt === null) {
      this.driveCurrent();
    } else if (!this.current) {
      this.pump();
    }
    this.hooks.onState();
  }

  /**
   * Park the current item WITHOUT settling it: it returns to the head
   * of the promised queue, still owed. Used when the opening gate
   * fires on a first-sound item that never sounded (resting after a
   * carrier failure, or wedged mid-attempt): the element must free
   * up so the F3 proof pair can attempt, and the debt item then
   * flushes first once the latch earns (O10/O12, T8b). No-op when
   * the current item is actually sounding.
   */
  parkCurrent(): void {
    const item = this.current;
    if (!item || item.settled || this.soundStartAt !== null) return;
    this.driveGen += 1; // orphan any in-flight attempt loop
    this.audio.pause();
    this.audio.load(null);
    this.current = null;
    this.promised.unshift(item);
    this.hooks.onState();
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => {
      this.retryTimer = this.clock.setTimeout(resolve, ms);
    });
  }

  private playClip(url: string, durationSec: number, gen: number): Promise<void> {
    // A short stored clip (stall phrase) on the shared element. Not an
    // item: no attempts, no settle. Resolves when it ends or fails.
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.audio.setEndedHandler(() => this.handleEnded());
        resolve();
      };
      this.audio.setEndedHandler(finish);
      this.audio.load(url);
      const timeout = this.clock.setTimeout(finish, (durationSec + 2) * 1000);
      void timeout;
      this.audio.play().then(
        () => this.noteSoundProof('playback-proof'),
        () => finish(),
      );
      void gen;
    });
  }

  /**
   * Playback-progress watchdog: after sound starts, an item that
   * neither ends nor errors within its expected duration + slack
   * is a stalled stream — force it through the element-error path
   * so it settles truthfully instead of wedging the player.
   */
  private armProgressWatchdog(item: AudibleItem): void {
    this.clearProgressWatchdog();
    this.progressFor = item.id;
    this.progressTimer = this.clock.setTimeout(
      () => {
        if (this.current === item && !item.settled && this.soundStartAt !== null) {
          this.handleElementError();
        }
      },
      (Math.max(item.durationSec, 5) + PROGRESS_SLACK_MS / 1000) * 1000,
    );
  }

  private clearProgressWatchdog(): void {
    if (this.progressTimer !== null) this.clock.clearTimeout(this.progressTimer);
    this.progressTimer = null;
    this.progressFor = null;
  }

  private handleEnded(): void {
    if (this.primeActive) return; // the sample prime owns the element; its own promise settles it
    const item = this.current;
    if (!item || item.settled) return;
    this.current = null;
    this.settleItem(item, {
      sounded: true,
      completed: true,
      soundedMs: this.soundedMs(),
      failKind: 'none',
      exhausted: false,
      dropReason: null,
      skipped: false,
    });
    this.soundStartAt = null;
    this.afterSettle();
  }

  private handleElementError(): void {
    if (this.primeActive) return; // the sample prime owns the element right now
    // Element-level error while sounding: treat as a failed attempt —
    // settle truthfully if the item sounded, else count toward cap.
    const item = this.current;
    if (!item || item.settled || this.soundStartAt === null) return;
    this.current = null;
    this.failureStreak += 1;
    if (this.failureStreak === 3) this.hooks.onFailureStreak();
    this.settleItem(item, {
      sounded: true,
      completed: false,
      soundedMs: this.soundedMs(),
      failKind: 'error',
      exhausted: false,
      dropReason: null,
      skipped: false,
    });
    this.soundStartAt = null;
    this.afterSettle();
  }

  private afterSettle(): void {
    this.refillSlotFromPending();
    if (!this.waitingStory && this.pendingPriority.length === 0) {
      // A story slot vacancy after a settle is a serve trigger (S2);
      // the engine decides whether a cycle is due.
      this.hooks.onSlotEmpty();
    }
    if (this.gapTimer !== null) this.clock.clearTimeout(this.gapTimer);
    this.gapTimer = this.clock.setTimeout(() => this.pump(), GAP_MS);
    this.markHeldIfNeeded();
    this.hooks.onState();
  }

  private settleItem(item: AudibleItem, rec: SettleRecord): void {
    if (item.settled) return;
    item.settled = true;
    if (this.progressFor === item.id) this.clearProgressWatchdog();
    item.onSettle(rec);
  }
}

function isBlockedError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'NotAllowedError'
  );
}

// ------------------------------------------------------------ browser adapter

/** The real element adapter (browser only; the harness injects a fake). */
export function createBrowserAudio(): AudioPort {
  const el = new Audio();
  el.preload = 'auto';
  let objectUrl: string | null = null;
  return {
    load(src: string | null) {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      if (src === null) {
        el.removeAttribute('src');
        el.load();
        return;
      }
      el.src = src;
    },
    play: () => el.play(),
    pause: () => el.pause(),
    seekBy(sec: number) {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        el.currentTime = Math.min(Math.max(0, el.currentTime + sec), el.duration);
      } else {
        el.currentTime = Math.max(0, el.currentTime + sec);
      }
    },
    timeSec: () => el.currentTime,
    setEndedHandler(cb) {
      el.onended = cb;
    },
    setErrorHandler(cb) {
      el.onerror = cb;
    },
  };
}
