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
//
// Composer v2 (Erik, Nov 3, 2026): full-path fetch with segment
// fairness (no first-60 early-route bias), position-anchored
// release (a story sounds inside its ground's window, never just
// because it is next in a list), elastic plan-time bridges sized
// to the anchor gap they span, mix weighting toward the landmark
// shelf with neighborhood intros admitted as capped chapter
// openers, and portal hops — tag-connected stories from off the
// corridor, capped at a quarter of the plan. Still ONE static
// pass: no reordering, no recomposition, dumb guards only.

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

// ------------------------------------------------------------ composer v2: fairness, windows, fetch plan

/** Path-progress deciles the fairness rounds sweep (item 1). */
export const FAIRNESS_BUCKETS = 10;

export function progressBucket(progress: number): number {
  return Math.max(0, Math.min(FAIRNESS_BUCKETS - 1, Math.floor(progress * FAIRNESS_BUCKETS)));
}

/**
 * Angle-class preference at similar progress (item 3a): Erik's
 * lean-away direction — landmark/place stories first, corridor
 * narration last. (Chapter openers travel their own lane.)
 */
export function angleClassRank(angle: string): number {
  return angle === 'corridor' ? 1 : 0;
}

/** Lead time before a story's anchor at which its release window opens. */
export const WINDOW_LEAD_SEC = 20;

export interface StoryWindow {
  release: number;
  expire: number;
}

/**
 * A story's release window, in path-progress units, on the plan's
 * uniform expected-time map (progress × drive duration = expected
 * seconds into the drive). The window opens WINDOW_LEAD_SEC of
 * expected travel before the anchor — the story starts just ahead
 * of its ground, the way a rider would point it out — and closes
 * once the driver is a full story-length of expected travel past
 * the anchor, when starting it would mean narrating ground a
 * whole story behind (the route form of told-late).
 */
export function storyWindow(anchorProgress: number, durationSec: number, driveDurSec: number): StoryWindow {
  const dur = Math.max(1, driveDurSec);
  return {
    release: Math.max(0, anchorProgress - WINDOW_LEAD_SEC / dur),
    expire: Math.min(1, anchorProgress + Math.max(1, durationSec) / dur),
  };
}

/** Elastic bridge bounds: never shorter than the phase-1 line, never a story in disguise. */
export const BRIDGE_MIN_SEC = 8;
export const BRIDGE_MAX_SEC = 90;
/** Chapter openers per plan at most (item 3b), and at most one per named area. */
export const CHAPTER_OPENER_MAX = 3;
/** Portal share cap (item 4): portals ≤ ¼ of the plan's story items ⟺ portals ≤ geoStories / 3. */
export const PORTAL_CAP_DIVISOR = 3;

/** Departure row-read bounds (item 1 + item 4): see selectFetchCandidates. */
export const FETCH_GEO_LIMIT = 120;
export const FETCH_PORTAL_LIMIT = 30;

export interface FetchIndexEntry {
  place_key: string;
  angle: string;
  lat: number;
  lng: number;
}

const FETCH_EXCLUDED_ANGLES = new Set(['neighborhood_intro_greet', 'filler', 'filler_hosted']);

/**
 * The departure fetch plan: which library rows the App reads for
 * one route build, in fetch order. Pure given a tags lookup, so
 * the harness proves the fairness on synthetic shelves.
 *
 * Geographic candidates (story angles + plain intros inside the
 * corridor radius) are ordered FAIRLY — round-robin across
 * path-progress deciles — so a dense route start cannot crowd
 * out the back half of the drive the way the phase-1 first-60
 * cap did. Portal candidates (story angles OUTSIDE the corridor)
 * are ranked by topic overlap with the geographic pool's topics
 * plus any user-chosen topics; at least one shared topic is
 * required, and only enough are fetched to feed the composer's
 * portal cap.
 *
 * Bounds: ≤120 geographic + ≤30 portal row reads. Each read is
 * one small PostgREST round trip and the App fetches them in
 * parallel chunks, so the worst case adds a few seconds at
 * departure on a maximally dense route — the price of seeing
 * the whole path instead of its first sixty rows.
 */
