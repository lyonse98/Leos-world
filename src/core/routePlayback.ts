// Route-plan playback (v16.1, static) — a thin runner over the
// EXISTING Player, not a second engine. The freeform Tour is never
// constructed for a route tour, so no freeform serve doctrine can
// leak into a plan, and no plan state can leak into freeform.
//
// Dumb guards only (no adaptive re-planning):
//   - GPS-cued: items play in plan order, nothing is reordered;
//   - off-corridor (>200 m from the path) pauses; back on corridor
//     resumes — unless the USER paused, which the guard never
//     overrides;
//   - arrival triggers the closeout (see routeMode.decideCloseout);
//   - plan exhaustion before arrival → handoff line + freeform
//     tail (the App starts a freeform Tour); never dead air.
// Bridges are rendered at plan time in start(): a bridge whose
// synthesis fails is dropped before anything plays (skip-fallback),
// exactly as routeMode.applyBridgeFallback prescribes.
//
// Render-ahead pipeline (Nov 4, 2026 — Erik's latency ruling,
// amending the Nov 3 settled-before-start doctrine): only the
// OPENING settles before Start — the spoken preview, the first
// bridge, and the departure story. Everything else renders
// through a bounded-concurrency queue (RENDER_CONCURRENCY) in
// plan order, starting the moment the plan is fixed — it works
// while the manifest card sits untapped and keeps working
// during playback, ahead of the listener. Only SYNTHESIS is
// pipelined: every text (bridge, preview, wrap-up, gap story)
// already exists at plan-fix, authored at compose time; what
// moves is when each piece is voiced. Playback never stalls
// for a late piece: a bridge/reaction whose moment arrives
// before its render is skipped (route_render_late telemetry +
// capture accounting) and the story sounds without it — tissue
// is connective, never load-bearing. A mid-tour render failure
// degrades the same way, per piece; the build-failure state is
// pre-start only and this pipeline never produces it.
//
// Composer v2 (Nov 3, 2026): POSITION-ANCHORED RELEASE. The
// runner no longer pours the whole plan into the Player at
// start. It renders every item at plan time, then FEEDS the
// Player one item ahead at most: bridges, reactions and fillers
// (the wait-cover) release freely, but a geographic story is
// fed only once the driver's progress reaches its release
// window (the composer stamped release/expire progress on the
// item). A story whose window expires while it waits is dropped
// stale — silently, unplayed, and still counted among the
// unplayed for the arrival tease. Portal stories carry no
// window: plan order puts them directly after their parent, so
// they release as soon as the parent settles. Items still play
// strictly in plan order — anchored release is a feed gate, not
// re-planning.
//
// Phase 2 (Nov 3, 2026): Q&A for Passenger/Walking route tours.
// The runner accepts an answer generator ONLY when the App's
// declared-mode gate is open (driving tours never receive one, so
// the pipeline is unreachable there — not merely unrendered).
// A question never re-plans anything: the current plan item
// finishes, the answer plays next (head of the promised FIFO via
// Player.enqueueNext), and the plan resumes at the next unplayed
// item. One question at a time, mirroring freeform's lock.

import { GAP_MS, Player, type AudibleItem, type AudioPort, type LatchState, systemClock } from './player';
import { bucketUrl } from './backend';
import type { RouteDriveRecord } from './routeHistory';
import {
  assembleOutcomeCapture,
  assemblePlanCapture,
  assemblePlanItems,
  pathLengthM,
  type CapturedRenderResult,
  type EpisodeCaptureContext,
  type RouteEpisodeOutcomePayload,
  type RouteEpisodePlanPayload,
} from './episodeCapture';
import {
  decideCloseout,
  estimateDurationSec,
  hasArrived,
  haversineM,
  isOffCorridor,
  owedLine,
  progressAlongPath,
  type GeoPoint,
  type LibraryUnit,
  type MapsFailure,
  type PlanItem,
  type RoutePlan,
} from './routeMode';

export interface RouteRunnerView {
  /**
   * 'awaiting' = the tour is up but the audio unlock latch is
   * unearned/lost: nothing has sounded, and the view must say so
   * (tap-to-hear), never 'playing' (Nov 3, 2026 first-sound fix).
   * 'ready' = the manifest hold (differentiator 3): the plan is
   * rendered and staged behind its episode card, nothing has
   * sounded, and playback begins only on the card's Start
   * listening tap — a held plan is not 'playing' either.
   */
  phase: 'idle' | 'ready' | 'awaiting' | 'playing' | 'ended';
  /** A speaking claim, present only while sound is actually flowing. */
  nowPlaying: { label: string; kind: string } | null;
  /** True while phase is 'awaiting': surface the tap-to-hear affordance. */
  awaitingGesture: boolean;
  /** The route player's unlock latch (drives the App's gesture net). */
  latch: LatchState;
  userPaused: boolean;
  guardPaused: boolean;
  /** Post-tour 'Miles owes you' line, once a closeout tease exists. */
  owed: string | null;
  /** How the route ended: arrival-owed | arrival-signoff | overrun | user-ended. */
  endedKind: string | null;
  /** Overrun only: the App should resume freeform for the tail. */
  freeformTail: boolean;
  /** True once the closeout line has sounded (or failed): the App may transition then. */
  closeoutDone: boolean;
  /** Phase-2 Q&A state: 'idle' accepts a question; anything else locks the form. */
  qaPhase: 'idle' | 'generating' | 'answering';
  /** Answers that actually sounded this route tour. */
  questionsAnswered: number;
  /**
   * The OPENING has settled (render-ahead pipeline, Nov 4,
   * 2026): the spoken preview, the first bridge, and the
   * departure story have each rendered OR fallen back (the
   * skip-fallback design means a failure settles too;
   * readiness can never hang on one). Everything past the
   * opening keeps rendering ahead of the listener and is NOT
   * part of this gate. The manifest card's primary button
   * reads this flag: disabled with the recording stage label
   * until it turns true, then enabled 'Start tour'.
   */
  narrationReady: boolean;
}

/**
 * The manifest card's primary button, derived from the
 * runner view (composer v3, commit D — Erik's copy): honest
 * about the preparation phase, and live once the OPENING has
 * settled (render-ahead pipeline, Nov 4, 2026: the rest of
 * the episode records ahead of the listener — the label
 * names the recording stage, never a claim that the whole
 * episode is recorded). Nov 4, 2026 (Erik's first stationary
 * test): the not-ready phase IS the live-renders phase —
 * bridges and the spoken preview synthesizing — so the
 * disabled label now names that build stage (see
 * ROUTE_BUILD_STAGE_LABELS) instead of a generic 'Generating
 * tour…' that read as no progress at all.
 */
export function routeStartButtonState(view: { narrationReady: boolean }): {
  label: string;
  disabled: boolean;
} {
  return view.narrationReady
    ? { label: 'Start tour', disabled: false }
    : { label: ROUTE_BUILD_STAGE_LABELS.recording, disabled: true };
}

// ------------------------------------------------------------ build staging UI (Nov 4, 2026)

/**
 * The route BUILD's phases, in staging order — the milestones
 * the App's build actually passes through: the maps calls
 * (geocode + route), the library fetch / compose / guarantee /
 * seating, then the live pieces rendering. Under the
 * render-ahead pipeline (Nov 4, 2026) the recording stage
 * completes the OPENING (preview + first bridge + departure
 * readiness); the remaining pieces keep recording ahead of
 * the listener during playback. Stage labels are tied to
 * these milestones ONLY: the App sets a stage when the build
 * enters the phase, never on a timer — there is no fake
 * progress anywhere in the build UI.
 */
export type RouteBuildStage = 'route' | 'compose' | 'recording';

export const ROUTE_BUILD_STAGES: readonly RouteBuildStage[] = ['route', 'compose', 'recording'];

export const ROUTE_BUILD_STAGE_LABELS: Record<RouteBuildStage, string> = {
  route: 'Finding your route…',
  compose: 'Composing your episode…',
  recording: 'Miles is recording the introductions…',
};

/**
 * Stage movement is monotonic: a build that has entered a
 * later phase never relabels backwards (a late sub-step event
 * from an earlier phase can't rewind the label), and a fast
 * phase may be SKIPPED entirely — skipping is honest, faking
 * dwell time on a label would not be.
 */
export function advanceRouteBuildStage(current: RouteBuildStage, next: RouteBuildStage): RouteBuildStage {
  return ROUTE_BUILD_STAGES.indexOf(next) > ROUTE_BUILD_STAGES.indexOf(current) ? next : current;
}

/** The build stages at which a build can die unrecovered. */
export type RouteBuildFailureStage = 'geocode' | 'route' | 'build';

export interface RouteBuildFailure {
  stage: RouteBuildFailureStage;
  /** Plain language, class-aware (a permission block is never "couldn't find"). */
  message: string;
  /** The failed state always offers a clean rebuild — a fresh session, a fresh runner. */
  canRetry: true;
}

/**
 * The failed state's copy (Nov 4, 2026): the Nov 3 failure-class
 * split, promoted from a status-line whisper to the build's
 * actual failure surface. 'no_results' is a search that answered
 * empty (speak about the place); every other class is the maps
 * service being unreachable (speak about the service); a throw
 * from the compose/fetch/render staging is the build itself.
 */
