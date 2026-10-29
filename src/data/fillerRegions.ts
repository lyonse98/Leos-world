// ---------------------------------------------------------------------------
// Filler regions (Oct 28, 2026) — the region-first picker's data.
//
// HAND COPY of ~/workspace/leos-world/filler-regions.json (version 3).
// THAT JSON IS THE SOURCE OF TRUTH — Erik is ground truth for the
// tags and can re-tag there; update this file in the same commit
// whenever the JSON changes. Tags below are keyed by the slugified
// filler title (lowercase, non-alphanumeric runs → one space), which
// is how story_library's place_name arrives at the lane
// ("The palms aren't from here" → "the palms aren t from here").
//
// The picker's rule (filler-regions.json): prefer unplayed fillers
// tagged with the driver's current region, then universal fillers,
// then any unplayed. A filler tagged with ALL SIX regions is
// universal — the general pool. An UNKNOWN filler key defaults to
// UNIVERSAL: that default is what lets future regional fillers work
// the day their rows land in story_library, with their tags added
// to this table in the render campaign's commit.
//
// The region map is deliberately COARSE: six anchor polygons over
// the county's real geography, resolved deterministically in a
// fixed test order. A boundary miss costs nothing structural — the
// fallback is the general pool, and a slightly-off region match
// still yields a plausible story for the ground. Positions outside
// the county outline resolve to null, and the lane then behaves
// exactly as it did before regions existed.
// ---------------------------------------------------------------------------

export type FillerRegion =
  | 'coast'
  | 'north'
  | 'central'
  | 'east'
  | 'south'
  | 'backcountry';

export const FILLER_REGIONS: readonly FillerRegion[] = [
  'coast',
  'north',
  'central',
  'east',
  'south',
  'backcountry',
];

// Slugified filler title → its regions. Mirrors `existing_20_tags`,
// `regional_27_tags` and `weave_2_tags` in filler-regions.json v3
// (verified title-by-title; the regional 27 were added by the
// Oct 28, 2026 master render campaign that ingested them, and
// 'the pandemonium' by the Oct 29, 2026 weave-popculture ingest.
// The weave program's other new filler, "America's Finest City",
// slugifies to the existing universal 'america s finest city'
// entry below — its authored tags are likewise all six, so it
// needs no key of its own.)
export const FILLER_REGION_TAGS: Readonly<Record<string, readonly FillerRegion[]>> = {
  'the marine layer': ['coast', 'central'],
  'santa ana winds': ['east', 'north', 'backcountry', 'central'],
  'the mediterranean exception': ['coast', 'north', 'central', 'east', 'south', 'backcountry'],
  'three climates in thirty minutes': ['coast', 'north', 'central', 'east', 'south', 'backcountry'],
  'the palms aren t from here': ['coast', 'north', 'central', 'east', 'south', 'backcountry'],
  'the eucalyptus scheme': ['coast', 'north', 'central', 'east', 'south', 'backcountry'],
  'the road beneath the road': ['coast', 'north', 'central'],
  'the name on the map': ['coast', 'north', 'central', 'east', 'south', 'backcountry'],
  'the military s true size': ['coast', 'north', 'central', 'east', 'south', 'backcountry'],
  'one metro two countries': ['south', 'central', 'east'],
  'the water traveled 400 miles': ['coast', 'north', 'central', 'east', 'south', 'backcountry'],
  'the desert in the same county': ['backcountry', 'east'],
  'america s finest city': ['coast', 'north', 'central', 'east', 'south', 'backcountry'],
  'dawn patrol': ['coast'],
  'the whales highway': ['coast'],
  'the grunion runs': ['coast'],
  'the green flash': ['coast'],
  'wireless valley': ['central', 'north'],
  'avocado country': ['north', 'backcountry'],
  'the eternal ground': ['backcountry', 'east'],
  // Regional 27 (added Oct 28, 2026 — master render campaign;
  // mirrors regional_27_tags in filler-regions.json v2).
  'the morning glance': ['coast'],
  'the burn off': ['coast', 'central'],
  'the moving edge': ['coast'],
  'the hidden forest': ['coast'],
  'the blue fire': ['coast'],
  'the friday crawl': ['north', 'east'],
  'the patchwork': ['north'],
  'the winter flip': ['north', 'east'],
  'the ranchos under the suburbs': ['north'],
  'the wild edge': ['north', 'east'],
  'the canyon fingers': ['central'],
  'the old seabed': ['central'],
  'the valley that built the county': ['central'],
  'the hidden river': ['central', 'east'],
  'the heat line': ['east'],
  'reservoir country': ['east'],
  'granite country': ['east', 'backcountry'],
  'the oak belt': ['east', 'backcountry'],
  'the binational day': ['south'],
  'the pink shore': ['south'],
  'the other bay': ['south'],
  'the third language': ['south'],
  'the empty corner': ['south', 'backcountry'],
  'the big drop': ['backcountry'],
  'the dark sky summer': ['backcountry'],
  'the wind s highway': ['backcountry', 'east'],
  'the brief garden': ['backcountry'],
  // Weave-popculture pair (added Oct 29, 2026; mirrors weave_2_tags
  // in filler-regions.json v3 — regions as authored in
  // weave-new-rows-corpus-v1/manifest.json).
  'the pandemonium': ['coast', 'central', 'east'],
}

