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
// COVERAGE (v1): metro San Diego freeways on Erik's real routes —
// home in La Jolla/University City, the commute toward SWRMC/Naval
// Base San Diego (I-5 S / SR-163 S), the SeaWorld/Liberty Station
// test routes (I-8 / I-5), airport runs (I-5 past SAN). 26
// segment-directions. Segments chain: one segment's exit anchor is
// the next segment's entry on the same freeway, so a freeway run
// narrates continuously, segment after segment.
//
// COORDINATE PROVENANCE: polylines are hand-laid on the real
// freeway paths at interchange resolution (junctions and named
// cross-streets), not surveyed centerlines. The containment buffer
// (CORRIDOR_BUFFER_M, 450m) is sized to absorb that approximation
// with margin; a GIS-grade pass can tighten the lines later without
// changing any contract here. Neighborhood anchors are approximate
// centers of the named areas, used for fact-pack sampling by the
// builder and for nothing safety-critical in the app.
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

const P = (lat: number, lng: number) => ({ lat, lng });
const A = (name: string, lat: number, lng: number): CorridorArea => ({ name, lat, lng });

export const CORRIDOR_SEGMENTS: CorridorSegment[] = [
  // ------------------------------------------------------------- I-5
  {
    id: 'i5-sb-lajolla-mission-bay',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: La Jolla to Mission Bay',
    fromName: 'La Jolla',
    toName: 'Mission Bay',
    lengthKm: 11.5,
    polyline: [
      P(32.8705, -117.2285), P(32.8640, -117.2295), P(32.8515, -117.2315),
      P(32.8435, -117.2280), P(32.8250, -117.2285), P(32.8080, -117.2280),
      P(32.7990, -117.2245), P(32.7860, -117.2160), P(32.7700, -117.2060),
    ],
    areas: [
      A('University City', 32.8620, -117.2240),
      A('La Jolla', 32.8500, -117.2380),
      A('Pacific Beach', 32.8020, -117.2350),
      A('Mission Bay', 32.7780, -117.2140),
    ],
  },
  {
    id: 'i5-sb-mission-bay-downtown',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Mission Bay to Downtown',
    fromName: 'Mission Bay',
    toName: 'Downtown',
    lengthKm: 6.5,
    polyline: [
      P(32.7700, -117.2060), P(32.7630, -117.2010), P(32.7555, -117.1955),
      P(32.7460, -117.1860), P(32.7355, -117.1790), P(32.7240, -117.1680),
      P(32.7175, -117.1645),
    ],
    areas: [
      A('Old Town', 32.7543, -117.1969),
      A('Mission Hills', 32.7500, -117.1780),
      A('San Diego International Airport', 32.7355, -117.1830),
      A('Little Italy', 32.7250, -117.1690),
      A('Downtown San Diego', 32.7170, -117.1620),
    ],
  },
  {
    id: 'i5-sb-downtown-chula-vista',
    freeway: 'I-5',
    direction: 'southbound',
    displayName: 'I-5 South: Downtown to Chula Vista',
    fromName: 'Downtown',
    toName: 'Chula Vista',
    lengthKm: 13.5,
    polyline: [
      P(32.7175, -117.1645), P(32.7090, -117.1560), P(32.7010, -117.1490),
      P(32.6860, -117.1270), P(32.6720, -117.1120), P(32.6555, -117.0965),
      P(32.6400, -117.0830), P(32.6175, -117.0665),
    ],
    areas: [
      A('Downtown San Diego', 32.7170, -117.1620),
      A('Barrio Logan', 32.7000, -117.1420),
      A('National City', 32.6780, -117.1170),
      A('Chula Vista', 32.6400, -117.0840),
    ],
  },
  {
    id: 'i5-nb-chula-vista-downtown',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Chula Vista to Downtown',
    fromName: 'Chula Vista',
    toName: 'Downtown',
    lengthKm: 13.5,
    polyline: [
      P(32.6175, -117.0665), P(32.6400, -117.0830), P(32.6555, -117.0965),
      P(32.6720, -117.1120), P(32.6860, -117.1270), P(32.7010, -117.1490),
      P(32.7090, -117.1560), P(32.7175, -117.1645),
    ],
    areas: [
      A('Chula Vista', 32.6400, -117.0840),
      A('National City', 32.6780, -117.1170),
      A('Barrio Logan', 32.7000, -117.1420),
      A('Downtown San Diego', 32.7170, -117.1620),
    ],
  },
  {
    id: 'i5-nb-downtown-mission-bay',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Downtown to Mission Bay',
    fromName: 'Downtown',
    toName: 'Mission Bay',
    lengthKm: 6.5,
    polyline: [
      P(32.7175, -117.1645), P(32.7240, -117.1680), P(32.7355, -117.1790),
      P(32.7460, -117.1860), P(32.7555, -117.1955), P(32.7630, -117.2010),
      P(32.7700, -117.2060),
    ],
    areas: [
      A('Downtown San Diego', 32.7170, -117.1620),
      A('Little Italy', 32.7250, -117.1690),
      A('San Diego International Airport', 32.7355, -117.1830),
      A('Mission Hills', 32.7500, -117.1780),
      A('Old Town', 32.7543, -117.1969),
    ],
  },
  {
    id: 'i5-nb-mission-bay-lajolla',
    freeway: 'I-5',
    direction: 'northbound',
    displayName: 'I-5 North: Mission Bay to La Jolla',
    fromName: 'Mission Bay',
    toName: 'La Jolla',
    lengthKm: 11.5,
    polyline: [
      P(32.7700, -117.2060), P(32.7860, -117.2160), P(32.7990, -117.2245),
      P(32.8080, -117.2280), P(32.8250, -117.2285), P(32.8435, -117.2280),
      P(32.8515, -117.2315), P(32.8640, -117.2295), P(32.8705, -117.2285),
    ],
    areas: [
      A('Mission Bay', 32.7780, -117.2140),
      A('Pacific Beach', 32.8020, -117.2350),
      A('La Jolla', 32.8500, -117.2380),
      A('University City', 32.8620, -117.2240),
    ],
  },

  // ----------------------------------------------------------- SR-163
  {
    id: 'sr163-sb-mission-valley-downtown',
    freeway: 'SR-163',
    direction: 'southbound',
    displayName: 'SR-163 South: Mission Valley to Downtown',
    fromName: 'Mission Valley',
    toName: 'Downtown',
    lengthKm: 7,
    polyline: [
      P(32.7810, -117.1680), P(32.7720, -117.1630), P(32.7560, -117.1560),
      P(32.7400, -117.1510), P(32.7300, -117.1520), P(32.7210, -117.1580),
    ],
    areas: [
      A('Mission Valley', 32.7750, -117.1600),
      A('Hillcrest', 32.7500, -117.1550),
      A('Balboa Park', 32.7325, -117.1491),
      A('Downtown San Diego', 32.7210, -117.1600),
    ],
  },
  {
    id: 'sr163-nb-downtown-mission-valley',
    freeway: 'SR-163',
    direction: 'northbound',
    displayName: 'SR-163 North: Downtown to Mission Valley',
    fromName: 'Downtown',
    toName: 'Mission Valley',
    lengthKm: 7,
    polyline: [
      P(32.7210, -117.1580), P(32.7300, -117.1520), P(32.7400, -117.1510),
      P(32.7560, -117.1560), P(32.7720, -117.1630), P(32.7810, -117.1680),
    ],
    areas: [
      A('Downtown San Diego', 32.7210, -117.1600),
      A('Balboa Park', 32.7325, -117.1491),
      A('Hillcrest', 32.7500, -117.1550),
      A('Mission Valley', 32.7750, -117.1600),
    ],
  },

  // ------------------------------------------------------------ SR-52
  {
    id: 'sr52-eb-lajolla-tierrasanta',
    freeway: 'SR-52',
    direction: 'eastbound',
    displayName: 'SR-52 East: La Jolla to Tierrasanta',
    fromName: 'La Jolla',
    toName: 'Tierrasanta',
    lengthKm: 13,
    polyline: [
      P(32.8515, -117.2315), P(32.8450, -117.2050), P(32.8380, -117.1880),
      P(32.8280, -117.1570), P(32.8160, -117.1160), P(32.8180, -117.0880),
    ],
    areas: [
      A('La Jolla', 32.8500, -117.2380),
      A('University City', 32.8450, -117.2000),
      A('Clairemont', 32.8350, -117.1750),
      A('Kearny Mesa', 32.8200, -117.1400),
      A('Tierrasanta', 32.8200, -117.0920),
    ],
  },
  {
    id: 'sr52-eb-tierrasanta-santee',
    freeway: 'SR-52',
    direction: 'eastbound',
    displayName: 'SR-52 East: Tierrasanta to Santee',
    fromName: 'Tierrasanta',
    toName: 'Santee',
    lengthKm: 10,
    polyline: [
      P(32.8180, -117.0880), P(32.8300, -117.0520), P(32.8480, -117.0100),
      P(32.8560, -116.9860),
    ],
    areas: [
      A('Tierrasanta', 32.8200, -117.0920),
      A('Mission Trails Regional Park', 32.8350, -117.0550),
      A('Santee', 32.8500, -116.9950),
    ],
  },
  {
    id: 'sr52-wb-santee-tierrasanta',
    freeway: 'SR-52',
    direction: 'westbound',
    displayName: 'SR-52 West: Santee to Tierrasanta',
    fromName: 'Santee',
    toName: 'Tierrasanta',
    lengthKm: 10,
    polyline: [
      P(32.8560, -116.9860), P(32.8480, -117.0100), P(32.8300, -117.0520),
      P(32.8180, -117.0880),
    ],
    areas: [
      A('Santee', 32.8500, -116.9950),
      A('Mission Trails Regional Park', 32.8350, -117.0550),
      A('Tierrasanta', 32.8200, -117.0920),
    ],
  },
  {
    id: 'sr52-wb-tierrasanta-lajolla',
    freeway: 'SR-52',
    direction: 'westbound',
    displayName: 'SR-52 West: Tierrasanta to La Jolla',
    fromName: 'Tierrasanta',
    toName: 'La Jolla',
    lengthKm: 13,
    polyline: [
      P(32.8180, -117.0880), P(32.8160, -117.1160), P(32.8280, -117.1570),
      P(32.8380, -117.1880), P(32.8450, -117.2050), P(32.8515, -117.2315),
    ],
    areas: [
      A('Tierrasanta', 32.8200, -117.0920),
      A('Kearny Mesa', 32.8200, -117.1400),
      A('Clairemont', 32.8350, -117.1750),
      A('University City', 32.8450, -117.2000),
      A('La Jolla', 32.8500, -117.2380),
    ],
  },

  // -------------------------------------------------------------- I-8
  {
    id: 'i8-eb-coast-mission-valley',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: The Coast to Mission Valley',
    fromName: 'The Coast',
    toName: 'Mission Valley',
    lengthKm: 13,
    polyline: [
      P(32.7510, -117.2500), P(32.7530, -117.2330), P(32.7590, -117.2160),
      P(32.7660, -117.2050), P(32.7700, -117.1900), P(32.7730, -117.1680),
      P(32.7750, -117.1450), P(32.7740, -117.1080),
    ],
    areas: [
      A('Ocean Beach', 32.7500, -117.2450),
      A('Point Loma', 32.7450, -117.2250),
      A('Old Town', 32.7543, -117.1969),
      A('Mission Valley', 32.7720, -117.1600),
    ],
  },
  {
    id: 'i8-eb-mission-valley-la-mesa',
    freeway: 'I-8',
    direction: 'eastbound',
    displayName: 'I-8 East: Mission Valley to La Mesa',
    fromName: 'Mission Valley',
    toName: 'La Mesa',
    lengthKm: 11,
    polyline: [
      P(32.7740, -117.1080), P(32.7700, -117.0750), P(32.7620, -117.0400),
      P(32.7560, -117.0100), P(32.7540, -116.9850),
    ],
    areas: [
      A('Mission Valley East', 32.7720, -117.1200),
      A('Allied Gardens', 32.7700, -117.0750),
      A('San Carlos', 32.7630, -117.0450),
      A('La Mesa', 32.7560, -117.0100),
    ],
  },
  {
    id: 'i8-wb-la-mesa-mission-valley',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: La Mesa to Mission Valley',
    fromName: 'La Mesa',
    toName: 'Mission Valley',
    lengthKm: 11,
    polyline: [
      P(32.7540, -116.9850), P(32.7560, -117.0100), P(32.7620, -117.0400),
      P(32.7700, -117.0750), P(32.7740, -117.1080),
    ],
    areas: [
      A('La Mesa', 32.7560, -117.0100),
      A('San Carlos', 32.7630, -117.0450),
      A('Allied Gardens', 32.7700, -117.0750),
      A('Mission Valley East', 32.7720, -117.1200),
    ],
  },
  {
    id: 'i8-wb-mission-valley-coast',
    freeway: 'I-8',
    direction: 'westbound',
    displayName: 'I-8 West: Mission Valley to the Coast',
    fromName: 'Mission Valley',
    toName: 'The Coast',
    lengthKm: 13,
    polyline: [
      P(32.7740, -117.1080), P(32.7750, -117.1450), P(32.7730, -117.1680),
      P(32.7700, -117.1900), P(32.7660, -117.2050), P(32.7590, -117.2160),
      P(32.7530, -117.2330), P(32.7510, -117.2500),
    ],
    areas: [
      A('Mission Valley', 32.7720, -117.1600),
      A('Old Town', 32.7543, -117.1969),
      A('Point Loma', 32.7450, -117.2250),
      A('Ocean Beach', 32.7500, -117.2450),
    ],
  },

  // ------------------------------------------------------------ I-805
  {
    id: 'i805-sb-university-city-mission-valley',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: University City to Mission Valley',
    fromName: 'University City',
    toName: 'Mission Valley',
    lengthKm: 7.5,
    polyline: [
      P(32.8320, -117.1880), P(32.8150, -117.1820), P(32.7950, -117.1720),
      P(32.7750, -117.1550), P(32.7700, -117.1460),
    ],
    areas: [
      A('University City', 32.8450, -117.2000),
      A('Clairemont', 32.8150, -117.1900),
      A('Kearny Mesa', 32.8000, -117.1600),
      A('Mission Valley', 32.7720, -117.1500),
    ],
  },
  {
    id: 'i805-sb-mission-valley-chula-vista',
    freeway: 'I-805',
    direction: 'southbound',
    displayName: 'I-805 South: Mission Valley to Chula Vista',
    fromName: 'Mission Valley',
    toName: 'Chula Vista',
    lengthKm: 15,
    polyline: [
      P(32.7700, -117.1460), P(32.7450, -117.1300), P(32.7200, -117.1180),
      P(32.6950, -117.1050), P(32.6780, -117.0960), P(32.6550, -117.0880),
      P(32.6380, -117.0840),
    ],
    areas: [
      A('Mission Valley', 32.7720, -117.1500),
      A('North Park', 32.7350, -117.1250),
      A('National City', 32.6800, -117.1000),
      A('Chula Vista', 32.6400, -117.0840),
    ],
  },
  {
    id: 'i805-nb-chula-vista-mission-valley',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Chula Vista to Mission Valley',
    fromName: 'Chula Vista',
    toName: 'Mission Valley',
    lengthKm: 15,
    polyline: [
      P(32.6380, -117.0840), P(32.6550, -117.0880), P(32.6780, -117.0960),
      P(32.6950, -117.1050), P(32.7200, -117.1180), P(32.7450, -117.1300),
      P(32.7700, -117.1460),
    ],
    areas: [
      A('Chula Vista', 32.6400, -117.0840),
      A('National City', 32.6800, -117.1000),
      A('North Park', 32.7350, -117.1250),
      A('Mission Valley', 32.7720, -117.1500),
    ],
  },
  {
    id: 'i805-nb-mission-valley-university-city',
    freeway: 'I-805',
    direction: 'northbound',
    displayName: 'I-805 North: Mission Valley to University City',
    fromName: 'Mission Valley',
    toName: 'University City',
    lengthKm: 7.5,
    polyline: [
      P(32.7700, -117.1460), P(32.7750, -117.1550), P(32.7950, -117.1720),
      P(32.8150, -117.1820), P(32.8320, -117.1880),
    ],
    areas: [
      A('Mission Valley', 32.7720, -117.1500),
      A('Kearny Mesa', 32.8000, -117.1600),
      A('Clairemont', 32.8150, -117.1900),
      A('University City', 32.8450, -117.2000),
    ],
  },

  // ------------------------------------------------------------- I-15
  {
    id: 'i15-nb-mission-valley-scripps-ranch',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Mission Valley to Scripps Ranch',
    fromName: 'Mission Valley',
    toName: 'Scripps Ranch',
    lengthKm: 16,
    polyline: [
      P(32.7740, -117.1080), P(32.7900, -117.1050), P(32.8150, -117.1080),
      P(32.8450, -117.1050), P(32.8800, -117.1050), P(32.9150, -117.1020),
    ],
    areas: [
      A('Mission Valley', 32.7720, -117.1200),
      A('Tierrasanta', 32.8000, -117.1000),
      A('Marine Corps Air Station Miramar', 32.8700, -117.1100),
      A('Scripps Ranch', 32.9050, -117.1000),
    ],
  },
  {
    id: 'i15-nb-scripps-ranch-escondido',
    freeway: 'I-15',
    direction: 'northbound',
    displayName: 'I-15 North: Scripps Ranch to Escondido',
    fromName: 'Scripps Ranch',
    toName: 'Escondido',
    lengthKm: 19,
    polyline: [
      P(32.9150, -117.1020), P(32.9600, -117.0900), P(33.0000, -117.0780),
      P(33.0400, -117.0850), P(33.0750, -117.0950),
    ],
    areas: [
      A('Scripps Ranch', 32.9050, -117.1000),
      A('Rancho Bernardo', 33.0000, -117.0750),
      A('Escondido', 33.0700, -117.0900),
    ],
  },
  {
    id: 'i15-sb-escondido-scripps-ranch',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Escondido to Scripps Ranch',
    fromName: 'Escondido',
    toName: 'Scripps Ranch',
    lengthKm: 19,
    polyline: [
      P(33.0750, -117.0950), P(33.0400, -117.0850), P(33.0000, -117.0780),
      P(32.9600, -117.0900), P(32.9150, -117.1020),
    ],
    areas: [
      A('Escondido', 33.0700, -117.0900),
      A('Rancho Bernardo', 33.0000, -117.0750),
      A('Scripps Ranch', 32.9050, -117.1000),
    ],
  },
  {
    id: 'i15-sb-scripps-ranch-mission-valley',
    freeway: 'I-15',
    direction: 'southbound',
    displayName: 'I-15 South: Scripps Ranch to Mission Valley',
    fromName: 'Scripps Ranch',
    toName: 'Mission Valley',
    lengthKm: 16,
    polyline: [
      P(32.9150, -117.1020), P(32.8800, -117.1050), P(32.8450, -117.1050),
      P(32.8150, -117.1080), P(32.7900, -117.1050), P(32.7740, -117.1080),
    ],
    areas: [
      A('Scripps Ranch', 32.9050, -117.1000),
      A('Marine Corps Air Station Miramar', 32.8700, -117.1100),
      A('Tierrasanta', 32.8000, -117.1000),
      A('Mission Valley', 32.7720, -117.1200),
    ],
  },

  // ------------------------------------------------------------ SR-94
  {
    id: 'sr94-eb-downtown-lemon-grove',
    freeway: 'SR-94',
    direction: 'eastbound',
    displayName: 'SR-94 East: Downtown to Lemon Grove',
    fromName: 'Downtown',
    toName: 'Lemon Grove',
    lengthKm: 12,
    polyline: [
      P(32.7090, -117.1560), P(32.7110, -117.1400), P(32.7150, -117.1180),
      P(32.7180, -117.0950), P(32.7200, -117.0700), P(32.7220, -117.0450),
      P(32.7240, -117.0280),
    ],
    areas: [
      A('Downtown San Diego', 32.7170, -117.1620),
      A('Golden Hill', 32.7120, -117.1400),
      A('Mount Hope', 32.7150, -117.1150),
      A('Lemon Grove', 32.7230, -117.0350),
    ],
  },
  {
    id: 'sr94-wb-lemon-grove-downtown',
    freeway: 'SR-94',
    direction: 'westbound',
    displayName: 'SR-94 West: Lemon Grove to Downtown',
    fromName: 'Lemon Grove',
    toName: 'Downtown',
    lengthKm: 12,
    polyline: [
      P(32.7240, -117.0280), P(32.7220, -117.0450), P(32.7200, -117.0700),
      P(32.7180, -117.0950), P(32.7150, -117.1180), P(32.7110, -117.1400),
      P(32.7090, -117.1560),
    ],
    areas: [
      A('Lemon Grove', 32.7230, -117.0350),
      A('Mount Hope', 32.7150, -117.1150),
      A('Golden Hill', 32.7120, -117.1400),
      A('Downtown San Diego', 32.7170, -117.1620),
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
