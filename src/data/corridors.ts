// Highway Corridor Library — segment dataset (pre-publish stack
// Item 6, Oct 27, 2026; Erik's direction from the driver's seat:
// "add the corridor library before I publish").
//
// WHY THIS EXISTS: at highway speed the live pipeline structurally
// loses — pipeline latency × freeway speed means a cold generation
// is aimed at road the listener has already left (the fix stack's
// corridor doctrine could only fall back to a live region story,
// itself hostage to the same latency, or to designed silence). A
// banked corridor story — one pre-rendered narration per freeway
// segment per direction of travel, describing the neighborhoods the
// drive passes through — removes that problem class instead of
// mitigating it. The corridor bank is the PRIMARY highway serve;
// live region generation is the fallback; designed silence is last.
//
// SIZING RULE (Erik's refinement, Oct 27, 2026): a segment is sized
// by its TRAVERSAL TIME at free-flow speed, not by where the map
// happens to have joints. No story unit covers more than ~4.5 km of
// road; sub-~2 km fragments are merged into their neighbor rather
// than banked as stubs; and each story is generated to complete at
// ~85-90% of its segment's traversal at the segment's DESIGN SPEED
// (designSpeedMph — 60 mph default, lower where the road's genuine
// free-flow is slower, e.g. SR-163 through Balboa Park at 50). The
// slight under-run is deliberate: a story never overruns into the
// next segment's story (chaining hands off), and when traffic slows
// the traversal, the story ending early inside its segment is the
// handoff working as designed — the remainder belongs to the normal
// machinery at speeds where latency × speed is landable again.
// corridorTargetSentences() below is the rule as code; the library
// builder generates to it. Banked region narration may exceed the
// live highway band (12-18) — that is expected and fine.
//
// COVERAGE (v1): metro San Diego freeways on Erik's real routes —
// home in La Jolla/University City, the commute toward SWRMC/Naval
// Base San Diego (I-5 S / SR-163 S), the SeaWorld/Liberty Station
// test routes (I-8 / I-5), airport runs (I-5 past SAN). 86
// segment-directions after the sizing re-segmentation (the original
// 26 named stretches, cut to the rule). Segments chain: one
// segment's exit anchor is the next segment's entry on the same
// freeway and direction, so a freeway run narrates continuously.
// A piece that starts and ends inside a single place is a THROUGH
// piece ('I-15 North: Through Rancho Bernardo') — its fromName and
// toName stay equal so chaining holds, and the display name says
// what the drive actually does there.
//
// COORDINATE PROVENANCE: polylines are hand-laid on the real
// freeway paths at interchange resolution (junctions and named
// cross-streets), not surveyed centerlines; segment boundaries were
// cut along those lines by measured arc length, snapped to
// neighborhood anchors where the road offers one. The containment
// buffer (CORRIDOR_BUFFER_M, 450m) is sized to absorb the
// approximation with margin; a GIS-grade pass can tighten the
// lines later without changing any contract here. Neighborhood
// anchors are approximate centers of the named areas, used for
// fact-pack sampling by the builder and for nothing
// safety-critical in the app.
//
// DIRECTION IS LOAD-BEARING: a segment is one direction of travel.
// Its polyline is ordered in the direction of travel, its areas are
// ordered as the driver passes them, and its story narrates what is
// AHEAD and on the correct side for that direction. The northbound
// I-5 story is not the southbound story read backwards.

export interface CorridorArea {
  name: string;
  lat: number;
  lng: number;
}

export interface CorridorSegment {
  id: string;
  freeway: string;
  direction: 'southbound' | 'northbound' | 'eastbound' | 'westbound';
  // The display name is also the story_library place_name and the
  // serve topic's base — it must never contain ' — ' (topic bases
  // are split on it across the app).
  displayName: string;
  fromName: string;
  toName: string;
  lengthKm: number;
  // Free-flow design speed for THIS stretch of road (mph). The
  // story's length is sized against it (see corridorTargetSentences).
  designSpeedMph: number;
  // Ordered in the direction of travel.
  polyline: { lat: number; lng: number }[];
  // Ordered as the driver passes them.
  areas: CorridorArea[];
}

// How far from a segment's polyline a position may be and still
// count as ON that segment. Freeway interchanges, parallel frontage
// roads, and the hand-laid polyline approximation all live inside
// this; the surface streets that parallel a freeway at more than
// ~450m (e.g. Mission Bay Drive past the I-5's east shore) fall
// outside, as they should — their narration is the street pipeline's.
export const CORRIDOR_BUFFER_M = 450;

// Heading agreement required between the listener's heading and the
// segment's direction of travel at the nearest polyline point.
// Generous enough for freeway curves, strict enough that the
// opposite carriageway (a few dozen meters away, ~180° opposed)
// can never match.
export const CORRIDOR_HEADING_TOLERANCE_DEG = 50;

// The sizing rule as code (Erik's refinement): a corridor story
// runs ~87.5% of its segment's free-flow traversal — the midpoint
// of his 85-90% under-run band. Speech planning numbers are the
// app's own: ~13 characters/second of speech (the player's
// estimateSpeechDurationS) and ~100 characters per sentence.
export const CORRIDOR_UNDER_RUN = 0.875;
const MPH_TO_MPS = 0.44704;
const SENTENCE_SECONDS = 7.7;

export function designSpeedMps(segment: CorridorSegment): number {
  return segment.designSpeedMph * MPH_TO_MPS;
}

export function corridorTargetSentences(segment: CorridorSegment): number {
  const traversalS = (segment.lengthKm * 1000) / designSpeedMps(segment);
  return Math.max(6, Math.min(26, Math.round((CORRIDOR_UNDER_RUN * traversalS) / SENTENCE_SECONDS)));
}

const P = (lat: number, lng: number) => ({ lat, lng });
const A = (name: string, lat: number, lng: number): CorridorArea => ({ name, lat, lng });

