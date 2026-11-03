// Route mode (v16.1, static) — Erik's Nov 2, 2026 ruling: route mode
// is the true MVP. This module is the whole route-mode core that
// does NOT depend on the freeform engine: the composer, the GPS
// guards, the arrival closeout, and the plan-time bridge rules.
//
// Deliberate seams, so v15 freeform behavior is byte-identical when
// route mode is off or not chosen:
//   - Nothing in src/core/tour.ts is imported or modified here.
//   - The freeform engine never sees a RoutePlan; the App mounts
//     the route runner only after the user chooses a route tour.
//   - Phase 2 (Q&A behind the declared mode) reads its ruling
//     from routeQaAvailable()/qaGateOpen() below; the App mounts
//     question surfaces only when the gate is open, and the route
//     runner receives its answer generator only then.
//
// Budget discipline: the only live calls this module makes are the
// ones that build one route — one Gemini parse (with a local-parse
// fallback, so a parse failure never blocks a build), one Places
// text search for the destination, one Routes computeRoutes call.
// No live calls happen at import time, in tests, or in the harness.

export type TourMode = 'passenger' | 'driving';

/** Phase-2 ruling (Erik, Nov 2, 2026; activated Nov 3): Q&A is
 *  available in Passenger/Walking and unavailable in Driving.
 *  The gate reads the DECLARED mode only — never inferred speed
 *  or movement. */
export function routeQaAvailable(mode: TourMode): boolean {
  return mode === 'passenger';
}

/**
 * The full Q&A gate the App layer enforces (v16 phase 2): the
 * route-mode flag must be on AND the declared mode must be
 * Passenger/Walking. Flag off means no mode was ever declared
 * (the v15 landing has no mode box), so Q&A stays off there too —
 * the gate is closed by construction, not by a second switch.
 */
export function qaGateOpen(flagEnabled: boolean, mode: TourMode): boolean {
  return flagEnabled && routeQaAvailable(mode);
}

/**
 * Feature flag. On the v16-route-mode branch it defaults ON so
 * Erik's branch-switch publish shows the mode box with no env
 * fiddling; VITE_ROUTE_MODE=0 (or 'false') restores the exact v15
 * landing (no mode box, no intake form). The flag is read once in
 * App.tsx, never inside the engine.
 */
export function isRouteModeEnabled(envValue: string | undefined): boolean {
  if (envValue === undefined) return true;
  const v = envValue.trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface RouteInput {
  /** Raw plain-language destination text from the intake form. */
  destinationText: string;
  /** Optional time-of-arrival, epoch ms. Null = tile to the drive. */
  arrivalTimeMs: number | null;
  /** Per-trip mood, from the closed tone vocabulary (or null). */
  tone: string | null;
  /** Requested topics (tag vocabulary, e.g. 'Food & Drink'). */
  topics: string[];
}

export interface ParsedRouteInput {
  destinationText: string;
  arrivalTimeMs: number | null;
  tone: string | null;
  topics: string[];
}

export const ROUTE_TONES = ['warm', 'reflective', 'light', 'grand', 'somber', 'reverent', 'spooky'] as const;

/** Topic vocabulary, derived from story-tags.csv (Nov 1 tagging). */
export const ROUTE_TOPICS = [
  'Boom & Bust',
  'Coast',
  'Navy Century',
  'Food & Drink',
  'Sport',
  'Film',
  'Border / CaliBaja',
  'Deep Time',
  'Music',
  'Flight',
  'San Diego River',
  'Water',
  'Highway',
  'folklore',
  'Faith',
  'Desert',
  'Fire & Fault',
  'Rail',
  'Mission Chain',
  'Surf',
  'The Cure',
  'Expositions & the Canal',
] as const;

// ------------------------------------------------------------ geometry

export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const R = 6371e3;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Distance from a point to a polyline segment, metres (equirectangular approx, fine at corridor scale). */
function pointSegmentM(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const kx = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)) * 111320;
  const ky = 111320;
  const px = p.lng * kx;
  const py = p.lat * ky;
  const ax = a.lng * kx;
  const ay = a.lat * ky;
  const bx = b.lng * kx;
  const by = b.lat * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Distance from a point to a whole route path, metres. */
