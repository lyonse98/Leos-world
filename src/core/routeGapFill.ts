// Coverage Guarantee (route-mode differentiator 1 of 3 — Erik,
// Nov 3, 2026: "all three in that order"). Route mode should feel
// like a produced podcast episode, and a produced episode never
// has an eight-minute hole in the middle. After the composer tiles
// the plan, this pass walks it in travel time, finds the dead
// stretches — continuous drive time with no STORY sounding — and
// fills them deliberately, at plan time:
//
//   1. LIBRARY FIRST (the standing serve doctrine: stored first,
//      live as fallback). The build's own fetched candidate set is
//      re-checked for unheard shelf units anchored inside the gap
//      that the composer did not tile (the fetch bound is ~150;
//      usable units can be present but untiled). Those tile first.
//   2. GENERATION IS THE LAST RESORT, only for stretches still
//      bare after the shelf pass: fetch-ahead Places discovery
//      along the gap, a story generated under the leo-v14 persona
//      (the system instruction rides every generateStoryText call)
//      from a fact pack, a mechanical style gate — a failing text
//      is discarded entirely, never served, never ingested — and
//      synthesis through the same TTS path the runner uses.
//   3. SHELF PROMOTION: a gate-passing generated story is also
//      ingested into story_library (anon insert, ignore-
//      duplicates; fresh storage key carrying the -route-gap-v1
//      marker), so the next build can serve it from the shelf.
//      Ingest failure never affects the tour.
//
// Caps + failure discipline: at most MAX_GENERATED_GAP_STORIES
// generated stories per build (generation attempts are bounded
// separately so a run of gate rejects cannot stall a build);
// every live step runs under a timeout with skip-fallback — on
// any failure the plan ships without the fill. Telemetry
// route_gap_fill files once per gap considered. Gap items are
// GEOGRAPHIC stories: they are not portals and never consume the
// composer's portal budget, and nothing here re-opens composer
// v2 semantics — fills are inserted as ordinary story items with
// ordinary anchored-release / stale-drop / owed semantics.
//
// Everything live is behind injectable deps (the codebase's
// fetchFn/deps pattern), so the harness proves every rule here
// with stubs and zero live calls.

import {
  angleClassRank,
  configuredKeys,
  distanceToPathM,
  estimateDurationSec,
  haversineM,
  progressAlongPath,
  storyWindow,
  type GeoPoint,
  type LibraryUnit,
  type ParsedRouteInput,
  type PlanItem,
  type RoutePlan,
} from './routeMode';
import { registryNear } from './facts';
import { MAJOR_PLACES } from '../content/majorPlaces';

/** A dead stretch longer than this (seconds of drive time) is a gap worth filling. */
export const GAP_THRESHOLD_SEC = 180;
/** Generated gap stories per route build, at most. */
export const MAX_GENERATED_GAP_STORIES = 2;
/** Hard bound on generation attempts per build (successes + failures). */
const MAX_GENERATION_ATTEMPTS = MAX_GENERATED_GAP_STORIES + 2;
/** Shelf inserts per single gap, at most (each insert re-splits the gap). */
const MAX_SHELF_INSERTS_PER_GAP = 6;
/** Default per-step timeout for discovery / generation / TTS / ingest. */
const DEFAULT_STEP_TIMEOUT_MS = 30_000;
/** The angle a discovered gap subject is generated and shelved under. */
export const GAP_STORY_ANGLE = 'landmark_origin';

// ------------------------------------------------------------ gap geometry

export interface StoryGap {
  /** Travel-time span of the dead stretch, seconds into the drive. */
  startSec: number;
  endSec: number;
  gapSec: number;
  midSec: number;
  /** The same span in path-progress units. */
  startProgress: number;
  endProgress: number;
  midProgress: number;
}

function gapOf(startSec: number, endSec: number, driveSec: number): StoryGap {
  return {
    startSec,
    endSec,
    gapSec: endSec - startSec,
    midSec: (startSec + endSec) / 2,
    startProgress: startSec / driveSec,
    endProgress: endSec / driveSec,
    midProgress: (startSec + endSec) / (2 * driveSec),
  };
}

/**
 * When each story SOUNDS, in expected travel seconds: the plan's
 * story windows (release → expire) on the composer's uniform
 * expected-time map. Bridges and reactions are connective tissue
 * and never appear here — they do not close a story gap. Items
 * without a window (portal stories, hosted fillers) sound at
 * their anchor for their duration.
 */