export const CORRIDOR_SEGMENTS: CorridorSegment[] = [
  // ------------------------------------------------------------- I-5
  {
    id: 'i-5-sb-la-jolla-pacific-beach',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: La Jolla to Pacific Beach',
    fromName: 'La Jolla',
    toName: 'Pacific Beach',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.8705, -117.2285), P(32.864, -117.2295), P(32.8515, -117.2315),
      P(32.8435, -117.228), P(32.836, -117.2282),
    ],
    areas: [
      A('University City', 32.862, -117.224),
      A('La Jolla', 32.85, -117.238),
    ],
  },
  {
    id: 'i-5-sb-pacific-beach-mission-bay',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Pacific Beach to Mission Bay',
    fromName: 'Pacific Beach',
    toName: 'Mission Bay',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.836, -117.2282), P(32.825, -117.2285), P(32.808, -117.228),
      P(32.8012, -117.2253),
    ],
    areas: [
      A('Pacific Beach', 32.802, -117.235),
    ],
  },
  {
    id: 'i-5-sb-mission-bay-old-town',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Mission Bay to Old Town',
    fromName: 'Mission Bay',
    toName: 'Old Town',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.8012, -117.2253), P(32.799, -117.2245), P(32.786, -117.216),
      P(32.77, -117.206),
    ],
    areas: [
      A('Mission Bay', 32.778, -117.214),
    ],
  },
  {
    id: 'i-5-sb-old-town-mission-hills',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Old Town to Mission Hills',
    fromName: 'Old Town',
    toName: 'Mission Hills',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.77, -117.206), P(32.763, -117.201), P(32.7555, -117.1955),
      P(32.746, -117.186),
    ],
    areas: [
      A('Old Town', 32.7543, -117.1969),
      A('Mission Hills', 32.75, -117.178),
    ],
  },
  {
    id: 'i-5-sb-mission-hills-downtown',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Mission Hills to Downtown',
    fromName: 'Mission Hills',
    toName: 'Downtown',
    lengthKm: 3.8,
    designSpeedMph: 60,
    polyline: [
      P(32.746, -117.186), P(32.7355, -117.179), P(32.724, -117.168),
      P(32.7175, -117.1645),
    ],
    areas: [
      A('Mission Hills', 32.75, -117.178),
      A('San Diego International Airport', 32.7355, -117.183),
      A('Little Italy', 32.725, -117.169),
      A('Downtown San Diego', 32.717, -117.162),
    ],
  },
  {
    id: 'i-5-sb-downtown-barrio-logan',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Downtown to Barrio Logan',
    fromName: 'Downtown',
    toName: 'Barrio Logan',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.7175, -117.1645), P(32.709, -117.156), P(32.701, -117.149),
      P(32.6937, -117.1383),
    ],
    areas: [
      A('Downtown San Diego', 32.717, -117.162),
      A('Barrio Logan', 32.7, -117.142),
    ],
  },
  {
    id: 'i-5-sb-barrio-logan-national-city',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Barrio Logan to National City',
    fromName: 'Barrio Logan',
    toName: 'National City',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.6937, -117.1383), P(32.686, -117.127), P(32.672, -117.112),
    ],
    areas: [
      A('National City', 32.678, -117.117),
    ],
  },
  {
    id: 'i-5-sb-national-city-chula-vista',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: National City to Chula Vista',
    fromName: 'National City',
    toName: 'Chula Vista',
    lengthKm: 4.5,
    designSpeedMph: 60,
    polyline: [
      P(32.672, -117.112), P(32.6555, -117.0965), P(32.64, -117.083),
    ],
    areas: [
      A('National City', 32.678, -117.117),
      A('Chula Vista', 32.64, -117.084),
    ],
  },
  {
    id: 'i-5-sb-chula-vista-south-chula-vista',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Chula Vista to South Chula Vista',
    fromName: 'Chula Vista',
    toName: 'South Chula Vista',
    lengthKm: 2.9,
    designSpeedMph: 60,
    polyline: [
      P(32.64, -117.083), P(32.6175, -117.0665),
    ],
    areas: [
      A('Chula Vista', 32.64, -117.084),
    ],
  },
  {
    id: 'i-5-nb-south-chula-vista-chula-vista',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: South Chula Vista to Chula Vista',
    fromName: 'South Chula Vista',
    toName: 'Chula Vista',
    lengthKm: 2.9,
    designSpeedMph: 60,
    polyline: [
      P(32.6175, -117.0665), P(32.64, -117.083),
    ],
    areas: [
      A('Chula Vista', 32.64, -117.084),
    ],
  },
  {
    id: 'i-5-nb-chula-vista-national-city',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Chula Vista to National City',
    fromName: 'Chula Vista',
    toName: 'National City',
    lengthKm: 4.5,
    designSpeedMph: 60,
    polyline: [
      P(32.64, -117.083), P(32.6555, -117.0965), P(32.672, -117.112),
    ],
    areas: [
      A('Chula Vista', 32.64, -117.084),
      A('National City', 32.678, -117.117),
    ],
  },
  {
    id: 'i-5-nb-national-city-barrio-logan',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: National City to Barrio Logan',
    fromName: 'National City',
    toName: 'Barrio Logan',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.672, -117.112), P(32.686, -117.127), P(32.6937, -117.1383),
    ],
    areas: [
      A('National City', 32.678, -117.117),
    ],
  },
  {
    id: 'i-5-nb-barrio-logan-downtown',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Barrio Logan to Downtown',
    fromName: 'Barrio Logan',
    toName: 'Downtown',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.6937, -117.1383), P(32.701, -117.149), P(32.709, -117.156),
      P(32.7175, -117.1645),
    ],
    areas: [
      A('Barrio Logan', 32.7, -117.142),
      A('Downtown San Diego', 32.717, -117.162),
    ],
  },
  {
    id: 'i-5-nb-downtown-mission-hills',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Downtown to Mission Hills',
    fromName: 'Downtown',
    toName: 'Mission Hills',
    lengthKm: 3.8,
    designSpeedMph: 60,
    polyline: [
      P(32.7175, -117.1645), P(32.724, -117.168), P(32.7355, -117.179),
      P(32.746, -117.186),
    ],
    areas: [
      A('Downtown San Diego', 32.717, -117.162),
      A('Little Italy', 32.725, -117.169),
      A('San Diego International Airport', 32.7355, -117.183),
      A('Mission Hills', 32.75, -117.178),
    ],
  },
  {
    id: 'i-5-nb-mission-hills-mission-bay',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Mission Hills to Mission Bay',
    fromName: 'Mission Hills',
    toName: 'Mission Bay',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.746, -117.186), P(32.7555, -117.1955), P(32.763, -117.201),
      P(32.77, -117.206),
    ],
    areas: [
      A('Mission Hills', 32.75, -117.178),
      A('Old Town', 32.7543, -117.1969),
    ],
  },
  {
    id: 'i-5-nb-mission-bay-pacific-beach',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Mission Bay to Pacific Beach',
    fromName: 'Mission Bay',
    toName: 'Pacific Beach',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.77, -117.206), P(32.786, -117.216), P(32.799, -117.2245),
      P(32.8012, -117.2253),
    ],
    areas: [
      A('Mission Bay', 32.778, -117.214),
    ],
  },
  {
    id: 'i-5-nb-pacific-beach-la-jolla',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Pacific Beach to La Jolla',
    fromName: 'Pacific Beach',
    toName: 'La Jolla',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.8012, -117.2253), P(32.808, -117.228), P(32.825, -117.2285),
      P(32.836, -117.2282),
    ],
    areas: [
      A('Pacific Beach', 32.802, -117.235),
    ],
  },
  {
    id: 'i-5-nb-la-jolla-north-la-jolla',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: La Jolla to North La Jolla',
    fromName: 'La Jolla',
    toName: 'North La Jolla',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.836, -117.2282), P(32.8435, -117.228), P(32.8515, -117.2315),
      P(32.864, -117.2295), P(32.8705, -117.2285),
    ],
    areas: [
      A('La Jolla', 32.85, -117.238),
      A('University City', 32.862, -117.224),
    ],
  },
  // ------------------------------------------------------------- SR-163
  {
    id: 'sr-163-sb-mission-valley-hillcrest',
    freeway: 'SR-163',
    direction: 'southbound',
    displayName: 'SR-163 South: Mission Valley to Hillcrest',
    fromName: 'Mission Valley',
    toName: 'Hillcrest',
    lengthKm: 3,
    designSpeedMph: 50,
    polyline: [
      P(32.781, -117.168), P(32.772, -117.163), P(32.756, -117.156),
    ],
    areas: [
      A('Mission Valley', 32.775, -117.16),
      A('Hillcrest', 32.75, -117.155),
    ],
  },
  {
    id: 'sr-163-sb-hillcrest-downtown',
    freeway: 'SR-163',
    direction: 'southbound',
    displayName: 'SR-163 South: Hillcrest to Downtown',
    fromName: 'Hillcrest',
    toName: 'Downtown',
    lengthKm: 4.1,
    designSpeedMph: 50,
    polyline: [
      P(32.756, -117.156), P(32.74, -117.151), P(32.73, -117.152),
      P(32.721, -117.158),
    ],
    areas: [
      A('Hillcrest', 32.75, -117.155),
      A('Balboa Park', 32.7325, -117.1491),
      A('Downtown San Diego', 32.721, -117.16),
    ],
  },
  {
    id: 'sr-163-nb-downtown-hillcrest',
    freeway: 'SR-163',
    direction: 'northbound',
    displayName: 'SR-163 North: Downtown to Hillcrest',
    fromName: 'Downtown',
    toName: 'Hillcrest',
    lengthKm: 4.1,
    designSpeedMph: 50,
    polyline: [
      P(32.721, -117.158), P(32.73, -117.152), P(32.74, -117.151),
      P(32.756, -117.156),
    ],
    areas: [
      A('Downtown San Diego', 32.721, -117.16),
      A('Balboa Park', 32.7325, -117.1491),
      A('Hillcrest', 32.75, -117.155),
    ],
  },
  {
    id: 'sr-163-nb-hillcrest-mission-valley',
    freeway: 'SR-163',
    direction: 'northbound',
    displayName: 'SR-163 North: Hillcrest to Mission Valley',
    fromName: 'Hillcrest',
    toName: 'Mission Valley',
    lengthKm: 3,
    designSpeedMph: 50,
    polyline: [
      P(32.756, -117.156), P(32.772, -117.163), P(32.781, -117.168),
    ],
    areas: [
      A('Hillcrest', 32.75, -117.155),
      A('Mission Valley', 32.775, -117.16),
    ],
  },
  // ------------------------------------------------------------- SR-52
  {
    id: 'sr-52-eb-la-jolla-clairemont',
    freeway: 'SR-52',
    direction: 'eastbound',
    displayName: 'SR-52 East: La Jolla to Clairemont',
    fromName: 'La Jolla',
    toName: 'Clairemont',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.8515, -117.2315), P(32.845, -117.205), P(32.8412, -117.1958),
    ],
    areas: [
      A('La Jolla', 32.85, -117.238),
      A('University City', 32.845, -117.2),
    ],
  },
  {
    id: 'sr-52-eb-clairemont-kearny-mesa',
    freeway: 'SR-52',
    direction: 'eastbound',
    displayName: 'SR-52 East: Clairemont to Kearny Mesa',
    fromName: 'Clairemont',
    toName: 'Kearny Mesa',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.8412, -117.1958), P(32.838, -117.188), P(32.828, -117.157),
    ],
    areas: [
      A('Clairemont', 32.835, -117.175),
      A('Kearny Mesa', 32.82, -117.14),
    ],
  },
  {
    id: 'sr-52-eb-kearny-mesa-tierrasanta',
    freeway: 'SR-52',
    direction: 'eastbound',
    displayName: 'SR-52 East: Kearny Mesa to Tierrasanta',
    fromName: 'Kearny Mesa',
    toName: 'Tierrasanta',
    lengthKm: 3.2,
    designSpeedMph: 60,
    polyline: [
      P(32.828, -117.157), P(32.8187, -117.1252),
    ],
    areas: [
      A('Kearny Mesa', 32.82, -117.14),
    ],
  },
  {
    id: 'sr-52-eb-through-tierrasanta',
    freeway: 'SR-52',
    direction: 'eastbound',
    displayName: 'SR-52 East: Through Tierrasanta',
    fromName: 'Tierrasanta',
    toName: 'Tierrasanta',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.8187, -117.1252), P(32.816, -117.116), P(32.818, -117.088),
    ],
    areas: [
      A('Tierrasanta', 32.82, -117.092),
    ],
  },
  {
    id: 'sr-52-eb-tierrasanta-mission-trails-regional-park',
    freeway: 'SR-52',
    direction: 'eastbound',
    displayName: 'SR-52 East: Tierrasanta to Mission Trails Regional Park',
    fromName: 'Tierrasanta',
    toName: 'Mission Trails Regional Park',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.818, -117.088), P(32.83, -117.052),
    ],
    areas: [
      A('Tierrasanta', 32.82, -117.092),
      A('Mission Trails Regional Park', 32.835, -117.055),
    ],
  },
  {
    id: 'sr-52-eb-mission-trails-regional-park-santee-lakes',
    freeway: 'SR-52',
    direction: 'eastbound',
    displayName: 'SR-52 East: Mission Trails Regional Park to Santee Lakes',
    fromName: 'Mission Trails Regional Park',
    toName: 'Santee Lakes',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.83, -117.052), P(32.8436, -117.0202),
    ],
    areas: [
      A('Mission Trails Regional Park', 32.835, -117.055),
    ],
  },
  {
    id: 'sr-52-eb-santee-lakes-santee',
    freeway: 'SR-52',
    direction: 'eastbound',
    displayName: 'SR-52 East: Santee Lakes to Santee',
    fromName: 'Santee Lakes',
    toName: 'Santee',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.8436, -117.0202), P(32.848, -117.01), P(32.856, -116.986),
    ],
    areas: [
      A('Santee Lakes', 32.846, -117.012),
      A('Santee', 32.85, -116.995),
    ],
  },
  {
    id: 'sr-52-wb-santee-santee-lakes',
    freeway: 'SR-52',
    direction: 'westbound',
    displayName: 'SR-52 West: Santee to Santee Lakes',
    fromName: 'Santee',
    toName: 'Santee Lakes',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.856, -116.986), P(32.848, -117.01), P(32.8436, -117.0202),
    ],
    areas: [
      A('Santee', 32.85, -116.995),
      A('Santee Lakes', 32.846, -117.012),
    ],
  },
  {
    id: 'sr-52-wb-santee-lakes-mission-trails-regional-park',
    freeway: 'SR-52',
    direction: 'westbound',
    displayName: 'SR-52 West: Santee Lakes to Mission Trails Regional Park',
    fromName: 'Santee Lakes',
    toName: 'Mission Trails Regional Park',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.8436, -117.0202), P(32.83, -117.052),
    ],
    areas: [
      A('Mission Trails Regional Park', 32.835, -117.055),
    ],
  },
  {
    id: 'sr-52-wb-mission-trails-regional-park-tierrasanta',
    freeway: 'SR-52',
    direction: 'westbound',
    displayName: 'SR-52 West: Mission Trails Regional Park to Tierrasanta',
    fromName: 'Mission Trails Regional Park',
    toName: 'Tierrasanta',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.83, -117.052), P(32.818, -117.088),
    ],
    areas: [
      A('Mission Trails Regional Park', 32.835, -117.055),
      A('Tierrasanta', 32.82, -117.092),
    ],
  },
  {
    id: 'sr-52-wb-tierrasanta-kearny-mesa',
    freeway: 'SR-52',
    direction: 'westbound',
    displayName: 'SR-52 West: Tierrasanta to Kearny Mesa',
    fromName: 'Tierrasanta',
    toName: 'Kearny Mesa',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.818, -117.088), P(32.816, -117.116), P(32.8187, -117.1252),
    ],
    areas: [
      A('Tierrasanta', 32.82, -117.092),
    ],
  },
  {
    id: 'sr-52-wb-through-kearny-mesa',
    freeway: 'SR-52',
    direction: 'westbound',
    displayName: 'SR-52 West: Through Kearny Mesa',
    fromName: 'Kearny Mesa',
    toName: 'Kearny Mesa',
    lengthKm: 3.2,
    designSpeedMph: 60,
    polyline: [
      P(32.8187, -117.1252), P(32.828, -117.157),
    ],
    areas: [
      A('Kearny Mesa', 32.82, -117.14),
    ],
  },
  {
    id: 'sr-52-wb-kearny-mesa-clairemont',
    freeway: 'SR-52',
    direction: 'westbound',
    displayName: 'SR-52 West: Kearny Mesa to Clairemont',
    fromName: 'Kearny Mesa',
    toName: 'Clairemont',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.828, -117.157), P(32.838, -117.188), P(32.8412, -117.1958),
    ],
    areas: [
      A('Kearny Mesa', 32.82, -117.14),
      A('Clairemont', 32.835, -117.175),
    ],
  },
  {
    id: 'sr-52-wb-clairemont-la-jolla',
    freeway: 'SR-52',
    direction: 'westbound',
    displayName: 'SR-52 West: Clairemont to La Jolla',
    fromName: 'Clairemont',
    toName: 'La Jolla',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.8412, -117.1958), P(32.845, -117.205), P(32.8515, -117.2315),
    ],
    areas: [
      A('University City', 32.845, -117.2),
      A('La Jolla', 32.85, -117.238),
    ],
  },
  // ------------------------------------------------------------- I-8
  {
    id: 'i-8-eb-the-coast-midway-district',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: The Coast to Midway District',
    fromName: 'The Coast',
    toName: 'Midway District',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.751, -117.25), P(32.753, -117.233), P(32.759, -117.216),
    ],
    areas: [
      A('Ocean Beach', 32.75, -117.245),
      A('Point Loma', 32.745, -117.225),
      A('Midway District', 32.754, -117.206),
    ],
  },
  {
    id: 'i-8-eb-midway-district-mission-valley',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Midway District to Mission Valley',
    fromName: 'Midway District',
    toName: 'Mission Valley',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.759, -117.216), P(32.766, -117.205), P(32.77, -117.19),
      P(32.7712, -117.1815),
    ],
    areas: [
      A('Midway District', 32.754, -117.206),
      A('Old Town', 32.7543, -117.1969),
    ],
  },
  {
    id: 'i-8-eb-through-mission-valley',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Through Mission Valley',
    fromName: 'Mission Valley',
    toName: 'Mission Valley',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.7712, -117.1815), P(32.773, -117.168), P(32.775, -117.145),
      P(32.775, -117.1449),
    ],
    areas: [
      A('Mission Valley', 32.772, -117.16),
    ],
  },
  {
    id: 'i-8-eb-mission-valley-mission-valley-east',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Mission Valley to Mission Valley East',
    fromName: 'Mission Valley',
    toName: 'Mission Valley East',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.775, -117.1449), P(32.774, -117.108),
    ],
    areas: [
      A('Mission Valley', 32.775, -117.1449),
    ],
  },
  {
    id: 'i-8-eb-mission-valley-east-allied-gardens',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Mission Valley East to Allied Gardens',
    fromName: 'Mission Valley East',
    toName: 'Allied Gardens',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.774, -117.108), P(32.77, -117.075), P(32.7681, -117.0668),
    ],
    areas: [
      A('Mission Valley East', 32.772, -117.12),
      A('Allied Gardens', 32.77, -117.075),
    ],
  },
  {
    id: 'i-8-eb-allied-gardens-san-carlos',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Allied Gardens to San Carlos',
    fromName: 'Allied Gardens',
    toName: 'San Carlos',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.7681, -117.0668), P(32.762, -117.04), P(32.7593, -117.0263),
    ],
    areas: [
      A('San Carlos', 32.763, -117.045),
    ],
  },
  {
    id: 'i-8-eb-san-carlos-la-mesa',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: San Carlos to La Mesa',
    fromName: 'San Carlos',
    toName: 'La Mesa',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.7593, -117.0263), P(32.756, -117.01), P(32.754, -116.985),
    ],
    areas: [
      A('La Mesa', 32.756, -117.01),
    ],
  },
  {
    id: 'i-8-wb-la-mesa-san-carlos',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: La Mesa to San Carlos',
    fromName: 'La Mesa',
    toName: 'San Carlos',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.754, -116.985), P(32.756, -117.01), P(32.7593, -117.0263),
    ],
    areas: [
      A('La Mesa', 32.756, -117.01),
    ],
  },
  {
    id: 'i-8-wb-san-carlos-allied-gardens',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: San Carlos to Allied Gardens',
    fromName: 'San Carlos',
    toName: 'Allied Gardens',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.7593, -117.0263), P(32.762, -117.04), P(32.7681, -117.0668),
    ],
    areas: [
      A('San Carlos', 32.763, -117.045),
    ],
  },
  {
    id: 'i-8-wb-allied-gardens-mission-valley',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Allied Gardens to Mission Valley',
    fromName: 'Allied Gardens',
    toName: 'Mission Valley',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.7681, -117.0668), P(32.77, -117.075), P(32.774, -117.108),
    ],
    areas: [
      A('Allied Gardens', 32.77, -117.075),
      A('Mission Valley East', 32.772, -117.12),
    ],
  },
  {
    id: 'i-8-wb-through-mission-valley',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Through Mission Valley',
    fromName: 'Mission Valley',
    toName: 'Mission Valley',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.774, -117.108), P(32.775, -117.1449),
    ],
    areas: [
      A('Mission Valley', 32.774, -117.108),
    ],
  },
  {
    id: 'i-8-wb-mission-valley-old-town',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Mission Valley to Old Town',
    fromName: 'Mission Valley',
    toName: 'Old Town',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(32.775, -117.1449), P(32.775, -117.145), P(32.773, -117.168),
      P(32.7712, -117.1815),
    ],
    areas: [
      A('Mission Valley', 32.772, -117.16),
    ],
  },
  {
    id: 'i-8-wb-old-town-midway-district',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Old Town to Midway District',
    fromName: 'Old Town',
    toName: 'Midway District',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.7712, -117.1815), P(32.77, -117.19), P(32.766, -117.205),
      P(32.759, -117.216),
    ],
    areas: [
      A('Old Town', 32.7543, -117.1969),
      A('Midway District', 32.754, -117.206),
    ],
  },
  {
    id: 'i-8-wb-midway-district-the-coast',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Midway District to The Coast',
    fromName: 'Midway District',
    toName: 'The Coast',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.759, -117.216), P(32.753, -117.233), P(32.751, -117.25),
    ],
    areas: [
      A('Midway District', 32.754, -117.206),
      A('Point Loma', 32.745, -117.225),
      A('Ocean Beach', 32.75, -117.245),
    ],
  },
  // ------------------------------------------------------------- I-805
  {
    id: 'i-805-sb-university-city-kearny-mesa',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: University City to Kearny Mesa',
    fromName: 'University City',
    toName: 'Kearny Mesa',
    lengthKm: 4.4,
    designSpeedMph: 60,
    polyline: [
      P(32.832, -117.188), P(32.815, -117.182), P(32.795, -117.172),
    ],
    areas: [
      A('University City', 32.845, -117.2),
      A('Clairemont', 32.815, -117.19),
      A('Kearny Mesa', 32.8, -117.16),
    ],
  },
  {
    id: 'i-805-sb-kearny-mesa-mission-valley',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Kearny Mesa to Mission Valley',
    fromName: 'Kearny Mesa',
    toName: 'Mission Valley',
    lengthKm: 3.7,
    designSpeedMph: 60,
    polyline: [
      P(32.795, -117.172), P(32.775, -117.155), P(32.77, -117.146),
    ],
    areas: [
      A('Kearny Mesa', 32.8, -117.16),
      A('Serra Mesa', 32.797, -117.138),
      A('Mission Valley', 32.772, -117.15),
    ],
  },
  {
    id: 'i-805-sb-mission-valley-north-park',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Mission Valley to North Park',
    fromName: 'Mission Valley',
    toName: 'North Park',
    lengthKm: 4,
    designSpeedMph: 60,
    polyline: [
      P(32.77, -117.146), P(32.745, -117.13), P(32.7383, -117.1268),
    ],
    areas: [
      A('Mission Valley', 32.772, -117.15),
      A('North Park', 32.735, -117.125),
    ],
  },
  {
    id: 'i-805-sb-north-park-lincoln-park',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: North Park to Lincoln Park',
    fromName: 'North Park',
    toName: 'Lincoln Park',
    lengthKm: 4,
    designSpeedMph: 60,
    polyline: [
      P(32.7383, -117.1268), P(32.72, -117.118), P(32.7054, -117.1104),
    ],
    areas: [
      A('North Park', 32.7383, -117.1268),
    ],
  },
  {
    id: 'i-805-sb-lincoln-park-national-city',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Lincoln Park to National City',
    fromName: 'Lincoln Park',
    toName: 'National City',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.7054, -117.1104), P(32.695, -117.105), P(32.678, -117.096),
    ],
    areas: [
      A('Lincoln Park', 32.698, -117.096),
      A('National City', 32.68, -117.1),
    ],
  },
  {
    id: 'i-805-sb-national-city-chula-vista',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: National City to Chula Vista',
    fromName: 'National City',
    toName: 'Chula Vista',
    lengthKm: 4.6,
    designSpeedMph: 60,
    polyline: [
      P(32.678, -117.096), P(32.655, -117.088), P(32.638, -117.084),
    ],
    areas: [
      A('National City', 32.68, -117.1),
      A('Chula Vista', 32.64, -117.084),
    ],
  },
  {
    id: 'i-805-nb-chula-vista-national-city',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Chula Vista to National City',
    fromName: 'Chula Vista',
    toName: 'National City',
    lengthKm: 4.6,
    designSpeedMph: 60,
    polyline: [
      P(32.638, -117.084), P(32.655, -117.088), P(32.678, -117.096),
    ],
    areas: [
      A('Chula Vista', 32.64, -117.084),
      A('National City', 32.68, -117.1),
    ],
  },
  {
    id: 'i-805-nb-national-city-lincoln-park',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: National City to Lincoln Park',
    fromName: 'National City',
    toName: 'Lincoln Park',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.678, -117.096), P(32.695, -117.105), P(32.7054, -117.1104),
    ],
    areas: [
      A('National City', 32.68, -117.1),
      A('Lincoln Park', 32.698, -117.096),
    ],
  },
  {
    id: 'i-805-nb-lincoln-park-north-park',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Lincoln Park to North Park',
    fromName: 'Lincoln Park',
    toName: 'North Park',
    lengthKm: 4,
    designSpeedMph: 60,
    polyline: [
      P(32.7054, -117.1104), P(32.72, -117.118), P(32.7383, -117.1268),
    ],
    areas: [
      A('Lincoln Park', 32.7054, -117.1104),
    ],
  },
  {
    id: 'i-805-nb-north-park-mission-valley',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: North Park to Mission Valley',
    fromName: 'North Park',
    toName: 'Mission Valley',
    lengthKm: 4,
    designSpeedMph: 60,
    polyline: [
      P(32.7383, -117.1268), P(32.745, -117.13), P(32.77, -117.146),
    ],
    areas: [
      A('North Park', 32.735, -117.125),
      A('Mission Valley', 32.772, -117.15),
    ],
  },
  {
    id: 'i-805-nb-mission-valley-kearny-mesa',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Mission Valley to Kearny Mesa',
    fromName: 'Mission Valley',
    toName: 'Kearny Mesa',
    lengthKm: 3.7,
    designSpeedMph: 60,
    polyline: [
      P(32.77, -117.146), P(32.775, -117.155), P(32.795, -117.172),
    ],
    areas: [
      A('Mission Valley', 32.772, -117.15),
      A('Serra Mesa', 32.797, -117.138),
      A('Kearny Mesa', 32.8, -117.16),
    ],
  },
  {
    id: 'i-805-nb-kearny-mesa-university-city',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Kearny Mesa to University City',
    fromName: 'Kearny Mesa',
    toName: 'University City',
    lengthKm: 4.4,
    designSpeedMph: 60,
    polyline: [
      P(32.795, -117.172), P(32.815, -117.182), P(32.832, -117.188),
    ],
    areas: [
      A('Kearny Mesa', 32.8, -117.16),
      A('Clairemont', 32.815, -117.19),
      A('University City', 32.845, -117.2),
    ],
  },
  // ------------------------------------------------------------- I-15
  {
    id: 'i-15-nb-mission-valley-tierrasanta',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Mission Valley to Tierrasanta',
    fromName: 'Mission Valley',
    toName: 'Tierrasanta',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.774, -117.108), P(32.79, -117.105), P(32.8091, -117.1073),
    ],
    areas: [
      A('Mission Valley', 32.772, -117.12),
      A('Tierrasanta', 32.8, -117.1),
    ],
  },
  {
    id: 'i-15-nb-tierrasanta-marine-corps-air-station-miramar',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Tierrasanta to Marine Corps Air Station Miramar',
    fromName: 'Tierrasanta',
    toName: 'Marine Corps Air Station Miramar',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.8091, -117.1073), P(32.815, -117.108), P(32.8443, -117.1051),
    ],
    areas: [
      A('Tierrasanta', 32.8091, -117.1073),
    ],
  },
  {
    id: 'i-15-nb-through-marine-corps-air-station-miramar',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Through Marine Corps Air Station Miramar',
    fromName: 'Marine Corps Air Station Miramar',
    toName: 'Marine Corps Air Station Miramar',
    lengthKm: 4,
    designSpeedMph: 60,
    polyline: [
      P(32.8443, -117.1051), P(32.845, -117.105), P(32.88, -117.105),
    ],
    areas: [
      A('Marine Corps Air Station Miramar', 32.87, -117.11),
    ],
  },
  {
    id: 'i-15-nb-marine-corps-air-station-miramar-scripps-ranch',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Marine Corps Air Station Miramar to Scripps Ranch',
    fromName: 'Marine Corps Air Station Miramar',
    toName: 'Scripps Ranch',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.88, -117.105), P(32.915, -117.102),
    ],
    areas: [
      A('Marine Corps Air Station Miramar', 32.87, -117.11),
      A('Scripps Ranch', 32.905, -117.1),
      A('Mira Mesa', 32.92, -117.132),
    ],
  },
  {
    id: 'i-15-nb-scripps-ranch-rancho-penasquitos',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Scripps Ranch to Rancho Penasquitos',
    fromName: 'Scripps Ranch',
    toName: 'Rancho Penasquitos',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.915, -117.102), P(32.947, -117.0935),
    ],
    areas: [
      A('Scripps Ranch', 32.905, -117.1),
    ],
  },
  {
    id: 'i-15-nb-rancho-penasquitos-rancho-bernardo',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Rancho Penasquitos to Rancho Bernardo',
    fromName: 'Rancho Penasquitos',
    toName: 'Rancho Bernardo',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.947, -117.0935), P(32.96, -117.09), P(32.9788, -117.0844),
    ],
    areas: [
      A('Rancho Penasquitos', 32.953, -117.102),
    ],
  },
  {
    id: 'i-15-nb-through-rancho-bernardo',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Through Rancho Bernardo',
    fromName: 'Rancho Bernardo',
    toName: 'Rancho Bernardo',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.9788, -117.0844), P(33, -117.078), P(33.0108, -117.0799),
    ],
    areas: [
      A('Rancho Bernardo', 33, -117.075),
      A('Carmel Mountain Ranch', 33.006, -117.08),
    ],
  },
  {
    id: 'i-15-nb-rancho-bernardo-escondido',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Rancho Bernardo to Escondido',
    fromName: 'Rancho Bernardo',
    toName: 'Escondido',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(33.0108, -117.0799), P(33.04, -117.085), P(33.0431, -117.0859),
    ],
    areas: [
      A('Rancho Bernardo', 33.0108, -117.0799),
    ],
  },
  {
    id: 'i-15-nb-escondido-north-escondido',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Escondido to North Escondido',
    fromName: 'Escondido',
    toName: 'North Escondido',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(33.0431, -117.0859), P(33.075, -117.095),
    ],
    areas: [
      A('Escondido', 33.07, -117.09),
      A('San Pasqual Valley', 33.075, -117.021),
    ],
  },
  {
    id: 'i-15-sb-north-escondido-escondido',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: North Escondido to Escondido',
    fromName: 'North Escondido',
    toName: 'Escondido',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(33.075, -117.095), P(33.0431, -117.0859),
    ],
    areas: [
      A('Escondido', 33.07, -117.09),
      A('San Pasqual Valley', 33.075, -117.021),
    ],
  },
  {
    id: 'i-15-sb-escondido-rancho-bernardo',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Escondido to Rancho Bernardo',
    fromName: 'Escondido',
    toName: 'Rancho Bernardo',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(33.0431, -117.0859), P(33.04, -117.085), P(33.0108, -117.0799),
    ],
    areas: [
      A('Escondido', 33.0431, -117.0859),
    ],
  },
  {
    id: 'i-15-sb-rancho-bernardo-rancho-penasquitos',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Rancho Bernardo to Rancho Penasquitos',
    fromName: 'Rancho Bernardo',
    toName: 'Rancho Penasquitos',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(33.0108, -117.0799), P(33, -117.078), P(32.9788, -117.0844),
    ],
    areas: [
      A('Rancho Bernardo', 33, -117.075),
      A('Carmel Mountain Ranch', 33.006, -117.08),
    ],
  },
  {
    id: 'i-15-sb-rancho-penasquitos-scripps-ranch',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Rancho Penasquitos to Scripps Ranch',
    fromName: 'Rancho Penasquitos',
    toName: 'Scripps Ranch',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.9788, -117.0844), P(32.96, -117.09), P(32.947, -117.0935),
    ],
    areas: [
      A('Rancho Penasquitos', 32.953, -117.102),
    ],
  },
  {
    id: 'i-15-sb-through-scripps-ranch',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Through Scripps Ranch',
    fromName: 'Scripps Ranch',
    toName: 'Scripps Ranch',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.947, -117.0935), P(32.915, -117.102),
    ],
    areas: [
      A('Scripps Ranch', 32.905, -117.1),
    ],
  },
  {
    id: 'i-15-sb-scripps-ranch-marine-corps-air-station-miramar',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Scripps Ranch to Marine Corps Air Station Miramar',
    fromName: 'Scripps Ranch',
    toName: 'Marine Corps Air Station Miramar',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.915, -117.102), P(32.88, -117.105),
    ],
    areas: [
      A('Scripps Ranch', 32.905, -117.1),
      A('Mira Mesa', 32.92, -117.132),
      A('Marine Corps Air Station Miramar', 32.87, -117.11),
    ],
  },
  {
    id: 'i-15-sb-through-marine-corps-air-station-miramar',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Through Marine Corps Air Station Miramar',
    fromName: 'Marine Corps Air Station Miramar',
    toName: 'Marine Corps Air Station Miramar',
    lengthKm: 4,
    designSpeedMph: 60,
    polyline: [
      P(32.88, -117.105), P(32.845, -117.105), P(32.8443, -117.1051),
    ],
    areas: [
      A('Marine Corps Air Station Miramar', 32.87, -117.11),
    ],
  },
  {
    id: 'i-15-sb-marine-corps-air-station-miramar-tierrasanta',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Marine Corps Air Station Miramar to Tierrasanta',
    fromName: 'Marine Corps Air Station Miramar',
    toName: 'Tierrasanta',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.8443, -117.1051), P(32.815, -117.108), P(32.8091, -117.1073),
    ],
    areas: [
      A('Marine Corps Air Station Miramar', 32.8443, -117.1051),
    ],
  },
  {
    id: 'i-15-sb-tierrasanta-mission-valley',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Tierrasanta to Mission Valley',
    fromName: 'Tierrasanta',
    toName: 'Mission Valley',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.8091, -117.1073), P(32.79, -117.105), P(32.774, -117.108),
    ],
    areas: [
      A('Tierrasanta', 32.8, -117.1),
      A('Mission Valley', 32.772, -117.12),
    ],
  },
  // ------------------------------------------------------------- SR-94
  {
    id: 'sr-94-eb-downtown-mount-hope',
    freeway: 'SR-94',
    direction: 'eastbound',
    displayName: 'SR-94 East: Downtown to Mount Hope',
    fromName: 'Downtown',
    toName: 'Mount Hope',
    lengthKm: 3.6,
    designSpeedMph: 55,
    polyline: [
      P(32.709, -117.156), P(32.711, -117.14), P(32.715, -117.118),
    ],
    areas: [
      A('Downtown San Diego', 32.717, -117.162),
      A('Golden Hill', 32.712, -117.14),
      A('Mount Hope', 32.715, -117.115),
    ],
  },
  {
    id: 'sr-94-eb-mount-hope-emerald-hills',
    freeway: 'SR-94',
    direction: 'eastbound',
    displayName: 'SR-94 East: Mount Hope to Emerald Hills',
    fromName: 'Mount Hope',
    toName: 'Emerald Hills',
    lengthKm: 4.5,
    designSpeedMph: 55,
    polyline: [
      P(32.715, -117.118), P(32.718, -117.095), P(32.7199, -117.0708),
    ],
    areas: [
      A('Mount Hope', 32.715, -117.115),
      A('Emerald Hills', 32.715, -117.087),
    ],
  },
  {
    id: 'sr-94-eb-emerald-hills-lemon-grove',
    freeway: 'SR-94',
    direction: 'eastbound',
    displayName: 'SR-94 East: Emerald Hills to Lemon Grove',
    fromName: 'Emerald Hills',
    toName: 'Lemon Grove',
    lengthKm: 4,
    designSpeedMph: 55,
    polyline: [
      P(32.7199, -117.0708), P(32.72, -117.07), P(32.722, -117.045),
      P(32.724, -117.028),
    ],
    areas: [
      A('Lemon Grove', 32.723, -117.035),
    ],
  },
  {
    id: 'sr-94-wb-lemon-grove-emerald-hills',
    freeway: 'SR-94',
    direction: 'westbound',
    displayName: 'SR-94 West: Lemon Grove to Emerald Hills',
    fromName: 'Lemon Grove',
    toName: 'Emerald Hills',
    lengthKm: 4,
    designSpeedMph: 55,
    polyline: [
      P(32.724, -117.028), P(32.722, -117.045), P(32.72, -117.07),
      P(32.7199, -117.0708),
    ],
    areas: [
      A('Lemon Grove', 32.723, -117.035),
    ],
  },
  {
    id: 'sr-94-wb-emerald-hills-mount-hope',
    freeway: 'SR-94',
    direction: 'westbound',
    displayName: 'SR-94 West: Emerald Hills to Mount Hope',
    fromName: 'Emerald Hills',
    toName: 'Mount Hope',
    lengthKm: 4.5,
    designSpeedMph: 55,
    polyline: [
      P(32.7199, -117.0708), P(32.718, -117.095), P(32.715, -117.118),
    ],
    areas: [
      A('Emerald Hills', 32.715, -117.087),
      A('Mount Hope', 32.715, -117.115),
    ],
  },
  {
    id: 'sr-94-wb-mount-hope-downtown',
    freeway: 'SR-94',
    direction: 'westbound',
    displayName: 'SR-94 West: Mount Hope to Downtown',
    fromName: 'Mount Hope',
    toName: 'Downtown',
    lengthKm: 3.6,
    designSpeedMph: 55,
    polyline: [
      P(32.715, -117.118), P(32.711, -117.14), P(32.709, -117.156),
    ],
    areas: [
      A('Mount Hope', 32.715, -117.115),
      A('Golden Hill', 32.712, -117.14),
      A('Downtown San Diego', 32.717, -117.162),
    ],
  },
  // ---------------------------------------------------------------
  // GAPFILL WAVE (Erik-approved Oct 28, 2026 — gap-research-2026-10-28.md
  // items C-1, C-2, C-3, C-5): the North County + northern freeway map.
  // Polylines sampled from OpenStreetMap motorway geometry (the v1
  // dataset was hand-laid; these follow the same interchange-resolution
  // contract and sit well inside CORRIDOR_BUFFER_M). Texts are staged
  // in ~/workspace/leos-world/gapfill-corpus-v14 — TEXT ONLY until Erik
  // approves the batch render (his Oct 28 text-first rule).
  // --- I-5 North County (gapfill wave, Oct 28, 2026) — northbound
  {
    id: 'i-5-no-la-jolla-sorrento-valley',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: La Jolla to Sorrento Valley',
    fromName: 'La Jolla',
    toName: 'Sorrento Valley',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(32.8705, -117.2285), P(32.87582, -117.22886), P(32.88158, -117.22841),
      P(32.88704, -117.22761), P(32.89248, -117.22722), P(32.89544, -117.22702),
    ],
    areas: [
      A('Sorrento Valley', 32.8801, -117.22857),
    ],
  },
  {
    id: 'i-5-no-through-sorrento-valley',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Through Sorrento Valley',
    fromName: 'Sorrento Valley',
    toName: 'Sorrento Valley',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(32.89544, -117.22702), P(32.91468, -117.23067), P(32.91933, -117.23609),
      P(32.92319, -117.23863), P(32.9236, -117.2388),
    ],
    areas: [
      A('Sorrento Valley', 32.935, -117.215),
    ],
  },
  {
    id: 'i-5-no-through-sorrento-valley-2',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Through Sorrento Valley (2)',
    fromName: 'Sorrento Valley',
    toName: 'Sorrento Valley',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(32.9236, -117.2388), P(32.92763, -117.24015), P(32.93244, -117.24121),
      P(32.93762, -117.24143), P(32.94525, -117.24298), P(32.95007, -117.24374),
      P(32.95396, -117.24445),
    ],
    areas: [
      A('Sorrento Valley', 32.935, -117.215),
      A('Del Mar', 32.96, -117.265),
    ],
  },
  {
    id: 'i-5-no-sorrento-valley-del-mar',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Sorrento Valley to Del Mar',
    fromName: 'Sorrento Valley',
    toName: 'Del Mar',
    lengthKm: 2.6,
    designSpeedMph: 60,
    polyline: [
      P(32.95396, -117.24445), P(32.95918, -117.24564), P(32.96333, -117.24702),
      P(32.97173, -117.25), P(32.97678, -117.25208),
    ],
    areas: [
      A('Del Mar', 32.96, -117.265),
      A('Solana Beach', 32.985, -117.271),
    ],
  },
  {
    id: 'i-5-no-del-mar-solana-beach',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Del Mar to Solana Beach',
    fromName: 'Del Mar',
    toName: 'Solana Beach',
    lengthKm: 2.6,
    designSpeedMph: 60,
    polyline: [
      P(32.97678, -117.25208), P(32.98109, -117.2537), P(32.9886, -117.25547),
      P(32.99405, -117.25648), P(32.99938, -117.257),
    ],
    areas: [
      A('Del Mar', 32.96, -117.265),
      A('Solana Beach', 32.985, -117.271),
    ],
  },
  {
    id: 'i-5-no-solana-beach-encinitas',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Solana Beach to Encinitas',
    fromName: 'Solana Beach',
    toName: 'Encinitas',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.99938, -117.257), P(33.00489, -117.2588), P(33.00982, -117.26403),
      P(33.01285, -117.2675), P(33.01638, -117.27118), P(33.02018, -117.273),
      P(33.02515, -117.27421), P(33.02687, -117.27515),
    ],
    areas: [
      A('Solana Beach', 32.985, -117.271),
      A('Encinitas', 33.03, -117.285),
    ],
  },
  {
    id: 'i-5-no-through-encinitas',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Through Encinitas',
    fromName: 'Encinitas',
    toName: 'Encinitas',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(33.02687, -117.27515), P(33.03167, -117.2782), P(33.03568, -117.28108),
      P(33.0404, -117.28425), P(33.04438, -117.28621), P(33.04836, -117.28723),
      P(33.05252, -117.28848), P(33.05484, -117.2891),
    ],
    areas: [
      A('Encinitas', 33.03, -117.285),
    ],
  },
  {
    id: 'i-5-no-encinitas-la-costa-ave',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Encinitas to La Costa Ave',
    fromName: 'Encinitas',
    toName: 'La Costa Ave',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(33.05484, -117.2891), P(33.06136, -117.29132), P(33.06597, -117.29235),
      P(33.07378, -117.29471), P(33.07999, -117.29692), P(33.08435, -117.29843),
    ],
    areas: [
      A('Encinitas', 33.03, -117.285),
    ],
  },
  {
    id: 'i-5-no-la-costa-ave-carlsbad',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: La Costa Ave to Carlsbad',
    fromName: 'La Costa Ave',
    toName: 'Carlsbad',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.08435, -117.29843), P(33.09066, -117.30227), P(33.09527, -117.30526),
      P(33.09959, -117.30828), P(33.10299, -117.31028),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-no-carlsbad-palomar-airport-rd',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Carlsbad to Palomar Airport Rd',
    fromName: 'Carlsbad',
    toName: 'Palomar Airport Rd',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.10299, -117.31028), P(33.10817, -117.31352), P(33.11241, -117.31608),
      P(33.11865, -117.31999), P(33.12178, -117.32185),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-no-palomar-airport-rd-carlsbad',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Palomar Airport Rd to Carlsbad',
    fromName: 'Palomar Airport Rd',
    toName: 'Carlsbad',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(33.12178, -117.32185), P(33.12589, -117.32445), P(33.13137, -117.32761),
      P(33.13713, -117.33083), P(33.14159, -117.33309), P(33.14637, -117.33379),
      P(33.1501, -117.33522),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-no-through-carlsbad',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Through Carlsbad',
    fromName: 'Carlsbad',
    toName: 'Carlsbad',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.1501, -117.33522), P(33.15539, -117.33825), P(33.16059, -117.34088),
      P(33.16523, -117.34339), P(33.16955, -117.34565),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-no-carlsbad-oceanside',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Carlsbad to Oceanside',
    fromName: 'Carlsbad',
    toName: 'Oceanside',
    lengthKm: 3.1,
    designSpeedMph: 60,
    polyline: [
      P(33.16955, -117.34565), P(33.17522, -117.34993), P(33.1801, -117.35364),
      P(33.18428, -117.35744), P(33.18852, -117.36097), P(33.1923, -117.36393),
    ],
    areas: [
      A('Oceanside', 33.196, -117.34),
    ],
  },
  {
    id: 'i-5-no-through-oceanside',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Through Oceanside',
    fromName: 'Oceanside',
    toName: 'Oceanside',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(33.1923, -117.36393), P(33.19704, -117.36792), P(33.20014, -117.37183),
      P(33.20206, -117.37723), P(33.20401, -117.38242), P(33.20755, -117.38545),
      P(33.21251, -117.38854), P(33.21667, -117.39028), P(33.21887, -117.39102),
    ],
    areas: [
      A('Oceanside', 33.196, -117.34),
    ],
  },
  {
    id: 'i-5-no-oceanside-camp-pendleton',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Oceanside to Camp Pendleton',
    fromName: 'Oceanside',
    toName: 'Camp Pendleton',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(33.21887, -117.39102), P(33.22266, -117.39278), P(33.22767, -117.3969),
      P(33.2314, -117.40223), P(33.23522, -117.40473), P(33.23827, -117.40913),
      P(33.24039, -117.41348), P(33.24591, -117.41759), P(33.24649, -117.41785),
    ],
    areas: [
      A('Oceanside', 33.23349, -117.40359),
    ],
  },
  {
    id: 'i-5-no-through-camp-pendleton',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Through Camp Pendleton',
    fromName: 'Camp Pendleton',
    toName: 'Camp Pendleton',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(33.24649, -117.41785), P(33.2536, -117.42296), P(33.26162, -117.4295),
      P(33.2656, -117.43288), P(33.27032, -117.43947), P(33.27474, -117.444),
      P(33.27526, -117.44445),
    ],
    areas: [
      A('Camp Pendleton', 33.3, -117.44),
    ],
  },
  {
    id: 'i-5-no-camp-pendleton-las-pulgas',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Camp Pendleton to Las Pulgas',
    fromName: 'Camp Pendleton',
    toName: 'Las Pulgas',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(33.27526, -117.44445), P(33.27883, -117.44745), P(33.2863, -117.45312),
      P(33.29168, -117.45704), P(33.29685, -117.46196), P(33.30019, -117.4661),
      P(33.30418, -117.47109),
    ],
    areas: [
      A('Camp Pendleton', 33.3, -117.44),
    ],
  },
  {
    id: 'i-5-no-las-pulgas-camp-pendleton',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Las Pulgas to Camp Pendleton',
    fromName: 'Las Pulgas',
    toName: 'Camp Pendleton',
    lengthKm: 4.2,
    designSpeedMph: 60,
    polyline: [
      P(33.30418, -117.47109), P(33.31131, -117.47978), P(33.31546, -117.48195),
      P(33.32123, -117.48328), P(33.32897, -117.49263), P(33.33248, -117.49743),
      P(33.33299, -117.49814),
    ],
    areas: [
      A('Camp Pendleton', 33.31948, -117.48269),
    ],
  },
  {
    id: 'i-5-no-camp-pendleton-san-onofre',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Camp Pendleton to San Onofre',
    fromName: 'Camp Pendleton',
    toName: 'San Onofre',
    lengthKm: 4.2,
    designSpeedMph: 60,
    polyline: [
      P(33.33299, -117.49814), P(33.33603, -117.50232), P(33.33927, -117.50678),
      P(33.3425, -117.511), P(33.34607, -117.51614), P(33.3497, -117.52127),
      P(33.35343, -117.52642), P(33.35752, -117.5325),
    ],
    areas: [
      A('Camp Pendleton', 33.34541, -117.5152),
    ],
  },
  {
    id: 'i-5-no-through-san-onofre',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Through San Onofre',
    fromName: 'San Onofre',
    toName: 'San Onofre',
    lengthKm: 4.2,
    designSpeedMph: 60,
    polyline: [
      P(33.35752, -117.5325), P(33.36266, -117.54028), P(33.36548, -117.54442),
      P(33.37128, -117.55438), P(33.37374, -117.55913), P(33.37753, -117.56415),
      P(33.37983, -117.56892),
    ],
    areas: [
      A('San Onofre', 33.36902, -117.55048),
    ],
  },
  {
    id: 'i-5-no-through-san-onofre-2',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Through San Onofre (2)',
    fromName: 'San Onofre',
    toName: 'San Onofre',
    lengthKm: 4.2,
    designSpeedMph: 60,
    polyline: [
      P(33.37983, -117.56892), P(33.40747, -117.59944),
    ],
    areas: [
      A('San Onofre', 33.42, -117.557),
    ],
  },
  {
    id: 'i-5-no-san-onofre-county-line',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: San Onofre to County Line',
    fromName: 'San Onofre',
    toName: 'County Line',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(33.40747, -117.59944), P(33.41504, -117.60312), P(33.42076, -117.60674),
      P(33.42678, -117.61035), P(33.43126, -117.61465), P(33.43766, -117.62057),
      P(33.4366, -117.61864),
    ],
    areas: [
      A('San Onofre', 33.42, -117.557),
    ],
  },
  // --- I-5 North County (gapfill wave, Oct 28, 2026) — southbound
  {
    id: 'i-5-so-county-line-san-onofre',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: County Line to San Onofre',
    fromName: 'County Line',
    toName: 'San Onofre',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(33.4366, -117.61864), P(33.43766, -117.62057), P(33.43126, -117.61465),
      P(33.42678, -117.61035), P(33.42076, -117.60674), P(33.41504, -117.60312),
      P(33.40747, -117.59944),
    ],
    areas: [
      A('San Onofre', 33.42, -117.557),
    ],
  },
  {
    id: 'i-5-so-through-san-onofre',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Through San Onofre',
    fromName: 'San Onofre',
    toName: 'San Onofre',
    lengthKm: 4.2,
    designSpeedMph: 60,
    polyline: [
      P(33.40747, -117.59944), P(33.37983, -117.56892),
    ],
    areas: [
      A('San Onofre', 33.42, -117.557),
    ],
  },
  {
    id: 'i-5-so-through-san-onofre-2',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Through San Onofre (2)',
    fromName: 'San Onofre',
    toName: 'San Onofre',
    lengthKm: 4.2,
    designSpeedMph: 60,
    polyline: [
      P(33.37983, -117.56892), P(33.37753, -117.56415), P(33.37374, -117.55913),
      P(33.37128, -117.55438), P(33.36548, -117.54442), P(33.36266, -117.54028),
      P(33.35752, -117.5325),
    ],
    areas: [
      A('San Onofre', 33.36902, -117.55048),
    ],
  },
  {
    id: 'i-5-so-san-onofre-camp-pendleton',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: San Onofre to Camp Pendleton',
    fromName: 'San Onofre',
    toName: 'Camp Pendleton',
    lengthKm: 4.2,
    designSpeedMph: 60,
    polyline: [
      P(33.35752, -117.5325), P(33.35343, -117.52642), P(33.3497, -117.52127),
      P(33.34607, -117.51614), P(33.3425, -117.511), P(33.33927, -117.50678),
      P(33.33603, -117.50232), P(33.33299, -117.49814),
    ],
    areas: [
      A('Camp Pendleton', 33.34541, -117.5152),
    ],
  },
  {
    id: 'i-5-so-camp-pendleton-las-pulgas',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Camp Pendleton to Las Pulgas',
    fromName: 'Camp Pendleton',
    toName: 'Las Pulgas',
    lengthKm: 4.2,
    designSpeedMph: 60,
    polyline: [
      P(33.33299, -117.49814), P(33.33248, -117.49743), P(33.32897, -117.49263),
      P(33.32123, -117.48328), P(33.31546, -117.48195), P(33.31131, -117.47978),
      P(33.30418, -117.47109),
    ],
    areas: [
      A('Camp Pendleton', 33.31948, -117.48269),
    ],
  },
  {
    id: 'i-5-so-las-pulgas-camp-pendleton',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Las Pulgas to Camp Pendleton',
    fromName: 'Las Pulgas',
    toName: 'Camp Pendleton',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(33.30418, -117.47109), P(33.30019, -117.4661), P(33.29685, -117.46196),
      P(33.29168, -117.45704), P(33.2863, -117.45312), P(33.27883, -117.44745),
      P(33.27526, -117.44445),
    ],
    areas: [
      A('Camp Pendleton', 33.3, -117.44),
    ],
  },
  {
    id: 'i-5-so-through-camp-pendleton',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Through Camp Pendleton',
    fromName: 'Camp Pendleton',
    toName: 'Camp Pendleton',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(33.27526, -117.44445), P(33.27474, -117.444), P(33.27032, -117.43947),
      P(33.2656, -117.43288), P(33.26162, -117.4295), P(33.2536, -117.42296),
      P(33.24649, -117.41785),
    ],
    areas: [
      A('Camp Pendleton', 33.3, -117.44),
    ],
  },
  {
    id: 'i-5-so-camp-pendleton-oceanside',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Camp Pendleton to Oceanside',
    fromName: 'Camp Pendleton',
    toName: 'Oceanside',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(33.24649, -117.41785), P(33.24591, -117.41759), P(33.24039, -117.41348),
      P(33.23827, -117.40913), P(33.23522, -117.40473), P(33.2314, -117.40223),
      P(33.22767, -117.3969), P(33.22266, -117.39278), P(33.21887, -117.39102),
    ],
    areas: [
      A('Oceanside', 33.23349, -117.40359),
    ],
  },
  {
    id: 'i-5-so-through-oceanside',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Through Oceanside',
    fromName: 'Oceanside',
    toName: 'Oceanside',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(33.21887, -117.39102), P(33.21667, -117.39028), P(33.21251, -117.38854),
      P(33.20755, -117.38545), P(33.20401, -117.38242), P(33.20206, -117.37723),
      P(33.20014, -117.37183), P(33.19704, -117.36792), P(33.1923, -117.36393),
    ],
    areas: [
      A('Oceanside', 33.196, -117.34),
    ],
  },
  {
    id: 'i-5-so-oceanside-carlsbad',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Oceanside to Carlsbad',
    fromName: 'Oceanside',
    toName: 'Carlsbad',
    lengthKm: 3.1,
    designSpeedMph: 60,
    polyline: [
      P(33.1923, -117.36393), P(33.18852, -117.36097), P(33.18428, -117.35744),
      P(33.1801, -117.35364), P(33.17522, -117.34993), P(33.16955, -117.34565),
    ],
    areas: [
      A('Oceanside', 33.196, -117.34),
    ],
  },
  {
    id: 'i-5-so-through-carlsbad',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Through Carlsbad',
    fromName: 'Carlsbad',
    toName: 'Carlsbad',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.16955, -117.34565), P(33.16523, -117.34339), P(33.16059, -117.34088),
      P(33.15539, -117.33825), P(33.1501, -117.33522),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-so-carlsbad-palomar-airport-rd',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Carlsbad to Palomar Airport Rd',
    fromName: 'Carlsbad',
    toName: 'Palomar Airport Rd',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(33.1501, -117.33522), P(33.14637, -117.33379), P(33.14159, -117.33309),
      P(33.13713, -117.33083), P(33.13137, -117.32761), P(33.12589, -117.32445),
      P(33.12178, -117.32185),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-so-palomar-airport-rd-carlsbad',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Palomar Airport Rd to Carlsbad',
    fromName: 'Palomar Airport Rd',
    toName: 'Carlsbad',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.12178, -117.32185), P(33.11865, -117.31999), P(33.11241, -117.31608),
      P(33.10817, -117.31352), P(33.10299, -117.31028),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-so-carlsbad-la-costa-ave',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Carlsbad to La Costa Ave',
    fromName: 'Carlsbad',
    toName: 'La Costa Ave',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.10299, -117.31028), P(33.09959, -117.30828), P(33.09527, -117.30526),
      P(33.09066, -117.30227), P(33.08435, -117.29843),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-so-la-costa-ave-encinitas',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: La Costa Ave to Encinitas',
    fromName: 'La Costa Ave',
    toName: 'Encinitas',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(33.08435, -117.29843), P(33.07999, -117.29692), P(33.07378, -117.29471),
      P(33.06597, -117.29235), P(33.06136, -117.29132), P(33.05484, -117.2891),
    ],
    areas: [
      A('Encinitas', 33.03, -117.285),
    ],
  },
  {
    id: 'i-5-so-through-encinitas',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Through Encinitas',
    fromName: 'Encinitas',
    toName: 'Encinitas',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(33.05484, -117.2891), P(33.05252, -117.28848), P(33.04836, -117.28723),
      P(33.04438, -117.28621), P(33.0404, -117.28425), P(33.03568, -117.28108),
      P(33.03167, -117.2782), P(33.02687, -117.27515),
    ],
    areas: [
      A('Encinitas', 33.03, -117.285),
    ],
  },
  {
    id: 'i-5-so-encinitas-solana-beach',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Encinitas to Solana Beach',
    fromName: 'Encinitas',
    toName: 'Solana Beach',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(33.02687, -117.27515), P(33.02515, -117.27421), P(33.02018, -117.273),
      P(33.01638, -117.27118), P(33.01285, -117.2675), P(33.00982, -117.26403),
      P(33.00489, -117.2588), P(32.99938, -117.257),
    ],
    areas: [
      A('Encinitas', 33.03, -117.285),
      A('Solana Beach', 32.985, -117.271),
    ],
  },
  {
    id: 'i-5-so-solana-beach-del-mar',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Solana Beach to Del Mar',
    fromName: 'Solana Beach',
    toName: 'Del Mar',
    lengthKm: 2.6,
    designSpeedMph: 60,
    polyline: [
      P(32.99938, -117.257), P(32.99405, -117.25648), P(32.9886, -117.25547),
      P(32.98109, -117.2537), P(32.97678, -117.25208),
    ],
    areas: [
      A('Solana Beach', 32.985, -117.271),
      A('Del Mar', 32.96, -117.265),
    ],
  },
  {
    id: 'i-5-so-del-mar-sorrento-valley',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Del Mar to Sorrento Valley',
    fromName: 'Del Mar',
    toName: 'Sorrento Valley',
    lengthKm: 2.6,
    designSpeedMph: 60,
    polyline: [
      P(32.97678, -117.25208), P(32.97173, -117.25), P(32.96333, -117.24702),
      P(32.95918, -117.24564), P(32.95396, -117.24445),
    ],
    areas: [
      A('Solana Beach', 32.985, -117.271),
      A('Del Mar', 32.96, -117.265),
    ],
  },
  {
    id: 'i-5-so-through-sorrento-valley',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Through Sorrento Valley',
    fromName: 'Sorrento Valley',
    toName: 'Sorrento Valley',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(32.95396, -117.24445), P(32.95007, -117.24374), P(32.94525, -117.24298),
      P(32.93762, -117.24143), P(32.93244, -117.24121), P(32.92763, -117.24015),
      P(32.9236, -117.2388),
    ],
    areas: [
      A('Del Mar', 32.96, -117.265),
      A('Sorrento Valley', 32.935, -117.215),
    ],
  },
  {
    id: 'i-5-so-through-sorrento-valley-2',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Through Sorrento Valley (2)',
    fromName: 'Sorrento Valley',
    toName: 'Sorrento Valley',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(32.9236, -117.2388), P(32.92319, -117.23863), P(32.91933, -117.23609),
      P(32.91468, -117.23067), P(32.89544, -117.22702),
    ],
    areas: [
      A('Sorrento Valley', 32.935, -117.215),
    ],
  },
  {
    id: 'i-5-so-sorrento-valley-la-jolla',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Sorrento Valley to La Jolla',
    fromName: 'Sorrento Valley',
    toName: 'La Jolla',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(32.89544, -117.22702), P(32.89248, -117.22722), P(32.88704, -117.22761),
      P(32.88158, -117.22841), P(32.87582, -117.22886), P(32.8705, -117.2285),
    ],
    areas: [
      A('Sorrento Valley', 32.8801, -117.22857),
    ],
  },
  // --- SR-78 (gapfill wave, Oct 28, 2026) — eastbound
  {
    id: 'sr-78-ea-i-5-jct-oceanside',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: I-5 Jct to Oceanside',
    fromName: 'I-5 Jct',
    toName: 'Oceanside',
    lengthKm: 3.1,
    designSpeedMph: 60,
    polyline: [
      P(33.18114, -117.32941), P(33.18217, -117.32462), P(33.18123, -117.31912),
      P(33.18026, -117.31413), P(33.17986, -117.30906), P(33.18208, -117.30153),
    ],
    areas: [
      A('Oceanside', 33.18, -117.31),
    ],
  },
  {
    id: 'sr-78-ea-through-oceanside',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Through Oceanside',
    fromName: 'Oceanside',
    toName: 'Oceanside',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(33.18208, -117.30153), P(33.18321, -117.29548), P(33.18361, -117.28978),
      P(33.18511, -117.28519), P(33.18745, -117.2808), P(33.18988, -117.27564),
      P(33.18829, -117.26239),
    ],
    areas: [
      A('Oceanside', 33.18, -117.31),
    ],
  },
  {
    id: 'sr-78-ea-oceanside-vista',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Oceanside to Vista',
    fromName: 'Oceanside',
    toName: 'Vista',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(33.18829, -117.26239), P(33.17948, -117.22927), P(33.17402, -117.22563),
    ],
    areas: [
      A('Vista', 33.168, -117.21),
    ],
  },
  {
    id: 'sr-78-ea-through-vista',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Through Vista',
    fromName: 'Vista',
    toName: 'Vista',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(33.17402, -117.22563), P(33.17068, -117.22198), P(33.16882, -117.21709),
      P(33.16587, -117.21367), P(33.16019, -117.20903), P(33.15539, -117.20429),
      P(33.15227, -117.20078),
    ],
    areas: [
      A('Vista', 33.168, -117.21),
    ],
  },
  {
    id: 'sr-78-ea-vista-san-marcos',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Vista to San Marcos',
    fromName: 'Vista',
    toName: 'San Marcos',
    lengthKm: 4.2,
    designSpeedMph: 60,
    polyline: [
      P(33.15227, -117.20078), P(33.14879, -117.1967), P(33.14585, -117.19326),
      P(33.14289, -117.18967), P(33.13949, -117.18094), P(33.1374, -117.17511),
      P(33.13695, -117.16805), P(33.13729, -117.16229),
    ],
    areas: [
      A('Vista', 33.168, -117.21),
    ],
  },
  {
    id: 'sr-78-ea-through-san-marcos',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Through San Marcos',
    fromName: 'San Marcos',
    toName: 'San Marcos',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(33.13729, -117.16229), P(33.1391, -117.15355), P(33.1396, -117.14819),
      P(33.13901, -117.14201), P(33.1362, -117.13546), P(33.13476, -117.12878),
    ],
    areas: [
      A('San Marcos', 33.143, -117.125),
    ],
  },
  {
    id: 'sr-78-ea-san-marcos-escondido',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: San Marcos to Escondido',
    fromName: 'San Marcos',
    toName: 'Escondido',
    lengthKm: 4.3,
    designSpeedMph: 60,
    polyline: [
      P(33.13476, -117.12878), P(33.13202, -117.12122), P(33.12953, -117.11547),
      P(33.12727, -117.11027), P(33.12719, -117.10437), P(33.12895, -117.0986),
      P(33.13066, -117.09302), P(33.1329, -117.08645),
    ],
    areas: [
      A('San Marcos', 33.143, -117.125),
      A('Escondido', 33.12, -117.078),
    ],
  },
  // --- SR-78 (gapfill wave, Oct 28, 2026) — westbound
  {
    id: 'sr-78-we-escondido-san-marcos',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Escondido to San Marcos',
    fromName: 'Escondido',
    toName: 'San Marcos',
    lengthKm: 4.3,
    designSpeedMph: 60,
    polyline: [
      P(33.1329, -117.08645), P(33.13066, -117.09302), P(33.12895, -117.0986),
      P(33.12719, -117.10437), P(33.12727, -117.11027), P(33.12953, -117.11547),
      P(33.13202, -117.12122), P(33.13476, -117.12878),
    ],
    areas: [
      A('Escondido', 33.12, -117.078),
      A('San Marcos', 33.143, -117.125),
    ],
  },
  {
    id: 'sr-78-we-through-san-marcos',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Through San Marcos',
    fromName: 'San Marcos',
    toName: 'San Marcos',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(33.13476, -117.12878), P(33.1362, -117.13546), P(33.13901, -117.14201),
      P(33.1396, -117.14819), P(33.1391, -117.15355), P(33.13729, -117.16229),
    ],
    areas: [
      A('San Marcos', 33.143, -117.125),
    ],
  },
  {
    id: 'sr-78-we-san-marcos-vista',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: San Marcos to Vista',
    fromName: 'San Marcos',
    toName: 'Vista',
    lengthKm: 4.2,
    designSpeedMph: 60,
    polyline: [
      P(33.13729, -117.16229), P(33.13695, -117.16805), P(33.1374, -117.17511),
      P(33.13949, -117.18094), P(33.14289, -117.18967), P(33.14585, -117.19326),
      P(33.14879, -117.1967), P(33.15227, -117.20078),
    ],
    areas: [
      A('Vista', 33.168, -117.21),
    ],
  },
  {
    id: 'sr-78-we-through-vista',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Through Vista',
    fromName: 'Vista',
    toName: 'Vista',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(33.15227, -117.20078), P(33.15539, -117.20429), P(33.16019, -117.20903),
      P(33.16587, -117.21367), P(33.16882, -117.21709), P(33.17068, -117.22198),
      P(33.17402, -117.22563),
    ],
    areas: [
      A('Vista', 33.168, -117.21),
    ],
  },
  {
    id: 'sr-78-we-vista-oceanside',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Vista to Oceanside',
    fromName: 'Vista',
    toName: 'Oceanside',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(33.17402, -117.22563), P(33.17948, -117.22927), P(33.18829, -117.26239),
    ],
    areas: [
      A('Vista', 33.168, -117.21),
    ],
  },
  {
    id: 'sr-78-we-through-oceanside',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Through Oceanside',
    fromName: 'Oceanside',
    toName: 'Oceanside',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(33.18829, -117.26239), P(33.18988, -117.27564), P(33.18745, -117.2808),
      P(33.18511, -117.28519), P(33.18361, -117.28978), P(33.18321, -117.29548),
      P(33.18208, -117.30153),
    ],
    areas: [
      A('Oceanside', 33.18, -117.31),
    ],
  },
  {
    id: 'sr-78-we-oceanside-i-5-jct',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Oceanside to I-5 Jct',
    fromName: 'Oceanside',
    toName: 'I-5 Jct',
    lengthKm: 3.1,
    designSpeedMph: 60,
    polyline: [
      P(33.18208, -117.30153), P(33.17986, -117.30906), P(33.18026, -117.31413),
      P(33.18123, -117.31912), P(33.18217, -117.32462), P(33.18114, -117.32941),
    ],
    areas: [
      A('Oceanside', 33.18, -117.31),
    ],
  },
  // --- SR-56 — Ted Williams Parkway (gapfill wave, Oct 28, 2026) — eastbound
  {
    id: 'sr-56-ea-i-5-jct-carmel-valley',
    freeway: 'SR-56',
    direction: 'eastbound',
    displayName: 'SR-56 East: I-5 Jct to Carmel Valley',
    fromName: 'I-5 Jct',
    toName: 'Carmel Valley',
    lengthKm: 2.2,
    designSpeedMph: 60,
    polyline: [
      P(32.94427, -117.21389), P(32.94633, -117.20832), P(32.94901, -117.20357),
      P(32.95106, -117.19811), P(32.95133, -117.19653),
    ],
    areas: [
      A('Carmel Valley', 32.95, -117.2),
    ],
  },
  {
    id: 'sr-56-ea-carmel-valley-rancho-peñasquitos',
    freeway: 'SR-56',
    direction: 'eastbound',
    displayName: 'SR-56 East: Carmel Valley to Rancho Peñasquitos',
    fromName: 'Carmel Valley',
    toName: 'Rancho Peñasquitos',
    lengthKm: 2.2,
    designSpeedMph: 60,
    polyline: [
      P(32.95133, -117.19653), P(32.95362, -117.19024), P(32.95651, -117.18571),
      P(32.96038, -117.18314), P(32.96462, -117.18),
    ],
    areas: [
      A('Carmel Valley', 32.95, -117.2),
      A('Pacific Highlands Ranch', 32.972, -117.185),
    ],
  },
  {
    id: 'sr-56-ea-through-rancho-peñasquitos',
    freeway: 'SR-56',
    direction: 'eastbound',
    displayName: 'SR-56 East: Through Rancho Peñasquitos',
    fromName: 'Rancho Peñasquitos',
    toName: 'Rancho Peñasquitos',
    lengthKm: 3.0,
    designSpeedMph: 60,
    polyline: [
      P(32.96462, -117.18), P(32.96708, -117.17336), P(32.96652, -117.16854),
      P(32.96382, -117.16216), P(32.961, -117.15667), P(32.95805, -117.1519),
    ],
    areas: [
      A('Pacific Highlands Ranch', 32.972, -117.185),
      A('Los Peñasquitos Canyon Preserve', 32.955, -117.155),
      A('Rancho Peñasquitos', 32.965, -117.135),
    ],
  },
  {
    id: 'sr-56-ea-through-rancho-peñasquitos-2',
    freeway: 'SR-56',
    direction: 'eastbound',
    displayName: 'SR-56 East: Through Rancho Peñasquitos (2)',
    fromName: 'Rancho Peñasquitos',
    toName: 'Rancho Peñasquitos',
    lengthKm: 2.7,
    designSpeedMph: 60,
    polyline: [
      P(32.95805, -117.1519), P(32.95533, -117.14812), P(32.95751, -117.12456),
    ],
    areas: [
      A('Los Peñasquitos Canyon Preserve', 32.955, -117.155),
      A('Rancho Peñasquitos', 32.965, -117.135),
    ],
  },
  {
    id: 'sr-56-ea-rancho-peñasquitos-i-15-jct',
    freeway: 'SR-56',
    direction: 'eastbound',
    displayName: 'SR-56 East: Rancho Peñasquitos to I-15 Jct',
    fromName: 'Rancho Peñasquitos',
    toName: 'I-15 Jct',
    lengthKm: 2.7,
    designSpeedMph: 60,
    polyline: [
      P(32.95751, -117.12456), P(32.95851, -117.11375), P(32.96115, -117.10644),
      P(32.96254, -117.1017), P(32.96436, -117.09739),
    ],
    areas: [
      A('Sabre Springs', 32.975, -117.105),
    ],
  },
  // --- SR-56 — Ted Williams Parkway (gapfill wave, Oct 28, 2026) — westbound
  {
    id: 'sr-56-we-i-15-jct-rancho-peñasquitos',
    freeway: 'SR-56',
    direction: 'westbound',
    displayName: 'SR-56 West: I-15 Jct to Rancho Peñasquitos',
    fromName: 'I-15 Jct',
    toName: 'Rancho Peñasquitos',
    lengthKm: 2.7,
    designSpeedMph: 60,
    polyline: [
      P(32.96436, -117.09739), P(32.96254, -117.1017), P(32.96115, -117.10644),
      P(32.95851, -117.11375), P(32.95751, -117.12456),
    ],
    areas: [
      A('Sabre Springs', 32.975, -117.105),
    ],
  },
  {
    id: 'sr-56-we-through-rancho-peñasquitos',
    freeway: 'SR-56',
    direction: 'westbound',
    displayName: 'SR-56 West: Through Rancho Peñasquitos',
    fromName: 'Rancho Peñasquitos',
    toName: 'Rancho Peñasquitos',
    lengthKm: 2.7,
    designSpeedMph: 60,
    polyline: [
      P(32.95751, -117.12456), P(32.95533, -117.14812), P(32.95805, -117.1519),
    ],
    areas: [
      A('Rancho Peñasquitos', 32.965, -117.135),
      A('Los Peñasquitos Canyon Preserve', 32.955, -117.155),
    ],
  },
  {
    id: 'sr-56-we-through-rancho-peñasquitos-2',
    freeway: 'SR-56',
    direction: 'westbound',
    displayName: 'SR-56 West: Through Rancho Peñasquitos (2)',
    fromName: 'Rancho Peñasquitos',
    toName: 'Rancho Peñasquitos',
    lengthKm: 3.0,
    designSpeedMph: 60,
    polyline: [
      P(32.95805, -117.1519), P(32.961, -117.15667), P(32.96382, -117.16216),
      P(32.96652, -117.16854), P(32.96708, -117.17336), P(32.96462, -117.18),
    ],
    areas: [
      A('Rancho Peñasquitos', 32.965, -117.135),
      A('Los Peñasquitos Canyon Preserve', 32.955, -117.155),
      A('Pacific Highlands Ranch', 32.972, -117.185),
    ],
  },
  {
    id: 'sr-56-we-rancho-peñasquitos-carmel-valley',
    freeway: 'SR-56',
    direction: 'westbound',
    displayName: 'SR-56 West: Rancho Peñasquitos to Carmel Valley',
    fromName: 'Rancho Peñasquitos',
    toName: 'Carmel Valley',
    lengthKm: 2.2,
    designSpeedMph: 60,
    polyline: [
      P(32.96462, -117.18), P(32.96038, -117.18314), P(32.95651, -117.18571),
      P(32.95362, -117.19024), P(32.95133, -117.19653),
    ],
    areas: [
      A('Pacific Highlands Ranch', 32.972, -117.185),
      A('Carmel Valley', 32.95, -117.2),
    ],
  },
  {
    id: 'sr-56-we-carmel-valley-i-5-jct',
    freeway: 'SR-56',
    direction: 'westbound',
    displayName: 'SR-56 West: Carmel Valley to I-5 Jct',
    fromName: 'Carmel Valley',
    toName: 'I-5 Jct',
    lengthKm: 2.2,
    designSpeedMph: 60,
    polyline: [
      P(32.95133, -117.19653), P(32.95106, -117.19811), P(32.94901, -117.20357),
      P(32.94633, -117.20832), P(32.94427, -117.21389),
    ],
    areas: [
      A('Carmel Valley', 32.95, -117.2),
    ],
  },
  // --- I-15 north of Escondido (gapfill wave, Oct 28, 2026) — northbound
  {
    id: 'i-15-no-through-escondido',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Through Escondido',
    fromName: 'Escondido',
    toName: 'Escondido',
    lengthKm: 2.3,
    designSpeedMph: 60,
    polyline: [
      P(33.075, -117.095), P(33.09597, -117.09382),
    ],
    areas: [
      A('Escondido', 33.12, -117.078),
    ],
  },
  {
    id: 'i-15-no-escondido-escondido-sr-78',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Escondido to Escondido (SR-78)',
    fromName: 'Escondido',
    toName: 'Escondido (SR-78)',
    lengthKm: 2.3,
    designSpeedMph: 60,
    polyline: [
      P(33.09597, -117.09382), P(33.10599, -117.09326), P(33.11055, -117.09622),
      P(33.11414, -117.09858), P(33.11579, -117.09895),
    ],
    areas: [
      A('Escondido', 33.12, -117.078),
    ],
  },
  {
    id: 'i-15-no-escondido-sr-78-escondido',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Escondido (SR-78) to Escondido',
    fromName: 'Escondido (SR-78)',
    toName: 'Escondido',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(33.11579, -117.09895), P(33.11926, -117.10144), P(33.12312, -117.1032),
      P(33.12825, -117.10505), P(33.13473, -117.1051), P(33.13988, -117.10483),
      P(33.14442, -117.10445), P(33.14871, -117.10452), P(33.14949, -117.10444),
    ],
    areas: [
      A('Escondido', 33.12, -117.078),
    ],
  },
  {
    id: 'i-15-no-through-escondido-2',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Through Escondido (2)',
    fromName: 'Escondido',
    toName: 'Escondido',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(33.14949, -117.10444), P(33.15482, -117.10409), P(33.15885, -117.10453),
      P(33.16278, -117.10592), P(33.16943, -117.1097), P(33.17461, -117.11269),
      P(33.17834, -117.11507), P(33.18212, -117.11675),
    ],
    areas: [
      A('Hidden Meadows', 33.16628, -117.10809),
    ],
  },
  {
    id: 'i-15-no-escondido-hidden-meadows',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Escondido to Hidden Meadows',
    fromName: 'Escondido',
    toName: 'Hidden Meadows',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(33.18212, -117.11675), P(33.18651, -117.1193), P(33.19272, -117.12311),
      P(33.19722, -117.12568), P(33.20214, -117.12886), P(33.20709, -117.13208),
      P(33.21053, -117.1346),
    ],
    areas: [
      A('Hidden Meadows', 33.215, -117.12),
    ],
  },
  {
    id: 'i-15-no-through-hidden-meadows',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Through Hidden Meadows',
    fromName: 'Hidden Meadows',
    toName: 'Hidden Meadows',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(33.21053, -117.1346), P(33.2149, -117.13787), P(33.21959, -117.14113),
      P(33.22409, -117.14325), P(33.22931, -117.14575), P(33.23389, -117.14797),
      P(33.23972, -117.15023),
    ],
    areas: [
      A('Hidden Meadows', 33.215, -117.12),
    ],
  },
  {
    id: 'i-15-no-hidden-meadows-bonsall',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Hidden Meadows to Bonsall',
    fromName: 'Hidden Meadows',
    toName: 'Bonsall',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.23972, -117.15023), P(33.24667, -117.15343), P(33.25285, -117.15587),
      P(33.25764, -117.15756), P(33.2599, -117.15857),
    ],
    areas: [
      A('Bonsall', 33.26, -117.15),
    ],
  },
  {
    id: 'i-15-no-through-bonsall',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Through Bonsall',
    fromName: 'Bonsall',
    toName: 'Bonsall',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.2599, -117.15857), P(33.26631, -117.15839), P(33.27063, -117.15715),
      P(33.28015, -117.15181),
    ],
    areas: [
      A('Bonsall', 33.26, -117.15),
    ],
  },
  {
    id: 'i-15-no-bonsall-fallbrook',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Bonsall to Fallbrook',
    fromName: 'Bonsall',
    toName: 'Fallbrook',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(33.28015, -117.15181), P(33.28465, -117.15006), P(33.30978, -117.15191),
    ],
    areas: [
      A('Bonsall', 33.26, -117.15),
    ],
  },
  {
    id: 'i-15-no-through-fallbrook',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Through Fallbrook',
    fromName: 'Fallbrook',
    toName: 'Fallbrook',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(33.30978, -117.15191), P(33.31514, -117.15324), P(33.32014, -117.15663),
      P(33.32521, -117.15865), P(33.33117, -117.15928), P(33.3361, -117.15918),
      P(33.33844, -117.15915),
    ],
    areas: [
      A('Fallbrook', 33.35, -117.155),
    ],
  },
  {
    id: 'i-15-no-through-fallbrook-2',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Through Fallbrook (2)',
    fromName: 'Fallbrook',
    toName: 'Fallbrook',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(33.33844, -117.15915), P(33.34411, -117.15906), P(33.35628, -117.1589),
      P(33.36177, -117.15993), P(33.36668, -117.16244), P(33.36767, -117.1632),
    ],
    areas: [
      A('Fallbrook', 33.35, -117.155),
    ],
  },
  {
    id: 'i-15-no-fallbrook-rainbow',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Fallbrook to Rainbow',
    fromName: 'Fallbrook',
    toName: 'Rainbow',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(33.36767, -117.1632), P(33.3723, -117.16743), P(33.37639, -117.17123),
      P(33.3801, -117.17325), P(33.3851, -117.17473), P(33.39127, -117.17426),
      P(33.39451, -117.17303),
    ],
    areas: [
      A('Fallbrook', 33.35, -117.155),
    ],
  },
  {
    id: 'i-15-no-rainbow-county-line',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Rainbow to County Line',
    fromName: 'Rainbow',
    toName: 'County Line',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.39451, -117.17303), P(33.39923, -117.17067), P(33.40305, -117.16765),
      P(33.40715, -117.16467), P(33.41082, -117.16163), P(33.40826, -117.16335),
    ],
    areas: [
      A('Rainbow', 33.405, -117.145),
    ],
  },
  // --- I-15 north of Escondido (gapfill wave, Oct 28, 2026) — southbound
  {
    id: 'i-15-so-county-line-rainbow',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: County Line to Rainbow',
    fromName: 'County Line',
    toName: 'Rainbow',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.40826, -117.16335), P(33.41082, -117.16163), P(33.40715, -117.16467),
      P(33.40305, -117.16765), P(33.39923, -117.17067), P(33.39451, -117.17303),
    ],
    areas: [
      A('Rainbow', 33.405, -117.145),
    ],
  },
  {
    id: 'i-15-so-rainbow-fallbrook',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Rainbow to Fallbrook',
    fromName: 'Rainbow',
    toName: 'Fallbrook',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(33.39451, -117.17303), P(33.39127, -117.17426), P(33.3851, -117.17473),
      P(33.3801, -117.17325), P(33.37639, -117.17123), P(33.3723, -117.16743),
      P(33.36767, -117.1632),
    ],
    areas: [
      A('Fallbrook', 33.35, -117.155),
    ],
  },
  {
    id: 'i-15-so-through-fallbrook',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Through Fallbrook',
    fromName: 'Fallbrook',
    toName: 'Fallbrook',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(33.36767, -117.1632), P(33.36668, -117.16244), P(33.36177, -117.15993),
      P(33.35628, -117.1589), P(33.34411, -117.15906), P(33.33844, -117.15915),
    ],
    areas: [
      A('Fallbrook', 33.35, -117.155),
    ],
  },
  {
    id: 'i-15-so-through-fallbrook-2',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Through Fallbrook (2)',
    fromName: 'Fallbrook',
    toName: 'Fallbrook',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(33.33844, -117.15915), P(33.3361, -117.15918), P(33.33117, -117.15928),
      P(33.32521, -117.15865), P(33.32014, -117.15663), P(33.31514, -117.15324),
      P(33.30978, -117.15191),
    ],
    areas: [
      A('Fallbrook', 33.35, -117.155),
    ],
  },
  {
    id: 'i-15-so-fallbrook-bonsall',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Fallbrook to Bonsall',
    fromName: 'Fallbrook',
    toName: 'Bonsall',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(33.30978, -117.15191), P(33.28465, -117.15006), P(33.28015, -117.15181),
    ],
    areas: [
      A('Bonsall', 33.26, -117.15),
    ],
  },
  {
    id: 'i-15-so-through-bonsall',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Through Bonsall',
    fromName: 'Bonsall',
    toName: 'Bonsall',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.28015, -117.15181), P(33.27063, -117.15715), P(33.26631, -117.15839),
      P(33.2599, -117.15857),
    ],
    areas: [
      A('Bonsall', 33.26, -117.15),
    ],
  },
  {
    id: 'i-15-so-bonsall-hidden-meadows',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Bonsall to Hidden Meadows',
    fromName: 'Bonsall',
    toName: 'Hidden Meadows',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(33.2599, -117.15857), P(33.25764, -117.15756), P(33.25285, -117.15587),
      P(33.24667, -117.15343), P(33.23972, -117.15023),
    ],
    areas: [
      A('Bonsall', 33.26, -117.15),
    ],
  },
  {
    id: 'i-15-so-through-hidden-meadows',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Through Hidden Meadows',
    fromName: 'Hidden Meadows',
    toName: 'Hidden Meadows',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(33.23972, -117.15023), P(33.23389, -117.14797), P(33.22931, -117.14575),
      P(33.22409, -117.14325), P(33.21959, -117.14113), P(33.2149, -117.13787),
      P(33.21053, -117.1346),
    ],
    areas: [
      A('Hidden Meadows', 33.215, -117.12),
    ],
  },
  {
    id: 'i-15-so-hidden-meadows-escondido',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Hidden Meadows to Escondido',
    fromName: 'Hidden Meadows',
    toName: 'Escondido',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(33.21053, -117.1346), P(33.20709, -117.13208), P(33.20214, -117.12886),
      P(33.19722, -117.12568), P(33.19272, -117.12311), P(33.18651, -117.1193),
      P(33.18212, -117.11675),
    ],
    areas: [
      A('Hidden Meadows', 33.215, -117.12),
    ],
  },
  {
    id: 'i-15-so-through-escondido',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Through Escondido',
    fromName: 'Escondido',
    toName: 'Escondido',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(33.18212, -117.11675), P(33.17834, -117.11507), P(33.17461, -117.11269),
      P(33.16943, -117.1097), P(33.16278, -117.10592), P(33.15885, -117.10453),
      P(33.15482, -117.10409), P(33.14949, -117.10444),
    ],
    areas: [
      A('Hidden Meadows', 33.16628, -117.10809),
    ],
  },
  {
    id: 'i-15-so-escondido-escondido-sr-78',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Escondido to Escondido (SR-78)',
    fromName: 'Escondido',
    toName: 'Escondido (SR-78)',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(33.14949, -117.10444), P(33.14871, -117.10452), P(33.14442, -117.10445),
      P(33.13988, -117.10483), P(33.13473, -117.1051), P(33.12825, -117.10505),
      P(33.12312, -117.1032), P(33.11926, -117.10144), P(33.11579, -117.09895),
    ],
    areas: [
      A('Escondido', 33.12, -117.078),
    ],
  },
  {
    id: 'i-15-so-escondido-sr-78-escondido',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Escondido (SR-78) to Escondido',
    fromName: 'Escondido (SR-78)',
    toName: 'Escondido',
    lengthKm: 2.3,
    designSpeedMph: 60,
    polyline: [
      P(33.11579, -117.09895), P(33.11414, -117.09858), P(33.11055, -117.09622),
      P(33.10599, -117.09326), P(33.09597, -117.09382),
    ],
    areas: [
      A('Escondido', 33.12, -117.078),
    ],
  },
  {
    id: 'i-15-so-through-escondido-2',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Through Escondido (2)',
    fromName: 'Escondido',
    toName: 'Escondido',
    lengthKm: 2.3,
    designSpeedMph: 60,
    polyline: [
      P(33.09597, -117.09382), P(33.075, -117.095),
    ],
    areas: [
      A('Escondido', 33.12, -117.078),
    ],
  },
  // ------------------------------------------------------------- 2C (Oct 30, 2026)
  // East/South commuter coverage, Part B of east-south-commuter-coverage.md.
  // Geometry: real OSM motorway traces (junction-graph routing, author-2c-v4).
  {
    id: 'i-8-eb-la-mesa-grossmont',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: La Mesa to Grossmont',
    fromName: 'La Mesa',
    toName: 'Grossmont',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(32.77769, -117.00381), P(32.7794, -116.99607), P(32.77908, -116.98608),
      P(32.78281, -116.98119),
    ],
    areas: [
      A('Grossmont Center', 32.779, -117.01),
      A('Gillespie Field', 32.826, -116.972),
    ],
  },
  {
    id: 'i-8-wb-grossmont-la-mesa',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Grossmont to La Mesa',
    fromName: 'Grossmont',
    toName: 'La Mesa',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(32.78281, -116.98119), P(32.77908, -116.98608), P(32.7794, -116.99607),
      P(32.77769, -117.00381),
    ],
    areas: [
      A('Grossmont Center', 32.779, -117.01),
      A('Gillespie Field', 32.826, -116.972),
    ],
  },
  {
    id: 'i-8-eb-grossmont-el-cajon',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Grossmont to El Cajon',
    fromName: 'Grossmont',
    toName: 'El Cajon',
    lengthKm: 6.7,
    designSpeedMph: 60,
    polyline: [
      P(32.78335, -116.98089), P(32.79145, -116.97784), P(32.79992, -116.97587),
      P(32.80316, -116.96582), P(32.80317, -116.95557), P(32.80317, -116.94473),
      P(32.80322, -116.93205), P(32.80331, -116.9267),
    ],
    areas: [
      A('El Cajon', 32.795, -116.963),
    ],
  },
  {
    id: 'i-8-wb-el-cajon-grossmont',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: El Cajon to Grossmont',
    fromName: 'El Cajon',
    toName: 'Grossmont',
    lengthKm: 6.7,
    designSpeedMph: 60,
    polyline: [
      P(32.80331, -116.9267), P(32.80322, -116.93205), P(32.80317, -116.94473),
      P(32.80317, -116.95557), P(32.80316, -116.96582), P(32.79992, -116.97587),
      P(32.79145, -116.97784), P(32.78335, -116.98089),
    ],
    areas: [
      A('El Cajon', 32.795, -116.963),
    ],
  },
  {
    id: 'sr-54-eb-national-city-bonita',
    freeway: 'SR-54',
    direction: 'eastbound',
    displayName: 'SR-54 East: National City to Bonita',
    fromName: 'National City',
    toName: 'Bonita',
    lengthKm: 4.8,
    designSpeedMph: 55,
    polyline: [
      P(32.65151, -117.10392), P(32.65404, -117.09567), P(32.6572, -117.08815),
      P(32.65921, -117.08127), P(32.65858, -117.07358), P(32.66185, -117.06653),
      P(32.66412, -117.0592), P(32.66455, -117.05659),
    ],
    areas: [
      A('Bonita', 32.665, -117.017),
    ],
  },
  {
    id: 'sr-54-wb-bonita-national-city',
    freeway: 'SR-54',
    direction: 'westbound',
    displayName: 'SR-54 West: Bonita to National City',
    fromName: 'Bonita',
    toName: 'National City',
    lengthKm: 4.8,
    designSpeedMph: 55,
    polyline: [
      P(32.66455, -117.05659), P(32.66412, -117.0592), P(32.66185, -117.06653),
      P(32.65858, -117.07358), P(32.65921, -117.08127), P(32.6572, -117.08815),
      P(32.65404, -117.09567), P(32.65151, -117.10392),
    ],
    areas: [
      A('Bonita', 32.665, -117.017),
    ],
  },
  {
    id: 'sr-54-eb-bonita-rancho-san-diego',
    freeway: 'SR-54',
    direction: 'eastbound',
    displayName: 'SR-54 East: Bonita to Rancho San Diego',
    fromName: 'Bonita',
    toName: 'Rancho San Diego',
    lengthKm: 5.5,
    designSpeedMph: 60,
    polyline: [
      P(32.66467, -117.05607), P(32.66894, -117.04644), P(32.67355, -117.03906),
      P(32.68152, -117.0304), P(32.68642, -117.02379), P(32.69137, -117.01738),
      P(32.69685, -117.01326),
    ],
    areas: [
      A('Rancho San Diego', 32.72, -116.955),
    ],
  },
  {
    id: 'sr-54-wb-rancho-san-diego-bonita',
    freeway: 'SR-54',
    direction: 'westbound',
    displayName: 'SR-54 West: Rancho San Diego to Bonita',
    fromName: 'Rancho San Diego',
    toName: 'Bonita',
    lengthKm: 5.5,
    designSpeedMph: 60,
    polyline: [
      P(32.69685, -117.01326), P(32.69137, -117.01738), P(32.68642, -117.02379),
      P(32.68152, -117.0304), P(32.67355, -117.03906), P(32.66894, -117.04644),
      P(32.66467, -117.05607),
    ],
    areas: [
      A('Rancho San Diego', 32.72, -116.955),
    ],
  },
  {
    id: 'sr-67-nb-el-cajon-gillespie-field',
    freeway: 'SR-67',
    direction: 'northbound',
    displayName: 'SR-67 North: El Cajon to Gillespie Field',
    fromName: 'El Cajon',
    toName: 'Gillespie Field',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(32.80949, -116.96189), P(32.81654, -116.9608), P(32.82302, -116.96104),
      P(32.83046, -116.96186), P(32.83681, -116.96202), P(32.83923, -116.96193),
    ],
    areas: [
      A('Gillespie Field', 32.827, -116.982),
    ],
  },
  {
    id: 'sr-67-sb-gillespie-field-el-cajon',
    freeway: 'SR-67',
    direction: 'southbound',
    displayName: 'SR-67 South: Gillespie Field to El Cajon',
    fromName: 'Gillespie Field',
    toName: 'El Cajon',
    lengthKm: 3.4,
    designSpeedMph: 60,
    polyline: [
      P(32.83923, -116.96193), P(32.83681, -116.96202), P(32.83046, -116.96186),
      P(32.82302, -116.96104), P(32.81654, -116.9608), P(32.80949, -116.96189),
    ],
    areas: [
      A('Gillespie Field', 32.827, -116.982),
    ],
  },
  {
    id: 'sr-67-nb-gillespie-field-lakeside',
    freeway: 'SR-67',
    direction: 'northbound',
    displayName: 'SR-67 North: Gillespie Field to Lakeside',
    fromName: 'Gillespie Field',
    toName: 'Lakeside',
    lengthKm: 2,
    designSpeedMph: 60,
    polyline: [
      P(32.83999, -116.96178), P(32.84855, -116.95415), P(32.85339, -116.94897),
    ],
    areas: [
      A('Lakeside', 32.85, -116.896),
    ],
  },
  {
    id: 'sr-67-sb-lakeside-gillespie-field',
    freeway: 'SR-67',
    direction: 'southbound',
    displayName: 'SR-67 South: Lakeside to Gillespie Field',
    fromName: 'Lakeside',
    toName: 'Gillespie Field',
    lengthKm: 2,
    designSpeedMph: 60,
    polyline: [
      P(32.85339, -116.94897), P(32.84855, -116.95415), P(32.83999, -116.96178),
    ],
    areas: [
      A('Lakeside', 32.85, -116.896),
    ],
  },
  {
    id: 'sr-94-eb-lemon-grove-dictionary-hill',
    freeway: 'SR-94',
    direction: 'eastbound',
    displayName: 'SR-94 East: Lemon Grove to Dictionary Hill',
    fromName: 'Lemon Grove',
    toName: 'Dictionary Hill',
    lengthKm: 1.6,
    designSpeedMph: 55,
    polyline: [
      P(32.7453, -117.03463), P(32.74701, -117.02735), P(32.74693, -117.01991),
      P(32.74742, -117.01844),
    ],
    areas: [
      A('Lemon Grove', 32.743, -117.031),
      A('Spring Valley', 39.076, -122.595),
    ],
  },
  {
    id: 'sr-94-wb-dictionary-hill-lemon-grove',
    freeway: 'SR-94',
    direction: 'westbound',
    displayName: 'SR-94 West: Dictionary Hill to Lemon Grove',
    fromName: 'Dictionary Hill',
    toName: 'Lemon Grove',
    lengthKm: 1.6,
    designSpeedMph: 55,
    polyline: [
      P(32.74742, -117.01844), P(32.74693, -117.01991), P(32.74701, -117.02735),
      P(32.7453, -117.03463),
    ],
    areas: [
      A('Lemon Grove', 32.743, -117.031),
      A('Spring Valley', 39.076, -122.595),
    ],
  },
  {
    id: 'sr-94-eb-dictionary-hill-rancho-san-diego',
    freeway: 'SR-94',
    direction: 'eastbound',
    displayName: 'SR-94 East: Dictionary Hill to Rancho San Diego',
    fromName: 'Dictionary Hill',
    toName: 'Rancho San Diego',
    lengthKm: 6.2,
    designSpeedMph: 55,
    polyline: [
      P(32.74742, -117.01844), P(32.75284, -117.01148), P(32.75057, -117.00301),
      P(32.74797, -116.99401), P(32.74471, -116.98528), P(32.74437, -116.97419),
      P(32.74466, -116.96437), P(32.74544, -116.95797),
    ],
    areas: [
      A('Mount San Miguel Park', 32.671, -116.974),
      A('Rancho San Diego', 32.761, -116.926),
    ],
  },
  {
    id: 'sr-94-wb-rancho-san-diego-dictionary-hill',
    freeway: 'SR-94',
    direction: 'westbound',
    displayName: 'SR-94 West: Rancho San Diego to Dictionary Hill',
    fromName: 'Rancho San Diego',
    toName: 'Dictionary Hill',
    lengthKm: 6.2,
    designSpeedMph: 55,
    polyline: [
      P(32.74544, -116.95797), P(32.74466, -116.96437), P(32.74437, -116.97419),
      P(32.74471, -116.98528), P(32.74797, -116.99401), P(32.75057, -117.00301),
      P(32.75284, -117.01148), P(32.74742, -117.01844),
    ],
    areas: [
      A('Mount San Miguel Park', 32.671, -116.974),
      A('Rancho San Diego', 32.761, -116.926),
    ],
  },
  {
    id: 'i-5-sb-south-chula-vista-palm-avenue',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: South Chula Vista to Palm Avenue',
    fromName: 'South Chula Vista',
    toName: 'Palm Avenue',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.61563, -117.09148), P(32.60754, -117.09054), P(32.59906, -117.08948),
      P(32.59194, -117.0885), P(32.58467, -117.08759), P(32.58151, -117.08686),
    ],
    areas: [
      A('Otay Valley Regional Park', 32.589, -117.06),
    ],
  },
  {
    id: 'i-5-nb-palm-avenue-south-chula-vista',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Palm Avenue to South Chula Vista',
    fromName: 'Palm Avenue',
    toName: 'South Chula Vista',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(32.58151, -117.08686), P(32.58467, -117.08759), P(32.59194, -117.0885),
      P(32.59906, -117.08948), P(32.60754, -117.09054), P(32.61563, -117.09148),
    ],
    areas: [
      A('Otay Valley Regional Park', 32.589, -117.06),
    ],
  },
  {
    id: 'i-5-sb-palm-avenue-san-ysidro',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Palm Avenue to San Ysidro',
    fromName: 'Palm Avenue',
    toName: 'San Ysidro',
    lengthKm: 6.3,
    designSpeedMph: 60,
    polyline: [
      P(32.58068, -117.0864), P(32.57283, -117.07964), P(32.56585, -117.07431),
      P(32.56023, -117.06577), P(32.55262, -117.04863), P(32.549, -117.03984),
      P(32.54611, -117.03538),
    ],
    areas: [
      A('San Ysidro', 32.552, -117.043),
      A('San Ysidro', 32.552, -117.043),
    ],
  },
  {
    id: 'i-5-nb-san-ysidro-palm-avenue',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: San Ysidro to Palm Avenue',
    fromName: 'San Ysidro',
    toName: 'Palm Avenue',
    lengthKm: 6.3,
    designSpeedMph: 60,
    polyline: [
      P(32.54611, -117.03538), P(32.549, -117.03984), P(32.55262, -117.04863),
      P(32.56023, -117.06577), P(32.56585, -117.07431), P(32.57283, -117.07964),
      P(32.58068, -117.0864),
    ],
    areas: [
      A('San Ysidro', 32.552, -117.043),
      A('San Ysidro', 32.552, -117.043),
    ],
  },
  {
    id: 'i-805-sb-chula-vista-otay-valley',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Chula Vista to Otay Valley',
    fromName: 'Chula Vista',
    toName: 'Otay Valley',
    lengthKm: 5,
    designSpeedMph: 60,
    polyline: [
      P(32.63905, -117.0538), P(32.63493, -117.04766), P(32.62939, -117.04411),
      P(32.62192, -117.04089), P(32.61481, -117.03827), P(32.60839, -117.03654),
      P(32.60197, -117.03649), P(32.59929, -117.03648),
    ],
    areas: [
      A('Otay Valley Regional Park', 32.589, -117.06),
    ],
  },
  {
    id: 'i-805-nb-otay-valley-chula-vista',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Otay Valley to Chula Vista',
    fromName: 'Otay Valley',
    toName: 'Chula Vista',
    lengthKm: 5,
    designSpeedMph: 60,
    polyline: [
      P(32.59929, -117.03648), P(32.60197, -117.03649), P(32.60839, -117.03654),
      P(32.61481, -117.03827), P(32.62192, -117.04089), P(32.62939, -117.04411),
      P(32.63493, -117.04766), P(32.63905, -117.0538),
    ],
    areas: [
      A('Otay Valley Regional Park', 32.589, -117.06),
    ],
  },
  {
    id: 'i-805-sb-otay-valley-san-ysidro-merge',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Otay Valley to San Ysidro Merge',
    fromName: 'Otay Valley',
    toName: 'San Ysidro Merge',
    lengthKm: 5.5,
    designSpeedMph: 60,
    polyline: [
      P(32.59839, -117.03648), P(32.59125, -117.0365), P(32.584, -117.03709),
      P(32.57656, -117.03882), P(32.56871, -117.04064), P(32.56152, -117.04226),
      P(32.55225, -117.04135), P(32.54935, -117.0404),
    ],
    areas: [
      A('San Ysidro', 32.552, -117.043),
    ],
  },
  {
    id: 'i-805-nb-san-ysidro-merge-otay-valley',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: San Ysidro Merge to Otay Valley',
    fromName: 'San Ysidro Merge',
    toName: 'Otay Valley',
    lengthKm: 5.5,
    designSpeedMph: 60,
    polyline: [
      P(32.54935, -117.0404), P(32.55225, -117.04135), P(32.56152, -117.04226),
      P(32.56871, -117.04064), P(32.57656, -117.03882), P(32.584, -117.03709),
      P(32.59125, -117.0365), P(32.59839, -117.03648),
    ],
    areas: [
      A('San Ysidro', 32.552, -117.043),
    ],
  },
  {
    id: 'i-15-nb-sr-94-city-heights',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: SR-94 to City Heights',
    fromName: 'SR-94',
    toName: 'City Heights',
    lengthKm: 3.2,
    designSpeedMph: 55,
    polyline: [
      P(32.7174, -117.11782), P(32.72383, -117.11493), P(32.72962, -117.1116),
      P(32.73668, -117.11285), P(32.7433, -117.11068), P(32.74384, -117.11018),
    ],
    areas: [
      A('City Heights', 32.75, -117.101),
    ],
  },
  {
    id: 'i-15-sb-city-heights-sr-94',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: City Heights to SR-94',
    fromName: 'City Heights',
    toName: 'SR-94',
    lengthKm: 3.2,
    designSpeedMph: 55,
    polyline: [
      P(32.74384, -117.11018), P(32.7433, -117.11068), P(32.73668, -117.11285),
      P(32.72962, -117.1116), P(32.72383, -117.11493), P(32.7174, -117.11782),
    ],
    areas: [
      A('City Heights', 32.75, -117.101),
    ],
  },
  {
    id: 'i-15-nb-city-heights-mission-valley',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: City Heights to Mission Valley',
    fromName: 'City Heights',
    toName: 'Mission Valley',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.74405, -117.10998), P(32.75141, -117.10862), P(32.75922, -117.1087),
      P(32.76557, -117.1098), P(32.77178, -117.11252), P(32.77493, -117.11173),
    ],
    areas: [
      A('Murphy Canyon Heights', 32.81, -117.106),
      A('Mission Valley', 32.77, -117.152),
    ],
  },
  {
    id: 'i-15-sb-mission-valley-city-heights',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Mission Valley to City Heights',
    fromName: 'Mission Valley',
    toName: 'City Heights',
    lengthKm: 3.6,
    designSpeedMph: 60,
    polyline: [
      P(32.77493, -117.11173), P(32.77178, -117.11252), P(32.76557, -117.1098),
      P(32.75922, -117.1087), P(32.75141, -117.10862), P(32.74405, -117.10998),
    ],
    areas: [
      A('Murphy Canyon Heights', 32.81, -117.106),
      A('Mission Valley', 32.77, -117.152),
    ],
  },
  {
    id: 'sr-125-nb-sr-905-eastlake',
    freeway: 'SR-125',
    direction: 'northbound',
    displayName: 'SR-125 North: SR-905 to Eastlake',
    fromName: 'SR-905',
    toName: 'Eastlake',
    lengthKm: 4.5,
    designSpeedMph: 65,
    polyline: [
      P(32.55963, -116.94381), P(32.56445, -116.94872), P(32.57065, -116.95009),
      P(32.57575, -116.95611), P(32.58019, -116.96222), P(32.58662, -116.9657),
      P(32.59295, -116.96568),
    ],
    areas: [
      A('Eastlake', 32.651, -116.966),
      A('Otay Ranch', 32.621, -116.971),
    ],
  },
  {
    id: 'sr-125-sb-eastlake-sr-905',
    freeway: 'SR-125',
    direction: 'southbound',
    displayName: 'SR-125 South: Eastlake to SR-905',
    fromName: 'Eastlake',
    toName: 'SR-905',
    lengthKm: 4.5,
    designSpeedMph: 65,
    polyline: [
      P(32.59295, -116.96568), P(32.58662, -116.9657), P(32.58019, -116.96222),
      P(32.57575, -116.95611), P(32.57065, -116.95009), P(32.56445, -116.94872),
      P(32.55963, -116.94381),
    ],
    areas: [
      A('Eastlake', 32.651, -116.966),
      A('Otay Ranch', 32.621, -116.971),
    ],
  },
  {
    id: 'sr-125-nb-eastlake-san-miguel-road',
    freeway: 'SR-125',
    direction: 'northbound',
    displayName: 'SR-125 North: Eastlake to San Miguel Road',
    fromName: 'Eastlake',
    toName: 'San Miguel Road',
    lengthKm: 4.5,
    designSpeedMph: 65,
    polyline: [
      P(32.59553, -116.96486), P(32.60193, -116.96447), P(32.6091, -116.968),
      P(32.61511, -116.97113), P(32.62512, -116.9716), P(32.63162, -116.97161),
      P(32.63185, -116.97162),
    ],
    areas: [
      A('Otay River', 32.591, -117.064),
    ],
  },
  {
    id: 'sr-125-sb-san-miguel-road-eastlake',
    freeway: 'SR-125',
    direction: 'southbound',
    displayName: 'SR-125 South: San Miguel Road to Eastlake',
    fromName: 'San Miguel Road',
    toName: 'Eastlake',
    lengthKm: 4.5,
    designSpeedMph: 65,
    polyline: [
      P(32.63185, -116.97162), P(32.63162, -116.97161), P(32.62512, -116.9716),
      P(32.61511, -116.97113), P(32.6091, -116.968), P(32.60193, -116.96447),
      P(32.59553, -116.96486),
    ],
    areas: [
      A('Otay River', 32.591, -117.064),
    ],
  },
  {
    id: 'sr-125-nb-san-miguel-road-sweetwater-crossing',
    freeway: 'SR-125',
    direction: 'northbound',
    displayName: 'SR-125 North: San Miguel Road to Sweetwater Crossing',
    fromName: 'San Miguel Road',
    toName: 'Sweetwater Crossing',
    lengthKm: 10.1,
    designSpeedMph: 60,
    polyline: [
      P(32.63232, -116.97161), P(32.64565, -116.97102), P(32.6579, -116.97469),
      P(32.66738, -116.98466), P(32.67998, -116.98774), P(32.68003, -117.00172),
      P(32.68776, -117.01224), P(32.69685, -117.01326),
    ],
    areas: [
      A('Sweetwater Reservoir', 32.699, -116.984),
      A('Bonita', 32.665, -117.017),
    ],
  },
  {
    id: 'sr-125-sb-sweetwater-crossing-san-miguel-road',
    freeway: 'SR-125',
    direction: 'southbound',
    displayName: 'SR-125 South: Sweetwater Crossing to San Miguel Road',
    fromName: 'Sweetwater Crossing',
    toName: 'San Miguel Road',
    lengthKm: 10.1,
    designSpeedMph: 60,
    polyline: [
      P(32.69685, -117.01326), P(32.68776, -117.01224), P(32.68003, -117.00172),
      P(32.67998, -116.98774), P(32.66738, -116.98466), P(32.6579, -116.97469),
      P(32.64565, -116.97102), P(32.63232, -116.97161),
    ],
    areas: [
      A('Sweetwater Reservoir', 32.699, -116.984),
      A('Bonita', 32.665, -117.017),
    ],
  },
  {
    id: 'sr-125-nb-sweetwater-crossing-sr-94',
    freeway: 'SR-125',
    direction: 'northbound',
    displayName: 'SR-125 North: Sweetwater Crossing to SR-94',
    fromName: 'Sweetwater Crossing',
    toName: 'SR-94',
    lengthKm: 5.8,
    designSpeedMph: 60,
    polyline: [
      P(32.69685, -117.01326), P(32.70467, -117.01111), P(32.71222, -117.01362),
      P(32.72463, -117.01486), P(32.73476, -117.016), P(32.74227, -117.017),
      P(32.74746, -117.01847),
    ],
    areas: [
      A('Spring Valley', 39.076, -122.595),
    ],
  },
  {
    id: 'sr-125-sb-sr-94-sweetwater-crossing',
    freeway: 'SR-125',
    direction: 'southbound',
    displayName: 'SR-125 South: SR-94 to Sweetwater Crossing',
    fromName: 'SR-94',
    toName: 'Sweetwater Crossing',
    lengthKm: 5.8,
    designSpeedMph: 60,
    polyline: [
      P(32.74746, -117.01847), P(32.74227, -117.017), P(32.73476, -117.016),
      P(32.72463, -117.01486), P(32.71222, -117.01362), P(32.70467, -117.01111),
      P(32.69685, -117.01326),
    ],
    areas: [
      A('Spring Valley', 39.076, -122.595),
    ],
  },
  {
    id: 'sr-125-nb-sr-94-i-8',
    freeway: 'SR-125',
    direction: 'northbound',
    displayName: 'SR-125 North: SR-94 to I-8',
    fromName: 'SR-94',
    toName: 'I-8',
    lengthKm: 4,
    designSpeedMph: 60,
    polyline: [
      P(32.74746, -117.01847), P(32.75206, -117.01322), P(32.75694, -117.00777),
      P(32.76171, -117.00266), P(32.76809, -117.00237), P(32.77503, -117.00304),
      P(32.77752, -117.00379),
    ],
    areas: [
      A('Lemon Grove', 32.743, -117.031),
      A('La Mesa', 32.768, -117.023),
    ],
  },
  {
    id: 'sr-125-sb-i-8-sr-94',
    freeway: 'SR-125',
    direction: 'southbound',
    displayName: 'SR-125 South: I-8 to SR-94',
    fromName: 'I-8',
    toName: 'SR-94',
    lengthKm: 4,
    designSpeedMph: 60,
    polyline: [
      P(32.77752, -117.00379), P(32.77503, -117.00304), P(32.76809, -117.00237),
      P(32.76171, -117.00266), P(32.75694, -117.00777), P(32.75206, -117.01322),
      P(32.74746, -117.01847),
    ],
    areas: [
      A('Lemon Grove', 32.743, -117.031),
      A('La Mesa', 32.768, -117.023),
    ],
  },
  {
    id: 'sr-125-nb-i-8-mission-trails',
    freeway: 'SR-125',
    direction: 'northbound',
    displayName: 'SR-125 North: I-8 to Mission Trails',
    fromName: 'I-8',
    toName: 'Mission Trails',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.77752, -117.00379), P(32.78481, -117.00611), P(32.79141, -117.00651),
      P(32.79792, -117.00569), P(32.80715, -117.00568),
    ],
    areas: [
      A('Mission Trails Regional Park', 32.828, -117.052),
    ],
  },
  {
    id: 'sr-125-sb-mission-trails-i-8',
    freeway: 'SR-125',
    direction: 'southbound',
    displayName: 'SR-125 South: Mission Trails to I-8',
    fromName: 'Mission Trails',
    toName: 'I-8',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.80715, -117.00568), P(32.79792, -117.00569), P(32.79141, -117.00651),
      P(32.78481, -117.00611), P(32.77752, -117.00379),
    ],
    areas: [
      A('Mission Trails Regional Park', 32.828, -117.052),
    ],
  },
  {
    id: 'sr-125-nb-mission-trails-sr-52',
    freeway: 'SR-125',
    direction: 'northbound',
    displayName: 'SR-125 North: Mission Trails to SR-52',
    fromName: 'Mission Trails',
    toName: 'SR-52',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.8073, -117.00568), P(32.81423, -117.00236), P(32.82082, -117.00172),
      P(32.82965, -117.00342), P(32.8361, -117.00338),
    ],
    areas: [
      A('Santee', 32.838, -116.974),
    ],
  },
  {
    id: 'sr-125-sb-sr-52-mission-trails',
    freeway: 'SR-125',
    direction: 'southbound',
    displayName: 'SR-125 South: SR-52 to Mission Trails',
    fromName: 'SR-52',
    toName: 'Mission Trails',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(32.8361, -117.00338), P(32.82965, -117.00342), P(32.82082, -117.00172),
      P(32.81423, -117.00236), P(32.8073, -117.00568),
    ],
    areas: [
      A('Santee', 32.838, -116.974),
    ],
  },
  {
    id: 'sr-905-eb-san-ysidro-i-805',
    freeway: 'SR-905',
    direction: 'eastbound',
    displayName: 'SR-905 East: San Ysidro to I-805',
    fromName: 'San Ysidro',
    toName: 'I-805',
    lengthKm: 3.2,
    designSpeedMph: 60,
    polyline: [
      P(32.56517, -117.0739), P(32.56799, -117.06697), P(32.5685, -117.05871),
      P(32.56844, -117.04921), P(32.56837, -117.041),
    ],
    areas: [
      A('Tijuana River', 32.558, -117.114),
    ],
  },
  {
    id: 'sr-905-wb-i-805-san-ysidro',
    freeway: 'SR-905',
    direction: 'westbound',
    displayName: 'SR-905 West: I-805 to San Ysidro',
    fromName: 'I-805',
    toName: 'San Ysidro',
    lengthKm: 3.2,
    designSpeedMph: 60,
    polyline: [
      P(32.56837, -117.041), P(32.56844, -117.04921), P(32.5685, -117.05871),
      P(32.56799, -117.06697), P(32.56517, -117.0739),
    ],
    areas: [
      A('Tijuana River', 32.558, -117.114),
    ],
  },
  {
    id: 'sr-905-eb-i-805-brown-field',
    freeway: 'SR-905',
    direction: 'eastbound',
    displayName: 'SR-905 East: I-805 to Brown Field',
    fromName: 'I-805',
    toName: 'Brown Field',
    lengthKm: 9.3,
    designSpeedMph: 65,
    polyline: [
      P(32.56837, -117.041), P(32.56868, -117.02654), P(32.5662, -117.01233),
      P(32.56468, -116.99836), P(32.56463, -116.98418), P(32.56437, -116.96883),
      P(32.56435, -116.95403), P(32.56407, -116.94303),
    ],
    areas: [
      A('Brown Field Municipal Airport', 32.573, -116.98),
      A('Otay Mesa', 32.563, -116.988),
    ],
  },
  {
    id: 'sr-905-wb-brown-field-i-805',
    freeway: 'SR-905',
    direction: 'westbound',
    displayName: 'SR-905 West: Brown Field to I-805',
    fromName: 'Brown Field',
    toName: 'I-805',
    lengthKm: 9.3,
    designSpeedMph: 65,
    polyline: [
      P(32.56407, -116.94303), P(32.56435, -116.95403), P(32.56437, -116.96883),
      P(32.56463, -116.98418), P(32.56468, -116.99836), P(32.5662, -117.01233),
      P(32.56868, -117.02654), P(32.56837, -117.041),
    ],
    areas: [
      A('Brown Field Municipal Airport', 32.573, -116.98),
      A('Otay Mesa', 32.563, -116.988),
    ],
  },
  {
    id: 'sr-905-eb-brown-field-otay-mesa-crossing',
    freeway: 'SR-905',
    direction: 'eastbound',
    displayName: 'SR-905 East: Brown Field to Otay Mesa Crossing',
    fromName: 'Brown Field',
    toName: 'Otay Mesa Crossing',
    lengthKm: 2.7,
    designSpeedMph: 65,
    polyline: [
      P(32.56407, -116.94303), P(32.56404, -116.93199), P(32.56398, -116.9235),
      P(32.5627, -116.9157), P(32.56237, -116.91508),
    ],
    areas: [
      A('Otay Mesa Port of Entry', 32.551, -116.939),
      A('Otay Mountain', 32.594, -116.845),
    ],
  },
  {
    id: 'sr-905-wb-otay-mesa-crossing-brown-field',
    freeway: 'SR-905',
    direction: 'westbound',
    displayName: 'SR-905 West: Otay Mesa Crossing to Brown Field',
    fromName: 'Otay Mesa Crossing',
    toName: 'Brown Field',
    lengthKm: 2.7,
    designSpeedMph: 65,
    polyline: [
      P(32.56237, -116.91508), P(32.5627, -116.9157), P(32.56398, -116.9235),
      P(32.56404, -116.93199), P(32.56407, -116.94303),
    ],
    areas: [
      A('Otay Mesa Port of Entry', 32.551, -116.939),
      A('Otay Mountain', 32.594, -116.845),
    ],
  },
  {
    id: 'i-8-eb-el-cajon-granite-hills',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: El Cajon to Granite Hills',
    fromName: 'El Cajon',
    toName: 'Granite Hills',
    lengthKm: 4.6,
    designSpeedMph: 60,
    polyline: [
      P(32.80331, -116.9267), P(32.80699, -116.92031), P(32.81279, -116.91674),
      P(32.81767, -116.912), P(32.82307, -116.90813), P(32.82875, -116.9007),
      P(32.83338, -116.89504),
    ],
    areas: [
      A('Granite Hills High School', 32.798, -116.915),
      A('El Capitan High School', 32.867, -116.918),
    ],
  },
  {
    id: 'i-8-wb-granite-hills-el-cajon',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Granite Hills to El Cajon',
    fromName: 'Granite Hills',
    toName: 'El Cajon',
    lengthKm: 4.6,
    designSpeedMph: 60,
    polyline: [
      P(32.83338, -116.89504), P(32.82875, -116.9007), P(32.82307, -116.90813),
      P(32.81767, -116.912), P(32.81279, -116.91674), P(32.80699, -116.92031),
      P(32.80331, -116.9267),
    ],
    areas: [
      A('Granite Hills High School', 32.798, -116.915),
      A('El Capitan High School', 32.867, -116.918),
    ],
  },
  {
    id: 'i-8-eb-granite-hills-flinn-springs',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Granite Hills to Flinn Springs',
    fromName: 'Granite Hills',
    toName: 'Flinn Springs',
    lengthKm: 4.3,
    designSpeedMph: 60,
    polyline: [
      P(32.83391, -116.89448), P(32.84002, -116.88808), P(32.84437, -116.88262),
      P(32.84655, -116.87537), P(32.85148, -116.86964), P(32.85407, -116.86267),
      P(32.85433, -116.85875),
    ],
    areas: [
      A('Flinn Springs', 32.854, -116.853),
      A('Harbison Canyon', 32.824, -116.834),
    ],
  },
  {
    id: 'i-8-wb-flinn-springs-granite-hills',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Flinn Springs to Granite Hills',
    fromName: 'Flinn Springs',
    toName: 'Granite Hills',
    lengthKm: 4.3,
    designSpeedMph: 60,
    polyline: [
      P(32.85433, -116.85875), P(32.85407, -116.86267), P(32.85148, -116.86964),
      P(32.84655, -116.87537), P(32.84437, -116.88262), P(32.84002, -116.88808),
      P(32.83391, -116.89448),
    ],
    areas: [
      A('Flinn Springs', 32.854, -116.853),
      A('Harbison Canyon', 32.824, -116.834),
    ],
  },
  {
    id: 'i-8-eb-flinn-springs-alpine',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Flinn Springs to Alpine',
    fromName: 'Flinn Springs',
    toName: 'Alpine',
    lengthKm: 8.6,
    designSpeedMph: 60,
    polyline: [
      P(32.85375, -116.85391), P(32.85364, -116.84049), P(32.85696, -116.82438),
      P(32.85527, -116.81222), P(32.84566, -116.80267), P(32.84001, -116.78799),
      P(32.84053, -116.77546), P(32.84044, -116.77489),
    ],
    areas: [
      A('Alpine', 32.835, -116.766),
    ],
  },
  {
    id: 'i-8-wb-alpine-flinn-springs',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Alpine to Flinn Springs',
    fromName: 'Alpine',
    toName: 'Flinn Springs',
    lengthKm: 8.6,
    designSpeedMph: 60,
    polyline: [
      P(32.84044, -116.77489), P(32.84053, -116.77546), P(32.84001, -116.78799),
      P(32.84566, -116.80267), P(32.85527, -116.81222), P(32.85696, -116.82438),
      P(32.85364, -116.84049), P(32.85375, -116.85391),
    ],
    areas: [
      A('Alpine', 32.835, -116.766),
    ],
  },

];