export function distanceToPathM(p: GeoPoint, path: GeoPoint[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return haversineM(p, path[0]);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length - 1; i++) {
    best = Math.min(best, pointSegmentM(p, path[i], path[i + 1]));
  }
  return best;
}

/**
 * Route progress of a point: the fraction of the path length at the
 * point's nearest projection (0 = origin, 1 = destination). Used to
 * tile stories in drive order, not popularity order.
 */
export function progressAlongPath(p: GeoPoint, path: GeoPoint[]): number {
  if (path.length < 2) return 0;
  let total = 0;
  const segLens: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const l = haversineM(path[i], path[i + 1]);
    segLens.push(l);
    total += l;
  }
  if (total === 0) return 0;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = pointSegmentM(p, path[i], path[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      bestProgress = (acc + segLens[i] / 2) / total;
    }
    acc += segLens[i];
  }
  return Math.max(0, Math.min(1, bestProgress));
}

/** Google encoded-polyline decoder (Routes API overview polyline). */
export function decodePolyline(encoded: string): GeoPoint[] {
  const pts: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}

// ------------------------------------------------------------ input parsing

const TONE_WORDS: Record<string, string> = {
  warm: 'warm',
  cozy: 'warm',
  reflective: 'reflective',
  thoughtful: 'reflective',
  light: 'light',
  fun: 'light',
  funny: 'light',
  grand: 'grand',
  epic: 'grand',
  somber: 'somber',
  sad: 'somber',
  reverent: 'reverent',
  sacred: 'reverent',
  spooky: 'spooky',
  ghost: 'spooky',
  haunted: 'spooky',
};

const TOPIC_WORDS: Record<string, string> = {
  food: 'Food & Drink',
  tacos: 'Food & Drink',
  restaurant: 'Food & Drink',
  navy: 'Navy Century',
  military: 'Navy Century',
  coast: 'Coast',
  beach: 'Coast',
  surf: 'Surf',
  music: 'Music',
  film: 'Film',
  movie: 'Film',
  ghost: 'folklore',
  folklore: 'folklore',
  haunted: 'folklore',
  faith: 'Faith',
  church: 'Faith',
  mission: 'Mission Chain',
  sport: 'Sport',
  soccer: 'Sport',
  baseball: 'Sport',
  flight: 'Flight',
  aviation: 'Flight',
  train: 'Rail',
  rail: 'Rail',
  desert: 'Desert',
  fire: 'Fire & Fault',
  earthquake: 'Fire & Fault',
  border: 'Border / CaliBaja',
  mexico: 'Border / CaliBaja',
  highway: 'Highway',
  water: 'Water',
  river: 'San Diego River',
};

/**
 * Local plain-language parse (the fallback when Gemini is
 * unavailable, and the harness reference implementation):
 * strips a leading "to / drive to / take me to", pulls an
 * "arrive by / by <time>" clause into an epoch, and maps tone /
 * topic words onto the closed vocabularies. Never throws.
 */