function storyIntervalsSec(items: PlanItem[], driveSec: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const it of items) {
    if ((it.kind !== 'story' && it.kind !== 'filler') || !it.unit) continue;
    const anchorSec = (it.anchorProgress ?? 0) * driveSec;
    const start = it.releaseProgress !== undefined ? it.releaseProgress * driveSec : anchorSec;
    const end = it.expireProgress !== undefined ? it.expireProgress * driveSec : start + it.durationSec;
    out.push({
      start: Math.max(0, Math.min(driveSec, start)),
      end: Math.max(0, Math.min(driveSec, end)),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Comparison tolerance for the gap threshold: windows are float
 * progress × drive seconds, so a stretch that IS the threshold
 * can compute a hair over it (180.00000000000003). Half a second
 * is far below anything audible and keeps "longer than 180 s"
 * meaning 180 s.
 */
const GAP_EPSILON_SEC = 0.5;

/** Dead stretches strictly inside [spanStart, spanEnd], largest first. */
function deadStretches(
  items: PlanItem[],
  driveSec: number,
  spanStart: number,
  spanEnd: number,
  thresholdSec: number,
): StoryGap[] {
  const gaps: StoryGap[] = [];
  let cursor = spanStart;
  for (const iv of storyIntervalsSec(items, driveSec)) {
    if (iv.end <= spanStart || iv.start >= spanEnd) continue;
    const start = Math.max(iv.start, spanStart);
    const end = Math.min(iv.end, spanEnd);
    if (start - cursor > thresholdSec + GAP_EPSILON_SEC) gaps.push(gapOf(cursor, start, driveSec));
    cursor = Math.max(cursor, end);
  }
  if (spanEnd - cursor > thresholdSec + GAP_EPSILON_SEC) gaps.push(gapOf(cursor, spanEnd, driveSec));
  return gaps.sort((a, b) => b.gapSec - a.gapSec);
}

/**
 * The plan's dead stretches (composer item 5): continuous drive
 * time with no story sounding, measured between story windows,
 * including the departure → first-story and last-story → arrival
 * edges. A stretch is a gap when it is LONGER than thresholdSec
 * (default GAP_THRESHOLD_SEC = 180). Ranked largest-first.
 */
export function detectStoryGaps(
  plan: RoutePlan,
  driveSec: number,
  thresholdSec: number = GAP_THRESHOLD_SEC,
): StoryGap[] {
  if (!(driveSec > 0)) return [];
  return deadStretches(plan.items, driveSec, 0, driveSec, thresholdSec);
}

/** The point at a path-progress fraction (arc-length interpolation). */
export function pointAtProgress(path: GeoPoint[], progress: number): GeoPoint {
  if (path.length === 0) return { lat: 0, lng: 0 };
  if (path.length === 1 || progress <= 0) return path[0];
  if (progress >= 1) return path[path.length - 1];
  let total = 0;
  const segLens: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const l = haversineM(path[i], path[i + 1]);
    segLens.push(l);
    total += l;
  }
  if (total === 0) return path[0];
  let target = progress * total;
  for (let i = 0; i < segLens.length; i++) {
    if (target <= segLens[i]) {
      const t = segLens[i] === 0 ? 0 : target / segLens[i];
      return {
        lat: path[i].lat + (path[i + 1].lat - path[i].lat) * t,
        lng: path[i].lng + (path[i + 1].lng - path[i].lng) * t,
      };
    }
    target -= segLens[i];
  }
  return path[path.length - 1];
}

// ------------------------------------------------------------ style gate

// The in-app style gate: the MECHANICAL hard-fail layer of the
// library style gate (repo-avatar/scripts/library/style-gate.mjs,
// rubric A1–A15), reduced to the checks that are honestly
// mechanical at plan time. The library gate's judgment classes
// (wow position, the TURN, scene traceability…) have no judge at
// plan time, so they are not approximated here; the classes that
// CAN fail a text outright — the honesty class and the output
// contract — fail it outright: a failing text is discarded
// entirely (not served, not ingested).

const RELATIVE_DIRECTIONS = [
  /\bon your (left|right)\b/i,
  /\bcoming up on\b/i,
  /\bjust ahead\b/i,
  /\blook now\b/i,
  /\bwatch for\b/i,
  /\byou'?ll see\b/i,
];

/** A11 honesty class (style-gate.mjs EXCLUSION_PATTERNS): standing exclusions + spectacle markers. */
const EXCLUSION_PATTERNS = [
  /\bschool shooting/i,
  /\bdeadliest\b/i,
  /\bmid-?air collision\b/i,
  /\bdeath toll\b/i,
];

function splitSentences(text: string): string[] {
  const t = text.replace(/…/g, '...').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  return t
    .replace(/\.\.\./g, '\u0001')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.replace(/\u0001/g, '...').trim())
    .filter(Boolean);
}

/**
 * The default gap-story style gate. Pass requires: a real story's
 * worth of prose (≥3 sentences, 30–240 s spoken), the OUTPUT
 * CONTRACT (plain spoken prose — no markdown, no list markers),
 * zero relative directions (A14 hard list), zero honesty-class
 * exclusion hits (A11), and the subject named in the first two
 * sentences (the persona's LOOK beat, mechanical form).
 */
export function gapStoryStyleGate(text: string, subjectName: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  const sentences = splitSentences(t);
  if (sentences.length < 3) return false;
  const dur = estimateDurationSec(t);
  if (dur < 30 || dur > 240) return false;
  if (/[*#`>]/.test(t) || /(^|\n)\s*[-•]\s/.test(t)) return false;
  for (const re of RELATIVE_DIRECTIONS) if (re.test(t)) return false;
  for (const re of EXCLUSION_PATTERNS) if (re.test(t)) return false;
  const tokens = subjectName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !['center', 'park', 'san', 'diego'].includes(w));
  if (tokens.length > 0) {
    const firstTwo = sentences.slice(0, 2).join(' ').toLowerCase();
    if (!tokens.some(tok => firstTwo.includes(tok))) return false;
  }
  return true;
}

// ------------------------------------------------------------ discovery (fetch-ahead)

export interface GapSubject {
  name: string;
  lat: number;
  lng: number;
  types: string[];
  rating: number | null;
  userRatings: number | null;
  address: string | null;
  /** Extra fact-pack lines (historic-register facts, curated notes). */
  facts: string[];
}

/** The story-type vocabulary freeform discovery searches (facts.ts STORY_TYPES). */
const GAP_STORY_TYPES = [
  'tourist_attraction',
  'museum',
  'park',
  'church',
  'zoo',
  'aquarium',
  'stadium',
  'library',
  'university',
  'cemetery',
  'art_gallery',
  'performing_arts_theater',
  'marina',
  'lighthouse',
];

interface PlacesNearbyResult {
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  formattedAddress?: string;
}

/**
 * One Places (New) searchNearby call, walking ALL configured keys
 * (the ae80f34 discipline: the keys' API-restriction lists differ
 * per key, so a blocked key moves to the next — never a single-key
 * call). Returns [] when every key fails or nothing is near.
 */
async function searchNearbyAllKeys(
  center: GeoPoint,
  radiusM: number,
  apiKeys: string[],
  fetchFn: typeof fetch,
): Promise<PlacesNearbyResult[]> {
  for (const apiKey of configuredKeys(apiKeys)) {
    try {
      const res = await fetchFn('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'places.displayName,places.location,places.rating,places.userRatingCount,places.types,places.formattedAddress',
        },
        body: JSON.stringify({
          includedTypes: GAP_STORY_TYPES,
          maxResultCount: 10,
          rankPreference: 'POPULARITY',
          locationRestriction: {
            circle: { center: { latitude: center.lat, longitude: center.lng }, radius: radiusM },
          },
        }),
      });
      if (!res.ok) continue; // blocked / failed key → the next key
      const parsed = (await res.json()) as { places?: PlacesNearbyResult[] };
      return parsed.places ?? [];
    } catch {
      continue; // transport failure → the next key
    }
  }
  return [];
}