/** "The palms aren't from here" → "the palms aren t from here". */
export function slugifyFillerTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Regions for a filler title. Unknown titles default to UNIVERSAL
 * (all six) — see the header: a future regional filler is in the
 * general pool until its tags are added here, never invisible.
 */
export function fillerTagsForTitle(title: string): readonly FillerRegion[] {
  return FILLER_REGION_TAGS[slugifyFillerTitle(title)] ?? FILLER_REGIONS;
}

export function isUniversalFillerTags(tags: readonly FillerRegion[]): boolean {
  return tags.length >= FILLER_REGIONS.length;
}

// ------------------------------------------------------------- region map

type LatLng = readonly [number, number];

// Coarse polygons over the county's real geography. Anchors noted
// per region. Polygons may overlap; the fixed test order in
// resolveFillerRegion (coast → backcountry → north → south → east →
// central) makes resolution deterministic where they do.

// The ocean strip, San Onofre to Imperial Beach: west edge just
// offshore, east edge roughly the coastal hills / I-5 line through
// Oceanside, Carlsbad, Encinitas, Del Mar, La Jolla, Pacific Beach,
// Ocean Beach, Point Loma, Coronado.
const COAST_POLYGON: LatLng[] = [
  [33.44, -117.66], [32.52, -117.26], [32.53, -117.08], [32.65, -117.13],
  [32.70, -117.16], [32.75, -117.19], [32.85, -117.21], [32.95, -117.215],
  [33.05, -117.225], [33.18, -117.265], [33.30, -117.27], [33.42, -117.31],
  [33.44, -117.48],
];

// The crest and the desert: Palomar, Warner Springs, Santa Ysabel,
// Julian, Borrego Springs, Ocotillo Wells, Pine Valley, Descanso,
// Campo. West edge runs along the ~-116.8s foothill line, east of
// Ramona and Alpine.
const BACKCOUNTRY_POLYGON: LatLng[] = [
  [33.52, -116.80], [33.35, -116.90], [33.15, -116.85], [33.00, -116.80],
  [32.90, -116.72], [32.80, -116.68], [32.65, -116.55], [32.53, -116.50],
  [32.53, -116.04], [32.85, -116.04], [33.02, -116.06], [33.28, -116.16],
];

// Inland North County: Fallbrook, Vista, San Marcos, Escondido,
// Valley Center, Pala, Rancho Bernardo, Poway, Ramona. South edge
// roughly the SR-56 / SR-52 line; the coast strip and the
// backcountry are claimed earlier in the test order. The west
// chain reuses the coast strip's east edge point-for-point so the
// two polygons tile with no lens of unclaimed ground between them.
const NORTH_POLYGON: LatLng[] = [
  [33.44, -117.48], [33.42, -117.31], [33.30, -117.27], [33.18, -117.265],
  [33.05, -117.225], [32.95, -117.215], [32.94, -117.13], [32.97, -117.05],
  [33.00, -116.80], [33.15, -116.85], [33.35, -116.90], [33.52, -116.80],
  [33.47, -117.20],
];