export function parseRouteInputLocal(raw: string, nowMs: number): ParsedRouteInput {
  const text = raw.trim();
  let rest = text.replace(/^(take me to|drive to|go to|head to|to)\s+/i, '').trim();
  let arrivalTimeMs: number | null = null;
  const byMatch = rest.match(/\b(?:arrive\s+by|by)\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i);
  if (byMatch) {
    let hour = parseInt(byMatch[1], 10);
    const min = byMatch[2] ? parseInt(byMatch[2], 10) : 0;
    const ap = byMatch[3].toLowerCase();
    if (ap === 'p' && hour < 12) hour += 12;
    if (ap === 'a' && hour === 12) hour = 0;
    const d = new Date(nowMs);
    d.setHours(hour, min, 0, 0);
    let t = d.getTime();
    if (t <= nowMs) t += 24 * 60 * 60 * 1000; // already passed today → tomorrow
    arrivalTimeMs = t;
    rest = rest.replace(byMatch[0], '').replace(/\s+/g, ' ').trim().replace(/[,;]$/, '');
  }
  const lower = rest.toLowerCase();
  let tone: string | null = null;
  for (const [word, mapped] of Object.entries(TONE_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      tone = mapped;
      break;
    }
  }
  const topics: string[] = [];
  for (const [word, mapped] of Object.entries(TOPIC_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower) && !topics.includes(mapped)) topics.push(mapped);
  }
  // A trailing comma clause ("Balboa Park, spooky ghost stories")
  // is a mood/topic note, not part of the destination pin.
  const destinationText = rest.split(',')[0].trim() || rest;
  return { destinationText, arrivalTimeMs, tone, topics };
}

// ------------------------------------------------------------ library units + composer

/** Angles that are NOT tileable route stories (welcomes + filler lanes). */
export const NON_STORY_ANGLES = new Set([
  'neighborhood_intro',
  'neighborhood_intro_greet',
  'filler',
  'filler_hosted',
]);

export interface LibraryUnit {
  /** place_key + '|' + angle — the composer's heard key. */
  id: string;
  placeKey: string;
  placeName: string;
  angle: string;
  lat: number;
  lng: number;
  /** Seconds of audio (word-count estimate from story_text when known). */
  durationSec: number;
  topics: string[];
  tone: string | null;
  toneSecondary: string | null;
  /** Bucket audio path, when the row carries one (library rows do). */
  audioPath: string | null;
  storyText: string | null;
}

/** Spoken English ≈ 150 wpm; a shelf story's duration estimate. */
export function estimateDurationSec(text: string | null, fallbackSec = 150): number {
  if (!text) return fallbackSec;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return fallbackSec;
  return Math.max(20, Math.round((words / 150) * 60));
}

export type PlanItemKind = 'story' | 'bridge' | 'reaction' | 'filler' | 'signoff' | 'handoff';

export interface PlanItem {
  kind: PlanItemKind;
  /** Story unit id, or a synthetic id for bridges/reactions. */
  id: string;
  label: string;
  durationSec: number;
  /** For stories: the unit. For bridges: the pair it joins. */
  unit?: LibraryUnit;
  prevUnitId?: string;
  nextUnitId?: string;
  /** Bridge text (pair-specific, composed at plan time). */
  text?: string;
  /** False when its plan-time render failed → skip-fallback drops it. */
  ready: boolean;
}

export interface RoutePlan {
  destinationName: string;
  destination: GeoPoint;
  path: GeoPoint[];
  /** Drive-time estimate from Routes, seconds (null when unknown). */
  driveSec: number | null;
  /** Tiling budget, seconds (arrival budget, else drive time). */
  budgetSec: number;
  items: PlanItem[];
  totalSec: number;
  /** Stories the plan deliberately skipped (heard / non-story). */
  skippedHeard: number;
  topicsMatched: boolean;
  toneMatched: boolean;
  /**
   * Optional shelf tease for the arrival-signoff closeout, set by
   * the App after composing (an unheard, unplanned shelf unit).
   * The pure composer cannot know the shelf beyond its inputs.
   */
  shelfTease?: LibraryUnit | null;
}

export interface ComposeOptions {
  nowMs: number;
  /** Heard keys (place_key|angle); unplayed units stay unheard — never serve heard stories. */
  heardKeys: Set<string>;
  /** Max stories in one plan (keeps a plan build bounded). */
  maxStories?: number;
  /** Hosted-filler units available as budget spackle (angle filler_hosted). */
  fillerUnits?: LibraryUnit[];
  /**
   * Finite tiling budget for the no-arrival case (the caller passes
   * budgetSecFor(parsed, now, driveSec) — tile to the drive time).
   * When absent and no arrival time is set, the plan fills to
   * maxStories; callers should always pass it.
   */
  budgetSecOverride?: number;
}

