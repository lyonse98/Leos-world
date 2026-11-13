// Episode capture (Nov 4, 2026) — observation only.
//
// Every generated route episode is persisted, in full, to the
// route_episodes table (see ~/workspace/leos-world/
// route-episodes-capture.sql) so the words themselves can be
// analyzed offline: bridge repetition, preview honesty, thread
// coherence, the Forward Criteria on generated pieces, a
// verbal-tic census, seam analysis. The sims grade an episode's
// SHAPE; this is the instrument that grades its TEXT.
//
// Two append-only rows per episode, joined by tour_id:
//   kind 'plan'    — written when the OPENING SETTLES (the
//                    spoken preview + first bridge are rendered
//                    and the Start gate is ready — Erik's
//                    render-ahead ruling, Nov 4, 2026), even if
//                    the tour never starts, so stationary tests
//                    are captured too. EVERY live text already
//                    exists at that moment: bridge, preview and
//                    wrap-up texts are authored deterministically
//                    from plan facts at compose time, and gap
//                    stories are generated before handover —
//                    only speech synthesis is pipelined, never
//                    text generation. So the plan row is
//                    textually complete; rendering outcomes ride
//                    the outcome row.
//   kind 'outcome' — written at tour close by whatever path
//                    ends the tour (arrival, overrun, user
//                    end): what actually played, what was
//                    dropped and why, the end reason, the
//                    driven/stationary discriminator, and (schema
//                    2) a per-item render result for every plan
//                    item plus the wrap-up: 'pre-start' (audio in
//                    hand when the tour began — or at opening
//                    settle for a tour that never began), 'ahead'
//                    (rendered after the tour began, before its
//                    moment), 'skipped-late' (its moment arrived
//                    first; the story sounds without it, bridges
//                    are never load-bearing), 'failed' (synthesis
//                    errored), 'pending' (still in flight when
//                    the tour closed). Reconstruction rule: an
//                    item was HEARD iff its index is in the
//                    outcome's played list; anything else in the
//                    plan row was not heard, with dropped[]
//                    saying why the feed passed it and
//                    render_results[] saying how its render went.
//                    Schema 2 outcomes may also carry
//                    commissions[] (drop coherence, Nov 4,
//                    2026): the re-bridges the runner authored
//                    at drive time when a story dropped stale —
//                    pseudo-items, like the wrap-up, since they
//                    are not plan items and the plan row (which
//                    files before any drop can happen) never
//                    names them. Their full text rides here —
//                    the outcome row is the only place these
//                    words exist in the record.
// No UPDATE anywhere: a row is written once or not at all.
//
// Schema 1 rows (written before the render-ahead pipeline)
// predate render_results entirely: their plan rows filed at
// full settle, when every piece was already rendered or
// dropped, so `rendered` there means the whole render pass.
//
// This module is PURE assembly (plus one injectable deliver
// helper) — no backend, no network. The App and the runner
// supply the facts; this module shapes them. Capture can
// never change behavior: every send is failure-swallowed by
// construction (deliverEpisodeCapture never throws, and the
// backend insert behind it swallows its own failures too).

import { haversineM, type GeoPoint, type PlanItem, type RoutePlan } from './routeMode';