// South Bay and the border: National City, Chula Vista, San Ysidro,
// Otay Mesa, Bonita. North edge along the ~32.68 parallel east of
// the bay; downtown (west of -117.13 and north of the edge) stays
// central.
const SOUTH_POLYGON: LatLng[] = [
  [32.70, -117.13], [32.68, -117.05], [32.66, -116.95], [32.65, -116.80],
  [32.62, -116.58], [32.53, -116.52], [32.53, -117.05], [32.60, -117.10],
];

// East County: Santee, El Cajon, La Mesa, Lemon Grove, Spring
// Valley, Lakeside, Alpine, Rancho San Diego. West edge roughly the
// Mission Valley / San Carlos line; the backcountry takes over at
// the foothills in the test order.
const EAST_POLYGON: LatLng[] = [
  [32.99, -117.04], [33.00, -116.80], [32.90, -116.72], [32.82, -116.67],
  [32.70, -116.62], [32.68, -116.80], [32.68, -116.95], [32.70, -117.02],
  [32.85, -117.05],
];

// The county outline. Central — the urban core (downtown, Mission
// Valley, Kearny Mesa, Clairemont, UTC, Mira Mesa, Tierrasanta) —
// is the residual region: anything inside the county that no
// earlier polygon claimed is central. Anything outside the outline
// is outside the county: region null, general-pool behavior.
const COUNTY_POLYGON: LatLng[] = [
  [33.44, -117.66], [33.47, -117.20], [33.52, -116.78], [33.30, -116.30],
  [33.05, -116.12], [32.88, -116.03], [32.54, -116.03], [32.53, -117.02],
  [32.54, -117.24], [32.80, -117.30], [33.05, -117.40], [33.30, -117.52],
];

function pointInPolygon(lat: number, lng: number, polygon: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const crosses =
      lngI > lng !== lngJ > lng &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * The driver's region, or null outside the county. Deterministic:
 * polygons are tested in the fixed order coast, backcountry,
 * north, south, east, then the county outline as central.
 */
export function resolveFillerRegion(lat: number, lng: number): FillerRegion | null {
  if (pointInPolygon(lat, lng, COAST_POLYGON)) return 'coast';
  if (pointInPolygon(lat, lng, BACKCOUNTRY_POLYGON)) return 'backcountry';
  if (pointInPolygon(lat, lng, NORTH_POLYGON)) return 'north';
  if (pointInPolygon(lat, lng, SOUTH_POLYGON)) return 'south';
  if (pointInPolygon(lat, lng, EAST_POLYGON)) return 'east';
  if (pointInPolygon(lat, lng, COUNTY_POLYGON)) return 'central';
  return null;
}

// ------------------------------------------------------------- pick order

export type FillerMatch = 'region' | 'universal' | 'any';

const MATCH_TIER: Record<FillerMatch, number> = { region: 0, universal: 1, any: 2 };

/**
 * How a filler with these tags matches a resolved region: a
 * region-tagged (non-universal) filler is a 'region' match, a
 * universal filler is a 'universal' match, anything else — or any
 * filler when the region is null — is 'any'.
 */
export function fillerMatchFor(
  tags: readonly FillerRegion[],
  region: FillerRegion | null
): FillerMatch {
  if (region === null) return 'any';
  if (isUniversalFillerTags(tags)) return 'universal';
  return tags.includes(region) ? 'region' : 'any';
}

/**
 * Stable tier ordering for the pick: with a region resolved,
 * region matches come first, then universals, then the rest —
 * the input order (the lane's per-tour shuffle) is preserved
 * within each tier. With region null the input is returned
 * untouched, so the pick is exactly the pre-region behavior.
 */
export function orderFillersForRegion<T>(
  items: readonly T[],
  region: FillerRegion | null,
  tagsOf: (item: T) => readonly FillerRegion[]
): T[] {
  if (region === null) return [...items];
  const tiers: T[][] = [[], [], []];
  for (const item of items) {
    tiers[MATCH_TIER[fillerMatchFor(tagsOf(item), region)]].push(item);
  }
  return [...tiers[0], ...tiers[1], ...tiers[2]];
}
