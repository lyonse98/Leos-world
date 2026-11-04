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
import { selectPriorDrive, type RouteDriveRecord } from './routeHistory';
import {
  bridgeTextFor,
  BRIDGE_CONNECTIVE_LINES,
  REACTION_BANK,
  type BridgeContext,
  type WrapUpContext,
} from './narration';

// The bridge text layer lives in the narration seam (addendum
// 5); these re-exports keep its long-standing import surface.
export { bridgeTextFor, BRIDGE_CONNECTIVE_LINES, REACTION_BANK, type BridgeContext };

// Composer v2 (Erik, Nov 3, 2026): full-path fetch with segment
// fairness (no first-60 early-route bias), position-anchored
// release (a story sounds inside its ground's window, never just
// because it is next in a list), elastic plan-time bridges sized
// to the anchor gap they span, mix weighting toward the landmark
// shelf with neighborhood intros admitted as capped chapter
// openers, and portal hops — tag-connected stories from off the
// corridor, capped at a quarter of the plan. Still ONE static
// pass: no reordering, no recomposition, dumb guards only.
//
// The through-line (route differentiator 2, Erik, Nov 3, 2026):
// route mode should feel like ONE episode with a subject — dots
// connected from beginning to end — not a queue of unrelated
// stories. When the selectable shelf shares a topic thread the
// route can sustain (see detectRouteThread), the composer leans
// into it (a weighting nudge, never an override), reserves the
// destination's flagship story for the approach, and gives the
// bridges real connective context: the opening bridge names the
// thread and promises the closing story, mid bridges may call
// back an earlier story on the same thread, the bridge into the
// flagship pays the promise off, and the arrival closeout wraps
// the thread — but only when it actually played. No thread →
// composition is exactly composer v2, bridges included.

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
  /** The plan's climax (addendums 4–5): the winner, marked in every mode. */
  climax?: boolean;
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
   * Through-line (differentiator 2): the route's thematic
   * thread when the shelf sustains one, else null — and with a
   * null thread the plan is exactly what composer v2 built.
   */
  thread: RouteThread | null;
  /** The climax unit id, when the plan has one (addendum 4: not destination-geared). */
  climaxUnitId: string | null;
  /**
   * How the climax resolved (addendum 4): 'destination' when
   * the winner is a destination-area unit sequenced last,
   * 'late' when a late-corridor unit was sequenced last,
   * 'natural' when no repositioning happened (no candidate,
   * or sequencing it last would have stripped the early
   * drive's only coverage).
   */
  climaxMode: 'destination' | 'late' | 'natural';
  /** The climax story's subject (place name), when the plan has one. */
  climaxSubject: string | null;
  /** The winner's fit reasons (addendum 5): any of 'tone' | 'topic' | 'thread'. */
  climaxFit: string[];
  /**
   * Bookend (addendum 5): true when the sequenced climax is
   * the opening story's partner — they share a topic tag
   * (bookendTopic) across different anchors, so the drive ends
   * by explaining how it began.
   */
  bookend: boolean;
  /** The tag the bookend pair shares, when bookend is true. */
  bookendTopic: string | null;
  /** The plan's opening story subject (the departure-area story), when the plan has stories. */
  openingSubject: string | null;
  /**
   * Optional shelf tease for the arrival-signoff closeout, set by
   * the App after composing (an unheard, unplanned shelf unit).
   * The pure composer cannot know the shelf beyond its inputs.
   */
  shelfTease?: LibraryUnit | null;
  /**
   * The generated wrap-up (addendum 3), authored + synthesized
   * by the App at preparation (after gap-fill) and held by the
   * runner as the plan's closing piece: ONE closing narration
   * for the planned drive played to finish. Played only when
   * the tour reaches arrival with the plan run out; an early
   * end or an overrun simply never uses it. Null when its
   * generation/synthesis failed at preparation — arrival then
   * falls back to the standing closeout line exactly.
   */
  wrapUp?: { text: string; audioUrl: string } | null;
}

// ------------------------------------------------------------ through-line (differentiator 2)

export interface RouteThread {
  /** The shared topic tag (routeTags vocabulary, e.g. 'Navy Century'). */
  topic: string;
  /** Unit ids of the selectable units carrying the topic — the thread's cast. */
  memberIds: string[];
  /** The cast size: members count once each, wherever they sit (addendum 4). */
  score: number;
}