/** Build-context facts the App knows and the plan doesn't carry. */
export interface EpisodeCaptureContext {
  /** The declared mode at the Build tap: tourMode verbatim ('driving' | 'passenger'). */
  declaredMode: string;
  /** The parsed destination text the listener asked for. */
  destinationText: string;
  /** The requested tone after the UI/parser merge (null = none). */
  tone: string | null;
  /** The requested topics after the UI/parser merge. */
  topics: string[];
  /** The build's audience coloring (Nov 5, 2026): 'standard' | 'family', after the UI merge. */
  audience: string;
  /**
   * Build stage durations, ms — the boundaries the Nov 4
   * resilience build made visible: the maps stage (tap →
   * route computed, with geocode/routes sub-marks), the
   * compose stage (route computed → plan fixed and the render
   * queue starts), the recording stage (plan fixed → the
   * OPENING settled: preview + first bridge rendered, Start
   * ready — the remaining pieces keep rendering ahead of the
   * listener and ride the outcome row's render_results), and
   * the total (tap → opening settled). This doubles as the
   * field build-latency dataset.
   */
  stageTimingsMs: {
    geocode: number | null;
    routes: number | null;
    maps: number;
    compose: number;
    recording: number;
    total: number;
    /**
     * Settle sub-stages (Nov 6, 2026 — field fix, lane B;
     * additive, optional: pre-split assemblies omit them).
     * The Nov 6 slow build's plan row could only say
     * "compose: 271 s" — these split the settle-path compose
     * window so the next slow build is attributable from the
     * capture alone: fetch = the library/heard read phase
     * inside compose; fill = the Coverage Guarantee's shelf
     * pass inside compose. The live extras that used to hide
     * inside compose (gap generation, generated color) no
     * longer run there at all — see extrasDeferred and the
     * route_extras telemetry event for their timings.
     */
    fetch?: number | null;
    fill?: number | null;
  };
  /**
   * Settle-path split (Nov 6, 2026; additive): true when the
   * build deferred its live extras (gap-story generation,
   * generated Color Puck) behind the opening — their timings
   * and outcomes ride the route_extras telemetry event, not
   * this row, because they complete after it files.
   */
  extrasDeferred?: boolean;
  /** When the build settled (epoch ms). */
  settledAtMs: number;
}

/** The normalized episode vocabulary the analysis reads. */
export type CapturedItemKind =
  | 'story'
  | 'intro'
  | 'filler'
  | 'bridge'
  | 'preview'
  | 'wrap_up'
  | 'gap_fill'
  | 'signoff'
  | 'handoff'
  // Planned silence (Nov 11, 2026): composed air — carries
  // text: null by design and must never normalize to 'story'.
  | 'silence';

export interface CapturedItem {
  /** Position in the plan, 0-based (the wrap-up rides last). */
  index: number;
  /** Normalized kind (see captureKindFor). */
  kind: CapturedItemKind;
  /** The plan's own kind, verbatim — nothing is lost in normalization. */
  planKind: string;
  /** Plan item id (unit id for library items). */
  id: string;
  placeKey: string | null;
  placeName: string | null;
  angle: string | null;
  /** Library unit id (place_key|angle), when the item is a library row. */
  unitId: string | null;
  /** Woven member / woven twin telling (off-route, host register). */
  woven: boolean;
  /** Portal story (off-corridor, tied to a parent) or portal climax. */
  portal: boolean;
  /** The plan's designated climax. */
  climax: boolean;
  /**
   * Who speaks the piece (audience coloring, Nov 5, 2026):
   * 'color-puck' on a Color Puck piece (a reaction-slot,
   * aside, or closeout beat authored under the color
   * prompt); null on everything else — Miles solo is the
   * absence of a mark, exactly as the plan carries it.
   */
  voice: string | null;
  /**
   * Humor pieces only (Unfiltered, Nov 6, 2026; additive —
   * schema stays 2): this color piece was drawn from the
   * reviewed humor bank, and humorBankId names the line.
   * False/null on everything else — generated Color Puck
   * pieces are never humor, by the ruling.
   */
  humor: boolean;
  humorBankId: string | null;
  /**
   * Short cuts (Nov 12, 2026; additive — schema stays 2):
   * which VERSION of the story this item serves. 'short'
   * when the item plays the story's short cut, 'full' for
   * every other story/filler item — always present, like
   * woven, rather than optional. versionOf is the BASE unit
   * id when version is 'short', else null: the item's own
   * unitId carries the served (twin) id, so versionOf is
   * the join key that pairs the two lengths in analysis.
   */
  version: 'full' | 'short';
  versionOf: string | null;
  /**
   * Audio in hand when the plan row was filed (at opening
   * settle). False no longer means dropped: under the
   * render-ahead pipeline the piece may still render ahead of
   * its moment — the outcome row's render_results[] carries
   * the final verdict for every item.
   */
  rendered: boolean;
  /** Bridges/reactions: the subjects joined (from → to), by place name when known. */
  fromSubject: string | null;
  toSubject: string | null;
  /** The item's own duration estimate, seconds. */
  durationSec: number;
  /**
   * Scheduled sounding window in drive seconds, mirroring the
   * Coverage Guarantee's interval model (soundingSpans):
   * windowed stories sound across [release, expire] × drive;
   * windowless stories at their anchor for their duration.
   * Null for tissue (bridges, reactions, the preview, the
   * wrap-up), which sounds by plan order, not by ground.
   */
  windowStartSec: number | null;
  windowEndSec: number | null;
  /** Composed position: cumulative duration of every item before this one, seconds. */
  sequenceStartSec: number;
  /** The FULL text as served — library rows verbatim, live pieces as generated. */
  text: string | null;
  /** Where the text came from: a shelf row, or generated live for this episode. */
  textSource: 'library' | 'live' | null;
  /** Wrap-up only: it sounds only on an arrival with the plan run out. */
  conditional?: string;
}