export function routeBuildFailure(stage: RouteBuildFailureStage, failure: MapsFailure | null): RouteBuildFailure {
  let message: string;
  if (stage === 'geocode' && failure === 'no_results') {
    message = 'Couldn’t find that place — try a fuller name (e.g. “Balboa Park, San Diego”).';
  } else if (stage === 'route' && failure === 'no_results') {
    message = 'Couldn’t find a driving route there — try a different destination.';
  } else if (stage === 'build') {
    message = 'Something went wrong building the route.';
  } else {
    message = 'Miles can’t reach the maps service right now.';
  }
  return { stage, message, canRetry: true };
}

export type RouteBuildUiState =
  | { kind: 'idle' }
  | { kind: 'building'; stage: RouteBuildStage; label: string }
  | { kind: 'failed'; failure: RouteBuildFailure };

/**
 * The build UI's one derivation (the App's render and the
 * harness read the same rule): an in-flight build shows its
 * current stage; a filed failure outranks the idle form — the
 * screen never sits on a building label for a build that is
 * dead, and a retry in flight shows its stage, not the stale
 * failure it is replacing.
 */
export function routeBuildUiState(input: {
  building: boolean;
  stage: RouteBuildStage;
  failure: RouteBuildFailure | null;
}): RouteBuildUiState {
  if (input.building) {
    return { kind: 'building', stage: input.stage, label: ROUTE_BUILD_STAGE_LABELS[input.stage] };
  }
  if (input.failure) return { kind: 'failed', failure: input.failure };
  return { kind: 'idle' };
}

/**
 * The produced breath (composer v3.1, commit D): ONE
 * consistent pause between consecutive plan items that play
 * back-to-back — a produced episode breathes between its
 * pieces instead of butting them together as hard cuts. It
 * is a FLOOR on spacing for adjacent items only.
 */
export const ROUTE_BREATH_MS = 700;

/**
 * The breath decision, pure for the harness: the gap the
 * runner's Player should use after a settle — ROUTE_BREATH_MS
 * for a true back-to-back transition (the previous plan item
 * SOUNDED — not skipped, not failed — and another plan item
 * follows), the Player's standing GAP_MS in every other case.
 * It yields, by construction:
 *   - to a closing/closed tour (the closeout's timing
 *     semantics are untouched: no breath before it, ever);
 *   - across pauses and window waits — those never pass
 *     through a sounded settle with a plan item at the FIFO
 *     head, and a held story's feed starts it immediately;
 *   - to a window about to close: when the next item is a
 *     windowed story and the driver's recent progress rate
 *     would carry them past its expire progress during the
 *     breath, the breath is skipped and the standing gap
 *     applies — the breath never makes an item stale. (The
 *     departure story is exempt from stale rules everywhere,
 *     so it is exempt here too.)
 */
export function routeInterItemGapMs(args: {
  closing: boolean;
  lastSettled: { sounded: boolean; skipped: boolean; planItem: boolean } | null;
  next: { planItem: boolean; expireProgress: number | null; departure: boolean } | null;
  lastProgress: number;
  progressPerSec: number | null;
}): number {
  const { closing, lastSettled, next, lastProgress, progressPerSec } = args;
  if (closing) return GAP_MS;
  if (!lastSettled || !lastSettled.sounded || lastSettled.skipped || !lastSettled.planItem) return GAP_MS;
  if (!next || !next.planItem) return GAP_MS;
  if (next.expireProgress !== null && !next.departure && progressPerSec !== null && progressPerSec > 0) {
    const projected = lastProgress + progressPerSec * (ROUTE_BREATH_MS / 1000);
    if (projected >= next.expireProgress) return GAP_MS;
  }
  return ROUTE_BREATH_MS;
}

/**
 * Render-ahead queue width (Nov 4, 2026). Three in flight:
 * with plan-order starts, one slow synthesis can head-of-line
 * block at most the pieces behind it, and two more in flight
 * keep the queue advancing past it; the queue's consumer (the
 * feed gate) needs at most one piece per settle, so three is
 * comfortable headroom without bursting the synthesis API —
 * the Nov 4 stationary test showed cold-connection transients
 * are real, and a wider burst invites exactly those. Pieces
 * still START strictly in plan order; concurrency only
 * overlaps their waits.
 */
export const RENDER_CONCURRENCY = 3;

export interface RouteRunnerDeps {
  audio: AudioPort;
  /** Synthesize text → playable blob URL (App wires gemini.synthesizeSpeech). */
  synthUrl: (text: string) => Promise<string>;
  /**
   * The wrap-up's synthesis seam: same synthesis, WITH the
   * standing audio finish applied (the App wires synthesize →
   * finishLiveRenderBlob). The wrap-up is the one piece whose
   * render carried the finish at preparation time before the
   * pipeline; as a queue item it keeps exactly that treatment.
   * Absent = the queue falls back to synthUrl for the wrap-up.
   */
  synthFinishedUrl?: (text: string) => Promise<string>;
  /**
   * Phase-2 Q&A answer generation — the SAME generation path the
   * freeform engine uses (gemini.generateAnswerText), wired by the
   * App ONLY when the declared-mode gate is open. Absent = Q&A is
   * unreachable in this runner, whatever the UI does.
   */
  generateAnswer?: (prompt: string) => Promise<string>;
  /** Model label filed on question_asked, matching freeform's payload. */
  answerModelLabel?: string;
  /** Best-effort heard recording for a sounded story (App wires backend.recordHeard). */
  onStoryHeard?: (unit: LibraryUnit) => void;
  /**
   * The drive record (addendum 2): fired ONCE when the plan's
   * accounting finalizes — any closeout, or an early End Tour on
   * a tour that actually began. The App persists it client-side
   * (routeHistory). Absent dep = no record, by construction —
   * freeform never constructs this runner at all.
   */
  onDriveRecord?: (record: RouteDriveRecord) => void;
  /** Best-effort telemetry (App wires backend.emitEvent). */
  onEvent?: (type: string, payload: Record<string, unknown>) => void;
  /**
   * Episode capture (Nov 4, 2026): fired ONCE at tour close
   * with the outcome row's payload (played / dropped / end
   * reason / movement). The App persists it to route_episodes
   * (backend.captureRouteEpisode). Absent dep = no outcome
   * row, by construction — the same posture as onDriveRecord.
   */
  onEpisodeOutcome?: (payload: RouteEpisodeOutcomePayload) => void;
  /**
   * Episode capture identity: the tour/session id and build
   * id the capture rows carry. The App mints the session id
   * before constructing the runner, so it can hand both over
   * here; the runner cannot know them itself (the drive
   * record's enrichment pattern, moved to construction).
   * Absent = capture is not wired for this runner.
   */
  episodeIds?: { tourId: string; buildId: string };
}

let runnerSeq = 0;

/** One plan item's render-ahead ledger entry (see RoutePlanRunner.entries). */
export interface RenderEntry {
  planItem: PlanItem;
  audible: AudibleItem | null;
  state: 'pending' | 'ready' | 'failed' | 'late' | 'dropped';
}