/**
 * ONE static composition pass at departure (v16.1: no re-planning,
 * no live bridge generation). Library-first tiling:
 *  1. drop heard units and non-story angles — never served, ever;
 *  2. prefer topic matches, then tone matches, in ROUTE order
 *     (progress along the path), not popularity order;
 *  3. fill greedily until the budget is covered; a story that
 *     would overshoot the budget by more than its own length is
 *     skipped in favour of a shorter fit, and hosted filler
 *     spackles a remainder under 60 s;
 *  4. pair-specific bridges between consecutive stories, composed
 *     here at plan time; a bridge whose render fails is dropped
 *     by applyBridgeFallback (skip straight into the next story);
 *  5. the pre-rendered reaction bank, sparingly: at most one
 *     reaction per three stories, at planned points only.
 * The plan is a value, not a promise: nothing here touches the
 * network, so the harness can prove every invariant offline.
 */
export function composeRoutePlan(
  units: LibraryUnit[],
  path: GeoPoint[],
  destination: GeoPoint,
  destinationName: string,
  input: ParsedRouteInput,
  opts: ComposeOptions,
): RoutePlan {
  const maxStories = opts.maxStories ?? 40;
  const corridor: LibraryUnit[] = [];
  let skippedHeard = 0;
  for (const u of units) {
    if (NON_STORY_ANGLES.has(u.angle)) continue;
    if (opts.heardKeys.has(u.id)) {
      skippedHeard += 1;
      continue;
    }
    // Corridor membership: within 1.5 km of the path (generous —
    // the shelf is place-anchored, not path-anchored), or the
    // destination itself.
    const near = distanceToPathM({ lat: u.lat, lng: u.lng }, path) <= 1500;
    if (!near && haversineM({ lat: u.lat, lng: u.lng }, destination) > 1500) continue;
    corridor.push(u);
  }

  const topicSet = new Set(input.topics);
  const topicMatches = topicSet.size > 0 ? corridor.filter(u => u.topics.some(t => topicSet.has(t))) : [];
  const pool = topicMatches.length > 0 ? topicMatches : corridor;
  const topicsMatched = topicMatches.length > 0;

  // Route order first; within equal progress, tone matches first.
  const ordered = [...pool].sort((a, b) => {
    const pa = progressAlongPath({ lat: a.lat, lng: a.lng }, path);
    const pb = progressAlongPath({ lat: b.lat, lng: b.lng }, path);
    if (Math.abs(pa - pb) > 0.02) return pa - pb;
    const ta = input.tone && (a.tone === input.tone || a.toneSecondary === input.tone) ? 0 : 1;
    const tb = input.tone && (b.tone === input.tone || b.toneSecondary === input.tone) ? 0 : 1;
    return ta - tb;
  });

  // Budget: arrival budget when given, else the caller-supplied
  // drive-time budget (budgetSecFor); without either, maxStories
  // is the only cap.
  const budgetSec =
    input.arrivalTimeMs !== null
      ? Math.max(60, Math.round((input.arrivalTimeMs - opts.nowMs) / 1000))
      : (opts.budgetSecOverride ?? Number.POSITIVE_INFINITY);

  const chosen: LibraryUnit[] = [];
  let total = 0;
  for (const u of ordered) {
    if (chosen.length >= maxStories) break;
    if (Number.isFinite(budgetSec)) {
      if (total >= budgetSec) break;
      // Overshoot guard: skip a story that would blow the budget
      // by more than half again; a shorter later story may fit.
      if (total + u.durationSec > budgetSec * 1.5 && chosen.length > 0) continue;
    }
    chosen.push(u);
    total += u.durationSec;
  }

  // Hosted-filler spackle: a remainder under 60 s gets one filler
  // rather than a story that cannot fit — never dead air, never a
  // clipped story.
  const fillers = (opts.fillerUnits ?? []).filter(f => !opts.heardKeys.has(f.id));
  if (Number.isFinite(budgetSec) && fillers.length > 0 && total < budgetSec && budgetSec - total < 60) {
    const f = fillers[0];
    chosen.push(f);
    total += f.durationSec;
  }

  const toneMatched =
    input.tone !== null && chosen.some(u => u.tone === input.tone || u.toneSecondary === input.tone);

  // Interleave plan-time bridges + sparing reactions.
  const items: PlanItem[] = [];
  let storiesSinceReaction = 0;
  chosen.forEach((u, i) => {
    // Bridges join story → story only: a filler spackle gets no
    // pair bridge (it is not a place the bridge can name).
    if (i > 0 && u.angle !== 'filler_hosted' && chosen[i - 1].angle !== 'filler_hosted') {
      const prev = chosen[i - 1];
      items.push({
        kind: 'bridge',
        id: `bridge:${prev.id}>${u.id}`,
        label: `Bridge — ${prev.placeName} to ${u.placeName}`,
        durationSec: 8,
        prevUnitId: prev.id,
        nextUnitId: u.id,
        text: bridgeTextFor(prev, u),
        ready: true,
      });
    }
    items.push({
      kind: u.angle === 'filler_hosted' ? 'filler' : 'story',
      id: u.id,
      label: u.placeName,
      durationSec: u.durationSec,
      unit: u,
      ready: true,
    });
    storiesSinceReaction += 1;
    if (storiesSinceReaction >= 3 && i < chosen.length - 1) {
      const reaction = REACTION_BANK[(Math.floor(i / 3)) % REACTION_BANK.length];
      items.push({
        kind: 'reaction',
        id: `reaction:${i}`,
        label: 'Reaction',
        durationSec: estimateDurationSec(reaction),
        text: reaction,
        ready: true,
      });
      storiesSinceReaction = 0;
    }
  });

  const totalSec = items.reduce((s, it) => s + it.durationSec, 0);
  return {
    destinationName,
    destination,
    path,
    driveSec: null,
    budgetSec: Number.isFinite(budgetSec) ? budgetSec : totalSec,
    items,
    totalSec,
    skippedHeard,
    topicsMatched,
    toneMatched,
  };
}