const INTRO_ANGLES = new Set(['neighborhood_intro', 'neighborhood_intro_greet']);
/**
 * Generated gap stories are shelved under a fresh audio key
 * carrying one of these suffixes — the standing marker, and
 * (audience coloring, Nov 5, 2026) the family marker a
 * Family-generated story is promoted under. Both name the
 * same provenance: a Coverage Guarantee generation.
 */
const GAP_AUDIO_MARKERS = ['-route-gap-v1', '-route-gap-fam-v1'];

/**
 * The normalized kind. Derivations, all from durable markers
 * on the served artifact (the plan kind rides alongside,
 * verbatim, so a derivation can always be re-cut):
 *   - a story whose audio key carries -route-gap-v1 was
 *     generated by the Coverage Guarantee for this road →
 *     'gap_fill';
 *   - a story on a neighborhood-intro angle is a demoted
 *     welcome serving as guarantee fill → 'intro';
 *   - a reaction is a Miles-solo voice line, the bridge
 *     family → 'bridge'.
 */
export function captureKindFor(item: PlanItem): CapturedItemKind {
  switch (item.kind) {
    case 'story': {
      const audioPath = item.unit?.audioPath ?? '';
      if (GAP_AUDIO_MARKERS.some(m => audioPath.includes(m))) return 'gap_fill';
      if (item.unit && INTRO_ANGLES.has(item.unit.angle)) return 'intro';
      return 'story';
    }
    case 'filler':
      return 'filler';
    case 'bridge':
    case 'reaction':
      return 'bridge';
    case 'preview':
      return 'preview';
    case 'signoff':
      return 'signoff';
    case 'handoff':
      return 'handoff';
    case 'silence':
      return 'silence';
    default:
      return 'story';
  }
}

/** Total path length, meters (the outcome's distance denominator). */
export function pathLengthM(path: GeoPoint[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) total += haversineM(path[i], path[i + 1]);
  return total;
}

/**
 * The plan's items, in order, fully self-contained — plus the
 * wrap-up as a trailing pseudo-item (id 'wrap-up'; it is a
 * plan-level field, not a PlanItem, but it is part of the
 * episode as served when its gate opens). renderedItemIds is
 * the runner's audio-in-hand set at the moment the plan row is
 * filed (opening settle): an item absent from it was still
 * rendering or had failed — the outcome row's render_results[]
 * carries each item's final verdict, so nothing is lost.
 */
