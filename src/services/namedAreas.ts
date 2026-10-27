// Named-area anchors (Area F, Oct 26, 2026).
//
// Some places a driver can be INSIDE have no name a reverse geocoder
// will give back: Nominatim answers with the surrounding neighborhood
// (Point Loma), a street, or nothing — never "Liberty Station". Yet
// the district IS the area the listener is in, and the tour's area
// stories, intros, and significance all key off the area name. This
// table is the general mechanism: curated districts/complexes whose
// shape honestly fits a centroid + radius, consulted by the
// area-resolution path BEFORE generic reverse-geocoding results are
// accepted. It is deliberately small — an entry is added only when the
// district is major, the geocoder genuinely cannot name it, and the
// circle does not swallow a neighboring district whole. The coming
// neighborhood library generalizes from this same table.
//
// `major` marks districts whose area stories earn the major length
// band (Area E) — bays and Liberty Station-class districts, the ones
// the Oct 26 drive found told too briefly for their weight.

import { calculateDistance } from '../utils/geo';

export interface NamedArea {
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  major: boolean;
}

export const NAMED_AREAS: NamedArea[] = [
  // Instance #1 — the drive's case. The former Naval Training Center:
  // Nominatim calls the ground "Point Loma" and the listener never
  // learns the district they are driving through has a name and a
  // story of its own. Centroid/radius from the historic district's
  // span (registry point at the north end, boat channel at the south).
  { name: 'Liberty Station', lat: 32.7265, lng: -117.2155, radiusM: 1250, major: true },
  // The park is an area, not a pin: inside it, geocoders return the
  // surrounding neighborhoods or the zoo/museum names, while the area
  // story the listener needs is the park's. Radius is the El Prado /
  // central-mesa CORE only (audit §4): the park runs ~4.8 km end to
  // end, and a circle honest for the whole would swallow the Zoo,
  // Morley Field, and the Naval Hospital as "Balboa Park".
  { name: 'Balboa Park', lat: 32.7325, lng: -117.1491, radiusM: 700, major: true },
  // Sixteen square blocks whose name the geocoder does return
  // inconsistently (often just "Downtown"); the anchor makes the
  // district deterministic at its core. Sized to the NRHP district
  // boundary (audit §4) — Petco Park stays outside it, correctly.
  { name: 'Gaslamp Quarter', lat: 32.7096, lng: -117.1585, radiusM: 450, major: true },
  // The state park + plaza core: geocoders scatter it across
  // "Old Town" / "Presidio" / streets; the birthplace-of-California
  // district is one bounded ground with one story (audit §4).
  { name: 'Old Town', lat: 32.7543, lng: -117.1969, radiusM: 500, major: true },
  // NOT here, by the audit's fit verdict (§4): Mission Bay Park (an
  // irregular bay — no honest single circle; its nodes carry their own
  // pins) and the Embarcadero (a 2.5 km linear strip, not a ground).
  // Both are listed in the audit for a future polyline/multi-pin shape.
];

/** The named area containing this point, or null. Nearest center wins. */
export function findNamedArea(lat: number, lng: number): NamedArea | null {
  let best: NamedArea | null = null;
  let bestDistance = Infinity;
  for (const area of NAMED_AREAS) {
    const d = calculateDistance(lat, lng, area.lat, area.lng);
    if (d <= area.radiusM && d < bestDistance) {
      best = area;
      bestDistance = d;
    }
  }
  return best;
}