/**
 * Fetch-ahead discovery for a gap: Places search around each
 * sample point along the stretch, folded with the bundled
 * historic registry (verified coordinates only) and the curated
 * major-places table — the same candidate recipe and scoring
 * constants as freeform's discoverCandidates, so "the strongest
 * subject" means the same thing in both lanes. Ranked strongest
 * first. Pure network discipline: Places calls walk every
 * configured key; the registry/major folds are local data.
 */
export async function discoverGapSubjects(
  points: GeoPoint[],
  apiKeys: string[],
  fetchFn: typeof fetch = fetch,
): Promise<GapSubject[]> {
  interface Scored extends GapSubject {
    score: number;
  }
  const byName = new Map<string, Scored>();
  const keyOf = (name: string) => name.toLowerCase().trim();
  const popularity = (rating: number | null, userRatings: number | null): number =>
    rating !== null ? (rating - 3.5) * 20 + Math.min(20, Math.log10((userRatings ?? 0) + 1) * 8) : 0;

  for (const point of points) {
    const places = await searchNearbyAllKeys(point, 1200, apiKeys, fetchFn);
    for (const p of places) {
      const name = p.displayName?.text;
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      if (!name || lat === undefined || lng === undefined) continue;
      const existing = byName.get(keyOf(name));
      if (existing) {
        existing.score = Math.max(existing.score, popularity(p.rating ?? null, p.userRatingCount ?? null));
        continue;
      }
      byName.set(keyOf(name), {
        name,
        lat,
        lng,
        types: p.types ?? [],
        rating: p.rating ?? null,
        userRatings: p.userRatingCount ?? null,
        address: p.formattedAddress ?? null,
        facts: [],
        score: popularity(p.rating ?? null, p.userRatingCount ?? null),
      });
    }
    // Registry fold: a verified register record near a Places hit
    // boosts it (national uncapped, local capped — the registry
    // doctrine freeform discovery uses); a record with no Places
    // hit stands as its own candidate with its facts attached.
    for (const rec of registryNear(point, 1200)) {
      if (rec.coordQuality !== 'verified') continue;
      const national = rec.registers.includes('national');
      const boost = national ? 45 : 25;
      const facts: string[] = [];
      if (rec.significance) facts.push(`Historic register entry: ${rec.name} — ${rec.significance}.`);
      if (rec.designatedYear) facts.push(`Designated ${rec.designatedYear}.`);
      if (rec.architect) facts.push(`Architect: ${rec.architect}.`);
      if (rec.address) facts.push(`Address on record: ${rec.address}.`);
      const existing =
        byName.get(keyOf(rec.name)) ??
        [...byName.values()].find(s => haversineM(s, rec) <= 150);
      if (existing) {
        existing.score += boost;
        for (const f of facts) if (!existing.facts.includes(f)) existing.facts.push(f);
      } else {
        byName.set(keyOf(rec.name), {
          name: rec.name,
          lat: rec.lat,
          lng: rec.lng,
          types: ['historic_site'],
          rating: null,
          userRatings: null,
          address: rec.address,
          facts,
          score: 20 + boost,
        });
      }
    }
    for (const major of MAJOR_PLACES) {
      if (haversineM(point, major) > 1500) continue;
      const existing =
        byName.get(keyOf(major.name)) ??
        [...byName.values()].find(s => haversineM(s, major) <= 150);
      if (existing) {
        existing.score += major.historicalScore / 4;
      } else {
        byName.set(keyOf(major.name), {
          name: major.name,
          lat: major.lat,
          lng: major.lng,
          types: major.types,
          rating: null,
          userRatings: null,
          address: null,
          facts: [],
          score: 30 + major.historicalScore / 4,
        });
      }
    }
  }
  return [...byName.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _score, ...subject }) => subject);
}