export function assemblePlanItems(plan: RoutePlan, renderedItemIds: ReadonlySet<string>): CapturedItem[] {
  const driveSec = plan.driveSec ?? plan.budgetSec;
  const subjectByUnitId = new Map<string, string>();
  for (const it of plan.items) {
    if (it.unit) subjectByUnitId.set(it.unit.id, it.unit.placeName);
  }
  const out: CapturedItem[] = [];
  let sequence = 0;
  plan.items.forEach((it, index) => {
    const isTissue = it.kind === 'bridge' || it.kind === 'reaction' || it.kind === 'preview';
    let windowStartSec: number | null = null;
    let windowEndSec: number | null = null;
    if (!isTissue && it.unit && (it.kind === 'story' || it.kind === 'filler')) {
      const anchorSec = (it.anchorProgress ?? 0) * driveSec;
      const start = it.releaseProgress !== undefined ? it.releaseProgress * driveSec : anchorSec;
      const end = it.expireProgress !== undefined ? it.expireProgress * driveSec : start + it.durationSec;
      windowStartSec = Math.round(Math.max(0, Math.min(driveSec, start)) * 10) / 10;
      windowEndSec = Math.round(Math.max(0, Math.min(driveSec, end)) * 10) / 10;
    }
    const isLibrary = it.unit != null && (it.kind === 'story' || it.kind === 'filler');
    out.push({
      index,
      kind: captureKindFor(it),
      planKind: it.kind,
      id: it.id,
      placeKey: it.unit?.placeKey ?? null,
      placeName: it.unit?.placeName ?? null,
      angle: it.unit?.angle ?? null,
      unitId: it.unit?.id ?? null,
      woven: it.woven === true,
      portal: it.portal === true || it.portalClimax === true,
      climax: it.climax === true,
      voice: it.voice ?? null,
      humor: it.humor === true,
      humorBankId: it.humorBankId ?? null,
      version: it.shortCut === true ? 'short' : 'full',
      versionOf: it.shortCut === true ? (it.versionOf ?? null) : null,
      rendered: renderedItemIds.has(it.id),
      fromSubject: it.prevUnitId ? (subjectByUnitId.get(it.prevUnitId) ?? null) : null,
      toSubject: it.nextUnitId ? (subjectByUnitId.get(it.nextUnitId) ?? null) : null,
      durationSec: it.durationSec,
      windowStartSec,
      windowEndSec,
      sequenceStartSec: Math.round(sequence * 10) / 10,
      text: isLibrary ? (it.unit?.storyText ?? null) : (it.text ?? null),
      textSource: isLibrary ? 'library' : it.text != null ? 'live' : null,
    });
    sequence += it.durationSec;
  });
  if (plan.wrapUp) {
    out.push({
      index: out.length,
      kind: 'wrap_up',
      planKind: 'wrap_up',
      id: 'wrap-up',
      placeKey: null,
      placeName: null,
      angle: null,
      unitId: null,
      woven: false,
      portal: false,
      climax: false,
      voice: null,
      humor: false,
      humorBankId: null,
      version: 'full',
      versionOf: null,
      rendered: renderedItemIds.has('wrap-up'),
      fromSubject: null,
      toSubject: null,
      durationSec: 0,
      windowStartSec: null,
      windowEndSec: null,
      sequenceStartSec: Math.round(sequence * 10) / 10,
      text: plan.wrapUp.text,
      textSource: 'live',
      conditional: 'arrival-plan-ran-out',
    });
  }
  return out;
}

/** One road the Routes call returned, as the plan payload files it (route choice, Nov 5, 2026). */
export interface CapturedRouteAlternative {
  description: string | null;
  duration_sec: number;
  distance_m: number;
  route_labels: string[];
}