export function selectFetchCandidates(
  entries: FetchIndexEntry[],
  path: GeoPoint[],
  destination: GeoPoint,
  tagsOf: (placeKey: string, angle: string) => { topics: string[] },
  opts: { geoLimit?: number; portalLimit?: number; userTopics?: string[] } = {},
): FetchIndexEntry[] {
  const geoLimit = opts.geoLimit ?? FETCH_GEO_LIMIT;
  const portalLimit = opts.portalLimit ?? FETCH_PORTAL_LIMIT;
  const near = (e: FetchIndexEntry) =>
    distanceToPathM({ lat: e.lat, lng: e.lng }, path) <= 1500 ||
    haversineM({ lat: e.lat, lng: e.lng }, destination) <= 1500;
  const geo: { e: FetchIndexEntry; p: number }[] = [];
  const offPath: FetchIndexEntry[] = [];
  for (const e of entries) {
    if (FETCH_EXCLUDED_ANGLES.has(e.angle)) continue;
    if (near(e)) geo.push({ e, p: progressAlongPath({ lat: e.lat, lng: e.lng }, path) });
    else if (e.angle !== 'neighborhood_intro') offPath.push(e);
  }
  const buckets = new Map<number, { e: FetchIndexEntry; p: number }[]>();
  for (const g of geo) {
    const b = progressBucket(g.p);
    const list = buckets.get(b) ?? [];
    list.push(g);
    buckets.set(b, list);
  }
  for (const list of buckets.values()) list.sort((a, b) => a.p - b.p);
  const ordered: FetchIndexEntry[] = [];
  for (let round = 0; ordered.length < geoLimit; round++) {
    let took = false;
    for (let b = 0; b < FAIRNESS_BUCKETS && ordered.length < geoLimit; b++) {
      const cand = buckets.get(b)?.[round];
      if (cand) {
        ordered.push(cand.e);
        took = true;
      }
    }
    if (!took) break;
  }
  const seedTopics = new Set<string>(opts.userTopics ?? []);
  for (const g of geo) for (const t of tagsOf(g.e.place_key, g.e.angle).topics) seedTopics.add(t);
  const portals = offPath
    .map(e => ({
      e,
      shared: tagsOf(e.place_key, e.angle).topics.filter(t => seedTopics.has(t)).length,
      d: distanceToPathM({ lat: e.lat, lng: e.lng }, path),
    }))
    .filter(c => c.shared >= 1)
    .sort((a, b) => b.shared - a.shared || a.d - b.d)
    .slice(0, portalLimit)
    .map(c => c.e);
  return [...ordered, ...portals];
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
  /** Stories: the unit's progress along the path (its anchor). */
  anchorProgress?: number;
  /**
   * Stories: the release window in progress units — the runner
   * may start the story once the driver's progress reaches
   * releaseProgress, and drops it stale past expireProgress.
   * Absent on bridges/reactions/fillers and on portal stories
   * (a portal releases right after its parent, by plan order).
   */
  releaseProgress?: number;
  expireProgress?: number;
  /** Portal hop (item 4): an off-corridor story tied by topic to a chosen story. */
  portal?: boolean;
  /** For a portal item: the chosen story unit id it hangs off. */
  portalParentId?: string;
  /** Chapter opener (item 3b): a neighborhood intro heading an area's chapter. */
  opener?: boolean;
  /** Bridges: the elastic target the text was composed toward, seconds. */
  targetDurationSec?: number;
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
  /**
   * The Routes drive-time estimate, seconds. The composer maps
   * path progress to expected time with it (release windows,
   * elastic bridge targets). When absent, the tiling budget is
   * the proxy — it is the drive time in the no-arrival case and
   * the travel window in the arrival case.
   */
  driveSec?: number | null;
}