// ------------------------------------------------------------ the fill pass

export type GapFillResult = 'shelf' | 'generated' | 'skipped' | 'failed';

export interface GapFillEvent {
  gap_sec: number;
  result: GapFillResult;
  subject?: string;
}

export interface GapFillContext {
  /** The exact candidate set this build fetched for the composer (the App's units array). */
  fetchedUnits: LibraryUnit[];
  /** Heard keys (place_key|angle) for this device. */
  heardKeys: Set<string>;
  /** The trip's parsed input (tone steers shelf ranking, as in the composer). */
  input: ParsedRouteInput;
  /** The Routes drive-time estimate — the plan's expected-time map. */
  driveSec: number;
}

export interface GapFillDeps {
  /** Fetch-ahead discovery along a bare stretch (App wires discoverGapSubjects over the build's Google keys). */
  discoverSubjects?: (points: GeoPoint[]) => Promise<GapSubject[]>;
  /** Story generation under the leo-v14 persona (App wires gemini.generateStoryText — the freeform live path). */
  generateStory?: (prompt: string) => Promise<string>;
  /** TTS (App wires gemini.synthesizeSpeech — the same path the runner uses for bridges). */
  synthesize?: (text: string) => Promise<Blob>;
  /**
   * Shelf promotion: upload the audio + insert the story_library
   * row; resolves the stored audio path on success, null on any
   * failure. Failure never affects the tour (the unit then plays
   * from its text through the runner's synth fallback).
   */
  ingest?: (args: { unit: LibraryUnit; text: string; audio: Blob }) => Promise<string | null>;
  /** Style gate (default gapStoryStyleGate). A failing text is discarded entirely. */
  styleGate?: (text: string, subjectName: string) => boolean;
  /** Telemetry: one route_gap_fill event per gap considered (App wires backend.emitEvent). */
  onEvent?: (event: GapFillEvent) => void;
  /** Fires once, when the first generation attempt starts (the build status may note it). */
  onGenerateStart?: () => void;
  /** Per-step timeout for discovery / generation / TTS / ingest. */
  timeoutMs?: number;
  /** Generated-story cap for this build (default MAX_GENERATED_GAP_STORIES). */
  maxGenerated?: number;
  /** Gap threshold override (default GAP_THRESHOLD_SEC). */
  thresholdSec?: number;
}

