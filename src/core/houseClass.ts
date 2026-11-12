// House / architecture classification (field fix F1, Nov 12,
// 2026 — Erik's ruling from the Nov 12 route drive: "architecture
// and house stories should be very low on priority and score").
//
// The Nov 12 episode chained FOUR registry spec houses as thread
// members behind Salk Institute — individually fine tellings that
// together read as a real-estate tour. The class Erik named is
// the RESIDENCE as a story subject: registry/spec houses and
// landmark_building rows whose subject is a home. Detection is
// mechanical, from the signals a unit actually carries — its
// place name and its topic tags:
//
//   - a residence word in the place name (spec house, house,
//     cottage, residence, mansion, bungalow, villa), with the
//     compound exclusions that are NOT residences (playhouse,
//     lighthouse, courthouse, firehouse, boathouse, …) and the
//     "House of …" institutional form (House of Pacific
//     Relations is a museum complex, not a home);
//   - OR the Architecture topic tag (architecture-primary by
//     the shelf's own tagging, whatever the angle).
//
// A bare landmark_building angle does NOT classify: the
// California Building and the Hotel del Coronado are buildings
// whose subjects are institutions, not residences, and they
// keep their standing. Demotion is ORDERING ONLY, everywhere
// it applies — a house story still seats when it is the
// destination, the portal, or the only candidate; it simply
// sorts to the bottom of every competition it enters.

const NON_RESIDENCE_COMPOUNDS = [
  'playhouse',
  'lighthouse',
  'courthouse',
  'firehouse',
  'boathouse',
  'greenhouse',
  'warehouse',
  'schoolhouse',
  'clubhouse',
  'powerhouse',
  'alehouse',
  'brewhouse',
  'roadhouse',
  'treehouse',
  'dollhouse',
  'birdhouse',
  'doghouse',
  'outhouse',
  'bathhouse',
  'smokehouse',
  'icehouse',
  'jailhouse',
  'poorhouse',
  'workhouse',
  'storehouse',
  'gatehouse',
  'watchhouse',
  'roundhouse',
  'enginehouse',
  'pumphouse',
  'henhouse',
  'dovehouse',
];

const RESIDENCE_WORDS =
  /\bspec house\b|\bhouse\b|\bcottages?\b|\bresidence\b|\bmansions?\b|\bbungalows?\b|\bvillas?\b/;

/** True when a place name names a residence (see the header for the exact class). */
export function isHousePlaceName(name: string): boolean {
  const n = name.toLowerCase();
  if (/\bhouse of\b/.test(n)) return false;
  for (const c of NON_RESIDENCE_COMPOUNDS) {
    if (n.includes(c)) return false;
  }
  return RESIDENCE_WORDS.test(n);
}

/** The unit-level classifier: name signal, or the Architecture topic tag. */
export function isHouseStory(u: { placeName: string; topics: readonly string[] }): boolean {
  return isHousePlaceName(u.placeName) || u.topics.includes('Architecture');
}

/** Sort term: houses rank 1 (below everything else in their competition), all else 0. */
export function houseRank(u: { placeName: string; topics: readonly string[] }): number {
  return isHouseStory(u) ? 1 : 0;
}

/** Fetch-order variant: the index carries place KEYS (slugs), not names — same words, dashes for spaces. */
export function houseRankForPlaceKey(placeKey: string, topics: readonly string[]): number {
  return isHousePlaceName(placeKey.replace(/[-_]+/g, ' ')) || topics.includes('Architecture') ? 1 : 0;
}