/** The kind='plan' row payload. */
export interface RouteEpisodePlanPayload {
  schema: 2;
  tour_id: string;
  build_id: string;
  /** Declared mode, spec vocabulary: 'driving' | 'passenger-walking'. */
  mode: string;
  /** Declared mode verbatim from the landing's mode pills. */
  declared_mode: string;
  destination_text: string;
  destination_name: string;
  tone: string | null;
  topics: string[];
  /**
   * Audience coloring (Nov 5, 2026; additive — schema stays
   * 2): the rating this episode was built under, and how
   * many Color Puck pieces the plan carries (their full
   * texts ride items[] with voice 'color-puck'; the outcome
   * row's played[] says which of them actually sounded).
   * Zero in every Family plan — the color prompt never runs
   * there.
   */
  audience: string;
  color_pieces: number;
  /**
   * Humor layer (Nov 6, 2026; additive — schema stays 2):
   * how many of the plan's color pieces were bank draws, and
   * their line ids in plan order — the draw's audit trail
   * (draw discipline is judged from these fields, not from
   * the items alone). Zero/empty in every build until the
   * reviewed bank lands, and in every Standard/Family build.
   */
  humor_pieces: number;
  humor_bank_ids: string[];
  /**
   * Short cuts (Nov 12, 2026; additive — schema stays 2):
   * how many of the plan's story items serve a short cut —
   * the density rule's draw at plan level, auditable
   * against the items' own version fields.
   */
  short_cut_pieces: number;
  budget_sec: number;
  route_duration_sec: number | null;
  route_distance_m: number;
  /**
   * Route choice (Nov 5, 2026; additive — schema stays 2):
   * every road the build could have composed on, in response
   * order ([0] is the default route). route_picked_index
   * indexes this array — the road the episode composed on;
   * route_picker_shown says whether the driver was actually
   * asked (a genuine fork) or the default simply proceeded.
   * Empty offered = the plan carries no route-choice record
   * (grader worlds, pre-choice assemblies).
   */
  route_alternatives_offered: CapturedRouteAlternative[];
  route_picker_shown: boolean;
  route_picked_index: number;
  /**
   * Thread menu (Nov 5, 2026; additive — schema stays 2):
   * the threads this drive could actually carry, in menu
   * order (class, key, label, honest cast count), whether the
   * listener was asked (menu shown), how the final thread was
   * arrived at (thread_source: 'menu-pick' | 'default-
   * detected' | 'single-qualifier' | 'none'), and the final
   * thread itself (topic + label + anchor class + key) or
   * null. Empty offered + 'none' = the plan carries no menu
   * record (legacy blind-pick assemblies) or no thread
   * qualified.
   */
  thread_alternatives_offered: { kind: string; key: string; label: string; count: number }[];
  thread_menu_shown: boolean;
  thread_source: string;
  thread_final: { topic: string | null; label: string; anchor_kind: string; anchor_key: string } | null;
  /**
   * Tone suggestion (Nov 7, 2026; additive — schema stays 2):
   * the tones this drive's cast could actually lean on, in
   * menu order (tone + honest geo-cast count), whether the
   * listener was asked (the seam card carried a tone section),
   * how the final tone was arrived at (tone_source: 'detected'
   * | 'prose' | 'menu_pick' | 'none'), and the final tone the
   * build composed with (null = no lean — byte-for-byte the
   * old no-tone behavior). Empty offered + 'none' + null = the
   * plan carries no tone record (pre-suggestion assemblies) or
   * no tone qualified and no prose tone was read.
   */
  tone_alternatives_offered: { tone: string; castCount: number }[];
  tone_menu_shown: boolean;
  tone_source: string;
  tone_final: string | null;
  /** The route_plan_started event payload, verbatim — decisions and all. */
  route_plan_started: Record<string, unknown>;
  items: CapturedItem[];
  stage_timings_ms: EpisodeCaptureContext['stageTimingsMs'];
  /**
   * Settle-path split (Nov 6, 2026; additive — schema stays
   * 2): the build deferred its live extras behind the
   * opening (see the context's extrasDeferred). Color pieces
   * adopted late are not in items[] — they were not plan
   * items when this row filed; route_extras telemetry is
   * their record.
   */
  extras_deferred: boolean;
  settled_at_ms: number;
}

