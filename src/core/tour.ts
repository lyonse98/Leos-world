// The Tour engine — the fresh shell's orchestrator.
//
// Owns the opening transaction (§1), serve cycles and the telling
// ledger (§3/§4), the economies' tour-side state (§5), the Q&A lock
// (§6), and the silence-filler lane (§7), and files the §8 telemetry
// contract. Playback itself belongs to the Player; network access
// arrives through seams so the bench harness drives this same code
// with fakes.

import {
  Player,
  systemClock,
  nextItemId,
  type AudioPort,
  type AudibleItem,
  type Clock,
  type LatchSource,
  type SettleRecord,
} from './player';
import * as backend from './backend';
import * as gemini from './gemini';
import * as facts from './facts';
import {
  GREETINGS_FRESH,
  GREETINGS_RESUME,
  GREETING_CLIPS,
  OPENER_CLIPS,
  STALL_CLIPS,
  BRIDGE_CLIPS,
  type OpenerClip,
} from '../content/clips';
import {
  COMMENTARY_CLIPS,
  COMMENTARY_ENABLED,
  COMMENTARY_MIN_GAP_MS,
  type CommentaryTod,
} from '../content/commentary';
import {
  CORRIDOR_SEGMENTS,
  matchCorridor,
  type CorridorSegment,
} from '../data/corridors';
import {
  fillerTagsForTitle,
  resolveFillerRegion,
  orderFillersForRegion,
  fillerMatchFor,
  type FillerRegion,
} from '../data/fillerRegions';
import { LEO_PERSONA_VERSION } from '../services/leoPersona';
import { calculateDistance, bearingDegrees, headingDelta, estimateSpeechDurationS } from '../utils/geo';
import { hashString } from '../utils/hash';

export interface Position {
  lat: number;
  lng: number;
  speedMps: number;
  headingDeg: number | null;
}

export type OpeningState = 'idle' | 'priming' | 'welcoming' | 'covered' | 'open' | 'failed';
export type ModeName = 'walking' | 'driving' | 'highway' | 'rural';

/** Network seams: production defaults, harness fakes. */
export interface NetSeams {
  fetchLibraryIndex: typeof backend.fetchLibraryIndex;
  fetchLibraryRow: typeof backend.fetchLibraryRow;
  fetchFillerRows: typeof backend.fetchFillerRows;
  findCachedStory: typeof backend.findCachedStory;
  putCachedStory: typeof backend.putCachedStory;
  fetchHeardTopics: typeof backend.fetchHeardTopics;
  recordHeard: typeof backend.recordHeard;
  recordLike: typeof backend.recordLike;
  emitEvent: typeof backend.emitEvent;
  pinBucketAudio: typeof backend.pinBucketAudio;
  audioCacheGet: typeof backend.audioCacheGet;
  audioCachePut: typeof backend.audioCachePut;
  audioCacheHas: typeof backend.audioCacheHas;
  bucketUrl: typeof backend.bucketUrl;
  synthesize: typeof gemini.synthesizeSpeech;
  generateStory: typeof gemini.generateStoryText;
  generatePrefetch: typeof gemini.generatePrefetchText;
  generateAnswer: typeof gemini.generateAnswerText;
  ttsQuotaTripped: typeof gemini.ttsQuotaTripped;
  storyQuotaTripped: typeof gemini.storyQuotaTripped;
  discoverCandidates: typeof facts.discoverCandidates;
  reverseArea: typeof facts.reverseArea;
  buildFactPack: typeof facts.buildFactPack;
}

const realSeams: NetSeams = {
  fetchLibraryIndex: backend.fetchLibraryIndex,
  fetchLibraryRow: backend.fetchLibraryRow,
  fetchFillerRows: backend.fetchFillerRows,
  findCachedStory: backend.findCachedStory,
  putCachedStory: backend.putCachedStory,
  fetchHeardTopics: backend.fetchHeardTopics,
  recordHeard: backend.recordHeard,
  recordLike: backend.recordLike,
  emitEvent: backend.emitEvent,
  pinBucketAudio: backend.pinBucketAudio,
  audioCacheGet: backend.audioCacheGet,
  audioCachePut: backend.audioCachePut,
  audioCacheHas: backend.audioCacheHas,
  bucketUrl: backend.bucketUrl,
  synthesize: gemini.synthesizeSpeech,
  generateStory: gemini.generateStoryText,
  generatePrefetch: gemini.generatePrefetchText,
  generateAnswer: gemini.generateAnswerText,
  ttsQuotaTripped: gemini.ttsQuotaTripped,
  storyQuotaTripped: gemini.storyQuotaTripped,
  discoverCandidates: facts.discoverCandidates,
  reverseArea: facts.reverseArea,
  buildFactPack: facts.buildFactPack,
};

export interface TourDeps {
  audio: AudioPort;
  clock?: Clock;
  seams?: Partial<NetSeams>;
  /**
   * Warmed prime-carrier assets (P2 salvage): bucket path → blob
   * object URL for the stored greeting/opener clips, resolved from
   * the pinned on-device cache by an earlier instance's landing warm.
   * App hands the landing engine's map to the START engine, so the
   * tap's first play() is a local blob — never a network fetch
   * (A's primeClipUrl discipline, adapted to the per-tour engine).
   */
  clipUrls?: Map<string, string>;
}

export interface TourView {
  phase: 'idle' | 'active' | 'ended';
  opening: OpeningState;
  latch: 'unearned' | 'earned' | 'lost';
  banner: 'blocked' | 'interrupted' | null;
  nowPlaying: { label: string; kind: string } | null;
  upNext: string | null;
  userPaused: boolean;
  qaLocked: boolean;
  qaPhase: 'idle' | 'generating' | 'answering' | 'awaiting-resume';
  lastStory: { subject: string; label: string; angle: string | null } | null;
  likedSubject: string | null;
  diagnostics: {
    storiesPlayed: number;
    storiesDropped: number;
    fillersPlayed: number;
    questionsAnswered: number;
    storm: boolean;
    ttsQuota: boolean;
    storyQuota: boolean;
    bufferCount: number;
    neighborhood: string | null;
  };
}

const BACKSTOP_MS = 180_000;
const WELCOME_COOLDOWN_MS = 180_000;
const QA_FAILSAFE_MS = 150_000;
const QA_GRACE_MS = 45_000;
const STORM_BASE_MS = 90_000;
const FREEWAY_MPS = 15;

interface BufferedText {
  subject: string;
  text: string;
  generatedAt: number;
  candidate: facts.Candidate;
}

interface FillerEntry {
  placeKey: string;
  title: string;
  audioPath: string;
}

export class Tour {
  private clock: Clock;
  private seams: NetSeams;
  readonly player: Player;
  /** Warmed greeting/opener clip object URLs (see TourDeps.clipUrls). */
  readonly clipUrls: Map<string, string>;

  phase: 'idle' | 'active' | 'ended' = 'idle';
  private sessionId = '';
  private userKey = '';
  private tourStartAt = 0;
  private resumeStart = false;

  private position: Position | null = null;
  private area: facts.AreaContext = { neighborhood: null, city: null, road: null };
  private areaResolvedAt: Position | null = null;

  // Opening (§1)
  private opening: OpeningState = 'idle';
  private debt = new Set<string>();
  private greetingItem: AudibleItem | null = null;
  private openerPrimaryClipId: string | null = null;
  private openerExtensionUsed = false;
  private backstopTimer: unknown = null;
  private welcomeState: 'none' | 'warming' | 'ready' | 'handed' | 'settled' = 'none';
  private pendingWelcome: AudibleItem | null = null;

  // Neighborhood welcomes (O14/O15)
  private welcomed = new Set<string>();
  private owedWelcome: { name: string; retryAt: number } | null = null;
  private welcomeServing = false;
  /** An owed WELCOME has been generated and offered; it re-arms only when that item settles. */
  private welcomeOffered = false;

  // Telling ledger (§3)
  private inflight = new Set<string>();
  /**
   * Judge-drop context markers: a story dropped at dequeue for
   * stale-age / stale-behind / out-of-reach failed a deterministic
   * function of (anchor, position, heading, speed, age) — at the
   * same context it would fail again with certainty, and the
   * settle→cycle→serve→drop loop is pure microtask spin. The
   * subject therefore rests until the driver has genuinely moved
   * (≥ 250 m). This is serve-context memoization, NOT a telling
   * rule: nothing is told, consumed, or spent (Q12/Q13 intact),
   * and displacement/failure settles never rest a subject.
   */
  private judgeDropSpots = new Map<string, { lat: number; lng: number }>();
  private toldCount = new Map<string, number>();
  private dealtAngles = new Map<string, Set<string>>();
  private retellUsed = new Set<string>();
  private corridorConsumed = new Set<string>();
  private corridorEligible = new Set<string>();
  private lastStoryItem: AudibleItem | null = null;
  private lastSubject: string | null = null;

  // Serve machinery (§4)
  private libraryIndex: backend.LibraryIndexEntry[] = [];
  private cycling = false;
  private cycleAgain = false;
  private buffer = new Map<string, BufferedText>();
  private fetchSamples: number[] = [];
  private synthSamples: number[] = [];
  private durationSamples: number[] = [];
  private lastCyclePos: Position | null = null;
  private objectUrls = new Map<string, string>();

  // Economies (§5)
  private stormUntil = 0;
  private stormTrips = 0;
  private lastStormTripAt = 0;
  // Synthesis stand-down: the tour-side economy for resolve-path
  // failures (failKind 'synthesis'). Kept separate from the E3
  // playback storm on purpose (P13): a TTS outage must not tax
  // banked playback, and a playback storm must not tax synthesis.
  private synthFailStreak = 0;
  private synthStandDownUntil = 0;
  private synthStandDownTrips = 0;

  // Q&A (§6)
  private qaPhase: TourView['qaPhase'] = 'idle';
  private qaFailsafe: unknown = null;
  private qaGrace: unknown = null;


  private tickTimer: unknown = null;

  // Filler lane (§7)
  private fillerPool: FillerEntry[] = [];
  private fillerOrder: FillerEntry[] = [];
  private fillerSpent = new Set<string>();
  private fillerReady = false;
  // Colour commentary lane (B·Miles only, Oct 29, 2026): pre-rendered
  // bank, conservative caps, yields instantly to any committed story.
  private commentarySpent = new Set<string>();
  private commentaryReady = false;
  private commentaryStoodDown = false; // bucket kill-switch (config.json)
  private commentaryItem: AudibleItem | null = null;
  private lastCommentaryAt = Number.NEGATIVE_INFINITY;
  private firstStoryCompletedAt: number | null = null;
  private lastStoryCompletedAt = 0;
  private silenceMs = 0;
  private lastTickAt = 0;
  private chainCount = 0;
  private lastBridgeSlug: string | null = null;
  private pairOutstanding = false;
  private laneStoodDown = false;
  private stallSessionUsed = new Set<string>();
  private warming = new Set<string>();
  /** In-flight synth resolutions by cache key (presynth/drive dedupe). */
  private resolving = new Map<string, Promise<string>>();