/** Race a step against the timeout: null on timeout or rejection (skip-fallback). */
function withTimeout<T>(step: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>(resolve => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, ms);
    const timerHandle = timer as unknown as { unref?: () => void };
    if (typeof timerHandle.unref === 'function') timerHandle.unref();
    step.then(
      value => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(null);
        }
      },
    );
  });
}

/**
 * The library writer's place-key dialect (backend.normalizePlaceKey,
 * mirrored — this module stays backend-free like routeMode): the
 * key a shelf row for this subject will carry, so a promoted
 * story's unit id matches what a future build's fetch produces.
 */
function gapPlaceKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, ' ');
}

/** Build a plan story item exactly as the composer builds a geographic story item. */
function storyItemFor(unit: LibraryUnit, anchorProgress: number, driveSec: number): PlanItem {
  const win = storyWindow(anchorProgress, unit.durationSec, driveSec);
  return {
    kind: 'story',
    id: unit.id,
    label: unit.placeName,
    durationSec: unit.durationSec,
    unit,
    ready: true,
    anchorProgress,
    releaseProgress: win.release,
    expireProgress: win.expire,
  };
}

/**
 * Insert a story item in playback order: just before the next
 * story item in the plan (or before the bridge that leads into
 * it, so every bridge keeps its adjacency to the story it names;
 * appended at the end for an arrival-edge gap). The runner's
 * feed gate is window-based, so exact position among non-story
 * items is pacing, not correctness.
 */
function insertStoryItem(items: PlanItem[], item: PlanItem): void {
  const anchor = item.anchorProgress ?? 0;
  let at = items.length;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if ((it.kind === 'story' || it.kind === 'filler') && (it.anchorProgress ?? 0) > anchor) {
      at = i;
      break;
    }
  }
  if (at > 0 && at < items.length) {
    const before = items[at - 1];
    const next = items[at];
    if (before.kind === 'bridge' && before.nextUnitId === next.id) at -= 1;
  }
  items.splice(at, 0, item);
}

/** The gap-story prompt: freeform's storyPrompt shape (MODE first, fact pack), plus route context. */
function gapStoryPrompt(
  subject: GapSubject,
  plan: RoutePlan,
  sub: StoryGap,
  toldLabels: string[],
): string {
  const targetSec = Math.max(60, Math.min(150, Math.round(sub.gapSec * 0.8)));
  const sentences = Math.max(8, Math.min(18, Math.round(targetSec / 7)));
  const pack: string[] = [
    `PLACE: ${subject.name}`,
    `Coordinates: ${subject.lat.toFixed(5)}, ${subject.lng.toFixed(5)}`,
  ];
  if (subject.types.length) pack.push(`Types: ${subject.types.join(', ')}`);
  if (subject.rating !== null) {
    pack.push(
      `Visitor rating: ${subject.rating} / 5${subject.userRatings !== null ? ` from ${subject.userRatings} ratings` : ''}`,
    );
  }
  if (subject.address) pack.push(`Address: ${subject.address}`);
  for (const fact of subject.facts) pack.push(`Registry fact: ${fact}`);
  pack.push(`The listener is driving toward ${plan.destinationName}; this place sits along that drive.`);
  const parts = [
    'MODE: driving',
    `Tell the story of ${subject.name}.`,
    `FACT PACK:\n${pack.join('\n')}`,
    `This story fills a quiet stretch of the drive — the road around it is open, so it has room: aim for about ${targetSec} seconds of spoken story (roughly ${sentences} sentences), told completely. Never pad a thin subject to fill time; a shorter, complete story beats a stretched one.`,
  ];
  if (toldLabels.length > 0) {
    parts.push(`Already told this tour (do not retell or re-center these): ${toldLabels.slice(0, 12).join('; ')}.`);
  }
  return parts.join('\n\n');
}