export function assemblePlanCapture(args: {
  tourId: string;
  buildId: string;
  context: EpisodeCaptureContext;
  plan: RoutePlan;
  routePlanStarted: Record<string, unknown>;
  items: CapturedItem[];
}): RouteEpisodePlanPayload {
  const { context, plan } = args;
  return {
    schema: 2,
    tour_id: args.tourId,
    build_id: args.buildId,
    mode: context.declaredMode === 'driving' ? 'driving' : 'passenger-walking',
    declared_mode: context.declaredMode,
    destination_text: context.destinationText,
    destination_name: plan.destinationName,
    tone: context.tone,
    topics: context.topics,
    audience: context.audience,
    color_pieces: args.items.filter(i => i.voice === 'color-puck').length,
    humor_pieces: args.items.filter(i => i.humor).length,
    humor_bank_ids: args.items.filter(i => i.humor && i.humorBankId).map(i => i.humorBankId as string),
    short_cut_pieces: args.items.filter(i => i.version === 'short').length,
    budget_sec: plan.budgetSec,
    route_duration_sec: plan.driveSec,
    route_distance_m: Math.round(pathLengthM(plan.path)),
    route_alternatives_offered: (plan.routeChoice?.offered ?? []).map(o => ({
      description: o.description,
      duration_sec: o.durationSec,
      distance_m: o.distanceMeters,
      route_labels: [...o.routeLabels],
    })),
    route_picker_shown: plan.routeChoice?.pickerShown ?? false,
    route_picked_index: plan.routeChoice?.pickedIndex ?? 0,
    thread_alternatives_offered: (plan.threadMenu?.offered ?? []).map(o => ({
      kind: o.kind,
      key: o.key,
      label: o.label,
      count: o.count,
    })),
    thread_menu_shown: plan.threadMenu?.menuShown ?? false,
    thread_source: plan.threadMenu?.source ?? 'none',
    thread_final: plan.thread
      ? {
          topic: plan.thread.topic,
          label: plan.thread.label ?? plan.thread.topic ?? '',
          anchor_kind: plan.thread.anchorKind ?? 'topic',
          anchor_key: plan.thread.anchorKey ?? plan.thread.topic ?? '',
        }
      : null,
    tone_alternatives_offered: (plan.toneMenu?.offered ?? []).map(o => ({
      tone: o.tone,
      castCount: o.castCount,
    })),
    tone_menu_shown: plan.toneMenu?.menuShown ?? false,
    tone_source: plan.toneMenu?.source ?? 'none',
    // The seam record's settled tone wins when one exists (it
    // is the menu's own account); otherwise the capture
    // context's tone — the tone the build ran with — is the
    // final tone (pre-suggestion assemblies, harness worlds).
    tone_final: plan.toneMenu?.pickedTone ?? context.tone ?? null,
    route_plan_started: args.routePlanStarted,
    items: args.items,
    stage_timings_ms: context.stageTimingsMs,
    extras_deferred: context.extrasDeferred ?? false,
    settled_at_ms: context.settledAtMs,
  };
}

// ------------------------------------------------------------ outcome

/** The runner's own accounting, supplied at tour close. */
export interface EpisodeOutcomeAccounting {
  endReason: string;
  /** The tour actually began (false = a settled plan backed out of). */
  begun: boolean;
  /** Plan items in order (ids are the join key into the plan row's items). */
  planItemIds: string[];
  /** Item ids that SOUNDED, in the order they sounded. */
  playedItemIds: string[];
  /** Item id → settle record for items that settled without sounding (skip, abandon). */
  settledUnplayed: ReadonlyMap<string, { skipped: boolean }>;
  /** Story item ids dropped stale at the feed gate. */
  droppedStaleItemIds: ReadonlySet<string>;
  /**
   * Per-drop reason overrides for gate drops that are not
   * the plain stale-window kind (field fix F3, Nov 12, 2026:
   * 'late-presence' — a story dropped because its presence
   * window had effectively passed, so the next field read
   * can tell the two defect classes apart).
   */
  dropReasons?: ReadonlyMap<string, string>;
  /** Bridge item ids the gate skipped because their parent story was dropped. */
  gateSkippedItemIds: ReadonlySet<string>;
  /** Item ids that never rendered (skip-fallback at plan time). */
  unrenderedItemIds: ReadonlySet<string>;
  /**
   * Tissue item ids the feed gate late-skipped (schema 2,
   * optional: older accounting shapes omit it). Their moment
   * arrived before their render; the story sounded without
   * them.
   */
  lateSkippedItemIds?: ReadonlySet<string>;
  /**
   * Per-item render verdicts for every plan item plus the
   * wrap-up pseudo-item, in plan order (schema 2, optional).
   * Supplied by the runner at close; see CapturedRenderResult.
   */
  renderResults?: CapturedRenderResult[];
  /**
   * Re-bridge commissions fired (or cap-blocked) at drive
   * time when stories dropped stale (drop coherence, Nov 4,
   * 2026; optional — accountings that predate the mechanism
   * omit it). Supplied by the runner at close; see
   * CapturedCommission.
   */
  commissions?: CapturedCommission[];
  /**
   * Bridge items whose render failed and whose seam fell
   * back (field fix F5, Nov 12, 2026; optional — accountings
   * that predate the fallback omit it). Plan item ids; the
   * fallback FORM rides the items' own seamFallback marks in
   * the runner's telemetry (route_bridge_fallback).
   */
  seamFallbackItemIds?: readonly string[];
  /** Ms from plan-fix until the render queue drained (null = never drained before close). */
  queueDrainedMs?: number | null;
  /** Heard recording: story unit ids that sounded (the ledger's own list). */
  heardUnitIds: string[];
  /** Movement evidence for the driven/stationary call. */
  maxDisplacementM: number;
  maxProgressFraction: number;
  pathLengthM: number;
  endedAtMs: number;
}