export class RoutePlanRunner {
  private player: Player;
  private deps: RouteRunnerDeps;
  private plan: RoutePlan | null = null;
  private listeners = new Set<() => void>();
  private playedStoryIds = new Set<string>();
  // Episode capture accounting (Nov 4, 2026): per-item settle
  // outcomes for the outcome row — every plan item that SOUNDED,
  // in sounding order, and every item that settled without
  // sounding. Recorded in onItemSettle before any early return,
  // so close-time abandons are counted too. Observation only:
  // nothing in playback reads these.
  private playedOrderIds: string[] = [];
  private settledUnplayed = new Map<string, { skipped: boolean }>();
  /** Bridges the feed gate skipped because their parent story was dropped stale. */
  private gateSkippedItemIds = new Set<string>();
  /** Tissue the feed gate late-skipped: its moment arrived before its render (render-ahead pipeline). */
  private lateSkippedItemIds = new Set<string>();
  /** Item id → when its render completed with audio in hand (capture's render verdicts). */
  private renderDoneAtMs = new Map<string, number>();
  /** Episode capture: filed at most once per runner, like the drive record. */
  private episodeOutcomeWritten = false;
  /** Movement evidence (episode capture's driven/stationary discriminator). */
  private firstFix: GeoPoint | null = null;
  private maxDisplacementM = 0;
  private maxProgress = 0;
  /**
   * Every plan item, in plan order, with its render state —
   * the render-ahead queue's ledger. 'pending' = not yet
   * rendered (queued or in flight); 'ready' = audio in hand;
   * 'failed' = synthesis fell back (skip-fallback: the piece
   * is dropped, never wedged); 'late' = the feed gate reached
   * its moment first and skipped it; 'dropped' = the gate
   * skipped it because its parent story was dropped stale.
   */
  private entries: RenderEntry[] = [];
  /** Next entry the feed gate will consider. The begun entry sits behind it. */
  private feedCursor = 0;
  /** Entries resolved: settled after feeding, or render-failed, or dropped/late-skipped at the gate. The exhaustion numerator. */
  private resolvedCount = 0;
  /** Stories dropped at the feed gate for an expired window (their outgoing bridges are skipped too). */
  private droppedStoryIds = new Set<string>();
  /** Render queue: entries started strictly in plan order, at most RENDER_CONCURRENCY in flight. */
  private renderNextIndex = 0;
  private renderInFlight = 0;
  /** When the plan was fixed (the queue's t=0 — render-late telemetry and capture timings read from it). */
  private planFixAtMs = 0;
  /** True once every queue task (all entries + the wrap-up) has settled. */
  private queueDrained = false;
  private queueDrainedAtMs: number | null = null;
  /** The opening settle: preview + first bridge + departure story resolved, one way or the other. */
  private openingSettledFlag = false;
  private openingSettledAtMs: number | null = null;
  private openingPromise: Promise<void> | null = null;
  private openingResolve: (() => void) | null = null;
  /** start()'s flow: begin the moment the opening prefix resolves (vs the manifest hold). */
  private wantsBegin = false;
  private begunAtMs: number | null = null;
  private planStartedFiled = false;
  /**
   * The wrap-up as a queue item (render-ahead pipeline): it
   * rides LAST in the queue, behind every plan item. 'adopted'
   * = the plan arrived with audio already rendered (the
   * standing fixture/pre-rendered shape) — no task, no
   * telemetry; 'pending' = text only, synthesis queued;
   * 'ready'/'failed' = the task's verdict (on failure the
   * standing closeout fallback speaks instead, as always).
   */
  private wrapUpState: 'none' | 'adopted' | 'pending' | 'ready' | 'failed' = 'none';
  private wrapUpAudioUrl: string | null = null;
  private wrapUpDoneAtMs: number | null = null;
  private wrapTaskStarted = false;
  private wrapUpPromise: Promise<boolean> | null = null;
  private wrapUpResolve: ((ok: boolean) => void) | null = null;
  /** Last known path progress (0 until the first GPS feed). */
  private lastProgress = 0;
  /** When lastProgress was sampled, and the recent progress rate (per second) — the breath's stale-risk input. */
  private lastProgressAt = 0;
  private progressPerSec: number | null = null;
  /** The most recent plan-item settle (the breath's back-to-back input). */
  private lastSettle: { sounded: boolean; skipped: boolean; planItem: boolean } | null = null;
  private begun = false;
  /** Manifest hold (differentiator 3): a staged plan renders but does not begin until beginStaged(). */
  private heldStart = false;
  /** Drive record (addendum 2): filed at most once per runner. */
  private driveRecordWritten = false;
  private closing = false;
  private closed = false;
  private arrivedFlag = false;
  private guardPausedFlag = false;
  private userPausedFlag = false;
  /** True after an explicit Resume overrode a guard pause: the guard must not re-pause until the driver returns to the corridor. */
  private guardOverridden = false;
  private owed: string | null = null;
  private endedKind: string | null = null;
  private freeformTailFlag = false;
  private closeoutDoneFlag = false;
  private qaPhase: RouteRunnerView['qaPhase'] = 'idle';
  private questionsAnsweredCount = 0;
  /** Tap time (prime) or start() time, whichever came first: the tour's clock for latch telemetry. */
  private startStamp: number | null = null;

  constructor(deps: RouteRunnerDeps) {
    this.deps = deps;
    this.player = new Player(deps.audio, systemClock, {
      resolveUrl: async item => (item.source.kind === 'url' ? item.source.url : ''),
      stallSource: () => null,
      emit: (type, payload) => deps.onEvent?.(type, payload),
      // The latch hooks are WIRED, mirroring the freeform Tour
      // (Nov 3, 2026): a route tour's first latch files the same
      // unlock_latched event freeform files (its absence from the
      // first route session's telemetry is what hid the blocked
      // first sound), a refused prime carrier falls back to the
      // sample prime — the tap's second carrier (O3/P7) — and a
      // restored latch re-drives the held item.
      onFirstLatch: source => {
        deps.onEvent?.('unlock_latched', {
          source,
          mode: 'route',
          ms_from_tour_start: this.startStamp !== null ? Date.now() - this.startStamp : null,
        });
        this.player.retryDrive();
        this.notify();
      },
      onPrimeCarrierFailed: () => {
        this.player.attemptSamplePrime('prime');
        this.notify();
      },
      onLatchLost: () => {
        deps.onEvent?.('unlock_lost', { source: 'blocked-burst', mode: 'route' });
        this.notify();
      },
      onLatchRestored: () => {
        this.player.retryDrive();
        this.notify();
      },
      onFailureStreak: () => undefined,
      attemptCap: () => 3,
      judgeStory: () => ({ ok: true }),
      mayDisplace: () => false,
      mayDefer: () => false,
      onDeferred: () => undefined,
      onSlotEmpty: () => undefined,
      onStoryCommitted: () => undefined,
      onSoundStart: () => this.notify(),
      onWaiting: () => undefined,
      onCommit: () => undefined,
      onState: () => this.notify(),
      // The produced breath (composer v3.1, commit D): the
      // Player consults this at each settle for the gap
      // before the promised head. The decision itself is
      // routeInterItemGapMs above; here it is fed the
      // runner's live state — the last settle, the FIFO
      // head's plan entry (window + departure status), and
      // the recent progress rate.
      interItemGapMs: next => {
        const entry = next ? this.entries.find(e => e.audible !== null && e.audible.id === next.id) : undefined;
        return routeInterItemGapMs({
          closing: this.closing || this.closed,
          lastSettled: this.lastSettle,
          next: next
            ? {
                planItem: entry !== undefined,
                expireProgress: entry?.planItem.expireProgress ?? null,
                departure: entry !== undefined && entry === this.firstReadyStoryEntry(),
              }
            : null,
          lastProgress: this.lastProgress,
          progressPerSec: this.progressPerSec,
        });
      },
    });
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    for (const cb of [...this.listeners]) cb();
  }

  view(): RouteRunnerView {
    const snap = this.player.snapshot();
    // Honest playback state (Nov 3, 2026): a speaking claim keys
    // off sound actually flowing — latch earned, an item sounding,
    // not user/guard-paused — never off plan position alone. The
    // pre-fix view derived 'playing' + now-playing from the plan
    // existing and the player's current label, so a refused first
    // play still presented as Miles speaking over silence.
    const latch = snap.latch;
    const sounding = latch === 'earned' && this.player.isPlaying() && !snap.userPaused;
    const awaiting = this.plan !== null && this.endedKind === null && latch !== 'earned' && !this.heldStart;
    return {
      phase:
        this.plan === null
          ? 'idle'
          : this.endedKind !== null
            ? 'ended'
            : this.heldStart
              ? 'ready'
              : awaiting
                ? 'awaiting'
                : 'playing',
      nowPlaying: sounding && snap.currentLabel ? { label: snap.currentLabel, kind: snap.currentKind ?? '' } : null,
      awaitingGesture: awaiting,
      latch,
      userPaused: this.userPausedFlag,
      guardPaused: this.guardPausedFlag,
      owed: this.owed,
      endedKind: this.endedKind,
      freeformTail: this.freeformTailFlag,
      closeoutDone: this.closeoutDoneFlag,
      qaPhase: this.qaPhase,
      questionsAnswered: this.questionsAnsweredCount,
      narrationReady: this.plan !== null && this.openingSettledFlag,
    };
  }

  /**
   * Tap-time prime (Nov 3, 2026 first-sound fix). The App calls
   * this SYNCHRONOUSLY inside the route intake's Build tap,
   * before the build's first await: the sample prime attempts on
   * THIS runner's element while the tap's transient activation
   * is still live, so the unlock latch is earned (or refused)
   * inside the gesture window — freeform's discipline, whose
   * greeting primes in its own START tap. Item 1 does not exist
   * at tap time, so the local sample is the carrier; the plan is
   * handed to this same runner when the build lands (start).
   * Before this, the route player was constructed and primed
   * only after the whole async build (parse → geocode → routes
   * → library fetches → plan-time synth), minutes past the tap:
   * WebKit refused the first play, the latch never earned, and
   * the tour opened silent. Calling prime() more than once is
   * harmless — the Player coalesces in-flight primes.
   */
  prime(): void {
    if (this.startStamp === null) this.startStamp = Date.now();
    this.player.attemptSamplePrime('prime');
  }

  /**
   * Discard a primed-but-never-started runner (the build failed
   * after the tap prime): release the element and settle its
   * items without filing an ending — no tour ever ran.
   */
  dispose(): void {
    this.closed = true;
    // Never leave a stage()/start() awaiter hanging on a
    // discarded runner: the opening gate resolves (the runner
    // is dead; nothing will ever be ready on it).
    this.settleOpening();
    this.player.teardown();
  }

  /**
   * Hand a plan over and begin as soon as the opening prefix
   * resolves (start()'s standing behavior): the first playable
   * item begins at once (it is the audio prime carrier, and it
   * must start as close to the user's tap as possible — the
   * departure story is exempt from window gating by
   * construction: the plan starts where the driver is). The
   * returned promise resolves at the OPENING settle — NOT when
   * every piece has rendered: the render-ahead queue keeps
   * working through the rest during playback. A bridge whose
   * render fails is dropped (skip-fallback) — it can never
   * wedge the gate, and playback goes straight into the next
   * Miles story when its window opens.
   */
  async start(plan: RoutePlan): Promise<void> {
    await this.fixPlan(plan, true);
  }