/**
 * ONE static composition pass at departure (v16.1: no re-planning,
 * no live bridge generation; v2: fairness, windows, portals).
 * Library-first tiling:
 *  1. partition the shelf — geographic stories (inside the 1.5 km
 *     corridor), chapter openers (plain neighborhood intros in
 *     the corridor), portal candidates (stories outside it);
 *     heard units and the greet/filler angles are never served;
 *  2. SELECTION IS FAIR ACROSS THE PATH: candidates are bucketed
 *     by progress decile and picked round-robin — every stretch
 *     of the drive contributes before any stretch gets a second
 *     story — under the arrival/drive-time budget (a story that
 *     would overshoot the budget by more than half again is
 *     passed over for a shorter fit in its bucket);
 *  3. within a bucket, rank is tone match first (a user-chosen
 *     tone outranks angle class), then landmark angles over
 *     corridor angles (Erik's lean-away), then progress. A
 *     user-topic pool restriction applies before all of it, as
 *     in phase 1;
 *  4. chapter openers head the first story at-or-after their
 *     area's ground (≤1 per area, ≤3 per plan, heard-excluded);
 *  5. portal hops: off-corridor units tied by shared topics to a
 *     chosen story, ≤ geoStories/3 (a quarter of story items),
 *     one per parent, inserted directly after the parent;
 *  6. bridges between consecutive units are ELASTIC — their
 *     target length comes from the anchor gap they span on the
 *     expected-time map — and every story carries its release
 *     window for the runner's position-anchored release;
 *  7. the pre-rendered reaction bank, sparingly: at most one
 *     reaction per three stories, at planned points only; a
 *     hosted filler still spackles a sub-60 s remainder.
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
  const progressCache = new Map<string, number>();
  const prog = (u: LibraryUnit): number => {
    let p = progressCache.get(u.id);
    if (p === undefined) {
      p = progressAlongPath({ lat: u.lat, lng: u.lng }, path);
      progressCache.set(u.id, p);
    }
    return p;
  };
  // Corridor membership: within 1.5 km of the path (generous —
  // the shelf is place-anchored, not path-anchored), or the
  // destination itself.
  const inCorridor = (u: LibraryUnit): boolean =>
    distanceToPathM({ lat: u.lat, lng: u.lng }, path) <= 1500 ||
    haversineM({ lat: u.lat, lng: u.lng }, destination) <= 1500;

  let skippedHeard = 0;
  const geoAll: LibraryUnit[] = [];
  const openerAll: LibraryUnit[] = [];
  const portalAll: LibraryUnit[] = [];
  for (const u of units) {
    // The route composer's own partition (freeform never reads
    // this): the greet variant is a welcome, not a chapter head,
    // and the filler lanes are not stories. Plain intros are the
    // one NON_STORY_ANGLES member whose handling changed — they
    // moved to the chapter-opener lane below.
    if (u.angle === 'neighborhood_intro_greet' || u.angle === 'filler' || u.angle === 'filler_hosted') continue;
    if (opts.heardKeys.has(u.id)) {
      skippedHeard += 1;
      continue;
    }
    if (u.angle === 'neighborhood_intro') {
      if (inCorridor(u)) openerAll.push(u);
      continue;
    }
    if (inCorridor(u)) geoAll.push(u);
    else portalAll.push(u);
  }

  const topicSet = new Set(input.topics);
  const topicMatches = topicSet.size > 0 ? geoAll.filter(u => u.topics.some(t => topicSet.has(t))) : [];
  const pool = topicMatches.length > 0 ? topicMatches : geoAll;
  const topicsMatched = topicMatches.length > 0;

  // Budget: arrival budget when given, else the caller-supplied
  // drive-time budget (budgetSecFor); without either, maxStories
  // is the only cap.
  const budgetSec =
    input.arrivalTimeMs !== null
      ? Math.max(60, Math.round((input.arrivalTimeMs - opts.nowMs) / 1000))
      : (opts.budgetSecOverride ?? Number.POSITIVE_INFINITY);
  // Expected-time map for windows + elastic bridges: the Routes
  // drive time when the caller passes it, else the budget (the
  // drive time in the no-arrival case, the travel window in the
  // arrival case), else a floor under the pool's own length.
  const driveDur =
    opts.driveSec ?? (Number.isFinite(budgetSec) ? budgetSec : Math.max(600, pool.reduce((s, u) => s + u.durationSec, 0)));

  // Rank within a bucket: tone match (user-chosen) → angle class
  // → progress.
  const toneRank = (u: LibraryUnit): number =>
    input.tone && (u.tone === input.tone || u.toneSecondary === input.tone) ? 0 : 1;
  const byRank = (a: LibraryUnit, b: LibraryUnit): number =>
    toneRank(a) - toneRank(b) || angleClassRank(a.angle) - angleClassRank(b.angle) || prog(a) - prog(b);

  // Fair selection: round-robin across progress deciles. An
  // overshoot-skipped candidate yields to its bucket's next fit.
  const buckets = new Map<number, LibraryUnit[]>();
  for (const u of pool) {
    const b = progressBucket(prog(u));
    const list = buckets.get(b) ?? [];
    list.push(u);
    buckets.set(b, list);
  }
  for (const list of buckets.values()) list.sort(byRank);
  const chosen: LibraryUnit[] = [];
  let total = 0;
  const pointers = new Map<number, number>();
  let sweeping = true;
  while (sweeping && chosen.length < maxStories) {
    sweeping = false;
    for (let b = 0; b < FAIRNESS_BUCKETS; b++) {
      if (chosen.length >= maxStories) break;
      const list = buckets.get(b);
      if (!list) continue;
      let idx = pointers.get(b) ?? 0;
      while (idx < list.length) {
        const cand = list[idx];
        idx += 1;
        if (Number.isFinite(budgetSec)) {
          if (total >= budgetSec) {
            idx = list.length;
            break;
          }
          if (total + cand.durationSec > budgetSec * 1.5 && chosen.length > 0) continue;
        }
        chosen.push(cand);
        total += cand.durationSec;
        sweeping = true;
        break;
      }
      pointers.set(b, idx);
    }
  }
  // Playback order is route order; rank breaks near-ties.
  chosen.sort((a, b) => prog(a) - prog(b) || byRank(a, b));

  const toneMatched =
    input.tone !== null && chosen.some(u => u.tone === input.tone || u.toneSecondary === input.tone);

  // The playback sequence: chosen stories, then chapter openers,
  // then portal hops spliced after their parents.
  interface SeqEntry {
    unit: LibraryUnit;
    opener?: boolean;
    portal?: boolean;
    portalParentId?: string;
    sharedTopic?: string;
  }
  const sequence: SeqEntry[] = chosen.map(u => ({ unit: u }));

  // Chapter openers (item 3b): the first story at-or-after the
  // area's ground gets the area's intro as its chapter head.
  const openerByKey = new Map<string, LibraryUnit>();
  for (const u of openerAll) if (!openerByKey.has(u.placeKey)) openerByKey.set(u.placeKey, u);
  const openers = [...openerByKey.values()].sort((a, b) => prog(a) - prog(b));
  let openersUsed = 0;
  for (const op of openers) {
    if (openersUsed >= CHAPTER_OPENER_MAX || sequence.length === 0) break;
    if (Number.isFinite(budgetSec) && total + op.durationSec > budgetSec * 1.5) continue;
    let at = sequence.findIndex(s => prog(s.unit) >= prog(op) - 1e-9);
    if (at === -1) at = sequence.length;
    sequence.splice(at, 0, { unit: op, opener: true });
    total += op.durationSec;
    openersUsed += 1;
  }

  // Portal hops (item 4): connection = shared topics with a
  // chosen geographic story; user-chosen topics strengthen the
  // score; tone is the last tiebreak. One hop per parent.
  const maxPortals = Math.floor(chosen.length / PORTAL_CAP_DIVISOR);
  if (maxPortals > 0 && portalAll.length > 0 && chosen.length > 0) {
    interface PortalScore {
      cand: LibraryUnit;
      parent: LibraryUnit;
      shared: number;
      userOverlap: number;
      toneTie: number;
      topic: string;
    }
    const scored: PortalScore[] = [];
    for (const cand of portalAll) {
      let best: PortalScore | null = null;
      for (const g of chosen) {
        const sharedTopics = cand.topics.filter(t => g.topics.includes(t));
        if (sharedTopics.length === 0) continue;
        const entry: PortalScore = {
          cand,
          parent: g,
          shared: sharedTopics.length,
          userOverlap: cand.topics.filter(t => topicSet.has(t)).length,
          toneTie:
            input.tone && (cand.tone === input.tone || cand.toneSecondary === input.tone)
              ? 1
              : g.tone !== null && cand.tone === g.tone
                ? 1
                : 0,
          topic: sharedTopics[0],
        };
        if (
          !best ||
          entry.shared > best.shared ||
          (entry.shared === best.shared && entry.userOverlap > best.userOverlap) ||
          (entry.shared === best.shared && entry.userOverlap === best.userOverlap && entry.toneTie > best.toneTie)
        ) {
          best = entry;
        }
      }
      if (best) scored.push(best);
    }
    scored.sort(
      (a, b) =>
        b.shared - a.shared || b.userOverlap - a.userOverlap || b.toneTie - a.toneTie || prog(a.parent) - prog(b.parent),
    );
    const usedParents = new Set<string>();
    let portalsAdded = 0;
    for (const s of scored) {
      if (portalsAdded >= maxPortals) break;
      if (usedParents.has(s.parent.id)) continue;
      if (Number.isFinite(budgetSec) && total + s.cand.durationSec > budgetSec * 1.5) continue;
      const at = sequence.findIndex(x => x.unit.id === s.parent.id);
      if (at === -1) continue;
      sequence.splice(at + 1, 0, {
        unit: s.cand,
        portal: true,
        portalParentId: s.parent.id,
        sharedTopic: s.topic,
      });
      usedParents.add(s.parent.id);
      total += s.cand.durationSec;
      portalsAdded += 1;
    }
  }

  // Hosted-filler spackle: a remainder under 60 s gets one filler
  // rather than a story that cannot fit — never dead air, never a
  // clipped story.
  const fillers = (opts.fillerUnits ?? []).filter(f => !opts.heardKeys.has(f.id));
  if (Number.isFinite(budgetSec) && fillers.length > 0 && total < budgetSec && budgetSec - total < 60) {
    const f = fillers[0];
    sequence.push({ unit: f });
    total += f.durationSec;
  }

  // Interleave elastic plan-time bridges + sparing reactions,
  // and stamp each story with its release window.
  const items: PlanItem[] = [];
  let storiesSinceReaction = 0;
  sequence.forEach((entry, i) => {
    const u = entry.unit;
    // Bridges join story → story only: a filler spackle gets no
    // pair bridge (it is not a place the bridge can name).
    if (i > 0 && u.angle !== 'filler_hosted' && sequence[i - 1].unit.angle !== 'filler_hosted') {
      const prev = sequence[i - 1].unit;
      // Elastic target: the expected travel time from the
      // previous story's END to this story's window opening,
      // clamped to the bridge bounds.
      const gapSec = Math.max(0, (prog(u) - prog(prev)) * driveDur - prev.durationSec);
      const target = Math.max(
        BRIDGE_MIN_SEC,
        Math.min(BRIDGE_MAX_SEC, Math.round(gapSec - WINDOW_LEAD_SEC)),
      );
      const text = bridgeTextFor(prev, u, {
        targetSec: target,
        portalTopic: entry.portal ? entry.sharedTopic : undefined,
      });
      items.push({
        kind: 'bridge',
        id: `bridge:${prev.id}>${u.id}`,
        label: `Bridge — ${prev.placeName} to ${u.placeName}`,
        durationSec: spokenSec(text),
        prevUnitId: prev.id,
        nextUnitId: u.id,
        text,
        ready: true,
        targetDurationSec: target,
      });
    }
    const isFiller = u.angle === 'filler_hosted';
    const win = !isFiller && !entry.portal ? storyWindow(prog(u), u.durationSec, driveDur) : null;
    items.push({
      kind: isFiller ? 'filler' : 'story',
      id: u.id,
      label: u.placeName,
      durationSec: u.durationSec,
      unit: u,
      ready: true,
      anchorProgress: prog(u),
      ...(win ? { releaseProgress: win.release, expireProgress: win.expire } : {}),
      ...(entry.portal ? { portal: true, portalParentId: entry.portalParentId } : {}),
      ...(entry.opener ? { opener: true } : {}),
    });
    storiesSinceReaction += 1;
    if (storiesSinceReaction >= 3 && i < sequence.length - 1) {
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

/** Unfloored spoken-length estimate for short composed lines (bridges). */
function spokenSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round((words / 150) * 60));
}