/** A thread must be sustainable: at least 3 selectable members along the path. */
export const THREAD_MIN_SCORE = 3;
/** The climax zone: the final third of drive progress (addendum 4). */
export const CLIMAX_ZONE_START = 2 / 3;
/** Destination-area radius — the same 1.5 km the corridor test grants the destination pin. */
export const DESTINATION_AREA_M = 1500;

export function isDestinationArea(u: LibraryUnit, destination: GeoPoint): boolean {
  return haversineM({ lat: u.lat, lng: u.lng }, destination) <= DESTINATION_AREA_M;
}

/**
 * Thread detection (offline, pure): from the units the composer
 * can choose among, find a topic thread the route can sustain —
 * a topic shared by ≥3 selectable units along the path, full
 * stop (addendum 4: no destination double-weight, no
 * requirement that the thread terminate at the destination —
 * it ends wherever its last member plays, and the wrap-up
 * ties it off there).
 *
 * Preference: a user-chosen topic that qualifies wins (in the
 * user's own order). When the user picked topics but NONE of
 * theirs qualifies, there is no thread — no theme is ever
 * forced over the listener's own picks. With no user topics,
 * the strongest thread wins (cast size, then topic name for
 * determinism). The caller passes the composer's pool, so a
 * thread can only ever be found among units the composer may
 * actually select.
 */