  /**
   * Manifest hold (differentiator 3): fix the plan exactly as
   * start() does, but BEGIN nothing — the tour screen is
   * showing the plan's episode card, and the runner must not
   * consume story windows while the listener reads it. The
   * render queue runs during the hold (that is the point of
   * the pipeline: the manifest minutes are render minutes).
   * The returned promise resolves at the OPENING settle, which
   * is what flips the card's button to 'Start tour';
   * beginStaged() — the tap — is what sets the plan in motion.
   */
  async stage(plan: RoutePlan): Promise<void> {
    this.heldStart = true;
    const opening = this.fixPlan(plan, false);
    // Surface the hold at once (composer v3, commit D): the
    // manifest card must be visible WHILE the opening renders
    // settle — fixPlan's synchronous prefix has already taken
    // the plan, so this notify publishes phase 'ready' with
    // narrationReady still false, and the card's button sits
    // disabled on the recording stage label until the settle
    // notify below.
    this.notify();
    await opening;
    this.notify();
  }

  /**
   * The manifest card's Start tour tap. The tap IS a user
   * gesture, so it re-primes first, through the same noteGesture
   * path the awaiting state uses — if the build tap's prime was
   * refused, this tap gives item 1 a fresh carrier inside a live
   * gesture window. Then the opening prefix begins and the feed
   * gate takes over; any window the driver already passed while
   * the card was up is handled by the dumb guards exactly as if
   * they had set off early (drop stale, owe it at the closeout).
   */
  beginStaged(): void {
    if (!this.heldStart || this.closed || this.endedKind !== null) return;
    this.heldStart = false;
    this.wantsBegin = true;
    this.player.noteGesture(this.heldFirstItem());
    // The opening settled before the button enabled, so the
    // prefix resolves here; if an early non-opening piece is
    // somehow still rendering ahead of the first ready entry,
    // tryBegin waits and the queue's next settle retries it.
    this.tryBegin();
    this.notify();
  }

  /**
   * Fix the plan and start the render-ahead queue. Synchronous
   * through plan assignment and the first task starts; the
   * returned promise resolves at the OPENING settle. The queue
   * starts tasks strictly in plan order (the wrap-up last),
   * at most RENDER_CONCURRENCY in flight, and keeps working
   * until every piece is rendered or fallen back — through
   * the manifest hold and through playback alike.
   */
  private fixPlan(plan: RoutePlan, beginFirst: boolean): Promise<void> {
    if (this.startStamp === null) this.startStamp = Date.now();
    this.plan = plan;
    this.planFixAtMs = Date.now();
    this.entries = plan.items.map(it => ({ planItem: it, audible: null, state: 'pending' as RenderEntry['state'] }));
    this.wantsBegin = beginFirst;
    if (plan.wrapUp) {
      if (plan.wrapUp.audioUrl) {
        // Audio arrived with the plan (the pre-rendered shape):
        // adopted as-is — no task, no route_wrap_up telemetry,
        // exactly as the standing closeout always treated it.
        this.wrapUpState = 'adopted';
        this.wrapUpAudioUrl = plan.wrapUp.audioUrl;
      } else if (plan.wrapUp.text) {
        this.wrapUpState = 'pending';
        this.wrapUpPromise = new Promise<boolean>(resolve => {
          this.wrapUpResolve = resolve;
        });
      }
    }
    this.openingPromise = new Promise<void>(resolve => {
      this.openingResolve = resolve;
    });
    this.pumpQueue();
    // An empty plan (or one whose opening is empty) settles
    // and drains without any task ever completing.
    this.afterTaskSettle();
    return this.openingPromise;
  }

  /** Start queued tasks while a concurrency slot is free — plan order, wrap-up last. */
  private pumpQueue(): void {
    if (this.closed || !this.plan) return;
    while (this.renderInFlight < RENDER_CONCURRENCY) {
      if (this.renderNextIndex < this.entries.length) {
        const entry = this.entries[this.renderNextIndex];
        this.renderNextIndex += 1;
        this.renderInFlight += 1;
        void this.runEntryTask(entry);
      } else if (this.wrapUpState === 'pending' && !this.wrapTaskStarted) {
        this.wrapTaskStarted = true;
        this.renderInFlight += 1;
        void this.runWrapTask(true);
      } else {
        return;
      }
    }
  }

