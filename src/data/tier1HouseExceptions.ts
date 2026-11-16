// Tier-1 house exceptions (Erik's ruling, Nov 15, 2026).
//
// Freeform discovery no longer lets a National Register listing
// confer Tier-1 on a HOUSE-class candidate (facts.ts): a
// registered residence is a residence, however it is listed —
// the Nov 14 field evidence was National-Register houses riding
// the Tier-1 pending lane and displacement protection exactly
// like landmark stories (A.H. Sweet Residences served with full
// Tier-1 privilege while local-register houses served unranked).
//
// The exception is the DESTINATION house: a house that is itself
// a place people go — a house museum, a visited landmark. No
// dataset carries that distinction (the registry has no
// visitor/museum field; the Nov 15 scoring audit measured zero
// marked destination houses), so the list is curated by hand,
// one place_key per line. Adding an exception is a data-only
// edit to this file — no code change, no migration.
//
// Keys are library place_keys (the writer's dialect: lowercase,
// periods/apostrophes removed — backend.normalizePlaceKey), the
// same keys story_library rows and story-tags.csv carry.
//
// This module stays backend-free like the other data modules
// (routeGapFill's gapPlaceKey is the house precedent): the
// normalization is mirrored here rather than imported, so
// facts.ts — which route tooling bundles — never drags the
// Supabase client into its graph.

export const TIER1_HOUSE_EXCEPTION_KEYS: readonly string[] = [
  // George W. Marston House — a working house museum in Balboa
  // Park; the one destination house certain enough to seed.
  'george marston house',
];

const EXCEPTION_SET: ReadonlySet<string> = new Set(TIER1_HOUSE_EXCEPTION_KEYS);

/** backend.normalizePlaceKey, mirrored (see the note above). */
function exceptionPlaceKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, ' ');
}

/** True when the named place is a curated destination house that keeps Tier-1. */
export function isTier1HouseException(name: string): boolean {
  return EXCEPTION_SET.has(exceptionPlaceKey(name));
}
