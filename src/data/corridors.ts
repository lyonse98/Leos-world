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