  // UI glue
  private listeners = new Set<() => void>();
  private userPausedFlag = false;
  private interruptedFlag = false;
  private likedSubject: string | null = null;
  private counts = { storiesPlayed: 0, storiesDropped: 0, fillersPlayed: 0, questionsAnswered: 0 };

  constructor(deps: TourDeps) {
    this.clock = deps.clock ?? systemClock;
    this.seams = { ...realSeams, ...(deps.seams ?? {}) };
    this.clipUrls = deps.clipUrls ?? new Map();
    this.player = new Player(deps.audio, this.clock, {
      resolveUrl: item => this.resolveUrl(item),
      stallSource: () => this.pickStall(),
      emit: (type, payload) => this.emit(type, payload),
      onFirstLatch: source => this.onFirstLatch(source),
      onLatchLost: () => {
        this.emit('unlock_lost', {
          source: 'blocked-burst',
          ms_from_tour_start: this.clock.now() - this.tourStartAt,
        });
        this.notify();
      },
      onLatchRestored: () => {
        this.player.retryDrive();
        this.notify();
      },
      onPrimeCarrierFailed: () => {
        // Fallback prime is the tap's second carrier (O3/P7).
        this.player.attemptSamplePrime('prime');
      },
      onFailureStreak: () => this.tripStorm(),
      attemptCap: () => (this.clock.now() < this.stormUntil ? 1 : 3),
      judgeStory: item => this.judgeStory(item),
      mayDisplace: (waiter, newcomer, kind) => this.mayDisplace(waiter, newcomer, kind),
      onSlotEmpty: () => {
        if (this.phase === 'active') void this.runServeCycle('slot-empty');
      },
      onStoryCommitted: item => this.onStoryCommitted(item),
      onSoundStart: item => {
        // A5(a): a location story STARTING (sound actually begins)
        // after the answer settles is the resume that releases the
        // Q&A lock. A story whose audio never starts — a resolve
        // failure, a hold — is no resume; the grace covers it.
        if (item.kind === 'story' && this.qaPhase === 'awaiting-resume') {
          this.releaseQaLock('story-resumed');
        }
      },
      onWaiting: item => this.presynthWaiting(item),
      onCommit: item => this.onCommit(item),
      onState: () => this.notify(),
    });
  }

  // ------------------------------------------------------------ UI plumbing

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  view(): TourView {
    const snap = this.player.snapshot();
    const banner: TourView['banner'] = this.interruptedFlag
      ? 'interrupted'
      : snap.bannerDue
        ? 'blocked'
        : null;
    return {
      phase: this.phase,
      opening: this.opening,
      latch: snap.latch,
      banner,
      nowPlaying: snap.currentLabel ? { label: snap.currentLabel, kind: snap.currentKind ?? '' } : null,
      upNext: snap.waitingLabel,
      userPaused: this.userPausedFlag,
      qaLocked: this.qaPhase !== 'idle',
      qaPhase: this.qaPhase,
      // The view deliberately carries NO story text (Erik, Oct 30,
      // 2026): what Miles is speaking never renders on screen — the
      // UI shows a minimal now-playing card (place name / one line).
      lastStory: this.lastStoryItem
        ? {
            subject: this.lastStoryItem.subject ?? this.lastStoryItem.label,
            label: this.lastStoryItem.label,
            angle: this.lastStoryItem.angleOf ?? null,
          }
        : null,
      likedSubject: this.likedSubject,
      diagnostics: {
        storiesPlayed: this.counts.storiesPlayed,
        storiesDropped: this.counts.storiesDropped,
        fillersPlayed: this.counts.fillersPlayed,
        questionsAnswered: this.counts.questionsAnswered,
        storm: this.clock.now() < this.stormUntil || this.clock.now() < this.synthStandDownUntil,
        ttsQuota: this.seams.ttsQuotaTripped(),
        storyQuota: this.seams.storyQuotaTripped(),
        bufferCount: this.buffer.size,
        neighborhood: this.area.neighborhood,
      },
    };
  }

  private emit(type: string, payload: Record<string, unknown>): void {
    if (!this.sessionId) return;
    void this.seams.emitEvent(this.sessionId, type, payload, {
      lat: this.position?.lat ?? null,
      lng: this.position?.lng ?? null,
      movementMode: this.modeName(),
    });
  }

  // ------------------------------------------------------------ position intake

  onPosition(pos: Position): void {
    this.position = pos;
    if (this.phase !== 'active') return;
    // Meaningful movement is a serve trigger (S2).
    if (
      !this.lastCyclePos ||
      calculateDistance(pos.lat, pos.lng, this.lastCyclePos.lat, this.lastCyclePos.lng) > 200
    ) {
      void this.runServeCycle('movement');
    }
    void this.trackNeighborhood(pos);
    this.checkCorridorTrigger(pos);
  }

  private modeName(): ModeName {
    const speed = this.position?.speedMps ?? 0;
    if (speed >= FREEWAY_MPS) return this.area.neighborhood ? 'highway' : 'rural';
    if (speed >= 3.5) return 'driving';
    return 'walking';
  }

  // ------------------------------------------------------------ tour start (O1–O8)

