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
// buffer (CORRIDOR_BUFFER_M, 250m) is sized to absorb the
// approximation with margin; a GIS-grade pass can tighten the
// lines later without changing any contract here. Neighborhood
// anchors are approximate centers of the named areas, used for
// fact-pack sampling by the builder and for nothing
// safety-critical in the app.

// BANK EXTENSION (Nov 25, 2026): 66 segment-directions added so the
// 40 legacy corridor tellings have segments to seat on — SR-163
// north of Mission Valley to SR-52, I-8 east of Alpine to the
// Imperial County Line, SR-78 east of Escondido to the county line.
// Length rule (Erik's offset-segment ruling): no segment runs longer
// than ~7 minutes at design speed without a named midpoint seat, so
// a driver joining mid-stretch gets a telling framed from where
// they are. These polylines are sampled from OpenStreetMap road
// geometry at ~200 m intervals (they hug the carriageway, including
// I-8's southern swing through Carrizo Gorge and McCain Valley).
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
// this.
//
// CALIBRATION (Nov 12, 2026 — Erik's Option A ruling after the
// Harbor Drive field note): tightened 450 → 250 m. At 450, ≈62% of
// a Harbor Drive drive (NBSD → airport) fell inside a northbound
// I-5 segment's buffer (the roads parallel at 176–250 m) and an
// I-5 story served on Harbor Drive. The calibration sim
// (scripts/route-mode/corridor-buffer-sim.mjs) evaluated
// 450/300/250/200 against the real geometry: a buffer must absorb
// the worst-case lateral error of a driver who IS on the freeway —
// hand-laid chord bulge on the longest curve legs (~200 m by the
// bulge stress test) plus GPS and lane position. At 200 m that
// worst case collapses (bulge-200 retention 98% → 49%); at 250 m
// every tested case — lateral offsets to 200 m, chord bulges to
// 200 m, stack-zone legs included — retains exactly as at 450,
// while the Harbor overlap falls by roughly half. Surface streets
// paralleling beyond ~250 m (Harbor Drive's sustained approach,
// Mission Bay Drive past the I-5's east shore) fall outside, as
// they should — their narration is the street pipeline's.
export const CORRIDOR_BUFFER_M = 250;

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
  // Densified Nov 14, 2026 (corridor fixes 1+2): the four SR-163
  // legs were 3–4 points over 3–4.1 km — chords up to 1.9 km that
  // cut the Balboa Park / canyon bends by ~180 m, inside striking
  // distance of the 250 m buffer once a driver's own lateral error
  // is added. Points now run every ~190 m along the road's path;
  // endpoints are unchanged (segment chaining keys on them) and
  // the northbound legs are the exact reverses, as before.
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
      P(32.781, -117.168), P(32.77946, -117.16708), P(32.7779, -117.16613),
      P(32.77632, -117.1652), P(32.77471, -117.16436), P(32.77309, -117.16354),
      P(32.77148, -117.16272), P(32.7699, -117.1619), P(32.76829, -117.16115),
      P(32.76666, -117.16045), P(32.76504, -117.15977), P(32.76343, -117.15903),
      P(32.76183, -117.15831), P(32.7602, -117.1576), P(32.75858, -117.15692),
      P(32.75729, -117.15646), P(32.756, -117.156),
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
      P(32.756, -117.156), P(32.75433, -117.15534), P(32.75276, -117.15452),
      P(32.75126, -117.15354), P(32.74976, -117.15245), P(32.74821, -117.15156),
      P(32.74654, -117.15099), P(32.74482, -117.15075), P(32.74307, -117.15054),
      P(32.74136, -117.15062), P(32.73969, -117.15104), P(32.73796, -117.15115),
      P(32.73621, -117.15128), P(32.73445, -117.15143), P(32.73274, -117.15157),
      P(32.73103, -117.15177), P(32.7293, -117.15225), P(32.72771, -117.15301),
      P(32.72619, -117.15403), P(32.7248, -117.15526), P(32.72345, -117.15655),
      P(32.72222, -117.15728), P(32.721, -117.158),
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
      P(32.721, -117.158), P(32.72222, -117.15728), P(32.72345, -117.15655),
      P(32.7248, -117.15526), P(32.72619, -117.15403), P(32.72771, -117.15301),
      P(32.7293, -117.15225), P(32.73103, -117.15177), P(32.73274, -117.15157),
      P(32.73445, -117.15143), P(32.73621, -117.15128), P(32.73796, -117.15115),
      P(32.73969, -117.15104), P(32.74136, -117.15062), P(32.74307, -117.15054),
      P(32.74482, -117.15075), P(32.74654, -117.15099), P(32.74821, -117.15156),
      P(32.74976, -117.15245), P(32.75126, -117.15354), P(32.75276, -117.15452),
      P(32.75433, -117.15534), P(32.756, -117.156),
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
      P(32.756, -117.156), P(32.75729, -117.15646), P(32.75858, -117.15692),
      P(32.7602, -117.1576), P(32.76183, -117.15831), P(32.76343, -117.15903),
      P(32.76504, -117.15977), P(32.76666, -117.16045), P(32.76829, -117.16115),
      P(32.7699, -117.1619), P(32.77148, -117.16272), P(32.77309, -117.16354),
      P(32.77471, -117.16436), P(32.77632, -117.1652), P(32.7779, -117.16613),
      P(32.77946, -117.16708), P(32.781, -117.168),
    ],
    areas: [
      A('Hillcrest', 32.75, -117.155),
      A('Mission Valley', 32.775, -117.16),
    ],
  },
  {
    id: 'sr-163-nb-mission-valley-kearny-mesa',
    freeway: 'SR-163',
    direction: 'northbound',
    displayName: 'SR-163 North: Mission Valley to Kearny Mesa',
    fromName: 'Mission Valley',
    toName: 'Kearny Mesa',
    lengthKm: 3.86,
    designSpeedMph: 50,
    polyline: [
      P(32.78100, -117.16800), P(32.78241, -117.16252), P(32.78414, -117.16191),
      P(32.78586, -117.16131), P(32.78759, -117.16070), P(32.78931, -117.16007),
      P(32.79102, -117.15941), P(32.79274, -117.15881), P(32.79447, -117.15823),
      P(32.79619, -117.15760), P(32.79791, -117.15695), P(32.79962, -117.15630),
      P(32.80133, -117.15564), P(32.80306, -117.15503), P(32.80479, -117.15444),
      P(32.80651, -117.15384), P(32.80822, -117.15317), P(32.80994, -117.15253),
      P(32.81167, -117.15194), P(32.81386, -117.15109),
    ],
    areas: [
      A('Mission Valley', 32.772, -117.16),
      A('Serra Mesa', 32.802, -117.156),
      A('Kearny Mesa', 32.811, -117.138),
    ],
  },
  {
    id: 'sr-163-nb-kearny-mesa-sr-52',
    freeway: 'SR-163',
    direction: 'northbound',
    displayName: 'SR-163 North: Kearny Mesa to SR-52',
    fromName: 'Kearny Mesa',
    toName: 'SR-52',
    lengthKm: 2.85,
    designSpeedMph: 50,
    polyline: [
      P(32.81386, -117.15109), P(32.81552, -117.15027), P(32.81716, -117.14938),
      P(32.81879, -117.14848), P(32.82041, -117.14757), P(32.82204, -117.14664),
      P(32.82368, -117.14578), P(32.82533, -117.14492), P(32.82696, -117.14402),
      P(32.82860, -117.14312), P(32.83023, -117.14224), P(32.83186, -117.14133),
      P(32.83345, -117.14032), P(32.83496, -117.13917), P(32.83675, -117.13763),
    ],
    areas: [
      A('Kearny Mesa', 32.811, -117.138),
      A('Serra Mesa', 32.802, -117.156),
      A('Clairemont Mesa', 32.834, -117.139),
    ],
  },
  {
    id: 'sr-163-sb-sr-52-kearny-mesa',
    freeway: 'SR-163',
    direction: 'southbound',
    displayName: 'SR-163 South: SR-52 to Kearny Mesa',
    fromName: 'SR-52',
    toName: 'Kearny Mesa',
    lengthKm: 2.85,
    designSpeedMph: 50,
    polyline: [
      P(32.83675, -117.13763), P(32.83496, -117.13917), P(32.83345, -117.14032),
      P(32.83186, -117.14133), P(32.83023, -117.14224), P(32.82860, -117.14312),
      P(32.82696, -117.14402), P(32.82533, -117.14492), P(32.82368, -117.14578),
      P(32.82204, -117.14664), P(32.82041, -117.14757), P(32.81879, -117.14848),
      P(32.81716, -117.14938), P(32.81552, -117.15027), P(32.81386, -117.15109),
    ],
    areas: [
      A('Kearny Mesa', 32.811, -117.138),
      A('Clairemont Mesa', 32.834, -117.139),
      A('Serra Mesa', 32.802, -117.156),
    ],
  },
  {
    id: 'sr-163-sb-kearny-mesa-mission-valley',
    freeway: 'SR-163',
    direction: 'southbound',
    displayName: 'SR-163 South: Kearny Mesa to Mission Valley',
    fromName: 'Kearny Mesa',
    toName: 'Mission Valley',
    lengthKm: 3.86,
    designSpeedMph: 50,
    polyline: [
      P(32.81386, -117.15109), P(32.81167, -117.15194), P(32.80994, -117.15253),
      P(32.80822, -117.15317), P(32.80651, -117.15384), P(32.80479, -117.15444),
      P(32.80306, -117.15503), P(32.80133, -117.15564), P(32.79962, -117.15630),
      P(32.79791, -117.15695), P(32.79619, -117.15760), P(32.79447, -117.15823),
      P(32.79274, -117.15881), P(32.79102, -117.15941), P(32.78931, -117.16007),
      P(32.78759, -117.16070), P(32.78586, -117.16131), P(32.78414, -117.16191),
      P(32.78241, -117.16252), P(32.78100, -117.16800),
    ],
    areas: [
      A('Kearny Mesa', 32.811, -117.138),
      A('Serra Mesa', 32.802, -117.156),
      A('Clairemont Mesa', 32.834, -117.139),
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
  {
    id: 'sr-78-ea-escondido-safari-park',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Escondido to Safari Park',
    fromName: 'Escondido',
    toName: 'Safari Park',
    lengthKm: 8,
    designSpeedMph: 50,
    polyline: [
      P(33.13290, -117.08645), P(33.13121, -117.08572), P(33.12952, -117.08498),
      P(33.12783, -117.08424), P(33.12727, -117.08287), P(33.12789, -117.08085),
      P(33.12852, -117.07884), P(33.12915, -117.07683), P(33.12978, -117.07482),
      P(33.13039, -117.07280), P(33.13133, -117.07098), P(33.13238, -117.06923),
      P(33.13262, -117.06779), P(33.13091, -117.06717), P(33.12924, -117.06636),
      P(33.12754, -117.06569), P(33.12591, -117.06480), P(33.12457, -117.06336),
      P(33.12313, -117.06208), P(33.12156, -117.06109), P(33.11976, -117.06103),
      P(33.11798, -117.06086), P(33.11654, -117.05957), P(33.11514, -117.05822),
      P(33.11359, -117.05720), P(33.11185, -117.05664), P(33.11041, -117.05539),
      P(33.10937, -117.05371), P(33.10957, -117.05159), P(33.10916, -117.04950),
      P(33.10867, -117.04744), P(33.10774, -117.04560), P(33.10654, -117.04401),
      P(33.10542, -117.04233), P(33.10446, -117.04052), P(33.10367, -117.03859),
      P(33.10284, -117.03669), P(33.10207, -117.03475), P(33.10132, -117.03280),
      P(33.10046, -117.03093), P(33.09932, -117.02929),
    ],
    areas: [
      A('Escondido', 33.119, -117.087),
      A('San Pasqual', 33.093, -117),
      A('Safari Park', 33.099, -117.009),
    ],
  },
  {
    id: 'sr-78-ea-safari-park-san-pasqual',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Safari Park to San Pasqual',
    fromName: 'Safari Park',
    toName: 'San Pasqual',
    lengthKm: 2.4,
    designSpeedMph: 50,
    polyline: [
      P(33.09932, -117.02929), P(33.09851, -117.02738), P(33.09765, -117.02549),
      P(33.09697, -117.02352), P(33.09745, -117.02150), P(33.09845, -117.01973),
      P(33.09887, -117.01767), P(33.09890, -117.01553), P(33.09815, -117.01363),
      P(33.09671, -117.01234), P(33.09600, -117.01042), P(33.09578, -117.00830),
      P(33.09553, -117.00617),
    ],
    areas: [
      A('Safari Park', 33.099, -117.009),
      A('San Pasqual', 33.093, -117),
      A('Escondido', 33.119, -117.087),
    ],
  },
  {
    id: 'sr-78-ea-san-pasqual-bandy-canyon',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: San Pasqual to Bandy Canyon',
    fromName: 'San Pasqual',
    toName: 'Bandy Canyon',
    lengthKm: 3.6,
    designSpeedMph: 45,
    polyline: [
      P(33.09553, -117.00617), P(33.09492, -117.00415), P(33.09420, -117.00218),
      P(33.09350, -117.00021), P(33.09280, -116.99823), P(33.09210, -116.99625),
      P(33.09135, -116.99430), P(33.09018, -116.99268), P(33.08861, -116.99175),
      P(33.08687, -116.99124), P(33.08584, -116.98964), P(33.08634, -116.98764),
      P(33.08716, -116.98574), P(33.08790, -116.98377), P(33.08854, -116.98178),
      P(33.08893, -116.97970), P(33.08948, -116.97765), P(33.09003, -116.97561),
      P(33.09061, -116.97358),
    ],
    areas: [
      A('San Pasqual', 33.093, -117),
      A('Safari Park', 33.099, -117.009),
      A('Bandy Canyon', 33.091, -116.972),
    ],
  },
  {
    id: 'sr-78-ea-bandy-canyon-highland-valley',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Bandy Canyon to Highland Valley',
    fromName: 'Bandy Canyon',
    toName: 'Highland Valley',
    lengthKm: 4,
    designSpeedMph: 45,
    polyline: [
      P(33.09061, -116.97358), P(33.09117, -116.97154), P(33.09153, -116.96944),
      P(33.09215, -116.96743), P(33.09282, -116.96544), P(33.09351, -116.96349),
      P(33.09454, -116.96173), P(33.09476, -116.95963), P(33.09450, -116.95751),
      P(33.09348, -116.95578), P(33.09202, -116.95451), P(33.09089, -116.95288),
      P(33.09058, -116.95079), P(33.09058, -116.94864), P(33.09060, -116.94649),
      P(33.09063, -116.94435), P(33.09128, -116.94237), P(33.09115, -116.94028),
      P(33.09047, -116.93830), P(33.08887, -116.93752), P(33.08718, -116.93687),
    ],
    areas: [
      A('Bandy Canyon', 33.091, -116.972),
      A('San Pasqual', 33.093, -117),
      A('Highland Valley', 33.087, -116.937),
    ],
  },
  {
    id: 'sr-78-ea-highland-valley-ramona',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Highland Valley to Ramona',
    fromName: 'Highland Valley',
    toName: 'Ramona',
    lengthKm: 10.3,
    designSpeedMph: 55,
    polyline: [
      P(33.08718, -116.93687), P(33.08612, -116.93517), P(33.08573, -116.93308),
      P(33.08596, -116.93096), P(33.08737, -116.92981), P(33.08689, -116.92779),
      P(33.08603, -116.92594), P(33.08579, -116.92393), P(33.08540, -116.92219),
      P(33.08382, -116.92126), P(33.08284, -116.92005), P(33.08255, -116.91795),
      P(33.08364, -116.91665), P(33.08502, -116.91542), P(33.08557, -116.91355),
      P(33.08535, -116.91143), P(33.08646, -116.90984), P(33.08692, -116.90806),
      P(33.08649, -116.90607), P(33.08706, -116.90417), P(33.08543, -116.90369),
      P(33.08364, -116.90379), P(33.08184, -116.90382), P(33.08010, -116.90350),
      P(33.07842, -116.90306), P(33.07665, -116.90313), P(33.07488, -116.90281),
      P(33.07310, -116.90262), P(33.07222, -116.90097), P(33.07163, -116.89897),
      P(33.07106, -116.89695), P(33.07026, -116.89505), P(33.07000, -116.89293),
      P(33.06949, -116.89092), P(33.06951, -116.88877), P(33.06964, -116.88666),
      P(33.07015, -116.88468), P(33.06900, -116.88304), P(33.06780, -116.88145),
      P(33.06687, -116.87962), P(33.06581, -116.87792), P(33.06580, -116.87578),
      P(33.06566, -116.87365), P(33.06456, -116.87202), P(33.06282, -116.87160),
      P(33.06102, -116.87156), P(33.05922, -116.87153), P(33.05742, -116.87148),
      P(33.05563, -116.87143), P(33.05383, -116.87138), P(33.05203, -116.87132),
      P(33.05023, -116.87125), P(33.04933, -116.87121),
    ],
    areas: [
      A('Highland Valley', 33.087, -116.937),
      A('Bandy Canyon', 33.091, -116.972),
      A('Ramona', 33.042, -116.879),
    ],
  },
  {
    id: 'sr-78-ea-ramona-ramona-east',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Through Ramona',
    fromName: 'Ramona',
    toName: 'Ramona East',
    lengthKm: 2.3,
    designSpeedMph: 35,
    polyline: [
      P(33.04933, -116.87121), P(33.04754, -116.87113), P(33.04574, -116.87099),
      P(33.04410, -116.87014), P(33.04257, -116.86901), P(33.04267, -116.86743),
      P(33.04364, -116.86562), P(33.04463, -116.86382), P(33.04562, -116.86203),
      P(33.04661, -116.86024), P(33.04764, -116.85849), P(33.04892, -116.85698),
      P(33.04947, -116.85613),
    ],
    areas: [
      A('Ramona', 33.042, -116.879),
      A('Highland Valley', 33.087, -116.937),
      A('Ballena', 33.06, -116.815),
    ],
  },
  {
    id: 'sr-78-ea-ramona-east-ballena',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Ramona East to Ballena',
    fromName: 'Ramona East',
    toName: 'Ballena',
    lengthKm: 4.9,
    designSpeedMph: 50,
    polyline: [
      P(33.04947, -116.85613), P(33.05049, -116.85437), P(33.05109, -116.85236),
      P(33.05116, -116.85022), P(33.05115, -116.84807), P(33.05115, -116.84592),
      P(33.05114, -116.84378), P(33.05113, -116.84163), P(33.05105, -116.83949),
      P(33.04977, -116.83806), P(33.04887, -116.83627), P(33.04808, -116.83434),
      P(33.04661, -116.83319), P(33.04642, -116.83109), P(33.04648, -116.82895),
      P(33.04675, -116.82683), P(33.04723, -116.82478), P(33.04822, -116.82298),
      P(33.04905, -116.82108), P(33.05050, -116.81997), P(33.05230, -116.82005),
      P(33.05408, -116.82035), P(33.05574, -116.81985), P(33.05689, -116.81821),
      P(33.05829, -116.81686), P(33.05902, -116.81624),
    ],
    areas: [
      A('Ramona', 33.042, -116.879),
      A('Ballena', 33.06, -116.815),
      A('Witch Creek', 33.065, -116.751),
    ],
  },
  {
    id: 'sr-78-ea-ballena-witch-creek',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Ballena to Witch Creek',
    fromName: 'Ballena',
    toName: 'Witch Creek',
    lengthKm: 8.5,
    designSpeedMph: 50,
    polyline: [
      P(33.05902, -116.81624), P(33.05995, -116.81446), P(33.06153, -116.81345),
      P(33.06309, -116.81245), P(33.06451, -116.81135), P(33.06567, -116.80980),
      P(33.06723, -116.80927), P(33.06838, -116.80772), P(33.06986, -116.80652),
      P(33.07142, -116.80551), P(33.07287, -116.80427), P(33.07429, -116.80297),
      P(33.07546, -116.80144), P(33.07638, -116.79962), P(33.07776, -116.79834),
      P(33.07925, -116.79715), P(33.08082, -116.79611), P(33.08240, -116.79508),
      P(33.08388, -116.79387), P(33.08536, -116.79283), P(33.08536, -116.79084),
      P(33.08442, -116.78903), P(33.08348, -116.78724), P(33.08241, -116.78580),
      P(33.08106, -116.78455), P(33.07972, -116.78315), P(33.07918, -116.78119),
      P(33.07875, -116.77912), P(33.07808, -116.77714), P(33.07702, -116.77541),
      P(33.07606, -116.77360), P(33.07520, -116.77171), P(33.07401, -116.77014),
      P(33.07270, -116.76867), P(33.07147, -116.76712), P(33.07076, -116.76516),
      P(33.06966, -116.76347), P(33.06839, -116.76196), P(33.06683, -116.76094),
      P(33.06571, -116.75939), P(33.06537, -116.75731), P(33.06537, -116.75516),
      P(33.06538, -116.75302), P(33.06538, -116.75195),
    ],
    areas: [
      A('Ballena', 33.06, -116.815),
      A('Ramona', 33.042, -116.879),
      A('Witch Creek', 33.065, -116.751),
    ],
  },
  {
    id: 'sr-78-ea-witch-creek-mesa-grande',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Witch Creek to Mesa Grande',
    fromName: 'Witch Creek',
    toName: 'Mesa Grande',
    lengthKm: 4,
    designSpeedMph: 50,
    polyline: [
      P(33.06538, -116.75195), P(33.06539, -116.74980), P(33.06540, -116.74765),
      P(33.06585, -116.74562), P(33.06664, -116.74369), P(33.06736, -116.74173),
      P(33.06761, -116.73962), P(33.06739, -116.73750), P(33.06686, -116.73546),
      P(33.06704, -116.73333), P(33.06735, -116.73122), P(33.06752, -116.72909),
      P(33.06713, -116.72700), P(33.06614, -116.72522), P(33.06596, -116.72332),
      P(33.06745, -116.72217), P(33.06905, -116.72121), P(33.07054, -116.72003),
      P(33.07223, -116.71935), P(33.07398, -116.71889), P(33.07572, -116.71832),
    ],
    areas: [
      A('Witch Creek', 33.065, -116.751),
      A('Ballena', 33.06, -116.815),
      A('Mesa Grande', 33.076, -116.718),
    ],
  },
  {
    id: 'sr-78-ea-mesa-grande-santa-ysabel',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Mesa Grande to Santa Ysabel',
    fromName: 'Mesa Grande',
    toName: 'Santa Ysabel',
    lengthKm: 5.95,
    designSpeedMph: 50,
    polyline: [
      P(33.07572, -116.71832), P(33.07737, -116.71750), P(33.07895, -116.71648),
      P(33.08049, -116.71537), P(33.08194, -116.71412), P(33.08299, -116.71238),
      P(33.08412, -116.71073), P(33.08541, -116.70923), P(33.08675, -116.70781),
      P(33.08814, -116.70648), P(33.08987, -116.70594), P(33.09118, -116.70460),
      P(33.09249, -116.70317), P(33.09386, -116.70182), P(33.09548, -116.70088),
      P(33.09709, -116.69996), P(33.09860, -116.69879), P(33.10002, -116.69748),
      P(33.10141, -116.69612), P(33.10271, -116.69464), P(33.10380, -116.69294),
      P(33.10476, -116.69113), P(33.10506, -116.68902), P(33.10540, -116.68693),
      P(33.10599, -116.68490), P(33.10657, -116.68287), P(33.10716, -116.68084),
      P(33.10776, -116.67881), P(33.10835, -116.67679), P(33.10896, -116.67476),
      P(33.10940, -116.67324),
    ],
    areas: [
      A('Mesa Grande', 33.076, -116.718),
      A('Witch Creek', 33.065, -116.751),
      A('Santa Ysabel', 33.109, -116.673),
    ],
  },
  {
    id: 'sr-78-ea-santa-ysabel-wynola',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Santa Ysabel to Wynola',
    fromName: 'Santa Ysabel',
    toName: 'Wynola',
    lengthKm: 5.88,
    designSpeedMph: 45,
    polyline: [
      P(33.10940, -116.67324), P(33.10995, -116.67120), P(33.10939, -116.66927),
      P(33.10775, -116.66842), P(33.10601, -116.66802), P(33.10423, -116.66825),
      P(33.10263, -116.66733), P(33.10100, -116.66642), P(33.09940, -116.66544),
      P(33.09860, -116.66381), P(33.10019, -116.66291), P(33.10175, -116.66191),
      P(33.10280, -116.66017), P(33.10430, -116.65906), P(33.10610, -116.65898),
      P(33.10746, -116.65793), P(33.10645, -116.65637), P(33.10547, -116.65467),
      P(33.10401, -116.65345), P(33.10243, -116.65262), P(33.10181, -116.65060),
      P(33.10052, -116.64932), P(33.09889, -116.64851), P(33.09782, -116.64678),
      P(33.09626, -116.64606), P(33.09446, -116.64606), P(33.09266, -116.64609),
      P(33.09087, -116.64608), P(33.08907, -116.64608), P(33.08727, -116.64611),
      P(33.08655, -116.64611),
    ],
    areas: [
      A('Santa Ysabel', 33.109, -116.673),
      A('Mesa Grande', 33.076, -116.718),
      A('Wynola', 33.087, -116.641),
    ],
  },
  {
    id: 'sr-78-ea-wynola-julian',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Wynola to Julian',
    fromName: 'Wynola',
    toName: 'Julian',
    lengthKm: 5.88,
    designSpeedMph: 45,
    polyline: [
      P(33.08655, -116.64611), P(33.08475, -116.64611), P(33.08296, -116.64603),
      P(33.08133, -116.64517), P(33.08030, -116.64345), P(33.08020, -116.64134),
      P(33.08077, -116.63933), P(33.07993, -116.63755), P(33.07993, -116.63547),
      P(33.07929, -116.63351), P(33.07880, -116.63145), P(33.07843, -116.62935),
      P(33.07798, -116.62727), P(33.07789, -116.62514), P(33.07796, -116.62299),
      P(33.07816, -116.62086), P(33.07819, -116.61872), P(33.07813, -116.61658),
      P(33.07793, -116.61445), P(33.07784, -116.61231), P(33.07783, -116.61027),
      P(33.07689, -116.60864), P(33.07666, -116.60652), P(33.07698, -116.60444),
      P(33.07816, -116.60283), P(33.07776, -116.60128), P(33.07661, -116.59963),
      P(33.07646, -116.59752), P(33.07650, -116.59537), P(33.07653, -116.59322),
      P(33.07654, -116.59236),
    ],
    areas: [
      A('Wynola', 33.087, -116.641),
      A('Santa Ysabel', 33.109, -116.673),
      A('Julian', 33.076, -116.592),
    ],
  },
  {
    id: 'sr-78-ea-julian-kentwood',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Julian to Kentwood',
    fromName: 'Julian',
    toName: 'Kentwood',
    lengthKm: 7.82,
    designSpeedMph: 45,
    polyline: [
      P(33.07654, -116.59236), P(33.07692, -116.59034), P(33.07862, -116.58988),
      P(33.08029, -116.58922), P(33.08203, -116.58927), P(33.08368, -116.58999),
      P(33.08540, -116.59056), P(33.08684, -116.59174), P(33.08804, -116.59276),
      P(33.08861, -116.59465), P(33.09019, -116.59549), P(33.09152, -116.59679),
      P(33.09299, -116.59567), P(33.09459, -116.59487), P(33.09621, -116.59401),
      P(33.09770, -116.59332), P(33.09702, -116.59137), P(33.09594, -116.58966),
      P(33.09549, -116.58790), P(33.09444, -116.58643), P(33.09384, -116.58445),
      P(33.09262, -116.58292), P(33.09154, -116.58157), P(33.09040, -116.57998),
      P(33.08886, -116.57910), P(33.08752, -116.57773), P(33.08660, -116.57596),
      P(33.08533, -116.57467), P(33.08409, -116.57437), P(33.08360, -116.57233),
      P(33.08198, -116.57194), P(33.08037, -116.57232), P(33.08048, -116.57022),
      P(33.08055, -116.56856), P(33.07952, -116.56697), P(33.07828, -116.56552),
      P(33.07677, -116.56465), P(33.07661, -116.56257), P(33.07519, -116.56139),
      P(33.07431, -116.55972),
    ],
    areas: [
      A('Julian', 33.076, -116.592),
      A('Wynola', 33.087, -116.641),
      A('Kentwood', 33.07, -116.563),
    ],
  },
  {
    id: 'sr-78-ea-kentwood-banner',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Kentwood to Banner',
    fromName: 'Kentwood',
    toName: 'Banner',
    lengthKm: 2.21,
    designSpeedMph: 40,
    polyline: [
      P(33.07431, -116.55972), P(33.07391, -116.55827), P(33.07298, -116.55669),
      P(33.07212, -116.55527), P(33.07113, -116.55379), P(33.07028, -116.55207),
      P(33.06899, -116.55290), P(33.06744, -116.55365), P(33.06666, -116.55294),
      P(33.06806, -116.55170), P(33.06812, -116.54962), P(33.06733, -116.54783),
    ],
    areas: [
      A('Kentwood', 33.07, -116.563),
      A('Julian', 33.076, -116.592),
      A('Banner', 33.067, -116.548),
    ],
  },
  {
    id: 'sr-78-ea-banner-san-felipe-valley',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Banner to San Felipe Valley',
    fromName: 'Banner',
    toName: 'San Felipe Valley',
    lengthKm: 4.98,
    designSpeedMph: 45,
    polyline: [
      P(33.06733, -116.54783), P(33.06883, -116.54669), P(33.07009, -116.54515),
      P(33.07085, -116.54337), P(33.07174, -116.54155), P(33.07263, -116.53969),
      P(33.07386, -116.53817), P(33.07492, -116.53644), P(33.07597, -116.53469),
      P(33.07738, -116.53337), P(33.07846, -116.53171), P(33.07910, -116.52970),
      P(33.07973, -116.52769), P(33.08037, -116.52568), P(33.08101, -116.52367),
      P(33.08165, -116.52167), P(33.08228, -116.51966), P(33.08293, -116.51766),
      P(33.08356, -116.51565), P(33.08420, -116.51364), P(33.08484, -116.51163),
      P(33.08548, -116.50963), P(33.08611, -116.50762), P(33.08675, -116.50561),
      P(33.08739, -116.50360), P(33.08796, -116.50180),
    ],
    areas: [
      A('Banner', 33.067, -116.548),
      A('Kentwood', 33.07, -116.563),
      A('San Felipe Valley', 33.076, -116.496),
    ],
  },
  {
    id: 'sr-78-ea-san-felipe-valley-scissors-crossing',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: San Felipe Valley to Scissors Crossing',
    fromName: 'San Felipe Valley',
    toName: 'Scissors Crossing',
    lengthKm: 3.44,
    designSpeedMph: 50,
    polyline: [
      P(33.08796, -116.50180), P(33.08860, -116.49979), P(33.08924, -116.49778),
      P(33.08988, -116.49578), P(33.09052, -116.49377), P(33.09116, -116.49176),
      P(33.09179, -116.48976), P(33.09244, -116.48775), P(33.09309, -116.48575),
      P(33.09372, -116.48374), P(33.09434, -116.48172), P(33.09503, -116.47974),
      P(33.09579, -116.47780), P(33.09656, -116.47586), P(33.09733, -116.47392),
      P(33.09810, -116.47198), P(33.09887, -116.47003), P(33.09970, -116.46766),
    ],
    areas: [
      A('San Felipe Valley', 33.076, -116.496),
      A('Banner', 33.067, -116.548),
      A('Scissors Crossing', 33.1, -116.468),
    ],
  },
  {
    id: 'sr-78-ea-scissors-crossing-sentenac',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Scissors Crossing to Sentenac',
    fromName: 'Scissors Crossing',
    toName: 'Sentenac',
    lengthKm: 10.17,
    designSpeedMph: 55,
    polyline: [
      P(33.09970, -116.46766), P(33.10000, -116.46555), P(33.10021, -116.46341),
      P(33.10042, -116.46128), P(33.10071, -116.45917), P(33.10155, -116.45727),
      P(33.10243, -116.45540), P(33.10348, -116.45371), P(33.10481, -116.45231),
      P(33.10607, -116.45085), P(33.10785, -116.45077), P(33.10898, -116.44918),
      P(33.11067, -116.44897), P(33.11117, -116.44695), P(33.11256, -116.44573),
      P(33.11365, -116.44415), P(33.11485, -116.44258), P(33.11534, -116.44057),
      P(33.11616, -116.43867), P(33.11736, -116.43708), P(33.11861, -116.43553),
      P(33.12001, -116.43422), P(33.12157, -116.43497), P(33.12322, -116.43548),
      P(33.12495, -116.43564), P(33.12662, -116.43523), P(33.12817, -116.43461),
      P(33.12892, -116.43296), P(33.12911, -116.43088), P(33.12841, -116.42892),
      P(33.12847, -116.42679), P(33.12879, -116.42468), P(33.12912, -116.42257),
      P(33.12949, -116.42046), P(33.12985, -116.41836), P(33.13013, -116.41624),
      P(33.13073, -116.41423), P(33.13109, -116.41214), P(33.13129, -116.41001),
      P(33.13119, -116.40787), P(33.13107, -116.40572), P(33.13137, -116.40363),
      P(33.13213, -116.40170), P(33.13197, -116.39957), P(33.13208, -116.39743),
      P(33.13232, -116.39531), P(33.13297, -116.39331), P(33.13380, -116.39141),
      P(33.13459, -116.38948), P(33.13510, -116.38745), P(33.13505, -116.38533),
      P(33.13466, -116.38357),
    ],
    areas: [
      A('Scissors Crossing', 33.1, -116.468),
      A('San Felipe Valley', 33.076, -116.496),
      A('Sentenac', 33.122, -116.385),
    ],
  },
  {
    id: 'sr-78-ea-sentenac-yaqui-pass',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Sentenac to Yaqui Pass',
    fromName: 'Sentenac',
    toName: 'Yaqui Pass',
    lengthKm: 7.86,
    designSpeedMph: 50,
    polyline: [
      P(33.13466, -116.38357), P(33.13509, -116.38151), P(33.13569, -116.37951),
      P(33.13608, -116.37743), P(33.13694, -116.37555), P(33.13662, -116.37350),
      P(33.13625, -116.37140), P(33.13574, -116.36934), P(33.13497, -116.36741),
      P(33.13421, -116.36547), P(33.13399, -116.36335), P(33.13425, -116.36123),
      P(33.13462, -116.35913), P(33.13501, -116.35703), P(33.13539, -116.35493),
      P(33.13550, -116.35280), P(33.13523, -116.35068), P(33.13495, -116.34856),
      P(33.13466, -116.34644), P(33.13438, -116.34432), P(33.13410, -116.34220),
      P(33.13382, -116.34007), P(33.13353, -116.33795), P(33.13324, -116.33583),
      P(33.13296, -116.33371), P(33.13281, -116.33157), P(33.13286, -116.32943),
      P(33.13291, -116.32728), P(33.13296, -116.32513), P(33.13303, -116.32299),
      P(33.13309, -116.32084), P(33.13316, -116.31869), P(33.13324, -116.31655),
      P(33.13334, -116.31440), P(33.13264, -116.31251), P(33.13193, -116.31056),
      P(33.13148, -116.30848), P(33.13113, -116.30638), P(33.13098, -116.30424),
      P(33.13086, -116.30146),
    ],
    areas: [
      A('Sentenac', 33.122, -116.385),
      A('Scissors Crossing', 33.1, -116.468),
      A('Yaqui Pass', 33.131, -116.302),
    ],
  },
  {
    id: 'sr-78-ea-yaqui-pass-badlands',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Yaqui Pass to Badlands',
    fromName: 'Yaqui Pass',
    toName: 'Badlands',
    lengthKm: 9.26,
    designSpeedMph: 55,
    polyline: [
      P(33.13086, -116.30146), P(33.13206, -116.29999), P(33.13384, -116.30012),
      P(33.13528, -116.29913), P(33.13590, -116.29718), P(33.13706, -116.29554),
      P(33.13817, -116.29385), P(33.13908, -116.29202), P(33.13946, -116.28993),
      P(33.14001, -116.28788), P(33.14055, -116.28583), P(33.14110, -116.28379),
      P(33.14164, -116.28174), P(33.14219, -116.27969), P(33.14273, -116.27765),
      P(33.14327, -116.27560), P(33.14308, -116.27353), P(33.14261, -116.27147),
      P(33.14295, -116.26938), P(33.14398, -116.26763), P(33.14510, -116.26594),
      P(33.14621, -116.26425), P(33.14732, -116.26257), P(33.14844, -116.26088),
      P(33.14955, -116.25919), P(33.15066, -116.25750), P(33.15165, -116.25571),
      P(33.15264, -116.25392), P(33.15363, -116.25212), P(33.15462, -116.25033),
      P(33.15561, -116.24854), P(33.15655, -116.24671), P(33.15728, -116.24474),
      P(33.15787, -116.24271), P(33.15844, -116.24068), P(33.15881, -116.23858),
      P(33.15893, -116.23644), P(33.15904, -116.23429), P(33.15915, -116.23215),
      P(33.15926, -116.23000), P(33.15937, -116.22786), P(33.15947, -116.22571),
      P(33.15947, -116.22357), P(33.15924, -116.22144), P(33.15900, -116.21931),
      P(33.15877, -116.21718), P(33.15846, -116.21441),
    ],
    areas: [
      A('Yaqui Pass', 33.131, -116.302),
      A('Sentenac', 33.122, -116.385),
      A('Badlands', 33.139, -116.219),
    ],
  },
  {
    id: 'sr-78-ea-badlands-ocotillo-wells',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Badlands to Ocotillo Wells',
    fromName: 'Badlands',
    toName: 'Ocotillo Wells',
    lengthKm: 7.26,
    designSpeedMph: 55,
    polyline: [
      P(33.15846, -116.21441), P(33.15823, -116.21228), P(33.15799, -116.21015),
      P(33.15775, -116.20802), P(33.15751, -116.20589), P(33.15728, -116.20376),
      P(33.15691, -116.20166), P(33.15650, -116.19957), P(33.15609, -116.19747),
      P(33.15568, -116.19538), P(33.15527, -116.19329), P(33.15486, -116.19120),
      P(33.15445, -116.18911), P(33.15404, -116.18701), P(33.15363, -116.18492),
      P(33.15323, -116.18283), P(33.15283, -116.18073), P(33.15242, -116.17864),
      P(33.15209, -116.17653), P(33.15186, -116.17440), P(33.15162, -116.17227),
      P(33.15139, -116.17014), P(33.15116, -116.16801), P(33.15093, -116.16588),
      P(33.15069, -116.16375), P(33.15045, -116.16162), P(33.15020, -116.15949),
      P(33.14997, -116.15736), P(33.14973, -116.15524), P(33.14949, -116.15310),
      P(33.14922, -116.15098), P(33.14897, -116.14886), P(33.14838, -116.14683),
      P(33.14778, -116.14480), P(33.14719, -116.14278), P(33.14659, -116.14075),
      P(33.14582, -116.13811),
    ],
    areas: [
      A('Badlands', 33.139, -116.219),
      A('Yaqui Pass', 33.131, -116.302),
      A('Ocotillo Wells', 33.138, -116.141),
    ],
  },
  {
    id: 'sr-78-ea-ocotillo-wells-county-line',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Ocotillo Wells to County Line',
    fromName: 'Ocotillo Wells',
    toName: 'County Line',
    lengthKm: 8.37,
    designSpeedMph: 55,
    polyline: [
      P(33.14582, -116.13811), P(33.14523, -116.13608), P(33.14464, -116.13406),
      P(33.14404, -116.13203), P(33.14343, -116.13001), P(33.14300, -116.12793),
      P(33.14285, -116.12579), P(33.14271, -116.12365), P(33.14257, -116.12151),
      P(33.14242, -116.11937), P(33.14215, -116.11724), P(33.14178, -116.11514),
      P(33.14141, -116.11304), P(33.14104, -116.11094), P(33.14067, -116.10884),
      P(33.14030, -116.10674), P(33.13988, -116.10465), P(33.13927, -116.10263),
      P(33.13862, -116.10063), P(33.13796, -116.09862), P(33.13731, -116.09662),
      P(33.13665, -116.09462), P(33.13600, -116.09262), P(33.13535, -116.09062),
      P(33.13469, -116.08862), P(33.13404, -116.08662), P(33.13339, -116.08462),
      P(33.13273, -116.08262), P(33.13209, -116.08061), P(33.13152, -116.07857),
      P(33.13094, -116.07654), P(33.13040, -116.07449), P(33.12985, -116.07245),
      P(33.12930, -116.07040), P(33.12875, -116.06836), P(33.12820, -116.06631),
      P(33.12765, -116.06427), P(33.12710, -116.06222), P(33.12655, -116.06018),
      P(33.12600, -116.05813), P(33.12572, -116.05602), P(33.12569, -116.05387),
      P(33.12570, -116.05205),
    ],
    areas: [
      A('Ocotillo Wells', 33.138, -116.141),
      A('Badlands', 33.139, -116.219),
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
    id: 'sr-78-we-county-line-ocotillo-wells',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: County Line to Ocotillo Wells',
    fromName: 'County Line',
    toName: 'Ocotillo Wells',
    lengthKm: 8.37,
    designSpeedMph: 55,
    polyline: [
      P(33.12570, -116.05205), P(33.12569, -116.05387), P(33.12572, -116.05602),
      P(33.12600, -116.05813), P(33.12655, -116.06018), P(33.12710, -116.06222),
      P(33.12765, -116.06427), P(33.12820, -116.06631), P(33.12875, -116.06836),
      P(33.12930, -116.07040), P(33.12985, -116.07245), P(33.13040, -116.07449),
      P(33.13094, -116.07654), P(33.13152, -116.07857), P(33.13209, -116.08061),
      P(33.13273, -116.08262), P(33.13339, -116.08462), P(33.13404, -116.08662),
      P(33.13469, -116.08862), P(33.13535, -116.09062), P(33.13600, -116.09262),
      P(33.13665, -116.09462), P(33.13731, -116.09662), P(33.13796, -116.09862),
      P(33.13862, -116.10063), P(33.13927, -116.10263), P(33.13988, -116.10465),
      P(33.14030, -116.10674), P(33.14067, -116.10884), P(33.14104, -116.11094),
      P(33.14141, -116.11304), P(33.14178, -116.11514), P(33.14215, -116.11724),
      P(33.14242, -116.11937), P(33.14257, -116.12151), P(33.14271, -116.12365),
      P(33.14285, -116.12579), P(33.14300, -116.12793), P(33.14343, -116.13001),
      P(33.14404, -116.13203), P(33.14464, -116.13406), P(33.14523, -116.13608),
      P(33.14582, -116.13811),
    ],
    areas: [
      A('Ocotillo Wells', 33.138, -116.141),
      A('Badlands', 33.139, -116.219),
    ],
  },
  {
    id: 'sr-78-we-ocotillo-wells-badlands',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Ocotillo Wells to Badlands',
    fromName: 'Ocotillo Wells',
    toName: 'Badlands',
    lengthKm: 7.26,
    designSpeedMph: 55,
    polyline: [
      P(33.14582, -116.13811), P(33.14659, -116.14075), P(33.14719, -116.14278),
      P(33.14778, -116.14480), P(33.14838, -116.14683), P(33.14897, -116.14886),
      P(33.14922, -116.15098), P(33.14949, -116.15310), P(33.14973, -116.15524),
      P(33.14997, -116.15736), P(33.15020, -116.15949), P(33.15045, -116.16162),
      P(33.15069, -116.16375), P(33.15093, -116.16588), P(33.15116, -116.16801),
      P(33.15139, -116.17014), P(33.15162, -116.17227), P(33.15186, -116.17440),
      P(33.15209, -116.17653), P(33.15242, -116.17864), P(33.15283, -116.18073),
      P(33.15323, -116.18283), P(33.15363, -116.18492), P(33.15404, -116.18701),
      P(33.15445, -116.18911), P(33.15486, -116.19120), P(33.15527, -116.19329),
      P(33.15568, -116.19538), P(33.15609, -116.19747), P(33.15650, -116.19957),
      P(33.15691, -116.20166), P(33.15728, -116.20376), P(33.15751, -116.20589),
      P(33.15775, -116.20802), P(33.15799, -116.21015), P(33.15823, -116.21228),
      P(33.15846, -116.21441),
    ],
    areas: [
      A('Ocotillo Wells', 33.138, -116.141),
      A('Badlands', 33.139, -116.219),
      A('Yaqui Pass', 33.131, -116.302),
    ],
  },
  {
    id: 'sr-78-we-badlands-yaqui-pass',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Badlands to Yaqui Pass',
    fromName: 'Badlands',
    toName: 'Yaqui Pass',
    lengthKm: 9.26,
    designSpeedMph: 55,
    polyline: [
      P(33.15846, -116.21441), P(33.15877, -116.21718), P(33.15900, -116.21931),
      P(33.15924, -116.22144), P(33.15947, -116.22357), P(33.15947, -116.22571),
      P(33.15937, -116.22786), P(33.15926, -116.23000), P(33.15915, -116.23215),
      P(33.15904, -116.23429), P(33.15893, -116.23644), P(33.15881, -116.23858),
      P(33.15844, -116.24068), P(33.15787, -116.24271), P(33.15728, -116.24474),
      P(33.15655, -116.24671), P(33.15561, -116.24854), P(33.15462, -116.25033),
      P(33.15363, -116.25212), P(33.15264, -116.25392), P(33.15165, -116.25571),
      P(33.15066, -116.25750), P(33.14955, -116.25919), P(33.14844, -116.26088),
      P(33.14732, -116.26257), P(33.14621, -116.26425), P(33.14510, -116.26594),
      P(33.14398, -116.26763), P(33.14295, -116.26938), P(33.14261, -116.27147),
      P(33.14308, -116.27353), P(33.14327, -116.27560), P(33.14273, -116.27765),
      P(33.14219, -116.27969), P(33.14164, -116.28174), P(33.14110, -116.28379),
      P(33.14055, -116.28583), P(33.14001, -116.28788), P(33.13946, -116.28993),
      P(33.13908, -116.29202), P(33.13817, -116.29385), P(33.13706, -116.29554),
      P(33.13590, -116.29718), P(33.13528, -116.29913), P(33.13384, -116.30012),
      P(33.13206, -116.29999), P(33.13086, -116.30146),
    ],
    areas: [
      A('Badlands', 33.139, -116.219),
      A('Yaqui Pass', 33.131, -116.302),
      A('Ocotillo Wells', 33.138, -116.141),
    ],
  },
  {
    id: 'sr-78-we-yaqui-pass-sentenac',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Yaqui Pass to Sentenac',
    fromName: 'Yaqui Pass',
    toName: 'Sentenac',
    lengthKm: 7.86,
    designSpeedMph: 50,
    polyline: [
      P(33.13086, -116.30146), P(33.13098, -116.30424), P(33.13113, -116.30638),
      P(33.13148, -116.30848), P(33.13193, -116.31056), P(33.13264, -116.31251),
      P(33.13334, -116.31440), P(33.13324, -116.31655), P(33.13316, -116.31869),
      P(33.13309, -116.32084), P(33.13303, -116.32299), P(33.13296, -116.32513),
      P(33.13291, -116.32728), P(33.13286, -116.32943), P(33.13281, -116.33157),
      P(33.13296, -116.33371), P(33.13324, -116.33583), P(33.13353, -116.33795),
      P(33.13382, -116.34007), P(33.13410, -116.34220), P(33.13438, -116.34432),
      P(33.13466, -116.34644), P(33.13495, -116.34856), P(33.13523, -116.35068),
      P(33.13550, -116.35280), P(33.13539, -116.35493), P(33.13501, -116.35703),
      P(33.13462, -116.35913), P(33.13425, -116.36123), P(33.13399, -116.36335),
      P(33.13421, -116.36547), P(33.13497, -116.36741), P(33.13574, -116.36934),
      P(33.13625, -116.37140), P(33.13662, -116.37350), P(33.13694, -116.37555),
      P(33.13608, -116.37743), P(33.13569, -116.37951), P(33.13509, -116.38151),
      P(33.13466, -116.38357),
    ],
    areas: [
      A('Yaqui Pass', 33.131, -116.302),
      A('Sentenac', 33.122, -116.385),
      A('Scissors Crossing', 33.1, -116.468),
    ],
  },
  {
    id: 'sr-78-we-sentenac-scissors-crossing',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Sentenac to Scissors Crossing',
    fromName: 'Sentenac',
    toName: 'Scissors Crossing',
    lengthKm: 10.17,
    designSpeedMph: 55,
    polyline: [
      P(33.13466, -116.38357), P(33.13505, -116.38533), P(33.13510, -116.38745),
      P(33.13459, -116.38948), P(33.13380, -116.39141), P(33.13297, -116.39331),
      P(33.13232, -116.39531), P(33.13208, -116.39743), P(33.13197, -116.39957),
      P(33.13213, -116.40170), P(33.13137, -116.40363), P(33.13107, -116.40572),
      P(33.13119, -116.40787), P(33.13129, -116.41001), P(33.13109, -116.41214),
      P(33.13073, -116.41423), P(33.13013, -116.41624), P(33.12985, -116.41836),
      P(33.12949, -116.42046), P(33.12912, -116.42257), P(33.12879, -116.42468),
      P(33.12847, -116.42679), P(33.12841, -116.42892), P(33.12911, -116.43088),
      P(33.12892, -116.43296), P(33.12817, -116.43461), P(33.12662, -116.43523),
      P(33.12495, -116.43564), P(33.12322, -116.43548), P(33.12157, -116.43497),
      P(33.12001, -116.43422), P(33.11861, -116.43553), P(33.11736, -116.43708),
      P(33.11616, -116.43867), P(33.11534, -116.44057), P(33.11485, -116.44258),
      P(33.11365, -116.44415), P(33.11256, -116.44573), P(33.11117, -116.44695),
      P(33.11067, -116.44897), P(33.10898, -116.44918), P(33.10785, -116.45077),
      P(33.10607, -116.45085), P(33.10481, -116.45231), P(33.10348, -116.45371),
      P(33.10243, -116.45540), P(33.10155, -116.45727), P(33.10071, -116.45917),
      P(33.10042, -116.46128), P(33.10021, -116.46341), P(33.10000, -116.46555),
      P(33.09970, -116.46766),
    ],
    areas: [
      A('Sentenac', 33.122, -116.385),
      A('Scissors Crossing', 33.1, -116.468),
      A('Yaqui Pass', 33.131, -116.302),
    ],
  },
  {
    id: 'sr-78-we-scissors-crossing-san-felipe-valley',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Scissors Crossing to San Felipe Valley',
    fromName: 'Scissors Crossing',
    toName: 'San Felipe Valley',
    lengthKm: 3.44,
    designSpeedMph: 50,
    polyline: [
      P(33.09970, -116.46766), P(33.09887, -116.47003), P(33.09810, -116.47198),
      P(33.09733, -116.47392), P(33.09656, -116.47586), P(33.09579, -116.47780),
      P(33.09503, -116.47974), P(33.09434, -116.48172), P(33.09372, -116.48374),
      P(33.09309, -116.48575), P(33.09244, -116.48775), P(33.09179, -116.48976),
      P(33.09116, -116.49176), P(33.09052, -116.49377), P(33.08988, -116.49578),
      P(33.08924, -116.49778), P(33.08860, -116.49979), P(33.08796, -116.50180),
    ],
    areas: [
      A('Scissors Crossing', 33.1, -116.468),
      A('San Felipe Valley', 33.076, -116.496),
      A('Sentenac', 33.122, -116.385),
    ],
  },
  {
    id: 'sr-78-we-san-felipe-valley-banner',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: San Felipe Valley to Banner',
    fromName: 'San Felipe Valley',
    toName: 'Banner',
    lengthKm: 4.98,
    designSpeedMph: 45,
    polyline: [
      P(33.08796, -116.50180), P(33.08739, -116.50360), P(33.08675, -116.50561),
      P(33.08611, -116.50762), P(33.08548, -116.50963), P(33.08484, -116.51163),
      P(33.08420, -116.51364), P(33.08356, -116.51565), P(33.08293, -116.51766),
      P(33.08228, -116.51966), P(33.08165, -116.52167), P(33.08101, -116.52367),
      P(33.08037, -116.52568), P(33.07973, -116.52769), P(33.07910, -116.52970),
      P(33.07846, -116.53171), P(33.07738, -116.53337), P(33.07597, -116.53469),
      P(33.07492, -116.53644), P(33.07386, -116.53817), P(33.07263, -116.53969),
      P(33.07174, -116.54155), P(33.07085, -116.54337), P(33.07009, -116.54515),
      P(33.06883, -116.54669), P(33.06733, -116.54783),
    ],
    areas: [
      A('San Felipe Valley', 33.076, -116.496),
      A('Banner', 33.067, -116.548),
      A('Scissors Crossing', 33.1, -116.468),
    ],
  },
  {
    id: 'sr-78-we-banner-kentwood',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Banner to Kentwood',
    fromName: 'Banner',
    toName: 'Kentwood',
    lengthKm: 2.21,
    designSpeedMph: 40,
    polyline: [
      P(33.06733, -116.54783), P(33.06812, -116.54962), P(33.06806, -116.55170),
      P(33.06666, -116.55294), P(33.06744, -116.55365), P(33.06899, -116.55290),
      P(33.07028, -116.55207), P(33.07113, -116.55379), P(33.07212, -116.55527),
      P(33.07298, -116.55669), P(33.07391, -116.55827), P(33.07431, -116.55972),
    ],
    areas: [
      A('Banner', 33.067, -116.548),
      A('Kentwood', 33.07, -116.563),
      A('San Felipe Valley', 33.076, -116.496),
    ],
  },
  {
    id: 'sr-78-we-kentwood-julian',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Kentwood to Julian',
    fromName: 'Kentwood',
    toName: 'Julian',
    lengthKm: 7.82,
    designSpeedMph: 45,
    polyline: [
      P(33.07431, -116.55972), P(33.07519, -116.56139), P(33.07661, -116.56257),
      P(33.07677, -116.56465), P(33.07828, -116.56552), P(33.07952, -116.56697),
      P(33.08055, -116.56856), P(33.08048, -116.57022), P(33.08037, -116.57232),
      P(33.08198, -116.57194), P(33.08360, -116.57233), P(33.08409, -116.57437),
      P(33.08533, -116.57467), P(33.08660, -116.57596), P(33.08752, -116.57773),
      P(33.08886, -116.57910), P(33.09040, -116.57998), P(33.09154, -116.58157),
      P(33.09262, -116.58292), P(33.09384, -116.58445), P(33.09444, -116.58643),
      P(33.09549, -116.58790), P(33.09594, -116.58966), P(33.09702, -116.59137),
      P(33.09770, -116.59332), P(33.09621, -116.59401), P(33.09459, -116.59487),
      P(33.09299, -116.59567), P(33.09152, -116.59679), P(33.09019, -116.59549),
      P(33.08861, -116.59465), P(33.08804, -116.59276), P(33.08684, -116.59174),
      P(33.08540, -116.59056), P(33.08368, -116.58999), P(33.08203, -116.58927),
      P(33.08029, -116.58922), P(33.07862, -116.58988), P(33.07692, -116.59034),
      P(33.07654, -116.59236),
    ],
    areas: [
      A('Kentwood', 33.07, -116.563),
      A('Julian', 33.076, -116.592),
      A('Banner', 33.067, -116.548),
    ],
  },
  {
    id: 'sr-78-we-julian-wynola',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Julian to Wynola',
    fromName: 'Julian',
    toName: 'Wynola',
    lengthKm: 5.88,
    designSpeedMph: 45,
    polyline: [
      P(33.07654, -116.59236), P(33.07653, -116.59322), P(33.07650, -116.59537),
      P(33.07646, -116.59752), P(33.07661, -116.59963), P(33.07776, -116.60128),
      P(33.07816, -116.60283), P(33.07698, -116.60444), P(33.07666, -116.60652),
      P(33.07689, -116.60864), P(33.07783, -116.61027), P(33.07784, -116.61231),
      P(33.07793, -116.61445), P(33.07813, -116.61658), P(33.07819, -116.61872),
      P(33.07816, -116.62086), P(33.07796, -116.62299), P(33.07789, -116.62514),
      P(33.07798, -116.62727), P(33.07843, -116.62935), P(33.07880, -116.63145),
      P(33.07929, -116.63351), P(33.07993, -116.63547), P(33.07993, -116.63755),
      P(33.08077, -116.63933), P(33.08020, -116.64134), P(33.08030, -116.64345),
      P(33.08133, -116.64517), P(33.08296, -116.64603), P(33.08475, -116.64611),
      P(33.08655, -116.64611),
    ],
    areas: [
      A('Julian', 33.076, -116.592),
      A('Wynola', 33.087, -116.641),
      A('Kentwood', 33.07, -116.563),
    ],
  },
  {
    id: 'sr-78-we-wynola-santa-ysabel',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Wynola to Santa Ysabel',
    fromName: 'Wynola',
    toName: 'Santa Ysabel',
    lengthKm: 5.88,
    designSpeedMph: 45,
    polyline: [
      P(33.08655, -116.64611), P(33.08727, -116.64611), P(33.08907, -116.64608),
      P(33.09087, -116.64608), P(33.09266, -116.64609), P(33.09446, -116.64606),
      P(33.09626, -116.64606), P(33.09782, -116.64678), P(33.09889, -116.64851),
      P(33.10052, -116.64932), P(33.10181, -116.65060), P(33.10243, -116.65262),
      P(33.10401, -116.65345), P(33.10547, -116.65467), P(33.10645, -116.65637),
      P(33.10746, -116.65793), P(33.10610, -116.65898), P(33.10430, -116.65906),
      P(33.10280, -116.66017), P(33.10175, -116.66191), P(33.10019, -116.66291),
      P(33.09860, -116.66381), P(33.09940, -116.66544), P(33.10100, -116.66642),
      P(33.10263, -116.66733), P(33.10423, -116.66825), P(33.10601, -116.66802),
      P(33.10775, -116.66842), P(33.10939, -116.66927), P(33.10995, -116.67120),
      P(33.10940, -116.67324),
    ],
    areas: [
      A('Wynola', 33.087, -116.641),
      A('Santa Ysabel', 33.109, -116.673),
      A('Julian', 33.076, -116.592),
    ],
  },
  {
    id: 'sr-78-we-santa-ysabel-mesa-grande',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Santa Ysabel to Mesa Grande',
    fromName: 'Santa Ysabel',
    toName: 'Mesa Grande',
    lengthKm: 5.95,
    designSpeedMph: 50,
    polyline: [
      P(33.10940, -116.67324), P(33.10896, -116.67476), P(33.10835, -116.67679),
      P(33.10776, -116.67881), P(33.10716, -116.68084), P(33.10657, -116.68287),
      P(33.10599, -116.68490), P(33.10540, -116.68693), P(33.10506, -116.68902),
      P(33.10476, -116.69113), P(33.10380, -116.69294), P(33.10271, -116.69464),
      P(33.10141, -116.69612), P(33.10002, -116.69748), P(33.09860, -116.69879),
      P(33.09709, -116.69996), P(33.09548, -116.70088), P(33.09386, -116.70182),
      P(33.09249, -116.70317), P(33.09118, -116.70460), P(33.08987, -116.70594),
      P(33.08814, -116.70648), P(33.08675, -116.70781), P(33.08541, -116.70923),
      P(33.08412, -116.71073), P(33.08299, -116.71238), P(33.08194, -116.71412),
      P(33.08049, -116.71537), P(33.07895, -116.71648), P(33.07737, -116.71750),
      P(33.07572, -116.71832),
    ],
    areas: [
      A('Santa Ysabel', 33.109, -116.673),
      A('Mesa Grande', 33.076, -116.718),
      A('Wynola', 33.087, -116.641),
    ],
  },
  {
    id: 'sr-78-we-mesa-grande-witch-creek',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Mesa Grande to Witch Creek',
    fromName: 'Mesa Grande',
    toName: 'Witch Creek',
    lengthKm: 4,
    designSpeedMph: 50,
    polyline: [
      P(33.07572, -116.71832), P(33.07398, -116.71889), P(33.07223, -116.71935),
      P(33.07054, -116.72003), P(33.06905, -116.72121), P(33.06745, -116.72217),
      P(33.06596, -116.72332), P(33.06614, -116.72522), P(33.06713, -116.72700),
      P(33.06752, -116.72909), P(33.06735, -116.73122), P(33.06704, -116.73333),
      P(33.06686, -116.73546), P(33.06739, -116.73750), P(33.06761, -116.73962),
      P(33.06736, -116.74173), P(33.06664, -116.74369), P(33.06585, -116.74562),
      P(33.06540, -116.74765), P(33.06539, -116.74980), P(33.06538, -116.75195),
    ],
    areas: [
      A('Mesa Grande', 33.076, -116.718),
      A('Witch Creek', 33.065, -116.751),
      A('Santa Ysabel', 33.109, -116.673),
    ],
  },
  {
    id: 'sr-78-we-witch-creek-ballena',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Witch Creek to Ballena',
    fromName: 'Witch Creek',
    toName: 'Ballena',
    lengthKm: 8.5,
    designSpeedMph: 50,
    polyline: [
      P(33.06538, -116.75195), P(33.06538, -116.75302), P(33.06537, -116.75516),
      P(33.06537, -116.75731), P(33.06571, -116.75939), P(33.06683, -116.76094),
      P(33.06839, -116.76196), P(33.06966, -116.76347), P(33.07076, -116.76516),
      P(33.07147, -116.76712), P(33.07270, -116.76867), P(33.07401, -116.77014),
      P(33.07520, -116.77171), P(33.07606, -116.77360), P(33.07702, -116.77541),
      P(33.07808, -116.77714), P(33.07875, -116.77912), P(33.07918, -116.78119),
      P(33.07972, -116.78315), P(33.08106, -116.78455), P(33.08241, -116.78580),
      P(33.08348, -116.78724), P(33.08442, -116.78903), P(33.08536, -116.79084),
      P(33.08536, -116.79283), P(33.08388, -116.79387), P(33.08240, -116.79508),
      P(33.08082, -116.79611), P(33.07925, -116.79715), P(33.07776, -116.79834),
      P(33.07638, -116.79962), P(33.07546, -116.80144), P(33.07429, -116.80297),
      P(33.07287, -116.80427), P(33.07142, -116.80551), P(33.06986, -116.80652),
      P(33.06838, -116.80772), P(33.06723, -116.80927), P(33.06567, -116.80980),
      P(33.06451, -116.81135), P(33.06309, -116.81245), P(33.06153, -116.81345),
      P(33.05995, -116.81446), P(33.05902, -116.81624),
    ],
    areas: [
      A('Witch Creek', 33.065, -116.751),
      A('Ballena', 33.06, -116.815),
      A('Mesa Grande', 33.076, -116.718),
    ],
  },
  {
    id: 'sr-78-we-ballena-ramona-east',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Ballena to Ramona East',
    fromName: 'Ballena',
    toName: 'Ramona East',
    lengthKm: 4.9,
    designSpeedMph: 50,
    polyline: [
      P(33.05902, -116.81624), P(33.05829, -116.81686), P(33.05689, -116.81821),
      P(33.05574, -116.81985), P(33.05408, -116.82035), P(33.05230, -116.82005),
      P(33.05050, -116.81997), P(33.04905, -116.82108), P(33.04822, -116.82298),
      P(33.04723, -116.82478), P(33.04675, -116.82683), P(33.04648, -116.82895),
      P(33.04642, -116.83109), P(33.04661, -116.83319), P(33.04808, -116.83434),
      P(33.04887, -116.83627), P(33.04977, -116.83806), P(33.05105, -116.83949),
      P(33.05113, -116.84163), P(33.05114, -116.84378), P(33.05115, -116.84592),
      P(33.05115, -116.84807), P(33.05116, -116.85022), P(33.05109, -116.85236),
      P(33.05049, -116.85437), P(33.04947, -116.85613),
    ],
    areas: [
      A('Ballena', 33.06, -116.815),
      A('Ramona', 33.042, -116.879),
      A('Witch Creek', 33.065, -116.751),
    ],
  },
  {
    id: 'sr-78-we-ramona-east-ramona',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Through Ramona',
    fromName: 'Ramona East',
    toName: 'Ramona',
    lengthKm: 2.3,
    designSpeedMph: 35,
    polyline: [
      P(33.04947, -116.85613), P(33.04892, -116.85698), P(33.04764, -116.85849),
      P(33.04661, -116.86024), P(33.04562, -116.86203), P(33.04463, -116.86382),
      P(33.04364, -116.86562), P(33.04267, -116.86743), P(33.04257, -116.86901),
      P(33.04410, -116.87014), P(33.04574, -116.87099), P(33.04754, -116.87113),
      P(33.04933, -116.87121),
    ],
    areas: [
      A('Ramona', 33.042, -116.879),
      A('Ballena', 33.06, -116.815),
      A('Highland Valley', 33.087, -116.937),
    ],
  },
  {
    id: 'sr-78-we-ramona-highland-valley',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Ramona to Highland Valley',
    fromName: 'Ramona',
    toName: 'Highland Valley',
    lengthKm: 10.3,
    designSpeedMph: 55,
    polyline: [
      P(33.04933, -116.87121), P(33.05023, -116.87125), P(33.05203, -116.87132),
      P(33.05383, -116.87138), P(33.05563, -116.87143), P(33.05742, -116.87148),
      P(33.05922, -116.87153), P(33.06102, -116.87156), P(33.06282, -116.87160),
      P(33.06456, -116.87202), P(33.06566, -116.87365), P(33.06580, -116.87578),
      P(33.06581, -116.87792), P(33.06687, -116.87962), P(33.06780, -116.88145),
      P(33.06900, -116.88304), P(33.07015, -116.88468), P(33.06964, -116.88666),
      P(33.06951, -116.88877), P(33.06949, -116.89092), P(33.07000, -116.89293),
      P(33.07026, -116.89505), P(33.07106, -116.89695), P(33.07163, -116.89897),
      P(33.07222, -116.90097), P(33.07310, -116.90262), P(33.07488, -116.90281),
      P(33.07665, -116.90313), P(33.07842, -116.90306), P(33.08010, -116.90350),
      P(33.08184, -116.90382), P(33.08364, -116.90379), P(33.08543, -116.90369),
      P(33.08706, -116.90417), P(33.08649, -116.90607), P(33.08692, -116.90806),
      P(33.08646, -116.90984), P(33.08535, -116.91143), P(33.08557, -116.91355),
      P(33.08502, -116.91542), P(33.08364, -116.91665), P(33.08255, -116.91795),
      P(33.08284, -116.92005), P(33.08382, -116.92126), P(33.08540, -116.92219),
      P(33.08579, -116.92393), P(33.08603, -116.92594), P(33.08689, -116.92779),
      P(33.08737, -116.92981), P(33.08596, -116.93096), P(33.08573, -116.93308),
      P(33.08612, -116.93517), P(33.08718, -116.93687),
    ],
    areas: [
      A('Ramona', 33.042, -116.879),
      A('Highland Valley', 33.087, -116.937),
      A('Bandy Canyon', 33.091, -116.972),
    ],
  },
  {
    id: 'sr-78-we-highland-valley-bandy-canyon',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Highland Valley to Bandy Canyon',
    fromName: 'Highland Valley',
    toName: 'Bandy Canyon',
    lengthKm: 4,
    designSpeedMph: 45,
    polyline: [
      P(33.08718, -116.93687), P(33.08887, -116.93752), P(33.09047, -116.93830),
      P(33.09115, -116.94028), P(33.09128, -116.94237), P(33.09063, -116.94435),
      P(33.09060, -116.94649), P(33.09058, -116.94864), P(33.09058, -116.95079),
      P(33.09089, -116.95288), P(33.09202, -116.95451), P(33.09348, -116.95578),
      P(33.09450, -116.95751), P(33.09476, -116.95963), P(33.09454, -116.96173),
      P(33.09351, -116.96349), P(33.09282, -116.96544), P(33.09215, -116.96743),
      P(33.09153, -116.96944), P(33.09117, -116.97154), P(33.09061, -116.97358),
    ],
    areas: [
      A('Highland Valley', 33.087, -116.937),
      A('Bandy Canyon', 33.091, -116.972),
      A('Ramona', 33.042, -116.879),
    ],
  },
  {
    id: 'sr-78-we-bandy-canyon-san-pasqual',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Bandy Canyon to San Pasqual',
    fromName: 'Bandy Canyon',
    toName: 'San Pasqual',
    lengthKm: 3.6,
    designSpeedMph: 45,
    polyline: [
      P(33.09061, -116.97358), P(33.09003, -116.97561), P(33.08948, -116.97765),
      P(33.08893, -116.97970), P(33.08854, -116.98178), P(33.08790, -116.98377),
      P(33.08716, -116.98574), P(33.08634, -116.98764), P(33.08584, -116.98964),
      P(33.08687, -116.99124), P(33.08861, -116.99175), P(33.09018, -116.99268),
      P(33.09135, -116.99430), P(33.09210, -116.99625), P(33.09280, -116.99823),
      P(33.09350, -117.00021), P(33.09420, -117.00218), P(33.09492, -117.00415),
      P(33.09553, -117.00617),
    ],
    areas: [
      A('Bandy Canyon', 33.091, -116.972),
      A('San Pasqual', 33.093, -117),
      A('Highland Valley', 33.087, -116.937),
    ],
  },
  {
    id: 'sr-78-we-san-pasqual-safari-park',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: San Pasqual to Safari Park',
    fromName: 'San Pasqual',
    toName: 'Safari Park',
    lengthKm: 2.4,
    designSpeedMph: 50,
    polyline: [
      P(33.09553, -117.00617), P(33.09578, -117.00830), P(33.09600, -117.01042),
      P(33.09671, -117.01234), P(33.09815, -117.01363), P(33.09890, -117.01553),
      P(33.09887, -117.01767), P(33.09845, -117.01973), P(33.09745, -117.02150),
      P(33.09697, -117.02352), P(33.09765, -117.02549), P(33.09851, -117.02738),
      P(33.09932, -117.02929),
    ],
    areas: [
      A('San Pasqual', 33.093, -117),
      A('Safari Park', 33.099, -117.009),
      A('Bandy Canyon', 33.091, -116.972),
    ],
  },
  {
    id: 'sr-78-we-safari-park-escondido',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Safari Park to Escondido',
    fromName: 'Safari Park',
    toName: 'Escondido',
    lengthKm: 8,
    designSpeedMph: 50,
    polyline: [
      P(33.09932, -117.02929), P(33.10046, -117.03093), P(33.10132, -117.03280),
      P(33.10207, -117.03475), P(33.10284, -117.03669), P(33.10367, -117.03859),
      P(33.10446, -117.04052), P(33.10542, -117.04233), P(33.10654, -117.04401),
      P(33.10774, -117.04560), P(33.10867, -117.04744), P(33.10916, -117.04950),
      P(33.10957, -117.05159), P(33.10937, -117.05371), P(33.11041, -117.05539),
      P(33.11185, -117.05664), P(33.11359, -117.05720), P(33.11514, -117.05822),
      P(33.11654, -117.05957), P(33.11798, -117.06086), P(33.11976, -117.06103),
      P(33.12156, -117.06109), P(33.12313, -117.06208), P(33.12457, -117.06336),
      P(33.12591, -117.06480), P(33.12754, -117.06569), P(33.12924, -117.06636),
      P(33.13091, -117.06717), P(33.13262, -117.06779), P(33.13238, -117.06923),
      P(33.13133, -117.07098), P(33.13039, -117.07280), P(33.12978, -117.07482),
      P(33.12915, -117.07683), P(33.12852, -117.07884), P(33.12789, -117.08085),
      P(33.12727, -117.08287), P(33.12783, -117.08424), P(33.12952, -117.08498),
      P(33.13121, -117.08572), P(33.13290, -117.08645),
    ],
    areas: [
      A('Safari Park', 33.099, -117.009),
      A('San Pasqual', 33.093, -117),
      A('Escondido', 33.119, -117.087),
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
    id: 'i-8-eb-alpine-viejas',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Alpine to Viejas',
    fromName: 'Alpine',
    toName: 'Viejas',
    lengthKm: 7.2,
    designSpeedMph: 60,
    polyline: [
      P(32.84044, -116.77488), P(32.84012, -116.77278), P(32.83980, -116.77067),
      P(32.83948, -116.76857), P(32.83916, -116.76646), P(32.83884, -116.76435),
      P(32.83851, -116.76225), P(32.83808, -116.76017), P(32.83750, -116.75814),
      P(32.83693, -116.75612), P(32.83635, -116.75409), P(32.83578, -116.75206),
      P(32.83523, -116.75002), P(32.83488, -116.74792), P(32.83475, -116.74579),
      P(32.83486, -116.74366), P(32.83502, -116.74152), P(32.83510, -116.73939),
      P(32.83490, -116.73726), P(32.83457, -116.73516), P(32.83423, -116.73306),
      P(32.83398, -116.73094), P(32.83403, -116.72880), P(32.83414, -116.72667),
      P(32.83401, -116.72453), P(32.83383, -116.72240), P(32.83405, -116.72029),
      P(32.83488, -116.71840), P(32.83586, -116.71661), P(32.83660, -116.71466),
      P(32.83705, -116.71259), P(32.83744, -116.71050), P(32.83782, -116.70841),
      P(32.83821, -116.70632), P(32.83860, -116.70423), P(32.83885, -116.70211),
      P(32.83889, -116.70001),
    ],
    areas: [
      A('Alpine', 32.835, -116.766),
      A('Harbison Canyon', 32.821, -116.838),
      A('Viejas', 32.838, -116.7),
    ],
  },
  {
    id: 'i-8-eb-viejas-descanso-junction',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Viejas to Descanso Junction',
    fromName: 'Viejas',
    toName: 'Descanso Junction',
    lengthKm: 7.41,
    designSpeedMph: 60,
    polyline: [
      P(32.83889, -116.70001), P(32.83890, -116.69787), P(32.83892, -116.69573),
      P(32.83893, -116.69359), P(32.83894, -116.69145), P(32.83895, -116.68931),
      P(32.83896, -116.68717), P(32.83887, -116.68503), P(32.83863, -116.68291),
      P(32.83837, -116.68079), P(32.83810, -116.67867), P(32.83790, -116.67655),
      P(32.83797, -116.67441), P(32.83831, -116.67231), P(32.83875, -116.67024),
      P(32.83890, -116.66811), P(32.83864, -116.66600), P(32.83817, -116.66393),
      P(32.83772, -116.66186), P(32.83763, -116.65973), P(32.83794, -116.65762),
      P(32.83838, -116.65555), P(32.83871, -116.65345), P(32.83865, -116.65131),
      P(32.83823, -116.64923), P(32.83777, -116.64716), P(32.83731, -116.64509),
      P(32.83685, -116.64302), P(32.83641, -116.64095), P(32.83586, -116.63891),
      P(32.83521, -116.63691), P(32.83452, -116.63493), P(32.83384, -116.63295),
      P(32.83303, -116.63105), P(32.83195, -116.62934), P(32.83061, -116.62791),
      P(32.82911, -116.62674), P(32.82750, -116.62550),
    ],
    areas: [
      A('Viejas', 32.838, -116.7),
      A('Alpine', 32.835, -116.766),
      A('Descanso', 32.852, -116.618),
    ],
  },
  {
    id: 'i-8-eb-descanso-junction-guatay',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Descanso Junction to Guatay',
    fromName: 'Descanso Junction',
    toName: 'Guatay',
    lengthKm: 6.62,
    designSpeedMph: 60,
    polyline: [
      P(32.82750, -116.62550), P(32.82620, -116.62403), P(32.82522, -116.62224),
      P(32.82459, -116.62024), P(32.82435, -116.61812), P(32.82447, -116.61599),
      P(32.82463, -116.61386), P(32.82479, -116.61172), P(32.82492, -116.60959),
      P(32.82486, -116.60745), P(32.82459, -116.60534), P(32.82416, -116.60326),
      P(32.82372, -116.60118), P(32.82328, -116.59911), P(32.82283, -116.59703),
      P(32.82239, -116.59496), P(32.82193, -116.59289), P(32.82147, -116.59082),
      P(32.82102, -116.58875), P(32.82056, -116.58668), P(32.82027, -116.58457),
      P(32.82026, -116.58243), P(32.82032, -116.58030), P(32.82039, -116.57816),
      P(32.82045, -116.57602), P(32.82053, -116.57388), P(32.82079, -116.57177),
      P(32.82150, -116.56981), P(32.82236, -116.56793), P(32.82299, -116.56593),
      P(32.82326, -116.56381), P(32.82325, -116.56167), P(32.82326, -116.55953),
      P(32.82326, -116.55720),
    ],
    areas: [
      A('Descanso', 32.852, -116.618),
      A('Pine Valley', 32.822, -116.596),
      A('Viejas', 32.838, -116.7),
    ],
  },
  {
    id: 'i-8-eb-guatay-carrizo-gorge',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Guatay to Carrizo Gorge',
    fromName: 'Guatay',
    toName: 'Carrizo Gorge',
    lengthKm: 10.27,
    designSpeedMph: 60,
    polyline: [
      P(32.82326, -116.55720), P(32.82318, -116.55506), P(32.82274, -116.55299),
      P(32.82193, -116.55109), P(32.82100, -116.54925), P(32.82008, -116.54741),
      P(32.81926, -116.54551), P(32.81879, -116.54345), P(32.81871, -116.54131),
      P(32.81889, -116.53919), P(32.81900, -116.53705), P(32.81893, -116.53491),
      P(32.81867, -116.53280), P(32.81821, -116.53073), P(32.81758, -116.52872),
      P(32.81677, -116.52681), P(32.81586, -116.52497), P(32.81500, -116.52309),
      P(32.81426, -116.52114), P(32.81370, -116.51911), P(32.81320, -116.51705),
      P(32.81271, -116.51499), P(32.81217, -116.51295), P(32.81145, -116.51099),
      P(32.81055, -116.50915), P(32.80946, -116.50744), P(32.80816, -116.50597),
      P(32.80684, -116.50452), P(32.80551, -116.50307), P(32.80416, -116.50166),
      P(32.80283, -116.50022), P(32.80140, -116.49893), P(32.79986, -116.49782),
      P(32.79825, -116.49688), P(32.79656, -116.49613), P(32.79483, -116.49557),
      P(32.79306, -116.49517), P(32.79127, -116.49490), P(32.78949, -116.49462),
      P(32.78771, -116.49433), P(32.78593, -116.49405), P(32.78415, -116.49376),
      P(32.78236, -116.49347), P(32.78058, -116.49318), P(32.77880, -116.49290),
      P(32.77701, -116.49263), P(32.77525, -116.49219), P(32.77354, -116.49154),
      P(32.77190, -116.49067), P(32.77032, -116.48966), P(32.76874, -116.48862),
      P(32.76717, -116.48759), P(32.76660, -116.48722),
    ],
    areas: [
      A('Guatay', 32.824, -116.556),
      A('Pine Valley', 32.822, -116.596),
      A('Carrizo Gorge', 32.745, -116.478),
    ],
  },
  {
    id: 'i-8-eb-carrizo-gorge-live-oak-springs',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Carrizo Gorge to Live Oak Springs',
    fromName: 'Carrizo Gorge',
    toName: 'Live Oak Springs',
    lengthKm: 10.11,
    designSpeedMph: 60,
    polyline: [
      P(32.76660, -116.48722), P(32.76503, -116.48618), P(32.76344, -116.48517),
      P(32.76181, -116.48428), P(32.76012, -116.48352), P(32.75841, -116.48289),
      P(32.75666, -116.48240), P(32.75489, -116.48203), P(32.75311, -116.48166),
      P(32.75134, -116.48127), P(32.74957, -116.48090), P(32.74780, -116.48055),
      P(32.74602, -116.48026), P(32.74423, -116.48000), P(32.74244, -116.47988),
      P(32.74064, -116.47984), P(32.73884, -116.47980), P(32.73704, -116.47976),
      P(32.73524, -116.47972), P(32.73345, -116.47968), P(32.73165, -116.47960),
      P(32.72987, -116.47932), P(32.72814, -116.47875), P(32.72647, -116.47796),
      P(32.72486, -116.47700), P(32.72326, -116.47603), P(32.72169, -116.47498),
      P(32.72036, -116.47356), P(32.71932, -116.47182), P(32.71863, -116.46985),
      P(32.71833, -116.46775), P(32.71841, -116.46561), P(32.71854, -116.46348),
      P(32.71866, -116.46135), P(32.71892, -116.45923), P(32.71945, -116.45720),
      P(32.72020, -116.45526), P(32.72115, -116.45345), P(32.72216, -116.45168),
      P(32.72312, -116.44987), P(32.72392, -116.44796), P(32.72453, -116.44594),
      P(32.72497, -116.44387), P(32.72521, -116.44175), P(32.72541, -116.43963),
      P(32.72562, -116.43751), P(32.72585, -116.43539), P(32.72618, -116.43328),
      P(32.72665, -116.43122), P(32.72716, -116.42917), P(32.72766, -116.42712),
      P(32.72794, -116.42597),
    ],
    areas: [
      A('Carrizo Gorge', 32.745, -116.478),
      A('Guatay', 32.824, -116.556),
      A('Live Oak Springs', 32.726, -116.425),
    ],
  },
  {
    id: 'i-8-eb-live-oak-springs-mccain-valley',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Live Oak Springs to McCain Valley',
    fromName: 'Live Oak Springs',
    toName: 'McCain Valley',
    lengthKm: 8.39,
    designSpeedMph: 60,
    polyline: [
      P(32.72794, -116.42597), P(32.72832, -116.42388), P(32.72847, -116.42175),
      P(32.72846, -116.41961), P(32.72814, -116.41751), P(32.72782, -116.41541),
      P(32.72751, -116.41330), P(32.72719, -116.41120), P(32.72687, -116.40909),
      P(32.72644, -116.40702), P(32.72590, -116.40498), P(32.72526, -116.40298),
      P(32.72450, -116.40105), P(32.72363, -116.39918), P(32.72271, -116.39734),
      P(32.72180, -116.39550), P(32.72088, -116.39366), P(32.71997, -116.39182),
      P(32.71905, -116.38998), P(32.71803, -116.38822), P(32.71679, -116.38668),
      P(32.71552, -116.38515), P(32.71426, -116.38363), P(32.71301, -116.38209),
      P(32.71189, -116.38043), P(32.71096, -116.37860), P(32.71016, -116.37669),
      P(32.70947, -116.37471), P(32.70886, -116.37270), P(32.70833, -116.37066),
      P(32.70778, -116.36862), P(32.70723, -116.36659), P(32.70667, -116.36456),
      P(32.70611, -116.36253), P(32.70556, -116.36049), P(32.70517, -116.35841),
      P(32.70489, -116.35630), P(32.70461, -116.35418), P(32.70433, -116.35207),
      P(32.70405, -116.34996), P(32.70377, -116.34785), P(32.70349, -116.34574),
      P(32.70323, -116.34376),
    ],
    areas: [
      A('Live Oak Springs', 32.726, -116.425),
      A('McCain Valley', 32.702, -116.362),
      A('Carrizo Gorge', 32.745, -116.478),
    ],
  },
  {
    id: 'i-8-eb-mccain-valley-boulevard',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: McCain Valley to Boulevard',
    fromName: 'McCain Valley',
    toName: 'Boulevard',
    lengthKm: 5.87,
    designSpeedMph: 60,
    polyline: [
      P(32.70323, -116.34376), P(32.70295, -116.34164), P(32.70267, -116.33953),
      P(32.70239, -116.33742), P(32.70211, -116.33531), P(32.70183, -116.33320),
      P(32.70155, -116.33109), P(32.70127, -116.32897), P(32.70099, -116.32686),
      P(32.70071, -116.32475), P(32.70028, -116.32268), P(32.69961, -116.32070),
      P(32.69872, -116.31884), P(32.69761, -116.31717), P(32.69637, -116.31562),
      P(32.69513, -116.31407), P(32.69389, -116.31252), P(32.69265, -116.31098),
      P(32.69140, -116.30944), P(32.69016, -116.30790), P(32.68891, -116.30635),
      P(32.68767, -116.30481), P(32.68642, -116.30327), P(32.68518, -116.30172),
      P(32.68393, -116.30018), P(32.68269, -116.29864), P(32.68144, -116.29710),
      P(32.68022, -116.29553), P(32.67898, -116.29398), P(32.67786, -116.29231),
      P(32.67752, -116.29169),
    ],
    areas: [
      A('McCain Valley', 32.702, -116.362),
      A('Live Oak Springs', 32.726, -116.425),
      A('Boulevard', 32.677, -116.292),
    ],
  },
  {
    id: 'i-8-eb-boulevard-jacumba',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Boulevard to Jacumba',
    fromName: 'Boulevard',
    toName: 'Jacumba',
    lengthKm: 10.27,
    designSpeedMph: 60,
    polyline: [
      P(32.67752, -116.29169), P(32.67667, -116.28981), P(32.67603, -116.28781),
      P(32.67547, -116.28578), P(32.67486, -116.28377), P(32.67428, -116.28175),
      P(32.67370, -116.27972), P(32.67313, -116.27770), P(32.67256, -116.27567),
      P(32.67198, -116.27365), P(32.67141, -116.27162), P(32.67083, -116.26960),
      P(32.67026, -116.26757), P(32.66969, -116.26555), P(32.66911, -116.26352),
      P(32.66854, -116.26150), P(32.66796, -116.25947), P(32.66739, -116.25745),
      P(32.66681, -116.25543), P(32.66623, -116.25340), P(32.66565, -116.25138),
      P(32.66508, -116.24936), P(32.66450, -116.24733), P(32.66392, -116.24531),
      P(32.66334, -116.24329), P(32.66275, -116.24127), P(32.66217, -116.23925),
      P(32.66158, -116.23723), P(32.66121, -116.23514), P(32.66113, -116.23301),
      P(32.66108, -116.23087), P(32.66106, -116.22874), P(32.66143, -116.22665),
      P(32.66186, -116.22458), P(32.66192, -116.22245), P(32.66183, -116.22032),
      P(32.66173, -116.21818), P(32.66164, -116.21605), P(32.66154, -116.21392),
      P(32.66137, -116.21179), P(32.66093, -116.20972), P(32.66023, -116.20776),
      P(32.65926, -116.20596), P(32.65810, -116.20434), P(32.65678, -116.20288),
      P(32.65546, -116.20144), P(32.65413, -116.19999), P(32.65281, -116.19855),
      P(32.65148, -116.19710), P(32.65030, -116.19549), P(32.64941, -116.19364),
      P(32.64864, -116.19171), P(32.64838, -116.19105),
    ],
    areas: [
      A('Boulevard', 32.677, -116.292),
      A('McCain Valley', 32.702, -116.362),
      A('Jacumba', 32.648, -116.191),
    ],
  },
  {
    id: 'i-8-eb-jacumba-in-ko-pah',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Jacumba to In-Ko-Pah',
    fromName: 'Jacumba',
    toName: 'In-Ko-Pah',
    lengthKm: 10.31,
    designSpeedMph: 60,
    polyline: [
      P(32.64838, -116.19105), P(32.64766, -116.18909), P(32.64695, -116.18713),
      P(32.64622, -116.18518), P(32.64548, -116.18323), P(32.64475, -116.18128),
      P(32.64400, -116.17933), P(32.64327, -116.17739), P(32.64245, -116.17549),
      P(32.64131, -116.17384), P(32.64016, -116.17219), P(32.63901, -116.17055),
      P(32.63787, -116.16890), P(32.63697, -116.16705), P(32.63633, -116.16506),
      P(32.63597, -116.16297), P(32.63571, -116.16086), P(32.63544, -116.15874),
      P(32.63517, -116.15663), P(32.63490, -116.15452), P(32.63463, -116.15241),
      P(32.63437, -116.15029), P(32.63424, -116.14817), P(32.63438, -116.14604),
      P(32.63458, -116.14392), P(32.63478, -116.14179), P(32.63498, -116.13967),
      P(32.63517, -116.13755), P(32.63537, -116.13543), P(32.63557, -116.13330),
      P(32.63577, -116.13118), P(32.63597, -116.12906), P(32.63617, -116.12693),
      P(32.63636, -116.12481), P(32.63656, -116.12269), P(32.63676, -116.12056),
      P(32.63695, -116.11844), P(32.63715, -116.11632), P(32.63734, -116.11419),
      P(32.63770, -116.11211), P(32.63860, -116.11028), P(32.64000, -116.10895),
      P(32.64160, -116.10797), P(32.64321, -116.10702), P(32.64482, -116.10607),
      P(32.64642, -116.10510), P(32.64802, -116.10411), P(32.64951, -116.10292),
      P(32.65098, -116.10168), P(32.65241, -116.10039), P(32.65395, -116.09932),
      P(32.65568, -116.09871), P(32.65666, -116.09838),
    ],
    areas: [
      A('Jacumba', 32.648, -116.191),
      A('Boulevard', 32.677, -116.292),
      A('In-Ko-Pah', 32.656, -116.097),
    ],
  },
  {
    id: 'i-8-eb-in-ko-pah-imperial-county-line',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: In-Ko-Pah to Imperial County Line',
    fromName: 'In-Ko-Pah',
    toName: 'Imperial County Line',
    lengthKm: 4.99,
    designSpeedMph: 60,
    polyline: [
      P(32.65666, -116.09838), P(32.65842, -116.09848), P(32.65985, -116.09973),
      P(32.66089, -116.10147), P(32.66164, -116.10341), P(32.66249, -116.10527),
      P(32.66397, -116.10642), P(32.66576, -116.10661), P(32.66755, -116.10659),
      P(32.66933, -116.10626), P(32.67111, -116.10618), P(32.67275, -116.10703),
      P(32.67448, -116.10750), P(32.67620, -116.10692), P(32.67775, -116.10586),
      P(32.67866, -116.10405), P(32.67866, -116.10193), P(32.67851, -116.09981),
      P(32.67910, -116.09780), P(32.67983, -116.09585), P(32.68059, -116.09391),
      P(32.68158, -116.09216), P(32.68317, -116.09127), P(32.68496, -116.09143),
      P(32.68671, -116.09192), P(32.68840, -116.09182),
    ],
    areas: [
      A('In-Ko-Pah', 32.656, -116.097),
      A('Jacumba', 32.648, -116.191),
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
  {
    id: 'i-8-wb-imperial-county-line-in-ko-pah',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Imperial County Line to In-Ko-Pah',
    fromName: 'Imperial County Line',
    toName: 'In-Ko-Pah',
    lengthKm: 4.99,
    designSpeedMph: 60,
    polyline: [
      P(32.68840, -116.09182), P(32.68671, -116.09192), P(32.68496, -116.09143),
      P(32.68317, -116.09127), P(32.68158, -116.09216), P(32.68059, -116.09391),
      P(32.67983, -116.09585), P(32.67910, -116.09780), P(32.67851, -116.09981),
      P(32.67866, -116.10193), P(32.67866, -116.10405), P(32.67775, -116.10586),
      P(32.67620, -116.10692), P(32.67448, -116.10750), P(32.67275, -116.10703),
      P(32.67111, -116.10618), P(32.66933, -116.10626), P(32.66755, -116.10659),
      P(32.66576, -116.10661), P(32.66397, -116.10642), P(32.66249, -116.10527),
      P(32.66164, -116.10341), P(32.66089, -116.10147), P(32.65985, -116.09973),
      P(32.65842, -116.09848), P(32.65666, -116.09838),
    ],
    areas: [
      A('In-Ko-Pah', 32.656, -116.097),
      A('Jacumba', 32.648, -116.191),
    ],
  },
  {
    id: 'i-8-wb-in-ko-pah-jacumba',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: In-Ko-Pah to Jacumba',
    fromName: 'In-Ko-Pah',
    toName: 'Jacumba',
    lengthKm: 10.31,
    designSpeedMph: 60,
    polyline: [
      P(32.65666, -116.09838), P(32.65568, -116.09871), P(32.65395, -116.09932),
      P(32.65241, -116.10039), P(32.65098, -116.10168), P(32.64951, -116.10292),
      P(32.64802, -116.10411), P(32.64642, -116.10510), P(32.64482, -116.10607),
      P(32.64321, -116.10702), P(32.64160, -116.10797), P(32.64000, -116.10895),
      P(32.63860, -116.11028), P(32.63770, -116.11211), P(32.63734, -116.11419),
      P(32.63715, -116.11632), P(32.63695, -116.11844), P(32.63676, -116.12056),
      P(32.63656, -116.12269), P(32.63636, -116.12481), P(32.63617, -116.12693),
      P(32.63597, -116.12906), P(32.63577, -116.13118), P(32.63557, -116.13330),
      P(32.63537, -116.13543), P(32.63517, -116.13755), P(32.63498, -116.13967),
      P(32.63478, -116.14179), P(32.63458, -116.14392), P(32.63438, -116.14604),
      P(32.63424, -116.14817), P(32.63437, -116.15029), P(32.63463, -116.15241),
      P(32.63490, -116.15452), P(32.63517, -116.15663), P(32.63544, -116.15874),
      P(32.63571, -116.16086), P(32.63597, -116.16297), P(32.63633, -116.16506),
      P(32.63697, -116.16705), P(32.63787, -116.16890), P(32.63901, -116.17055),
      P(32.64016, -116.17219), P(32.64131, -116.17384), P(32.64245, -116.17549),
      P(32.64327, -116.17739), P(32.64400, -116.17933), P(32.64475, -116.18128),
      P(32.64548, -116.18323), P(32.64622, -116.18518), P(32.64695, -116.18713),
      P(32.64766, -116.18909), P(32.64838, -116.19105),
    ],
    areas: [
      A('In-Ko-Pah', 32.656, -116.097),
      A('Jacumba', 32.648, -116.191),
      A('Boulevard', 32.677, -116.292),
    ],
  },
  {
    id: 'i-8-wb-jacumba-boulevard',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Jacumba to Boulevard',
    fromName: 'Jacumba',
    toName: 'Boulevard',
    lengthKm: 10.27,
    designSpeedMph: 60,
    polyline: [
      P(32.64838, -116.19105), P(32.64864, -116.19171), P(32.64941, -116.19364),
      P(32.65030, -116.19549), P(32.65148, -116.19710), P(32.65281, -116.19855),
      P(32.65413, -116.19999), P(32.65546, -116.20144), P(32.65678, -116.20288),
      P(32.65810, -116.20434), P(32.65926, -116.20596), P(32.66023, -116.20776),
      P(32.66093, -116.20972), P(32.66137, -116.21179), P(32.66154, -116.21392),
      P(32.66164, -116.21605), P(32.66173, -116.21818), P(32.66183, -116.22032),
      P(32.66192, -116.22245), P(32.66186, -116.22458), P(32.66143, -116.22665),
      P(32.66106, -116.22874), P(32.66108, -116.23087), P(32.66113, -116.23301),
      P(32.66121, -116.23514), P(32.66158, -116.23723), P(32.66217, -116.23925),
      P(32.66275, -116.24127), P(32.66334, -116.24329), P(32.66392, -116.24531),
      P(32.66450, -116.24733), P(32.66508, -116.24936), P(32.66565, -116.25138),
      P(32.66623, -116.25340), P(32.66681, -116.25543), P(32.66739, -116.25745),
      P(32.66796, -116.25947), P(32.66854, -116.26150), P(32.66911, -116.26352),
      P(32.66969, -116.26555), P(32.67026, -116.26757), P(32.67083, -116.26960),
      P(32.67141, -116.27162), P(32.67198, -116.27365), P(32.67256, -116.27567),
      P(32.67313, -116.27770), P(32.67370, -116.27972), P(32.67428, -116.28175),
      P(32.67486, -116.28377), P(32.67547, -116.28578), P(32.67603, -116.28781),
      P(32.67667, -116.28981), P(32.67752, -116.29169),
    ],
    areas: [
      A('Jacumba', 32.648, -116.191),
      A('Boulevard', 32.677, -116.292),
      A('In-Ko-Pah', 32.656, -116.097),
    ],
  },
  {
    id: 'i-8-wb-boulevard-mccain-valley',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Boulevard to McCain Valley',
    fromName: 'Boulevard',
    toName: 'McCain Valley',
    lengthKm: 5.87,
    designSpeedMph: 60,
    polyline: [
      P(32.67752, -116.29169), P(32.67786, -116.29231), P(32.67898, -116.29398),
      P(32.68022, -116.29553), P(32.68144, -116.29710), P(32.68269, -116.29864),
      P(32.68393, -116.30018), P(32.68518, -116.30172), P(32.68642, -116.30327),
      P(32.68767, -116.30481), P(32.68891, -116.30635), P(32.69016, -116.30790),
      P(32.69140, -116.30944), P(32.69265, -116.31098), P(32.69389, -116.31252),
      P(32.69513, -116.31407), P(32.69637, -116.31562), P(32.69761, -116.31717),
      P(32.69872, -116.31884), P(32.69961, -116.32070), P(32.70028, -116.32268),
      P(32.70071, -116.32475), P(32.70099, -116.32686), P(32.70127, -116.32897),
      P(32.70155, -116.33109), P(32.70183, -116.33320), P(32.70211, -116.33531),
      P(32.70239, -116.33742), P(32.70267, -116.33953), P(32.70295, -116.34164),
      P(32.70323, -116.34376),
    ],
    areas: [
      A('Boulevard', 32.677, -116.292),
      A('McCain Valley', 32.702, -116.362),
      A('Jacumba', 32.648, -116.191),
    ],
  },
  {
    id: 'i-8-wb-mccain-valley-live-oak-springs',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: McCain Valley to Live Oak Springs',
    fromName: 'McCain Valley',
    toName: 'Live Oak Springs',
    lengthKm: 8.39,
    designSpeedMph: 60,
    polyline: [
      P(32.70323, -116.34376), P(32.70349, -116.34574), P(32.70377, -116.34785),
      P(32.70405, -116.34996), P(32.70433, -116.35207), P(32.70461, -116.35418),
      P(32.70489, -116.35630), P(32.70517, -116.35841), P(32.70556, -116.36049),
      P(32.70611, -116.36253), P(32.70667, -116.36456), P(32.70723, -116.36659),
      P(32.70778, -116.36862), P(32.70833, -116.37066), P(32.70886, -116.37270),
      P(32.70947, -116.37471), P(32.71016, -116.37669), P(32.71096, -116.37860),
      P(32.71189, -116.38043), P(32.71301, -116.38209), P(32.71426, -116.38363),
      P(32.71552, -116.38515), P(32.71679, -116.38668), P(32.71803, -116.38822),
      P(32.71905, -116.38998), P(32.71997, -116.39182), P(32.72088, -116.39366),
      P(32.72180, -116.39550), P(32.72271, -116.39734), P(32.72363, -116.39918),
      P(32.72450, -116.40105), P(32.72526, -116.40298), P(32.72590, -116.40498),
      P(32.72644, -116.40702), P(32.72687, -116.40909), P(32.72719, -116.41120),
      P(32.72751, -116.41330), P(32.72782, -116.41541), P(32.72814, -116.41751),
      P(32.72846, -116.41961), P(32.72847, -116.42175), P(32.72832, -116.42388),
      P(32.72794, -116.42597),
    ],
    areas: [
      A('McCain Valley', 32.702, -116.362),
      A('Live Oak Springs', 32.726, -116.425),
      A('Boulevard', 32.677, -116.292),
    ],
  },
  {
    id: 'i-8-wb-live-oak-springs-carrizo-gorge',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Live Oak Springs to Carrizo Gorge',
    fromName: 'Live Oak Springs',
    toName: 'Carrizo Gorge',
    lengthKm: 10.11,
    designSpeedMph: 60,
    polyline: [
      P(32.72794, -116.42597), P(32.72766, -116.42712), P(32.72716, -116.42917),
      P(32.72665, -116.43122), P(32.72618, -116.43328), P(32.72585, -116.43539),
      P(32.72562, -116.43751), P(32.72541, -116.43963), P(32.72521, -116.44175),
      P(32.72497, -116.44387), P(32.72453, -116.44594), P(32.72392, -116.44796),
      P(32.72312, -116.44987), P(32.72216, -116.45168), P(32.72115, -116.45345),
      P(32.72020, -116.45526), P(32.71945, -116.45720), P(32.71892, -116.45923),
      P(32.71866, -116.46135), P(32.71854, -116.46348), P(32.71841, -116.46561),
      P(32.71833, -116.46775), P(32.71863, -116.46985), P(32.71932, -116.47182),
      P(32.72036, -116.47356), P(32.72169, -116.47498), P(32.72326, -116.47603),
      P(32.72486, -116.47700), P(32.72647, -116.47796), P(32.72814, -116.47875),
      P(32.72987, -116.47932), P(32.73165, -116.47960), P(32.73345, -116.47968),
      P(32.73524, -116.47972), P(32.73704, -116.47976), P(32.73884, -116.47980),
      P(32.74064, -116.47984), P(32.74244, -116.47988), P(32.74423, -116.48000),
      P(32.74602, -116.48026), P(32.74780, -116.48055), P(32.74957, -116.48090),
      P(32.75134, -116.48127), P(32.75311, -116.48166), P(32.75489, -116.48203),
      P(32.75666, -116.48240), P(32.75841, -116.48289), P(32.76012, -116.48352),
      P(32.76181, -116.48428), P(32.76344, -116.48517), P(32.76503, -116.48618),
      P(32.76660, -116.48722),
    ],
    areas: [
      A('Live Oak Springs', 32.726, -116.425),
      A('McCain Valley', 32.702, -116.362),
      A('Carrizo Gorge', 32.745, -116.478),
    ],
  },
  {
    id: 'i-8-wb-carrizo-gorge-guatay',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Carrizo Gorge to Guatay',
    fromName: 'Carrizo Gorge',
    toName: 'Guatay',
    lengthKm: 10.27,
    designSpeedMph: 60,
    polyline: [
      P(32.76660, -116.48722), P(32.76717, -116.48759), P(32.76874, -116.48862),
      P(32.77032, -116.48966), P(32.77190, -116.49067), P(32.77354, -116.49154),
      P(32.77525, -116.49219), P(32.77701, -116.49263), P(32.77880, -116.49290),
      P(32.78058, -116.49318), P(32.78236, -116.49347), P(32.78415, -116.49376),
      P(32.78593, -116.49405), P(32.78771, -116.49433), P(32.78949, -116.49462),
      P(32.79127, -116.49490), P(32.79306, -116.49517), P(32.79483, -116.49557),
      P(32.79656, -116.49613), P(32.79825, -116.49688), P(32.79986, -116.49782),
      P(32.80140, -116.49893), P(32.80283, -116.50022), P(32.80416, -116.50166),
      P(32.80551, -116.50307), P(32.80684, -116.50452), P(32.80816, -116.50597),
      P(32.80946, -116.50744), P(32.81055, -116.50915), P(32.81145, -116.51099),
      P(32.81217, -116.51295), P(32.81271, -116.51499), P(32.81320, -116.51705),
      P(32.81370, -116.51911), P(32.81426, -116.52114), P(32.81500, -116.52309),
      P(32.81586, -116.52497), P(32.81677, -116.52681), P(32.81758, -116.52872),
      P(32.81821, -116.53073), P(32.81867, -116.53280), P(32.81893, -116.53491),
      P(32.81900, -116.53705), P(32.81889, -116.53919), P(32.81871, -116.54131),
      P(32.81879, -116.54345), P(32.81926, -116.54551), P(32.82008, -116.54741),
      P(32.82100, -116.54925), P(32.82193, -116.55109), P(32.82274, -116.55299),
      P(32.82318, -116.55506), P(32.82326, -116.55720),
    ],
    areas: [
      A('Carrizo Gorge', 32.745, -116.478),
      A('Guatay', 32.824, -116.556),
      A('Live Oak Springs', 32.726, -116.425),
    ],
  },
  {
    id: 'i-8-wb-guatay-descanso-junction',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Guatay to Descanso Junction',
    fromName: 'Guatay',
    toName: 'Descanso Junction',
    lengthKm: 6.62,
    designSpeedMph: 60,
    polyline: [
      P(32.82326, -116.55720), P(32.82326, -116.55953), P(32.82325, -116.56167),
      P(32.82326, -116.56381), P(32.82299, -116.56593), P(32.82236, -116.56793),
      P(32.82150, -116.56981), P(32.82079, -116.57177), P(32.82053, -116.57388),
      P(32.82045, -116.57602), P(32.82039, -116.57816), P(32.82032, -116.58030),
      P(32.82026, -116.58243), P(32.82027, -116.58457), P(32.82056, -116.58668),
      P(32.82102, -116.58875), P(32.82147, -116.59082), P(32.82193, -116.59289),
      P(32.82239, -116.59496), P(32.82283, -116.59703), P(32.82328, -116.59911),
      P(32.82372, -116.60118), P(32.82416, -116.60326), P(32.82459, -116.60534),
      P(32.82486, -116.60745), P(32.82492, -116.60959), P(32.82479, -116.61172),
      P(32.82463, -116.61386), P(32.82447, -116.61599), P(32.82435, -116.61812),
      P(32.82459, -116.62024), P(32.82522, -116.62224), P(32.82620, -116.62403),
      P(32.82750, -116.62550),
    ],
    areas: [
      A('Guatay', 32.824, -116.556),
      A('Pine Valley', 32.822, -116.596),
      A('Carrizo Gorge', 32.745, -116.478),
    ],
  },
  {
    id: 'i-8-wb-descanso-junction-viejas',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Descanso Junction to Viejas',
    fromName: 'Descanso Junction',
    toName: 'Viejas',
    lengthKm: 7.41,
    designSpeedMph: 60,
    polyline: [
      P(32.82750, -116.62550), P(32.82911, -116.62674), P(32.83061, -116.62791),
      P(32.83195, -116.62934), P(32.83303, -116.63105), P(32.83384, -116.63295),
      P(32.83452, -116.63493), P(32.83521, -116.63691), P(32.83586, -116.63891),
      P(32.83641, -116.64095), P(32.83685, -116.64302), P(32.83731, -116.64509),
      P(32.83777, -116.64716), P(32.83823, -116.64923), P(32.83865, -116.65131),
      P(32.83871, -116.65345), P(32.83838, -116.65555), P(32.83794, -116.65762),
      P(32.83763, -116.65973), P(32.83772, -116.66186), P(32.83817, -116.66393),
      P(32.83864, -116.66600), P(32.83890, -116.66811), P(32.83875, -116.67024),
      P(32.83831, -116.67231), P(32.83797, -116.67441), P(32.83790, -116.67655),
      P(32.83810, -116.67867), P(32.83837, -116.68079), P(32.83863, -116.68291),
      P(32.83887, -116.68503), P(32.83896, -116.68717), P(32.83895, -116.68931),
      P(32.83894, -116.69145), P(32.83893, -116.69359), P(32.83892, -116.69573),
      P(32.83890, -116.69787), P(32.83889, -116.70001),
    ],
    areas: [
      A('Descanso', 32.852, -116.618),
      A('Pine Valley', 32.822, -116.596),
      A('Viejas', 32.838, -116.7),
    ],
  },
  {
    id: 'i-8-wb-viejas-alpine',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Viejas to Alpine',
    fromName: 'Viejas',
    toName: 'Alpine',
    lengthKm: 7.2,
    designSpeedMph: 60,
    polyline: [
      P(32.83889, -116.70001), P(32.83885, -116.70211), P(32.83860, -116.70423),
      P(32.83821, -116.70632), P(32.83782, -116.70841), P(32.83744, -116.71050),
      P(32.83705, -116.71259), P(32.83660, -116.71466), P(32.83586, -116.71661),
      P(32.83488, -116.71840), P(32.83405, -116.72029), P(32.83383, -116.72240),
      P(32.83401, -116.72453), P(32.83414, -116.72667), P(32.83403, -116.72880),
      P(32.83398, -116.73094), P(32.83423, -116.73306), P(32.83457, -116.73516),
      P(32.83490, -116.73726), P(32.83510, -116.73939), P(32.83502, -116.74152),
      P(32.83486, -116.74366), P(32.83475, -116.74579), P(32.83488, -116.74792),
      P(32.83523, -116.75002), P(32.83578, -116.75206), P(32.83635, -116.75409),
      P(32.83693, -116.75612), P(32.83750, -116.75814), P(32.83808, -116.76017),
      P(32.83851, -116.76225), P(32.83884, -116.76435), P(32.83916, -116.76646),
      P(32.83948, -116.76857), P(32.83980, -116.77067), P(32.84012, -116.77278),
      P(32.84044, -116.77488),
    ],
    areas: [
      A('Viejas', 32.838, -116.7),
      A('Alpine', 32.835, -116.766),
      A('Descanso', 32.852, -116.618),
    ],
  },

  // ------------------------------------------------------------- Wave A (Nov 1, 2026)
  // Coverage fill program Wave A: SR-75, Coronado + the Silver Strand + Palm Ave.
  // Geometry: real OSM traces (junction-graph routing, fill-wave-a/GEOMETRY.md).
  {
    id: 'sr-75-sb-downtown-san-diego-coronado',
    freeway: 'SR-75',
    direction: 'southbound',
    displayName: 'SR-75 South: Downtown San Diego to Coronado',
    fromName: 'Downtown San Diego',
    toName: 'Coronado',
    lengthKm: 3.9,
    designSpeedMph: 50,
    polyline: [
      P(32.69937, -117.14406), P(32.6932, -117.14998), P(32.68763, -117.15564),
      P(32.68694, -117.16106), P(32.69149, -117.16776), P(32.69284, -117.17034),
      P(32.69408, -117.17109), P(32.69458, -117.17122), P(32.69594, -117.1741),
    ],
    areas: [
      A('Downtown San Diego', 32.717, -117.162),
      A('Barrio Logan', 32.7, -117.142),
      A('Coronado', 32.686, -117.176),
    ],
  },
  {
    id: 'sr-75-sb-through-coronado',
    freeway: 'SR-75',
    direction: 'southbound',
    displayName: 'SR-75 South: Through Coronado',
    fromName: 'Coronado',
    toName: 'Coronado',
    lengthKm: 3.6,
    designSpeedMph: 30,
    polyline: [
      P(32.69594, -117.1741), P(32.6893, -117.17797), P(32.68557, -117.18006),
      P(32.68482, -117.17982), P(32.6838, -117.17895), P(32.67727, -117.17301),
      P(32.6703, -117.16444), P(32.66994, -117.16403),
    ],
    areas: [
      A('Coronado', 32.686, -117.176),
      A('Glorietta Bay', 32.668, -117.163),
    ],
  },
  {
    id: 'sr-75-sb-coronado-coronado-cays',
    freeway: 'SR-75',
    direction: 'southbound',
    displayName: 'SR-75 South: Coronado to Coronado Cays',
    fromName: 'Coronado',
    toName: 'Coronado Cays',
    lengthKm: 5.1,
    designSpeedMph: 55,
    polyline: [
      P(32.66994, -117.16403), P(32.66058, -117.15643), P(32.65395, -117.15215),
      P(32.64724, -117.14787), P(32.63714, -117.14278), P(32.62974, -117.13946),
      P(32.6296, -117.13941),
    ],
    areas: [
      A('Glorietta Bay', 32.668, -117.163),
      A('Naval Amphibious Base Coronado', 32.645, -117.145),
      A('Coronado Cays', 32.625, -117.133),
    ],
  },
  {
    id: 'sr-75-sb-coronado-cays-imperial-beach',
    freeway: 'SR-75',
    direction: 'southbound',
    displayName: 'SR-75 South: Coronado Cays to Imperial Beach',
    fromName: 'Coronado Cays',
    toName: 'Imperial Beach',
    lengthKm: 5.8,
    designSpeedMph: 50,
    polyline: [
      P(32.6296, -117.13941), P(32.62228, -117.13697), P(32.61449, -117.13496),
      P(32.60705, -117.13078), P(32.60387, -117.12514), P(32.59732, -117.12266),
      P(32.59418, -117.12275), P(32.58673, -117.12127), P(32.58411, -117.11707),
    ],
    areas: [
      A('Coronado Cays', 32.625, -117.133),
      A('Silver Strand State Beach', 32.595, -117.128),
      A('Imperial Beach', 32.584, -117.117),
    ],
  },
  {
    id: 'sr-75-sb-through-imperial-beach',
    freeway: 'SR-75',
    direction: 'southbound',
    displayName: 'SR-75 South: Through Imperial Beach',
    fromName: 'Imperial Beach',
    toName: 'Imperial Beach',
    lengthKm: 2.1,
    designSpeedMph: 40,
    polyline: [
      P(32.58411, -117.11707), P(32.58381, -117.10837), P(32.58376, -117.09963),
      P(32.58374, -117.09487),
    ],
    areas: [
      A('Imperial Beach', 32.584, -117.117),
    ],
  },
  {
    id: 'sr-75-nb-through-imperial-beach',
    freeway: 'SR-75',
    direction: 'northbound',
    displayName: 'SR-75 North: Through Imperial Beach',
    fromName: 'Imperial Beach',
    toName: 'Imperial Beach',
    lengthKm: 2.2,
    designSpeedMph: 40,
    polyline: [
      P(32.58392, -117.09362), P(32.58395, -117.10457), P(32.58398, -117.11369),
      P(32.58424, -117.11698),
    ],
    areas: [
      A('Imperial Beach', 32.584, -117.117),
    ],
  },
  {
    id: 'sr-75-nb-imperial-beach-coronado-cays',
    freeway: 'SR-75',
    direction: 'northbound',
    displayName: 'SR-75 North: Imperial Beach to Coronado Cays',
    fromName: 'Imperial Beach',
    toName: 'Coronado Cays',
    lengthKm: 5.8,
    designSpeedMph: 50,
    polyline: [
      P(32.58424, -117.11698), P(32.58719, -117.12143), P(32.59457, -117.12258),
      P(32.60309, -117.12455), P(32.60525, -117.12678), P(32.61074, -117.13347),
      P(32.61871, -117.13577), P(32.62729, -117.13843), P(32.62965, -117.13922),
    ],
    areas: [
      A('Imperial Beach', 32.584, -117.117),
      A('Silver Strand State Beach', 32.595, -117.128),
      A('Coronado Cays', 32.625, -117.133),
    ],
  },
  {
    id: 'sr-75-nb-coronado-cays-coronado',
    freeway: 'SR-75',
    direction: 'northbound',
    displayName: 'SR-75 North: Coronado Cays to Coronado',
    fromName: 'Coronado Cays',
    toName: 'Coronado',
    lengthKm: 5.1,
    designSpeedMph: 55,
    polyline: [
      P(32.62965, -117.13922), P(32.63721, -117.14262), P(32.64613, -117.14702),
      P(32.65336, -117.15163), P(32.66029, -117.15603), P(32.66891, -117.16289),
      P(32.67002, -117.16392),
    ],
    areas: [
      A('Coronado Cays', 32.625, -117.133),
      A('Naval Amphibious Base Coronado', 32.645, -117.145),
      A('Glorietta Bay', 32.668, -117.163),
    ],
  },
  {
    id: 'sr-75-nb-through-coronado',
    freeway: 'SR-75',
    direction: 'northbound',
    displayName: 'SR-75 North: Through Coronado',
    fromName: 'Coronado',
    toName: 'Coronado',
    lengthKm: 3.4,
    designSpeedMph: 30,
    polyline: [
      P(32.67002, -117.16392), P(32.67547, -117.17015), P(32.6796, -117.17576),
      P(32.68333, -117.17869), P(32.68437, -117.17901), P(32.68513, -117.17977),
      P(32.68577, -117.1798), P(32.69293, -117.17562), P(32.69444, -117.17474),
    ],
    areas: [
      A('Glorietta Bay', 32.668, -117.163),
      A('Coronado', 32.686, -117.176),
    ],
  },
  {
    id: 'sr-75-nb-coronado-downtown-san-diego',
    freeway: 'SR-75',
    direction: 'northbound',
    displayName: 'SR-75 North: Coronado to Downtown San Diego',
    fromName: 'Coronado',
    toName: 'Downtown San Diego',
    lengthKm: 3.9,
    designSpeedMph: 50,
    polyline: [
      P(32.69444, -117.17474), P(32.69048, -117.16715), P(32.68663, -117.16002),
      P(32.68811, -117.15486), P(32.69463, -117.14846), P(32.6998, -117.14304),
    ],
    areas: [
      A('Coronado', 32.686, -117.176),
      A('Barrio Logan', 32.7, -117.142),
      A('Downtown San Diego', 32.717, -117.162),
    ],
  },
  // ------------------------------------------------------------- Corridor arm offsets (Nov 25, 2026)
  // Third tellings on OFFSET segmentations for the top-100 AADT segment-
  // directions: each twin starts at a mid-stretch join and ends one boundary
  // beyond its parent. Seating vs their parents is governed by the flagged
  // overlap rule — see corridor-arm-report-2026-11-25.md (step zero).
  // ---- I-5 offsets
  {
    id: 'i-5-sb-downtown-barrio-logan-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Downtown San Diego to National City',
    fromName: 'Downtown San Diego',
    toName: 'National City',
    lengthKm: 4.8,
    designSpeedMph: 60,
    polyline: [
      P(32.701, -117.149), P(32.6937, -117.1383), P(32.686, -117.127),
      P(32.672, -117.112),
    ],
    areas: [
      A('Barrio Logan', 32.7, -117.142),
      A('National City', 32.678, -117.117),
    ],
  },
  {
    id: 'i-5-nb-barrio-logan-downtown-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Barrio Logan to Mission Hills',
    fromName: 'Barrio Logan',
    toName: 'Mission Hills',
    lengthKm: 6.1,
    designSpeedMph: 60,
    polyline: [
      P(32.701, -117.149), P(32.709, -117.156), P(32.7175, -117.1645),
      P(32.724, -117.168), P(32.7355, -117.179), P(32.746, -117.186),
    ],
    areas: [
      A('Barrio Logan', 32.7, -117.142),
      A('Downtown San Diego', 32.717, -117.162),
      A('Little Italy', 32.725, -117.169),
      A('San Diego International Airport', 32.736, -117.183),
      A('Mission Hills', 32.75, -117.178),
    ],
  },
  {
    id: 'i-5-nb-national-city-barrio-logan-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: National City to Downtown',
    fromName: 'National City',
    toName: 'Downtown',
    lengthKm: 5,
    designSpeedMph: 60,
    polyline: [
      P(32.686, -117.127), P(32.6937, -117.1383), P(32.701, -117.149),
      P(32.709, -117.156), P(32.7175, -117.1645),
    ],
    areas: [
      A('National City', 32.678, -117.117),
      A('Barrio Logan', 32.7, -117.142),
      A('Downtown San Diego', 32.717, -117.162),
    ],
  },
  {
    id: 'i-5-sb-barrio-logan-national-city-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Barrio Logan to Chula Vista',
    fromName: 'Barrio Logan',
    toName: 'Chula Vista',
    lengthKm: 6.6,
    designSpeedMph: 60,
    polyline: [
      P(32.686, -117.127), P(32.672, -117.112), P(32.6555, -117.0965),
      P(32.64, -117.083),
    ],
    areas: [
      A('National City', 32.678, -117.117),
      A('Chula Vista', 32.64, -117.084),
    ],
  },
  {
    id: 'i-5-so-palomar-airport-rd-carlsbad-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Oceanside to La Costa Ave',
    fromName: 'Oceanside',
    toName: 'La Costa Ave',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(33.11241, -117.31608), P(33.10817, -117.31352), P(33.10299, -117.31028),
      P(33.09959, -117.30828), P(33.09527, -117.30526), P(33.09066, -117.30227),
      P(33.08435, -117.29843),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-no-carlsbad-palomar-airport-rd-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Oceanside to Carlsbad',
    fromName: 'Oceanside',
    toName: 'Carlsbad',
    lengthKm: 4.6,
    designSpeedMph: 60,
    polyline: [
      P(33.11241, -117.31608), P(33.11865, -117.31999), P(33.12178, -117.32185),
      P(33.12589, -117.32445), P(33.13137, -117.32761), P(33.13713, -117.33083),
      P(33.14159, -117.33309), P(33.14637, -117.33379), P(33.1501, -117.33522),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-so-la-costa-ave-encinitas-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Carlsbad to Encinitas',
    fromName: 'Carlsbad',
    toName: 'Encinitas',
    lengthKm: 4.7,
    designSpeedMph: 60,
    polyline: [
      P(33.06597, -117.29235), P(33.06136, -117.29132), P(33.05484, -117.2891),
      P(33.05252, -117.28848), P(33.04836, -117.28723), P(33.04438, -117.28621),
      P(33.0404, -117.28425), P(33.03568, -117.28108), P(33.03167, -117.2782),
      P(33.02687, -117.27515),
    ],
    areas: [
      A('Encinitas', 33.03, -117.285),
    ],
  },
  {
    id: 'i-5-no-encinitas-la-costa-ave-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Encinitas to Carlsbad',
    fromName: 'Encinitas',
    toName: 'Carlsbad',
    lengthKm: 4.5,
    designSpeedMph: 60,
    polyline: [
      P(33.06597, -117.29235), P(33.07378, -117.29471), P(33.07999, -117.29692),
      P(33.08435, -117.29843), P(33.09066, -117.30227), P(33.09527, -117.30526),
      P(33.09959, -117.30828), P(33.10299, -117.31028),
    ],
    areas: [
      A('Encinitas', 33.03, -117.285),
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-no-la-costa-ave-carlsbad-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Encinitas to Palomar Airport Rd',
    fromName: 'Encinitas',
    toName: 'Palomar Airport Rd',
    lengthKm: 3.3,
    designSpeedMph: 60,
    polyline: [
      P(33.09527, -117.30526), P(33.09959, -117.30828), P(33.10299, -117.31028),
      P(33.10817, -117.31352), P(33.11241, -117.31608), P(33.11865, -117.31999),
      P(33.12178, -117.32185),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-so-carlsbad-la-costa-ave-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Oceanside to Encinitas',
    fromName: 'Oceanside',
    toName: 'Encinitas',
    lengthKm: 4.8,
    designSpeedMph: 60,
    polyline: [
      P(33.09527, -117.30526), P(33.09066, -117.30227), P(33.08435, -117.29843),
      P(33.07999, -117.29692), P(33.07378, -117.29471), P(33.06597, -117.29235),
      P(33.06136, -117.29132), P(33.05484, -117.2891),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
      A('Encinitas', 33.03, -117.285),
    ],
  },
  {
    id: 'i-5-so-carlsbad-palomar-airport-rd-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Encinitas to Carlsbad',
    fromName: 'Encinitas',
    toName: 'Carlsbad',
    lengthKm: 4.3,
    designSpeedMph: 60,
    polyline: [
      P(33.13713, -117.33083), P(33.13137, -117.32761), P(33.12589, -117.32445),
      P(33.12178, -117.32185), P(33.11865, -117.31999), P(33.11241, -117.31608),
      P(33.10817, -117.31352), P(33.10299, -117.31028),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-no-palomar-airport-rd-carlsbad-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Solana Beach to Carlsbad',
    fromName: 'Solana Beach',
    toName: 'Carlsbad',
    lengthKm: 3.9,
    designSpeedMph: 60,
    polyline: [
      P(33.13713, -117.33083), P(33.14159, -117.33309), P(33.14637, -117.33379),
      P(33.1501, -117.33522), P(33.15539, -117.33825), P(33.16059, -117.34088),
      P(33.16523, -117.34339), P(33.16955, -117.34565),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-no-through-sorrento-valley-2-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Solana Beach to Del Mar',
    fromName: 'Solana Beach',
    toName: 'Del Mar',
    lengthKm: 4.5,
    designSpeedMph: 60,
    polyline: [
      P(32.93762, -117.24143), P(32.94525, -117.24298), P(32.95007, -117.24374),
      P(32.95396, -117.24445), P(32.95918, -117.24564), P(32.96333, -117.24702),
      P(32.97173, -117.25), P(32.97678, -117.25208),
    ],
    areas: [
      A('Del Mar', 32.96, -117.265),
      A('Solana Beach', 32.985, -117.271),
    ],
  },
  {
    id: 'i-5-so-through-sorrento-valley-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Solana Beach to Sorrento Valley',
    fromName: 'Solana Beach',
    toName: 'Sorrento Valley',
    lengthKm: 5,
    designSpeedMph: 60,
    polyline: [
      P(32.93762, -117.24143), P(32.93244, -117.24121), P(32.92763, -117.24015),
      P(32.9236, -117.2388), P(32.92319, -117.23863), P(32.91933, -117.23609),
      P(32.91468, -117.23067), P(32.89544, -117.22702),
    ],
    areas: [
      A('Sorrento Valley', 32.935, -117.215),
    ],
  },
  {
    id: 'i-5-no-through-carlsbad-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Encinitas to Oceanside',
    fromName: 'Encinitas',
    toName: 'Oceanside',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(33.16059, -117.34088), P(33.16523, -117.34339), P(33.16955, -117.34565),
      P(33.17522, -117.34993), P(33.1801, -117.35364), P(33.18428, -117.35744),
      P(33.18852, -117.36097), P(33.1923, -117.36393),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
      A('Oceanside', 33.196, -117.34),
    ],
  },
  {
    id: 'i-5-so-through-carlsbad-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Oceanside to Palomar Airport Rd',
    fromName: 'Oceanside',
    toName: 'Palomar Airport Rd',
    lengthKm: 4.7,
    designSpeedMph: 60,
    polyline: [
      P(33.16059, -117.34088), P(33.15539, -117.33825), P(33.1501, -117.33522),
      P(33.14637, -117.33379), P(33.14159, -117.33309), P(33.13713, -117.33083),
      P(33.13137, -117.32761), P(33.12589, -117.32445), P(33.12178, -117.32185),
    ],
    areas: [
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-so-del-mar-sorrento-valley-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Encinitas to Sorrento Valley',
    fromName: 'Encinitas',
    toName: 'Sorrento Valley',
    lengthKm: 4.5,
    designSpeedMph: 60,
    polyline: [
      P(32.96333, -117.24702), P(32.95918, -117.24564), P(32.95396, -117.24445),
      P(32.95007, -117.24374), P(32.94525, -117.24298), P(32.93762, -117.24143),
      P(32.93244, -117.24121), P(32.92763, -117.24015), P(32.9236, -117.2388),
    ],
    areas: [
      A('Del Mar', 32.96, -117.265),
      A('Sorrento Valley', 32.935, -117.215),
    ],
  },
  {
    id: 'i-5-no-sorrento-valley-del-mar-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Encinitas to Solana Beach',
    fromName: 'Encinitas',
    toName: 'Solana Beach',
    lengthKm: 4.1,
    designSpeedMph: 60,
    polyline: [
      P(32.96333, -117.24702), P(32.97173, -117.25), P(32.97678, -117.25208),
      P(32.98109, -117.2537), P(32.9886, -117.25547), P(32.99405, -117.25648),
      P(32.99938, -117.257),
    ],
    areas: [
      A('Del Mar', 32.96, -117.265),
      A('Solana Beach', 32.985, -117.271),
    ],
  },
  {
    id: 'i-5-so-through-encinitas-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Del Mar to Solana Beach',
    fromName: 'Del Mar',
    toName: 'Solana Beach',
    lengthKm: 5.3,
    designSpeedMph: 60,
    polyline: [
      P(33.0404, -117.28425), P(33.03568, -117.28108), P(33.03167, -117.2782),
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
    id: 'i-5-no-through-encinitas-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Solana Beach to La Costa Ave',
    fromName: 'Solana Beach',
    toName: 'La Costa Ave',
    lengthKm: 5.1,
    designSpeedMph: 60,
    polyline: [
      P(33.0404, -117.28425), P(33.04438, -117.28621), P(33.04836, -117.28723),
      P(33.05252, -117.28848), P(33.05484, -117.2891), P(33.06136, -117.29132),
      P(33.06597, -117.29235), P(33.07378, -117.29471), P(33.07999, -117.29692),
      P(33.08435, -117.29843),
    ],
    areas: [
      A('Encinitas', 33.03, -117.285),
    ],
  },
  {
    id: 'i-5-so-oceanside-carlsbad-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Camp Pendleton to Carlsbad',
    fromName: 'Camp Pendleton',
    toName: 'Carlsbad',
    lengthKm: 3.8,
    designSpeedMph: 60,
    polyline: [
      P(33.1801, -117.35364), P(33.17522, -117.34993), P(33.16955, -117.34565),
      P(33.16523, -117.34339), P(33.16059, -117.34088), P(33.15539, -117.33825),
      P(33.1501, -117.33522),
    ],
    areas: [
      A('Oceanside', 33.196, -117.34),
      A('Carlsbad', 33.13, -117.32),
    ],
  },
  {
    id: 'i-5-no-carlsbad-oceanside-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Camp Pendleton to Oceanside',
    fromName: 'Camp Pendleton',
    toName: 'Oceanside',
    lengthKm: 5.7,
    designSpeedMph: 60,
    polyline: [
      P(33.1801, -117.35364), P(33.18428, -117.35744), P(33.18852, -117.36097),
      P(33.1923, -117.36393), P(33.19704, -117.36792), P(33.20014, -117.37183),
      P(33.20206, -117.37723), P(33.20401, -117.38242), P(33.20755, -117.38545),
      P(33.21251, -117.38854), P(33.21667, -117.39028), P(33.21887, -117.39102),
    ],
    areas: [
      A('Oceanside', 33.196, -117.34),
    ],
  },
  {
    id: 'i-5-no-del-mar-solana-beach-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Del Mar to Encinitas',
    fromName: 'Del Mar',
    toName: 'Encinitas',
    lengthKm: 4.8,
    designSpeedMph: 60,
    polyline: [
      P(32.9886, -117.25547), P(32.99405, -117.25648), P(32.99938, -117.257),
      P(33.00489, -117.2588), P(33.00982, -117.26403), P(33.01285, -117.2675),
      P(33.01638, -117.27118), P(33.02018, -117.273), P(33.02515, -117.27421),
      P(33.02687, -117.27515),
    ],
    areas: [
      A('Solana Beach', 32.985, -117.271),
      A('Encinitas', 33.03, -117.285),
    ],
  },
  {
    id: 'i-5-so-solana-beach-del-mar-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: University City to Sorrento Valley',
    fromName: 'University City',
    toName: 'Sorrento Valley',
    lengthKm: 4,
    designSpeedMph: 60,
    polyline: [
      P(32.9886, -117.25547), P(32.98109, -117.2537), P(32.97678, -117.25208),
      P(32.97173, -117.25), P(32.96333, -117.24702), P(32.95918, -117.24564),
      P(32.95396, -117.24445),
    ],
    areas: [
      A('Solana Beach', 32.985, -117.271),
      A('Del Mar', 32.96, -117.265),
    ],
  },
  {
    id: 'i-5-nb-chula-vista-national-city-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Chula Vista to Barrio Logan',
    fromName: 'Chula Vista',
    toName: 'Barrio Logan',
    lengthKm: 5.8,
    designSpeedMph: 60,
    polyline: [
      P(32.6555, -117.0965), P(32.672, -117.112), P(32.686, -117.127),
      P(32.6937, -117.1383),
    ],
    areas: [
      A('Chula Vista', 32.64, -117.084),
      A('National City', 32.678, -117.117),
    ],
  },
  {
    id: 'i-5-sb-national-city-chula-vista-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: National City to South Chula Vista',
    fromName: 'National City',
    toName: 'South Chula Vista',
    lengthKm: 5.1,
    designSpeedMph: 60,
    polyline: [
      P(32.6555, -117.0965), P(32.64, -117.083), P(32.6175, -117.0665),
    ],
    areas: [
      A('National City', 32.678, -117.117),
      A('Chula Vista', 32.64, -117.084),
    ],
  },
  {
    id: 'i-5-sb-chula-vista-south-chula-vista-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Otay Valley Regional Park to South Chula Vista',
    fromName: 'Otay Valley Regional Park',
    toName: 'South Chula Vista',
    lengthKm: 1.5,
    designSpeedMph: 60,
    polyline: [
      P(32.62875, -117.07475), P(32.6175, -117.0665),
    ],
    areas: [
      A('Chula Vista', 32.64, -117.084),
    ],
  },
  {
    id: 'i-5-nb-south-chula-vista-chula-vista-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Otay Valley Regional Park to National City',
    fromName: 'Otay Valley Regional Park',
    toName: 'National City',
    lengthKm: 6,
    designSpeedMph: 60,
    polyline: [
      P(32.62875, -117.07475), P(32.64, -117.083), P(32.6555, -117.0965),
      P(32.672, -117.112),
    ],
    areas: [
      A('Chula Vista', 32.64, -117.084),
      A('National City', 32.678, -117.117),
    ],
  },
  {
    id: 'i-5-sb-mission-bay-old-town-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Mission Bay to Mission Hills',
    fromName: 'Mission Bay',
    toName: 'Mission Hills',
    lengthKm: 5.3,
    designSpeedMph: 60,
    polyline: [
      P(32.786, -117.216), P(32.77, -117.206), P(32.763, -117.201),
      P(32.7555, -117.1955), P(32.746, -117.186),
    ],
    areas: [
      A('Mission Bay', 32.778, -117.214),
      A('Old Town', 32.754, -117.197),
      A('Mission Hills', 32.75, -117.178),
    ],
  },
  {
    id: 'i-5-nb-mission-bay-pacific-beach-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Mission Bay to La Jolla',
    fromName: 'Mission Bay',
    toName: 'La Jolla',
    lengthKm: 5.8,
    designSpeedMph: 60,
    polyline: [
      P(32.786, -117.216), P(32.799, -117.2245), P(32.8012, -117.2253),
      P(32.808, -117.228), P(32.825, -117.2285), P(32.836, -117.2282),
    ],
    areas: [
      A('Mission Bay', 32.778, -117.214),
      A('Pacific Beach', 32.802, -117.235),
    ],
  },
  {
    id: 'i-5-nb-mission-hills-mission-bay-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Old Town to Pacific Beach',
    fromName: 'Old Town',
    toName: 'Pacific Beach',
    lengthKm: 5.8,
    designSpeedMph: 60,
    polyline: [
      P(32.7555, -117.1955), P(32.763, -117.201), P(32.77, -117.206),
      P(32.786, -117.216), P(32.799, -117.2245), P(32.8012, -117.2253),
    ],
    areas: [
      A('Mission Hills', 32.75, -117.178),
      A('Old Town', 32.754, -117.197),
      A('Mission Bay', 32.778, -117.214),
    ],
  },
  {
    id: 'i-5-sb-old-town-mission-hills-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Old Town to Downtown',
    fromName: 'Old Town',
    toName: 'Downtown',
    lengthKm: 5.2,
    designSpeedMph: 60,
    polyline: [
      P(32.7555, -117.1955), P(32.746, -117.186), P(32.7355, -117.179),
      P(32.724, -117.168), P(32.7175, -117.1645),
    ],
    areas: [
      A('Old Town', 32.754, -117.197),
      A('Mission Hills', 32.75, -117.178),
      A('San Diego International Airport', 32.736, -117.183),
      A('Little Italy', 32.725, -117.169),
      A('Downtown San Diego', 32.717, -117.162),
    ],
  },
  {
    id: 'i-5-so-encinitas-solana-beach-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Encinitas to Del Mar',
    fromName: 'Encinitas',
    toName: 'Del Mar',
    lengthKm: 4.4,
    designSpeedMph: 60,
    polyline: [
      P(33.01285, -117.2675), P(33.00982, -117.26403), P(33.00489, -117.2588),
      P(32.99938, -117.257), P(32.99405, -117.25648), P(32.9886, -117.25547),
      P(32.98109, -117.2537), P(32.97678, -117.25208),
    ],
    areas: [
      A('Solana Beach', 32.985, -117.271),
      A('Del Mar', 32.96, -117.265),
    ],
  },
  {
    id: 'i-5-no-solana-beach-encinitas-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Carlsbad to Encinitas',
    fromName: 'Carlsbad',
    toName: 'Encinitas',
    lengthKm: 5.2,
    designSpeedMph: 60,
    polyline: [
      P(33.01285, -117.2675), P(33.01638, -117.27118), P(33.02018, -117.273),
      P(33.02515, -117.27421), P(33.02687, -117.27515), P(33.03167, -117.2782),
      P(33.03568, -117.28108), P(33.0404, -117.28425), P(33.04438, -117.28621),
      P(33.04836, -117.28723), P(33.05252, -117.28848), P(33.05484, -117.2891),
    ],
    areas: [
      A('Encinitas', 33.03, -117.285),
    ],
  },
  {
    id: 'i-5-sb-mission-hills-downtown-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: San Diego International Airport to Barrio Logan',
    fromName: 'San Diego International Airport',
    toName: 'Barrio Logan',
    lengthKm: 6.1,
    designSpeedMph: 60,
    polyline: [
      P(32.7355, -117.179), P(32.724, -117.168), P(32.7175, -117.1645),
      P(32.709, -117.156), P(32.701, -117.149), P(32.6937, -117.1383),
    ],
    areas: [
      A('Mission Hills', 32.75, -117.178),
      A('San Diego International Airport', 32.736, -117.183),
      A('Little Italy', 32.725, -117.169),
      A('Downtown San Diego', 32.717, -117.162),
      A('Barrio Logan', 32.7, -117.142),
    ],
  },
  {
    id: 'i-5-nb-downtown-mission-hills-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: San Diego International Airport to Mission Bay',
    fromName: 'San Diego International Airport',
    toName: 'Mission Bay',
    lengthKm: 4.6,
    designSpeedMph: 60,
    polyline: [
      P(32.7355, -117.179), P(32.746, -117.186), P(32.7555, -117.1955),
      P(32.763, -117.201), P(32.77, -117.206),
    ],
    areas: [
      A('San Diego International Airport', 32.736, -117.183),
      A('Mission Hills', 32.75, -117.178),
      A('Old Town', 32.754, -117.197),
    ],
  },
  {
    id: 'i-5-nb-palm-avenue-south-chula-vista-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Otay Valley Regional Park to South Chula Vista',
    fromName: 'Otay Valley Regional Park',
    toName: 'South Chula Vista',
    lengthKm: 1.9,
    designSpeedMph: 60,
    polyline: [
      P(32.59906, -117.08948), P(32.60754, -117.09054), P(32.61563, -117.09148),
    ],
    areas: [
      A('Otay Valley Regional Park', 32.589, -117.06),
    ],
  },
  {
    id: 'i-5-sb-south-chula-vista-palm-avenue-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Otay Valley Regional Park to San Ysidro',
    fromName: 'Otay Valley Regional Park',
    toName: 'San Ysidro',
    lengthKm: 8.4,
    designSpeedMph: 60,
    polyline: [
      P(32.59906, -117.08948), P(32.59194, -117.0885), P(32.58467, -117.08759),
      P(32.58151, -117.08686), P(32.58068, -117.0864), P(32.57283, -117.07964),
      P(32.56585, -117.07431), P(32.56023, -117.06577), P(32.55262, -117.04863),
      P(32.549, -117.03984), P(32.54611, -117.03538),
    ],
    areas: [
      A('Otay Valley Regional Park', 32.589, -117.06),
      A('San Ysidro', 32.552, -117.043),
    ],
  },
  {
    id: 'i-5-nb-pacific-beach-la-jolla-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Pacific Beach to North La Jolla',
    fromName: 'Pacific Beach',
    toName: 'North La Jolla',
    lengthKm: 5.1,
    designSpeedMph: 60,
    polyline: [
      P(32.825, -117.2285), P(32.836, -117.2282), P(32.8435, -117.228),
      P(32.8515, -117.2315), P(32.864, -117.2295), P(32.8705, -117.2285),
    ],
    areas: [
      A('Pacific Beach', 32.802, -117.235),
      A('La Jolla', 32.85, -117.238),
      A('University City', 32.862, -117.224),
    ],
  },
  {
    id: 'i-5-sb-pacific-beach-mission-bay-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Pacific Beach to Old Town',
    fromName: 'Pacific Beach',
    toName: 'Old Town',
    lengthKm: 6.6,
    designSpeedMph: 60,
    polyline: [
      P(32.825, -117.2285), P(32.808, -117.228), P(32.8012, -117.2253),
      P(32.799, -117.2245), P(32.786, -117.216), P(32.77, -117.206),
    ],
    areas: [
      A('Pacific Beach', 32.802, -117.235),
      A('Mission Bay', 32.778, -117.214),
    ],
  },
  {
    id: 'i-5-nb-la-jolla-north-la-jolla-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: University City to Sorrento Valley',
    fromName: 'University City',
    toName: 'Sorrento Valley',
    lengthKm: 4.9,
    designSpeedMph: 60,
    polyline: [
      P(32.8515, -117.2315), P(32.864, -117.2295), P(32.8705, -117.2285),
      P(32.87582, -117.22886), P(32.88158, -117.22841), P(32.88704, -117.22761),
      P(32.89248, -117.22722), P(32.89544, -117.22702),
    ],
    areas: [
      A('La Jolla', 32.85, -117.238),
      A('University City', 32.862, -117.224),
      A('Sorrento Valley', 32.88, -117.229),
    ],
  },
  {
    id: 'i-5-sb-la-jolla-pacific-beach-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: La Jolla to Mission Bay',
    fromName: 'La Jolla',
    toName: 'Mission Bay',
    lengthKm: 5.7,
    designSpeedMph: 60,
    polyline: [
      P(32.8515, -117.2315), P(32.8435, -117.228), P(32.836, -117.2282),
      P(32.825, -117.2285), P(32.808, -117.228), P(32.8012, -117.2253),
    ],
    areas: [
      A('La Jolla', 32.85, -117.238),
      A('Pacific Beach', 32.802, -117.235),
    ],
  },
  {
    id: 'i-5-so-through-oceanside-offset',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: San Onofre to Carlsbad',
    fromName: 'San Onofre',
    toName: 'Carlsbad',
    lengthKm: 5.3,
    designSpeedMph: 60,
    polyline: [
      P(33.20401, -117.38242), P(33.20206, -117.37723), P(33.20014, -117.37183),
      P(33.19704, -117.36792), P(33.1923, -117.36393), P(33.18852, -117.36097),
      P(33.18428, -117.35744), P(33.1801, -117.35364), P(33.17522, -117.34993),
      P(33.16955, -117.34565),
    ],
    areas: [
      A('Oceanside', 33.196, -117.34),
    ],
  },
  {
    id: 'i-5-no-through-oceanside-offset',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Carlsbad to Camp Pendleton',
    fromName: 'Carlsbad',
    toName: 'Camp Pendleton',
    lengthKm: 5.9,
    designSpeedMph: 60,
    polyline: [
      P(33.20401, -117.38242), P(33.20755, -117.38545), P(33.21251, -117.38854),
      P(33.21667, -117.39028), P(33.21887, -117.39102), P(33.22266, -117.39278),
      P(33.22767, -117.3969), P(33.2314, -117.40223), P(33.23522, -117.40473),
      P(33.23827, -117.40913), P(33.24039, -117.41348), P(33.24591, -117.41759),
      P(33.24649, -117.41785),
    ],
    areas: [
      A('Oceanside', 33.196, -117.34),
    ],
  },
  // ---- I-805 offsets
  {
    id: 'i-805-sb-lincoln-park-national-city-offset',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Lincoln Park to Chula Vista',
    fromName: 'Lincoln Park',
    toName: 'Chula Vista',
    lengthKm: 6.7,
    designSpeedMph: 60,
    polyline: [
      P(32.695, -117.105), P(32.678, -117.096), P(32.655, -117.088),
      P(32.638, -117.084),
    ],
    areas: [
      A('Lincoln Park', 32.698, -117.096),
      A('National City', 32.68, -117.1),
      A('Chula Vista', 32.64, -117.084),
    ],
  },
  {
    id: 'i-805-nb-national-city-lincoln-park-offset',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: National City to North Park',
    fromName: 'National City',
    toName: 'North Park',
    lengthKm: 5.2,
    designSpeedMph: 60,
    polyline: [
      P(32.695, -117.105), P(32.7054, -117.1104), P(32.72, -117.118),
      P(32.7383, -117.1268),
    ],
    areas: [
      A('National City', 32.68, -117.1),
      A('Lincoln Park', 32.698, -117.096),
    ],
  },
  {
    id: 'i-805-sb-north-park-lincoln-park-offset',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: North Park to National City',
    fromName: 'North Park',
    toName: 'National City',
    lengthKm: 5.1,
    designSpeedMph: 60,
    polyline: [
      P(32.72, -117.118), P(32.7054, -117.1104), P(32.695, -117.105),
      P(32.678, -117.096),
    ],
    areas: [
      A('North Park', 32.738, -117.127),
      A('Lincoln Park', 32.698, -117.096),
      A('National City', 32.68, -117.1),
    ],
  },
  {
    id: 'i-805-nb-lincoln-park-north-park-offset',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Lincoln Park to Mission Valley',
    fromName: 'Lincoln Park',
    toName: 'Mission Valley',
    lengthKm: 6.2,
    designSpeedMph: 60,
    polyline: [
      P(32.72, -117.118), P(32.7383, -117.1268), P(32.745, -117.13),
      P(32.77, -117.146),
    ],
    areas: [
      A('Lincoln Park', 32.705, -117.11),
      A('North Park', 32.735, -117.125),
      A('Mission Valley', 32.772, -117.15),
    ],
  },
  {
    id: 'i-805-nb-chula-vista-national-city-offset',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Chula Vista to Lincoln Park',
    fromName: 'Chula Vista',
    toName: 'Lincoln Park',
    lengthKm: 6,
    designSpeedMph: 60,
    polyline: [
      P(32.655, -117.088), P(32.678, -117.096), P(32.695, -117.105),
      P(32.7054, -117.1104),
    ],
    areas: [
      A('Chula Vista', 32.64, -117.084),
      A('National City', 32.68, -117.1),
      A('Lincoln Park', 32.698, -117.096),
    ],
  },
  {
    id: 'i-805-nb-mission-valley-kearny-mesa-offset',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Mission Valley to University City',
    fromName: 'Mission Valley',
    toName: 'University City',
    lengthKm: 6.3,
    designSpeedMph: 60,
    polyline: [
      P(32.78131, -117.16036), P(32.795, -117.172), P(32.815, -117.182),
      P(32.832, -117.188),
    ],
    areas: [
      A('Kearny Mesa', 32.8, -117.16),
      A('Clairemont', 32.815, -117.19),
      A('University City', 32.845, -117.2),
    ],
  },
  {
    id: 'i-805-sb-kearny-mesa-mission-valley-offset',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Kearny Mesa to North Park',
    fromName: 'Kearny Mesa',
    toName: 'North Park',
    lengthKm: 5.8,
    designSpeedMph: 60,
    polyline: [
      P(32.78131, -117.16036), P(32.775, -117.155), P(32.77, -117.146),
      P(32.745, -117.13), P(32.7383, -117.1268),
    ],
    areas: [
      A('Kearny Mesa', 32.8, -117.16),
      A('Serra Mesa', 32.797, -117.138),
      A('Mission Valley', 32.772, -117.15),
      A('North Park', 32.735, -117.125),
    ],
  },
  {
    id: 'i-805-sb-national-city-chula-vista-offset',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Otay Valley Regional Park to Chula Vista',
    fromName: 'Otay Valley Regional Park',
    toName: 'Chula Vista',
    lengthKm: 1.9,
    designSpeedMph: 60,
    polyline: [
      P(32.655, -117.088), P(32.638, -117.084),
    ],
    areas: [
      A('National City', 32.68, -117.1),
      A('Chula Vista', 32.64, -117.084),
    ],
  },
  {
    id: 'i-805-sb-university-city-kearny-mesa-offset',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Clairemont to Mission Valley',
    fromName: 'Clairemont',
    toName: 'Mission Valley',
    lengthKm: 6.2,
    designSpeedMph: 60,
    polyline: [
      P(32.815, -117.182), P(32.795, -117.172), P(32.775, -117.155),
      P(32.77, -117.146),
    ],
    areas: [
      A('University City', 32.845, -117.2),
      A('Clairemont', 32.815, -117.19),
      A('Kearny Mesa', 32.8, -117.16),
      A('Serra Mesa', 32.797, -117.138),
      A('Mission Valley', 32.772, -117.15),
    ],
  },
  {
    id: 'i-805-nb-kearny-mesa-university-city-offset',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Clairemont to University City',
    fromName: 'Clairemont',
    toName: 'University City',
    lengthKm: 2,
    designSpeedMph: 60,
    polyline: [
      P(32.815, -117.182), P(32.832, -117.188),
    ],
    areas: [
      A('Kearny Mesa', 32.8, -117.16),
      A('Clairemont', 32.815, -117.19),
      A('University City', 32.845, -117.2),
    ],
  },
  {
    id: 'i-805-sb-chula-vista-otay-valley-offset',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Otay Valley Regional Park to San Ysidro Merge',
    fromName: 'Otay Valley Regional Park',
    toName: 'San Ysidro Merge',
    lengthKm: 8.2,
    designSpeedMph: 60,
    polyline: [
      P(32.62192, -117.04089), P(32.61481, -117.03827), P(32.60839, -117.03654),
      P(32.60197, -117.03649), P(32.59929, -117.03648), P(32.59839, -117.03648),
      P(32.59125, -117.0365), P(32.584, -117.03709), P(32.57656, -117.03882),
      P(32.56871, -117.04064), P(32.56152, -117.04226), P(32.55225, -117.04135),
      P(32.54935, -117.0404),
    ],
    areas: [
      A('Otay Valley Regional Park', 32.589, -117.06),
      A('San Ysidro', 32.552, -117.043),
    ],
  },
  {
    id: 'i-805-nb-otay-valley-chula-vista-offset',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Otay Valley Regional Park to Chula Vista',
    fromName: 'Otay Valley Regional Park',
    toName: 'Chula Vista',
    lengthKm: 2.3,
    designSpeedMph: 60,
    polyline: [
      P(32.62192, -117.04089), P(32.62939, -117.04411), P(32.63493, -117.04766),
      P(32.63905, -117.0538),
    ],
    areas: [
      A('Otay Valley Regional Park', 32.589, -117.06),
    ],
  },
  {
    id: 'i-805-sb-mission-valley-north-park-offset',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Mission Valley to Lincoln Park',
    fromName: 'Mission Valley',
    toName: 'Lincoln Park',
    lengthKm: 6,
    designSpeedMph: 60,
    polyline: [
      P(32.75432, -117.13597), P(32.745, -117.13), P(32.7383, -117.1268),
      P(32.72, -117.118), P(32.7054, -117.1104),
    ],
    areas: [
      A('Mission Valley', 32.772, -117.15),
      A('North Park', 32.735, -117.125),
    ],
  },
  {
    id: 'i-805-nb-north-park-mission-valley-offset',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: North Park to Kearny Mesa',
    fromName: 'North Park',
    toName: 'Kearny Mesa',
    lengthKm: 5.7,
    designSpeedMph: 60,
    polyline: [
      P(32.75432, -117.13597), P(32.77, -117.146), P(32.775, -117.155),
      P(32.795, -117.172),
    ],
    areas: [
      A('Mission Valley', 32.772, -117.15),
      A('Serra Mesa', 32.797, -117.138),
      A('Kearny Mesa', 32.8, -117.16),
    ],
  },
  // ---- I-15 offsets
  {
    id: 'i-15-sb-through-scripps-ranch-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Rancho Penasquitos to Marine Corps Air Station Miramar',
    fromName: 'Rancho Penasquitos',
    toName: 'Marine Corps Air Station Miramar',
    lengthKm: 5.7,
    designSpeedMph: 60,
    polyline: [
      P(32.931, -117.09775), P(32.915, -117.102), P(32.88, -117.105),
    ],
    areas: [
      A('Scripps Ranch', 32.905, -117.1),
      A('Mira Mesa', 32.92, -117.132),
      A('Marine Corps Air Station Miramar', 32.87, -117.11),
    ],
  },
  {
    id: 'i-15-nb-scripps-ranch-rancho-penasquitos-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Scripps Ranch to Rancho Bernardo',
    fromName: 'Scripps Ranch',
    toName: 'Rancho Bernardo',
    lengthKm: 5.5,
    designSpeedMph: 60,
    polyline: [
      P(32.931, -117.09775), P(32.947, -117.0935), P(32.96, -117.09),
      P(32.9788, -117.0844),
    ],
    areas: [
      A('Scripps Ranch', 32.905, -117.1),
      A('Rancho Penasquitos', 32.953, -117.102),
    ],
  },
  {
    id: 'i-15-sb-escondido-rancho-bernardo-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Carmel Mountain Ranch to Rancho Penasquitos',
    fromName: 'Carmel Mountain Ranch',
    toName: 'Rancho Penasquitos',
    lengthKm: 5.5,
    designSpeedMph: 60,
    polyline: [
      P(33.02698, -117.08273), P(33.0108, -117.0799), P(33, -117.078),
      P(32.9788, -117.0844),
    ],
    areas: [
      A('Escondido', 33.043, -117.086),
      A('Rancho Bernardo', 33, -117.075),
      A('Carmel Mountain Ranch', 33.006, -117.08),
    ],
  },
  {
    id: 'i-15-nb-rancho-bernardo-escondido-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Carmel Mountain Ranch to North Escondido',
    fromName: 'Carmel Mountain Ranch',
    toName: 'North Escondido',
    lengthKm: 5.5,
    designSpeedMph: 60,
    polyline: [
      P(33.02698, -117.08273), P(33.04, -117.085), P(33.0431, -117.0859),
      P(33.075, -117.095),
    ],
    areas: [
      A('Rancho Bernardo', 33.011, -117.08),
      A('Escondido', 33.07, -117.09),
      A('San Pasqual Valley', 33.075, -117.021),
    ],
  },
  {
    id: 'i-15-sb-rancho-penasquitos-scripps-ranch-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Rancho Bernardo to Scripps Ranch',
    fromName: 'Rancho Bernardo',
    toName: 'Scripps Ranch',
    lengthKm: 5.1,
    designSpeedMph: 60,
    polyline: [
      P(32.96, -117.09), P(32.947, -117.0935), P(32.915, -117.102),
    ],
    areas: [
      A('Rancho Penasquitos', 32.953, -117.102),
      A('Scripps Ranch', 32.905, -117.1),
    ],
  },
  {
    id: 'i-15-nb-rancho-penasquitos-rancho-bernardo-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Carmel Mountain Ranch to Rancho Bernardo',
    fromName: 'Carmel Mountain Ranch',
    toName: 'Rancho Bernardo',
    lengthKm: 5.8,
    designSpeedMph: 60,
    polyline: [
      P(32.96, -117.09), P(32.9788, -117.0844), P(33, -117.078),
      P(33.0108, -117.0799),
    ],
    areas: [
      A('Rancho Penasquitos', 32.953, -117.102),
      A('Rancho Bernardo', 33, -117.075),
      A('Carmel Mountain Ranch', 33.006, -117.08),
    ],
  },
  {
    id: 'i-15-no-escondido-escondido-sr-78-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Hidden Meadows to Escondido',
    fromName: 'Hidden Meadows',
    toName: 'Escondido',
    lengthKm: 5.1,
    designSpeedMph: 60,
    polyline: [
      P(33.10599, -117.09326), P(33.11055, -117.09622), P(33.11414, -117.09858),
      P(33.11579, -117.09895), P(33.11926, -117.10144), P(33.12312, -117.1032),
      P(33.12825, -117.10505), P(33.13473, -117.1051), P(33.13988, -117.10483),
      P(33.14442, -117.10445), P(33.14871, -117.10452), P(33.14949, -117.10444),
    ],
    areas: [
      A('Escondido', 33.12, -117.078),
    ],
  },
  {
    id: 'i-15-so-escondido-sr-78-escondido-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: San Pasqual Valley to Escondido',
    fromName: 'San Pasqual Valley',
    toName: 'Escondido',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(33.10599, -117.09326), P(33.09597, -117.09382), P(33.075, -117.095),
    ],
    areas: [
      A('Escondido', 33.12, -117.078),
    ],
  },
  {
    id: 'i-15-no-through-escondido-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: San Pasqual Valley to Escondido (SR-78)',
    fromName: 'San Pasqual Valley',
    toName: 'Escondido (SR-78)',
    lengthKm: 3.5,
    designSpeedMph: 60,
    polyline: [
      P(33.08549, -117.09441), P(33.09597, -117.09382), P(33.10599, -117.09326),
      P(33.11055, -117.09622), P(33.11414, -117.09858), P(33.11579, -117.09895),
    ],
    areas: [
      A('Escondido', 33.12, -117.078),
    ],
  },
  {
    id: 'i-15-so-through-escondido-2-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Carmel Mountain Ranch to Escondido',
    fromName: 'Carmel Mountain Ranch',
    toName: 'Escondido',
    lengthKm: 4.8,
    designSpeedMph: 60,
    polyline: [
      P(33.08549, -117.09441), P(33.075, -117.095), P(33.0431, -117.0859),
    ],
    areas: [
      A('Escondido', 33.12, -117.078),
      A('San Pasqual Valley', 33.075, -117.021),
    ],
  },
  {
    id: 'i-15-sb-scripps-ranch-marine-corps-air-station-miramar-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Mira Mesa to Marine Corps Air Station Miramar',
    fromName: 'Mira Mesa',
    toName: 'Marine Corps Air Station Miramar',
    lengthKm: 5.9,
    designSpeedMph: 60,
    polyline: [
      P(32.8975, -117.1035), P(32.88, -117.105), P(32.845, -117.105),
      P(32.8443, -117.1051),
    ],
    areas: [
      A('Scripps Ranch', 32.905, -117.1),
      A('Mira Mesa', 32.92, -117.132),
      A('Marine Corps Air Station Miramar', 32.87, -117.11),
    ],
  },
  {
    id: 'i-15-nb-marine-corps-air-station-miramar-scripps-ranch-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Marine Corps Air Station Miramar to Rancho Penasquitos',
    fromName: 'Marine Corps Air Station Miramar',
    toName: 'Rancho Penasquitos',
    lengthKm: 5.6,
    designSpeedMph: 60,
    polyline: [
      P(32.8975, -117.1035), P(32.915, -117.102), P(32.947, -117.0935),
    ],
    areas: [
      A('Marine Corps Air Station Miramar', 32.87, -117.11),
      A('Scripps Ranch', 32.905, -117.1),
      A('Mira Mesa', 32.92, -117.132),
    ],
  },
  {
    id: 'i-15-nb-through-rancho-bernardo-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Carmel Mountain Ranch to Escondido',
    fromName: 'Carmel Mountain Ranch',
    toName: 'Escondido',
    lengthKm: 4.9,
    designSpeedMph: 60,
    polyline: [
      P(33, -117.078), P(33.0108, -117.0799), P(33.04, -117.085),
      P(33.0431, -117.0859),
    ],
    areas: [
      A('Rancho Bernardo', 33, -117.075),
      A('Carmel Mountain Ranch', 33.006, -117.08),
    ],
  },
  {
    id: 'i-15-sb-rancho-bernardo-rancho-penasquitos-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Carmel Mountain Ranch to Scripps Ranch',
    fromName: 'Carmel Mountain Ranch',
    toName: 'Scripps Ranch',
    lengthKm: 6.1,
    designSpeedMph: 60,
    polyline: [
      P(33, -117.078), P(32.9788, -117.0844), P(32.96, -117.09),
      P(32.947, -117.0935),
    ],
    areas: [
      A('Rancho Bernardo', 33, -117.075),
      A('Carmel Mountain Ranch', 33.006, -117.08),
      A('Rancho Penasquitos', 32.953, -117.102),
    ],
  },
  {
    id: 'i-15-sb-tierrasanta-mission-valley-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Tierrasanta to City Heights',
    fromName: 'Tierrasanta',
    toName: 'City Heights',
    lengthKm: 5.7,
    designSpeedMph: 60,
    polyline: [
      P(32.79, -117.105), P(32.774, -117.108), P(32.77493, -117.11173),
      P(32.77178, -117.11252), P(32.76557, -117.1098), P(32.75922, -117.1087),
      P(32.75141, -117.10862), P(32.74405, -117.10998),
    ],
    areas: [
      A('Tierrasanta', 32.8, -117.1),
      A('Mission Valley', 32.772, -117.12),
      A('Murphy Canyon Heights', 32.81, -117.106),
    ],
  },
  {
    id: 'i-15-nb-mission-valley-tierrasanta-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Murphy Canyon Heights to Marine Corps Air Station Miramar',
    fromName: 'Murphy Canyon Heights',
    toName: 'Marine Corps Air Station Miramar',
    lengthKm: 6.1,
    designSpeedMph: 60,
    polyline: [
      P(32.79, -117.105), P(32.8091, -117.1073), P(32.815, -117.108),
      P(32.8443, -117.1051),
    ],
    areas: [
      A('Mission Valley', 32.772, -117.12),
      A('Tierrasanta', 32.8, -117.1),
    ],
  },
  {
    id: 'i-15-nb-escondido-north-escondido-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: San Pasqual Valley to Escondido',
    fromName: 'San Pasqual Valley',
    toName: 'Escondido',
    lengthKm: 4.2,
    designSpeedMph: 60,
    polyline: [
      P(33.05905, -117.09045), P(33.075, -117.095), P(33.09597, -117.09382),
    ],
    areas: [
      A('Escondido', 33.07, -117.09),
      A('San Pasqual Valley', 33.075, -117.021),
    ],
  },
  {
    id: 'i-15-nb-tierrasanta-marine-corps-air-station-miramar-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Mission Valley to Marine Corps Air Station Miramar',
    fromName: 'Mission Valley',
    toName: 'Marine Corps Air Station Miramar',
    lengthKm: 5.9,
    designSpeedMph: 60,
    polyline: [
      P(32.8267, -117.10684), P(32.8443, -117.1051), P(32.845, -117.105),
      P(32.88, -117.105),
    ],
    areas: [
      A('Tierrasanta', 32.809, -117.107),
      A('Marine Corps Air Station Miramar', 32.87, -117.11),
    ],
  },
  {
    id: 'i-15-sb-marine-corps-air-station-miramar-tierrasanta-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Murphy Canyon Heights to Mission Valley',
    fromName: 'Murphy Canyon Heights',
    toName: 'Mission Valley',
    lengthKm: 5.9,
    designSpeedMph: 60,
    polyline: [
      P(32.8267, -117.10684), P(32.815, -117.108), P(32.8091, -117.1073),
      P(32.79, -117.105), P(32.774, -117.108),
    ],
    areas: [
      A('Marine Corps Air Station Miramar', 32.844, -117.105),
      A('Tierrasanta', 32.8, -117.1),
      A('Mission Valley', 32.772, -117.12),
    ],
  },
  {
    id: 'i-15-sb-north-escondido-escondido-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Carmel Mountain Ranch to Rancho Bernardo',
    fromName: 'Carmel Mountain Ranch',
    toName: 'Rancho Bernardo',
    lengthKm: 5.5,
    designSpeedMph: 60,
    polyline: [
      P(33.05905, -117.09045), P(33.0431, -117.0859), P(33.04, -117.085),
      P(33.0108, -117.0799),
    ],
    areas: [
      A('Escondido', 33.07, -117.09),
      A('San Pasqual Valley', 33.075, -117.021),
    ],
  },
  {
    id: 'i-15-sb-through-marine-corps-air-station-miramar-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Scripps Ranch to Tierrasanta',
    fromName: 'Scripps Ranch',
    toName: 'Tierrasanta',
    lengthKm: 5.9,
    designSpeedMph: 60,
    polyline: [
      P(32.86215, -117.105), P(32.845, -117.105), P(32.8443, -117.1051),
      P(32.815, -117.108), P(32.8091, -117.1073),
    ],
    areas: [
      A('Marine Corps Air Station Miramar', 32.87, -117.11),
    ],
  },
  {
    id: 'i-15-sb-mission-valley-city-heights-offset',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Mission Valley to SR-94',
    fromName: 'Mission Valley',
    toName: 'SR-94',
    lengthKm: 4.8,
    designSpeedMph: 60,
    polyline: [
      P(32.75922, -117.1087), P(32.75141, -117.10862), P(32.74405, -117.10998),
      P(32.7433, -117.11068), P(32.73668, -117.11285), P(32.72962, -117.1116),
      P(32.72383, -117.11493), P(32.7174, -117.11782),
    ],
    areas: [
      A('Murphy Canyon Heights', 32.81, -117.106),
      A('Mission Valley', 32.77, -117.152),
      A('City Heights', 32.75, -117.101),
    ],
  },
  {
    id: 'i-15-nb-city-heights-mission-valley-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: City Heights to Tierrasanta',
    fromName: 'City Heights',
    toName: 'Tierrasanta',
    lengthKm: 6.1,
    designSpeedMph: 60,
    polyline: [
      P(32.75922, -117.1087), P(32.76557, -117.1098), P(32.77178, -117.11252),
      P(32.77493, -117.11173), P(32.774, -117.108), P(32.79, -117.105),
      P(32.8091, -117.1073),
    ],
    areas: [
      A('Murphy Canyon Heights', 32.81, -117.106),
      A('Mission Valley', 32.77, -117.152),
      A('Tierrasanta', 32.8, -117.1),
    ],
  },
  {
    id: 'i-15-nb-through-marine-corps-air-station-miramar-offset',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Murphy Canyon Heights to Scripps Ranch',
    fromName: 'Murphy Canyon Heights',
    toName: 'Scripps Ranch',
    lengthKm: 5.9,
    designSpeedMph: 60,
    polyline: [
      P(32.86215, -117.105), P(32.88, -117.105), P(32.915, -117.102),
    ],
    areas: [
      A('Marine Corps Air Station Miramar', 32.87, -117.11),
      A('Scripps Ranch', 32.905, -117.1),
      A('Mira Mesa', 32.92, -117.132),
    ],
  },
  // ---- I-8 offsets
  {
    id: 'i-8-eb-la-mesa-grossmont-offset',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Grossmont Center to El Cajon',
    fromName: 'Grossmont Center',
    toName: 'El Cajon',
    lengthKm: 8.2,
    designSpeedMph: 60,
    polyline: [
      P(32.7794, -116.99607), P(32.77908, -116.98608), P(32.78281, -116.98119),
      P(32.78335, -116.98089), P(32.79145, -116.97784), P(32.79992, -116.97587),
      P(32.80316, -116.96582), P(32.80317, -116.95557), P(32.80317, -116.94473),
      P(32.80322, -116.93205), P(32.80331, -116.9267),
    ],
    areas: [
      A('Grossmont Center', 32.779, -117.01),
      A('Gillespie Field', 32.826, -116.972),
      A('El Cajon', 32.795, -116.963),
    ],
  },
  {
    id: 'i-8-wb-grossmont-la-mesa-offset',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Grossmont Center to La Mesa',
    fromName: 'Grossmont Center',
    toName: 'La Mesa',
    lengthKm: 0.8,
    designSpeedMph: 60,
    polyline: [
      P(32.7794, -116.99607), P(32.77769, -117.00381),
    ],
    areas: [
      A('Grossmont Center', 32.779, -117.01),
    ],
  },
  {
    id: 'i-8-wb-el-cajon-grossmont-offset',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: El Cajon to La Mesa',
    fromName: 'El Cajon',
    toName: 'La Mesa',
    lengthKm: 5.3,
    designSpeedMph: 60,
    polyline: [
      P(32.80316, -116.96582), P(32.79992, -116.97587), P(32.79145, -116.97784),
      P(32.78335, -116.98089), P(32.78281, -116.98119), P(32.77908, -116.98608),
      P(32.7794, -116.99607), P(32.77769, -117.00381),
    ],
    areas: [
      A('El Cajon', 32.795, -116.963),
      A('Grossmont Center', 32.779, -117.01),
      A('Gillespie Field', 32.826, -116.972),
    ],
  },
  {
    id: 'i-8-eb-grossmont-el-cajon-offset',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Gillespie Field to Granite Hills',
    fromName: 'Gillespie Field',
    toName: 'Granite Hills',
    lengthKm: 8.2,
    designSpeedMph: 60,
    polyline: [
      P(32.80316, -116.96582), P(32.80317, -116.95557), P(32.80317, -116.94473),
      P(32.80322, -116.93205), P(32.80331, -116.9267), P(32.80699, -116.92031),
      P(32.81279, -116.91674), P(32.81767, -116.912), P(32.82307, -116.90813),
      P(32.82875, -116.9007), P(32.83338, -116.89504),
    ],
    areas: [
      A('El Cajon', 32.795, -116.963),
      A('Granite Hills High School', 32.798, -116.915),
      A('El Capitan High School', 32.867, -116.918),
    ],
  },
  {
    id: 'i-8-eb-mission-valley-east-allied-gardens-offset',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Mission Valley East to San Carlos',
    fromName: 'Mission Valley East',
    toName: 'San Carlos',
    lengthKm: 5.9,
    designSpeedMph: 60,
    polyline: [
      P(32.77149, -117.08729), P(32.77, -117.075), P(32.7681, -117.0668),
      P(32.762, -117.04), P(32.7593, -117.0263),
    ],
    areas: [
      A('Mission Valley East', 32.772, -117.12),
      A('Allied Gardens', 32.77, -117.075),
      A('San Carlos', 32.763, -117.045),
    ],
  },
  {
    id: 'i-8-wb-allied-gardens-mission-valley-offset',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Mission Valley East to Mission Valley',
    fromName: 'Mission Valley East',
    toName: 'Mission Valley',
    lengthKm: 5.4,
    designSpeedMph: 60,
    polyline: [
      P(32.77149, -117.08729), P(32.774, -117.108), P(32.775, -117.1449),
    ],
    areas: [
      A('Mission Valley East', 32.772, -117.12),
      A('Mission Valley', 32.774, -117.108),
    ],
  },
  {
    id: 'i-8-eb-mission-valley-mission-valley-east-offset',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Mission Valley to Allied Gardens',
    fromName: 'Mission Valley',
    toName: 'Allied Gardens',
    lengthKm: 5.6,
    designSpeedMph: 60,
    polyline: [
      P(32.7745, -117.12645), P(32.774, -117.108), P(32.77, -117.075),
      P(32.7681, -117.0668),
    ],
    areas: [
      A('Mission Valley', 32.775, -117.145),
      A('Mission Valley East', 32.772, -117.12),
      A('Allied Gardens', 32.77, -117.075),
    ],
  },
  {
    id: 'i-8-wb-through-mission-valley-offset',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Mission Valley East to Old Town',
    fromName: 'Mission Valley East',
    toName: 'Old Town',
    lengthKm: 5.2,
    designSpeedMph: 60,
    polyline: [
      P(32.7745, -117.12645), P(32.775, -117.1449), P(32.775, -117.145),
      P(32.773, -117.168), P(32.7712, -117.1815),
    ],
    areas: [
      A('Mission Valley', 32.774, -117.108),
    ],
  },
  {
    id: 'i-8-wb-san-carlos-allied-gardens-offset',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: San Carlos to Mission Valley',
    fromName: 'San Carlos',
    toName: 'Mission Valley',
    lengthKm: 6.5,
    designSpeedMph: 60,
    polyline: [
      P(32.762, -117.04), P(32.7681, -117.0668), P(32.77, -117.075),
      P(32.774, -117.108),
    ],
    areas: [
      A('San Carlos', 32.763, -117.045),
      A('Allied Gardens', 32.77, -117.075),
      A('Mission Valley East', 32.772, -117.12),
    ],
  },
  {
    id: 'i-8-wb-mission-valley-old-town-offset',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Mission Valley to Midway District',
    fromName: 'Mission Valley',
    toName: 'Midway District',
    lengthKm: 4.9,
    designSpeedMph: 60,
    polyline: [
      P(32.773, -117.168), P(32.7712, -117.1815), P(32.77, -117.19),
      P(32.766, -117.205), P(32.759, -117.216),
    ],
    areas: [
      A('Mission Valley', 32.772, -117.16),
      A('Old Town', 32.754, -117.197),
      A('Midway District', 32.754, -117.206),
    ],
  },
  {
    id: 'i-8-eb-through-mission-valley-offset',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Old Town to Mission Valley East',
    fromName: 'Old Town',
    toName: 'Mission Valley East',
    lengthKm: 5.6,
    designSpeedMph: 60,
    polyline: [
      P(32.773, -117.168), P(32.775, -117.145), P(32.775, -117.1449),
      P(32.774, -117.108),
    ],
    areas: [
      A('Mission Valley', 32.772, -117.16),
    ],
  },
  {
    id: 'i-8-eb-allied-gardens-san-carlos-offset',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Grossmont Center to La Mesa',
    fromName: 'Grossmont Center',
    toName: 'La Mesa',
    lengthKm: 5.2,
    designSpeedMph: 60,
    polyline: [
      P(32.762, -117.04), P(32.7593, -117.0263), P(32.756, -117.01),
      P(32.754, -116.985),
    ],
    areas: [
      A('San Carlos', 32.763, -117.045),
      A('La Mesa', 32.756, -117.01),
    ],
  },
  {
    id: 'i-8-eb-san-carlos-la-mesa-offset',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: El Cajon to La Mesa',
    fromName: 'El Cajon',
    toName: 'La Mesa',
    lengthKm: 2.4,
    designSpeedMph: 60,
    polyline: [
      P(32.756, -117.01), P(32.754, -116.985),
    ],
    areas: [
      A('La Mesa', 32.756, -117.01),
    ],
  },
  {
    id: 'i-8-wb-la-mesa-san-carlos-offset',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: La Mesa to Allied Gardens',
    fromName: 'La Mesa',
    toName: 'Allied Gardens',
    lengthKm: 5.5,
    designSpeedMph: 60,
    polyline: [
      P(32.756, -117.01), P(32.7593, -117.0263), P(32.762, -117.04),
      P(32.7681, -117.0668),
    ],
    areas: [
      A('La Mesa', 32.756, -117.01),
      A('San Carlos', 32.763, -117.045),
    ],
  },
  // ---- SR-78 offsets
  {
    id: 'sr-78-we-through-san-marcos-offset',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Escondido to Vista',
    fromName: 'Escondido',
    toName: 'Vista',
    lengthKm: 5.5,
    designSpeedMph: 60,
    polyline: [
      P(33.1396, -117.14819), P(33.1391, -117.15355), P(33.13729, -117.16229),
      P(33.13695, -117.16805), P(33.1374, -117.17511), P(33.13949, -117.18094),
      P(33.14289, -117.18967), P(33.14585, -117.19326), P(33.14879, -117.1967),
      P(33.15227, -117.20078),
    ],
    areas: [
      A('San Marcos', 33.143, -117.125),
      A('Vista', 33.168, -117.21),
    ],
  },
  {
    id: 'sr-78-ea-through-san-marcos-offset',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Vista to Escondido',
    fromName: 'Vista',
    toName: 'Escondido',
    lengthKm: 6.2,
    designSpeedMph: 60,
    polyline: [
      P(33.1396, -117.14819), P(33.13901, -117.14201), P(33.1362, -117.13546),
      P(33.13476, -117.12878), P(33.13202, -117.12122), P(33.12953, -117.11547),
      P(33.12727, -117.11027), P(33.12719, -117.10437), P(33.12895, -117.0986),
      P(33.13066, -117.09302), P(33.1329, -117.08645),
    ],
    areas: [
      A('San Marcos', 33.143, -117.125),
      A('Escondido', 33.12, -117.078),
    ],
  },
  {
    id: 'sr-78-we-san-marcos-vista-offset',
    freeway: 'SR-78',
    direction: 'westbound',
    displayName: 'SR-78 West: Oceanside to Vista',
    fromName: 'Oceanside',
    toName: 'Vista',
    lengthKm: 5.8,
    designSpeedMph: 60,
    polyline: [
      P(33.13949, -117.18094), P(33.14289, -117.18967), P(33.14585, -117.19326),
      P(33.14879, -117.1967), P(33.15227, -117.20078), P(33.15539, -117.20429),
      P(33.16019, -117.20903), P(33.16587, -117.21367), P(33.16882, -117.21709),
      P(33.17068, -117.22198), P(33.17402, -117.22563),
    ],
    areas: [
      A('Vista', 33.168, -117.21),
    ],
  },
  {
    id: 'sr-78-ea-vista-san-marcos-offset',
    freeway: 'SR-78',
    direction: 'eastbound',
    displayName: 'SR-78 East: Escondido to San Marcos',
    fromName: 'Escondido',
    toName: 'San Marcos',
    lengthKm: 5,
    designSpeedMph: 60,
    polyline: [
      P(33.13949, -117.18094), P(33.1374, -117.17511), P(33.13695, -117.16805),
      P(33.13729, -117.16229), P(33.1391, -117.15355), P(33.1396, -117.14819),
      P(33.13901, -117.14201), P(33.1362, -117.13546), P(33.13476, -117.12878),
    ],
    areas: [
      A('Vista', 33.168, -117.21),
      A('San Marcos', 33.143, -117.125),
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
//
// `bufferM` defaults to CORRIDOR_BUFFER_M; it exists so the
// buffer-calibration sims (scripts/route-mode/corridor-buffer-sim.mjs)
// can evaluate candidate values against the real segment geometry
// without editing the constant. Production callers pass nothing.
export function matchCorridor(
  pos: {
    lat: number;
    lng: number;
    heading?: number | null;
  },
  bufferM: number = CORRIDOR_BUFFER_M
): CorridorMatch | null {
  let best: CorridorMatch | null = null;
  for (const candidate of matchCorridorCandidates(pos, bufferM)) {
    if (!best || candidate.distanceM < best.distanceM) best = candidate;
  }
  return best;
}

/**
 * EVERY segment the listener is on (offset seating rule,
 * Nov 25, 2026): the same containment + heading test as
 * matchCorridor, but one match per segment instead of a single
 * winner — each segment's nearest in-buffer leg. With the
 * corridor arm's offset segments banked, a mid-stretch position
 * sits inside a parent AND its offset twin (and sometimes the
 * previous parent's offset); the serve layer needs the full
 * candidate set so a suppressed winner cannot starve the ground
 * behind it (candidate fall-through) and so it can judge the
 * candidates against each other (entry recency). Order is bank
 * order; each segment appears at most once.
 */
export function matchCorridorCandidates(
  pos: {
    lat: number;
    lng: number;
    heading?: number | null;
  },
  bufferM: number = CORRIDOR_BUFFER_M
): CorridorMatch[] {
  const out: CorridorMatch[] = [];
  for (const segment of CORRIDOR_SEGMENTS) {
    let best: CorridorMatch | null = null;
    for (let i = 0; i < segment.polyline.length - 1; i++) {
      const a = segment.polyline[i];
      const b = segment.polyline[i + 1];
      const { distanceM } = pointToSegmentM(pos, a, b);
      if (distanceM > bufferM) continue;
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
    if (best) out.push(best);
  }
  return out;
}

// ------------------------------------------------- span overlap (Nov 25, 2026)
// The offset seating rule's ground truth: how much of one
// segment's road is the SAME road as another's. Two segments
// share ground when their polylines coincide — an offset twin
// is drawn from its parent's own geometry, so shared ground
// sits within metres, while segments that merely ABUT at a
// boundary vertex diverge immediately. The measure is
// therefore a coincidence length, not a buffer overlap: the
// metres of A's polyline lying within
// CORRIDOR_SPAN_COINCIDENCE_M of B's polyline (A's legs
// subdivided at ≤20 m, midpoints tested).
//
// CALIBRATION (Nov 25, 2026, measured over the real
// 410-segment bank): abutting same-freeway/direction pairs
// measure ≤49 m; genuinely shared ground (parent ↔ offset,
// offset ↔ offset, parent ↔ the offset that covers it whole)
// measures ≥749 m. CORRIDOR_SPAN_OVERLAP_MIN_M = 400 sits an
// order of magnitude from both classes.
export const CORRIDOR_SPAN_COINCIDENCE_M = 40;
export const CORRIDOR_SPAN_OVERLAP_MIN_M = 400;

const spanOverlapCache = new Map<string, number>();

/** Metres of `a`'s polyline that lie on `b`'s road (see above). Cached per ordered pair — the bank is static. */
export function corridorSpanOverlapM(a: CorridorSegment, b: CorridorSegment): number {
  const key = `${a.id}|${b.id}`;
  const cached = spanOverlapCache.get(key);
  if (cached !== undefined) return cached;
  let total = 0;
  for (let i = 0; i < a.polyline.length - 1; i++) {
    const p = a.polyline[i];
    const q = a.polyline[i + 1];
    const lp = toLocalM(p, p);
    const lq = toLocalM(p, q);
    const legM = Math.hypot(lq.x - lp.x, lq.y - lp.y);
    const steps = Math.max(1, Math.ceil(legM / 20));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const mid = { lat: p.lat + (q.lat - p.lat) * t, lng: p.lng + (q.lng - p.lng) * t };
      let best = Number.POSITIVE_INFINITY;
      for (let j = 0; j < b.polyline.length - 1; j++) {
        const { distanceM } = pointToSegmentM(mid, b.polyline[j], b.polyline[j + 1]);
        if (distanceM < best) best = distanceM;
      }
      if (best <= CORRIDOR_SPAN_COINCIDENCE_M) total += legM / steps;
    }
  }
  spanOverlapCache.set(key, total);
  return total;
}

/**
 * Do two segments narrate the same ground? Same freeway, same
 * direction, and a coincidence length past the calibrated
 * minimum. A segment always "intersects" itself by this
 * measure; callers that mean OTHER segments exclude identity
 * themselves (the corridor family shares one segment, and its
 * members must never dedupe each other).
 */
export function corridorSpansIntersect(a: CorridorSegment, b: CorridorSegment): boolean {
  if (a.freeway !== b.freeway || a.direction !== b.direction) return false;
  return corridorSpanOverlapM(a, b) > CORRIDOR_SPAN_OVERLAP_MIN_M;
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

// The point ON a segment's polyline nearest a position — the
// projection of the position onto its closest leg, interpolated
// in the module's flat local frame. The serve layer anchors a
// corridor item here (at the driver's own ground) rather than at
// the segment's entry: the 'fresher' displacement test measures a
// newcomer from its anchor, and an entry anchor sits 1–3 km
// behind a mid-segment driver, so a corridor story the driver is
// physically on lost "fresher" to nearly anything nearby
// (corridor fixes 1+2, Nov 14, 2026).
export function nearestPointOnSegment(
  segment: CorridorSegment,
  pos: { lat: number; lng: number }
): { lat: number; lng: number } {
  const pts = segment.polyline;
  let best: { lat: number; lng: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const { distanceM, t } = pointToSegmentM(pos, a, b);
    if (distanceM < bestDist) {
      bestDist = distanceM;
      best = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
  }
  return best ?? { lat: pts[0].lat, lng: pts[0].lng };
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