/** Pair-specific bridge text, composed at plan time, Miles-solo. */
export function bridgeTextFor(prev: LibraryUnit, next: LibraryUnit): string {
  return `From ${prev.placeName} we keep rolling — just ahead is ${next.placeName}, and it has its own story to tell.`;
}

/** Pre-rendered reaction bank lines (Miles-solo, voice-only — no music, no archival stingers). */
export const REACTION_BANK: string[] = [
  'Still with me? Good. This county just keeps unfolding.',
  'Plenty of road left. Plenty of stories on it, too.',
  'I could drive these roads every day and still find something new.',
];

/**
 * Bridge skip-fallback: a bridge whose plan-time render failed
 * (ready === false) is dropped outright — playback goes straight
 * into the next Miles story. Never a retry, never a live fallback.
 */
export function applyBridgeFallback(plan: RoutePlan): RoutePlan {
  const items = plan.items.filter(it => !(it.kind === 'bridge' && !it.ready));
  return { ...plan, items, totalSec: items.reduce((s, it) => s + it.durationSec, 0) };
}

/** Budget helper for the no-arrival case: tile to the drive time. */
export function budgetSecFor(input: ParsedRouteInput, nowMs: number, driveSec: number | null): number {
  if (input.arrivalTimeMs !== null) return Math.max(60, Math.round((input.arrivalTimeMs - nowMs) / 1000));
  return driveSec !== null ? Math.max(60, driveSec) : 1800;
}

// ------------------------------------------------------------ GPS guards + closeout

/** Corridor tolerance for the dumb guards: 200 m off the path. */
export const CORRIDOR_TOLERANCE_M = 200;
/** Arrival radius around the destination pin. */
export const ARRIVAL_RADIUS_M = 250;