/**
 * The Coverage Guarantee pass. Runs after composeRoutePlan,
 * before the runner starts. Returns a NEW plan (the composed plan
 * is not mutated). Never throws: every failure mode degrades to
 * the composed plan, partially or wholly.
 */
export async function fillRouteGaps(
  plan: RoutePlan,
  ctx: GapFillContext,
  deps: GapFillDeps,
): Promise<RoutePlan> {
  const driveSec = ctx.driveSec > 0 ? ctx.driveSec : (plan.driveSec ?? plan.budgetSec);
  const threshold = deps.thresholdSec ?? GAP_THRESHOLD_SEC;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const maxGenerated = deps.maxGenerated ?? MAX_GENERATED_GAP_STORIES;
  if (!(driveSec > 0)) return plan;
  const gaps = detectStoryGaps(plan, driveSec, threshold);
  if (gaps.length === 0) return plan;

  const items: PlanItem[] = [...plan.items];
  const plannedIds = new Set(items.map(i => i.id));
  // Places the shelf already covers (planned or merely fetched):
  // a discovered subject on covered ground is never generated —
  // the shelf owns that place, heard or not.
  const coveredPlaceKeys = new Set<string>([
    ...[...ctx.fetchedUnits].map(u => u.placeKey),
    ...items.filter(i => i.unit).map(i => (i.unit as LibraryUnit).placeKey),
  ]);
  const inCorridor = (u: LibraryUnit): boolean =>
    distanceToPathM({ lat: u.lat, lng: u.lng }, plan.path) <= 1500 ||
    haversineM({ lat: u.lat, lng: u.lng }, plan.destination) <= 1500;
  const toneRank = (u: LibraryUnit): number =>
    ctx.input.tone && (u.tone === ctx.input.tone || u.toneSecondary === ctx.input.tone) ? 0 : 1;

  /**
   * Best untiled shelf unit anchored inside a sub-gap (ranking:
   * tone → angle class → stories before intros → nearest the
   * middle). Plain neighborhood intros ARE fill candidates
   * (welcome demotion, Nov 4, 2026: intros left the composer's
   * chapter-opener lane, and the guarantee's library-first pool
   * is where they belong in route) — heard-excluded exactly
   * like stories, and ranked after story angles so a real
   * story always wins its gap first. The greet variant and the
   * filler lanes never tile anywhere in route.
   */
  const bestShelfCandidate = (sub: StoryGap): LibraryUnit | null => {
    let best: LibraryUnit | null = null;
    let bestKey: [number, number, number, number] | null = null;
    for (const u of ctx.fetchedUnits) {
      if (plannedIds.has(u.id) || ctx.heardKeys.has(u.id)) continue;
      if (u.angle === 'neighborhood_intro_greet' || u.angle === 'filler' || u.angle === 'filler_hosted') continue;
      if (!inCorridor(u)) continue; // geographic only — a fetched portal candidate never becomes a gap fill
      const anchor = progressAlongPath({ lat: u.lat, lng: u.lng }, plan.path);
      if (anchor < sub.startProgress - 1e-9 || anchor > sub.endProgress + 1e-9) continue;
      const key: [number, number, number, number] = [
        toneRank(u),
        angleClassRank(u.angle),
        u.angle === 'neighborhood_intro' ? 1 : 0,
        Math.abs(anchor - sub.midProgress),
      ];
      if (
        !bestKey ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] < bestKey[2]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] === bestKey[2] && key[3] < bestKey[3])
      ) {
        best = u;
        bestKey = key;
      }
    }
    return best;
  };

  let generatedCount = 0;
  let attemptCount = 0;
  let generateStartFired = false;

  for (const gap of gaps) {
    let shelfInserted = false;
    let firstFillSubject: string | undefined;
    // ---- library first: tile untiled fetched units into the gap
    for (let n = 0; n < MAX_SHELF_INSERTS_PER_GAP; n++) {
      const subs = deadStretches(items, driveSec, gap.startSec, gap.endSec, threshold);
      if (subs.length === 0) break;
      let placed = false;
      for (const sub of subs) {
        const cand = bestShelfCandidate(sub);
        if (!cand) continue;
        const anchor = progressAlongPath({ lat: cand.lat, lng: cand.lng }, plan.path);
        insertStoryItem(items, storyItemFor(cand, anchor, driveSec));
        plannedIds.add(cand.id);
        shelfInserted = true;
        firstFillSubject = firstFillSubject ?? cand.placeName;
        placed = true;
        break;
      }
      if (!placed) break;
    }
    // ---- generation, the last resort, for the largest bare remainder
    let genAttempted = false;
    let genSubject: string | undefined;
    const subs = deadStretches(items, driveSec, gap.startSec, gap.endSec, threshold);
    if (
      subs.length > 0 &&
      deps.discoverSubjects &&
      deps.generateStory &&
      generatedCount < maxGenerated &&
      attemptCount < MAX_GENERATION_ATTEMPTS
    ) {
      const sub = subs[0];
      const points = [0.3, 0.55, 0.8].map(f =>
        pointAtProgress(plan.path, sub.startProgress + (sub.endProgress - sub.startProgress) * f),
      );
      const subjects = (await withTimeout(deps.discoverSubjects(points), timeoutMs)) ?? [];
      const subject = subjects.find(s => !coveredPlaceKeys.has(gapPlaceKey(s.name)));
      if (subject) {
        genAttempted = true;
        attemptCount += 1;
        if (!generateStartFired) {
          generateStartFired = true;
          deps.onGenerateStart?.();
        }
        const toldLabels = items.filter(i => i.unit).map(i => (i.unit as LibraryUnit).placeName);
        const text = await withTimeout(
          deps.generateStory(gapStoryPrompt(subject, plan, sub, toldLabels)),
          timeoutMs,
        );
        const gate = deps.styleGate ?? gapStoryStyleGate;
        if (text && gate(text, subject.name)) {
          const placeKey = gapPlaceKey(subject.name);
          const unit: LibraryUnit = {
            id: `${placeKey}|${GAP_STORY_ANGLE}`,
            placeKey,
            placeName: subject.name,
            angle: GAP_STORY_ANGLE,
            lat: subject.lat,
            lng: subject.lng,
            durationSec: estimateDurationSec(text),
            topics: [],
            tone: null,
            toneSecondary: null,
            audioPath: null,
            storyText: text,
          };
          // Shelf promotion: synthesize once for the bucket; the
          // unit then plays from its stored audio (stored first),
          // and the row joins the shelf for future builds. Any
          // failure leaves the unit on its text — the runner
          // synthesizes it through the same TTS path it uses for
          // bridges — and never affects the tour.
          if (deps.synthesize && deps.ingest) {
            const blob = await withTimeout(deps.synthesize(text), timeoutMs);
            if (blob) {
              const storedPath = await withTimeout(deps.ingest({ unit, text, audio: blob }), timeoutMs);
              if (storedPath) unit.audioPath = storedPath;
            }
          }
          let anchor = progressAlongPath({ lat: subject.lat, lng: subject.lng }, plan.path);
          if (anchor < sub.startProgress || anchor > sub.endProgress) anchor = sub.midProgress;
          insertStoryItem(items, storyItemFor(unit, anchor, driveSec));
          plannedIds.add(unit.id);
          coveredPlaceKeys.add(placeKey);
          generatedCount += 1;
          genSubject = subject.name;
        }
      }
    }
    const result: GapFillResult = genSubject
      ? 'generated'
      : shelfInserted
        ? 'shelf'
        : genAttempted
          ? 'failed'
          : 'skipped';
    const eventSubject = genSubject ?? firstFillSubject;
    deps.onEvent?.({
      gap_sec: Math.round(gap.gapSec),
      result,
      ...(eventSubject ? { subject: eventSubject } : {}),
    });
  }

  return { ...plan, items, totalSec: items.reduce((s, i) => s + i.durationSec, 0) };
}
