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
//   kind 'plan'    — written when the build SETTLES (the
//                    manifest card is up / narration ready),
//                    even if the tour never starts, so
//                    stationary tests are captured too;
//   kind 'outcome' — written at tour close by whatever path
//                    ends the tour (arrival, overrun, user
//                    end): what actually played, what was
//                    dropped and why, the end reason, and the
//                    driven/stationary discriminator.
// No UPDATE anywhere: a row is written once or not at all.
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
  /**
   * Build stage durations, ms — the boundaries the Nov 4
   * resilience build made visible: the maps stage (tap →
   * route computed, with geocode/routes sub-marks), the
   * compose stage (route computed → live renders begin), the
   * recording stage (live renders begin → settle), and the
   * total. This doubles as the field build-latency dataset.
   */
  stageTimingsMs: {
    geocode: number | null;
    routes: number | null;
    maps: number;
    compose: number;
    recording: number;
    total: number;
  };
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
  | 'handoff';

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
  /** Rendered successfully at plan time (false = skip-fallback dropped it before anything played). */
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
/** Generated gap stories are shelved under a fresh audio key carrying this suffix. */
const GAP_AUDIO_MARKER = '-route-gap-v1';

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
      if (audioPath.includes(GAP_AUDIO_MARKER)) return 'gap_fill';
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
 * wrap-up as a trailing pseudo-item (it is a plan-level field,
 * not a PlanItem, but it is part of the episode as served when
 * its gate opens). renderedItemIds is the runner's rendered
 * set: an item absent from it was dropped by skip-fallback
 * before anything played, and the outcome row will say so.
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
      rendered: true,
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

/** The kind='plan' row payload. */
export interface RouteEpisodePlanPayload {
  schema: 1;
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
  budget_sec: number;
  route_duration_sec: number | null;
  route_distance_m: number;
  /** The route_plan_started event payload, verbatim — decisions and all. */
  route_plan_started: Record<string, unknown>;
  items: CapturedItem[];
  stage_timings_ms: EpisodeCaptureContext['stageTimingsMs'];
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
    schema: 1,
    tour_id: args.tourId,
    build_id: args.buildId,
    mode: context.declaredMode === 'driving' ? 'driving' : 'passenger-walking',
    declared_mode: context.declaredMode,
    destination_text: context.destinationText,
    destination_name: plan.destinationName,
    tone: context.tone,
    topics: context.topics,
    budget_sec: plan.budgetSec,
    route_duration_sec: plan.driveSec,
    route_distance_m: Math.round(pathLengthM(plan.path)),
    route_plan_started: args.routePlanStarted,
    items: args.items,
    stage_timings_ms: context.stageTimingsMs,
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
  /** Bridge item ids the gate skipped because their parent story was dropped. */
  gateSkippedItemIds: ReadonlySet<string>;
  /** Item ids that never rendered (skip-fallback at plan time). */
  unrenderedItemIds: ReadonlySet<string>;
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
   * 'stale-window' | 'parent-dropped' | 'render-failed' |
   * 'skipped' (settled without sounding — a user skip and a
   * close-time abandon are indistinguishable at this seam) |
   * 'unplayed' (never fed, never settled when the tour ended).
   */
  reason: string;
}

/** The kind='outcome' row payload. */
export interface RouteEpisodeOutcomePayload {
  schema: 1;
  tour_id: string;
  build_id: string;
  end_reason: string;
  begun: boolean;
  /** Indexes into the plan row's items, in the order they sounded. */
  played: number[];
  played_item_ids: string[];
  dropped: CapturedDrop[];
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
    if (acc.droppedStaleItemIds.has(id)) reason = 'stale-window';
    else if (acc.gateSkippedItemIds.has(id)) reason = 'parent-dropped';
    else if (acc.unrenderedItemIds.has(id)) reason = 'render-failed';
    else if (acc.settledUnplayed.has(id)) reason = 'skipped';
    else reason = 'unplayed';
    dropped.push({ index, id, reason });
  });
  const maxDisplacementM = Math.round(acc.maxDisplacementM);
  return {
    schema: 1,
    tour_id: tourId,
    build_id: buildId,
    end_reason: acc.endReason,
    begun: acc.begun,
    played,
    played_item_ids: [...acc.playedItemIds],
    dropped,
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
