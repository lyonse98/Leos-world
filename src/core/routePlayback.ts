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
  decideCloseout,
  estimateDurationSec,
  hasArrived,
  isOffCorridor,
  owedLine,
  progressAlongPath,
  type GeoPoint,
  type LibraryUnit,
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
   * Composer v3 (commit D): the plan-time narration has fully
   * settled — every preview, bridge, and generated gap-story
   * render has succeeded OR fallen back (the skip-fallback
   * design means a failure settles too; readiness can never
   * hang on one), and the wrap-up was settled by the App
   * before staging. The manifest card's primary button reads
   * this flag: disabled 'Generating tour…' until it turns
   * true, then enabled 'Start tour'.
   */
  narrationReady: boolean;
}

/**
 * The manifest card's primary button, derived from the
 * runner view (composer v3, commit D — Erik's copy): honest
 * about the preparation phase, and live only when everything
 * the plan needs has settled.
 */
export function routeStartButtonState(view: { narrationReady: boolean }): {
  label: string;
  disabled: boolean;
} {
  return view.narrationReady
    ? { label: 'Start tour', disabled: false }
    : { label: 'Generating tour…', disabled: true };
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

export interface RouteRunnerDeps {
  audio: AudioPort;
  /** Synthesize text → playable blob URL (App wires gemini.synthesizeSpeech). */
  synthUrl: (text: string) => Promise<string>;
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
}

let runnerSeq = 0;

export class RoutePlanRunner {
  private player: Player;
  private deps: RouteRunnerDeps;
  private plan: RoutePlan | null = null;
  private listeners = new Set<() => void>();
  private playedStoryIds = new Set<string>();
  /** Rendered plan items in plan order (render failures never land here — skip-fallback). */
  private rendered: { planItem: PlanItem; audible: AudibleItem }[] = [];
  /** Next rendered entry the feed gate will consider. Entry 0 is begun directly by start(). */
  private feedIndex = 0;
  /** Rendered entries resolved: settled after feeding, or dropped stale / bridge-orphaned at the gate. The exhaustion numerator. */
  private resolvedCount = 0;
  /** Stories dropped at the feed gate for an expired window (their outgoing bridges are skipped too). */
  private droppedStoryIds = new Set<string>();
  /**
   * The departure story's rendered entry — the first story to
   * render (consolidation §2). It keeps the standing item-1
   * exemption at the feed gate: the preview item holds slot 1
   * now, but the departure story behind it still begins when
   * the runner reaches it — never held by its release window,
   * never dropped stale at the gate — exactly the treatment
   * slot 1 had when the departure story WAS the first item.
   * (When there is no preview, the departure story is begun
   * directly and the gate never evaluates it at all.)
   */
  private departureEntry: { planItem: PlanItem; audible: AudibleItem } | null = null;
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
  private renderingDone = false;
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
        const entry = next ? this.rendered.find(e => e.audible.id === next.id) : undefined;
        return routeInterItemGapMs({
          closing: this.closing || this.closed,
          lastSettled: this.lastSettle,
          next: next
            ? {
                planItem: entry !== undefined,
                expireProgress: entry?.planItem.expireProgress ?? null,
                departure: entry !== undefined && entry === this.departureEntry,
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
      narrationReady: this.plan !== null && this.renderingDone,
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
    this.player.teardown();
  }

  /**
   * Plan-time render of every item. The first playable item
   * begins at once (it is the audio prime carrier, and it must
   * start as close to the user's tap as possible — the departure
   * story is exempt from window gating by construction: the
   * plan starts where the driver is). The rest render into the
   * held list while it plays; the feed gate (maybeFeed) releases
   * them under the anchored-release rules. A bridge whose render
   * fails never lands in the held list (skip-fallback) — it can
   * never wedge the gate, and playback goes straight into the
   * next Miles story when its window opens.
   */
  async start(plan: RoutePlan): Promise<void> {
    await this.renderPlan(plan, true);
  }

  /**
   * Manifest hold (differentiator 3): render the whole plan
   * exactly as start() does, but BEGIN nothing — the tour
   * screen is showing the plan's episode card, and the runner
   * must not consume story windows while the listener reads
   * it. beginStaged() — the card's Start tour tap — is
   * what sets the plan in motion.
   */
  async stage(plan: RoutePlan): Promise<void> {
    this.heldStart = true;
    const rendering = this.renderPlan(plan, false);
    // Surface the hold at once (composer v3, commit D): the
    // manifest card must be visible WHILE the plan-time
    // narration renders settle — renderPlan's synchronous
    // prefix has already taken the plan, so this notify
    // publishes phase 'ready' with narrationReady still
    // false, and the card's button sits disabled on
    // 'Generating tour…' until the settle notify below.
    this.notify();
    await rendering;
    this.notify();
  }

  /**
   * The manifest card's Start tour tap. The tap IS a user
   * gesture, so it re-primes first, through the same noteGesture
   * path the awaiting state uses — if the build tap's prime was
   * refused, this tap gives item 1 a fresh carrier inside a live
   * gesture window. Then item 1 begins and the feed gate takes
   * over; any window the driver already passed while the card
   * was up is handled by the dumb guards exactly as if they had
   * set off early (drop stale, owe it at the closeout).
   */
  beginStaged(): void {
    if (!this.heldStart || this.closed || this.endedKind !== null) return;
    this.heldStart = false;
    this.player.noteGesture(this.heldFirstItem());
    if (this.rendered.length === 0) return; // an empty staged plan already ended in renderPlan
    const first = this.rendered[0];
    this.player.beginWithItem(first.audible);
    this.begun = true;
    this.feedIndex = 1;
    this.filePlanStarted();
    this.maybeFeed();
    this.maybeExhaust();
    this.notify();
  }

  /**
   * Plan-time render of every item. With beginFirst, the first
   * playable item begins as soon as it renders (start()'s
   * standing behavior); without it, everything renders into the
   * held list and nothing sounds (the manifest hold). A bridge
   * whose render fails never lands in the held list either way.
   */
  private async renderPlan(plan: RoutePlan, beginFirst: boolean): Promise<void> {
    if (this.startStamp === null) this.startStamp = Date.now();
    this.plan = plan;
    for (const it of plan.items) {
      if (this.closed) break; // a closeout landed mid-render: stop building a dead plan
      const item = await this.toAudibleItem(it);
      // Preview telemetry (consolidation §2): the preview item
      // rendered, or it didn't — a failed preview never wedges
      // the plan; the departure story simply becomes item 1.
      if (it.kind === 'preview') {
        this.deps.onEvent?.('route_preview', { preview: item ? 'generated' : 'failed' });
      }
      if (!item) continue; // render failure → dropped, never wedged
      const entry = { planItem: it, audible: item };
      this.rendered.push(entry);
      if (it.kind === 'story' && !this.departureEntry) this.departureEntry = entry;
      if (beginFirst && !this.begun) {
        this.player.beginWithItem(item);
        this.begun = true;
        this.feedIndex = 1;
      }
      this.maybeFeed();
    }
    this.renderingDone = true;
    if (this.rendered.length === 0) {
      // Empty plan (all heard / nothing near the route): the
      // handoff line is still owed — never dead air, never a
      // silent screen. The App treats this as an overrun tail.
      // The accounting finalizes here too (addendum 2): every
      // plan story is unplayed, hence owed.
      this.writeDriveRecord(
        plan.items.filter(it => it.kind === 'story' && it.unit).map(it => it.unit as LibraryUnit),
      );
      this.heldStart = false;
      this.freeformTailFlag = true;
      this.endedKind = 'overrun';
      this.closeoutDoneFlag = true;
      this.notify();
      return;
    }
    if (!beginFirst) return; // staged: route_plan_started files at beginStaged, when the tour actually starts
    this.filePlanStarted();
    this.maybeFeed();
    this.maybeExhaust();
    this.notify();
  }

  private filePlanStarted(): void {
    const plan = this.plan;
    if (!plan) return;
    this.deps.onEvent?.('route_plan_started', {
      destination: plan.destinationName,
      items: this.rendered.length,
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
      },
    });
  }

  /**
   * The anchored-release feed gate. The Player starts whatever
   * sits in its promised FIFO the moment the current item
   * settles, so anything enqueued is effectively RELEASED: the
   * gate therefore keeps the FIFO empty and considers the head
   * held entry only —
   *   - a bridge whose parent story was dropped stale is
   *     skipped silently (it names ground never heard);
   *   - a geographic story past its expire progress is dropped
   *     stale (story_dropped, reason 'stale-window'); a story
   *     before its release progress HOLDS the gate — the Player
   *     idles on bridges/fillers already played, never on the
   *     story sounded early (the departure story is exempt from
   *     both rules: it opens the drive, behind the preview item
   *     or in slot 1 itself — see departureEntry);
   *   - everything else (bridges, reactions, fillers, portal
   *     stories) feeds.
   * Feeding one entry can empty the FIFO instantly (an idle
   * Player takes it as current), so the loop re-checks.
   */
  private maybeFeed(): void {
    if (!this.plan || this.closed || this.closing || !this.begun) return;
    while (this.feedIndex < this.rendered.length) {
      if (this.player.promised.length > 0) return;
      const entry = this.rendered[this.feedIndex];
      const it = entry.planItem;
      if (it.kind === 'bridge' && it.prevUnitId && this.droppedStoryIds.has(it.prevUnitId)) {
        this.feedIndex += 1;
        this.resolvedCount += 1;
        continue;
      }
      if (it.kind === 'story' && !it.portal && entry !== this.departureEntry) {
        const release = it.releaseProgress ?? 0;
        const expire = it.expireProgress ?? Number.POSITIVE_INFINITY;
        if (this.lastProgress > expire) {
          this.feedIndex += 1;
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
      this.player.enqueuePromised(entry.audible);
      this.feedIndex += 1;
    }
    this.maybeExhaust();
  }

  /** Plan exhaustion, evaluated only once rendering is done (items still rendering are not yet countable). */
  private maybeExhaust(): void {
    if (!this.renderingDone || this.closed) return;
    if (this.resolvedCount < this.rendered.length) return;
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
    // Manifest hold (differentiator 3): while the episode card
    // is up, a position update refreshes the progress reading
    // only — no arrival closeout, no corridor pause, no window
    // feed. The guards evaluate from the Start tour tap
    // onward, against the progress the driver actually reached.
    if (this.heldStart) return;
    // Arrival check first: it outranks the corridor guard.
    if (!this.arrivedFlag && hasArrived(pos, this.plan.destination, this.plan.path)) {
      this.arrivedFlag = true;
      const exhausted = this.renderingDone && this.resolvedCount >= this.rendered.length;
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
      ? this.rendered.find(e => e.audible.id === this.player.current!.id)
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
      this.feedIndex >= this.rendered.length && unplayed.every(u => u.id === soundingStoryId);
    const useWrapUp = kind !== 'overrun' && planRanOut && plan.wrapUp != null;
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
        // sign-off on the completion path only — its audio was
        // rendered at preparation, so this is no new live call.
        // Every other close speaks today's line, synthesized
        // exactly as before.
        const url = useWrapUp ? plan.wrapUp!.audioUrl : await this.deps.synthUrl(closeout.line);
        this.player.enqueuePromised({
          id: `route-close-${++runnerSeq}`,
          kind: 'greeting',
          label: useWrapUp ? 'Wrap-up' : closeout.kind === 'overrun' ? 'Handoff' : 'Sign-off',
          source: { kind: 'url', url },
          durationSec: useWrapUp ? estimateDurationSec(plan.wrapUp!.text) : 8,
          attempts: 0,
          settled: false,
          onSettle: rec => {
            if (useWrapUp && rec.sounded) {
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
    this.endedKind = this.endedKind ?? 'user-ended';
    this.closed = true;
    this.player.teardown();
    this.notify();
  }
}
