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
import { normalizePlaceName, selectPriorDrive, type RouteDriveRecord } from './routeHistory';

// The place-name normalizer is part of this module's caller
// contract (ComposeOptions.corridorTellingCounts is keyed by
// it), so it is re-exported here: a caller building telling
// counts uses the exact function the composer looks up with.
export { normalizePlaceName } from './routeHistory';
import {
  bridgeTextFor,
  previewTextFor,
  spokenFormText,
  newBridgeEpisodeState,
  bridgeEpisodeStateFromTexts,
  BRIDGE_CONNECTIVE_LINES,
  REACTION_BANK,
  type BridgeContext,
  type BridgeEpisodeState,
  type NarrationVoice,
  type PreviewContext,
  type WrapUpContext,
} from './narration';

// The narration text layer lives in the narration seam
// (addendum 5); these re-exports keep its long-standing
// import surface.
export {
  bridgeTextFor,
  previewTextFor,
  spokenFormText,
  newBridgeEpisodeState,
  bridgeEpisodeStateFromTexts,
  BRIDGE_CONNECTIVE_LINES,
  REACTION_BANK,
  type BridgeContext,
  type BridgeEpisodeState,
  type PreviewContext,
};

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
// into it (a weighting nudge, never an override), the plan's
// strongest late story is sequenced as its climax (addendum 4:
// NOT destination-geared — a commute's climax is its strongest
// late story, not its workplace), and the episode is framed by
// its own preview item up front and its ONE prepared wrap-up
// at the end. Bridges carry real connective context between
// their pairs — mid bridges may call back an earlier story on
// the same thread, and the bridge into the climax pays the
// preview's promise off. No thread → composition is exactly
// composer v2, bridges included.
//
// The consolidation (Erik, Nov 3, 2026, ~21:57–22:03) then
// codified the differentiator layer as ONE priority ladder —
// see the composeRoutePlan doc comment — promoted the preview
// to its own plan item, cut the climax fit-term and the
// opening↔climax pairing preference (raw weight + thread boost
// decide the climax again), and opened the climax slot to ONE
// off-route portal story when it clearly beats the road's own
// best (the portal climax, below).

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

/**
 * Audience coloring (Nov 5, 2026): the episode's rating axis.
 * 'standard' is the full telling — today's composition, plus
 * the Color Puck persona's adult-licensed tissue (routeColor).
 * 'family' is the G-rated telling: selection is steered by the
 * family classes below and the color prompt never runs. The
 * axis is a boundary around selection, never a license over
 * doctrine — D4 stays excluded at every setting, memorial
 * material keeps its register at every setting.
 */
export type RouteAudience = 'standard' | 'family';

export interface RouteInput {
  /** Raw plain-language destination text from the intake form. */
  destinationText: string;
  /** Optional time-of-arrival, epoch ms. Null = tile to the drive. */
  arrivalTimeMs: number | null;
  /** Per-trip mood, from the closed tone vocabulary (or null). */
  tone: string | null;
  /** Requested topics (tag vocabulary, e.g. 'Food & Drink'). */
  topics: string[];
  /** Audience coloring; absent = 'standard'. Set by the intake control only — never parsed from prose in v1. */
  audience?: RouteAudience;
}

export interface ParsedRouteInput {
  destinationText: string;
  arrivalTimeMs: number | null;
  tone: string | null;
  topics: string[];
  /** Audience coloring, resolved: the parse never sets it, so it is 'standard' until the App merges the control's value. */
  audience: RouteAudience;
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
  // Audience is control-only in v1 (coloring scope, Decision on
  // the selector): the parse never reads a rating out of prose,
  // so every parse resolves to 'standard' and the App merges
  // the intake control's value over it.
  return { destinationText, arrivalTimeMs, tone, topics, audience: 'standard' };
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
  /**
   * Woven eligibility (Nov 4, 2026 — seated members): the
   * story's presence register lets it be heard OFF its ground
   * as a through-line member (the presence audit's weave-safe
   * + mixed classes, Protected register excluded). Baked in by
   * the caller from the bundled presence data (src/data/
   * routePresence, keyed place_key|angle exactly like the
   * route tags), the same way topics/tone ride in. Absent =
   * not eligible: geo tiling never reads this field, and a
   * unit without it can never seat as a woven member or lend
   * the thread its support.
   */
  wovenEligible?: boolean;
  /**
   * Protected register (presence audit, Nov 4, 2026): the
   * shelf's most sensitive register, baked in by the caller
   * from the same bundled presence data as wovenEligible.
   * Geo tiling never reads it in Standard (a Protected story
   * may still tile on its own ground); the Family coloring
   * hard-excludes it from every seat, and the color persona
   * never riffs on it. Absent = not Protected.
   */
  protectedRegister?: boolean;
  /**
   * Generated-rating stamp (audience coloring, Nov 5, 2026):
   * for a story the Coverage Guarantee generated and promoted
   * to the shelf (-route-gap audio keys), the rating it was
   * generated UNDER — derived by the caller from the audio
   * key's marker (see generatedRatingForAudioPath), since the
   * key is the one field that survives promotion. A Family
   * build treats a 'standard'-stamped row as gray-zone (it is
   * fixed audio a Family prompt never vetted); a 'family'
   * stamp is clean anywhere. Absent/null = a shelf original,
   * never generated.
   */
  generatedRating?: RouteAudience | null;
}

// ------------------------------------------------------------ audience coloring: the family classes

/**
 * The Family classification of one unit (audience coloring,
 * Nov 5, 2026), from the signals the shelf actually carries —
 * topics, tone in either slot, the angle name, the Protected
 * register, and the generated-rating stamp. Tags describe a
 * story's mood and subject, not its content; this is a
 * statistical boundary built on exactly those signals, and
 * the scope's honest limit stands: a warm-tagged story can
 * still carry a dark passage, and v1 accepts that knowingly.
 *
 *  - 'hard' — never seats in a Family episode, in any lane:
 *    Protected register, primary tone spooky, or the
 *    landmark_scandal angle (the shelf's own name for its
 *    vice/scandal tellings).
 *  - 'gray' — de-preferred below every clean candidate in
 *    every Family ranking, and gist-suppressed if seated:
 *    spooky or somber in either tone slot, the
 *    landmark_legends angle, the folklore topic, or a
 *    Standard-stamped promoted gap story.
 *  - 'clean' — everything else.
 */
export type FamilyClass = 'hard' | 'gray' | 'clean';

export function familyClassOf(u: LibraryUnit): FamilyClass {
  if (u.protectedRegister === true) return 'hard';
  if (u.tone === 'spooky') return 'hard';
  if (u.angle === 'landmark_scandal') return 'hard';
  if (u.tone === 'somber' || u.toneSecondary === 'spooky' || u.toneSecondary === 'somber') return 'gray';
  if (u.angle === 'landmark_legends') return 'gray';
  if (u.topics.includes('folklore')) return 'gray';
  if (u.generatedRating === 'standard') return 'gray';
  return 'clean';
}

/** Family hard-exclusion: the unit may not seat in a Family episode, in any lane. */
export function familyHardExcluded(u: LibraryUnit): boolean {
  return familyClassOf(u) === 'hard';
}

/**
 * The Family rank term: clean (0) below gray (1). Hard units
 * also read 1 — they never reach a ranking (the partition
 * removes them first), so the term never has to carry them.
 * Callers gate this term on the build actually being Family:
 * in a Standard build it must contribute exactly 0 to every
 * sort, or composition parity breaks.
 */
export function familyRankOf(u: LibraryUnit): number {
  return familyClassOf(u) === 'clean' ? 0 : 1;
}

/**
 * The tone a build actually steers by (coloring scope,
 * Decision 7): under Family, a spooky or somber tone pick
 * STANDS DOWN — the rating is a boundary and tone steers
 * inside it, never toward the gray classes the boundary
 * de-prefers. Every other combination passes through
 * untouched, so Standard ranking is exactly today's.
 */
export function effectiveRouteTone(input: ParsedRouteInput): string | null {
  if (input.audience === 'family' && (input.tone === 'spooky' || input.tone === 'somber')) return null;
  return input.tone;
}

/**
 * Color-suppression class (adult license guardrail, Nov 5,
 * 2026): the color persona NEVER riffs on or immediately
 * after memorial/somber material. The mechanical reading of
 * that class from the shelf's signals: somber or spooky in
 * either tone slot (the memorial register's neighborhood —
 * PSA 182's telling is somber-class), Protected register, or
 * the scandal angle. A story in this class simply gets no
 * color beat; Miles hosts past it straight.
 */
export function colorSuppressedFor(u: LibraryUnit): boolean {
  if (u.protectedRegister === true) return true;
  if (u.angle === 'landmark_scandal') return true;
  return u.tone === 'somber' || u.tone === 'spooky' || u.toneSecondary === 'somber' || u.toneSecondary === 'spooky';
}

/** The audio-key marker a Family-generated gap story is promoted under (backend.ingestRouteGapStory). */
export const GAP_FAMILY_MARKER = '-route-gap-fam-v1';
/** The audio-key marker every other generated gap story carries (pre-feature rows included). */
export const GAP_STANDARD_MARKER = '-route-gap-v1';

/**
 * The generated-rating stamp a shelf row carries, read off
 * its audio key — the one field that survives promotion, so
 * it is where the stamp lives. A generated row with no
 * family marker reads 'standard': pre-feature promotions
 * were generated under no rating at all, and the safe
 * direction for a Family build is to treat unvettable fixed
 * audio as Standard-stamped (gray), never as Family-clean.
 * Null = not a generated row.
 */
export function generatedRatingForAudioPath(audioPath: string | null): RouteAudience | null {
  if (!audioPath) return null;
  if (audioPath.includes(GAP_FAMILY_MARKER)) return 'family';
  if (audioPath.includes(GAP_STANDARD_MARKER)) return 'standard';
  return null;
}

/** Spoken English ≈ 150 wpm; a shelf story's duration estimate. */
export function estimateDurationSec(text: string | null, fallbackSec = 150): number {
  if (!text) return fallbackSec;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return fallbackSec;
  return Math.max(20, Math.round((words / 150) * 60));
}

/**
 * Story-level heard keys (composer v3.1, Erik, Nov 4, 2026):
 * the route build's heard set, derived from the heard ledger's
 * own filed evidence. The ledger (heard_stories) stores no
 * (place, angle) key — each telling is filed under its label
 * with the telling's VERBATIM story text (backend.recordHeard).
 * A route-recorded telling files the unit's canonical
 * story_text, and a freeform shelf serve files the same
 * canonical text, so an exact text match identifies the one
 * (place, angle) story that was heard — and only that one. An
 * unheard angle of a heard place carries a different text and
 * stays selectable: the angle depth is what the shelf's three
 * angles are FOR. (The pre-v3.1 derivation keyed exclusion on
 * the place NAME — one telling killed the whole place — and
 * the v3 grader showed it starving repeat commutes: the
 * candidate window never widened no matter how deep the shelf
 * grew.) Units without text cannot be matched and are never
 * excluded by this derivation; ledger texts that match no unit
 * (live-generated freeform tellings) exclude nothing — a
 * generated telling is not any specific shelf story.
 */
