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
// Phase 2 (Nov 3, 2026): Q&A for Passenger/Walking route tours.
// The runner accepts an answer generator ONLY when the App's
// declared-mode gate is open (driving tours never receive one, so
// the pipeline is unreachable there — not merely unrendered).
// A question never re-plans anything: the current plan item
// finishes, the answer plays next (head of the promised FIFO via
// Player.enqueueNext), and the plan resumes at the next unplayed
// item. One question at a time, mirroring freeform's lock.

import { Player, type AudibleItem, type AudioPort, systemClock } from './player';
import { bucketUrl } from './backend';
import {
  decideCloseout,
  estimateDurationSec,
  hasArrived,
  isOffCorridor,
  owedLine,
  type GeoPoint,
  type LibraryUnit,
  type PlanItem,
  type RoutePlan,
} from './routeMode';

export interface RouteRunnerView {
  phase: 'idle' | 'playing' | 'ended';
  nowPlaying: { label: string; kind: string } | null;
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
  private settledPlanItems = 0;
  /** Items actually enqueued (bridge render failures drop before enqueue, so this — not the plan length — is the exhaustion denominator). */
  private enqueuedCount = 0;
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

  constructor(deps: RouteRunnerDeps) {
    this.deps = deps;
    this.player = new Player(deps.audio, systemClock, {
      resolveUrl: async item => (item.source.kind === 'url' ? item.source.url : ''),
      stallSource: () => null,
      emit: (type, payload) => deps.onEvent?.(type, payload),
      onFirstLatch: () => undefined,
      onPrimeCarrierFailed: () => undefined,
      onLatchLost: () => undefined,
      onLatchRestored: () => undefined,
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
    return {
      phase: this.plan === null ? 'idle' : this.endedKind !== null ? 'ended' : 'playing',
      nowPlaying: snap.currentLabel ? { label: snap.currentLabel, kind: snap.currentKind ?? '' } : null,
      userPaused: this.userPausedFlag,
      guardPaused: this.guardPausedFlag,
      owed: this.owed,
      endedKind: this.endedKind,
      freeformTail: this.freeformTailFlag,
      closeoutDone: this.closeoutDoneFlag,
      qaPhase: this.qaPhase,
      questionsAnswered: this.questionsAnsweredCount,
    };
  }

  /**
   * Plan-time bridge render + queue build. The first playable
   * item begins at once (it is the audio prime carrier, and it
   * must start as close to the user's tap as possible); the rest
   * render while it plays and enqueue as they resolve. A bridge
   * whose render fails is dropped before enqueue (skip-fallback)
   * — it never reaches the queue, so playback goes straight
   * into the next Miles story.
   */
  async start(plan: RoutePlan): Promise<void> {
    this.plan = plan;
    let started = false;
    for (const it of plan.items) {
      const item = await this.toAudibleItem(it);
      if (!item) continue; // render failure → dropped, never wedged
      if (!started) {
        this.player.beginWithItem(item);
        started = true;
      } else {
        this.player.enqueuePromised(item);
      }
      this.enqueuedCount += 1;
    }
    this.renderingDone = true;
    if (!started) {
      // Empty plan (all heard / nothing near the route): the
      // handoff line is still owed — never dead air, never a
      // silent screen. The App treats this as an overrun tail.
      this.freeformTailFlag = true;
      this.endedKind = 'overrun';
      this.closeoutDoneFlag = true;
      this.notify();
      return;
    }
    this.deps.onEvent?.('route_plan_started', {
      destination: plan.destinationName,
      items: this.enqueuedCount,
      budget_sec: plan.budgetSec,
    });
    this.maybeExhaust();
    this.notify();
  }

  /** Plan exhaustion, evaluated only once rendering is done (bridges still rendering are not yet countable). */
  private maybeExhaust(): void {
    if (!this.renderingDone || this.closed) return;
    if (this.settledPlanItems < this.enqueuedCount) return;
    if (this.arrivedFlag) {
      void this.close('arrival-signoff');
    } else {
      void this.close('overrun');
    }
  }

  private async toAudibleItem(it: PlanItem): Promise<AudibleItem | null> {
    const id = `route-${++runnerSeq}`;
    const onSettle = (rec: { sounded: boolean }) => this.onItemSettle(it, rec.sounded);
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

  private onItemSettle(it: PlanItem, sounded: boolean): void {
    if (it.kind === 'story' && it.unit && sounded) {
      this.playedStoryIds.add(it.unit.id);
      this.deps.onStoryHeard?.(it.unit);
    }
    if (this.closing) return; // settles caused by the closeout itself
    this.settledPlanItems += 1;
    this.maybeExhaust();
    this.notify();
  }

  /** GPS feed (App's usePosition already drives this). Dumb guards only. */
  onPosition(pos: GeoPoint): void {
    if (!this.plan || this.closed) return;
    // Arrival check first: it outranks the corridor guard.
    if (!this.arrivedFlag && hasArrived(pos, this.plan.destination, this.plan.path)) {
      this.arrivedFlag = true;
      const exhausted = this.renderingDone && this.settledPlanItems >= this.enqueuedCount;
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
    // next corridor return via onPosition.
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

  noteGesture(): void {
    this.player.noteGesture(null);
  }

  bannerTap(): void {
    this.player.noteGesture(null);
  }

  private async close(kind: 'arrival-owed' | 'arrival-signoff' | 'overrun'): Promise<void> {
    if (!this.plan || this.closed) return;
    this.closed = true;
    this.closing = true;
    const plan = this.plan;
    const unplayed = plan.items
      .filter(it => it.kind === 'story' && it.unit && !this.playedStoryIds.has(it.unit.id))
      .map(it => it.unit as LibraryUnit);
    const closeout = decideCloseout({
      arrived: kind !== 'overrun',
      planExhausted: kind !== 'arrival-owed',
      unplayedPlanUnits: unplayed,
      unheardShelfUnits: plan.shelfTease ? [plan.shelfTease] : [],
    });
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
        const url = await this.deps.synthUrl(closeout.line);
        this.player.enqueuePromised({
          id: `route-close-${++runnerSeq}`,
          kind: 'greeting',
          label: closeout.kind === 'overrun' ? 'Handoff' : 'Sign-off',
          source: { kind: 'url', url },
          durationSec: 8,
          attempts: 0,
          settled: false,
          onSettle: () => {
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
    if (!question || !this.plan || this.closed || this.endedKind !== null) return false;
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
    this.endedKind = this.endedKind ?? 'user-ended';
    this.closed = true;
    this.player.teardown();
    this.notify();
  }
}
