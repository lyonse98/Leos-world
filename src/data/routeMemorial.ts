// GENERATED — do not hand-edit. Built by
// scripts/route-mode/build-route-memorial.mjs from
// memorial-classes.csv (48 audited rows, the
// Nov 7, 2026 memorial audit: every Protected-register
// and somber-primary row of the shelf, classified against
// its live telling). The route build joins library rows
// to this map at runtime, so no DB change is needed for
// route mode to know a story's memorial class.

/**
 * The audited memorial set (Erik's ruling, Nov 7, 2026):
 * the tellings whose SUBJECT is a real death event or a
 * memorial itself — PSA Flight 182's class. Only these
 * trip the humor layer's EPISODE-WIDE kill. The wider
 * mechanical neighborhood (Protected register, somber or
 * spooky tones, the scandal angle) still suppresses humor
 * in its own slots via colorSuppressedFor; it no longer
 * silences a whole episode. A row absent from this map is
 * not memorial — the safe direction.
 */

/** place_key + '|' + angle → true (memorial rows only). */
export const ROUTE_MEMORIAL: Record<string, true> = {
  "cabrillo national monument|landmark_event": true,
  "fort rosecrans national cemetery|landmark_origin": true,
  "fort rosecrans national cemetery|landmark_people": true,
  "hatfield-the-rainmaker|filler_hosted": true,
  "i-805 north: kearny mesa to university city|corridor": true,
  "i-805 south: university city to kearny mesa|corridor": true,
  "junipero serra museum|landmark_people": true,
  "mount soledad national veterans memorial|landmark_event": true,
  "poway|neighborhood_intro": true,
  "poway|neighborhood_intro_greet": true,
  "sr-52 east: la jolla to clairemont|corridor": true,
  "sr-52 west: kearny mesa to clairemont|corridor": true,
};

export function memorialFor(placeKey: string, angle: string): boolean {
  return ROUTE_MEMORIAL[`${placeKey}|${angle}`] === true;
}