export function heardKeysForStories(
  units: LibraryUnit[],
  heardStoryTexts: ReadonlySet<string>,
): Set<string> {
  const keys = new Set<string>();
  if (heardStoryTexts.size === 0) return keys;
  for (const u of units) {
    if (u.storyText !== null && heardStoryTexts.has(u.storyText)) keys.add(u.id);
  }
  return keys;
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
 * narration last.
 */
export function angleClassRank(angle: string): number {
  return angle === 'corridor' ? 1 : 0;
}

// ------------------------------------------------------------ composer v3: acts (commit B)

/** The opening act ends here; the climax act is the existing climax zone (CLIMAX_ZONE_START). */
export const ACT_OPENING_END = 0.15;

/**
 * Act index by drive progress (composer v3, Erik, Nov 3,
 * 2026): 0 = opening (the first ~15% of the drive), 1 = the
 * middle chapters (the decile structure the fetch already
 * sweeps), 2 = the climax act (the final third — the same
 * zone the climax rung reads). Acts structure the BASE rung
 * only; the thread and climax rungs keep their precedence.
 */
export function actIndexForProgress(progress: number): number {
  if (progress < ACT_OPENING_END) return 0;
  if (progress < CLIMAX_ZONE_START) return 1;
  return 2;
}

/** One act's line in a plan's acts summary (carried into the decisions record). */
export interface ActSummary {
  /** Story items seated in the act. */
  stories: number;
  landmark: number;
  corridor: number;
  /** A corridor-class candidate yielded to a stronger same-act candidate while this act was tiled. */
  floorSub: boolean;
}

export interface ActsSummary {
  opening: ActSummary;
  middle: ActSummary;
  climax: ActSummary;
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

/**
 * The serial sounding model's pace safety factor (field fix
 * lane 2, Nov 5, 2026). Windows live in route PROGRESS; items
 * sound in sequence TIME; the two meet only through pace, and
 * real pace outruns the Routes average on freeway stretches —
 * the field drive's first stories burned roughly a quarter
 * again as much ground as the expected-time map allowed.
 * Doom judgments (below, and the composer's portal repair)
 * therefore evaluate a story's start at 1.25× the expected
 * pace: a placement that only works at exactly the predicted
 * pace is not a placement that works.
 */
export const SERIAL_PACE_SAFETY = 1.25;
/** The serial model's tissue estimates, seconds (the preview is ~30 s as authored; a post-lane-1 bridge is its facts at honest length; a reaction is a bank line). */
export const SERIAL_PREVIEW_EST_SEC = 30;
export const SERIAL_BRIDGE_EST_SEC = 20;
export const SERIAL_REACTION_EST_SEC = 5;
/** Portal share cap (item 4): portals ≤ ¼ of the plan's story items ⟺ portals ≤ geoStories / 3. */
export const PORTAL_CAP_DIVISOR = 3;

/**
 * Woven twins (field fix lane 4, Nov 5, 2026): a twin is the
 * ABOUT-register telling of a place+angle — its angle is the
 * source angle + '-woven-v1' (the tranche convention; tour.ts
 * keeps freeform off them by the same suffix). Portal seats
 * prefer the twin of the same place+angle when the pool
 * carries one: an off-route story should be told in the
 * register that does not pretend the driver is there. The
 * helpers are local to this module (tour's stay private to
 * freeform).
 */
export const WOVEN_TWIN_SUFFIX = '-woven-v1';

export function isWovenTwinAngle(angle: string): boolean {
  return angle.endsWith(WOVEN_TWIN_SUFFIX);
}

/** "placeKey|baseAngle" → the woven twin unit a pool carries for it, when it carries one. */
function wovenTwinsByBase(pool: LibraryUnit[]): Map<string, LibraryUnit> {
  const map = new Map<string, LibraryUnit>();
  for (const u of pool) {
    if (isWovenTwinAngle(u.angle)) {
      map.set(`${u.placeKey}|${u.angle.slice(0, -WOVEN_TWIN_SUFFIX.length)}`, u);
    }
  }
  return map;
}

/** True when a pool unit is a presence original whose woven twin stands in the same pool (the twin is the candidate). */
function shadowedByTwin(u: LibraryUnit, twins: Map<string, LibraryUnit>): boolean {
  return !isWovenTwinAngle(u.angle) && twins.has(`${u.placeKey}|${u.angle}`);
}

/**
 * Corridor membership radii (fetch order + composer partition
 * + guarantee fill all read these, so the three never drift):
 * the path radius for corridor rows and every non-landmark
 * angle; the widened path radius for landmark-class rows
 * (Nov 4, 2026, addendum B — doubled from the standing
 * 1.5 km); and the destination circle, which stays at the
 * standing radius for every class.
 */
export const CORRIDOR_PATH_RADIUS_M = 1500;
export const LANDMARK_PATH_RADIUS_M = 3000;
export const DESTINATION_RADIUS_M = 1500;

/**
 * Corridor lifetime cap (Nov 4, 2026, addendum B): a corridor
 * stretch may be told at most this many times EVER, across
 * all its angles, counted from the cross-day heard ledger.
 * At the cap its corridor rows retire from route candidacy.
 * Route-side predicate only — the ledger and freeform's
 * corridor use are unchanged.
 */
export const CORRIDOR_TELLING_CAP = 3;

/** Departure row-read bounds (item 1 + item 4): see selectFetchCandidates. */
export const FETCH_GEO_LIMIT = 120;
export const FETCH_PORTAL_LIMIT = 30;

/**
 * Heard-aware fetch bounds (composer v3.1, commit B): the
 * fetch no longer stops at a fixed row count — it reads until
 * each progress decile holds this many UNHEARD candidates
 * (12 × 10 deciles = 120, exactly the old geo cap on a fresh
 * shelf: no gratuitous over-fetch), or the hard read ceiling
 * binds. The ceiling is 3.75× the old cap: the v3 grader's
 * cliff showed a repeat commuter's window holding ~150 rows
 * of which nearly all are heard, so refilling 120 unheard
 * slots must reach several times deeper into the fair order;
 * 450 bounds that reach while keeping the worst case a
 * bounded, chunk-parallel set of small index reads. Portals
 * mirror the shape at their scale: the old 30 cap as the
 * unheard target, twice that as the read ceiling.
 */
export const FETCH_UNHEARD_PER_DECILE = 12;
export const FETCH_GEO_READ_CEILING = 450;
export const FETCH_PORTAL_UNHEARD_TARGET = 30;
export const FETCH_PORTAL_READ_CEILING = 60;

export interface FetchIndexEntry {
  place_key: string;
  angle: string;
  lat: number;
  lng: number;
}

const FETCH_EXCLUDED_ANGLES = new Set(['neighborhood_intro_greet', 'filler', 'filler_hosted']);

/**
 * The departure fetch ORDER (composer v2 fairness; the
 * ordering half of the fetch plan, split out in v3.1): every
 * candidate the build may read, in the order it should read
 * them. Pure given a tags lookup, so the harness proves the
 * fairness on synthetic shelves.
 *
 * Geographic candidates (story angles + plain intros inside
 * the corridor radius) are ordered FAIRLY — round-robin
 * across path-progress deciles — so a dense route start
 * cannot crowd out the back half of the drive the way the
 * phase-1 first-60 cap did. Portal candidates (story angles
 * OUTSIDE the corridor) are ranked by topic overlap with the
 * geographic pool's topics plus any user-chosen topics; at
 * least one shared topic is required.
 *
 * The radius is class-aware (Nov 4, 2026, addendum B):
 * landmark-class entries are geographic out to
 * LANDMARK_PATH_RADIUS_M of the path — a landmark the driver
 * keeps passing should be candidated as route material —
 * while corridor rows and every other angle stay bound to
 * CORRIDOR_PATH_RADIUS_M (a corridor row is about the road
 * itself). The destination circle stays DESTINATION_RADIUS_M
 * for every class: destination proximity is a different claim
 * than passing something along the way.
 *
 * Uncapped: how much of each order actually gets read is the
 * heard-aware driver's decision (fetchHeardAwareCandidates);
 * selectFetchCandidates below keeps the original bounded
 * prefix for callers that want the v2 behavior.
 */
export function orderFetchCandidates(
  entries: FetchIndexEntry[],
  path: GeoPoint[],
  destination: GeoPoint,
  tagsOf: (placeKey: string, angle: string) => { topics: string[] },
  opts: { userTopics?: string[] } = {},
): { geo: FetchIndexEntry[]; portals: FetchIndexEntry[] } {
  const near = (e: FetchIndexEntry) =>
    haversineM({ lat: e.lat, lng: e.lng }, destination) <= DESTINATION_RADIUS_M ||
    distanceToPathM({ lat: e.lat, lng: e.lng }, path) <=
      (e.angle.startsWith('landmark') ? LANDMARK_PATH_RADIUS_M : CORRIDOR_PATH_RADIUS_M);
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
  for (let round = 0; ; round++) {
    let took = false;
    for (let b = 0; b < FAIRNESS_BUCKETS; b++) {
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
    .map(c => c.e);
  return { geo: ordered, portals };
}

/**
 * The bounded fetch plan (composer v2): the first ≤120
 * geographic + ≤30 portal entries of the fetch order. Kept
 * as the fixed-cap selector; the App's route build reads
 * through the heard-aware driver instead (v3.1, commit B).
 */
export function selectFetchCandidates(
  entries: FetchIndexEntry[],
  path: GeoPoint[],
  destination: GeoPoint,
  tagsOf: (placeKey: string, angle: string) => { topics: string[] },
  opts: { geoLimit?: number; portalLimit?: number; userTopics?: string[] } = {},
): FetchIndexEntry[] {
  const { geo, portals } = orderFetchCandidates(entries, path, destination, tagsOf, opts);
  return [
    ...geo.slice(0, opts.geoLimit ?? FETCH_GEO_LIMIT),
    ...portals.slice(0, opts.portalLimit ?? FETCH_PORTAL_LIMIT),
  ];
}

/** Read accounting for one departure fetch (filed on route_plan_started). */
export interface FetchReadStats {
  /** Row reads performed (geo + portal). */
  reads: number;
  geoReads: number;
  portalReads: number;
  /** Unheard candidates the fetch put in hand (geo + portal). */
  unheard: number;
  geoUnheard: number;
  portalUnheard: number;
  /** Unheard geo candidates per progress decile (FAIRNESS_BUCKETS long). */
  decileUnheard: number[];
  /** True when a read ceiling stopped the fetch while a decile (or the portal pool) still needed depth. */
  ceilingHit: boolean;
  /**
   * The member fetch (the member-fetch lever, Nov 4, 2026):
   * the ONE bounded fetch a build runs when the composed
   * plan's thread cannot seat its members from the departure
   * fetch's candidates (plan.wovenMembersSeeking). Filed by
   * the caller alongside this record — the departure fetch's
   * own counts above never include it, so the window's
   * accounting stays comparable to the pre-lever baselines.
   * Absent (or null) when no member fetch ran.
   */
  memberFetch?: { topic: string; reads: number; candidates: number } | null;
}

/**
 * The heard-aware departure fetch (composer v3.1, commit B):
 * walk the fetch order in parallel chunks, classifying each
 * read row heard/unheard by its filed story text (the same
 * predicate as heardKeysForStories), and CONTINUE past the
 * old fixed caps until every progress decile holds
 * perDecileTarget unheard candidates — or a hard read
 * ceiling binds. A decile whose target is met stops
 * consuming reads: its later entries are skipped unread, so
 * a fresh shelf stops at exactly the old caps' worth of
 * reads (120 geo + 30 portal) and only a heard-saturated
 * window reads deeper. Heard rows are returned too — the
 * composer partitions them out and the preview's
 * previously-heard nod is drawn from them, exactly as when
 * every read row was handed over.
 *
 * Deterministic: same order + same row results + same heard
 * set → same reads, same candidate set, same stats (chunk
 * boundaries never change membership, only batching). The
 * row reader is injected, so the harness and grader drive
 * this with synthetic shelves and zero live calls.
 *
 * Latency: reads run in parallel chunks of chunkSize
 * (default 12, the App's standing chunk). A fresh shelf
 * costs ~13 chunk round-trips, as before; the absolute
 * worst case (450 geo + 60 portal) is ~43 — a few extra
 * seconds at departure on a maximally heard-saturated
 * route, paid only by the commuter who needs the depth.
 */
export async function fetchHeardAwareCandidates<R>(args: {
  geoOrder: FetchIndexEntry[];
  portalOrder: FetchIndexEntry[];
  path: GeoPoint[];
  readRow: (entry: FetchIndexEntry) => Promise<R | null>;
  rowText: (row: R) => string | null;
  heardTexts: ReadonlySet<string>;
  perDecileTarget?: number;
  geoCeiling?: number;
  portalTarget?: number;
  portalCeiling?: number;
  chunkSize?: number;
}): Promise<{
  geo: { entry: FetchIndexEntry; row: R }[];
  portals: { entry: FetchIndexEntry; row: R }[];
  stats: FetchReadStats;
}> {
  const perDecileTarget = args.perDecileTarget ?? FETCH_UNHEARD_PER_DECILE;
  const geoCeiling = args.geoCeiling ?? FETCH_GEO_READ_CEILING;
  const portalTarget = args.portalTarget ?? FETCH_PORTAL_UNHEARD_TARGET;
  const portalCeiling = args.portalCeiling ?? FETCH_PORTAL_READ_CEILING;
  const chunkSize = Math.max(1, args.chunkSize ?? 12);
  const decileOf = (e: FetchIndexEntry): number =>
    progressBucket(progressAlongPath({ lat: e.lat, lng: e.lng }, args.path));
  const isHeard = (row: R): boolean => {
    const t = args.rowText(row);
    return t !== null && args.heardTexts.has(t);
  };

  const decileUnheard = new Array<number>(FAIRNESS_BUCKETS).fill(0);
  const decileRemaining = new Array<number>(FAIRNESS_BUCKETS).fill(0);
  for (const e of args.geoOrder) decileRemaining[decileOf(e)] += 1;
  const geoNeedy = (): boolean =>
    decileUnheard.some((n, b) => n < perDecileTarget && decileRemaining[b] > 0);
  const geoNeedTotal = (): number =>
    decileUnheard.reduce((s, n, b) => s + (decileRemaining[b] > 0 ? Math.max(0, perDecileTarget - n) : 0), 0);

  const geo: { entry: FetchIndexEntry; row: R }[] = [];
  let geoReads = 0;
  let cursor = 0;
  while (geoReads < geoCeiling && geoNeedy()) {
    // The next chunk: upcoming entries whose decile still
    // needs unheard depth, capped by the remaining need and
    // the remaining ceiling. Entries in satisfied deciles
    // are passed over unread.
    const want = Math.min(chunkSize, geoNeedTotal(), geoCeiling - geoReads);
    const chunk: FetchIndexEntry[] = [];
    while (cursor < args.geoOrder.length && chunk.length < want) {
      const e = args.geoOrder[cursor];
      cursor += 1;
      const b = decileOf(e);
      decileRemaining[b] -= 1;
      if (decileUnheard[b] >= perDecileTarget) continue;
      chunk.push(e);
    }
    if (chunk.length === 0) break;
    const rows = await Promise.all(chunk.map(e => args.readRow(e)));
    geoReads += chunk.length;
    for (let i = 0; i < chunk.length; i++) {
      const row = rows[i];
      if (row === null) continue;
      geo.push({ entry: chunk[i], row });
      if (!isHeard(row)) decileUnheard[decileOf(chunk[i])] += 1;
    }
  }
  const geoCeilingHit = geoReads >= geoCeiling && geoNeedy();

  const portals: { entry: FetchIndexEntry; row: R }[] = [];
  let portalReads = 0;
  let portalUnheard = 0;
  let pCursor = 0;
  while (portalReads < portalCeiling && portalUnheard < portalTarget && pCursor < args.portalOrder.length) {
    const want = Math.min(chunkSize, portalTarget - portalUnheard, portalCeiling - portalReads);
    const chunk = args.portalOrder.slice(pCursor, pCursor + want);
    pCursor += chunk.length;
    if (chunk.length === 0) break;
    const rows = await Promise.all(chunk.map(e => args.readRow(e)));
    portalReads += chunk.length;
    for (let i = 0; i < chunk.length; i++) {
      const row = rows[i];
      if (row === null) continue;
      portals.push({ entry: chunk[i], row });
      if (!isHeard(row)) portalUnheard += 1;
    }
  }
  const portalCeilingHit =
    portalReads >= portalCeiling && portalUnheard < portalTarget && pCursor < args.portalOrder.length;

  const geoUnheard = decileUnheard.reduce((s, n) => s + n, 0);
  return {
    geo,
    portals,
    stats: {
      reads: geoReads + portalReads,
      geoReads,
      portalReads,
      unheard: geoUnheard + portalUnheard,
      geoUnheard,
      portalUnheard,
      decileUnheard,
      ceilingHit: geoCeilingHit || portalCeilingHit,
    },
  };
}

// ------------------------------------------------------------ the member-fetch lever (Nov 4, 2026)

/**
 * Read cap for the ONE bounded member fetch: the climax
 * precedent spends ≤12 reads to surface ONE portal-climax
 * candidate; seating needs WOVEN_MEMBER_CAP (4) members plus
 * alternates, and a read row can still be discarded at the
 * door (heard at story level, a place collision at seating),
 * so the fetch reads toward MEMBER_FETCH_TARGET survivors
 * and never past twice the climax cap. The reads run in the
 * heard-aware driver's chunk size (12), stopping early once
 * the target is in hand.
 */
export const MEMBER_FETCH_READ_CAP = 24;
/** Seatable survivors the member fetch stops at: the 4 seats plus an alternate per seat (gap-fit and place collisions spend them). */
export const MEMBER_FETCH_TARGET = 8;

/**
 * The member fetch's sizing for a given seat need (Nov 4,
 * 2026 — generalized for thread-carried episodes): survivors
 * targeted at twice the seats (a seat plus an alternate —
 * gap-fit and place collisions spend the alternates), reads
 * capped at three times the target (the lever battery's
 * yield: roughly half the reads are spent on rows discarded
 * at the door — heard tellings the index cannot pre-filter,
 * place collisions). At the standing 4 seats this reproduces
 * the lever's constants exactly (target 8, cap 24); at the
 * thread-carried 8 seats it scales proportionally (target
 * 16, cap 48) — still ONE fetch, still bounded, still only
 * when a thread exists and local candidacy is insufficient.
 */
export function memberFetchSizing(seats: number): { readCap: number; target: number } {
  const target = seats * 2;
  return { readCap: target * 3, target };
}

/**
 * The member-fetch predicate, shared by the index counter
 * below and the fetch itself: a unit can only ever seat as
 * a woven member when it is landmark-class, woven-eligible,
 * and OFF this route's corridor — the same geometry the
 * seating pass enforces (seatWovenMembers' inCorridor: the
 * destination circle, else the landmark path radius).
 */
function isMemberGround(
  e: FetchIndexEntry,
  path: GeoPoint[],
  destination: GeoPoint,
): boolean {
  return (
    haversineM({ lat: e.lat, lng: e.lng }, destination) > DESTINATION_RADIUS_M &&
    distanceToPathM({ lat: e.lat, lng: e.lng }, path) > LANDMARK_PATH_RADIUS_M
  );
}

/**
 * Index-level thread support (the member-fetch lever): per
 * topic, how much seatable woven depth the county index
 * holds BEYOND the units already in hand — landmark-class,
 * woven-eligible, unheard (by unit id, as far as the caller
 * can know it), off-corridor entries whose id is not in
 * `fetchedIds`. The caller recomputes this before EVERY
 * compose of a build with the build's growing fetched set
 * (departure fetch ∪ climax fetch ∪ member fetch), so a
 * unit is never counted twice: once a row is in hand it is
 * real candidacy (the composer's pool, or memberUnits), not
 * index promise.
 *
 * Heard, honestly: the route heard set names tellings among
 * the units the build has READ (the ledger files story
 * texts, not index ids), so a heard telling the build never
 * fetched cannot be excluded here — support is an upper
 * bound by exactly that much. The member fetch enforces
 * true story-level heard exclusion when it reads the rows,
 * and seating re-verifies: detection may fire on the
 * promise, but only survivors ever seat.
 */
export function wovenIndexSupportByTopic(
  entries: FetchIndexEntry[],
  path: GeoPoint[],
  destination: GeoPoint,
  tagsOf: (placeKey: string, angle: string) => { topics: string[] },
  eligibleOf: (placeKey: string, angle: string) => boolean,
  opts: { fetchedIds: ReadonlySet<string>; heardIds: ReadonlySet<string> },
): Map<string, number> {
  const support = new Map<string, number>();
  for (const e of entries) {
    if (!e.angle.startsWith('landmark')) continue;
    const id = `${e.place_key}|${e.angle}`;
    if (opts.fetchedIds.has(id) || opts.heardIds.has(id)) continue;
    if (!eligibleOf(e.place_key, e.angle)) continue;
    if (!isMemberGround(e, path, destination)) continue;
    for (const t of tagsOf(e.place_key, e.angle).topics) {
      support.set(t, (support.get(t) ?? 0) + 1);
    }
  }
  return support;
}

/**
 * The member fetch's read list: index entries that could
 * seat as members of the given thread — landmark-class,
 * woven-eligible, carrying the topic, not already in hand,
 * off the corridor — in index order (the climax fetch's
 * plain-slice discipline), capped at MEMBER_FETCH_READ_CAP.
 * Heard is NOT filtered here: an index entry carries no
 * story text, so heard exclusion happens when the caller
 * reads the rows — the reads are spent either way and the
 * fetch's telemetry counts them.
 */
export function selectMemberFetchEntries(
  entries: FetchIndexEntry[],
  args: {
    topic: string;
    fetchedIds: ReadonlySet<string>;
    path: GeoPoint[];
    destination: GeoPoint;
    tagsOf: (placeKey: string, angle: string) => { topics: string[] };
    eligibleOf: (placeKey: string, angle: string) => boolean;
    cap?: number;
  },
): FetchIndexEntry[] {
  const cap = args.cap ?? MEMBER_FETCH_READ_CAP;
  const out: FetchIndexEntry[] = [];
  for (const e of entries) {
    if (out.length >= cap) break;
    if (!e.angle.startsWith('landmark')) continue;
    if (args.fetchedIds.has(`${e.place_key}|${e.angle}`)) continue;
    if (!args.eligibleOf(e.place_key, e.angle)) continue;
    if (!args.tagsOf(e.place_key, e.angle).topics.includes(args.topic)) continue;
    if (!isMemberGround(e, args.path, args.destination)) continue;
    out.push(e);
  }
  return out;
}

export type PlanItemKind = 'preview' | 'story' | 'bridge' | 'reaction' | 'filler' | 'signoff' | 'handoff';

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
  /**
   * Who speaks this tissue (narration seam): absent =
   * Miles solo. 'color-puck' marks a Color Puck piece — the
   * SAME Puck voice under the color prompt (routeColor) —
   * set by the colorize pass on the reaction-slot, aside,
   * and closeout pieces it authors. Episode capture files it
   * per item; nothing in playback branches on it (the text
   * carries the persona, the voice is one voice).
   */
  voice?: NarrationVoice;
  /**
   * Color pieces only: the story item this piece riffs on —
   * the story that JUST sounded before it. The runner's feed
   * gate reads it as a dependency: if that story dropped
   * stale, was suppressed, or settled unplayed, the color
   * piece dies with it, exactly as a doomed story's lead-in
   * bridge dies (drop coherence's discipline, applied to
   * color). Absent on every non-color item.
   */
  colorForId?: string;
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
  /** The plan's climax (addendum 4 + consolidation §4): the winner, marked in every mode. */
  climax?: boolean;
  /**
   * The off-route portal climax (consolidation §4): a story
   * from anywhere in the county that won the climax slot
   * outright. Windowless by design — it releases by sequence
   * position in the final stretch, is exempt from the corridor
   * test and from anchor stale-drop, and never consumes the
   * portal-hop budget below.
   */
  portalClimax?: boolean;
  /** Portal hop (item 4): an off-corridor story tied by topic to a chosen story. */
  portal?: boolean;
  /** For a portal item: the chosen story unit id it hangs off. */
  portalParentId?: string;
  /**
   * Woven member (Nov 4, 2026): an off-route, woven-eligible
   * story seated into a silent gap as a member of the plan's
   * through-line (seatWovenMembers). Windowless like a portal
   * — it releases by plan order — and never the climax, with
   * ONE exception: the thread-carried designation, where the
   * strongest member holds the climax position and carries
   * climax: true alongside this flag.
   */
  woven?: boolean;
  /**
   * Bridges: the anchor gap the bridge spans, in seconds (the
   * standing elastic-target formula). Bookkeeping since field
   * fix lane 1 (Nov 5, 2026): bridge TEXT no longer composes
   * toward it — a bridge is its pair's facts at honest length.
   */
  targetDurationSec?: number;
}

export interface RoutePlan {
  destinationName: string;
  destination: GeoPoint;
  path: GeoPoint[];
  /**
   * The build's audience coloring (Nov 5, 2026): the rating
   * the composer composed under, carried on the plan so the
   * post-compose passes (gap fill, member seating, colorize)
   * and the capture read ONE source. 'standard' for every
   * pre-feature caller shape.
   */
  audience: RouteAudience;
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
  /**
   * Where the thread came from (consolidation §1, for the
   * route_plan_started decisions record): 'user' when the
   * listener's own chosen topics supplied it, 'detected' when
   * the composer found it on the shelf, null with no thread.
   */
  threadSource: 'user' | 'detected' | null;
  /** The climax unit id, when the plan has one (addendum 4: not destination-geared). */
  climaxUnitId: string | null;
  /**
   * How the climax resolved (addendum 4 + consolidation §4):
   * 'destination' when the winner is a destination-area unit
   * sequenced last, 'late' when a late-corridor unit was
   * sequenced last, 'portal' when an off-route story from
   * anywhere in the county beat the road's own best and took
   * the slot, 'natural' when no repositioning happened (no
   * candidate, or sequencing it last would have stripped the
   * early drive's only coverage). 'thread' (Nov 4, 2026):
   * a thread-carried plan with no geo climax of its own —
   * the strongest on-thread member holds the climax
   * position (seatWovenMembers' designation, below).
   */
  climaxMode: 'destination' | 'late' | 'natural' | 'portal' | 'thread';
  /** The climax story's subject (place name), when the plan has one. */
  climaxSubject: string | null;
  /** Portal climax only: the winner's distance from the route, km (one decimal). */
  climaxDistanceKm: number | null;
  /**
   * Portal climax (consolidation §4): the topic the slot
   * stayed open for when no candidate in the build's fetched
   * pool cleared the bar — the App may answer it with ONE
   * additional bounded fetch (climax-only candidates) and a
   * single re-compose. Null when the slot was decided (or
   * never opened: no thread and no chosen topic).
   */
  portalClimaxSeeking: string | null;
  /**
   * Member seeking (the member-fetch lever, Nov 4, 2026):
   * the thread topic the App may answer with ONE bounded
   * member fetch (selectMemberFetchEntries) and a single
   * re-compose, when the thread's seatable members in hand
   * number fewer than WOVEN_MEMBER_CAP while the county
   * index still promises depth on the topic. Null when
   * there is no thread, when local candidacy already
   * suffices, or when no index support was supplied —
   * pre-lever callers never see it set.
   */
  wovenMembersSeeking: string | null;
  /**
   * Member seat need (Nov 4, 2026 — thread-carried sizing):
   * how many seats the ONE member fetch should provision
   * for, as sized by memberFetchSizing. WOVEN_MEMBER_CAP
   * normally; WOVEN_MEMBER_CAP_CARRIED when the composed
   * plan's own geo coverage already sits below the
   * thread-carried floor — the guarantee pass that runs
   * before the assessment can only ADD geo coverage, so a
   * plan at or above the floor here can never engage the
   * mode, and a plan below it is provisioned for the cap
   * the mode would raise. Always present; pre-carried
   * callers read exactly the standing cap.
   */
  wovenMemberNeed: number;
  /**
   * Thread-carried assessment (Nov 4, 2026): the build
   * staging's verdict on the post-guarantee plan —
   * assessThreadCarried's record (mode active, the measured
   * geo coverage fraction, the member cap seating ran
   * under). The composer never assesses (it returns null);
   * the App/grader staging sets it after the Coverage
   * Guarantee, and the runner files it in the
   * route_plan_started decisions record.
   */
  threadCarried: ThreadCarried | null;
  /**
   * The preview item's facts (consolidation §§1–2), for the
   * decisions record: whether the composed preview promises
   * the thread, carries a matched prior drive, or carries a
   * subject-level previously-heard nod. Null when the plan
   * has no preview item (no stories to frame).
   */
  previewFacts: { threadPromised: boolean; previouslyDrive: boolean; previouslySubject: boolean } | null;
  /**
   * The composed preview's own context (consolidation §2),
   * carried on the plan so a post-compose pass can
   * re-author the preview from the SAME facts — the
   * thread-carried rebuild (seatWovenMembers) reframes the
   * episode around its thread without losing the composed
   * preview's continuity nod (prior drive / previously
   * heard subject), which only this context holds. Null
   * when the plan composed no preview.
   */
  previewContext?: PreviewContext | null;
  /** The plan's opening story subject (the departure-area story), when the plan has stories. */
  openingSubject: string | null;
  /**
   * Composer v3 (commit B): the settled plan's act structure —
   * per act, the story count, the class tallies, and whether
   * the act's quality floor fired. Counted from the final
   * items at compose time; carried into the route_plan_started
   * decisions record.
   */
  actsSummary: ActsSummary;
  /**
   * Corridor lifetime cap (Nov 4, 2026 addendum B): stretches
   * whose corridor rows this plan retired at the cap, counted
   * at partition. Null when the caller supplied no telling
   * counts (the grader's worlds carry none, so its numbers
   * stay comparable to the pre-cap baselines).
   */
  corridorRetiredStretches: number | null;
  /**
   * Woven members seated into this plan (Nov 4, 2026):
   * seatWovenMembers' record — how many off-route thread
   * members the plan carries, the thread topic they were
   * seated under, and their unit ids. The composer seats
   * none, so a composed plan carries the empty record; the
   * runner files it in the route_plan_started decisions
   * record. Always present (never null) so telemetry has one
   * shape.
   */
  wovenMembers: WovenMembers;
  /**
   * Optional shelf tease for the arrival-signoff closeout, set by
   * the App after composing (an unheard, unplanned shelf unit).
   * The pure composer cannot know the shelf beyond its inputs.
   */
  shelfTease?: LibraryUnit | null;
  /**
   * The departure fetch's read accounting (composer v3.1,
   * commit B), set by the App after composition like
   * shelfTease — the pure composer never sees the network.
   * The runner files it on route_plan_started so a field
   * drive can show whether the heard-aware window fed the
   * composer or starved it.
   */
  fetchStats?: FetchReadStats | null;
  /**
   * The route-choice record (Nov 5, 2026), set by the App at
   * the pick like fetchStats — the roads the Routes call
   * returned, whether the fork picker showed, and the road
   * the episode composed on. The runner files it in the
   * route_plan_started decisions record; episode capture
   * copies it onto the plan payload. Optional: plans composed
   * outside a live build (grader worlds) carry none.
   */
  routeChoice?: RouteChoiceRecord | null;
  /**
   * The generated wrap-up (addendum 3): the closing narration
   * for the planned drive played to finish. Its TEXT is
   * authored by the App at preparation (after gap-fill) — the
   * text exists from plan-fix, like every live piece's. Its
   * AUDIO is a render-ahead queue item in the runner (last in
   * plan order), synthesized during the tour through the
   * finished-audio seam; audioUrl stays null until then (a
   * non-null audioUrl means the plan arrived with the audio
   * already rendered, and the runner adopts it as-is). Played
   * only when the tour reaches arrival with the plan run out;
   * an early end or an overrun simply never uses it. Null when
   * its text generation failed at preparation, and a failed
   * queue render falls back to the standing closeout line
   * exactly.
   */
  wrapUp?: { text: string; audioUrl: string | null } | null;
}

/** The woven members seated into a plan (see RoutePlan.wovenMembers). */
export interface WovenMembers {
  /** Member story items seated (0..WOVEN_MEMBER_CAP). */
  count: number;
  /** The thread topic the members were seated under ([] when none). */
  topics: string[];
  /** The seated members' unit ids, in plan order. */
  unitIds: string[];
}

// ------------------------------------------------------------ through-line (differentiator 2)

export interface RouteThread {
  /** The shared topic tag (routeTags vocabulary, e.g. 'Navy Century'). */
  topic: string;
  /** Unit ids of the selectable units carrying the topic — the thread's cast in hand. */
  memberIds: string[];
  /**
   * The thread's support size: the cast in hand plus, when
   * the caller supplies the county index (ComposeOptions.
   * wovenIndexSupport, the member-fetch lever, Nov 4, 2026),
   * the unheard woven-eligible depth the index holds behind
   * the cast — a thread the road can no longer sustain alone
   * is still a thread the EPISODE can sustain, because the
   * member fetch can put that depth in hand. Without index
   * support this is exactly the cast size (addendum 4).
   */
  score: number;
}

/** A thread must be sustainable: at least 3 selectable members along the path. */
export const THREAD_MIN_SCORE = 3;
/** The climax zone: the final third of drive progress (addendum 4). */
export const CLIMAX_ZONE_START = 2 / 3;
/**
 * The off-route portal climax bar (consolidation §4): a
 * county-wide candidate takes the slot only when its weight —
 * the standing sort's strength term, its telling's length —
 * beats the road's own best climax candidate by this factor.
 * Clearly beats, not edges out.
 */
export const PORTAL_CLIMAX_BAR = 1.25;
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
 * the strongest thread wins (support size, then topic name
 * for determinism). The caller passes the composer's pool, so
 * a thread can only ever be found among units the composer
 * may actually select.
 *
 * Index support (the member-fetch lever, Erik, Nov 4, 2026):
 * the optional third argument carries the county index's
 * depth per topic — unheard, woven-eligible, landmark-class,
 * off-corridor units NOT already in hand (see
 * wovenIndexSupportByTopic). A topic's support is its cast
 * in hand plus that depth, and the thread qualifies on
 * support: the production acceptance battery (54ecb95)
 * showed detection starving from ~drive 14 of a repeat
 * commute because the FETCHED set — the only pool detection
 * could see — held <3 unheard units per topic while the
 * county index held dozens. A thread detected on index
 * depth with a thin corridor cast is valid: that is exactly
 * the exhausted-corridor case the seated members exist for,
 * and the member fetch (plan.wovenMembersSeeking) is what
 * turns the index's promise into selectable units. Member
 * ids remain the cast in hand only — support is a count,
 * never a set of phantom units. Absent the argument,
 * detection is exactly the pre-lever detection.
 */
export function detectRouteThread(
  candidates: LibraryUnit[],
  userTopics: string[],
  indexSupport?: ReadonlyMap<string, number>,
): RouteThread | null {
  const byTopic = new Map<string, LibraryUnit[]>();
  for (const u of candidates) {
    for (const t of u.topics) {
      const list = byTopic.get(t) ?? [];
      list.push(u);
      byTopic.set(t, list);
    }
  }
  // A topic the fetched set holds NO cast for can still
  // qualify on index depth alone (the fully exhausted
  // corridor): its memberIds are empty until the member
  // fetch puts real units in hand.
  if (indexSupport) {
    for (const topic of indexSupport.keys()) {
      if (!byTopic.has(topic)) byTopic.set(topic, []);
    }
  }
  const qualifying = [...byTopic.entries()]
    .map(([topic, members]) => ({
      topic,
      memberIds: members.map(u => u.id),
      score: members.length + (indexSupport?.get(topic) ?? 0),
    }))
    .filter(t => t.score >= THREAD_MIN_SCORE)
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
      b.score - a.score ||
      (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0),
  );
  return qualifying[0];
}

export interface ComposeOptions {
  nowMs: number;
  /**
   * Heard keys (place_key|angle) at STORY level (composer v3.1):
   * a key names the one telling that was heard — an unheard
   * angle of a heard place is NOT in this set and stays
   * selectable. The caller derives the set from the heard
   * ledger's filed story texts (heardKeysForStories).
   */
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
   * Climax-only candidates (consolidation §4): units the
   * caller fetched in the ONE additional bounded fetch after a
   * first compose left the portal-climax slot open
   * (plan.portalClimaxSeeking). They join ONLY the portal-
   * climax evaluation pool — they never tile, never parent or
   * become portal hops, never open chapters. Absent on the
   * first compose of a build.
   */
  climaxOnlyUnits?: LibraryUnit[];
  /**
   * Member units (the member-fetch lever, Nov 4, 2026): full
   * story rows the caller fetched in the ONE bounded member
   * fetch after a compose left the plan's thread short of
   * seatable members (plan.wovenMembersSeeking), already
   * heard-filtered at read time. They join thread support as
   * real units (replacing the index promise that detected
   * the thread) and — through the caller's seating call,
   * which receives them alongside the fetched set — member
   * candidacy. They never tile, never parent or become
   * portal hops, and never join the climax pools: the member
   * fetch answers the seating pass, nothing else. Absent
   * until a build's member fetch has run.
   */
  memberUnits?: LibraryUnit[];
  /**
   * Index-level thread support (the member-fetch lever):
   * per topic, the county index's seatable woven depth NOT
   * already in hand (see wovenIndexSupportByTopic for the
   * counting rule and its heard caveat). Thread detection
   * qualifies topics on cast-in-hand plus this depth, so a
   * repeat commute's thread survives the corridor's
   * exhaustion. The caller recomputes it before every
   * compose with the build's growing fetched set; absent
   * (every pre-lever caller) detection is exactly what it
   * was, and no plan ever seeks a member fetch.
   */
  wovenIndexSupport?: ReadonlyMap<string, number>;
  /**
   * Prior route drives (addendum 2), newest first, with each
   * record's owed subjects ALREADY filtered against the current
   * heard ledger by the caller (routeHistory.stillOwedSubjects)
   * — the composer matches at most one against this build (see
   * selectPriorDrive) and feeds it to the spoken preview only.
   */
  driveRecords?: RouteDriveRecord[];
  /** The destination's library place_key when the build could derive one (addendum 2 matching). */
  destinationPlaceKey?: string | null;
  /**
   * Corridor lifetime telling counts (Nov 4, 2026, addendum
   * B): lifetime tellings per place, keyed by
   * normalizePlaceName(placeName) — the caller builds the map
   * from the cross-day heard ledger's place labels (the
   * ledger files topic = place name; see App.buildRoute). A
   * corridor stretch at CORRIDOR_TELLING_CAP retires: its
   * corridor rows leave route candidacy at partition. Absent
   * (the grader's synthetic worlds) → no retirements, and the
   * plan's corridorRetiredStretches is null.
   */
  corridorTellingCounts?: Map<string, number>;
}

/**
 * ONE static composition pass at departure (v16.1: no re-planning,
 * no live bridge generation; v2: fairness, windows, portals).
 * Library-first tiling:
 *  1. partition the shelf — geographic stories (inside the
 *     corridor radii: 3 km of path for landmark class, 1.5 km
 *     for the rest), portal candidates (stories outside it);
 *     heard units and the greet/filler/intro angles are never
 *     served by the composer itself, and corridor rows of a
 *     stretch at its lifetime telling cap are retired here;
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
 *  4. (retired Nov 4, 2026 — welcome demotion: chapter openers
 *     no longer exist in route; bridges own chapter
 *     transitions, and plain intros serve only as Coverage
 *     Guarantee fill from the fetched set);
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
 * anchored windows and the portal caps are untouched),
 * a generalized climax sequenced as the closing story when
 * the early drive stays covered without it (addendum 4: the
 * candidate set is the final third plus any destination units,
 * on equal footing — a commute's climax is its strongest late
 * story, not its workplace), picked by the composer's standing
 * weight with a thread boost, and bridge contexts carrying
 * the thread + real plan facts into the elastic bridge text.
 * With no thread and no repositionable climax, the plan's
 * items, order and windows are exactly composer v2's; only the
 * preview item differs (it frames every plan).
 *
 * THE PRIORITY LADDER (consolidation §1, Erik, Nov 3, 2026 —
 * codified, not redesigned): the differentiator layer decides
 * in exactly this order, and nothing lower re-opens what a
 * higher rung settled —
 *   (1) composer v2 base + the Coverage Guarantee: the hard
 *       constraints live here (heard exclusion, budget,
 *       release windows, corridor) and are NOT re-ordered by
 *       anything below; the guarantee pass itself runs on the
 *       composed plan in the App (routeGapFill). Within this
 *       rung, composer v3 structures selection into ACTS by
 *       progress (opening <15%, middle chapters, climax act =
 *       the final third) with a per-act quality floor: a
 *       corridor-class candidate yields to a window-feasible
 *       landmark-class, thread-member, or portal alternative
 *       in its own act. The floor only DEFERS — gated passes
 *       are followed by a gates-off mop-up in the same pick
 *       order, so a yielded candidate still seats when
 *       nothing stronger took its budget — and the settled
 *       plan carries a compact acts summary into the
 *       decisions record. ROTATION (commit C) lives inside
 *       this rung as well, BELOW the thread: preferences
 *       among the base candidates driven by this route's own
 *       drive records — place recency, second-choice wins,
 *       and a scarcity-aware climax tiebreak. Rotation never
 *       overrides heard exclusion, the budget, the windows,
 *       or the portal bar; it only chooses among candidates
 *       the higher rungs left tied or near-tied;
 *   (2) thread selection — the detected thread, or the
 *       listener's own chosen topic (detectRouteThread);
 *   (3) climax placement — the in-corridor generalized climax,
 *       or the ONE off-route portal climax that clearly beats
 *       it (consolidation §4);
 *   (4) preview / previously / wrap-up context assembly —
 *       narration facts only, assembled from the settled plan;
 *       they never feed back into selection.
 * The route_plan_started telemetry carries the ladder's
 * decisions record so any single plan can be audited against
 * this order after the fact.
 *
 * Composer v3.1 (Erik, Nov 4, 2026) changes the heard
 * predicate's granularity, nothing else in the ladder: heard
 * exclusion is STORY-level (opts.heardKeys names tellings,
 * derived by the caller from the ledger's filed texts — see
 * heardKeysForStories), so an unheard angle of a heard place
 * is a full candidate — it counts toward thread support,
 * climax eligibility and scarcity, and the portal pools —
 * while the sweep seats at most ONE telling per place per
 * plan, so the new depth spends across drives, never twice
 * in one episode. Rotation's place-level rules (recency)
 * still read the drive records' subjects: a place heard
 * yesterday yields today even when it holds an unheard
 * angle, exactly as commit C specified.
 *
 * Welcome demotion (Erik, Nov 4, 2026): plain neighborhood
 * intros no longer seat as chapter openers — the opener lane
 * (and rotation's opener-variation rule, which lived inside
 * it) retired. Bridges own chapter transitions: the item
 * builder bridges every consecutive story pair, so a seam an
 * opener used to sit on is covered by the pair bridge of the
 * stories that now stand adjacent. Intros serve a route only
 * as Coverage Guarantee fill (routeGapFill reads the fetched
 * set directly); the greet variant never tiles anywhere in
 * route. Freeform's welcome system is untouched.
 *
 * Corridor lifetime cap + landmark radius (Erik, Nov 4,
 * 2026, addendum B): a corridor stretch retires after
 * CORRIDOR_TELLING_CAP lifetime tellings across all its
 * angles (opts.corridorTellingCounts, from the caller's
 * cross-day ledger), and landmark-class candidates are
 * geographic out to twice the corridor path radius — a
 * landmark he keeps passing wins the slot over a fourth
 * telling of a highway stretch. Both are partition/fetch
 * predicates; the ladder below them is unchanged.
 *
 * Woven thread support (Erik, Nov 4, 2026): thread
 * detection's pool is the selectable geo pool UNION the
 * woven-eligible off-route units — an eligible story on a
 * topic is real support for that topic's thread even though
 * it can never tile the corridor, because the seated-
 * members pass (seatWovenMembers, which runs after the
 * Coverage Guarantee in the build staging) can seat it as
 * an episode member, and the portal-climax rung can crown
 * it. Detection with no eligibility flags anywhere is
 * exactly the pre-feature detection.
 *
 * Member-fetch lever (Erik, Nov 4, 2026): the production
 * acceptance battery showed the union above starving on a
 * repeat commute — detection and candidacy saw only the
 * FETCHED set (~53 eligible units, the same every drive),
 * while the county index the app already ships held the
 * depth (Coast 58, Navy Century 51, Food & Drink 55 at
 * audit eligibility). Detection now also counts the
 * caller-supplied index support (opts.wovenIndexSupport),
 * and a plan whose thread cannot seat WOVEN_MEMBER_CAP
 * members from what is in hand declares
 * wovenMembersSeeking: the caller answers with ONE bounded
 * member fetch (selectMemberFetchEntries — landmark-class,
 * eligible, on-topic, off-corridor, capped reads) and a
 * single re-compose with the survivors as opts.
 * memberUnits. Exactly one fetch, like the portal climax's;
 * seating rules never change, only the supply does.
 *
 * Thread-carried episodes (Erik, Nov 4, 2026): the lever's
 * acceptance battery isolated the remaining failure as a
 * COMPOSITION rule, not supply — members could fill an
 * episode's silence but never BE the episode, so a corridor
 * heard to exhaustion produced no episode at all despite a
 * detected thread and fetched members. The exhausted-case
 * rule: when the post-guarantee plan's geo-anchored
 * coverage (stories + guarantee fills, members excluded)
 * covers less than half the drive (THREAD_CARRIED_FLOOR),
 * the staging assesses the plan thread-carried
 * (assessThreadCarried) and the seating pass runs again in
 * its anchoring mode — members may anchor the episode
 * along the timeline under a raised cap, and the strongest
 * member takes the climax position when the road offered
 * none. The composer only PREDICTS the mode here (its own
 * geo coverage sets wovenMemberNeed, the seat count the
 * member fetch provisions for); the assessment itself is
 * the staging's, on the guaranteed plan. Below the floor
 * is the only behavioral delta — a geo-healthy plan is
 * composed, fetched, and seated exactly as before.
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
  // Audience coloring (Nov 5, 2026): the rating this build
  // composes under. 'family' engages the class machinery
  // below (hard-exclusion at partition, the rank term, the
  // tone stand-down, gist suppression); 'standard' leaves
  // every one of those terms at exactly zero, so a Standard
  // plan's composition is byte-identical to the pre-feature
  // composer on the same inputs.
  const audience: RouteAudience = input.audience ?? 'standard';
  const family = audience === 'family';
  const progressCache = new Map<string, number>();
  const prog = (u: LibraryUnit): number => {
    let p = progressCache.get(u.id);
    if (p === undefined) {
      p = progressAlongPath({ lat: u.lat, lng: u.lng }, path);
      progressCache.set(u.id, p);
    }
    return p;
  };
  // Corridor membership (addendum B): the same class-aware
  // radii the fetch order used — landmarks are geographic out
  // to LANDMARK_PATH_RADIUS_M of the path, corridor rows and
  // every other angle stay at CORRIDOR_PATH_RADIUS_M, and the
  // destination circle is DESTINATION_RADIUS_M for all.
  const inCorridor = (u: LibraryUnit): boolean =>
    haversineM({ lat: u.lat, lng: u.lng }, destination) <= DESTINATION_RADIUS_M ||
    distanceToPathM({ lat: u.lat, lng: u.lng }, path) <=
      (u.angle.startsWith('landmark') ? LANDMARK_PATH_RADIUS_M : CORRIDOR_PATH_RADIUS_M);

  // Corridor lifetime cap (addendum B): the stretches whose
  // corridor rows retire from this plan. A stretch's identity
  // is its place — the corridor place_key names road +
  // direction + segment endpoints, and every corridor row
  // carries exactly that one subject — while the COUNT comes
  // from the ledger's place labels, so all angles of a stretch
  // (and every re-telling of the same angle) count together.
  // Computed over the whole candidate set, heard rows
  // included: retirement is a fact about the stretch, not
  // about this plan's heard state.
  const retiredStretches = new Set<string>();
  if (opts.corridorTellingCounts) {
    for (const u of units) {
      if (u.angle !== 'corridor') continue;
      if ((opts.corridorTellingCounts.get(normalizePlaceName(u.placeName)) ?? 0) >= CORRIDOR_TELLING_CAP) {
        retiredStretches.add(u.placeKey);
      }
    }
  }

  let skippedHeard = 0;
  const geoAll: LibraryUnit[] = [];
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
    // and the filler lanes are not stories. Plain intros are
    // not route candidacy either (welcome demotion, Nov 4,
    // 2026): the chapter-opener lane retired, so an intro
    // serves a route only through the Coverage Guarantee's
    // library-first fill pool, which reads the fetched set
    // directly — never as composed chapter furniture.
    if (u.angle === 'neighborhood_intro_greet' || u.angle === 'filler' || u.angle === 'filler_hosted') continue;
    if (opts.heardKeys.has(u.id)) {
      skippedHeard += 1;
      if (u.angle !== 'neighborhood_intro' && inCorridor(u)) priorHeard.push(u);
      continue;
    }
    if (u.angle === 'neighborhood_intro') continue;
    // A retired stretch's corridor rows are out of every lane
    // — tiling, thread support, climax pools — exactly like a
    // heard exclusion, one rung of the partition.
    if (u.angle === 'corridor' && retiredStretches.has(u.placeKey)) continue;
    // Family hard-exclusion (Nov 5, 2026): under the Family
    // coloring, a hard-class unit (Protected register,
    // spooky-primary, landmark_scandal) is out of EVERY lane
    // at this same rung — it cannot tile, cannot lend thread
    // support, cannot hop, and cannot contest either climax,
    // because every one of those pools draws from geoAll /
    // portalAll below. (The climax-only fetch pool, which
    // never passes through this partition, applies the same
    // predicate at its own filter.)
    if (family && familyHardExcluded(u)) continue;
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
  //
  // Woven support (Nov 4, 2026 — seated members): the
  // detection pool also carries the WOVEN-ELIGIBLE off-route
  // units (the fetched portal pool's presence-cleared
  // members). A thread is something the EPISODE can sustain,
  // and since the seated-members build an eligible off-route
  // story on the thread's topic is real episode material —
  // it can hold a seat in a silent gap (seatWovenMembers,
  // after the Coverage Guarantee) and contest the portal
  // climax. The union is exactly the support the v3.1 woven
  // simulations (commits F + the seated follow-up) modeled:
  // thread detection over corridor ∪ woven. Units without
  // the eligibility flag (every pre-feature caller) add
  // nothing, so detection is unchanged for them.
  //
  // Member-fetch lever (Nov 4, 2026): member units the
  // caller already fetched join the support union as real
  // units, and the caller-supplied index support lets
  // detection qualify a thread on the county's depth when
  // the fetched cast runs thin — the exhausted-corridor
  // case (see detectRouteThread). With neither input,
  // detection is exactly the pre-lever detection.
  const wovenSupport = [
    ...portalAll.filter(u => u.wovenEligible === true),
    ...(opts.memberUnits ?? []).filter(u => u.wovenEligible === true),
  ];
  const thread = detectRouteThread([...pool, ...wovenSupport], input.topics, opts.wovenIndexSupport);
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

  // Rotation state (composer v3, commit C): this route's own
  // recent drives — the records relevance-tiered exactly like
  // selectPriorDrive (destination key, then destination name,
  // then thread topic), newest-first as stored, windowed to
  // the last 3. The head of the window is the immediately
  // prior drive on this route. Place identity is the
  // normalized place name, the drive records' own currency.
  const routeRecords: RouteDriveRecord[] = (() => {
    const recs = opts.driveRecords ?? [];
    if (recs.length === 0) return [];
    const key = opts.destinationPlaceKey ?? null;
    if (key) {
      const byKey = recs.filter(r => r.destinationPlaceKey !== null && r.destinationPlaceKey === key);
      if (byKey.length > 0) return byKey;
    }
    const wanted = normalizePlaceName(destinationName);
    if (wanted) {
      const byName = recs.filter(r => normalizePlaceName(r.destinationName) === wanted);
      if (byName.length > 0) return byName;
    }
    const topic = thread?.topic ?? null;
    if (topic) return recs.filter(r => r.threadTopic !== null && r.threadTopic === topic);
    return [];
  })();
  const recentRouteRecords = routeRecords.slice(0, 3);
  const playedOnLastDrive = new Set(
    (recentRouteRecords[0]?.playedSubjects ?? []).map(normalizePlaceName),
  );
  const playedRecently = new Set(recentRouteRecords.flatMap(r => r.playedSubjects).map(normalizePlaceName));

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
  // → progress. Two coloring amendments ride this rank (Nov 5,
  // 2026): the tone read is the EFFECTIVE tone (under Family a
  // spooky/somber pick stands down — see effectiveRouteTone),
  // and the Family rank term LEADS the chain in a Family build
  // — clean before gray — because the rating is the drive's
  // content boundary and tone steers inside a class; a term
  // seated after toneRank could never flip a tone-conflicted
  // pair, which is precisely the pair the de-preference
  // exists for. Gated on the build being Family, so in
  // Standard every added term is identically 0 and the chain
  // is arithmetically today's.
  const steerTone = effectiveRouteTone(input);
  const toneRank = (u: LibraryUnit): number =>
    steerTone && (u.tone === steerTone || u.toneSecondary === steerTone) ? 0 : 1;
  const familyRank = (u: LibraryUnit): number => (family ? familyRankOf(u) : 0);
  const threadRank = (u: LibraryUnit): number => (threadMemberIds.has(u.id) ? 0 : 1);
  const byRank = (a: LibraryUnit, b: LibraryUnit): number =>
    familyRank(a) - familyRank(b) ||
    toneRank(a) - toneRank(b) ||
    threadRank(a) - threadRank(b) ||
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

  // Acts (composer v3, commit B): per-act portal availability
  // for the quality floor — an off-corridor unit whose
  // projected progress falls in the act and which shares a
  // topic with the act's selectable pool counts as a portal
  // alternative for that act. Whether it ultimately hops is
  // the portal pass's business; if it never lands, the mop-up
  // sweep below can still seat the yielded candidate.
  const actOf = (u: LibraryUnit): number => actIndexForProgress(prog(u));
  const poolTopicsByAct: Set<string>[] = [new Set(), new Set(), new Set()];
  for (const u of pool) for (const t of u.topics) poolTopicsByAct[actOf(u)].add(t);
  const portalAltInAct = [false, false, false];
  for (const u of portalAll) {
    const a = actOf(u);
    if (u.topics.some(t => poolTopicsByAct[a].has(t))) portalAltInAct[a] = true;
  }
  // Floor substitutions by act: set when a bucket scan that
  // passed over a yielded candidate seats a pick instead.
  const floorSubByAct = [false, false, false];

  const chosen: LibraryUnit[] = [];
  const chosenIds = new Set<string>();
  // One telling per place per plan (composer v3.1): with
  // story-level heard granularity, a place can offer several
  // unheard angles to the SAME plan — the sweep seats at most
  // one of them. The other angles stay unheard for a future
  // drive; that rotation across drives is the depth the
  // shelf's angles exist for.
  const chosenPlaces = new Set<string>();
  // Fit-skipped candidates are consumed permanently — total
  // only grows, so a candidate that cannot fit now never fits
  // later. This is the pointer sweep's exact semantics,
  // restated as a set so the gates below can pass a candidate
  // over WITHOUT consuming it.
  const consumed = new Set<string>();
  let total = 0;
  const fitOk = (cand: LibraryUnit): boolean =>
    !Number.isFinite(budgetSec) ||
    chosen.length === 0 ||
    total + cand.durationSec <= budgetSec * 1.5;
  /**
   * The act quality floor: a corridor-class candidate that is
   * not itself carrying the thread yields while a stronger
   * candidate — landmark-class, a thread member, or a portal
   * alternative — is window-feasible in the same act (the
   * sweep's own budget-fit rule is the feasibility test).
   * Every existing cap still binds the alternative: heard
   * exclusion already partitioned it out, and budget, windows
   * and the portal caps apply downstream as before.
   */
  const floorYields = (cand: LibraryUnit): boolean => {
    if (angleClassRank(cand.angle) === 0) return false;
    if (threadMemberIds.has(cand.id)) return false;
    const a = actOf(cand);
    if (portalAltInAct[a]) return true;
    for (const alt of pool) {
      if (alt.id === cand.id || consumed.has(alt.id) || chosenIds.has(alt.id)) continue;
      if (chosenPlaces.has(alt.placeKey)) continue;
      if (actOf(alt) !== a) continue;
      if (angleClassRank(alt.angle) !== 0 && !threadMemberIds.has(alt.id)) continue;
      if (fitOk(alt)) return true;
    }
    return false;
  };
  /**
   * Rotation rule 1 (place recency): a candidate whose place
   * sounded on the immediately prior drive on this route
   * yields while a comparable alternative — a different place,
   * budget-feasible — exists in the same act. Like the floor,
   * the yield defers without consuming: the mop-up seats the
   * candidate when it is the act's only feasible tile or the
   * alternatives left budget behind.
   */
  const recencyYields = (cand: LibraryUnit): boolean => {
    if (playedOnLastDrive.size === 0) return false;
    if (!playedOnLastDrive.has(normalizePlaceName(cand.placeName))) return false;
    const a = actOf(cand);
    const candPlace = normalizePlaceName(cand.placeName);
    for (const alt of pool) {
      if (alt.id === cand.id || consumed.has(alt.id) || chosenIds.has(alt.id)) continue;
      if (chosenPlaces.has(alt.placeKey)) continue;
      if (actOf(alt) !== a) continue;
      if (normalizePlaceName(alt.placeName) === candPlace) continue;
      if (fitOk(alt)) return true;
    }
    return false;
  };
  const byRankTotal = (a: LibraryUnit, b: LibraryUnit): number =>
    byRank(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  /**
   * The strongest seatable alternative to cand in its act
   * (rotation rule 3's runner-up): unpicked, unconsumed,
   * budget-feasible, a different place, and itself passing
   * the gates — a runner-up that would only yield is no
   * runner-up. Null when cand stands alone in its act.
   */
  const bestAlternativeInAct = (cand: LibraryUnit): LibraryUnit | null => {
    const a = actOf(cand);
    const candPlace = normalizePlaceName(cand.placeName);
    let best: LibraryUnit | null = null;
    for (const alt of pool) {
      if (alt.id === cand.id || consumed.has(alt.id) || chosenIds.has(alt.id)) continue;
      if (chosenPlaces.has(alt.placeKey)) continue;
      if (actOf(alt) !== a) continue;
      if (normalizePlaceName(alt.placeName) === candPlace) continue;
      if (!fitOk(alt)) continue;
      if (floorYields(alt) || recencyYields(alt)) continue;
      if (!best || byRankTotal(alt, best) < 0) best = alt;
    }
    return best;
  };
  /**
   * One round-robin pass over the decile buckets, in the
   * pointer sweep's exact pick order (bucket by bucket, byRank
   * within, one pick per bucket per pass, fit-skips consumed).
   * With gates on, the act floor may pass a candidate over
   * without consuming it; commit C's rotation gates join it
   * here. Returns true when the pass picked or consumed
   * anything — passes repeat until one makes no progress.
   */
  const sweepPass = (gates: boolean): boolean => {
    let progressMade = false;
    // Yielders passed anywhere earlier in THIS pass: the pick
    // that follows them (usually a later bucket in the same
    // round) is the substitution they yielded to. A pass that
    // seats nothing records no substitution — the mop-up
    // resolving a deferral to the same candidate is not one.
    const passedYielders: LibraryUnit[] = [];
    for (let b = 0; b < FAIRNESS_BUCKETS; b++) {
      if (chosen.length >= maxStories) break;
      const list = buckets.get(b);
      if (!list) continue;
      for (const cand of list) {
        if (chosen.length >= maxStories) break;
        if (consumed.has(cand.id) || chosenIds.has(cand.id)) continue;
        if (chosenPlaces.has(cand.placeKey)) {
          // A sibling angle of a place this plan already tells:
          // consumed for this plan, untouched for future drives.
          consumed.add(cand.id);
          progressMade = true;
          continue;
        }
        if (Number.isFinite(budgetSec) && total >= budgetSec) {
          consumed.add(cand.id);
          progressMade = true;
          continue;
        }
        if (!fitOk(cand)) {
          consumed.add(cand.id);
          progressMade = true;
          continue;
        }
        if (gates && floorYields(cand)) {
          passedYielders.push(cand);
          continue;
        }
        if (gates && recencyYields(cand)) {
          continue;
        }
        // Rotation rule 3 (second-choice wins): a candidate
        // whose place sounded on a recent drive on this route
        // (last 3) loses its seat to the act's runner-up when
        // the margin between them is small — under 15% of the
        // top's weight (its telling's length, the composer's
        // standing weight). The loser is not consumed: it may
        // still seat later in the plan if budget remains.
        let pick = cand;
        if (gates && playedRecently.has(normalizePlaceName(cand.placeName))) {
          const runnerUp = bestAlternativeInAct(cand);
          if (runnerUp && cand.durationSec - runnerUp.durationSec < 0.15 * cand.durationSec) {
            pick = runnerUp;
          }
        }
        chosen.push(pick);
        chosenIds.add(pick.id);
        chosenPlaces.add(pick.placeKey);
        total += pick.durationSec;
        progressMade = true;
        if (gates) for (const y of passedYielders) floorSubByAct[actOf(y)] = true;
        break;
      }
    }
    return progressMade;
  };
  // Gated passes until one makes no progress, then mop-up
  // passes with every gate off: the floor defers a corridor
  // candidate — it never starves the plan of it. On a sparse
  // shelf (a single feasible candidate in an act) nothing
  // yields and the tiling is exactly the pre-acts tiling.
  while (chosen.length < maxStories && sweepPass(true)) {
    // gated rounds
  }
  while (chosen.length < maxStories && sweepPass(false)) {
    // mop-up rounds
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
  // equal footing. The winner is picked by the composer's
  // standing weight — angle class, tone, thread boost, longest
  // telling, latest ground. (The consolidation cut the
  // fit-term and the opening-pairing preference: this sort is
  // the whole rule.) The winner is sequenced LAST — moved to
  // the end of the chosen order and re-anchored into the
  // climax zone — unless it is the drive's only coverage of
  // the ground before the zone: then natural order stands and
  // the mode degrades to 'natural' (coverage beats drama, the
  // Coverage Guarantee's values in code). A winner already
  // last is sequenced without a move and keeps its natural
  // anchor. When the plan holds a single story there is
  // nothing to climax against.
  const openingUnit = chosen[0] ?? null;
  let climaxUnitId: string | null = null;
  let climaxMode: RoutePlan['climaxMode'] = 'natural';
  let climaxSubject: string | null = null;
  let climaxAnchor: number | null = null;
  let climaxSequenced = false;
  let climaxDistanceKm: number | null = null;
  let portalClimaxUnit: LibraryUnit | null = null;
  let portalClimaxSeeking: string | null = null;
  // The opening story is NOT excluded from candidacy: a
  // destination unit can anchor the drive's start and still
  // be its climax (sequencing moves it last; the next story
  // opens instead).
  const climaxCandidates = chosen.filter(
    u => prog(u) >= CLIMAX_ZONE_START || isDestinationArea(u, destination),
  );
  let climaxWinner: LibraryUnit | null = null;
  // Rotation rule 4 (climax scarcity): for each candidate,
  // count the UNHEARD story units in the fetched pool that
  // share its place or a topic — the alternatives a future
  // drive could still spend there. Among near-equal
  // candidates the plentiful place wins and the unique one is
  // saved; heard exclusion is never re-opened (heard units
  // count for nothing here, exactly as in selection).
  const climaxAltCount = new Map<string, number>();
  if (climaxCandidates.length >= 2) {
    const storyish = (u: LibraryUnit): boolean =>
      u.angle !== 'neighborhood_intro' &&
      u.angle !== 'neighborhood_intro_greet' &&
      u.angle !== 'filler' &&
      u.angle !== 'filler_hosted';
    for (const c of climaxCandidates) {
      let n = 0;
      for (const u of units) {
        if (u.id === c.id || opts.heardKeys.has(u.id) || !storyish(u)) continue;
        if (u.placeKey === c.placeKey || u.topics.some(t => c.topics.includes(t))) n += 1;
      }
      climaxAltCount.set(c.id, n);
    }
  }
  if (chosen.length >= 2 && climaxCandidates.length > 0) {
    climaxWinner = [...climaxCandidates].sort((a, b) => {
      const head =
        angleClassRank(a.angle) - angleClassRank(b.angle) ||
        familyRank(a) - familyRank(b) ||
        toneRank(a) - toneRank(b) ||
        threadRank(a) - threadRank(b);
      if (head !== 0) return head;
      // The scarcity band: weights within ~10% of each other
      // are near-equal, and remaining alternatives decide
      // before raw length does. A pairwise band is not a
      // total order, but the candidates enter the sort in
      // fixed plan order, so the outcome is deterministic.
      const band = 0.1 * Math.max(a.durationSec, b.durationSec);
      if (Math.abs(a.durationSec - b.durationSec) <= band) {
        const scar = (climaxAltCount.get(b.id) ?? 0) - (climaxAltCount.get(a.id) ?? 0);
        if (scar !== 0) return scar;
      }
      return b.durationSec - a.durationSec || prog(b) - prog(a);
    })[0];
  }

  // The off-route portal climax (consolidation §4, ladder
  // rung 3): Erik's point — something from across the county
  // that isn't on the route might still be the climax, when
  // it is the story the drive has been about. ONE per plan,
  // behind a high bar. The pool is the build's already-fetched
  // off-corridor candidates plus any climax-only units the
  // caller fetched for this slot (see ComposeOptions): unheard,
  // landmark-class, carrying the plan's thread topic — or,
  // with no thread, the listener's first chosen topic; with
  // neither, the slot never opens. The bar: the pool's best
  // must CLEARLY beat the in-corridor winner's weight (its
  // telling's length × PORTAL_CLIMAX_BAR); when the road
  // offered no late candidate at all, the strongest unit on
  // the topic takes the open slot outright.
  const portalTopic = thread?.topic ?? input.topics[0] ?? null;
  if (portalTopic !== null && chosen.length >= 1) {
    const chosenIds = new Set(chosen.map(u => u.id));
    // Lane 4: when the pool carries a place+angle's woven
    // twin, the twin is the portal-climax candidate — the
    // presence original stands down (same story, told ABOUT
    // the place instead of AT it).
    const climaxPool = [...portalAll, ...(opts.climaxOnlyUnits ?? [])];
    const climaxTwins = wovenTwinsByBase(climaxPool);
    const best =
      climaxPool
        .filter(
          u =>
            !shadowedByTwin(u, climaxTwins) &&
            !chosenIds.has(u.id) &&
            !opts.heardKeys.has(u.id) &&
            u.angle.startsWith('landmark') &&
            u.topics.includes(portalTopic) &&
            // Family (Nov 5, 2026): climax-only candidates
            // never passed the partition, so the hard
            // predicate applies here at the pool's own filter.
            (!family || !familyHardExcluded(u)),
        )
        .sort(
          (a, b) =>
            familyRank(a) - familyRank(b) ||
            b.durationSec - a.durationSec ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )[0] ?? null;
    if (best && (climaxWinner === null || best.durationSec >= climaxWinner.durationSec * PORTAL_CLIMAX_BAR)) {
      portalClimaxUnit = best;
    } else {
      // The slot stays open on this topic: the App may answer
      // with ONE additional bounded fetch (climax-only
      // candidates) and a single re-compose — never a loop.
      portalClimaxSeeking = portalTopic;
    }
  }
  if (portalClimaxUnit) {
    climaxUnitId = portalClimaxUnit.id;
    climaxSubject = portalClimaxUnit.placeName;
    climaxMode = 'portal';
    climaxSequenced = true; // it rides the sequence's tail (below)
    climaxDistanceKm =
      Math.round((distanceToPathM({ lat: portalClimaxUnit.lat, lng: portalClimaxUnit.lng }, path) / 1000) * 10) / 10;
  } else if (climaxWinner) {
    const winner = climaxWinner;
    climaxUnitId = winner.id;
    climaxSubject = winner.placeName;
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
    }
  }

  // The playback sequence: chosen stories, then portal hops
  // spliced after their parents. (Chapter openers retired with
  // the welcome demotion — bridges own the transitions now.)
  interface SeqEntry {
    unit: LibraryUnit;
    portal?: boolean;
    portalParentId?: string;
    sharedTopic?: string;
    portalClimax?: boolean;
  }
  const sequence: SeqEntry[] = chosen.map(u => ({ unit: u }));
  // The portal climax rides the sequence's tail (consolidation
  // §4): appended after the chosen order, before hops assemble
  // around it — the hop exclusions key off climaxUnitId, so the
  // tail entry is protected exactly like a sequenced
  // in-corridor winner.
  if (portalClimaxUnit) sequence.push({ unit: portalClimaxUnit, portalClimax: true });

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
    // Lane 4: a presence original whose woven twin is in the
    // pool is not scored — the twin is scored in its place
    // (its topics are inherited, its duration its own).
    const hopTwins = wovenTwinsByBase(portalAll);
    for (const cand of portalAll) {
      if (shadowedByTwin(cand, hopTwins)) continue;
      // The portal climax is never ALSO a hop: it already holds
      // the tail slot (consolidation §4).
      if (climaxUnitId !== null && cand.id === climaxUnitId) continue;
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
        b.shared - a.shared ||
        b.userOverlap - a.userOverlap ||
        // Audience coloring (Nov 5, 2026): within equally
        // thread-affine hops the family class decides before
        // the tone tie — the rating leads mood in every sort,
        // as in byRank (Standard: the term is identically 0).
        familyRank(a.cand) - familyRank(b.cand) ||
        b.toneTie - a.toneTie ||
        prog(a.parent) - prog(b.parent),
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

  // Portal placement safety (field fix lane 2, Nov 5, 2026):
  // a windowless hop sounds in sequence, so its bulk is spent
  // against every window behind it. The field episode seated
  // a 266 s hop fourth, ahead of geo stories whose windows it
  // helped burn. Repair rule: run the serial sounding model
  // (estimated tissue, SERIAL_PACE_SAFETY pace) over the
  // sequence; a windowed story doomed WITH the portals but
  // safe WITHOUT them is the portals' doing — relocate the
  // nearest hop to just after the endangered story (never
  // past the climax) when that saves it, else drop the hop
  // from the plan. Doom that exists without any portal is the
  // tiling's own fact, not this pass's to repair. Member
  // seating (seatWovenMembers) needs no twin of this pass:
  // members fit ENTIRELY inside silent gaps bounded by the
  // next story's release, and a window's slack past its
  // release is its own duration + lead — verified against
  // planDoomedStoryIds in the harness.
  {
    const serialDoom = (seq: SeqEntry[]): Set<string> => {
      const doomed = new Set<string>();
      let t = seq.some(e => e.unit.angle !== 'filler_hosted') ? SERIAL_PREVIEW_EST_SEC : 0;
      let sinceReaction = 0;
      seq.forEach((e, i) => {
        if (i > 0 && e.unit.angle !== 'filler_hosted' && seq[i - 1].unit.angle !== 'filler_hosted') {
          t += SERIAL_BRIDGE_EST_SEC;
        }
        const windowless = e.portal === true || e.portalClimax === true || e.unit.angle === 'filler_hosted';
        if (!windowless) {
          const anchor =
            climaxUnitId !== null && e.unit.id === climaxUnitId && climaxSequenced && climaxAnchor !== null
              ? climaxAnchor
              : prog(e.unit);
          const win = storyWindow(anchor, e.unit.durationSec, driveDur);
          if ((t * SERIAL_PACE_SAFETY) / driveDur > win.expire) doomed.add(e.unit.id);
          t = Math.max(t, win.release * driveDur) + e.unit.durationSec;
        } else {
          t += e.unit.durationSec;
        }
        sinceReaction += 1;
        if (sinceReaction >= 3 && i < seq.length - 1) {
          t += SERIAL_REACTION_EST_SEC;
          sinceReaction = 0;
        }
      });
      return doomed;
    };
    const baselineDoom = serialDoom(sequence.filter(e => e.portal !== true && e.portalClimax !== true));
    for (let guard = 0; guard < 32; guard++) {
      const victimId = [...serialDoom(sequence)].find(id => !baselineDoom.has(id));
      if (victimId === undefined) break;
      const victimIdx = sequence.findIndex(e => e.unit.id === victimId);
      const portalIdxs: number[] = [];
      sequence.forEach((e, i) => {
        if (e.portal === true && i < victimIdx) portalIdxs.push(i);
      });
      if (portalIdxs.length === 0) break; // attributable doom with no hop ahead of it: not this pass's shape
      let moved = false;
      // Nearest hop first — its bulk is the marginal bulk.
      for (const pi of [...portalIdxs].reverse()) {
        const p = sequence[pi];
        sequence.splice(pi, 1);
        const insertAt = sequence.findIndex(e => e.unit.id === victimId) + 1;
        const cIdx = sequence.findIndex(e => climaxUnitId !== null && e.unit.id === climaxUnitId);
        if (cIdx >= 0 && insertAt > cIdx) {
          sequence.splice(pi, 0, p); // a hop never lands after the climax
          continue;
        }
        sequence.splice(insertAt, 0, p);
        if (!serialDoom(sequence).has(victimId)) {
          moved = true;
          break;
        }
        sequence.splice(sequence.indexOf(p), 1);
        sequence.splice(pi, 0, p);
      }
      if (!moved) sequence.splice(portalIdxs[portalIdxs.length - 1], 1); // no safe slot: the nearest hop drops out
    }
  }

  // Interleave plan-time bridges + sparing reactions,
  // and stamp each story with its release window.
  const items: PlanItem[] = [];
  let storiesSinceReaction = 0;
  // Through-line bookkeeping: the plan's closing story (the
  // sequenced climax when there is one, else the last
  // non-filler entry) is what the preview promises, and the
  // payoff bridge may only claim a promise that was actually
  // composed — the preview item exists by the time any bridge
  // is built, so the promise is a settled fact, not a hope.
  const closingEntry = [...sequence].reverse().find(e => e.unit.angle !== 'filler_hosted');
  // The preview teases the ACTUAL climax (addendum 4): the
  // winner and its mode when the plan has one; without a
  // winner, the closing story itself, rendered 'late' (it
  // truly is last).
  const climaxCtx = climaxUnitId
    ? { subject: climaxSubject ?? '', mode: climaxMode, sequenced: climaxSequenced }
    : closingEntry
      ? { subject: closingEntry.unit.placeName, mode: 'late' as const, sequenced: false }
      : null;
  // The spoken episode preview (consolidation §2): the plan's
  // own FIRST item, no longer a job folded into the first
  // bridge. It draws the listener in with the destination, the
  // closing story, and ONE mid-drive subject to listen for.
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
  const previewCtx =
    storyEntries.length > 0
      ? buildPreviewContext({
          thread,
          destinationName,
          storyCount: storyEntries.length,
          closing: closingEntry?.unit ?? null,
          climax: climaxCtx,
          mid: midEntry?.unit ?? null,
          previouslyHeardSubject: priorHeardSubject,
          priorDrive,
          audience,
        })
      : null;
  const previewText = previewCtx ? previewTextFor(previewCtx) : null;
  const promiseMade = previewText !== null && climaxCtx !== null;
  const previewFacts =
    previewText !== null
      ? {
          threadPromised: thread !== null,
          previouslyDrive: priorDrive !== null,
          previouslySubject: priorHeardSubject !== null,
        }
      : null;
  // The episode's bridge ledger (field fix lane 1b): one
  // ledger threaded through every bridge this compose authors,
  // in plan order — openings rotate, the thread callout fires
  // once, and no connective-bank line can repeat (lane 1: bank
  // lines no longer author into bridges at all).
  const bridgeLedger = newBridgeEpisodeState();
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
      // take no thread context; every other bridge gets real
      // connective context (thread, the pair, and — for
      // callbacks — only items earlier in THIS plan). The
      // bridge into the portal climax additionally carries the
      // off-route flag: its framing must be honest about the
      // hop (consolidation §4).
      const context = entry.portal
        ? undefined
        : buildBridgeContext({
            earlier: sequence.slice(0, i).map(e => e.unit),
            prev,
            next: u,
            thread,
            isClimaxBridge: climaxUnitId !== null && u.id === climaxUnitId,
            climaxLast: climaxSequenced,
            promiseMade,
            offRoute: entry.portalClimax === true,
            audience,
          });
      const text = bridgeTextFor(prev, u, {
        targetSec: target,
        portalTopic: entry.portal ? entry.sharedTopic : undefined,
        context,
        episode: bridgeLedger,
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
    // The portal climax is windowless (consolidation §4): it
    // releases by sequence position in the final stretch, so
    // it carries a synthetic late anchor — where it SOUNDS on
    // the expected-time map — and no release window at all.
    const anchor = entry.portalClimax
      ? Math.min(0.98, Math.max(CLIMAX_ZONE_START, 1 - u.durationSec / driveDur))
      : isClimax && climaxSequenced && climaxAnchor !== null
        ? climaxAnchor
        : prog(u);
    const win =
      !isFiller && !entry.portal && !entry.portalClimax ? storyWindow(anchor, u.durationSec, driveDur) : null;
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
      ...(entry.portalClimax ? { portalClimax: true } : {}),
    });
    storiesSinceReaction += 1;
    if (storiesSinceReaction >= 3 && i < sequence.length - 1) {
      const reaction = spokenFormText(REACTION_BANK[Math.floor(i / 3) % REACTION_BANK.length]);
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

  // The preview item stands FIRST (consolidation §2): ~30 s of
  // framing before the departure story. It is not a story — no
  // unit, no anchor, no window — and nothing downstream counts
  // it as one (the manifest reads story items; the runner's
  // heard/owed accounting reads story items; the gap pass
  // reads story windows).
  if (previewText !== null) {
    items.unshift({
      kind: 'preview',
      id: 'preview',
      label: 'Episode preview',
      durationSec: spokenSec(previewText),
      text: previewText,
      ready: true,
    });
  }

  // Acts summary (composer v3, commit B): the settled plan's
  // shape by act, counted from the final items — story items
  // only, seated by anchor (the portal climax's synthetic late
  // anchor seats it in the climax act, where it sounds). The
  // floor flags come from the sweep; the rest is the plan as
  // built, so the decisions record describes what shipped.
  const actsSummary: ActsSummary = {
    opening: { stories: 0, landmark: 0, corridor: 0, floorSub: floorSubByAct[0] },
    middle: { stories: 0, landmark: 0, corridor: 0, floorSub: floorSubByAct[1] },
    climax: { stories: 0, landmark: 0, corridor: 0, floorSub: floorSubByAct[2] },
  };
  const actLines = [actsSummary.opening, actsSummary.middle, actsSummary.climax];
  for (const it of items) {
    if (it.kind !== 'story' || !it.unit) continue;
    const line = actLines[actIndexForProgress(it.anchorProgress ?? 0)];
    line.stories += 1;
    if (it.unit.angle.startsWith('landmark')) line.landmark += 1;
    else if (it.unit.angle === 'corridor') line.corridor += 1;
  }

  // Member seeking (the member-fetch lever): the plan asks
  // for the ONE bounded member fetch when the thread's
  // seatable supply in hand — the seating pass's own
  // candidacy filter over the fetched set plus any member
  // units already fetched — cannot fill the member cap,
  // while the county index still promises depth on the
  // topic. No index support supplied → never seeking (the
  // pre-lever shape); local candidacy at the cap → no
  // fetch, however deep the index runs.
  let wovenMembersSeeking: string | null = null;
  // Thread-carried seat need (Nov 4, 2026): the floor is
  // ASSESSED post-guarantee in the build staging, but the
  // member fetch is sized from THIS plan, before the
  // guarantee runs. The composed plan's own geo coverage is
  // the predictor, and it is conservative in the safe
  // direction: the guarantee only ADDS geo-anchored
  // coverage, so a plan at or above the floor here can
  // never engage the mode (its need stays the standing
  // cap), while a plan below the floor here is provisioned
  // for the carried cap whether or not the guarantee
  // ultimately lifts it back over — the fetch then simply
  // over-provisions, bounded and once.
  let wovenMemberNeed = WOVEN_MEMBER_CAP;
  if (thread && geoCoverageOfItems(items, driveDur) < THREAD_CARRIED_FLOOR) {
    wovenMemberNeed = WOVEN_MEMBER_CAP_CARRIED;
  }
  if (thread && (opts.wovenIndexSupport?.get(thread.topic) ?? 0) > 0) {
    const usedIds = new Set<string>();
    const usedPlaces = new Set<string>();
    for (const it of items) {
      if (it.kind === 'story' && it.unit) {
        usedIds.add(it.unit.id);
        usedPlaces.add(it.unit.placeKey);
      }
    }
    const inHand = wovenMemberCandidates([...units, ...(opts.memberUnits ?? [])], {
      topic: thread.topic,
      heardKeys: opts.heardKeys,
      climaxUnitId,
      usedIds,
      usedPlaces,
      path,
      destination,
      audience,
    });
    if (inHand.length < wovenMemberNeed) wovenMembersSeeking = thread.topic;
  }

  const totalSec = items.reduce((s, it) => s + it.durationSec, 0);
  return {
    destinationName,
    destination,
    path,
    audience,
    driveSec: null,
    budgetSec: Number.isFinite(budgetSec) ? budgetSec : totalSec,
    items,
    totalSec,
    skippedHeard,
    topicsMatched,
    toneMatched,
    thread,
    threadSource: thread ? (input.topics.includes(thread.topic) ? 'user' : 'detected') : null,
    climaxUnitId,
    climaxMode,
    climaxSubject,
    climaxDistanceKm,
    portalClimaxSeeking,
    wovenMembersSeeking,
    wovenMemberNeed,
    // The composer never assesses thread-carried — the
    // staging does, post-guarantee (assessThreadCarried).
    threadCarried: null,
    previewFacts,
    previewContext: previewCtx ?? null,
    openingSubject: openingUnit?.placeName ?? null,
    actsSummary,
    corridorRetiredStretches: opts.corridorTellingCounts ? retiredStretches.size : null,
    // The composer seats no woven members itself — seating is
    // the post-guarantee pass (seatWovenMembers), so a freshly
    // composed plan carries the empty record.
    wovenMembers: { count: 0, topics: [], unitIds: [] },
  };
}

/**
 * Hard cap on woven members per episode (Nov 4, 2026): the
 * seated-members simulation's winning configuration. The cap
 * is a COUNT, never a seconds share — the sim proved a
 * 25–40% woven-seconds cap arithmetically inert (a substantive
 * episode needs ≥ half the budget covered, and a capped share
 * below that line can never cross it in a corridor-dead
 * drive), so no seconds cap exists here by design.
 */
export const WOVEN_MEMBER_CAP = 4;

/**
 * The member cap inside a thread-carried episode (Nov 4,
 * 2026): when the road cannot fill half the drive, members
 * anchor the episode and the cap rises to fill — 8 members
 * at the shelf's ~250 s telling length is ~2,000 s, enough
 * to cross the substance line (half of a 2,400 s budget)
 * that 4 members arithmetically cannot. Bounded, and in
 * thread-carried mode only: a normal episode never seats
 * more than WOVEN_MEMBER_CAP.
 */
export const WOVEN_MEMBER_CAP_CARRIED = 8;

/**
 * The thread-carried floor: the mode engages only when the
 * plan's geo-anchored coverage — stories plus Coverage
 * Guarantee fills, woven members excluded — covers less
 * than this fraction of the drive. "The road cannot fill
 * roughly half the drive" (Erik, Nov 4, 2026), measured
 * with the codebase's standing interval model (the same
 * sounding spans the guarantee walks and the grader scores
 * silence with), on the post-guarantee plan.
 */
export const THREAD_CARRIED_FLOOR = 0.5;

/** The build staging's thread-carried verdict on a plan (see assessThreadCarried). */
export interface ThreadCarried {
  /** The mode engaged: a thread exists and geo coverage sits below the floor. */
  active: boolean;
  /** Geo-anchored coverage as a fraction of the drive, members excluded, post-guarantee. */
  geoCoverageFraction: number;
  /** The member cap seating runs under for this plan (the carried cap when active). */
  memberCap: number;
}

/**
 * Geo-anchored coverage of an item list, as a fraction of
 * the drive: the union of the sounding spans of every
 * story/filler item that is NOT a woven member — composed
 * geo stories, portal hops and the portal climax, hosted
 * fillers, and the Coverage Guarantee's fills all count
 * (they are the road's own material); members never do
 * (they are what the floor measures the NEED for). The
 * standing interval model throughout: windowed stories
 * sound across their windows, windowless ones at their
 * anchors.
 */
function geoCoverageOfItems(items: PlanItem[], driveSec: number): number {
  if (!(driveSec > 0)) return 0;
  let covered = 0;
  let cursor = 0;
  for (const span of soundingSpans(items, driveSec)) {
    if (span.item.woven) continue;
    if (span.end <= cursor) continue;
    covered += span.end - Math.max(span.start, cursor);
    cursor = Math.max(cursor, span.end);
  }
  return covered / driveSec;
}

/** A settled plan's geo-anchored coverage fraction (see geoCoverageOfItems). */
export function geoCoverageFraction(plan: RoutePlan): number {
  return geoCoverageOfItems(plan.items, plan.driveSec ?? plan.budgetSec);
}

/**
 * The serial sounding check over a BUILT plan (field fix lane
 * 2): walk the items in plan order, accumulating real
 * durations; a windowed story is DOOMED when the stage would
 * only free for it after its window has closed at the safety
 * pace — the runner's gate would drop it stale even on a
 * drive that merely outruns the map modestly. Windowless
 * items (portals, members, fillers) and tissue simply consume
 * sequence time. The composer's portal repair runs the same
 * walk over the pre-build sequence with estimated tissue;
 * this items-level form is the verification surface (the
 * harness asserts composed and member-seated plans carry no
 * doomed geo story).
 */
export function planDoomedStoryIds(
  items: PlanItem[],
  driveSec: number,
  paceFactor: number = SERIAL_PACE_SAFETY,
): string[] {
  if (!(driveSec > 0)) return [];
  const doomed: string[] = [];
  let t = 0;
  for (const it of items) {
    if (it.kind === 'story' && it.releaseProgress !== undefined && it.expireProgress !== undefined) {
      if ((t * paceFactor) / driveSec > it.expireProgress) doomed.push(it.id);
      t = Math.max(t, it.releaseProgress * driveSec) + it.durationSec;
    } else {
      t += it.durationSec;
    }
  }
  return doomed;
}

/**
 * The thread-carried assessment (Nov 4, 2026): run by the
 * build staging on the POST-GUARANTEE plan — the Coverage
 * Guarantee has claimed its ground (its fills are geo
 * coverage and count), the normal seating pass has run
 * (its members are excluded from the measure by
 * construction, so the verdict is the same before or after
 * it). Active requires a thread: without one there is no
 * pool to carry the episode, whatever the road's silence.
 * The record rides the plan into the route_plan_started
 * decisions telemetry.
 */
export function assessThreadCarried(plan: RoutePlan): ThreadCarried {
  const fraction = geoCoverageFraction(plan);
  const active = plan.thread !== null && fraction < THREAD_CARRIED_FLOOR;
  return {
    active,
    geoCoverageFraction: fraction,
    memberCap: active ? WOVEN_MEMBER_CAP_CARRIED : WOVEN_MEMBER_CAP,
  };
}

/** One sounding span of a plan, in expected travel seconds (a story or a filler). */
interface SoundingSpan {
  item: PlanItem;
  start: number;
  end: number;
}

/**
 * When each story SOUNDS, in expected travel seconds — the
 * Coverage Guarantee's interval model (routeGapFill's
 * storyIntervalsSec, mirrored, the way this codebase mirrors
 * shared geometry across the seam): a windowed story sounds
 * across [release, expire]; a windowless one (portal, woven
 * member, hosted filler) sounds at its anchor for its
 * duration. Bridges, reactions and the preview are tissue,
 * never coverage.
 */
function soundingSpans(items: PlanItem[], driveSec: number): SoundingSpan[] {
  const out: SoundingSpan[] = [];
  for (const it of items) {
    if ((it.kind !== 'story' && it.kind !== 'filler') || !it.unit) continue;
    const anchorSec = (it.anchorProgress ?? 0) * driveSec;
    const start = it.releaseProgress !== undefined ? it.releaseProgress * driveSec : anchorSec;
    const end = it.expireProgress !== undefined ? it.expireProgress * driveSec : start + it.durationSec;
    out.push({
      item: it,
      start: Math.max(0, Math.min(driveSec, start)),
      end: Math.max(0, Math.min(driveSec, end)),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

interface MemberGap {
  /** The silent span, in expected travel seconds. */
  start: number;
  end: number;
  /** The sounding items bounding the span (null at the drive's edges). */
  prev: PlanItem | null;
  next: PlanItem | null;
}

/**
 * The plan's silent gaps: the complement of the sounding
 * spans inside [0, driveSec], in drive order, each carrying
 * the items that bound it (bridge surgery needs the pair).
 * Two closures: when the plan has a climax item, gaps at or
 * after the climax's own span are closed — a member never
 * sounds after the closing story; and the departure edge
 * (the silence before the first sounding story) is closed —
 * the episode opens with the preview and the road's own
 * first story, and a member needs a sounding story before
 * it for its bridge in to hang from.
 *
 * Thread-carried mode (openDeparture) lifts the second
 * closure only: a member may open the episode (the preview
 * frames it, and the first story of a composed plan never
 * needed a bridge in either). The climax closure is NOT
 * lifted — a member still never sounds after the closing
 * story, whether that story is the road's or the
 * designated member climax.
 */
function memberGaps(items: PlanItem[], driveSec: number, openDeparture = false): MemberGap[] {
  const spans = soundingSpans(items, driveSec);
  const climaxItem = items.find(i => i.climax) ?? null;
  const climaxStart = climaxItem
    ? (spans.find(s => s.item === climaxItem)?.start ?? Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;
  const gaps: MemberGap[] = [];
  let cursor = 0;
  let prev: PlanItem | null = null;
  for (const span of spans) {
    if (span.start > cursor) gaps.push({ start: cursor, end: span.start, prev, next: span.item });
    cursor = Math.max(cursor, span.end);
    prev = span.item;
  }
  if (cursor < driveSec) gaps.push({ start: cursor, end: driveSec, prev, next: null });
  return gaps.filter(g => (openDeparture || g.prev !== null) && g.start < climaxStart);
}

/**
 * Member candidacy (Nov 4, 2026): the units that could seat
 * as woven members of a thread right now — landmark-class,
 * woven-eligible, carrying the thread's topic, unheard at
 * story level, not the plan's climax, not already in the
 * plan (by id or by place: one telling per place per plan),
 * and OFF the route's corridor (the destination circle,
 * else the landmark path radius — a member is an off-route
 * story by construction). Strongest first — the composer's
 * standing weight (the telling's length), id as the
 * deterministic tiebreak. The seating pass seats from this
 * list; the composer's member-seeking signal counts it —
 * one candidacy rule for both, so the fetch is asked for
 * exactly what seating could spend.
 */
export function wovenMemberCandidates(
  units: LibraryUnit[],
  args: {
    topic: string;
    heardKeys: ReadonlySet<string>;
    climaxUnitId: string | null;
    usedIds: ReadonlySet<string>;
    usedPlaces: ReadonlySet<string>;
    path: GeoPoint[];
    destination: GeoPoint;
    /**
     * The build's audience coloring (Nov 5, 2026): under
     * 'family', hard-class units are out of candidacy (member
     * units arrive here WITHOUT passing the composer's
     * partition — a member-fetched spooky-primary unit must
     * not seat) and gray candidates rank below clean ones.
     * Absent/'standard' = the standing candidacy exactly.
     */
    audience?: RouteAudience;
  },
): LibraryUnit[] {
  const inCorridor = (u: LibraryUnit): boolean =>
    haversineM({ lat: u.lat, lng: u.lng }, args.destination) <= DESTINATION_RADIUS_M ||
    distanceToPathM({ lat: u.lat, lng: u.lng }, args.path) <= LANDMARK_PATH_RADIUS_M;
  const famRank = (u: LibraryUnit): number => (args.audience === 'family' ? familyRankOf(u) : 0);
  return units
    .filter(
      u =>
        u.angle.startsWith('landmark') &&
        u.wovenEligible === true &&
        u.topics.includes(args.topic) &&
        !args.heardKeys.has(u.id) &&
        u.id !== args.climaxUnitId &&
        !args.usedIds.has(u.id) &&
        !args.usedPlaces.has(u.placeKey) &&
        !inCorridor(u) &&
        (args.audience !== 'family' || !familyHardExcluded(u)),
    )
    .sort(
      (a, b) =>
        famRank(a) - famRank(b) || b.durationSec - a.durationSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/**
 * Woven seated members (Nov 4, 2026, Erik's ruling on the
 * seated-members simulation): the production form of the
 * sim's winning configuration (≤4 members/episode at
 * presence-audit eligibility — 26 substantive thread-bearing
 * episodes of 40 in the sim, vs 9 climax-only).
 *
 * A plan with a through-line thread gains up to
 * WOVEN_MEMBER_CAP additional stories: OFF-ROUTE units from
 * the build's fetched set that are woven-eligible (presence
 * audit: weave-safe + mixed, Protected excluded — the flag
 * the caller baked in from src/data/routePresence), carry
 * the thread's topic, and are landmark-class (the sim's pool
 * was landmark-class by construction, and the portal climax's
 * standing rule). They seat as members of the episode —
 * IN ADDITION TO their climax candidacy in compose, never
 * instead of it: the climax is already settled when this
 * pass runs, and the climax unit itself is excluded here,
 * so a story is never both.
 *
 * ORDER IN THE BUILD (the Coverage Guarantee's precedence):
 * this pass runs AFTER fillRouteGaps in the App's staging —
 * the guarantee's library-first fills and generated stories
 * claim their ground first, and members seat only into the
 * silence that remains. A member therefore never displaces
 * sounding material of any kind: it is placed at the start
 * of the largest silent gap it fits ENTIRELY inside, as a
 * windowless insert (it releases by plan order, like a
 * portal), with honest bridges on both sides where the
 * plan's bridge pattern calls for them — the bridge in
 * frames the range along the thread (narration seam:
 * BridgeContext.wovenSubject), never proximity. Heard
 * exclusion is story-level, exactly as everywhere (a member
 * that plays burns from the ledger like any story — the
 * caller's next build hears it gone), one telling per place
 * per plan holds, and the corridor lifetime cap is untouched
 * (members are off-route by construction).
 *
 * THREAD-CARRIED MODE (opts.threadCarried — Erik, Nov 4,
 * 2026): the staging calls this pass a second time, with
 * the raised cap, when assessThreadCarried engaged the
 * mode on the guaranteed plan. Three rules change, and
 * only three:
 *  1. ANCHORING: the departure edge opens — a member may
 *     be the episode's first story (the preview frames
 *     it), so a plan with little or no geo spine composes
 *     from the thread pool along the budget timeline
 *     instead of producing no episode at all. Placement
 *     is the same largest-gap discipline; the members
 *     spread across the timeline and the act shape falls
 *     out of the spread.
 *  2. THE CLIMAX POSITION: when the plan has NO climax
 *     winner of its own (plan.climaxUnitId null — the
 *     road offered nothing to crown), the strongest
 *     unheard on-thread member is RESERVED before general
 *     seating and placed inside the final third, marked
 *     as the plan's climax (mode 'thread'). This is the
 *     no-geo-spine case only: an existing geo/portal
 *     climax is never displaced, never followed (the
 *     climax gap closure still binds), and never joined
 *     by a member in its slot. When the strongest member
 *     cannot fit the final third, no designation happens
 *     — it seats as an ordinary member and the episode
 *     closes naturally.
 *  3. FRAMING: with at least one member seated in total,
 *     the preview is re-authored from the plan's stashed
 *     composed context plus the settled shape — the
 *     narration seam's thread-carried framing ("the
 *     road's quiet today, so this drive follows a
 *     thread"), which never places a member on the route.
 * The cap in this mode counts the plan's TOTAL members
 * (the normal pass's seats included): the second call
 * tops the episode up, it does not seat a second cast.
 *
 * Pure and deterministic — no network, no clock — so the
 * harness and the grader run the very code the App runs.
 * Returns the plan unchanged (same object) when nothing
 * seats: no thread, no eligible candidate, or no gap a
 * candidate fits.
 */
export function seatWovenMembers(
  plan: RoutePlan,
  units: LibraryUnit[],
  opts: { heardKeys: Set<string>; maxMembers?: number; threadCarried?: boolean },
): RoutePlan {
  const thread = plan.thread;
  if (!thread) return plan;
  const driveSec = plan.driveSec ?? plan.budgetSec;
  if (!(driveSec > 0)) return plan;
  const carried = opts.threadCarried === true;
  const cap = opts.maxMembers ?? (carried ? WOVEN_MEMBER_CAP_CARRIED : WOVEN_MEMBER_CAP);
  if (cap <= 0) return plan;

  const usedIds = new Set<string>();
  const usedPlaces = new Set<string>();
  for (const it of plan.items) {
    if (it.kind === 'story' && it.unit) {
      usedIds.add(it.unit.id);
      usedPlaces.add(it.unit.placeKey);
    }
  }
  const candidates = wovenMemberCandidates(units, {
    topic: thread.topic,
    heardKeys: opts.heardKeys,
    climaxUnitId: plan.climaxUnitId,
    usedIds,
    usedPlaces,
    path: plan.path,
    destination: plan.destination,
    audience: plan.audience,
  });
  // Members the plan already carries (the normal pass's
  // seats, when this is the thread-carried top-up call):
  // the cap binds the plan's total, and the returned
  // record counts them all.
  const alreadySeated = plan.items
    .filter(i => i.woven && i.unit)
    .map(i => i.unit as LibraryUnit);
  if (candidates.length === 0 && !(carried && alreadySeated.length > 0)) return plan;

  let items: PlanItem[] = [...plan.items];
  // The episode's bridge ledger, continued (field fix lane
  // 1b): this pass authors INTO a composed episode, so its
  // bridges inherit what the composed bridges already used —
  // seeded from their texts, then extended by every bridge
  // authored here, in order.
  const bridgeLedger = bridgeEpisodeStateFromTexts(
    plan.items.filter(i => i.kind === 'bridge' && typeof i.text === 'string').map(i => i.text as string),
  );
  const seated: LibraryUnit[] = [...alreadySeated];
  // The thread-carried climax designation (this pass only):
  // the strongest member reserved for the final third when
  // the road crowned nothing. Null in normal mode, and
  // whenever an existing climax stands or the strongest
  // member cannot fit the zone.
  let carriedClimax: LibraryUnit | null = null;
  // The units sounding before a boundary item, for bridge
  // callbacks (the composer's own convention: every entry
  // before the next story, its prev included) — recomputed
  // per seat from the working items.
  const earlierUnits = (boundary: PlanItem | null): LibraryUnit[] => {
    const out: LibraryUnit[] = [];
    for (const it of items) {
      if (boundary !== null && it === boundary) break;
      if ((it.kind === 'story' || it.kind === 'filler') && it.unit) out.push(it.unit);
    }
    return out;
  };

  // Seat one candidate into one gap, with the bridge
  // surgery the adjacency calls for. Shared by the general
  // loop and (thread-carried mode) the climax designation:
  // asClimax marks the item as the plan's climax and gives
  // its bridge in the payoff treatment — the preview the
  // framing pass below authors WILL have promised it, and
  // the hop off the road is framed as one (offRoute), never
  // as ground ahead.
  const insertIntoGap = (cand: LibraryUnit, gap: MemberGap, asClimax: boolean): void => {
    const memberItem: PlanItem = {
      kind: 'story',
      id: cand.id,
      label: cand.placeName,
      durationSec: cand.durationSec,
      unit: cand,
      ready: true,
      anchorProgress: gap.start / driveSec,
      woven: true,
      ...(asClimax ? { climax: true } : {}),
    };
    const bridgeTarget = (fromAnchorSec: number, fromDur: number, toAnchorSec: number): number =>
      Math.max(
        BRIDGE_MIN_SEC,
        Math.min(
          BRIDGE_MAX_SEC,
          Math.round(Math.max(0, toAnchorSec - fromAnchorSec - fromDur) - WINDOW_LEAD_SEC),
        ),
      );
    const memberAnchorSec = gap.start;
    const insert: PlanItem[] = [];
    // The bridge IN — only where the plan's own pattern has
    // one: a story (not a filler) sounding before the member.
    if (gap.prev && gap.prev.kind === 'story' && gap.prev.unit) {
      const prev = gap.prev.unit;
      const context = asClimax
        ? buildBridgeContext({
            earlier: earlierUnits(gap.next),
            prev,
            next: cand,
            thread,
            isClimaxBridge: true,
            climaxLast: true,
            promiseMade: true,
            offRoute: true,
            audience: plan.audience,
          })
        : buildBridgeContext({
            earlier: earlierUnits(gap.next),
            prev,
            next: cand,
            thread,
            isClimaxBridge: false,
            promiseMade: false,
            nextWoven: true,
            audience: plan.audience,
          });
      const target = bridgeTarget(
        (gap.prev.anchorProgress ?? 0) * driveSec,
        prev.durationSec,
        memberAnchorSec,
      );
      const text = bridgeTextFor(prev, cand, { targetSec: target, context, episode: bridgeLedger });
      insert.push({
        kind: 'bridge',
        id: `bridge:${prev.id}>${cand.id}`,
        label: `Bridge — ${prev.placeName} to ${cand.placeName}`,
        durationSec: spokenSec(text),
        prevUnitId: prev.id,
        nextUnitId: cand.id,
        text,
        ready: true,
        targetDurationSec: target,
      });
    }
    insert.push(memberItem);
    // The bridge OUT — back to the road's next story, when
    // there is one and it is a story (not filler spackle).
    // When that story is the plan's climax, this bridge is
    // the payoff bridge and is composed as one (an off-route
    // portal climax keeps its honest hop framing).
    if (gap.next && gap.next.kind === 'story' && gap.next.unit) {
      const next = gap.next.unit;
      // The designated member climax (thread-carried mode)
      // earns the payoff treatment exactly as a composed
      // climax does — it is sequenced as the closing peak
      // and the reframed preview promises it — with the
      // honest hop framing (offRoute): it is not on the road.
      const nextIsCarriedClimax = carriedClimax !== null && next.id === carriedClimax.id;
      const isClimaxNext =
        nextIsCarriedClimax || (plan.climaxUnitId !== null && next.id === plan.climaxUnitId);
      const context = buildBridgeContext({
        earlier: [...earlierUnits(gap.next), cand],
        prev: cand,
        next,
        thread,
        isClimaxBridge: isClimaxNext,
        climaxLast: nextIsCarriedClimax ? true : plan.climaxMode !== 'natural',
        promiseMade: nextIsCarriedClimax
          ? true
          : plan.previewFacts !== null && plan.climaxUnitId !== null,
        offRoute: gap.next.portalClimax === true || nextIsCarriedClimax,
        audience: plan.audience,
      });
      const target = bridgeTarget(
        memberAnchorSec,
        cand.durationSec,
        (gap.next.anchorProgress ?? 0) * driveSec,
      );
      const text = bridgeTextFor(cand, next, { targetSec: target, context, episode: bridgeLedger });
      insert.push({
        kind: 'bridge',
        id: `bridge:${cand.id}>${next.id}`,
        label: `Bridge — ${cand.placeName} to ${next.placeName}`,
        durationSec: spokenSec(text),
        prevUnitId: cand.id,
        nextUnitId: next.id,
        text,
        ready: true,
        targetDurationSec: target,
      });
    }
    // Splice: before the next sounding item — or at its
    // incoming bridge, which the two new bridges replace (it
    // named a pair that no longer stands adjacent).
    let at = gap.next ? items.indexOf(gap.next) : items.length;
    if (gap.prev && gap.next && at > 0) {
      const before = items[at - 1];
      if (
        before.kind === 'bridge' &&
        before.prevUnitId === gap.prev.unit?.id &&
        before.nextUnitId === gap.next.unit?.id
      ) {
        items.splice(at - 1, 1);
        at -= 1;
      }
    }
    items.splice(at, 0, ...insert);
    seated.push(cand);
    usedIds.add(cand.id);
    usedPlaces.add(cand.placeKey);
  };

  // The climax designation (thread-carried mode only, and
  // only when the road crowned nothing): reserve the
  // strongest member BEFORE general seating and place it
  // inside the final third — preferring the tail gap, so
  // the member closes the episode; any gap whose
  // final-third room fits it is the fallback. Its span
  // then closes later gaps to members exactly as a
  // composed climax's does (memberGaps reads the item).
  if (carried && plan.climaxUnitId === null && candidates.length > 0 && seated.length < cap) {
    const cand = candidates[0];
    const zoneStartSec = CLIMAX_ZONE_START * driveSec;
    const fits = memberGaps(items, driveSec, true)
      .map(g => {
        // In the tail gap the member takes the closing
        // position proper — it ENDS where the drive ends,
        // like a sequenced climax — when that position is
        // inside the zone; elsewhere the earliest in-zone
        // position in the gap.
        const atSec =
          g.next === null
            ? Math.max(g.start, zoneStartSec, g.end - cand.durationSec)
            : Math.max(g.start, zoneStartSec);
        return atSec + cand.durationSec <= g.end ? { gap: g, atSec } : null;
      })
      .filter((x): x is { gap: MemberGap; atSec: number } => x !== null)
      .sort(
        (a, b) =>
          Number(b.gap.next === null) - Number(a.gap.next === null) ||
          b.gap.end - b.atSec - (a.gap.end - a.atSec) ||
          a.atSec - b.atSec,
      )[0];
    if (fits) {
      carriedClimax = cand;
      insertIntoGap(
        cand,
        { start: fits.atSec, end: fits.gap.end, prev: fits.gap.prev, next: fits.gap.next },
        true,
      );
    }
  }

  for (const cand of candidates) {
    if (seated.length >= cap) break;
    if (usedIds.has(cand.id) || usedPlaces.has(cand.placeKey)) continue;
    // The largest silent gap this candidate fits entirely
    // inside (earliest first on a tie) — the sim's placement
    // rule, recomputed per seat because each member splits
    // the gap it took. Thread-carried mode reads the same
    // gaps with the departure edge open: a member may
    // anchor the episode's start.
    const gap =
      memberGaps(items, driveSec, carried)
        .filter(g => g.end - g.start >= cand.durationSec)
        .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)[0] ?? null;
    if (!gap) continue;
    insertIntoGap(cand, gap, false);
  }
  if (seated.length === 0) return plan;
  if (!carried && seated.length === alreadySeated.length) return plan;

  // The acts summary recounts from the final items, exactly
  // as the composer counted the composed plan (story items by
  // anchor act; the floor flags are the sweep's and carry).
  const actsSummary: ActsSummary = {
    opening: { ...plan.actsSummary.opening, stories: 0, landmark: 0, corridor: 0 },
    middle: { ...plan.actsSummary.middle, stories: 0, landmark: 0, corridor: 0 },
    climax: { ...plan.actsSummary.climax, stories: 0, landmark: 0, corridor: 0 },
  };
  const actLines = [actsSummary.opening, actsSummary.middle, actsSummary.climax];
  for (const it of items) {
    if (it.kind !== 'story' || !it.unit) continue;
    const line = actLines[actIndexForProgress(it.anchorProgress ?? 0)];
    line.stories += 1;
    if (it.unit.angle.startsWith('landmark')) line.landmark += 1;
    else if (it.unit.angle === 'corridor') line.corridor += 1;
  }
  const unitIds = items.filter(i => i.woven && i.unit).map(i => (i.unit as LibraryUnit).id);

  // Thread-carried framing: with members seated, the
  // preview is re-authored from the settled plan — the
  // composed preview's own stashed context (its continuity
  // nod survives verbatim) updated for the final shape:
  // the real story count, the closing story (the
  // designated member climax when there is one), a mid
  // hook off the final items, and the narration seam's
  // threadCarried flag, whose text says the road is quiet
  // and the drive follows the thread. A story-less
  // composed plan composed NO preview; the rebuild authors
  // the episode's first one. Normal mode never rebuilds:
  // the composed preview stands exactly as composed.
  let previewFacts = plan.previewFacts;
  let previewContext = plan.previewContext ?? null;
  if (carried && seated.length > 0) {
    const storyItems = items.filter(i => i.kind === 'story' && i.unit);
    const closingItem =
      (carriedClimax ? storyItems.find(i => i.id === carriedClimax.id) : undefined) ??
      storyItems[storyItems.length - 1];
    if (closingItem?.unit) {
      const midItem =
        storyItems.length > 2
          ? storyItems
              .slice(1)
              .filter(i => i !== closingItem)
              .sort(
                (a, b) =>
                  Math.abs((a.anchorProgress ?? 0) - 0.5) - Math.abs((b.anchorProgress ?? 0) - 0.5) ||
                  (a.anchorProgress ?? 0) - (b.anchorProgress ?? 0),
              )[0]
          : undefined;
      const ctx = buildPreviewContext({
        thread,
        destinationName: plan.destinationName,
        storyCount: storyItems.length,
        closing: closingItem.unit,
        climax: carriedClimax
          ? { subject: carriedClimax.placeName, mode: 'thread', sequenced: true }
          : plan.climaxUnitId
            ? {
                subject: plan.climaxSubject ?? '',
                mode: plan.climaxMode,
                sequenced: plan.climaxMode !== 'natural',
              }
            : null,
        mid: midItem?.unit ?? null,
        previouslyHeardSubject: previewContext?.previouslyHeardSubject ?? null,
        priorDrive: previewContext?.priorDrive ?? null,
        threadCarried: true,
        audience: plan.audience,
      });
      const text = ctx ? previewTextFor(ctx) : null;
      if (ctx && text !== null) {
        previewContext = ctx;
        previewFacts = {
          threadPromised: true,
          previouslyDrive: ctx.priorDrive != null,
          previouslySubject: ctx.previouslyHeardSubject != null,
        };
        const previewItem: PlanItem = {
          kind: 'preview',
          id: 'preview',
          label: 'Episode preview',
          durationSec: spokenSec(text),
          text,
          ready: true,
        };
        const at = items.findIndex(i => i.kind === 'preview');
        if (at >= 0) items.splice(at, 1, previewItem);
        else items.unshift(previewItem);
      }
    }
  }

  return {
    ...plan,
    items,
    totalSec: items.reduce((s, it) => s + it.durationSec, 0),
    actsSummary,
    wovenMembers: { count: seated.length, topics: [thread.topic], unitIds },
    ...(carriedClimax
      ? {
          climaxUnitId: carriedClimax.id,
          climaxSubject: carriedClimax.placeName,
          climaxMode: 'thread' as RoutePlan['climaxMode'],
        }
      : {}),
    previewFacts,
    previewContext,
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
 * from the BridgeContext this returns. A bridge is connective
 * tissue between its pair only: the episode framing lives in
 * the preview item (buildPreviewContext below), and the first
 * bridge of a plan is an ordinary mid bridge like any other.
 */
export function buildBridgeContext(args: {
  /** Every plan entry before the next story, in plan order (prev is the last of these). */
  earlier: LibraryUnit[];
  prev: LibraryUnit;
  next: LibraryUnit;
  thread: RouteThread | null;
  isClimaxBridge: boolean;
  /** True when the climax was sequenced last, so its incoming bridge is the payoff. */
  climaxLast?: boolean;
  /** True when the plan's preview item actually promised this climax. */
  promiseMade: boolean;
  /** True when the next story is the off-route portal climax (consolidation §4). */
  offRoute?: boolean;
  /**
   * True when the next story is a woven member (Nov 4, 2026):
   * an off-route through-line member seated in a silent gap.
   * The bridge into it must frame the hop honestly — the host
   * ranging along the thread — never as ground ahead.
   */
  nextWoven?: boolean;
  /**
   * The build's audience coloring (Nov 5, 2026): under
   * 'family', a GRAY-class previous story contributes no
   * quoted gist — the bridge names the subject only (the
   * gist rule: bridges may quote a story's own first line,
   * and a gray story's first line is exactly what Family
   * tissue must not speak verbatim). Absent/'standard' =
   * the standing context exactly.
   */
  audience?: RouteAudience;
}): BridgeContext {
  const { earlier, prev, next, thread, isClimaxBridge, climaxLast, promiseMade, offRoute, nextWoven } = args;
  // The bridge into a SEQUENCED climax is the payoff, thread
  // or not: it owes the preview its closing beat. Every other
  // bridge is a mid bridge.
  const role: BridgeContext['role'] = isClimaxBridge && climaxLast ? 'payoff' : 'mid';
  const ctx: BridgeContext = {
    threadTopic: thread?.topic ?? null,
    prevSubject: prev.placeName,
    prevGist:
      args.audience === 'family' && familyClassOf(prev) === 'gray' ? null : storyGist(prev),
    nextSubject: next.placeName,
    role,
  };
  if (role === 'payoff') {
    ctx.promiseMade = promiseMade;
    if (offRoute) ctx.offRouteSubject = next.placeName;
  }
  // An ordinary woven member is never the climax, so its
  // incoming bridge is always a mid bridge; the flag rides
  // the context so the narration layer frames the range
  // honestly. (The thread-carried designated climax is
  // seated WITHOUT this flag — its bridge in is the payoff,
  // with offRoute carrying the honest hop instead.)
  if (nextWoven && role === 'mid') ctx.wovenSubject = next.placeName;
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
 * Assemble the spoken preview's context from the plan's real
 * facts (consolidation §2) — the preview may name subjects
 * from anywhere in THIS plan (naming what the drive holds is
 * its job), plus continuity data drawn only from the caller's
 * heard input and the matched prior-drive record. Returns
 * null when the plan has no closing story to frame (no
 * stories → no preview item).
 */
export function buildPreviewContext(args: {
  thread: RouteThread | null;
  destinationName: string;
  /** How many stories the plan carries. */
  storyCount: number;
  /** The plan's closing story unit (the sequenced climax when there is one). */
  closing: LibraryUnit | null;
  /** The plan's climax as the preview teases it (addendum 4 + consolidation §4), or null. */
  climax?: { subject: string; mode: 'destination' | 'late' | 'natural' | 'portal' | 'thread'; sequenced: boolean } | null;
  /** The plan's mid-drive hook subject (a real story entry between departure and closing). */
  mid: LibraryUnit | null;
  /** A previously-heard subject on this route's ground, drawn from the caller's heard input only. */
  previouslyHeardSubject?: string | null;
  /** The matched prior drive (addendum 2), or null when no record matched. */
  priorDrive?: { threadTopic: string | null; stillOwedSubjects: string[] } | null;
  /**
   * Thread-carried framing (Nov 4, 2026): the rebuild in
   * seatWovenMembers re-authors the preview of a plan the
   * staging assessed thread-carried — the context carries
   * the flag into the narration layer, whose preview text
   * frames the quiet road and the thread honestly.
   */
  threadCarried?: boolean;
  /**
   * The build's audience coloring (Nov 5, 2026): under
   * 'family', a GRAY-class mid story is named but never
   * quoted — the preview's mid hook is the one place a
   * shelf story's literal first sentence is spoken by
   * tissue, and the gist rule closes it for gray stories.
   */
  audience?: RouteAudience;
}): PreviewContext | null {
  const { thread, destinationName, storyCount, closing, climax, mid, previouslyHeardSubject, priorDrive } = args;
  if (!closing) return null;
  const ctx: PreviewContext = {
    threadTopic: thread?.topic ?? null,
    destinationName,
    storyCount,
    closingSubject: closing.placeName,
    climaxSubject: climax?.subject ?? null,
    climaxMode: climax?.mode ?? 'natural',
  };
  if (args.threadCarried) ctx.threadCarried = true;
  if (thread && mid && mid.placeName !== ctx.closingSubject) {
    ctx.midSubject = mid.placeName;
    const gist =
      args.audience === 'family' && familyClassOf(mid) === 'gray' ? null : storyGist(mid);
    if (gist && gist.length <= 110) ctx.midGist = gist;
  }
  if (previouslyHeardSubject) ctx.previouslyHeardSubject = previouslyHeardSubject;
  if (priorDrive && (priorDrive.threadTopic !== null || priorDrive.stillOwedSubjects.length > 0)) {
    ctx.priorDrive = priorDrive;
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
 * composed around (addendum 4 + consolidation §4).
 * Deliberately nothing else — no played set exists at
 * preparation time, and none may leak in later: the wrap-up
 * speaks the episode's arc, never a recap. The text itself
 * is authored in the narration layer (narration.wrapUpTextFor)
 * from this context.
 */
export function buildWrapUpContext(plan: RoutePlan): WrapUpContext {
  return {
    destinationName: plan.destinationName,
    threadTopic: plan.thread?.topic ?? null,
    climaxMode: plan.climaxMode ?? 'natural',
    climaxSubject: plan.climaxSubject ?? null,
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
  /**
   * Route choice (Nov 5, 2026): every route the Routes call
   * returned, parsed, in response order — options[0] is the
   * default route (`route` itself, meta attached) and the
   * rest are the alternatives the build could have composed
   * on. Empty whenever route is null. A single-route response
   * yields exactly one option: the fallback is today.
   */
  options: ComputedRouteOption[];
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

/** Knobs for the maps calls' retry pass (tests inject a no-op sleep). */
export interface MapsCallOptions {
  /** Backoff between the two key-walk passes. */
  retryDelayMs?: number;
  /** Injectable sleep; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/** Backoff before a maps call's second key-walk pass. */
export const MAPS_RETRY_DELAY_MS = 1200;

const mapsSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * ONE pass of the Places (New) text search across all
 * configured keys (see configuredKeys). Returns the top candidate
 * from the first key that answers; a key that answers with zero
 * places is definitive ('no_results') — later keys are not tried
 * for a query the service itself rejected as empty.
 * geocodeDestination decides whether a non-definitive outcome
 * earns a second pass.
 */
async function geocodePass(
  query: string,
  keys: string[],
  fetchFn: typeof fetch,
): Promise<GeocodeOutcome> {
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

/**
 * Places (New) text search for the destination, across ALL
 * configured keys — with ONE retry pass (Nov 4, 2026, Erik's
 * first stationary test of the published stack). Tap 1's build
 * died here ~5 s in, classed 'permission', and tap 2 — the
 * identical call, 9 s later — succeeded. The single-pass walk
 * could not tell the two apart: the Places-named key is
 * deterministically 403-blocked for SearchText (probe-verified),
 * so every build rides on a later key answering; the failure
 * merge makes 'permission' sticky, so ONE transient transport
 * failure on the working key (cold connections, seconds after
 * launch) merged with that standing 403 into a fatal
 * 'permission'. A non-definitive outcome — no key answered —
 * therefore earns exactly one more full walk after a short
 * backoff before the build is allowed to die. Definitive
 * outcomes (a key answered: success, or 'no_results') never
 * retry, and 'no_keys' never walks at all.
 */
export async function geocodeDestination(
  query: string,
  apiKeys: string[],
  fetchFn: typeof fetch = fetch,
  opts: MapsCallOptions = {},
): Promise<GeocodeOutcome> {
  const keys = configuredKeys(apiKeys);
  if (keys.length === 0) return { destination: null, failure: 'no_keys' };
  const first = await geocodePass(query, keys, fetchFn);
  if (first.destination || first.failure === 'no_results') return first;
  await (opts.sleep ?? mapsSleep)(opts.retryDelayMs ?? MAPS_RETRY_DELAY_MS);
  const second = await geocodePass(query, keys, fetchFn);
  if (second.destination || second.failure === 'no_results') return second;
  return { destination: null, failure: mergeFailure(first.failure ?? 'network', second.failure ?? 'network') };
}

export type DestinationSource = 'selection' | 'places';

export interface DestinationResolution {
  destination: GeocodedDestination | null;
  /** Null on success; otherwise the failure class above. */
  failure: MapsFailure | null;
  source: DestinationSource;
}

/**
 * The build's ONE destination resolution (Nov 4, 2026). A
 * destination that arrived WITH coordinates (a Places
 * selection) needs no geocode at all — it resolves locally,
 * zero network calls, immune to key restrictions by
 * construction. Free text goes through geocodeDestination
 * (rotation + retry pass). The shipped intake is text-only
 * today, so the App passes no selection; the selection branch
 * is the guarantee a future picker plugs into, harness-pinned
 * so it cannot rot.
 */
export async function resolveDestination(
  query: string,
  apiKeys: string[],
  selected: GeocodedDestination | null,
  fetchFn: typeof fetch = fetch,
  opts: MapsCallOptions = {},
): Promise<DestinationResolution> {
  if (selected) return { destination: selected, failure: null, source: 'selection' };
  const outcome = await geocodeDestination(query, apiKeys, fetchFn, opts);
  return { ...outcome, source: 'places' };
}

export interface ComputedRoute {
  path: GeoPoint[];
  distanceMeters: number;
  durationSec: number;
}

/**
 * One route the Routes call returned, meta attached (route
 * choice, Nov 5, 2026): the ComputedRoute plus the API's own
 * road summary and its DEFAULT_ROUTE / DEFAULT_ROUTE_ALTERNATE
 * labels, when it returned them. The description is a LABEL
 * source only — the picker never depends on it (ordinal
 * fallback labels exist), because its real-world tidiness for
 * ordinary routes is unproven until the first live builds.
 */
export interface ComputedRouteOption extends ComputedRoute {
  description: string | null;
  routeLabels: string[];
}

/** One road the Routes call returned, as the route-choice record files it. */
export interface RouteChoiceOffered {
  description: string | null;
  durationSec: number;
  distanceMeters: number;
  routeLabels: string[];
}

/**
 * The route-choice record (Nov 5, 2026): every road this build
 * could have composed on, whether the picker showed, and the
 * road it composed on (an index into offered; 0 = the default
 * route). Set by the App at the pick — like fetchStats, the
 * pure composer never sees the Routes response. The runner
 * files it in the route_plan_started decisions record and
 * episode capture copies it onto the plan payload.
 */
export interface RouteChoiceRecord {
  offered: RouteChoiceOffered[];
  pickerShown: boolean;
  pickedIndex: number;
}

/** One route entry of a computeRoutes response, as the API shapes it. */
interface RawRouteEntry {
  distanceMeters?: number;
  duration?: string;
  description?: string;
  routeLabels?: string[];
  polyline?: { encodedPolyline?: string };
}

/**
 * Parse one returned route into a ComputedRouteOption. The
 * DEFAULT route parses with the standing leniency (a missing
 * duration reads as 0, exactly as the single-route contract
 * always read it); an ALTERNATIVE must carry a polyline AND a
 * usable duration to exist at all — one that fails to parse
 * is dropped silently and can never fail the build (route
 * choice, Nov 5, 2026).
 */
function parseRouteOption(r: RawRouteEntry, requireDuration: boolean): ComputedRouteOption | null {
  const encoded = r.polyline?.encodedPolyline;
  if (!encoded) return null;
  const dur = r.duration ? parseInt(r.duration.replace('s', ''), 10) : NaN;
  if (requireDuration && !Number.isFinite(dur)) return null;
  const path = decodePolyline(encoded);
  if (path.length === 0) return null;
  return {
    path,
    distanceMeters: r.distanceMeters ?? 0,
    durationSec: Number.isFinite(dur) ? dur : 0,
    description:
      typeof r.description === 'string' && r.description.trim().length > 0 ? r.description.trim() : null,
    routeLabels: Array.isArray(r.routeLabels) ? r.routeLabels.filter(l => typeof l === 'string') : [],
  };
}

/**
 * ONE pass of Routes API computeRoutes with traffic
 * (TRAFFIC_AWARE), DRIVE mode, across ALL configured keys (see
 * configuredKeys — Routes was added to one key's restriction
 * list Nov 2, 2026, Places (New) evidently sits on another's; a
 * 403 tries the next key). A key that answers with no route is
 * definitive ('no_results'). computeRoute decides whether a
 * non-definitive outcome earns a second pass.
 *
 * Route choice (Nov 5, 2026): the pass asks for alternatives
 * in the SAME request (the app never sends intermediate
 * waypoints — the one case where alternatives are
 * unavailable) and parses every returned route. routes[0]
 * remains THE route — the single-route contract is untouched;
 * the rest ride along on the outcome as alternatives. A
 * one-route response is byte-for-byte the old behavior.
 */
async function computeRoutePass(
  origin: GeoPoint,
  destination: GeoPoint,
  keys: string[],
  fetchFn: typeof fetch,
): Promise<RouteOutcome> {
  let failure: MapsFailure = 'network';
  for (const apiKey of keys) {
    let res: Response;
    try {
      res = await fetchFn('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.description,routes.routeLabels',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
          computeAlternativeRoutes: true,
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
    let parsed: { routes?: RawRouteEntry[] };
    try {
      parsed = (await res.json()) as typeof parsed;
    } catch {
      failure = mergeFailure(failure, 'http');
      continue;
    }
    const raw = parsed.routes ?? [];
    // The head of the response decides, as it always has: a
    // response whose first route carries no polyline is a
    // definitive no_results, whatever rides behind it.
    if (!raw[0]?.polyline?.encodedPolyline) return { route: null, failure: 'no_results', options: [] };
    const options: ComputedRouteOption[] = [];
    const head = parseRouteOption(raw[0], false);
    if (head) options.push(head);
    for (const r of raw.slice(1)) {
      const opt = parseRouteOption(r, true);
      if (opt) options.push(opt);
    }
    if (options.length === 0) return { route: null, failure: 'no_results', options: [] };
    return { route: options[0], failure: null, options };
  }
  return { route: null, failure, options: [] };
}

/**
 * Routes API computeRoutes, across ALL configured keys — with
 * the same one-retry-pass discipline as geocodeDestination
 * (Nov 4, 2026): a non-definitive failure (no key answered)
 * earns one more full walk after a short backoff, because the
 * merged failure class cannot distinguish a truly blocked key
 * set from a transient failure on the one key that carries
 * Routes. Definitive outcomes never retry.
 */
export async function computeRoute(
  origin: GeoPoint,
  destination: GeoPoint,
  apiKeys: string[],
  fetchFn: typeof fetch = fetch,
  opts: MapsCallOptions = {},
): Promise<RouteOutcome> {
  const keys = configuredKeys(apiKeys);
  if (keys.length === 0) return { route: null, failure: 'no_keys', options: [] };
  const first = await computeRoutePass(origin, destination, keys, fetchFn);
  if (first.route || first.failure === 'no_results') return first;
  await (opts.sleep ?? mapsSleep)(opts.retryDelayMs ?? MAPS_RETRY_DELAY_MS);
  const second = await computeRoutePass(origin, destination, keys, fetchFn);
  if (second.route || second.failure === 'no_results') return second;
  return {
    route: null,
    failure: mergeFailure(first.failure ?? 'network', second.failure ?? 'network'),
    options: [],
  };
}

// ------------------------------------------------------------ route choice (Nov 5, 2026)

/**
 * The fork gate (route choice, Nov 5, 2026): the picker
 * appears only when an alternative is BOTH a plausible choice
 * (competitiveness) AND a genuinely different road
 * (divergence). Both tests are pure local geometry on the
 * decoded polylines — no calls, no cost beyond arithmetic.
 */

/** Competitiveness floor: an alternative within +5 min of the fastest is a choice, however short the drive. */
export const ROUTE_FORK_MAX_EXTRA_SEC = 300;
/** Competitiveness ratio: …or within +20% of the fastest, whichever window is wider (the coast road on a long drive). */
export const ROUTE_FORK_MAX_EXTRA_RATIO = 0.2;
/** Divergence: two routes are different roads when their shared length is BELOW this fraction. */
export const ROUTE_FORK_MAX_SHARED = 0.75;
/** A resampled point counts as on the other road within this distance — half the playback off-corridor tolerance, so frontage-road parallels count as the same road. */
export const ROUTE_FORK_SHARED_TOLERANCE_M = 100;
/** Resampling step for the shared-length computation. */
export const ROUTE_FORK_SAMPLE_STEP_M = 100;
/** The picker shows at most this many roads — fastest + the two best qualifying alternatives (the v16.1 no-scroll rule is hard). */
export const ROUTE_CHOICE_MAX_OPTIONS = 3;

/** The point at arc length s along a path (linear interpolation within its segment; fine at 100 m scale). */
function pointAtArcM(path: GeoPoint[], segLens: number[], s: number): GeoPoint {
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (s <= acc + segLens[i] || i === segLens.length - 1) {
      const t = segLens[i] === 0 ? 0 : Math.min(1, Math.max(0, (s - acc) / segLens[i]));
      const a = path[i];
      const b = path[i + 1];
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    acc += segLens[i];
  }
  return path[path.length - 1];
}

/** Fraction of path A's length lying within tolM of path B (one direction). */
function sharedFractionOneWay(a: GeoPoint[], b: GeoPoint[], tolM: number, stepM: number): number {
  if (a.length < 2 || b.length < 2) return 0;
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < a.length - 1; i++) {
    const l = haversineM(a[i], a[i + 1]);
    segLens.push(l);
    total += l;
  }
  if (total === 0) return 0;
  let shared = 0;
  // One sample per step, taken at the step's midpoint and
  // weighted by the step's own length (the final step may be
  // short) — the sample stands for the ground around it.
  for (let s = 0; s < total; s += stepM) {
    const w = Math.min(stepM, total - s);
    if (distanceToPathM(pointAtArcM(a, segLens, s + w / 2), b) <= tolM) shared += w;
  }
  return shared / total;
}

/**
 * How much of two routes is the SAME road: the one-way shared
 * fractions in both directions, averaged — symmetric by
 * construction, so neither route is privileged as "the" road.
 * 1 = the same drive; 0 = no shared ground at all.
 */
export function sharedLengthFraction(a: GeoPoint[], b: GeoPoint[]): number {
  const ab = sharedFractionOneWay(a, b, ROUTE_FORK_SHARED_TOLERANCE_M, ROUTE_FORK_SAMPLE_STEP_M);
  const ba = sharedFractionOneWay(b, a, ROUTE_FORK_SHARED_TOLERANCE_M, ROUTE_FORK_SAMPLE_STEP_M);
  return (ab + ba) / 2;
}

/**
 * The alternatives that make a genuine fork with the default
 * route, best (fastest) first, capped so the whole choice
 * fits the picker (default + at most ROUTE_CHOICE_MAX_OPTIONS
 * − 1). An empty list = no fork = no picker = today's build.
 * The same-road case (identical descriptions, near-total
 * overlap) never survives the divergence test — a shared
 * fraction ≥ 0.95 is a fortiori ≥ 0.75 — so it needs no rule
 * of its own.
 */
export function qualifyingForkAlternatives(
  route: ComputedRoute,
  alternatives: readonly ComputedRouteOption[],
): ComputedRouteOption[] {
  if (alternatives.length === 0) return [];
  const fastest = Math.min(route.durationSec, ...alternatives.map(a => a.durationSec));
  const windowSec = Math.max(ROUTE_FORK_MAX_EXTRA_SEC, ROUTE_FORK_MAX_EXTRA_RATIO * fastest);
  const qualifying = alternatives.filter(
    a =>
      a.durationSec - fastest <= windowSec &&
      sharedLengthFraction(a.path, route.path) < ROUTE_FORK_MAX_SHARED,
  );
  qualifying.sort((x, y) => x.durationSec - y.durationSec);
  return qualifying.slice(0, ROUTE_CHOICE_MAX_OPTIONS - 1);
}

/** '24 min' / '1 hr' / '1 hr 5 min' — the picker's compact duration. */
function pickerDurationLabel(durationSec: number): string {
  const mins = Math.max(1, Math.round(durationSec / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * One picker row's label: 'via I-5 · 24 min · 16 mi'. The road
 * name is the API's description when present and sane (short,
 * single-line); otherwise the ordinal fallback — 'Fastest
 * route' for the first row, 'Route N' after it. The label
 * never renders an empty or raw-API string.
 */
export function routeOptionLabel(option: ComputedRouteOption, displayIndex: number): string {
  const desc = option.description;
  const road =
    desc && desc.length <= 48 && !/[\r\n]/.test(desc)
      ? `via ${desc}`
      : displayIndex === 0
        ? 'Fastest route'
        : `Route ${displayIndex + 1}`;
  const miles = Math.max(1, Math.round(option.distanceMeters / 1609.344));
  return `${road} · ${pickerDurationLabel(option.durationSec)} · ${miles} mi`;
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
    return { destinationText: obj.destination.trim(), arrivalTimeMs, tone, topics, audience: fallback.audience };
  } catch {
    return fallback;
  }
}