export interface CapturedDrop {
  /** Index into the plan row's items array. */
  index: number;
  id: string;
  /**
   * 'stale-window' | 'parent-dropped' | 'skipped-late'
   * (schema 2: its render was not in hand when its moment
   * arrived; playback continued without it) | 'render-failed' |
   * 'skipped' (settled without sounding — a user skip and a
   * close-time abandon are indistinguishable at this seam) |
   * 'unplayed' (never fed, never settled when the tour ended).
   */
  reason: string;
}

/** One render-ahead verdict, as recorded on the outcome row. */
export interface CapturedRenderResult {
  /** Index into the plan row's items array (the wrap-up rides last). */
  index: number;
  /** Plan item id ('wrap-up' for the wrap-up pseudo-item). */
  id: string;
  /**
   * 'pre-start' — audio in hand when the tour began (or at
   * opening settle for a tour that never began);
   * 'ahead' — rendered after the tour began, before its moment;
   * 'skipped-late' — its moment arrived first; never sounded;
   * 'failed' — synthesis errored; 'pending' — still in flight
   * when the tour closed (a very early close; the piece's text
   * is still complete in the plan row).
   */
  result: 'pre-start' | 'ahead' | 'skipped-late' | 'failed' | 'pending';
}

/**
 * One re-bridge commission (drop coherence, Nov 4, 2026): when
 * a windowed story dropped stale — judged doomed ahead of its
 * lead-in bridge (suppression) or dropped at the feed gate —
 * the runner commissioned ONE replacement bridge from the
 * last story that actually sounded into the next viable
 * story, authored at drive time through the narration seam
 * from true facts only (the dropped story is never named in
 * it). The commission is a pseudo-item: not a plan item, so
 * it never appears in played[]/dropped[]/render_results[];
 * this record is its whole trace, text included.
 */
export interface CapturedCommission {
  /** 'rebridge:<dropped story item id>><next story item id>'; a cap-blocked commission is 'rebridge-cap:<dropped story item id>'. */
  id: string;
  /** The dropped story whose transition the commission repairs. */
  for_story_id: string;
  /** The story the text speaks FROM (unit id): the last sounded story, or the departure story when none had sounded yet. Null only on a cap-blocked record (never authored). */
  prev_story_id: string | null;
  /** The story the commission leads INTO. */
  next_story_id: string;
  /** How the drop happened: 'suppression' (judged doomed before its lead-in bridge fed) or 'gate' (dropped at the feed gate). */
  via: 'suppression' | 'gate';
  /** The authored text, complete. Null only when the per-tour cap blocked the commission before authoring. */
  text: string | null;
  /**
   * 'sounded' — it played, as the next story's incoming
   * bridge; 'skipped-late' — discarded unsounded: still
   * rendering when its moment arrived (the story sounded
   * without it), or itself suppressed when its target story
   * was judged doomed before it could sound; 'failed' —
   * synthesis errored; 'discarded-cap' — the per-tour
   * commission cap blocked it before authoring; 'pending' —
   * no verdict by tour close (rendered but its moment never
   * came, or still in flight at an early close).
   */
  result: 'sounded' | 'skipped-late' | 'failed' | 'discarded-cap' | 'pending';
}