export function detectRouteThread(candidates: LibraryUnit[], userTopics: string[]): RouteThread | null {
  const byTopic = new Map<string, LibraryUnit[]>();
  for (const u of candidates) {
    for (const t of u.topics) {
      const list = byTopic.get(t) ?? [];
      list.push(u);
      byTopic.set(t, list);
    }
  }
  const qualifying = [...byTopic.entries()]
    .filter(([, members]) => members.length >= THREAD_MIN_SCORE)
    .map(([topic, members]) => ({ topic, memberIds: members.map(u => u.id), score: members.length }))
    // Topics were picked and none of them qualify → no forced theme.
    .filter(t => userTopics.length === 0 || userTopics.includes(t.topic));
  if (qualifying.length === 0) return null;
  const userRank = (topic: string): number => {
    const i = userTopics.indexOf(topic);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  qualifying.sort(
    (a, b) =>
      userRank(a.topic) - userRank(b.topic) ||
      b.memberIds.length - a.memberIds.length ||
      (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0),
  );
  return qualifying[0];
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
   * The tiling budget. The App always passes budgetSecFor(driveSec)
   * — the Routes drive-time estimate — and when present it is
   * AUTHORITATIVE over any arrival-derived budget. When absent,
   * an input arrival time (parser-only since Nov 3, 2026) still
   * tiles the plan in pure-function tests; with neither, the plan
   * fills to maxStories.
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
  /**
   * Prior route drives (addendum 2), newest first, with each
   * record's owed subjects ALREADY filtered against the current
   * heard ledger by the caller (routeHistory.stillOwedSubjects)
   * — the composer matches at most one against this build (see
   * selectPriorDrive) and feeds it to the opening preview only.
   */
  driveRecords?: RouteDriveRecord[];
  /** The destination's library place_key when the build could derive one (addendum 2 matching). */
  destinationPlaceKey?: string | null;
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
 * Through-line (differentiator 2) layers onto the same pass,
 * never against it: thread detection on the pool (a rank nudge
 * beside tone in byRank — heard exclusion, budget tiling,
 * anchored windows and the portal/opener caps are untouched),
 * a generalized climax sequenced as the closing story when
 * the early drive stays covered without it (addendum 4: the
 * candidate set is the final third plus any destination units,
 * on equal footing — a commute's climax is its strongest late
 * story, not its workplace), picked by bookend pairing, then
 * fit with today's tone/topics/thread, then standing weight
 * (addendum 5), and bridge contexts carrying the thread + real
 * plan facts into the elastic bridge text — the first bridge
 * doubling as the spoken episode preview, with a continuity
 * nod only when the heard ledger holds a subject on this
 * route's ground. With no thread and no repositionable
 * climax, the plan's items, order and windows are exactly
 * composer v2's; only the opening bridge's text differs (the
 * preview is its job in every plan).
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
  // Heard STORY units on this route's own ground (corridor or
  // destination area), collected at partition for the opening
  // preview's "Previously on Miles" nod (Erik, Nov 3, 2026):
  // real heard-ledger subjects only — a unit lands here solely
  // because its id is in the caller's heard set.
  const priorHeard: LibraryUnit[] = [];
  for (const u of units) {
    // The route composer's own partition (freeform never reads
    // this): the greet variant is a welcome, not a chapter head,
    // and the filler lanes are not stories. Plain intros are the
    // one NON_STORY_ANGLES member whose handling changed — they
    // moved to the chapter-opener lane below.
    if (u.angle === 'neighborhood_intro_greet' || u.angle === 'filler' || u.angle === 'filler_hosted') continue;
    if (opts.heardKeys.has(u.id)) {
      skippedHeard += 1;
      if (u.angle !== 'neighborhood_intro' && inCorridor(u)) priorHeard.push(u);
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

  // Through-line (differentiator 2): detect the thread on the
  // selectable pool, before selection — its only powers are a
  // rank nudge below and the bridge context at item build time.
  // It never touches heard exclusion, the budget, the windows,
  // or the caps.
  const thread = detectRouteThread(pool, input.topics);
  const threadMemberIds = new Set(thread?.memberIds ?? []);

  // "Previously on Miles", drive level (addendum 2): with the
  // thread known, match at most one prior drive — same
  // destination first, same thread second — for the opening
  // preview's continuity nod. A record whose thread and owed
  // list are both empty carries nothing the preview can say.
  const priorDriveRecord = opts.driveRecords?.length
    ? selectPriorDrive(opts.driveRecords, {
        destinationPlaceKey: opts.destinationPlaceKey ?? null,
        destinationName,
        threadTopic: thread?.topic ?? null,
      })
    : null;
  const priorDrive =
    priorDriveRecord && (priorDriveRecord.threadTopic !== null || priorDriveRecord.owedSubjects.length > 0)
      ? { threadTopic: priorDriveRecord.threadTopic, stillOwedSubjects: priorDriveRecord.owedSubjects.slice(0, 2) }
      : null;

  // Budget: the caller-supplied drive-time budget (budgetSecFor)
  // wins whenever present — since Nov 3, 2026 it is the ONLY
  // budget the App ever builds with. An input arrival time tiles
  // the plan only when no override was passed (pure-function
  // tests); without either, maxStories is the only cap.
  const budgetSec =
    opts.budgetSecOverride ??
    (input.arrivalTimeMs !== null
      ? Math.max(60, Math.round((input.arrivalTimeMs - opts.nowMs) / 1000))
      : Number.POSITIVE_INFINITY);
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
  const threadRank = (u: LibraryUnit): number => (threadMemberIds.has(u.id) ? 0 : 1);
  // Bookend potential (addendum 5): in a threaded plan, an
  // opening-zone story that shares a topic with a late-zone
  // shelf story earns a point in its favor when the composer
  // picks the drive's opening — the end may explain the
  // beginning. A rank nudge inside the same stack as tone and
  // thread (never a rule: heard exclusion, the budget and the
  // windows are untouched), and inert without a thread, so
  // no-thread selection stays exactly composer v2's.
  const latePool = pool.filter(v => prog(v) >= CLIMAX_ZONE_START || isDestinationArea(v, destination));
  const bookendRank = (u: LibraryUnit): number => {
    if (!thread || prog(u) >= 1 - CLIMAX_ZONE_START) return 1;
    return latePool.some(
      v => v.id !== u.id && v.placeKey !== u.placeKey && v.topics.some(t => u.topics.includes(t)),
    )
      ? 0
      : 1;
  };
  const byRank = (a: LibraryUnit, b: LibraryUnit): number =>
    toneRank(a) - toneRank(b) ||
    threadRank(a) - threadRank(b) ||
    bookendRank(a) - bookendRank(b) ||
    angleClassRank(a.angle) - angleClassRank(b.angle) ||
    prog(a) - prog(b);

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

  // Generalized climax (addendum 4): NOT destination-geared —
  // route mode must work for a commute, and a work
  // destination's shelf is the fastest to exhaust. Candidates
  // are the plan's stories anchored in the final third of
  // drive progress PLUS any destination-area stories, all on
  // equal footing. The winner is chosen by (addendum 5):
  //   1. BOOKEND — a candidate that shares a topic tag with
  //      the opening story (a different anchor: pairing is by
  //      subject family across the drive, never the same
  //      place's second angle) — the end explains the
  //      beginning;
  //   2. FIT — how many of today's declared tone, the chosen
  //      topics, and the plan's thread the candidate matches:
  //      a fitting climax beats a marginally heavier story
  //      that doesn't fit today;
  //   3. the composer's standing weight (angle class, tone,
  //      thread, longest telling, latest ground).
  // The winner is sequenced LAST — moved to the end of the
  // chosen order and re-anchored into the climax zone — unless
  // it is the drive's only coverage of the ground before the
  // zone: then natural order stands and the mode degrades to
  // 'natural' (coverage beats drama, the Coverage Guarantee's
  // values in code). A winner already last is sequenced
  // without a move and keeps its natural anchor. When the
  // plan holds a single story there is nothing to climax
  // against.
  const openingUnit = chosen[0] ?? null;
  const fitReasonsFor = (u: LibraryUnit): string[] => {
    const reasons: string[] = [];
    if (input.tone && (u.tone === input.tone || u.toneSecondary === input.tone)) reasons.push('tone');
    if (topicSet.size > 0 && u.topics.some(t => topicSet.has(t))) reasons.push('topic');
    if (threadMemberIds.has(u.id)) reasons.push('thread');
    return reasons;
  };
  const bookendTopicFor = (u: LibraryUnit): string | null => {
    if (!openingUnit || u.id === openingUnit.id || u.placeKey === openingUnit.placeKey) return null;
    return u.topics.find(t => openingUnit.topics.includes(t)) ?? null;
  };
  let climaxUnitId: string | null = null;
  let climaxMode: RoutePlan['climaxMode'] = 'natural';
  let climaxSubject: string | null = null;
  let climaxFit: string[] = [];
  let climaxAnchor: number | null = null;
  let climaxSequenced = false;
  let bookend = false;
  let bookendTopic: string | null = null;
  // The opening story is NOT excluded from candidacy: a
  // destination unit can anchor the drive's start and still
  // be its climax (sequencing moves it last; the next story
  // opens instead). It can never be its own bookend partner —
  // bookendTopicFor returns null for the opening itself.
  const climaxCandidates = chosen.filter(
    u => prog(u) >= CLIMAX_ZONE_START || isDestinationArea(u, destination),
  );
  if (chosen.length >= 2 && climaxCandidates.length > 0) {
    const winner = [...climaxCandidates].sort(
      (a, b) =>
        Number(bookendTopicFor(b) !== null) - Number(bookendTopicFor(a) !== null) ||
        fitReasonsFor(b).length - fitReasonsFor(a).length ||
        angleClassRank(a.angle) - angleClassRank(b.angle) ||
        toneRank(a) - toneRank(b) ||
        threadRank(a) - threadRank(b) ||
        b.durationSec - a.durationSec ||
        prog(b) - prog(a),
    )[0];
    climaxUnitId = winner.id;
    climaxSubject = winner.placeName;
    climaxFit = fitReasonsFor(winner);
    bookendTopic = bookendTopicFor(winner);
    const soleEarlyCoverage =
      prog(winner) < CLIMAX_ZONE_START &&
      !chosen.some(u => u.id !== winner.id && prog(u) < CLIMAX_ZONE_START);
    if (!soleEarlyCoverage) {
      climaxSequenced = true;
      const at = chosen.findIndex(u => u.id === winner.id);
      if (at !== chosen.length - 1) {
        chosen.splice(at, 1);
        chosen.push(winner);
        climaxAnchor = Math.max(
          prog(winner),
          Math.min(0.98, Math.max(CLIMAX_ZONE_START, 1 - winner.durationSec / driveDur)),
        );
      }
      climaxMode = isDestinationArea(winner, destination) ? 'destination' : 'late';
      // The pairing is real only when the partner actually
      // closes the drive: an unsequenced winner leaves the
      // loop open, and no surface may claim it.
      bookend = bookendTopic !== null;
    }
  }

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
    // A chapter opener never lands after a sequenced climax —
    // nothing heads a chapter beyond the closing story.
    if (climaxSequenced && climaxUnitId) {
      const flagshipAt = sequence.findIndex(s => s.unit.id === climaxUnitId);
      if (flagshipAt >= 0 && at > flagshipAt) at = flagshipAt;
    }
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
        // A sequenced climax never parents a portal: the hop
        // would sound after the closing story.
        if (climaxSequenced && g.id === climaxUnitId) continue;
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
  // Through-line bridge bookkeeping: the plan's closing story
  // (the sequenced climax when there is one, else the last
  // non-filler entry) is what the opening bridge promises, and
  // the payoff line may only claim a promise that was actually
  // composed — tracked here, as the bridges are built in order.
  const closingEntry = [...sequence].reverse().find(e => e.unit.angle !== 'filler_hosted');
  // The preview teases the ACTUAL climax (addendum 4): the
  // winner and its mode when the plan has one; without a
  // winner, the closing story itself, rendered 'late' (it
  // truly is last). The bookend context (addendum 5) exists
  // only when the pairing actually closes the drive.
  const climaxCtx = climaxUnitId
    ? { subject: climaxSubject ?? '', mode: climaxMode, sequenced: climaxSequenced }
    : closingEntry
      ? { subject: closingEntry.unit.placeName, mode: 'late' as const, sequenced: false }
      : null;
  const bookendCtx =
    bookend && openingUnit && bookendTopic
      ? { openingSubject: openingUnit.placeName, sharedTopic: bookendTopic }
      : null;
  let firstBridgeSeen = false;
  let promiseMade = false;
  // The opening bridge is the spoken episode preview (Erik,
  // Nov 3, 2026): it draws the listener in with the destination,
  // the closing story, and ONE mid-drive subject to listen for.
  // The mid hook is a real story entry strictly between the
  // departure story and the closing story, nearest the drive's
  // midpoint (a thread member wins a near tie — the middle
  // chapter is best on-theme).
  const storyEntries = sequence.filter(e => e.unit.angle !== 'filler_hosted');
  const midEntry =
    storyEntries.length > 2
      ? storyEntries
          .slice(1)
          .filter(e => e !== closingEntry)
          .sort(
            (a, b) =>
              Math.abs(prog(a.unit) - 0.5) - Math.abs(prog(b.unit) - 0.5) ||
              threadRank(a.unit) - threadRank(b.unit) ||
              prog(a.unit) - prog(b.unit),
          )[0]
      : undefined;
  // "Previously on Miles": ONE previously-heard subject from
  // this route's own ground — destination-area subjects first
  // (the strongest "we came this way" signal), then earliest
  // along the drive. Null when the ledger holds nothing here:
  // the nod is never invented.
  const priorHeardSubject =
    [...priorHeard].sort(
      (a, b) =>
        Number(isDestinationArea(b, destination)) - Number(isDestinationArea(a, destination)) ||
        prog(a) - prog(b) ||
        (a.id < b.id ? -1 : 1),
    )[0]?.placeName ?? null;
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
      // Portal bridges keep their authored connection line and
      // take no thread context; every other bridge in a threaded
      // plan gets real connective context (thread, the pair, and
      // — for callbacks — only items earlier in THIS plan).
      const context = entry.portal
        ? undefined
        : buildBridgeContext({
            earlier: sequence.slice(0, i).map(e => e.unit),
            prev,
            next: u,
            closing: closingEntry?.unit ?? null,
            mid: midEntry?.unit ?? null,
            storyCount: storyEntries.length,
            previouslyHeardSubject: priorHeardSubject,
            priorDrive,
            thread,
            isFirstBridge: !firstBridgeSeen,
            isClimaxBridge: climaxUnitId !== null && u.id === climaxUnitId,
            climaxLast: climaxSequenced,
            climax: climaxCtx,
            bookend: bookendCtx,
            destinationName,
            promiseMade,
          });
      if (context?.role === 'opening' && (context.closingSubject || context.climaxSubject)) promiseMade = true;
      firstBridgeSeen = true;
      const text = bridgeTextFor(prev, u, {
        targetSec: target,
        portalTopic: entry.portal ? entry.sharedTopic : undefined,
        context,
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
    // The climax flag marks the winner in every mode (the
    // manifest, the wrap-up and telemetry read it); the
    // re-anchor applies only when sequencing actually moved it.
    const isClimax = climaxUnitId !== null && u.id === climaxUnitId;
    const anchor = isClimax && climaxSequenced && climaxAnchor !== null ? climaxAnchor : prog(u);
    const win = !isFiller && !entry.portal ? storyWindow(anchor, u.durationSec, driveDur) : null;
    items.push({
      kind: isFiller ? 'filler' : 'story',
      id: u.id,
      label: u.placeName,
      durationSec: u.durationSec,
      unit: u,
      ready: true,
      anchorProgress: anchor,
      ...(win ? { releaseProgress: win.release, expireProgress: win.expire } : {}),
      ...(isClimax ? { climax: true } : {}),
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
    thread,
    climaxUnitId,
    climaxMode,
    climaxSubject,
    climaxFit,
    bookend,
    bookendTopic: bookend ? bookendTopic : null,
    openingSubject: openingUnit?.placeName ?? null,
  };
}

/** Unfloored spoken-length estimate for short composed lines (bridges). */
function spokenSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round((words / 150) * 60));
}

/** One-line gist of a story: its first sentence, capped. Null when the unit carries no text. */
export function storyGist(unit: LibraryUnit): string | null {
  const text = unit.storyText?.trim();
  if (!text) return null;
  const m = text.match(/^[^.!?]+[.!?]/);
  const gist = (m ? m[0] : text).trim();
  if (!gist) return null;
  return gist.length > 160 ? `${gist.slice(0, 157).trimEnd()}…` : gist;
}

/**
 * Assemble a bridge's context from the plan's real facts —
 * the facts live here (composition); the TEXT they become is
 * authored in the narration layer (narration.bridgeTextFor)
 * from the BridgeContext this returns.
 */
export function buildBridgeContext(args: {
  /** Every plan entry before the next story, in plan order (prev is the last of these). */
  earlier: LibraryUnit[];
  prev: LibraryUnit;
  next: LibraryUnit;
  /** The plan's closing story unit (the sequenced climax when there is one). */
  closing: LibraryUnit | null;
  /** The plan's mid-drive hook subject (a real story entry between departure and closing). */
  mid: LibraryUnit | null;
  /** How many stories the plan carries. */
  storyCount: number;
  /** A previously-heard subject on this route's ground, drawn from the caller's heard input only. */
  previouslyHeardSubject?: string | null;
  /** The matched prior drive (addendum 2), or null when no record matched. */
  priorDrive?: { threadTopic: string | null; stillOwedSubjects: string[] } | null;
  thread: RouteThread | null;
  isFirstBridge: boolean;
  isClimaxBridge: boolean;
  /** True when the climax was sequenced last, so its incoming bridge is the payoff. */
  climaxLast?: boolean;
  /** The plan's climax as the preview teases it (addendum 4), or null. */
  climax?: { subject: string; mode: 'destination' | 'late' | 'natural'; sequenced: boolean } | null;
  /** The bookend pairing (addendum 5), or null when the shelf offered none. */
  bookend?: { openingSubject: string; sharedTopic: string } | null;
  destinationName: string;
  promiseMade: boolean;
}): BridgeContext {
  const {
    earlier,
    prev,
    next,
    closing,
    mid,
    storyCount,
    previouslyHeardSubject,
    priorDrive,
    thread,
    isFirstBridge,
    isClimaxBridge,
    climaxLast,
    climax,
    bookend,
    destinationName,
    promiseMade,
  } = args;
  // The first bridge is always the preview — even when it is
  // also the bridge into the climax (a two-story plan has only
  // the one bridge, and it has to do the drawing-in). The
  // bridge into a SEQUENCED climax is the payoff, thread or
  // not: it owes the preview its closing beat.
  const role: BridgeContext['role'] = isFirstBridge
    ? 'opening'
    : isClimaxBridge && climaxLast
      ? 'payoff'
      : 'mid';
  const ctx: BridgeContext = {
    threadTopic: thread?.topic ?? null,
    prevSubject: prev.placeName,
    prevGist: storyGist(prev),
    nextSubject: next.placeName,
    role,
  };
  if (role === 'opening') {
    ctx.destinationName = destinationName;
    ctx.storyCount = storyCount;
    if (closing) ctx.closingSubject = closing.placeName;
    if (climax) {
      ctx.climaxSubject = climax.subject;
      ctx.climaxMode = climax.mode;
    }
    if (bookend) {
      ctx.openingSubject = bookend.openingSubject;
      ctx.bookendTopic = bookend.sharedTopic;
    }
    if (thread && mid && mid.placeName !== ctx.closingSubject) {
      ctx.midSubject = mid.placeName;
      const gist = storyGist(mid);
      if (gist && gist.length <= 110) ctx.midGist = gist;
    }
    if (previouslyHeardSubject) ctx.previouslyHeardSubject = previouslyHeardSubject;
    if (priorDrive && (priorDrive.threadTopic !== null || priorDrive.stillOwedSubjects.length > 0)) {
      ctx.priorDrive = priorDrive;
    }
  }
  if (role === 'payoff') {
    ctx.promiseMade = promiseMade;
    if (bookend) {
      ctx.openingSubject = bookend.openingSubject;
      ctx.bookendTopic = bookend.sharedTopic;
    }
  }
  if (!thread) return ctx;
  if (role === 'mid') {
    // Callbacks reference ONLY items actually earlier in this
    // plan (the most recent first), and the connection must be
    // real: the thread topic, or a topic shared with what's next.
    const nextTopics = new Set(next.topics);
    const shares = (u: LibraryUnit) => u.topics.includes(thread.topic) || u.topics.some(t => nextTopics.has(t));
    const cb = [...earlier].reverse().find(u => u.id !== next.id && shares(u));
    if (cb) ctx.callbackSubject = cb.placeName;
  }
  return ctx;
}


/**
 * Bridge skip-fallback: a bridge whose plan-time render failed
 * (ready === false) is dropped outright — playback goes straight
 * into the next Miles story. Never a retry, never a live fallback.
 */
export function applyBridgeFallback(plan: RoutePlan): RoutePlan {
  const items = plan.items.filter(it => !(it.kind === 'bridge' && !it.ready));
  return { ...plan, items, totalSec: items.reduce((s, it) => s + it.durationSec, 0) };
}

/**
 * The composition budget (Erik, Nov 3, 2026: ride duration
 * replaces Arrive-by). The Routes API's estimated drive time is
 * the SOLE budget source — the intake no longer solicits an
 * arrival time, and a typed "by <time>" clause, though the parser
 * still reads it, never reaches the budget. Falls back to a
 * 30-minute tile when no estimate exists.
 */
export function budgetSecFor(driveSec: number | null): number {
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

/**
 * The wrap-up's facts (addendum 3), assembled from the plan
 * alone: destination + thread + the climax the plan was
 * composed around (addendum 4) + the bookend pairing when
 * the shelf offered one (addendum 5). Deliberately nothing
 * else — no played set exists at preparation time, and none
 * may leak in later: the wrap-up speaks the episode's arc,
 * never a recap. The text itself is authored in the
 * narration layer (narration.wrapUpTextFor) from this
 * context.
 */
export function buildWrapUpContext(plan: RoutePlan): WrapUpContext {
  return {
    destinationName: plan.destinationName,
    threadTopic: plan.thread?.topic ?? null,
    climaxMode: plan.climaxMode ?? 'natural',
    climaxSubject: plan.climaxSubject ?? null,
    bookend:
      plan.bookend && plan.openingSubject && plan.bookendTopic && plan.climaxSubject
        ? {
            openingSubject: plan.openingSubject,
            sharedTopic: plan.bookendTopic,
            climaxSubject: plan.climaxSubject,
          }
        : null,
  };
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
 * Why a live maps call produced nothing (Nov 3, 2026 — the
 * failure-class split Erik's first stationary test forced):
 * 'permission' = every configured key was blocked for this API
 * (403 / PERMISSION_DENIED — a key-restriction problem, NOT a bad
 * query); 'no_results' = a key answered fine and the API simply
 * has nothing for the query; 'http' / 'network' = transport-level
 * failure; 'no_keys' = no Google key is configured at all. The App
 * speaks these differently — a permission failure must never
 * masquerade as "couldn't find that place" again — and files the
 * class to telemetry so the next one is visible in analytics.
 */
export type MapsFailure = 'permission' | 'no_results' | 'http' | 'network' | 'no_keys';

export interface GeocodeOutcome {
  destination: GeocodedDestination | null;
  /** Null on success; otherwise the failure class above. */
  failure: MapsFailure | null;
}

export interface RouteOutcome {
  route: ComputedRoute | null;
  /** Null on success; otherwise the failure class above. */
  failure: MapsFailure | null;
}

/**
 * The configured Google keys, deduped, blanks dropped. The bundle
 * carries several keys whose API-restriction lists DIFFER (Nov 3,
 * 2026, probe-verified): the key named Places is 403-blocked for
 * Places (New) searchText while the second key allows it, and
 * Routes sits on the first key's list. So no single key can be
 * "the" maps key — every live call tries each configured key in
 * order until one answers, and a 403 moves to the next key rather
 * than failing the call. Key selection is per call: Places and
 * Routes may legitimately succeed on different keys in one build.
 * Exported for the route gap-fill discovery (routeGapFill.ts),
 * which walks the same list for its Places calls — never a
 * single-key call anywhere in route mode.
 */
export function configuredKeys(apiKeys: string[]): string[] {
  return [...new Set(apiKeys.map(k => (typeof k === 'string' ? k.trim() : '')).filter(k => k.length > 0))];
}

/** Classify a non-ok response: 403 / PERMISSION_DENIED is a key-restriction block. */
function classifyHttpFailure(status: number | undefined, errorStatus: string | undefined): MapsFailure {
  if (status === 403 || errorStatus === 'PERMISSION_DENIED') return 'permission';
  return 'http';
}

/** Merge a new attempt's failure into the running one: 'permission' is sticky (it is the actionable class). */
function mergeFailure(current: MapsFailure, next: MapsFailure): MapsFailure {
  if (current === 'permission' || next === 'permission') return 'permission';
  return next;
}

/**
 * Places (New) text search for the destination, across ALL
 * configured keys (see configuredKeys). Returns the top candidate
 * from the first key that answers; a key that answers with zero
 * places is definitive ('no_results') — later keys are not tried
 * for a query the service itself rejected as empty.
 */
export async function geocodeDestination(
  query: string,
  apiKeys: string[],
  fetchFn: typeof fetch = fetch,
): Promise<GeocodeOutcome> {
  const keys = configuredKeys(apiKeys);
  if (keys.length === 0) return { destination: null, failure: 'no_keys' };
  let failure: MapsFailure = 'network';
  for (const apiKey of keys) {
    let res: Response;
    try {
      res = await fetchFn('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress',
        },
        body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
      });
    } catch {
      failure = mergeFailure(failure, 'network');
      continue;
    }
    if (!res.ok) {
      let errorStatus: string | undefined;
      try {
        const body = (await res.json()) as { error?: { status?: string } };
        errorStatus = body?.error?.status;
      } catch {
        /* classification falls back to the HTTP status alone */
      }
      failure = mergeFailure(failure, classifyHttpFailure(res.status, errorStatus));
      continue;
    }
    let parsed: {
      places?: { displayName?: { text?: string }; location?: { latitude?: number; longitude?: number }; formattedAddress?: string }[];
    };
    try {
      parsed = (await res.json()) as typeof parsed;
    } catch {
      failure = mergeFailure(failure, 'http');
      continue;
    }
    const p = parsed.places?.[0];
    if (!p?.displayName?.text || p.location?.latitude === undefined || p.location?.longitude === undefined) {
      return { destination: null, failure: 'no_results' };
    }
    return {
      destination: {
        name: p.displayName.text,
        address: p.formattedAddress ?? null,
        location: { lat: p.location.latitude, lng: p.location.longitude },
      },
      failure: null,
    };
  }
  return { destination: null, failure };
}

export interface ComputedRoute {
  path: GeoPoint[];
  distanceMeters: number;
  durationSec: number;
}

/**
 * Routes API computeRoutes with traffic (TRAFFIC_AWARE), DRIVE
 * mode, across ALL configured keys (see configuredKeys — Routes
 * was added to one key's restriction list Nov 2, 2026, Places
 * (New) evidently sits on another's; a 403 tries the next key).
 * A key that answers with no route is definitive ('no_results').
 */
export async function computeRoute(
  origin: GeoPoint,
  destination: GeoPoint,
  apiKeys: string[],
  fetchFn: typeof fetch = fetch,
): Promise<RouteOutcome> {
  const keys = configuredKeys(apiKeys);
  if (keys.length === 0) return { route: null, failure: 'no_keys' };
  let failure: MapsFailure = 'network';
  for (const apiKey of keys) {
    let res: Response;
    try {
      res = await fetchFn('https://routes.googleapis.com/directions/v2:computeRoutes', {
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
    } catch {
      failure = mergeFailure(failure, 'network');
      continue;
    }
    if (!res.ok) {
      let errorStatus: string | undefined;
      try {
        const body = (await res.json()) as { error?: { status?: string } };
        errorStatus = body?.error?.status;
      } catch {
        /* classification falls back to the HTTP status alone */
      }
      failure = mergeFailure(failure, classifyHttpFailure(res.status, errorStatus));
      continue;
    }
    let parsed: {
      routes?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[];
    };
    try {
      parsed = (await res.json()) as typeof parsed;
    } catch {
      failure = mergeFailure(failure, 'http');
      continue;
    }
    const r = parsed.routes?.[0];
    if (!r?.polyline?.encodedPolyline) return { route: null, failure: 'no_results' };
    const dur = r.duration ? parseInt(r.duration.replace('s', ''), 10) : 0;
    return {
      route: {
        path: decodePolyline(r.polyline.encodedPolyline),
        distanceMeters: r.distanceMeters ?? 0,
        durationSec: Number.isFinite(dur) ? dur : 0,
      },
      failure: null,
    };
  }
  return { route: null, failure };
}

/**
 * The ride estimate in plain words (Erik, Nov 3, 2026 — the
 * Routes drive-time estimate replaces the Arrive-by input):
 * shown in the building state once the route has computed.
 */
export function rideEstimateLine(durationSec: number): string {
  const mins = Math.max(1, Math.round(durationSec / 60));
  if (mins < 60) return `About ${mins} minute${mins === 1 ? '' : 's'} of driving — Miles will fill the ride.`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const span = m === 0 ? `${h} hour${h === 1 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'} ${m} minute${m === 1 ? '' : 's'}`;
  return `About ${span} of driving — Miles will fill the ride.`;
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