  /**
   * START — called synchronously from the tap handler. The GREETING
   * clip attempt is the first media action and happens before any
   * await in this call path (O1/O2).
   */
  start(resume: boolean): void {
    if (this.phase === 'active') return;
    this.phase = 'active';
    this.resumeStart = resume;
    this.tourStartAt = this.clock.now();
    this.sessionId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tour-${this.tourStartAt}-${Math.floor(Math.random() * 1e9)}`;
    this.userKey = backend.deviceKey();
    backend.lsSet('sessionId', this.sessionId);
    backend.lsJsonSet('activeSession', { savedAt: Date.now() });

    // The opening transaction (one owner: this state). Nothing —
    // not even the session_start emit — precedes the GREETING's
    // attempt inside the tap (O1): the emit initiates a network
    // write, so it files after the opening is registered and begun.
    this.opening = 'priming';
    const line = this.pickGreeting(resume);
    const clip = GREETING_CLIPS[line.id];
    const greeting = this.makeItem({
      kind: 'greeting',
      label: `Greeting — ${line.text}`,
      source: { kind: 'url', url: this.clipSourceUrl(clip.path) },
      durationSec: clip.durationSec,
      onSettle: rec => this.onGreetingSettle(rec),
    });
    this.greetingItem = greeting;
    this.debt.add(greeting.id);
    this.player.beginWithItem(greeting);

    // OPENER debt behind the GREETING: fresh → medium, resume → short.
    const opener = this.pickOpener(resume ? 'short' : 'medium', []);
    if (opener) {
      const item = this.makeOpenerItem(opener, true);
      this.openerPrimaryClipId = opener.id;
      this.player.enqueuePromised(item);
    }

    this.emit('session_start', { variant: 'fresh' });

    // The 180-second backstop (O9).
    this.backstopTimer = this.clock.setTimeout(() => this.expireOpening(), BACKSTOP_MS);

    // Everything below warms in parallel; none of it gates the first sound.
    void this.initAsync(resume);
    this.lastTickAt = this.clock.now();
    this.tickTimer = this.clock.setInterval(() => this.tick(), 1000);
    this.notify();
  }

  private async initAsync(resume: boolean): Promise<void> {
    const index = await this.seams.fetchLibraryIndex();
    this.libraryIndex = index;
    void resume;
    // The WELCOME warms from the tap (O7).
    void this.serveOpeningWelcome();
    // The filler pool loads and pins in the background (F4).
    void this.loadFillerPool();
    // The commentary bank loads, pins, and checks its kill-switch.
    void this.loadCommentary();
    // Landing-warmed prefetch continues in-tour (S9/S10).
    void this.prefetchTick();
  }

  /** Landing-page warm (S1): opener assets + library index; commits nothing. */
  async warmLanding(): Promise<void> {
    const jobs: Promise<unknown>[] = [this.seams.fetchLibraryIndex()];
    for (const line of [...GREETINGS_FRESH, ...GREETINGS_RESUME]) {
      const clip = GREETING_CLIPS[line.id];
      if (clip) jobs.push(this.warmClipUrl(clip.path));
    }
    for (const opener of OPENER_CLIPS) jobs.push(this.warmClipUrl(opener.path));
    const [index] = (await Promise.all(jobs)) as [backend.LibraryIndexEntry[]];
    if (index.length) this.libraryIndex = index;
  }

  /**
   * Pin a stored clip AND resolve its blob object URL (P2 salvage):
   * the greeting is the prime carrier, and a carrier that still has
   * to cross the network inside the tap is the field gap (A's first
   * sound 2.76 s vs B's ~19 s on the Oct 29 drives). With the blob
   * warmed before the tap, the greeting's play() resolves locally.
   * A failed pin simply leaves the bucket URL as the source.
   */
  private async warmClipUrl(path: string): Promise<void> {
    await this.seams.pinBucketAudio(path);
    const blob = await this.seams.audioCacheGet(path);
    if (blob) this.clipUrls.set(path, this.objectUrlFor(path, blob));
  }

  /** The warmed blob URL for a stored clip, or its bucket URL. */
  private clipSourceUrl(path: string): string {
    return this.clipUrls.get(path) ?? this.seams.bucketUrl(path);
  }

  private pickGreeting(resume: boolean) {
    const pool = resume ? GREETINGS_RESUME : GREETINGS_FRESH;
    let last = -1;
    const raw = backend.lsGet('lastIntroIndex');
    if (raw !== null) last = parseInt(raw, 10);
    let idx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && idx === last) idx = (idx + 1) % pool.length;
    backend.lsSet('lastIntroIndex', String(idx));
    return pool[idx];
  }

  private pickOpener(lengthClass: 'short' | 'medium' | 'long', excludeIds: string[]): OpenerClip | null {
    const pool = OPENER_CLIPS.filter(o => o.lengthClass === lengthClass);
    if (pool.length === 0) return null;
    const played = backend.lsJson<Record<string, number>>('openersPlayed') ?? {};
    const now = Date.now();
    const fresh = pool.filter(
      o => !excludeIds.includes(o.id) && !(played[o.id] && now - played[o.id] < 7 * 24 * 3600_000),
    );
    const candidates = fresh.length > 0 ? fresh : pool.filter(o => !excludeIds.includes(o.id));
    const usable = candidates.length > 0 ? candidates : pool;
    const pick = usable[Math.floor(Math.random() * usable.length)];
    played[pick.id] = now;
    backend.lsJsonSet('openersPlayed', played);
    return pick;
  }

  private makeOpenerItem(clip: OpenerClip, primary: boolean): AudibleItem {
    const item = this.makeItem({
      kind: 'opener',
      label: `Opener — ${clip.id}`,
      source: { kind: 'url', url: this.clipSourceUrl(clip.path) },
      durationSec: clip.durationSec,
      onSettle: rec => this.onOpenerSettle(item, rec, primary),
    });
    this.debt.add(item.id);
    return item;
  }

  private makeItem(init: {
    kind: AudibleItem['kind'];
    label: string;
    source: AudibleItem['source'];
    durationSec: number;
    onSettle: (rec: SettleRecord) => void;
    story?: Partial<AudibleItem>;
  }): AudibleItem {
    return {
      id: nextItemId(init.kind),
      kind: init.kind,
      label: init.label,
      source: init.source,
      durationSec: init.durationSec,
      attempts: 0,
      settled: false,
      onSettle: init.onSettle,
      ...(init.story ?? {}),
    };
  }

  private onGreetingSettle(rec: SettleRecord): void {
    const item = this.greetingItem;
    this.emit('opener_spoken', {
      attempts: item?.attempts ?? 0,
      sounded: rec.sounded,
      ms_from_tour_start: this.clock.now() - this.tourStartAt,
    });
    if (item) this.debt.delete(item.id);
    if (this.opening === 'priming') {
      this.opening = this.debt.size > 0 ? 'welcoming' : 'covered';
    }
    this.afterDebtChange();
    this.notify();
  }

  private onOpenerSettle(item: AudibleItem, rec: SettleRecord, primary: boolean): void {
    this.debt.delete(item.id);
    void rec;
    // Settles arriving during teardown file their record but spawn
    // nothing: no extension openers, no handovers (O13 completeness
    // is the player's; side effects stop at tour end).
    if (this.phase !== 'active') return;
    // Fresh start, WELCOME still warming when the primary settles:
    // one long extension buys the rest of the runway.
    if (
      primary &&
      !this.resumeStart &&
      !this.openerExtensionUsed &&
      this.welcomeState !== 'ready' &&
      this.welcomeState !== 'handed' &&
      this.opening !== 'failed'
    ) {
      this.openerExtensionUsed = true;
      const extension = this.pickOpener('long', this.openerPrimaryClipId ? [this.openerPrimaryClipId] : []);
      if (extension) {
        const ext = this.makeOpenerItem(extension, false);
        this.player.enqueuePromised(ext);
      }
    }
    if (this.opening === 'welcoming' && this.debt.size === 0) this.opening = 'covered';
    this.afterDebtChange();
    this.notify();
  }

  /** Debt discharged → the reserved WELCOME may start (O8). */
  private afterDebtChange(): void {
    if (this.phase !== 'active') return;
    if (this.debt.size > 0) return;
    if (this.welcomeState === 'ready' && this.pendingWelcome) {
      const welcome = this.pendingWelcome;
      this.pendingWelcome = null;
      this.welcomeState = 'handed';
      this.player.offerStory(welcome, true);
    }
    this.maybeOpenTour();
  }

  /**
   * If the WELCOME's generation failed, it is OWED (O15) — the
   * opening sequence itself is still complete once the debt has
   * discharged, and the tour opens: the filler lane (F12) and the
   * story economy must not wait on a generation retry.
   */
  private maybeOpenTour(): void {
    if (this.opening === 'covered' && this.debt.size === 0 && this.welcomeState === 'none') {
      this.opening = 'open';
      this.notify();
    }
  }

  private expireOpening(): void {
    if (this.opening === 'open' || this.opening === 'failed' || this.phase !== 'active') return;
    // O12: a debt line actively discharging stands the backstop down.
    const current = this.player.current;
    if (current && this.debt.has(current.id) && this.player.isPlaying()) {
      this.backstopTimer = this.clock.setTimeout(() => this.expireOpening(), 15_000);
      return;
    }
    // A debt line that never sounded (resting after a carrier
    // failure, or wedged mid-attempt) is parked unsettled so the
    // element frees up for the F3 proof pair; it flushes first
    // when the latch earns (T8b).
    if (current && this.debt.has(current.id)) {
      this.player.parkCurrent();
    }
    this.opening = 'failed';
    // The WELCOME gate question is retired; a ready WELCOME now flows
    // as a priority story. Debt itself is NOT settled (O10).
    if (this.welcomeState === 'ready' && this.pendingWelcome) {
      const welcome = this.pendingWelcome;
      this.pendingWelcome = null;
      this.welcomeState = 'handed';
      this.player.offerStory(welcome, true);
    }
    void this.runServeCycle('gate-expired');
    this.notify();
  }

  private onFirstLatch(source: LatchSource): void {
    this.emit('unlock_latched', {
      source,
      ms_from_tour_start: this.clock.now() - this.tourStartAt,
    });
    this.player.retryDrive();
  }

  // ------------------------------------------------------------ the WELCOME (O7/O8, S6)

  private async serveOpeningWelcome(): Promise<void> {
    if (this.phase !== 'active') return;
    if (!this.position) {
      // No fix yet: retry shortly — the serve is owed from the tap.
      this.clock.setTimeout(() => void this.serveOpeningWelcome(), 1500);
      return;
    }
    const area = await this.seams.reverseArea(this.position.lat, this.position.lng);
    if (this.phase !== 'active') return;
    this.area = area;
    const name = area.neighborhood ?? area.city ?? 'this neighborhood';
    this.welcomeState = 'warming';
    const item = await this.generateWelcome(name, this.position);
    if (this.phase !== 'active') return;
    if (!item) {
      this.welcomeState = 'none';
      this.owedWelcome = { name, retryAt: this.clock.now() + WELCOME_COOLDOWN_MS };
      this.maybeOpenTour();
      return;
    }
    this.welcomeState = 'ready';
    this.pendingWelcome = item;
    this.afterDebtChange();
  }

  private async generateWelcome(name: string, at: Position): Promise<AudibleItem | null> {
    const pseudo: facts.Candidate = {
      name,
      lat: at.lat,
      lng: at.lng,
      source: 'places',
      types: ['neighborhood'],
      rating: null,
      userRatings: null,
      address: null,
      tier1: false,
      score: 0,
      registry: null,
      distanceM: 0,
    };
    try {
      const pack = await this.seams.buildFactPack(pseudo, this.area, []);
      const prompt = [
        `MODE: ${this.modeName()}`,
        `NEIGHBORHOOD WELCOME — the first real story of this tour. Welcome the listener to ${name}${this.area.city ? `, in ${this.area.city}` : ''}. This is a neighborhood introduction: what this place is, its character, its story — told to the standard of the neighborhood-intro exemption in your length rules.`,
        `FACT PACK:\n${facts.factPackText(pack)}`,
        this.exclusionsLine(),
      ].join('\n\n');
      const fetchStart = this.clock.now();
      const text = await this.seams.generateStory(prompt);
      this.sampleLatency(this.fetchSamples, this.clock.now() - fetchStart);
      const subject = `welcome:${name.toLowerCase()}`;
      const item = this.makeItem({
        kind: 'story',
        label: `Welcome to ${name}`,
        source: { kind: 'synth', text },
        durationSec: estimateSpeechDurationS(text),
        onSettle: rec => this.onStorySettle(item, rec),
        story: {
          subject,
          storySource: 'live',
          anchor: { lat: at.lat, lng: at.lng },
          regionAnchored: true,
          generatedAt: this.clock.now(),
          text,
          reserved: true,
        },
      });
      return item;
    } catch {
      return null;
    }
  }

  private async trackNeighborhood(pos: Position): Promise<void> {
    if (
      this.areaResolvedAt &&
      calculateDistance(pos.lat, pos.lng, this.areaResolvedAt.lat, this.areaResolvedAt.lng) < 300
    ) {
      return;
    }
    this.areaResolvedAt = pos;
    const area = await this.seams.reverseArea(pos.lat, pos.lng);
    const previous = this.area.neighborhood;
    this.area = area;
    const name = area.neighborhood;
    if (!name || name === previous) return;
    // O14: entering an unwelcomed neighborhood creates an owed WELCOME.
    if (
      this.phase === 'active' &&
      (this.opening === 'open' || this.opening === 'failed') &&
      !this.welcomed.has(name.toLowerCase()) &&
      !this.welcomeServing
    ) {
      this.owedWelcome = { name, retryAt: 0 };
      void this.serveOwedWelcome();
    }
    this.notify();
  }

  private async serveOwedWelcome(): Promise<void> {
    if (!this.owedWelcome || this.welcomeServing || this.welcomeOffered || !this.position) return;
    if (this.clock.now() < this.owedWelcome.retryAt) return;
    const { name } = this.owedWelcome;
    this.welcomeServing = true;
    try {
      const item = await this.generateWelcome(name, this.position);
      if (this.phase !== 'active') return;
      if (!item) {
        // O15: an unheard failed WELCOME remains owed, on a cooldown.
        this.owedWelcome = { name, retryAt: this.clock.now() + WELCOME_COOLDOWN_MS };
        return;
      }
      // The owed record clears only on a SOUNDED settle (O15): an
      // unheard serve re-arms it from onStorySettle. Until that
      // settle, the offered item IS the owed welcome in flight —
      // the tick must not mint another one behind it.
      this.welcomeOffered = true;
      // Next location story after the current one and promised lines (O14).
      this.player.offerStory(item, true);
    } finally {
      this.welcomeServing = false;
    }
  }

  // ------------------------------------------------------------ corridors (O16, Q11)

  private checkCorridorTrigger(pos: Position): void {
    if (this.phase !== 'active') return;
    const match = matchCorridor({ lat: pos.lat, lng: pos.lng, heading: pos.headingDeg });
    if (!match) return;
    const segment = match.segment;
    if (pos.speedMps >= FREEWAY_MPS) {
      this.corridorEligible.add(segment.id);
    }
    if (
      this.corridorEligible.has(segment.id) &&
      !this.corridorConsumed.has(segment.id) &&
      !this.inflight.has(`corridor:${segment.id}`)
    ) {
      // Claim synchronously (before any await): GPS ticks arrive
      // ~1 Hz and must not mint duplicate corridor serves.
      this.inflight.add(`corridor:${segment.id}`);
      void this.serveCorridor(segment);
    }
  }

  private async serveCorridor(segment: CorridorSegment): Promise<void> {
    const subject = `corridor:${segment.id}`;
    // Corridor serves respect the opening's ordering (O6/O8/O16):
    // a corridor story is never a tour's first story and never
    // jumps the reserved WELCOME. It may slot only once the
    // WELCOME has been handed to the player (so the corridor can
    // only ever wait BEHIND it), or once the opening has completed
    // or failed. The segment's eligibility persists, so a later
    // trigger serves it once the gate opens.
    const welcomeHanded = this.welcomeState === 'handed' || this.welcomeState === 'settled';
    if (!welcomeHanded && this.opening !== 'open' && this.opening !== 'failed') {
      this.inflight.delete(subject);
      return;
    }
    const entry = this.libraryIndex.find(
      e => e.place_key === backend.placeKeyOf(segment.displayName) && e.angle !== 'filler',
    );
    if (!entry) {
      this.inflight.delete(subject);
      return; // banked only in the fresh shell; no banked row → no corridor serve
    }
    const row = await this.seams.fetchLibraryRow(entry.place_key, entry.angle);
    if (!row || this.phase !== 'active') {
      this.inflight.delete(subject);
      return;
    }
    const exit = segment.polyline[segment.polyline.length - 1];
    const item = this.makeItem({
      kind: 'story',
      label: segment.displayName,
      source: { kind: 'url', url: this.seams.bucketUrl(row.audio_path) },
      durationSec: estimateSpeechDurationS(row.story_text),
      onSettle: rec => this.onStorySettle(item, rec),
      story: {
        subject,
        storySource: 'corridor',
        anchor: { lat: segment.polyline[0].lat, lng: segment.polyline[0].lng },
        regionAnchored: true,
        corridorSegmentId: segment.id,
        segmentExit: { lat: exit.lat, lng: exit.lng },
        generatedAt: this.clock.now(),
        text: row.story_text,
      },
    });
    this.inflight.add(subject);
    const landed = this.player.offerStory(item, false);
    if (landed === 'buffer') this.inflight.delete(subject);
  }

  // ------------------------------------------------------------ serve cycles (§4)

  private storiesGated(): boolean {
    // O6/O8: no location story is handed over while opening debt is
    // outstanding or the reserved WELCOME has not yet been handed.
    if (this.debt.size > 0) return true;
    // O9: once the backstop retires the opening, a still-warming
    // WELCOME no longer gates the tour — it flows as a priority
    // story when it lands, and the tour proceeds meanwhile.
    if (this.opening === 'failed') return false;
    if (this.welcomeState === 'warming' || this.welcomeState === 'ready') return true;
    return false;
  }

  async runServeCycle(reason: string): Promise<void> {
    void reason;
    if (this.phase !== 'active' || !this.position) return;
    if (this.cycling) {
      this.cycleAgain = true;
      return;
    }
    // A cycle that can serve must not wait passively (S2) — but a
    // cycle cannot hand stories over the opening gate (O6/O8).
    if (this.storiesGated()) return;
    // Storm economies (E3/E6) do NOT gate the cycle itself: banked
    // library/cache serves are PREFERRED while an economy stands.
    // Only live generation stands down, inside serveCandidate.
    this.cycling = true;
    this.lastCyclePos = this.position;
    try {
      const pos = this.position;
      const radius = this.modeName() === 'walking' ? 700 : 1600;
      const candidates = await this.seams.discoverCandidates(
        { lat: pos.lat, lng: pos.lng },
        radius,
      );
      let served = false;
      const top = candidates.slice(0, 6);
      for (let i = 0; i < top.length; i++) {
        const candidate = top[i];
        if (this.subjectBlocked(backend.placeKeyOf(candidate.name), candidate)) continue;
        // Every candidate is served and offered: the player's
        // displacement ruling (Q3/Q6) decides what an occupied
        // slot does with it, and a generated item that lands
        // 'buffer' is retained as prefetch text below — minting a
        // challenger is how displacement gets evaluated at all.
        const item = await this.serveCandidate(candidate, top);
        if (!item) continue; // S8: a failed serve refunds its decision
        if (this.phase !== 'active') {
          item.silent = true;
          this.player.abandon(item);
          break;
        }
        this.inflight.add(item.subject as string);
        const landed = this.player.offerStory(item, candidate.tier1);
        if (landed === 'buffer') {
          this.inflight.delete(item.subject as string);
          // The slot is full and this story did not displace it.
          // A generated text is retained as prefetch (S10) instead
          // of being thrown away, and the uncommitted item settles
          // silently, exactly once. Only a Tier-1 candidate further
          // down the list can still change the slot.
          if (item.source.kind === 'synth' && item.text) {
            const key = backend.placeKeyOf(candidate.name);
            this.buffer.set(key, {
              subject: key,
              text: item.text,
              generatedAt: item.generatedAt ?? this.clock.now(),
              candidate,
            });
          }
          item.silent = true;
          this.player.abandon(item);
          if (!top.slice(i + 1).some(c => c.tier1)) break;
          continue;
        }
        served = true;
        break;
      }
      // The area fallback fills SILENCE, not the slot behind a
      // playing story: a generic area story must never pre-claim
      // position 2 ahead of named places the next cycle could
      // serve (place-first, S4/S5 — relevancy).
      if (
        !served &&
        !this.player.waitingStory &&
        !this.player.current &&
        this.modeName() !== 'highway'
      ) {
        await this.serveAreaStory();
      }
    } catch {
      /* a failed cycle schedules nothing; triggers keep arriving (S2) */
    } finally {
      this.cycling = false;
      if (this.cycleAgain) {
        this.cycleAgain = false;
        void this.runServeCycle('again');
      }
    }
  }

  /** True while either failure economy stands: live generation pauses; banked serves are preferred (E3/E6). */
  private liveStandDown(): boolean {
    const now = this.clock.now();
    return now < this.stormUntil || now < this.synthStandDownUntil;
  }

  /** library → on-device/shared cache → buffered prefetch text → live (S4/S5). */
  private async serveCandidate(
    candidate: facts.Candidate,
    nearby: facts.Candidate[] = [],
  ): Promise<AudibleItem | null> {
    const key = backend.placeKeyOf(candidate.name);
    // Library, place-first at any eligible undealt angle (S5).
    const dealt = this.dealtAngles.get(key) ?? new Set<string>();
    const entry = this.libraryIndex.find(
      e => e.place_key === key && e.angle !== 'filler' && !dealt.has(e.angle),
    );
    if (entry) {
      const row = await this.seams.fetchLibraryRow(entry.place_key, entry.angle);
      if (row) {
        const item = this.makeItem({
          kind: 'story',
          label: row.place_name,
          source: { kind: 'url', url: this.seams.bucketUrl(row.audio_path) },
          durationSec: estimateSpeechDurationS(row.story_text),
          onSettle: rec => this.onStorySettle(item, rec),
          story: {
            subject: key,
            angleOf: entry.angle,
            storySource: 'library',
            anchor: { lat: row.lat, lng: row.lng },
            generatedAt: this.clock.now(),
            text: row.story_text,
            tier1: candidate.tier1,
          },
        });
        return item;
      }
    }
    // Shared on-device/ephemeral cache (tour_stories via the backend function).
    const cached = await this.seams
      .findCachedStory(candidate.lat, candidate.lng, 300, LEO_PERSONA_VERSION)
      .catch(() => null);
    if (cached && !this.subjectBlocked(backend.placeKeyOf(cached.topic), candidate)) {
      const cachedAt = cached.created_at ? Date.parse(cached.created_at) : NaN;
      const item = this.makeItem({
        kind: 'story',
        label: cached.topic,
        source: { kind: 'synth', text: cached.story_text },
        durationSec: estimateSpeechDurationS(cached.story_text),
        onSettle: rec => this.onStorySettle(item, rec),
        story: {
          subject: backend.placeKeyOf(cached.topic),
          storySource: 'cache',
          anchor: { lat: candidate.lat, lng: candidate.lng },
          // Q9: a cache serve carries the row's real generation
          // timestamp — never a re-stamp at serve time.
          generatedAt: Number.isFinite(cachedAt) ? cachedAt : this.clock.now(),
          text: cached.story_text,
          tier1: candidate.tier1,
        },
      });
      return item;
    }
    // Buffered prefetch text (S10: an option, re-entering through every gate).
    const buffered = this.buffer.get(key);
    if (buffered) {
      this.buffer.delete(key);
      return this.liveStoryItem(candidate, buffered.text, buffered.generatedAt);
    }
    // Live generation stands down while a failure economy stands
    // (E3/E6): banked material above is the tour's voice meanwhile.
    if (this.liveStandDown()) return null;
    // Live generation with a full fact pack (S7).
    const isRetell = candidate.tier1 && (this.toldCount.get(key) ?? 0) === 1;
    try {
      const area = this.area;
      const pack = await this.seams.buildFactPack(
        candidate,
        area,
        nearby.filter(c => c.name !== candidate.name),
      );
      const prompt = this.storyPrompt(candidate, pack, isRetell);
      const fetchStart = this.clock.now();
      const text = await this.seams.generateStory(prompt);
      this.sampleLatency(this.fetchSamples, this.clock.now() - fetchStart);
      void this.seams.putCachedStory(
        this.sessionId,
        candidate.name,
        text,
        candidate.lat,
        candidate.lng,
        LEO_PERSONA_VERSION,
      );
      return this.liveStoryItem(candidate, text, this.clock.now());
    } catch (err) {
      // Q14: a retell generation that cannot produce a complete,
      // distinct story declines — the generator signals it with
      // an empty response, which the seam surfaces as the
      // empty-text failure. That decline spends the retell slot
      // (no second retell attempt this tour). A network/quota
      // failure is not a decline: it refunds under S8 like any
      // other failed serve.
      if (isRetell && err instanceof Error && /empty/.test(err.message)) {
        this.retellUsed.add(key);
      }
      return null;
    }
  }

  private liveStoryItem(candidate: facts.Candidate, text: string, generatedAt: number): AudibleItem {
    const item = this.makeItem({
      kind: 'story',
      label: candidate.name,
      source: { kind: 'synth', text },
      durationSec: estimateSpeechDurationS(text),
      onSettle: rec => this.onStorySettle(item, rec),
      story: {
        subject: backend.placeKeyOf(candidate.name),
        storySource: 'live',
        anchor: { lat: candidate.lat, lng: candidate.lng },
        generatedAt,
        text,
        tier1: candidate.tier1,
      },
    });
    return item;
  }

  private async serveAreaStory(): Promise<void> {
    if (!this.position) return;
    const name = this.area.neighborhood ?? this.area.city;
    const subject = name ? `area:${name.toLowerCase()}` : 'area:the road';
    if (this.subjectBlocked(subject, null)) return;
    try {
      const pseudo: facts.Candidate = {
        name: name ?? 'the road from here',
        lat: this.position.lat,
        lng: this.position.lng,
        source: 'places',
        types: ['area'],
        rating: null,
        userRatings: null,
        address: null,
        tier1: false,
        score: 0,
        registry: null,
        distanceM: 0,
      };
      const pack = await this.seams.buildFactPack(pseudo, this.area, []);
      const rural = this.modeName() === 'rural';
      const prompt = [
        `MODE: ${this.modeName()}`,
        rural
          ? 'RURAL MODE: there is no landmark here. Talk about the road, the county, the terrain — per your rural instructions.'
          : `AREA STORY: tell the story of ${name ?? 'this stretch of road'} itself — the neighborhood scale, not a single pin.`,
        `FACT PACK:\n${facts.factPackText(pack)}`,
        this.exclusionsLine(),
      ].join('\n\n');
      const text = await this.seams.generateStory(prompt);
      const item = this.makeItem({
        kind: 'story',
        label: name ? `The story of ${name}` : 'The road from here',
        source: { kind: 'synth', text },
        durationSec: estimateSpeechDurationS(text),
        onSettle: rec => this.onStorySettle(item, rec),
        story: {
          subject,
          storySource: 'live',
          anchor: null,
          regionAnchored: true,
          generatedAt: this.clock.now(),
          text,
        },
      });
      this.inflight.add(subject);
      const landed = this.player.offerStory(item, false);
      if (landed === 'buffer') {
        this.inflight.delete(subject);
        item.silent = true;
        this.player.abandon(item);
      }
    } catch {
      /* designed silence: the filler lane owns the gap (§7) */
    }
  }

  private storyPrompt(candidate: facts.Candidate, pack: facts.FactPack, isRetell = false): string {
    const parts = [
      `MODE: ${this.modeName()}`,
      `Tell the story of ${candidate.name}.`,
      `FACT PACK:\n${facts.factPackText(pack)}`,
    ];
    if (this.lastSubject) {
      parts.push(
        `The previous story was about ${this.lastSubject}. Write your own one-sentence transition if a genuine one exists; never force a connection.`,
      );
    }
    if (isRetell) {
      // Q14: a retell must be genuinely distinct material at a new
      // angle. If the fact pack cannot support that, the generator
      // declines with an empty response rather than repeating —
      // an empty generation is a failed serve (S8 refund), and the
      // retell slot is spent only if a telling is committed.
      parts.push(
        `RETELL: ${candidate.name} was already told once this tour. Tell a SECOND, genuinely different story about it — new material, new angle, nothing repeated from a first telling. If the fact pack cannot support a complete, distinct story, return an empty response instead of repeating.`,
      );
    }
    parts.push(this.exclusionsLine(isRetell ? candidate.name : null));
    return parts.join('\n\n');
  }

  private exclusionsLine(excludeName: string | null = null): string {
    const told = [...this.toldCount.keys()]
      .filter(k => k !== (excludeName ? backend.placeKeyOf(excludeName) : ''))
      .slice(0, 12);
    if (told.length === 0) return '';
    return `Already told this tour (do not retell or re-center these): ${told.join('; ')}.`;
  }

  // ------------------------------------------------------------ telling ledger (§3)

  private subjectBlocked(subject: string, candidate: facts.Candidate | null): boolean {
    if (this.inflight.has(subject)) return true;
    // Q12: queueing commits a subject temporarily; an unheard
    // settle RELEASES it (the corridor Q11 consumption is the one
    // exception, tracked in corridorConsumed). A subject that
    // failed or was displaced unsounded is simply available to
    // the next serve cycle on the same evidence (S8).
    const dropSpot = this.judgeDropSpots.get(subject);
    if (dropSpot && this.position) {
      if (calculateDistance(this.position.lat, this.position.lng, dropSpot.lat, dropSpot.lng) <= 250) {
        return true;
      }
      this.judgeDropSpots.delete(subject);
    }
    const told = this.toldCount.get(subject) ?? 0;
    if (told >= 1) {
      // Q14: a Tier-1 place may be retold exactly once, at an undealt
      // angle, and only if genuinely distinct material exists — the
      // generator is instructed to decline rather than repeat.
      if (candidate?.tier1 && told === 1 && !this.retellUsed.has(subject)) return false;
      return true;
    }
    return false;
  }

  /**
   * §8 commitment: a location story files story_played exactly once,
   * when it takes the waiting slot (or the element). (Q14's retell
   * slot is spent by a DELIVERED retell or a material decline —
   * never by a queue-level drop: an unheard settle releases the
   * subject, retell eligibility included, per Q12.)
   */
  private onStoryCommitted(item: AudibleItem): void {
    const subject = item.subject ?? item.label;
    // §8 payload enriched Oct 29, 2026 (B instrumentation gap found on
    // the first graded drive): topic / distance / queue / anchor keys
    // match A's vocabulary so the shared analytics view grades both
    // builds identically. subject + angle ride along for the raw log.
    this.emit('story_played', {
      subject,
      topic: item.label,
      source: item.storySource ?? 'live',
      angle: item.angleOf ?? null,
      subject_lat: item.anchor?.lat ?? null,
      subject_lng: item.anchor?.lng ?? null,
      distance_m:
        item.anchor && this.position
          ? Math.round(
              calculateDistance(this.position.lat, this.position.lng, item.anchor.lat, item.anchor.lng),
            )
          : null,
      queue_depth: (this.player.current ? 1 : 0) + (this.player.waitingStory ? 1 : 0),
    });
    // A committed story never waits on commentary.
    this.yieldCommentary();
    this.notify();
  }

  private onStorySettle(item: AudibleItem, rec: SettleRecord): void {
    const subject = item.subject ?? '';
    this.inflight.delete(subject);
    // Uncommitted items (withdrawn to the prefetch buffer, orphaned
    // at teardown) settle silently: §8's terminal pair binds
    // committed stories only — never both, never neither, and
    // nothing at all for a story that was never committed.
    if (item.silent || !item.committed) {
      this.notify();
      return;
    }
    // Corridor consumption (Q11/Q12's one release exception).
    if (
      item.corridorSegmentId &&
      (rec.sounded || rec.dropReason === 'stale_highway' || rec.dropReason === 'stale-behind')
    ) {
      this.corridorConsumed.add(item.corridorSegmentId);
    }
    // Synthesis stand-down bookkeeping (the resolve-path economy).
    if (!rec.sounded && rec.failKind === 'synthesis') {
      this.synthFailStreak += 1;
      if (this.synthFailStreak === 3) this.tripSynthStandDown();
    }
    // O15: an unheard WELCOME remains owed, on the 180 s cooldown.
    if (subject.startsWith('welcome:')) {
      this.welcomeOffered = false;
      if (!rec.sounded) {
        const name = subject.slice('welcome:'.length);
        this.owedWelcome = { name, retryAt: this.clock.now() + WELCOME_COOLDOWN_MS };
        if (this.welcomeState === 'handed') this.welcomeState = 'none';
        this.maybeOpenTour();
      }
    }
    if (!rec.sounded) {
      this.counts.storiesDropped += 1;
      // Judge drops memoize their serve context (see the field
      // note): the same story at the same spot would re-drop
      // deterministically and spin the serve cycle.
      if (
        (rec.dropReason === 'stale-age' ||
          rec.dropReason === 'stale-behind' ||
          rec.dropReason === 'out-of-reach') &&
        this.position
      ) {
        this.judgeDropSpots.set(subject, { lat: this.position.lat, lng: this.position.lng });
      }
      // §8: reason verbatim from the closed vocabulary.
      this.emit('story_dropped', {
        reason: rec.dropReason ?? 'attempts-exhausted',
        subject,
        topic: item.label,
        source: item.storySource ?? 'live',
        angle: item.angleOf ?? null,
        distance_m:
          item.anchor && this.position
            ? Math.round(
                calculateDistance(this.position.lat, this.position.lng, item.anchor.lat, item.anchor.lng),
              )
            : null,
      });
      this.notify();
      return;
    }
    this.synthFailStreak = 0;
    this.stormTrips = 0;
    if (rec.completed) {
      // Commentary gate: the lane may only speak after the first
      // LANDMARK story has completed (the welcome: and area:
      // stories are the opener sequence, not landmarks), and keeps
      // a breath after every story.
      const now = this.clock.now();
      if (!subject.startsWith('welcome:') && !subject.startsWith('area:')) {
        if (this.firstStoryCompletedAt === null) this.firstStoryCompletedAt = now;
        this.lastStoryCompletedAt = now;
      }
    }
    this.emit('story_playback', {
      sounded: rec.sounded,
      completed: rec.completed,
      sounded_ms: Math.round(rec.soundedMs),
      subject,
      topic: item.label,
      source: item.storySource ?? 'live',
      angle: item.angleOf ?? null,
      subject_lat: item.anchor?.lat ?? null,
      subject_lng: item.anchor?.lng ?? null,
      distance_m:
        item.anchor && this.position
          ? Math.round(
              calculateDistance(this.position.lat, this.position.lng, item.anchor.lat, item.anchor.lng),
            )
          : null,
    });
    {
      this.counts.storiesPlayed += 1;
      this.sampleLatency(this.durationSamples, rec.soundedMs / 1000);
      const told = (this.toldCount.get(subject) ?? 0) + 1;
      this.toldCount.set(subject, told);
      if ((item.tier1 ?? false) && told >= 2) this.retellUsed.add(subject);
      if (item.storySource === 'library' && item.angleOf) {
        const set = this.dealtAngles.get(subject) ?? new Set<string>();
        set.add(item.angleOf);
        this.dealtAngles.set(subject, set);
      }
      if (subject.startsWith('welcome:')) {
        const name = subject.slice('welcome:'.length);
        this.welcomed.add(name);
        // A delivered WELCOME discharges its owed record (O15).
        // (Subjects are lowercased keys; the owed record carries
        // the display name — compare case-insensitively or the
        // record never clears and the welcome re-serves forever.)
        if (this.owedWelcome && this.owedWelcome.name.toLowerCase() === name) {
          this.owedWelcome = null;
        }
        if (this.welcomeState === 'handed') {
          this.welcomeState = 'settled';
          if (this.opening === 'covered' || this.opening === 'welcoming') {
            this.opening = 'open';
            if (this.backstopTimer !== null) this.clock.clearTimeout(this.backstopTimer);
          }
        }
      }
      this.lastStoryItem = item;
      this.lastSubject = item.label;
      this.chainCount = 0; // a real story ends a filler episode (F7)
      void this.seams.recordHeard(
        this.sessionId,
        this.userKey,
        item.label,
        item.text ?? null,
        item.anchor?.lat ?? null,
        item.anchor?.lng ?? null,
      );
      this.persistDayState(subject);
    }
    this.notify();
  }

  private persistDayState(subject: string): void {
    const today = new Date().toISOString().slice(0, 10);
    const state = backend.lsJson<{ date: string; told: string[] }>('dayState');
    const told = state && state.date === today ? state.told : [];
    if (!told.includes(subject)) told.push(subject);
    backend.lsJsonSet('dayState', { date: today, told: told.slice(-200) });
    const topics = backend.lsJson<string[]>('toldTopics') ?? [];
    if (!topics.includes(subject)) topics.push(subject);
    backend.lsJsonSet('toldTopics', topics.slice(-500));
    const recent = backend.lsJson<string[]>('recentSubjects') ?? [];
    recent.push(subject);
    backend.lsJsonSet('recentSubjects', recent.slice(-50));
  }

  // ------------------------------------------------------------ player hooks: freshness & displacement

  private judgeStory(item: AudibleItem): { ok: true } | { ok: false; reason: string } {
    if (!this.position) return { ok: true };
    const now = this.clock.now();
    const speed = Math.max(this.position.speedMps, 0.5);
    // Corridor expiry is segment geometry, never elapsed time (Q11).
    if (item.corridorSegmentId && item.segmentExit) {
      const segment = CORRIDOR_SEGMENTS.find(s => s.id === item.corridorSegmentId);
      if (segment) {
        const overshoot = this.corridorOvershootM(segment, this.position);
        if (overshoot > 450) {
          return { ok: false, reason: speed >= FREEWAY_MPS ? 'stale_highway' : 'stale-behind' };
        }
        return { ok: true };
      }
    }
    if (item.reserved) return { ok: true };
    const duration = Math.max(item.durationSec, 5);
    const ageS = (now - (item.generatedAt ?? now)) / 1000;
    // Region-anchored stories are exempt from the point-story age
    // bound as they are from the behind-cut (Q10's principle): a
    // story about the region the driver is still inside does not
    // expire by the clock.
    if (!item.regionAnchored && ageS > duration * 1.5) {
      return { ok: false, reason: 'stale-age' };
    }
    if (item.anchor && !item.regionAnchored) {
      const dist = calculateDistance(this.position.lat, this.position.lng, item.anchor.lat, item.anchor.lng);
      // Behind allowance (Q9): an anchor astern is relevant only
      // within duration × speed of road behind.
      if (this.position.headingDeg !== null) {
        const bearing = bearingDegrees(this.position, item.anchor);
        const delta = headingDelta(this.position.headingDeg, bearing);
        if (delta > 100 && dist > duration * speed) {
          return { ok: false, reason: 'stale-behind' };
        }
      }
      if (dist > duration * speed) return { ok: false, reason: 'out-of-reach' };
    }
    return { ok: true };
  }

  private corridorOvershootM(segment: CorridorSegment, pos: Position): number {
    // Projected arc length of the position along the polyline, minus
    // the segment's total length: positive only past the exit.
    const pts = segment.polyline;
    let total = 0;
    const cumulative: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      total += calculateDistance(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
      cumulative.push(total);
    }
    let bestDist = Infinity;
    let bestArc = 0;
    let bestLeg = -1;
    let bestT = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const segLen = cumulative[i] - cumulative[i - 1];
      const tRaw = segLen === 0 ? 0 : this.projectionT(pos, a, b);
      const t = Math.min(1, Math.max(0, tRaw));
      const projLat = a.lat + (b.lat - a.lat) * t;
      const projLng = a.lng + (b.lng - a.lng) * t;
      const d = calculateDistance(pos.lat, pos.lng, projLat, projLng);
      if (d < bestDist) {
        bestDist = d;
        bestArc = cumulative[i - 1] + segLen * t;
        bestLeg = i;
        bestT = tRaw;
      }
    }
    // Past the exit: the unclamped projection on the final leg
    // measures how far beyond it the listener has run. (Clamping t
    // before this check would make overshoot identically zero —
    // the exit must be crossable in the math for Q11 to exist.)
    if (bestLeg === pts.length - 1 && bestT > 1) {
      const segLen = cumulative[bestLeg] - cumulative[bestLeg - 1];
      return (bestT - 1) * segLen;
    }
    return bestArc - total;
  }

  private projectionT(pos: Position, a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const ax = (pos.lat - a.lat) * 111_320;
    const ay = (pos.lng - a.lng) * 96_500;
    const bx = (b.lat - a.lat) * 111_320;
    const by = (b.lng - a.lng) * 96_500;
    const denom = bx * bx + by * by;
    if (denom === 0) return 0;
    return (ax * bx + ay * by) / denom;
  }

  private mayDisplace(
    waiter: AudibleItem,
    newcomer: AudibleItem,
    kind: 'priority' | 'fresher',
  ): boolean {
    // Q6's full condition set, opening-complete included. No
    // exception is needed for the WELCOME's handover: with corridor
    // serves gated on the opening (O16), no ordinary story can be
    // waiting during 'covered', so the reserved WELCOME always
    // finds the slot empty and never needs to displace.
    if (this.opening !== 'open' && this.opening !== 'failed') return false;
    if (this.player.latch !== 'earned') return false;
    if (this.qaPhase !== 'idle') return false;
    if (waiter.reserved || waiter.tier1) return false;
    if (kind === 'priority') return true;
    // Fresher: materially closer or materially newer.
    if (!this.position || !waiter.anchor || !newcomer.anchor) {
      return (newcomer.generatedAt ?? 0) > (waiter.generatedAt ?? 0) + 30_000;
    }
    const dw = calculateDistance(this.position.lat, this.position.lng, waiter.anchor.lat, waiter.anchor.lng);
    const dn = calculateDistance(this.position.lat, this.position.lng, newcomer.anchor.lat, newcomer.anchor.lng);
    return dn + 150 < dw || (newcomer.generatedAt ?? 0) > (waiter.generatedAt ?? 0) + 30_000;
  }

  private onCommit(item: AudibleItem): void {
    void item;
    this.notify();
  }

  // ------------------------------------------------------------ audio resolution & presynth

  private async resolveUrl(item: AudibleItem): Promise<string> {
    if (item.source.kind === 'url') {
      // F4: bridges and fillers play from the pinned on-device copy.
      if (item.kind === 'bridge' || item.kind === 'filler') {
        const path = item.source.url.split('/tts-audio/')[1];
        if (path) {
          const blob = await this.seams.audioCacheGet(path);
          if (blob) return this.objectUrlFor(path, blob);
        }
      }
      return item.source.url;
    }
    const text = item.source.text;
    // The key carries persona + TTS model + voice (a model bump
    // must not silently reuse old-model audio) and a dual hash to
    // keep the collision tail negligible over a long-lived cache.
    const cacheKey = `synth-${hashString(
      `${LEO_PERSONA_VERSION}|${gemini.TTS_MODEL_ID}|Puck|${text}`,
    )}-${hashString(`${text}::b`)}`;
    // Concurrent resolutions of the same text share ONE synthesis:
    // a presynth that starts moments before the item's own drive
    // resolve (the common case when the slot turns over quickly)
    // must not double-spend synthesis on the same story.
    const inFlight = this.resolving.get(cacheKey);
    if (inFlight) return inFlight;
    const work = (async () => {
      const cached = await this.seams.audioCacheGet(cacheKey);
      if (cached) return this.objectUrlFor(cacheKey, cached);
      const synthStart = this.clock.now();
      const blob = await this.seams.synthesize(text);
      this.sampleLatency(this.synthSamples, this.clock.now() - synthStart);
      await this.seams.audioCachePut(cacheKey, blob);
      return this.objectUrlFor(cacheKey, blob);
    })();
    this.resolving.set(cacheKey, work);
    try {
      return await work;
    } finally {
      this.resolving.delete(cacheKey);
    }
  }

  private objectUrlFor(key: string, blob: Blob): string {
    const existing = this.objectUrls.get(key);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(key, url);
    return url;
  }

  /**
   * S11: warm the single waiting location story's audio; nothing
   * else. Invoked when a story ENTERS the waiting slot (the
   * player's onWaiting hook) — that is the moment warming must
   * happen; waiting until the current story commits is too late,
   * because the slot is usually empty at that instant.
   */
  private presynthWaiting(waiting: AudibleItem): void {
    if (waiting.source.kind !== 'synth') return;
    if (this.seams.ttsQuotaTripped()) return;
    if (this.liveStandDown()) return;
    if (this.warming.has(waiting.id)) return;
    this.warming.add(waiting.id);
    this.resolveUrl(waiting)
      .catch(() => {
        // A failed presynth clears its dedupe mark (S11).
        this.warming.delete(waiting.id);
      })
      .finally(() => undefined);
  }

  private pickStall(): { url: string; durationSec: number } | null {
    const unused = STALL_CLIPS.filter(p => !this.stallSessionUsed.has(p.id));
    if (unused.length === 0) return null;
    const played = backend.lsJson<Record<string, number>>('stallPhrasesPlayed') ?? {};
    const now = Date.now();
    const fresh = unused.filter(p => !(played[p.id] && now - played[p.id] < 7 * 24 * 3600_000));
    const candidates = fresh.length > 0 ? fresh : unused;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    this.stallSessionUsed.add(pick.id);
    played[pick.id] = now;
    backend.lsJsonSet('stallPhrasesPlayed', played);
    void this.seams.pinBucketAudio(pick.path);
    return { url: this.seams.bucketUrl(pick.path), durationSec: pick.durationSec };
  }

  // ------------------------------------------------------------ prefetch & latency model (S9/S10)

  private sampleLatency(samples: number[], value: number): void {
    samples.push(value);
    if (samples.length > 24) samples.shift();
  }

  private median(samples: number[]): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  private horizonSec(): number {
    const fetchS = this.median(this.fetchSamples) / 1000;
    const synthS = this.median(this.synthSamples) / 1000;
    const durS = this.median(this.durationSamples);
    const raw = fetchS + synthS + durS;
    return Math.min(240, Math.max(20, raw || 45));
  }

  private async prefetchTick(): Promise<void> {
    if (this.phase !== 'active' || !this.position) return;
    try {
      if (this.buffer.size < 4 && !this.seams.storyQuotaTripped()) {
        const pos = this.position;
        const horizon = this.horizonSec();
        // S9's buffer-depth anchor: one median story duration
        // beyond the latency horizon (default 60 s before any
        // story has sounded — an empty sample set must not
        // collapse the anchor to zero).
        const depthS = this.durationSamples.length ? this.median(this.durationSamples) : 60;
        const ahead = this.projectAhead(pos, horizon + depthS);
        const candidates = await this.seams.discoverCandidates(ahead, 1400);
        const nearby = candidates.slice(0, 4);
        for (const candidate of candidates.slice(0, 3)) {
          const key = backend.placeKeyOf(candidate.name);
          if (this.buffer.has(key) || this.subjectBlocked(key, candidate)) continue;
          if (this.libraryIndex.some(e => e.place_key === key)) continue; // banked beats generated
          try {
            const pack = await this.seams.buildFactPack(
              candidate,
              this.area,
              nearby.filter(c => c.name !== candidate.name),
            );
            const text = await this.seams.generatePrefetch(this.storyPrompt(candidate, pack));
            this.buffer.set(key, { subject: key, text, generatedAt: this.clock.now(), candidate });
          } catch {
            /* prefetch is speculative; failures are free (S10) */
          }
          if (this.buffer.size >= 4) break;
        }
      }
    } finally {
      this.clock.setTimeout(() => void this.prefetchTick(), 25_000);
    }
  }

  private projectAhead(pos: Position, seconds: number): { lat: number; lng: number } {
    if (pos.headingDeg === null || pos.speedMps < 0.5) return { lat: pos.lat, lng: pos.lng };
    const distM = pos.speedMps * seconds;
    const rad = (pos.headingDeg * Math.PI) / 180;
    return {
      lat: pos.lat + (distM * Math.cos(rad)) / 111_320,
      lng: pos.lng + (distM * Math.sin(rad)) / (111_320 * Math.cos((pos.lat * Math.PI) / 180)),
    };
  }

  // ------------------------------------------------------------ economies (§5)

  private tripStorm(): void {
    const now = this.clock.now();
    // A trip while a storm already stands is ignored: re-tripping
    // on every subsequent failure would push the window out
    // indefinitely (the rolling-silence failure). Doubling applies
    // to a genuine re-trip after expiry (E3).
    if (now < this.stormUntil) return;
    this.stormTrips += 1;
    this.lastStormTripAt = now;
    const duration = Math.min(600_000, STORM_BASE_MS * Math.pow(2, this.stormTrips - 1));
    this.stormUntil = now + duration;
    void this.lastStormTripAt;
    this.notify();
  }

  /** The synthesis stand-down: same ladder as E3, its own clock (P13 separation). */
  private tripSynthStandDown(): void {
    const now = this.clock.now();
    if (now < this.synthStandDownUntil) return;
    this.synthStandDownTrips += 1;
    const duration = Math.min(600_000, STORM_BASE_MS * Math.pow(2, this.synthStandDownTrips - 1));
    this.synthStandDownUntil = now + duration;
    this.notify();
  }

  // ------------------------------------------------------------ the 1-second tick

  private tick(): void {
    if (this.phase !== 'active') return;
    const now = this.clock.now();
    const elapsed = now - this.lastTickAt;
    this.lastTickAt = now;
    this.fillerTick(elapsed);
    this.commentaryTick();
    // Owed-WELCOME retry after its cooldown (O15).
    if (this.owedWelcome && now >= this.owedWelcome.retryAt && !this.welcomeServing) {
      void this.serveOwedWelcome();
    }
    this.notify();
  }

  // ------------------------------------------------------------ filler lane (§7)

  private async loadFillerPool(): Promise<void> {
    const rows = await this.seams.fetchFillerRows();
    this.fillerPool = rows.map(r => ({
      placeKey: r.place_key,
      title: r.place_name,
      audioPath: r.audio_path,
    }));
    // Pin the whole pool + bridges into the on-device cache (F4).
    await Promise.all([
      ...this.fillerPool.map(f => this.seams.pinBucketAudio(f.audioPath)),
      ...BRIDGE_CLIPS.map(b => this.seams.pinBucketAudio(b.path)),
    ]);
    // Per-tour order within a tier is shuffled once at tour start (F5).
    this.fillerOrder = [...this.fillerPool];
    for (let i = this.fillerOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.fillerOrder[i], this.fillerOrder[j]] = [this.fillerOrder[j], this.fillerOrder[i]];
    }
    this.fillerReady = true;
  }

  private trueSilence(): boolean {
    if (this.phase !== 'active') return false;
    if (this.opening !== 'open' && this.opening !== 'failed') return false; // F12
    const snap = this.player.snapshot();
    if (snap.currentLabel !== null) return false;
    if (snap.promisedCount > 0) return false;
    if (this.player.waitingStory) return false;
    if (this.qaPhase !== 'idle') return false; // A7/F1
    if (this.userPausedFlag || this.interruptedFlag) return false;
    return true;
  }

  /**
   * F3's armed window is not F1's clean snapshot: in the failed
   * opening state, first-sound DEBT is still outstanding (parked in
   * the promised queue) by design. Silence for the proof path =
   * element idle, debt outstanding, latch unearned, no Q&A lock,
   * no pause/interruption.
   */
  private proofSilence(): boolean {
    if (this.phase !== 'active') return false;
    if (this.opening !== 'failed') return false;
    if (this.player.latch === 'earned') return false;
    if (this.debt.size === 0) return false;
    if (this.player.current !== null) return false;
    if (this.qaPhase !== 'idle') return false;
    if (this.userPausedFlag || this.interruptedFlag) return false;
    return true;
  }

  private fillerTick(elapsedMs: number): void {
    if (!this.fillerReady || this.laneStoodDown || this.pairOutstanding) {
      if (!this.trueSilence() && !this.proofSilence()) this.silenceMs = 0;
      return;
    }
    if (!this.trueSilence() && !this.proofSilence()) {
      this.silenceMs = 0;
      return;
    }
    this.silenceMs += elapsedMs;
    if (this.silenceMs >= 10_000) {
      void this.fireFillerPair();
    }
  }

  private async fireFillerPair(): Promise<void> {
    // Claim FIRST, synchronously: the 1 s tick re-enters this path
    // on every tick while silence accumulates, and the awaits below
    // (cache checks) must never let a second concurrent fire select
    // the same filler and enqueue a duplicate pair.
    if (this.pairOutstanding) return;
    this.pairOutstanding = true;
    this.silenceMs = 0; // the fire consumes the accumulated silence
    let enqueued = false;
    try {
      const unspent = this.fillerOrder.filter(f => !this.fillerSpent.has(f.placeKey));
      if (unspent.length === 0) {
        this.laneStoodDown = true; // F10
        return;
      }
      // F3's one exception: after a failed opening with debt
      // outstanding, a pair may attempt while the latch is not
      // earned (unearned, or lost mid-tour with a failed opening)
      // as the unlock's proof. Otherwise the latch must be earned.
      const proofPath =
        this.opening === 'failed' && this.player.latch !== 'earned' && this.debt.size > 0;
      if (this.player.latch !== 'earned' && !proofPath) return;

      const region: FillerRegion | null = this.position
        ? resolveFillerRegion(this.position.lat, this.position.lng)
        : null;
      const ordered = orderFillersForRegion(unspent, region, f =>
        fillerTagsForTitle(f.title),
      );
      const filler = ordered[0];
      const matched = fillerMatchFor(fillerTagsForTitle(filler.title), region);

      const kind = this.chainCount === 0 ? 'first' : 'next';
      let bridges = BRIDGE_CLIPS.filter(b => b.kind === kind);
      if (bridges.length > 1 && this.lastBridgeSlug) {
        const alternatives = bridges.filter(b => b.slug !== this.lastBridgeSlug);
        if (alternatives.length > 0) bridges = alternatives;
      }
      const bridge = bridges[Math.floor(Math.random() * bridges.length)];

      // F4: the pair fires only whole, only from pinned cache.
      const [bridgePinned, fillerPinned] = await Promise.all([
        this.seams.audioCacheHas(bridge.path),
        this.seams.audioCacheHas(filler.audioPath),
      ]);
      if (!bridgePinned || !fillerPinned) return; // clock stays armed; re-check next tick

      // Re-validate the firing snapshot after the awaits: a pair
      // validated during silence must not be enqueued into a tour
      // state that no longer holds (a story committed, a question
      // submitted, the tour ended).
      if (this.phase !== 'active') return;
      if (proofPath ? !this.proofSilence() : !this.trueSilence()) return;

      this.lastBridgeSlug = bridge.slug;

    let bridgeItem: AudibleItem;
    let fillerItem: AudibleItem;
    const settlePair = () => {
      this.pairOutstanding = false;
      this.silenceMs = 0; // F9: every pair re-arms the clock
    };
    bridgeItem = this.makeItem({
      kind: 'bridge',
      label: `Bridge — ${bridge.slug}`,
      source: { kind: 'url', url: this.seams.bucketUrl(bridge.path) },
      durationSec: 6,
      onSettle: rec => {
        if (rec.sounded) this.fillerSpent.add(filler.placeKey); // F8: any part sounded → spent
      },
    });
    fillerItem = this.makeItem({
      kind: 'filler',
      label: filler.title,
      source: { kind: 'url', url: this.seams.bucketUrl(filler.audioPath) },
      durationSec: 30,
      onSettle: rec => {
        if (rec.sounded) this.fillerSpent.add(filler.placeKey);
        this.counts.fillersPlayed += rec.sounded ? 1 : 0;
        // filler_played is a play event (§8): it files only when
        // the filler actually sounded, never on a refused attempt.
        if (rec.sounded) this.emit('filler_played', { title: filler.title, region, matched });
        settlePair();
        this.notify();
      },
    });
    if (proofPath) {
      this.player.proofPair(bridgeItem, fillerItem);
    } else {
      this.player.enqueuePromised(bridgeItem);
      this.player.enqueuePromised(fillerItem);
    }
    // The pair is in the player's hands: the episode advances
    // (F7), and the claim now belongs to the pair's settle.
    enqueued = true;
    this.chainCount += 1;
    } finally {
      if (!enqueued) this.pairOutstanding = false;
    }
  }

  /** Cut a playing commentary clip / withdraw a queued one. The
   *  lane always yields — to stories, and to questions. */
  private yieldCommentary(): void {
    if (!this.commentaryItem || this.commentaryItem.settled) return;
    if (this.player.current === this.commentaryItem) {
      this.player.preemptCommentary();
    } else if (this.player.promised.includes(this.commentaryItem)) {
      this.commentaryItem.silent = true;
      this.player.abandon(this.commentaryItem);
    }
  }

  // -------------------------------------------------- commentary lane

  /**
   * Load the commentary bank: check the bucket kill-switch
   * (the PRESENCE of miles/commentary/disabled.json stands the
   * lane down with NO republish; any fetch failure leaves the lane
   * at its code-flag default), then pin every clip on-device like
   * the filler pool. Any failure leaves the lane dark and the tour
   * untouched.
   */
  private async loadCommentary(): Promise<void> {
    if (!COMMENTARY_ENABLED) return;
    // The kill-switch check resolves independently of the pins: the
    // tick consults the stood-down flag on every pass, and the
    // lane's first possible fire needs a completed story plus a
    // gap, so a slow config answer still lands in time — while a
    // slow network can never leave the lane dark for a whole tour
    // when the code flag says enabled.
    void this.checkCommentaryKillSwitch();
    try {
      await Promise.all(COMMENTARY_CLIPS.map(c => this.seams.pinBucketAudio(c.path)));
      this.commentaryReady = true;
    } catch {
      /* pins failed — lane stays dark this tour */
    }
  }

  private async checkCommentaryKillSwitch(): Promise<void> {
    try {
      // Kill-switch v2 (Oct 29): the bucket's RLS lets the app create
      // objects but not update them, so the flip is the PRESENCE of
      // disabled.json (one POST kills the lane at the next tour
      // start; reviving is a console/code action). config.json's
      // enabled:false is honored too, for whoever can write it.
      const dis = await fetch(this.seams.bucketUrl('miles/commentary/disabled.json'), {
        cache: 'no-store',
      });
      if (dis.ok) {
        this.commentaryStoodDown = true;
        return;
      }
      const res = await fetch(this.seams.bucketUrl('miles/commentary/config.json'), {
        cache: 'no-store',
      });
      if (res.ok) {
        const cfg = (await res.json()) as { enabled?: boolean };
        if (cfg && cfg.enabled === false) this.commentaryStoodDown = true;
      }
    } catch {
      /* kill-switch unreachable — code flag governs */
    }
  }

  /**
   * The commentary decision, on the 1 s tick. Conservative by
   * design: the lane speaks only into a genuinely empty player,
   * only after the first story has completed, at most once per
   * COMMENTARY_MIN_GAP_MS, and never across Q&A or a pause. A story
   * committing at any moment cuts or withdraws the clip
   * (onStoryCommitted), so commentary can never delay a story.
   */
  private commentaryTick(): void {
    if (!COMMENTARY_ENABLED || !this.commentaryReady || this.commentaryStoodDown) return;
    if (this.phase !== 'active') return;
    if (this.opening !== 'open' && this.opening !== 'failed') return;
    if (this.firstStoryCompletedAt === null) return;
    const now = this.clock.now();
    if (now - this.lastCommentaryAt < COMMENTARY_MIN_GAP_MS) return;
    if (now - this.lastStoryCompletedAt < 3_000) return;
    if (this.commentaryItem && !this.commentaryItem.settled) return;
    if (this.qaPhase !== 'idle' || this.userPausedFlag || this.interruptedFlag) return;
    if (this.player.latch !== 'earned') return;
    const snap = this.player.snapshot();
    if (snap.currentLabel !== null || snap.promisedCount > 0 || this.player.waitingStory) return;
    void this.fireCommentary();
  }

  private async fireCommentary(): Promise<void> {
    if (this.commentaryItem && !this.commentaryItem.settled) return;
    const region: FillerRegion | null = this.position
      ? resolveFillerRegion(this.position.lat, this.position.lng)
      : null;
    const hour = new Date(this.clock.now()).getHours();
    const tod: CommentaryTod =
      hour >= 5 && hour < 11 ? 'morning' : hour >= 11 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
    const unspent = COMMENTARY_CLIPS.filter(c => !this.commentarySpent.has(c.id));
    if (unspent.length === 0) return;
    // Prefer clips matching this region / this hour; general clips
    // are the standing fallback; mismatched tagged clips sit last.
    const score = (c: (typeof COMMENTARY_CLIPS)[number]): number =>
      (c.region ? (region && c.region === region ? 2 : 0) : 1) +
      (c.tod ? (c.tod === tod ? 2 : 0) : 1);
    const best = Math.max(...unspent.map(score));
    const pool = unspent.filter(c => score(c) === best);
    const clip = pool[Math.floor(Math.random() * pool.length)];
    const pinned = await this.seams.audioCacheHas(clip.path);
    if (!pinned) return;
    // Re-validate after the await (the filler lane's discipline):
    // the gap the decision saw must still be there.
    if (this.phase !== 'active') return;
    if (this.player.waitingStory || this.player.current) return;
    if (this.commentaryItem && !this.commentaryItem.settled) return;
    this.lastCommentaryAt = this.clock.now();
    const item = this.makeItem({
      kind: 'commentary',
      label: `Miles — commentary ${clip.id}`,
      source: { kind: 'url', url: this.seams.bucketUrl(clip.path) },
      durationSec: clip.durationSec,
      onSettle: rec => {
        if (this.commentaryItem === item) this.commentaryItem = null;
        if (rec.sounded) {
          this.commentarySpent.add(clip.id);
          if (rec.completed) {
            this.emit('commentary_played', {
              clip_id: clip.id,
              kind: 'commentary',
              region,
              tod,
              sounded_ms: Math.round(rec.soundedMs),
            });
          } else if (rec.skipped) {
            this.emit('commentary_cut', {
              clip_id: clip.id,
              kind: 'commentary',
              sounded_ms: Math.round(rec.soundedMs),
            });
          }
        }
        this.notify();
      },
    });
    this.commentaryItem = item;
    this.player.enqueuePromised(item);
  }

  // ------------------------------------------------------------ Q&A (§6) — text input only

  /** Submit a typed question. Returns false when the lock is held (A2). */
  submitQuestion(raw: string): boolean {
    const question = raw.trim();
    if (!question || this.phase !== 'active' || this.qaPhase !== 'idle') return false;
    // Commentary yields to Q&A too: a clip alive at submit dies now,
    // so the answer pipeline owns the player outright (A2/A4).
    this.yieldCommentary();
    this.qaPhase = 'generating';
    // A4: the failsafe runs from submission, before generation.
    this.qaFailsafe = this.clock.setTimeout(() => this.qaGenerationFailed(), QA_FAILSAFE_MS);
    void this.runAnswerGeneration(question);
    this.notify();
    return true;
  }

  private async runAnswerGeneration(question: string): Promise<void> {
    let text: string;
    try {
      const areaLine = this.area.neighborhood
        ? `The listener is in ${this.area.neighborhood}${this.area.city ? `, ${this.area.city}` : ''}.`
        : 'The listener is on the road in San Diego County.';
      const lastLine = this.lastSubject ? ` The most recent story was about ${this.lastSubject}.` : '';
      text = await this.seams.generateAnswer(
        `QUESTION FROM THE LISTENER: ${question}\n\n${areaLine}${lastLine}`,
      );
    } catch {
      this.qaGenerationFailed();
      return;
    }
    if (this.qaPhase !== 'generating') return; // failsafe or teardown got here first
    if (this.qaFailsafe !== null) this.clock.clearTimeout(this.qaFailsafe);
    this.qaFailsafe = null;
    const item = this.makeItem({
      kind: 'answer',
      label: `Answer — ${question.slice(0, 60)}`,
      source: { kind: 'synth', text },
      durationSec: estimateSpeechDurationS(text),
      onSettle: rec => {
        // Tour end already released the lock (A6 'tour-ended'):
        // a teardown settle must not re-arm the cycle or file a
        // second release when the grace timer later fires.
        if (this.phase !== 'active') return;
        if (rec.sounded) this.counts.questionsAnswered += 1;
        this.qaPhase = 'awaiting-resume';
        // A5(b): the 45-second resume grace.
        this.qaGrace = this.clock.setTimeout(
          () => this.releaseQaLock('resume-grace'),
          QA_GRACE_MS,
        );
        this.notify();
      },
      story: { text },
    });
    this.qaPhase = 'answering';
    this.player.enqueuePromised(item);
    this.notify();
  }

  private qaGenerationFailed(): void {
    if (this.qaPhase !== 'generating') return;
    if (this.qaFailsafe !== null) this.clock.clearTimeout(this.qaFailsafe);
    this.qaFailsafe = null;
    // The cycle's answer settles failed without an item; the lock
    // proceeds to the release path (A4 → A5 grace).
    this.qaPhase = 'awaiting-resume';
    this.qaGrace = this.clock.setTimeout(() => this.releaseQaLock('resume-grace'), QA_GRACE_MS);
    this.notify();
  }

  private releaseQaLock(reason: 'story-resumed' | 'resume-grace' | 'tour-ended'): void {
    if (this.qaPhase === 'idle') return;
    if (this.qaFailsafe !== null) this.clock.clearTimeout(this.qaFailsafe);
    if (this.qaGrace !== null) this.clock.clearTimeout(this.qaGrace);
    this.qaFailsafe = null;
    this.qaGrace = null;
    this.qaPhase = 'idle';
    this.emit('question_lock_released', { reason });
    this.notify();
  }

  // ------------------------------------------------------------ transport & listener actions

  pauseByUser(): void {
    this.userPausedFlag = true;
    this.player.pauseByUser();
    this.notify();
  }

  resumeByUser(): void {
    this.userPausedFlag = false;
    this.interruptedFlag = false;
    this.player.noteGesture(this.heldGreeting());
    this.player.resumeByUser();
    this.notify();
  }

  skip(): void {
    this.player.skipCurrent();
  }

  seekBy(sec: number): void {
    this.player.seekBy(sec);
  }

  /** Any in-tour tap: a re-prime opportunity (P8) routed by the UI. */
  noteGesture(): void {
    if (this.phase !== 'active') return;
    this.player.noteGesture(this.heldGreeting());
  }

  private heldGreeting(): AudibleItem | null {
    if (
      this.greetingItem &&
      !this.greetingItem.settled &&
      this.player.latch !== 'earned'
    ) {
      return this.greetingItem;
    }
    return null;
  }

  /** The banner's tap (P11): a gesture-retry. */
  bannerTap(): void {
    this.interruptedFlag = false;
    this.player.noteGesture(this.heldGreeting());
    if (!this.player.isPlaying() && this.player.current === null) {
      this.player.retryDrive();
    }
    this.notify();
  }

  /** Platform interruption (backgrounding, call): pause and require a tap to resume. */
  setInterrupted(): void {
    if (this.phase !== 'active') return;
    this.interruptedFlag = true;
    this.player.pauseByUser();
    this.notify();
  }

  /** Like the story now playing (or the one just told). */
  likeCurrent(): void {
    const current = this.player.current;
    const item =
      current && current.kind === 'story' ? current : this.lastStoryItem;
    if (!item) return;
    this.likedSubject = item.subject ?? item.label;
    void this.seams.recordLike(
      this.sessionId,
      item.label,
      item.text ?? null,
      item.anchor?.lat ?? this.position?.lat ?? 0,
      item.anchor?.lng ?? this.position?.lng ?? 0,
    );
    const recent = backend.lsJson<{ subject: string; at: number }[]>('recentStories') ?? [];
    recent.push({ subject: this.likedSubject, at: Date.now() });
    backend.lsJsonSet('recentStories', recent.slice(-50));
    this.clock.setTimeout(() => {
      if (this.likedSubject === (item.subject ?? item.label)) {
        this.likedSubject = null;
        this.notify();
      }
    }, 2500);
    this.notify();
  }

  // ------------------------------------------------------------ tour end (O13, A6)

  endTour(): void {
    if (this.phase !== 'active') return;
    this.phase = 'ended';
    if (this.backstopTimer !== null) this.clock.clearTimeout(this.backstopTimer);
    if (this.tickTimer !== null) this.clock.clearInterval(this.tickTimer);
    if (this.qaPhase !== 'idle') this.releaseQaLock('tour-ended');
    // An engine-held WELCOME that was never offered is unknown to
    // the player's teardown: settle it here, silently and exactly
    // once (it was never committed, so it files no §8 terminal).
    if (this.pendingWelcome && !this.pendingWelcome.settled) {
      const orphan = this.pendingWelcome;
      this.pendingWelcome = null;
      orphan.silent = true;
      this.player.abandon(orphan);
    }
    this.player.teardown();
    backend.lsDel('activeSession');
    this.notify();
  }

  /** Whether a resumable tour marker exists (the 30-minute window, contract D). */
  static hasResumableSession(): boolean {
    const marker = backend.lsJson<{ savedAt: number }>('activeSession');
    return Boolean(marker && Date.now() - marker.savedAt < 30 * 60_000);
  }
}