/** The kind='outcome' row payload. */
export interface RouteEpisodeOutcomePayload {
  schema: 2;
  tour_id: string;
  build_id: string;
  end_reason: string;
  begun: boolean;
  /** Indexes into the plan row's items, in the order they sounded. */
  played: number[];
  played_item_ids: string[];
  dropped: CapturedDrop[];
  /** Per-item render verdicts (schema 2); empty when the accounting predates them. */
  render_results: CapturedRenderResult[];
  /** Re-bridge commissions (drop coherence); empty when none fired — and on rows that predate the field. */
  commissions: CapturedCommission[];
  /** Bridge items that sounded via the render-failure seam fallback (field fix F5); empty when none — and on rows that predate the field. */
  seam_fallbacks: string[];
  /** Ms from plan-fix until the render queue drained; null if it never did before close. */
  render_queue_drained_ms: number | null;
  heard_unit_ids: string[];
  max_displacement_m: number;
  max_progress_fraction: number;
  distance_along_route_m: number;
  path_length_m: number;
  /** The discriminator: a real drive moves; a stationary test doesn't. */
  driven: boolean;
  ended_at_ms: number;
}

/** Displacement at or beyond this (meters) means the device actually went somewhere. */
export const DRIVEN_DISPLACEMENT_MIN_M = 100;

export function assembleOutcomeCapture(
  tourId: string,
  buildId: string,
  acc: EpisodeOutcomeAccounting,
): RouteEpisodeOutcomePayload {
  const indexById = new Map(acc.planItemIds.map((id, i) => [id, i]));
  const playedSet = new Set(acc.playedItemIds);
  const played = acc.playedItemIds
    .map(id => indexById.get(id))
    .filter((i): i is number => i !== undefined);
  const dropped: CapturedDrop[] = [];
  acc.planItemIds.forEach((id, index) => {
    if (playedSet.has(id)) return;
    let reason: string;
    if (acc.droppedStaleItemIds.has(id)) reason = acc.dropReasons?.get(id) ?? 'stale-window';
    else if (acc.gateSkippedItemIds.has(id)) reason = 'parent-dropped';
    else if (acc.lateSkippedItemIds?.has(id)) reason = 'skipped-late';
    else if (acc.unrenderedItemIds.has(id)) reason = 'render-failed';
    else if (acc.settledUnplayed.has(id)) reason = 'skipped';
    else reason = 'unplayed';
    dropped.push({ index, id, reason });
  });
  const maxDisplacementM = Math.round(acc.maxDisplacementM);
  return {
    schema: 2,
    tour_id: tourId,
    build_id: buildId,
    end_reason: acc.endReason,
    begun: acc.begun,
    played,
    played_item_ids: [...acc.playedItemIds],
    dropped,
    render_results: acc.renderResults ? [...acc.renderResults] : [],
    commissions: acc.commissions ? [...acc.commissions] : [],
    seam_fallbacks: acc.seamFallbackItemIds ? [...acc.seamFallbackItemIds] : [],
    render_queue_drained_ms: acc.queueDrainedMs ?? null,
    heard_unit_ids: [...acc.heardUnitIds],
    max_displacement_m: maxDisplacementM,
    max_progress_fraction: Math.round(acc.maxProgressFraction * 1000) / 1000,
    distance_along_route_m: Math.round(acc.maxProgressFraction * acc.pathLengthM),
    path_length_m: Math.round(acc.pathLengthM),
    driven: maxDisplacementM >= DRIVEN_DISPLACEMENT_MIN_M,
    ended_at_ms: acc.endedAtMs,
  };
}

// ------------------------------------------------------------ delivery

export interface EpisodeCaptureRow {
  tourId: string;
  kind: 'plan' | 'outcome';
  buildId: string;
  payload: Record<string, unknown>;
}

/**
 * The one send path. The insert is injected (the App wires
 * backend.captureRouteEpisode, which itself swallows); this
 * helper adds the contract the App relies on: it NEVER
 * throws, and onFailure fires exactly when the row did not
 * land (insert resolved false or threw) — the App turns that
 * into at most one route_episode_capture_failed event per
 * build. Awaiting it is optional; nothing downstream of a
 * capture may depend on its result.
 */
export async function deliverEpisodeCapture(args: {
  insert: (row: EpisodeCaptureRow) => Promise<boolean>;
  row: EpisodeCaptureRow;
  onFailure: () => void;
}): Promise<void> {
  let ok = false;
  try {
    ok = await args.insert(args.row);
  } catch {
    ok = false;
  }
  if (!ok) {
    try {
      args.onFailure();
    } catch {
      /* the failure signal is best-effort too */
    }
  }
}