export function isOffCorridor(pos: GeoPoint, path: GeoPoint[]): boolean {
  return distanceToPathM(pos, path) > CORRIDOR_TOLERANCE_M;
}

export function hasArrived(pos: GeoPoint, destination: GeoPoint, path: GeoPoint[]): boolean {
  if (haversineM(pos, destination) <= ARRIVAL_RADIUS_M) return true;
  return progressAlongPath(pos, path) >= 0.99;
}

export type CloseoutKind = 'arrival-owed' | 'arrival-signoff' | 'overrun' | null;

export interface Closeout {
  kind: Exclude<CloseoutKind, null>;
  /** Spoken line for the closeout (sign-off or handoff). */
  line: string;
  /** The specific next-ride tease, when one exists (shelf-aware: a unit, not a summary). */
  teaseUnitId: string | null;
  teaseLabel: string | null;
  /** Overrun only: the freeform engine resumes the tail. */
  freeformTail: boolean;
}

/**
 * Arrival closeout (v16.1): the owed item triggers on ARRIVAL,
 * not on plan end.
 *  - arrived + plan items remain → 'arrival-owed': sign-off now,
 *    the first unplayed plan item becomes the owed tease;
 *  - arrived + plan exhausted → 'arrival-signoff': sign-off plus
 *    a specific unheard, unplanned shelf unit as the tease;
 *  - plan exhausted + not arrived → 'overrun': handoff line and
 *    the freeform tail resumes — never dead air, never silence;
 *  - otherwise → null (the plan keeps playing).
 * The tease is carried as a line/state ('Miles owes you'), NOT a
 * summary screen — App renders it as one landing line post-tour.
 */
export function decideCloseout(args: {
  arrived: boolean;
  planExhausted: boolean;
  unplayedPlanUnits: LibraryUnit[];
  unheardShelfUnits: LibraryUnit[];
}): Closeout | null {
  const { arrived, planExhausted, unplayedPlanUnits, unheardShelfUnits } = args;
  if (arrived && !planExhausted) {
    const tease = unplayedPlanUnits[0] ?? null;
    return {
      kind: 'arrival-owed',
      line: "And here we are — that's our stop. I'll hold the rest for next time.",
      teaseUnitId: tease ? tease.id : null,
      teaseLabel: tease ? tease.placeName : null,
      freeformTail: false,
    };
  }
  if (arrived && planExhausted) {
    const tease = unheardShelfUnits[0] ?? null;
    return {
      kind: 'arrival-signoff',
      line: "And here we are — that's our stop. Thanks for riding with me.",
      teaseUnitId: tease ? tease.id : null,
      teaseLabel: tease ? tease.placeName : null,
      freeformTail: false,
    };
  }
  if (!arrived && planExhausted) {
    return {
      kind: 'overrun',
      line: "We're past what I planned for this drive, so I'll keep the stories coming freeform until we get there.",
      teaseUnitId: null,
      teaseLabel: null,
      freeformTail: true,
    };
  }
  return null;
}

/** 'Miles owes you' post-tour line for a teased unit (a line/state, not a screen). */
export function owedLine(teaseLabel: string | null): string | null {
  if (!teaseLabel) return null;
  return `Miles owes you: ${teaseLabel} — next ride.`;
}

// ------------------------------------------------------------ live route APIs (one route build only)

export interface GeocodedDestination {
  name: string;
  address: string | null;
  location: GeoPoint;
}

/**
 * Places (New) text search for the destination. Returns the top
 * candidate. One call per route build; null on any failure (the
 * caller falls back to a typed-pin / retry, never a guessed pin).
 */