// ------------------------------------------------------------- matching
// Local flat-projection geometry (accurate to well under a meter at
// these scales) — deliberately self-contained so this data module
// stays importable from anywhere, including the offline builder.

const M_PER_DEG_LAT = 111_320;

function toLocalM(origin: { lat: number; lng: number }, p: { lat: number; lng: number }) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return { x: (p.lng - origin.lng) * mPerDegLng, y: (p.lat - origin.lat) * M_PER_DEG_LAT };
}

function pointToSegmentM(
  pos: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): { distanceM: number; t: number } {
  const p = toLocalM(pos, pos);
  const pa = toLocalM(pos, a);
  const pb = toLocalM(pos, b);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / lenSq));
  const cx = pa.x + t * dx;
  const cy = pa.y + t * dy;
  return { distanceM: Math.hypot(p.x - cx, p.y - cy), t };
}

function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const pa = toLocalM(a, a);
  const pb = toLocalM(a, b);
  return ((Math.atan2(pb.x - pa.x, pb.y - pa.y) * 180) / Math.PI + 360) % 360;
}

function headingDeltaDeg(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export interface CorridorMatch {
  segment: CorridorSegment;
  distanceM: number;
  // The polyline point nearest the listener, and the bearing of
  // travel there — the serve layer's direction evidence.
  bearingDeg: number;
}

// The corridor segment the listener is ON, if any: inside the
// containment buffer AND (when a heading exists) travelling with
// the segment's direction. A null heading skips the direction test —
// at highway speed a missing heading is a sensor gap, not evidence
// of direction, and containment alone still separates carriageways
// by buffer on most of these freeways... except that the two
// carriageways sit well inside one buffer of each other, so a
// heading-less match is provisional by construction: the serve
// layer only acts on it at sustained highway speed, where headings
// are effectively always present.
export function matchCorridor(pos: {
  lat: number;
  lng: number;
  heading?: number | null;
}): CorridorMatch | null {
  let best: CorridorMatch | null = null;
  for (const segment of CORRIDOR_SEGMENTS) {
    for (let i = 0; i < segment.polyline.length - 1; i++) {
      const a = segment.polyline[i];
      const b = segment.polyline[i + 1];
      const { distanceM } = pointToSegmentM(pos, a, b);
      if (distanceM > CORRIDOR_BUFFER_M) continue;
      const bearing = bearingDeg(a, b);
      if (
        pos.heading !== null &&
        pos.heading !== undefined &&
        !Number.isNaN(pos.heading) &&
        headingDeltaDeg(bearing, pos.heading) > CORRIDOR_HEADING_TOLERANCE_DEG
      ) {
        continue;
      }
      if (!best || distanceM < best.distanceM) {
        best = { segment, distanceM, bearingDeg: bearing };
      }
    }
  }
  return best;
}

export interface CorridorProgress {
  // Along-track distance of the listener's nearest point on the
  // polyline, from the segment's entry (0) to its exit (lengthM);
  // grows past lengthM by overshootM once the listener has passed
  // the exit.
  alongM: number;
  lengthM: number;
  // How far PAST the segment's exit the listener has travelled,
  // measured along the exit leg's direction of travel. Zero while
  // the listener is on (or has not yet reached) the segment.
  overshootM: number;
  // Straight distance from the listener to the nearest polyline point.
  distanceM: number;
}

// Along-track progress of a position against one segment — the
// playback gate's exit test (corridor expiry, Oct 28, 2026).
// matchCorridor answers "is the driver ON this segment" at serve
// time; this answers the opposite question at story start: has the
// driver already LEFT through the far end? Pure projection in the
// module's flat local frame. Overshoot is signed along the exit
// leg's travel direction, so a listener beside the exit vertex —
// or one who has not reached it — accrues none.
export function corridorProgressM(
  segment: CorridorSegment,
  pos: { lat: number; lng: number }
): CorridorProgress {
  const pts = segment.polyline;
  let lengthM = 0;
  let best: { alongM: number; distanceM: number } | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = toLocalM(pts[0], pts[i]);
    const b = toLocalM(pts[0], pts[i + 1]);
    const legM = Math.hypot(b.x - a.x, b.y - a.y);
    const { distanceM, t } = pointToSegmentM(pos, pts[i], pts[i + 1]);
    if (!best || distanceM < best.distanceM) {
      best = { alongM: lengthM + t * legM, distanceM };
    }
    lengthM += legM;
  }
  let overshootM = 0;
  if (pts.length >= 2) {
    const exit = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const e = toLocalM(exit, exit);
    const pv = toLocalM(exit, prev);
    const p = toLocalM(exit, pos);
    const tx = e.x - pv.x;
    const ty = e.y - pv.y;
    const tLen = Math.hypot(tx, ty);
    if (tLen > 0) {
      overshootM = Math.max(0, ((p.x - e.x) * tx + (p.y - e.y) * ty) / tLen);
    }
  }
  return {
    alongM: best ? best.alongM + overshootM : 0,
    lengthM,
    overshootM,
    distanceM: best ? best.distanceM : Number.POSITIVE_INFINITY,
  };
}

// The segment that FOLLOWS a given one on the same freeway run —
// one's exit anchor is the next's entry by construction. Used by
// the serve layer's chaining telemetry (and the builder's manifest);
// the serve itself re-matches by position each cycle.
export function nextCorridorSegment(segment: CorridorSegment): CorridorSegment | null {
  return (
    CORRIDOR_SEGMENTS.find(
      s =>
        s.id !== segment.id &&
        s.freeway === segment.freeway &&
        s.direction === segment.direction &&
        s.fromName === segment.toName
    ) ?? null
  );
}

// Display names are the story_library identity for corridor rows.
export function isCorridorDisplayName(name: string): boolean {
  return CORRIDOR_SEGMENTS.some(s => s.displayName === name);
}