  /** One entry's render: the standing toAudibleItem seam (shelf URL or synthesis). Never throws. */
  private async runEntryTask(entry: RenderEntry): Promise<void> {
    const it = entry.planItem;
    const audible = await this.toAudibleItem(it);
    this.renderInFlight -= 1;
    // Preview telemetry (consolidation §2): the preview item
    // rendered, or it didn't — a failed preview never wedges
    // the plan; the departure story simply becomes item 1.
    if (it.kind === 'preview') {
      this.deps.onEvent?.('route_preview', { preview: audible ? 'generated' : 'failed' });
    }
    if (entry.state === 'late' || entry.state === 'dropped') {
      // The feed gate already resolved this piece without its
      // audio (late skip / orphaned bridge): the finished
      // render is discarded, never fed late.
      if (audible && audible.source.kind === 'url' && audible.source.url.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(audible.source.url);
        } catch {
          /* best effort — a leaked object URL is not a tour failure */
        }
      }
    } else if (audible) {
      entry.audible = audible;
      entry.state = 'ready';
      this.renderDoneAtMs.set(it.id, Date.now());
    } else {
      // Render failure → dropped, never wedged (skip-fallback).
      // It counts as resolved NOW: the gate will step over it
      // and exhaustion can complete without it.
      entry.state = 'failed';
      this.resolvedCount += 1;
    }
    this.afterTaskSettle();
  }

  /**
   * The wrap-up's render task. Synthesis goes through the
   * finished-audio seam when the App wired one (the wrap-up
   * keeps the audio finish it always had). Its verdict fires
   * route_wrap_up 'generated'/'failed' — the events the App
   * used to fire at preparation time, now fired when the
   * render actually completes. An adopted wrap-up never runs
   * this and fires neither.
   */
  private async runWrapTask(countedInFlight: boolean): Promise<void> {
    const text = this.plan?.wrapUp?.text ?? null;
    let ok = false;
    if (text) {
      try {
        const synth = this.deps.synthFinishedUrl ?? this.deps.synthUrl;
        this.wrapUpAudioUrl = await synth(text);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (countedInFlight) this.renderInFlight -= 1;
    if (ok) {
      this.wrapUpState = 'ready';
      this.wrapUpDoneAtMs = Date.now();
      this.deps.onEvent?.('route_wrap_up', { wrap_up: 'generated' });
    } else {
      this.wrapUpState = 'failed';
      this.deps.onEvent?.('route_wrap_up', { wrap_up: 'failed' });
    }
    this.wrapUpResolve?.(ok);
    this.afterTaskSettle();
  }

  /** The wrap-up's audio, waiting for its render if the closeout arrives first. */
  private async resolveWrapUpUrl(): Promise<string | null> {
    if (this.wrapUpState === 'adopted' || this.wrapUpState === 'ready') return this.wrapUpAudioUrl;
    if (this.wrapUpState === 'pending' && this.wrapUpPromise) {
      // The closeout needs it NOW: if its queue turn hasn't
      // come, start it out of band (the standing closeout
      // always synthesized its line inline at close; this is
      // the same one-off, never a second render — the started
      // flag keeps the queue from repeating it).
      if (!this.wrapTaskStarted) {
        this.wrapTaskStarted = true;
        void this.runWrapTask(false);
      }
      const ok = await this.wrapUpPromise;
      return ok ? this.wrapUpAudioUrl : null;
    }
    return null;
  }

  /** Every task settle funnels here: advance the queue, the gates, and the feed. */
  private afterTaskSettle(): void {
    if (!this.plan) return;
    this.pumpQueue();
    this.checkOpeningSettled();
    if (
      !this.queueDrained &&
      this.renderNextIndex >= this.entries.length &&
      this.renderInFlight === 0 &&
      this.wrapUpState !== 'pending'
    ) {
      this.queueDrained = true;
      this.queueDrainedAtMs = Date.now();
      this.settleOpening(); // an empty opening set drains into its settle
      this.maybeEmptyPlan();
    }
    if (this.wantsBegin && !this.heldStart && !this.begun) this.tryBegin();
    if (this.begun) {
      this.maybeFeed();
      this.maybeExhaust();
    }
    this.notify();
  }

  /** The opening's entry indexes: first preview, first bridge, first story/filler — whichever exist. */
  private openingIndexes(): number[] {
    const found: number[] = [];
    let preview = -1;
    let bridge = -1;
    let story = -1;
    this.entries.forEach((e, i) => {
      if (preview < 0 && e.planItem.kind === 'preview') preview = i;
      if (bridge < 0 && e.planItem.kind === 'bridge') bridge = i;
      if (story < 0 && (e.planItem.kind === 'story' || e.planItem.kind === 'filler')) story = i;
    });
    for (const i of [preview, bridge, story]) {
      if (i >= 0 && !found.includes(i)) found.push(i);
    }
    return found;
  }

  private checkOpeningSettled(): void {
    if (this.openingSettledFlag || !this.plan) return;
    const settled = (s: RenderEntry['state']) => s !== 'pending';
    if (this.openingIndexes().every(i => settled(this.entries[i].state))) this.settleOpening();
  }

  private settleOpening(): void {
    if (this.openingSettledFlag) return;
    this.openingSettledFlag = true;
    this.openingSettledAtMs = Date.now();
    this.openingResolve?.();
  }

  /**
   * Begin the tour at the first ready entry, in plan order:
   * failed/late/dropped prefix pieces are stepped over (a
   * failed preview means the departure story is item 1), and
   * a still-rendering prefix piece holds the begin — the
   * prefix IS the opening, and pieces sound in plan order or
   * not at all. Returns whether the tour began.
   */
  private tryBegin(): boolean {
    if (this.begun || this.closed || this.endedKind !== null || !this.plan) return false;
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (entry.state === 'failed' || entry.state === 'late' || entry.state === 'dropped') continue;
      if (entry.state === 'pending') return false; // the opening prefix resolves in order, or not yet
      this.player.beginWithItem(entry.audible as AudibleItem);
      this.begun = true;
      this.begunAtMs = Date.now();
      this.feedCursor = i + 1;
      this.filePlanStartedOnce();
      this.maybeFeed();
      this.maybeExhaust();
      this.notify();
      return true;
    }
    return false;
  }

  private filePlanStartedOnce(): void {
    if (this.planStartedFiled) return;
    this.planStartedFiled = true;
    this.filePlanStarted();
  }

  /**
   * The departure story's entry — the first story with audio
   * in hand, in plan order (consolidation §2). It keeps the
   * standing item-1 exemption at the feed gate: the preview
   * item holds slot 1 now, but the departure story behind it
   * still begins when the runner reaches it — never held by
   * its release window, never dropped stale at the gate —
   * exactly the treatment slot 1 had when the departure story
   * WAS the first item. Derived, not stored: the gate only
   * ever evaluates a story after every earlier story has
   * resolved (a pending earlier story holds the gate), so the
   * first ready story at evaluation time IS the departure.
   */
  private firstReadyStoryEntry(): RenderEntry | null {
    return this.entries.find(e => e.planItem.kind === 'story' && e.audible !== null) ?? null;
  }

  /**
   * A drained queue with NO audio in hand (all heard at plan
   * time / every render failed): the empty-plan ending, moved
   * verbatim from the standing render pass — the handoff line
   * is still owed, never dead air, never a silent screen. The
   * App treats this as an overrun tail, and the accounting
   * finalizes here (addendum 2): every plan story is unplayed,
   * hence owed.
   */
  private maybeEmptyPlan(): void {
    if (!this.plan || this.closed || this.begun || this.endedKind !== null) return;
    if (this.entries.some(e => e.audible !== null)) return;
    const plan = this.plan;
    this.writeDriveRecord(
      plan.items.filter(it => it.kind === 'story' && it.unit).map(it => it.unit as LibraryUnit),
    );
    // Episode capture (Nov 4, 2026): an empty plan ends here,
    // never reaching close() — its outcome row files from the
    // same branch.
    this.fileEpisodeOutcome('overrun');
    this.heldStart = false;
    this.freeformTailFlag = true;
    this.endedKind = 'overrun';
    this.closeoutDoneFlag = true;
    this.notify();
  }

  /**
   * The route_plan_started payload, factored out of
   * filePlanStarted (episode capture, Nov 4, 2026): the
   * capture's plan row embeds this EXACT object, so offline
   * analysis reads the same decisions record telemetry
   * filed — never a reconstruction of it.
   */
  private planStartedPayload(): Record<string, unknown> {
    const plan = this.plan as RoutePlan;
    return {
      destination: plan.destinationName,
      // The plan's item count (render-ahead pipeline, Nov 4,
      // 2026): a plan constant, so this payload is identical
      // whenever it is assembled — at first sound for the
      // telemetry, at opening settle for the capture row that
      // embeds it verbatim. How many pieces had audio in hand
      // at each moment rides the capture rows themselves
      // (items[].rendered at settle, render_results at close).
      items: plan.items.length,
      portals: plan.items.filter(i => i.portal).length,
      budget_sec: plan.budgetSec,
      // Fetch accounting (composer v3.1, commit B): reads
      // spent at departure, unheard candidates put in hand,
      // the thinnest decile, and whether a read ceiling
      // stopped the window while need remained — the field
      // evidence for whether the window fed or starved.
      fetch: plan.fetchStats
        ? {
            reads: plan.fetchStats.reads,
            geo_reads: plan.fetchStats.geoReads,
            portal_reads: plan.fetchStats.portalReads,
            unheard: plan.fetchStats.unheard,
            decile_unheard: plan.fetchStats.decileUnheard,
            decile_min: Math.min(...plan.fetchStats.decileUnheard),
            ceiling_hit: plan.fetchStats.ceilingHit,
            // The member fetch (Nov 4, 2026): the ONE bounded
            // fetch that answered the plan's member seeking —
            // its topic, the reads it spent, and the seatable
            // candidates it returned. Null when the lever
            // never fired on this build.
            member_fetch: plan.fetchStats.memberFetch
              ? {
                  topic: plan.fetchStats.memberFetch.topic,
                  reads: plan.fetchStats.memberFetch.reads,
                  candidates: plan.fetchStats.memberFetch.candidates,
                }
              : null,
          }
        : null,
      // Through-line (differentiator 2): the thread the plan was
      // composed around. Climax (addendum 4 + consolidation
      // §4): how it resolved and its subject — a portal climax
      // carries its distance from the route as well.
      thread: plan.thread ? { topic: plan.thread.topic, members: plan.thread.memberIds } : null,
      climax: {
        mode: plan.climaxMode ?? 'natural',
        subject: plan.climaxSubject ?? null,
        ...(plan.climaxMode === 'portal' ? { distance_km: plan.climaxDistanceKm ?? null } : {}),
      },
      // The priority ladder's decisions record (consolidation
      // §1): which thread and where it came from, the climax
      // placement, and what the preview item carries — so any
      // plan can be audited against the ladder after the fact.
      decisions: {
        thread: plan.thread
          ? { topic: plan.thread.topic, source: plan.threadSource ?? 'detected' }
          : null,
        climax: { mode: plan.climaxMode ?? 'natural', subject: plan.climaxSubject ?? null },
        preview: plan.previewFacts ?? { threadPromised: false, previouslyDrive: false, previouslySubject: false },
        // Composer v3 (commit B): the plan's act structure —
        // per act, story count, class tallies, and whether the
        // act's quality floor fired. (The openers tally retired
        // with the welcome demotion, Nov 4, 2026.)
        acts: plan.actsSummary,
        // Corridor lifetime cap (addendum B): stretches this
        // plan retired at 3 lifetime tellings. Null when the
        // build supplied no telling counts.
        corridor_retired_stretches: plan.corridorRetiredStretches ?? null,
        // Woven seated members (Nov 4, 2026): how many
        // off-route thread members the seating pass placed in
        // the plan's silent gaps, and the thread topic they
        // were seated under. Zero/empty when none seated.
        woven_members: {
          count: plan.wovenMembers?.count ?? 0,
          topics: plan.wovenMembers?.topics ?? [],
        },
        // Thread-carried episodes (Nov 4, 2026): the
        // staging's assessment of the guaranteed plan —
        // whether the mode engaged, the geo-anchored
        // coverage fraction that decided it (members
        // excluded), and the member cap seating ran under.
        // Null when the plan never went through the route
        // staging's assessment.
        thread_carried: plan.threadCarried
          ? {
              active: plan.threadCarried.active,
              geo_coverage_fraction: Math.round(plan.threadCarried.geoCoverageFraction * 1000) / 1000,
              member_cap: plan.threadCarried.memberCap,
            }
          : null,
      },
    };
  }

  private filePlanStarted(): void {
    if (!this.plan) return;
    this.deps.onEvent?.('route_plan_started', this.planStartedPayload());
  }

  /**
   * Episode capture (Nov 4, 2026): the kind='plan' payload,
   * assembled from the runner's own state at OPENING settle —
   * the App calls this once stage()/start() resolves and
   * sends it through backend.captureRouteEpisode. The items
   * are the plan's, fully self-contained (full texts as
   * served — every text exists at plan-fix; only synthesis is
   * pipelined, so nothing textual is missing); an item's
   * `rendered` marks audio in hand at this moment, and the
   * outcome row carries each item's final render verdict.
   * The decisions are planStartedPayload() verbatim. Null
   * when capture is not wired for this runner (episodeIds
   * absent) or no plan was ever handed over.
   */
  episodePlanCapture(context: EpisodeCaptureContext): RouteEpisodePlanPayload | null {
    const plan = this.plan;
    const ids = this.deps.episodeIds;
    if (!plan || !ids) return null;
    const renderedIds = new Set(this.entries.filter(e => e.audible !== null).map(e => e.planItem.id));
    if (this.wrapUpState === 'adopted' || this.wrapUpState === 'ready') renderedIds.add('wrap-up');
    return assemblePlanCapture({
      tourId: ids.tourId,
      buildId: ids.buildId,
      context,
      plan,
      routePlanStarted: this.planStartedPayload(),
      items: assemblePlanItems(plan, renderedIds),
    });
  }

  /**
   * Episode capture (Nov 4, 2026): file the kind='outcome'
   * row, ONCE, from the runner's own accounting — the same
   * lists the drive record and the owed tease are drawn
   * from. Fired from close() (arrival / overrun), from the
   * empty-plan drain of the render queue (an overrun that never
   * reaches close()), and from endTour() (user end, begun or
   * backed out of the card). A failure inside the dep is
   * swallowed: capture never breaks a tour.
   *
   * extraPlayedIds: on an arrival close, the story sounding
   * on the element plays to completion behind the closeout
   * (consolidation §5) — its settle lands after this files,
   * so close() names it played explicitly. On overrun the
   * Player cuts it off mid-flight; it is NOT named.
   */
  private fileEpisodeOutcome(endReason: string, extraPlayedIds: string[] = []): void {
    if (this.episodeOutcomeWritten || !this.plan || !this.deps.onEpisodeOutcome || !this.deps.episodeIds) return;
    this.episodeOutcomeWritten = true;
    try {
      const plan = this.plan;
      const playedIds = [...this.playedOrderIds];
      for (const id of extraPlayedIds) {
        if (!playedIds.includes(id)) playedIds.push(id);
      }
      const playedIdSet = new Set(playedIds);
      const heardUnitIds = plan.items
        .filter(it => it.unit && playedIdSet.has(it.id))
        .map(it => (it.unit as LibraryUnit).id);
      this.deps.onEpisodeOutcome(
        assembleOutcomeCapture(this.deps.episodeIds.tourId, this.deps.episodeIds.buildId, {
          endReason,
          begun: this.begun,
          planItemIds: plan.items.map(it => it.id),
          playedItemIds: playedIds,
          settledUnplayed: this.settledUnplayed,
          droppedStaleItemIds: this.droppedStoryIds,
          gateSkippedItemIds: this.gateSkippedItemIds,
          unrenderedItemIds: new Set(
            this.entries.filter(e => e.state === 'failed').map(e => e.planItem.id),
          ),
          lateSkippedItemIds: this.lateSkippedItemIds,
          renderResults: this.renderResults(),
          queueDrainedMs:
            this.queueDrainedAtMs !== null ? this.queueDrainedAtMs - this.planFixAtMs : null,
          heardUnitIds,
          maxDisplacementM: this.maxDisplacementM,
          maxProgressFraction: this.maxProgress,
          pathLengthM: pathLengthM(plan.path),
          endedAtMs: Date.now(),
        }),
      );
    } catch {
      /* capture is a nicety — never a tour failure */
    }
  }

  /**
   * Episode capture (schema 2): one render verdict per plan
   * item, in plan order, plus the wrap-up pseudo-item last.
   * The 'pre-start'/'ahead' split reads render completion
   * against the tour's begin (or, for a tour that never
   * began, the opening settle — the moment its Start gate
   * flipped). A piece still rendering at close is 'pending':
   * its text is complete in the plan row regardless.
   */
  private renderResults(): CapturedRenderResult[] {
    const mark = this.begunAtMs ?? this.openingSettledAtMs ?? Number.POSITIVE_INFINITY;
    const out: CapturedRenderResult[] =
      this.entries.map((e, index) => {
        let result: CapturedRenderResult['result'];
        if (e.state === 'failed') result = 'failed';
        else if (e.state === 'late') result = 'skipped-late';
        else {
          const doneAt = this.renderDoneAtMs.get(e.planItem.id);
          if (doneAt === undefined) result = 'pending';
          else result = doneAt <= mark ? 'pre-start' : 'ahead';
        }
        return { index, id: e.planItem.id, result };
      });
    if (this.wrapUpState !== 'none' && this.plan) {
      let result: CapturedRenderResult['result'];
      if (this.wrapUpState === 'adopted') result = 'pre-start';
      else if (this.wrapUpState === 'failed') result = 'failed';
      else if (this.wrapUpState === 'ready') {
        result = (this.wrapUpDoneAtMs ?? Number.POSITIVE_INFINITY) <= mark ? 'pre-start' : 'ahead';
      } else result = 'pending';
      out.push({ index: this.plan.items.length, id: 'wrap-up', result });
    }
    return out;
  }

  /**
   * The anchored-release feed gate. The Player starts whatever
   * sits in its promised FIFO the moment the current item
   * settles, so anything enqueued is effectively RELEASED: the
   * gate therefore keeps the FIFO empty and considers the head
   * entry only —
   *   - an entry already resolved without feeding (render
   *     failed, late-skipped, gate-dropped) is stepped over;
   *   - a bridge whose parent story was dropped stale is
   *     skipped silently (it names ground never heard);
   *   - a bridge/reaction still RENDERING whose moment has
   *     arrived — the stage is empty (the Player holds no
   *     current item: the previous piece settled and this one
   *     is due NOW) — is LATE-SKIPPED (route_render_late +
   *     capture accounting) and the gate moves on: playback
   *     never stalls for tissue. While anything is still
   *     sounding, a rendering head simply waits — its moment
   *     has not come, and the render queue is working on it;
   *   - a geographic story still rendering HOLDS the gate
   *     (stories are load-bearing; only tissue late-skips);
   *   - a geographic story past its expire progress is dropped
   *     stale (story_dropped, reason 'stale-window'); a story
   *     before its release progress HOLDS the gate — the Player
   *     idles on bridges/fillers already played, never on the
   *     story sounded early (the departure story is exempt from
   *     both rules: it opens the drive, behind the preview item
   *     or in slot 1 itself — see firstReadyStoryEntry);
   *   - everything else (bridges, reactions, fillers, portal
   *     stories, woven members — windowless by design, seated
   *     into silence by plan order) feeds.
   * Feeding one entry can empty the FIFO instantly (an idle
   * Player takes it as current), so the loop re-checks.
   */
  private maybeFeed(): void {
    if (!this.plan || this.closed || this.closing || !this.begun) return;
    while (this.feedCursor < this.entries.length) {
      if (this.player.promised.length > 0) return;
      const entry = this.entries[this.feedCursor];
      const it = entry.planItem;
      if (entry.state === 'failed' || entry.state === 'late' || entry.state === 'dropped') {
        this.feedCursor += 1; // resolved in the accounting when it happened
        continue;
      }
      if (it.kind === 'bridge' && it.prevUnitId && this.droppedStoryIds.has(it.prevUnitId)) {
        entry.state = 'dropped';
        this.feedCursor += 1;
        this.resolvedCount += 1;
        this.gateSkippedItemIds.add(it.id); // episode capture: the outcome row names this drop
        continue;
      }
      if (entry.state === 'pending') {
        const isTissue = it.kind === 'bridge' || it.kind === 'reaction' || it.kind === 'preview';
        if (isTissue && this.player.current === null) {
          // Its moment arrived before its render: skip it and
          // let the story behind it sound. The telemetry
          // carries the queue's state at the skip so the field
          // can judge whether concurrency/lookahead needs
          // tuning (how long since plan-fix, how much work was
          // still ahead of the skipped piece).
          const index = this.feedCursor;
          entry.state = 'late';
          this.feedCursor += 1;
          this.resolvedCount += 1;
          this.lateSkippedItemIds.add(it.id);
          this.deps.onEvent?.('route_render_late', {
            item_id: it.id,
            kind: it.kind,
            index,
            in_flight: this.renderInFlight,
            queued: this.entries.length - this.renderNextIndex,
            ms_since_plan_fix: Date.now() - this.planFixAtMs,
            mode: 'route',
          });
          continue;
        }
        return; // still rendering and its moment has not come (or it is a story): wait
      }
      if (it.kind === 'story' && !it.portal && !it.woven && entry !== this.firstReadyStoryEntry()) {
        const release = it.releaseProgress ?? 0;
        const expire = it.expireProgress ?? Number.POSITIVE_INFINITY;
        if (this.lastProgress > expire) {
          this.feedCursor += 1;
          this.resolvedCount += 1;
          this.droppedStoryIds.add(it.id);
          this.deps.onEvent?.('story_dropped', {
            subject: it.unit?.placeName ?? it.label,
            reason: 'stale-window',
            mode: 'route',
          });
          continue;
        }
        if (this.lastProgress < release) return; // window not open yet: wait for the ground
      }
      this.player.enqueuePromised(entry.audible as AudibleItem);
      this.feedCursor += 1;
    }
    this.maybeExhaust();
  }

  /** Plan exhaustion, evaluated only once the render queue has drained (pieces still rendering are not yet countable). */
  private maybeExhaust(): void {
    if (!this.queueDrained || this.closed) return;
    if (this.resolvedCount < this.entries.length) return;
    if (this.arrivedFlag) {
      void this.close('arrival-signoff');
    } else {
      void this.close('overrun');
    }
  }

  private async toAudibleItem(it: PlanItem): Promise<AudibleItem | null> {
    const id = `route-${++runnerSeq}`;
    const onSettle = (rec: { sounded: boolean; skipped: boolean }) => this.onItemSettle(it, rec);
    if (it.kind === 'story' || it.kind === 'filler') {
      const unit = it.unit;
      if (!unit) return null;
      const url = unit.audioPath ? bucketUrl(unit.audioPath) : null;
      if (url) {
        return {
          id,
          kind: it.kind === 'filler' ? 'filler' : 'story',
          label: it.label,
          source: { kind: 'url', url },
          durationSec: it.durationSec,
          attempts: 0,
          settled: false,
          onSettle,
          subject: unit.placeName,
          angleOf: unit.angle,
          anchor: { lat: unit.lat, lng: unit.lng },
          text: unit.storyText,
        };
      }
      // No bucket audio (should not happen for library rows):
      // fall back to synthesising the stored text, if any.
      if (!unit.storyText) return null;
      try {
        const synth = await this.deps.synthUrl(unit.storyText);
        return {
          id,
          kind: 'story',
          label: it.label,
          source: { kind: 'url', url: synth },
          durationSec: it.durationSec,
          attempts: 0,
          settled: false,
          onSettle,
          subject: unit.placeName,
          angleOf: unit.angle,
          anchor: { lat: unit.lat, lng: unit.lng },
          text: unit.storyText,
        };
      } catch {
        return null; // unplayable story: skipped, never wedged
      }
    }
    // Bridge / reaction: Miles-solo voice lines, rendered at plan
    // time. A render failure drops the line (skip-fallback).
    if (!it.text) return null;
    try {
      const synth = await this.deps.synthUrl(it.text);
      return {
        id,
        kind: it.kind === 'bridge' ? 'bridge' : 'commentary',
        label: it.label,
        source: { kind: 'url', url: synth },
        durationSec: it.durationSec,
        attempts: 0,
        settled: false,
        onSettle,
      };
    } catch {
      return null;
    }
  }

  private onItemSettle(it: PlanItem, rec: { sounded: boolean; skipped: boolean }): void {
    const sounded = rec.sounded;
    // Episode capture accounting (Nov 4, 2026): recorded
    // before anything else — including settles the closeout
    // itself causes (queued items abandoned at close count as
    // settled-without-sounding in the outcome row).
    if (sounded) this.playedOrderIds.push(it.id);
    else this.settledUnplayed.set(it.id, { skipped: rec.skipped });
    // The breath's input (commit D): every plan-item settle
    // is recorded before anything else reads it — the Player
    // consults the gap hook immediately after this returns.
    this.lastSettle = { sounded, skipped: rec.skipped, planItem: true };
    if (it.kind === 'story' && it.unit && sounded) {
      this.playedStoryIds.add(it.unit.id);
      this.deps.onStoryHeard?.(it.unit);
    }
    // The preview is not a story (consolidation §2): it is
    // never heard-recorded and never owed — its only trace is
    // that it played.
    if (it.kind === 'preview' && sounded) {
      this.deps.onEvent?.('route_preview', { preview: 'played' });
    }
    if (this.closing) return; // settles caused by the closeout itself
    this.resolvedCount += 1;
    this.maybeFeed();
    this.maybeExhaust();
    this.notify();
  }

  /** GPS feed (App's usePosition already drives this). Dumb guards only. */
  onPosition(pos: GeoPoint): void {
    if (!this.plan || this.closed) return;
    const progress = progressAlongPath(pos, this.plan.path);
    // Recent progress rate — the breath's stale-risk input
    // (commit D): sampled from consecutive position fixes.
    const nowMs = Date.now();
    if (this.lastProgressAt > 0 && nowMs > this.lastProgressAt) {
      const rate = (progress - this.lastProgress) / ((nowMs - this.lastProgressAt) / 1000);
      if (Number.isFinite(rate) && rate > 0) this.progressPerSec = rate;
    }
    this.lastProgress = progress;
    this.lastProgressAt = nowMs;
    // Episode capture movement evidence (Nov 4, 2026): how
    // far the device ever got from its first fix, and how far
    // along the path it ever read — the raw material for the
    // outcome row's driven/stationary call. Recorded before
    // the manifest-hold return: movement is movement, card or
    // no card.
    if (this.firstFix === null) {
      this.firstFix = pos;
    } else {
      const displacement = haversineM(this.firstFix, pos);
      if (displacement > this.maxDisplacementM) this.maxDisplacementM = displacement;
    }
    if (progress > this.maxProgress) this.maxProgress = progress;
    // Manifest hold (differentiator 3): while the episode card
    // is up, a position update refreshes the progress reading
    // only — no arrival closeout, no corridor pause, no window
    // feed. The guards evaluate from the Start tour tap
    // onward, against the progress the driver actually reached.
    if (this.heldStart) return;
    // Arrival check first: it outranks the corridor guard.
    if (!this.arrivedFlag && hasArrived(pos, this.plan.destination, this.plan.path)) {
      this.arrivedFlag = true;
      const exhausted = this.queueDrained && this.resolvedCount >= this.entries.length;
      void this.close(exhausted ? 'arrival-signoff' : 'arrival-owed');
      return;
    }
    if (this.closed) return;
    const off = isOffCorridor(pos, this.plan.path); // 200 m tolerance, in routeMode
    if (!off) this.guardOverridden = false;
    if (off && !this.guardPausedFlag && !this.userPausedFlag && !this.guardOverridden && this.player.isPlaying()) {
      this.guardPausedFlag = true;
      this.player.pauseByUser();
      this.deps.onEvent?.('route_off_corridor_pause', {});
    } else if (!off && this.guardPausedFlag && !this.userPausedFlag) {
      this.guardPausedFlag = false;
      this.player.resumeByUser();
      this.deps.onEvent?.('route_on_corridor_resume', {});
    }
    // A position update is also a window event: it can open the
    // head story's window (feed it) or close it (drop it stale).
    this.maybeFeed();
    this.notify();
  }

  pauseByUser(): void {
    this.userPausedFlag = true;
    this.player.pauseByUser();
    this.notify();
  }

  resumeByUser(): void {
    // An explicit Resume overrides a guard pause (the driver chose
    // to keep listening off-corridor); the guard re-arms on the
    // next corridor return via onPosition. The Resume tap is also
    // a gesture: re-prime first, exactly as freeform's resume does.
    this.player.noteGesture(this.heldFirstItem());
    if (this.guardPausedFlag) this.guardOverridden = true;
    this.userPausedFlag = false;
    this.guardPausedFlag = false;
    this.player.resumeByUser();
    this.notify();
  }

  skip(): void {
    this.player.skipCurrent();
  }

  seekBy(sec: number): void {
    this.player.seekBy(sec);
  }

  /**
   * The held first sound, freeform's heldGreeting generalized:
   * while the latch is unearned, the item that owes the first
   * sound — the player's current item, or the parked head of the
   * promised FIFO (a refused carrier is parked there by the
   * fallback sample prime) — rides the next gesture as the prime
   * carrier itself, so the retry IS the first story attempting,
   * not only the sample blip.
   */
  private heldFirstItem(): AudibleItem | null {
    if (this.player.latch === 'earned') return null;
    const current = this.player.current;
    if (current && !current.settled) return current;
    const head = this.player.promised[0];
    if (head && !head.settled) return head;
    return null;
  }

  /** Any in-tour gesture: a re-prime opportunity (P8), routed by the UI / the document net. */
  noteGesture(): void {
    this.player.noteGesture(this.heldFirstItem());
  }

  /** The tap-to-hear affordance's tap (P11): a gesture-retry, then a re-drive if nothing is current. */
  bannerTap(): void {
    this.player.noteGesture(this.heldFirstItem());
    if (!this.player.isPlaying() && this.player.current === null) {
      this.player.retryDrive();
    }
    this.notify();
  }

  /**
   * File the drive record (addendum 2) from the runner's own
   * accounting: sounded stories are the played list, the
   * closeout's unplayed plan stories are the owed list — the
   * same lists the owed tease is drawn from, never reconstructed
   * after the fact. The destination place_key is the App's to
   * enrich at write time (the runner cannot know it). A failure
   * inside the dep is swallowed: the record never breaks a tour.
   */
  private writeDriveRecord(unplayedUnits: LibraryUnit[]): void {
    if (this.driveRecordWritten || !this.plan || !this.deps.onDriveRecord) return;
    this.driveRecordWritten = true;
    const names = (units: LibraryUnit[]) => [...new Set(units.map(u => u.placeName))];
    const played = this.plan.items
      .filter(it => it.kind === 'story' && it.unit && this.playedStoryIds.has(it.unit.id))
      .map(it => it.unit as LibraryUnit);
    try {
      this.deps.onDriveRecord({
        destinationName: this.plan.destinationName,
        destinationPlaceKey: null,
        threadTopic: this.plan.thread?.topic ?? null,
        playedSubjects: names(played),
        owedSubjects: names(unplayedUnits),
        endedAt: Date.now(),
      });
    } catch {
      /* the record is a nicety — never a tour failure */
    }
  }

  private async close(kind: 'arrival-owed' | 'arrival-signoff' | 'overrun'): Promise<void> {
    if (!this.plan || this.closed) return;
    this.closed = true;
    this.closing = true;
    const plan = this.plan;
    // The story sounding on the element right now, if any —
    // computed BEFORE the owed set (consolidation §5).
    const currentEntry = this.player.current
      ? this.entries.find(e => e.audible !== null && e.audible.id === this.player.current!.id)
      : undefined;
    const soundingStoryId =
      currentEntry && currentEntry.planItem.kind === 'story' ? currentEntry.planItem.id : null;
    const unplayed = plan.items
      .filter(it => it.kind === 'story' && it.unit && !this.playedStoryIds.has(it.unit.id))
      .map(it => it.unit as LibraryUnit)
      // Consolidation §5 — the owed-line wart: on an ARRIVAL
      // close, the story sounding on the element is NOT owed.
      // The close's queued pieces wait for its settle, so it
      // plays to completion; naming it in the owed line would
      // call a story owed while Miles is finishing it. The
      // overrun handoff keeps it (there the Player cuts it off
      // mid-flight, so it genuinely never completes).
      .filter(u => !(kind !== 'overrun' && u.id === soundingStoryId));
    const closeout = decideCloseout({
      arrived: kind !== 'overrun',
      planExhausted: kind !== 'arrival-owed',
      unplayedPlanUnits: unplayed,
      unheardShelfUnits: plan.shelfTease ? [plan.shelfTease] : [],
    });
    // The wrap-up's play gate (addendum 3): an ARRIVAL close
    // with the plan run out. "Run out" is read off the runner's
    // own accounting, not the closeout kind alone: every plan
    // story has sounded, or the only unsounded story is the
    // one on the element right now (it plays to its end, with
    // the closing piece queued behind it), and nothing is held
    // back by a window or still unfed. A story dropped stale,
    // abandoned in the queue, or never fed fails the gate —
    // that drive was cut short, and today's closeout line
    // speaks instead. The overrun handoff never plays it.
    const planRanOut =
      this.feedCursor >= this.entries.length && unplayed.every(u => u.id === soundingStoryId);
    const wrapGateOpen = kind !== 'overrun' && planRanOut && plan.wrapUp != null;
    // The accounting just finalized — file the drive record
    // (addendum 2) with the closeout's actual owed list.
    this.writeDriveRecord(unplayed);
    // Drop everything still queued so the closeout line is next,
    // not after five unplayed stories. The items must LEAVE the
    // promised FIFO as they settle: abandon() alone settles an
    // item in place, and a settled husk still sitting in the FIFO
    // deadlocks the player when the pump later shifts it (its
    // drive returns instantly, so it becomes `current` forever
    // and nothing behind it — including this closeout — ever
    // plays). That husk deadlock fired on any arrival-owed
    // closeout with items queued (found by the phase-2 runner
    // harness, Nov 3, 2026); the phase-1 harness never drove the
    // runner, so it shipped unseen. Splice first, then settle.
    const queued = [...this.player.promised];
    this.player.promised.length = 0;
    for (const item of queued) this.player.abandon(item);
    this.endedKind = kind;
    this.freeformTailFlag = kind === 'overrun';
    if (closeout) {
      this.owed = owedLine(closeout.teaseLabel);
      try {
        // The wrap-up (addendum 3) replaces the synthesized
        // sign-off on the completion path only. Its audio is a
        // render-ahead queue item (rendered during the tour,
        // or adopted pre-rendered with the plan);
        // resolveWrapUpUrl waits for it if its queue turn
        // hasn't come, and on its failure today's closeout
        // line speaks instead, synthesized exactly as before.
        // Every other close speaks today's line the same way.
        const wrapUrl = wrapGateOpen ? await this.resolveWrapUpUrl() : null;
        const usedWrapUp = wrapUrl !== null;
        const url = usedWrapUp ? wrapUrl : await this.deps.synthUrl(closeout.line);
        this.player.enqueuePromised({
          id: `route-close-${++runnerSeq}`,
          kind: 'greeting',
          label: usedWrapUp ? 'Wrap-up' : closeout.kind === 'overrun' ? 'Handoff' : 'Sign-off',
          source: { kind: 'url', url },
          durationSec: usedWrapUp ? estimateDurationSec(plan.wrapUp!.text) : 8,
          attempts: 0,
          settled: false,
          onSettle: rec => {
            if (usedWrapUp && rec.sounded) {
              this.deps.onEvent?.('route_wrap_up', { wrap_up: 'played' });
            }
            this.closing = false;
            this.closeoutDoneFlag = true;
            this.notify();
          },
        });
      } catch {
        this.closing = false; // spoken line lost; the owed state still stands
        this.closeoutDoneFlag = true;
      }
    } else {
      this.closeoutDoneFlag = true;
    }
    // Episode capture (Nov 4, 2026): the outcome row files
    // after the queued abandons above, so their settles are
    // already in the accounting (settled-without-sounding).
    // On an arrival close the sounding story plays to
    // completion behind the closeout — name it played; on
    // overrun it is cut off and stays unplayed.
    this.fileEpisodeOutcome(kind, kind !== 'overrun' && soundingStoryId ? [soundingStoryId] : []);
    this.deps.onEvent?.('route_plan_ended', { kind, owed: this.owed, questions: this.questionsAnsweredCount });
    this.notify();
  }

  /**
   * Phase-2 Q&A (Passenger/Walking only — the generator dep is
   * the gate: no generator, no question). Returns false when a
   * question is already in flight (one at a time, like freeform),
   * when the tour is over, or when Q&A is not wired. The current
   * plan item is never cut: the answer inserts at the head of the
   * promised FIFO and plays when the current item settles, ahead
   * of the next unplayed plan item. Nothing re-plans.
   */
  submitQuestion(raw: string): boolean {
    const question = raw.trim();
    if (!question || !this.plan || this.closed || this.endedKind !== null || this.heldStart) return false;
    if (!this.deps.generateAnswer || this.qaPhase !== 'idle') return false;
    this.qaPhase = 'generating';
    this.deps.onEvent?.('question_asked', {
      question: question.slice(0, 500),
      ...(this.deps.answerModelLabel ? { model: this.deps.answerModelLabel } : {}),
    });
    void this.runAnswer(question);
    this.notify();
    return true;
  }

  private async runAnswer(question: string): Promise<void> {
    let text: string;
    try {
      const current = this.player.snapshot().currentLabel;
      const lastLine = current ? ` The story playing now is "${current}".` : '';
      text = await this.deps.generateAnswer!(
        `QUESTION FROM THE LISTENER: ${question}\n\nThe listener is on a planned drive to ${this.plan?.destinationName ?? 'their destination'} in San Diego County, hearing stories tiled along the route.${lastLine}`,
      );
    } catch {
      // Generation failed: release the lock, plan untouched —
      // freeform's grace machinery is engine business, not the
      // runner's; a dumb immediate release is the route rule.
      this.qaPhase = 'idle';
      this.notify();
      return;
    }
    if (this.closed || this.endedKind !== null) {
      // The tour ended while the answer was being made; there is
      // no queue left to join and nothing to file against.
      this.qaPhase = 'idle';
      return;
    }
    let url: string;
    try {
      url = await this.deps.synthUrl(text);
    } catch {
      this.qaPhase = 'idle';
      this.notify();
      return;
    }
    if (this.closed || this.endedKind !== null) {
      this.qaPhase = 'idle';
      return;
    }
    const item: AudibleItem = {
      id: `route-answer-${++runnerSeq}`,
      kind: 'answer',
      label: `Answer — ${question.slice(0, 60)}`,
      source: { kind: 'url', url },
      durationSec: estimateDurationSec(text),
      attempts: 0,
      settled: false,
      onSettle: rec => {
        this.deps.onEvent?.('question_playback', {
          completed: rec.completed,
          voice: rec.sounded ? 'gemini' : 'none',
          sounded_ms: Math.round(rec.soundedMs),
          attempts: item.attempts,
        });
        if (rec.sounded) this.questionsAnsweredCount += 1;
        this.qaPhase = 'idle';
        this.notify();
      },
    };
    this.qaPhase = 'answering';
    this.player.enqueueNext(item);
    this.notify();
  }

  /** User ends the route: teardown, no sign-off line, owed state kept if already set. */
  endTour(): void {
    // An End Tour on a tour that actually began still concludes
    // a drive (addendum 2): file its record from the standing
    // accounting before teardown. A never-begun plan (the
    // manifest hold, backed out of) concludes nothing and files
    // nothing; a tour already closed out filed its record there.
    if (this.begun && this.plan && !this.closed) {
      const unplayed = this.plan.items
        .filter(it => it.kind === 'story' && it.unit && !this.playedStoryIds.has(it.unit.id))
        .map(it => it.unit as LibraryUnit);
      this.writeDriveRecord(unplayed);
    }
    // Episode capture (Nov 4, 2026): a user end files the
    // outcome row whenever a plan exists — begun (the drive's
    // partial accounting) or backed out of the manifest card
    // unbegun (played empty, end 'user-ended'). A tour that
    // already closed out filed its row in close(); the
    // once-guard makes this a no-op there.
    if (this.plan) this.fileEpisodeOutcome('user-ended');
    this.endedKind = this.endedKind ?? 'user-ended';
    this.closed = true;
    this.player.teardown();
    this.notify();
  }
}