export async function geocodeDestination(
  query: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<GeocodedDestination | null> {
  if (!apiKey) return null;
  try {
    const res = await fetchFn('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    });
    if (!res.ok) return null;
    const parsed = (await res.json()) as {
      places?: { displayName?: { text?: string }; location?: { latitude?: number; longitude?: number }; formattedAddress?: string }[];
    };
    const p = parsed.places?.[0];
    if (!p?.displayName?.text || p.location?.latitude === undefined || p.location?.longitude === undefined) return null;
    return {
      name: p.displayName.text,
      address: p.formattedAddress ?? null,
      location: { lat: p.location.latitude, lng: p.location.longitude },
    };
  } catch {
    return null;
  }
}

export interface ComputedRoute {
  path: GeoPoint[];
  distanceMeters: number;
  durationSec: number;
}

/**
 * Routes API computeRoutes with traffic (TRAFFIC_AWARE), DRIVE mode.
 * One call per route build. The Places key carries the Routes API
 * restriction (enabled Nov 2, 2026); a 403 here means the key's
 * restriction list, not the code path — the caller surfaces that.
 */
export async function computeRoute(
  origin: GeoPoint,
  destination: GeoPoint,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<ComputedRoute | null> {
  if (!apiKey) return null;
  try {
    const res = await fetchFn('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        computeAlternativeRoutes: false,
      }),
    });
    if (!res.ok) return null;
    const parsed = (await res.json()) as {
      routes?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[];
    };
    const r = parsed.routes?.[0];
    if (!r?.polyline?.encodedPolyline) return null;
    const dur = r.duration ? parseInt(r.duration.replace('s', ''), 10) : 0;
    return {
      path: decodePolyline(r.polyline.encodedPolyline),
      distanceMeters: r.distanceMeters ?? 0,
      durationSec: Number.isFinite(dur) ? dur : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Gemini parse of the intake text (one call per route build).
 * Prompt asks for strict JSON only; ANY failure (no key, bad
 * status, unparseable JSON) falls back to parseRouteInputLocal —
 * a parse failure must never block a route build, and the local
 * parse is the harness reference, so the two can never diverge
 * into different destinations.
 */
export async function parseRouteInput(
  raw: string,
  nowMs: number,
  geminiApiKey: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<ParsedRouteInput> {
  const fallback = parseRouteInputLocal(raw, nowMs);
  if (!geminiApiKey) return fallback;
  try {
    const res = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Parse this route request into JSON only, no other text: {"destination": string, "arrivalTime": string|null, "tone": string|null, "topics": string[]}. "destination" is the place name with any "arrive by / by <time>", tone words, and topic words removed. "arrivalTime" is an ISO time today if a "by <time>" clause exists, else null. "tone" is one of warm, reflective, light, grand, somber, reverent, spooky, or null. "topics" uses these values when mentioned: Food & Drink, Navy Century, Coast, Surf, Music, Film, folklore, Faith, Mission Chain, Sport, Flight, Rail, Desert, Fire & Fault, Border / CaliBaja, Highway, Water, San Diego River, Boom & Bust, Deep Time, The Cure, Expositions & the Canal. Request: ${raw}`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      },
    );
    if (!res.ok) return fallback;
    const parsed = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = parsed.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const obj = JSON.parse(jsonMatch[0]) as {
      destination?: unknown;
      arrivalTime?: unknown;
      tone?: unknown;
      topics?: unknown;
    };
    if (typeof obj.destination !== 'string' || obj.destination.trim().length === 0) return fallback;
    let arrivalTimeMs: number | null = fallback.arrivalTimeMs;
    if (typeof obj.arrivalTime === 'string') {
      const t = Date.parse(obj.arrivalTime);
      if (Number.isFinite(t) && t > nowMs) arrivalTimeMs = t;
    }
    const tone =
      typeof obj.tone === 'string' && (ROUTE_TONES as readonly string[]).includes(obj.tone) ? obj.tone : fallback.tone;
    const topics = Array.isArray(obj.topics)
      ? (obj.topics.filter(t => typeof t === 'string') as string[])
      : fallback.topics;
    return { destinationText: obj.destination.trim(), arrivalTimeMs, tone, topics };
  } catch {
    return fallback;
  }
}