/**
 * Authored connective sentences for elastic bridges (item 2).
 * Place-free by design — a bridge may stretch over any ground,
 * so these lines carry the drive, never facts about a place.
 * The pair-specific head line carries the names; these carry
 * the time.
 */
export const BRIDGE_CONNECTIVE_LINES: string[] = [
  'The road has a way of stitching this county together, one valley at a time.',
  'Keep your eyes up — the landscape is about to change its mind again.',
  'This is the part of the drive where the city starts showing its layers.',
  "Every mile out here has somebody's whole life folded into it.",
  'The map says one thing; the ground underneath remembers another.',
  'We are crossing ground that generations have crossed before us.',
  'San Diego does this — it hides its best stories in plain sight, right along the commute.',
  'Plenty of road behind us now, and the good stuff has a habit of clustering up ahead.',
  'If you have done this drive a hundred times, this is the stretch worth looking at fresh.',
  'The hills, the canyons, the bay pulling at the edge of everything — this county never just sits there.',
  'Settle in for a moment. The next story is worth arriving at properly.',
  'This is Miles, riding shotgun — pointing at the things the road forgets to mention.',
];

/**
 * Pair-specific bridge text, composed at plan time, Miles-solo.
 * Elastic (item 2): given a target, connective sentences are
 * appended — in a rotation seeded by the pair, so a given bridge
 * is stable across rebuilds but pairs differ — until the spoken
 * estimate reaches the target or the bank runs out (a bridge
 * composes TOWARD its target; the authored bank tops out around
 * a minute, and longer anchor gaps are window-wait, by design).
 * A portal hop's bridge names the connection that earned the hop.
 */
export function bridgeTextFor(
  prev: LibraryUnit,
  next: LibraryUnit,
  opts: { targetSec?: number; portalTopic?: string } = {},
): string {
  const target = opts.targetSec ?? BRIDGE_MIN_SEC;
  let text = opts.portalTopic
    ? `From ${prev.placeName}, there is a thread worth following — ${opts.portalTopic} ties it to ${next.placeName}, a little way off our road, and the connection is too good to skip.`
    : `From ${prev.placeName} we keep rolling — just ahead is ${next.placeName}, and it has its own story to tell.`;
  if (spokenSec(text) < target) {
    let seed = 0;
    const key = `${prev.id}>${next.id}`;
    for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) & 0x7fffffff;
    let idx = seed % BRIDGE_CONNECTIVE_LINES.length;
    let guard = 0;
    while (spokenSec(text) < target && guard < BRIDGE_CONNECTIVE_LINES.length) {
      text += ` ${BRIDGE_CONNECTIVE_LINES[idx % BRIDGE_CONNECTIVE_LINES.length]}`;
      idx += 1;
      guard += 1;
    }
  }
  return text;
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
