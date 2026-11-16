// Tier-1 house exceptions (Erik's ruling, Nov 15, 2026).
//
// Freeform discovery no longer lets a National Register listing
// confer Tier-1 on a HOUSE-class candidate (facts.ts): a
// registered residence is a residence, however it is listed —
// the Nov 14 field evidence was National-Register houses riding
// the Tier-1 pending lane and displacement protection exactly
// like landmark stories (A.H. Sweet Residences served with full
// Tier-1 privilege while local-register houses served unranked).
// For a house, this list is now the ONLY road to Tier-1,
// whatever its register: facts.ts judges the exception on
// either name the candidate carries (the Places display name or
// the registry's own), the same two-dialect rule the portal
// gate judges a place by.
//
// The exception is the TOUR-IMPORTANT house (Erik's corrected
// criterion, Nov 15, 21:48): private property is irrelevant —
// what earns Tier-1 is a great story, a person of real weight
// who lived there, or a subject portal onto that person's own
// stories. (The first cut of this list used a visitability /
// house-museum bar; Erik withdrew that criterion the same
// evening.) The list is the union of the two Nov 15 audits:
// the v2 strike list's 15 KEEPs among the National-Register
// houses, plus the importance audit's 9 PROMOTEs hiding among
// the local-register houses — 24 places. The full evidence for
// every key lives in tier1-house-exceptions-checklist-v2-
// 2026-11-15.md and house-importance-audit-2026-11-15.md; the
// scores behind the verdicts ship as data in houseImportance.ts.
//
// Keys are library place_keys (the writer's dialect: lowercase,
// periods/apostrophes removed — backend.normalizePlaceKey), the
// same keys story_library rows and story-tags.csv carry. One
// place carries two keys: the Whaley House, whose shelf key
// ("Whaley House Museum") differs from its registry record name
// ("Whaley House") — both are listed so the exception fires on
// either dialect. Adding an exception is a data-only edit to
// this file — no code change, no migration.
//
// This module stays backend-free like the other data modules
// (routeGapFill's gapPlaceKey is the house precedent): the
// normalization is mirrored here rather than imported, so
// facts.ts — which route tooling bundles — never drags the
// Supabase client into its graph.

export const TIER1_HOUSE_EXCEPTION_KEYS: readonly string[] = [
  // — The National-Register keeps (checklist v2, 15) —
  // George W. Marston House — the merchant-civic giant; subject
  // portal to his own stories. The original seed.
  'george marston house',
  // Burnham-Marston House — San Diego's Prairie School landmark,
  // in the middle of the Gill/Waterman/Marston cluster.
  'burnham-marston house',
  // Canfield-Wright House (the Pink Lady) — the Canfield/Doheny
  // oil saga poured into a Del Mar bluff mansion.
  'canfield-wright house',
  // Case Study House No. 23C — Entenza's experiment,
  // Killingsworth's design; a pilgrimage name.
  'case study house no 23c',
  // Dr. Walter and Judith Munk/Seiche House — Walter Munk, with
  // a subject portal to his own stories.
  'dr walter and judith munk/seiche house',
  // Fleming, Guy and Margaret, House — Guy Fleming is the human
  // origin story of Torrey Pines.
  'fleming, guy and margaret, house',
  // Heilman Villas — the softest keep: a rare surviving cottage
  // court on Coronado's main street.
  'heilman villas',
  // John R. and Florence Porterfield Beardsley House — Cliff May
  // caught before he became the California ranch house.
  'john r and florence porterfield beardsley house',
  // Long-Waterman House — Governor-era name, Gill-circle
  // connections, Banker's Hill's showpiece Queen Anne.
  'long-waterman house',
  // Peterson, Robert O.–Russell Forester House — Peterson
  // founded Jack in the Box in San Diego (kept for the place's
  // importance; v2 flags its current telling as the weak part).
  'peterson, robert o-russell forester house',
  // Red Rest and Red Roost Cottages — 1894 beach-bungalow ground
  // zero at the Cove, with a preservation-fight saga.
  'red rest and red roost cottages',
  // Rice, Lilian Jenette, House — Rice is the story of Rancho
  // Santa Fe; this was her own house, with a subject portal to
  // her person story.
  'rice, lilian jenette, house',
  // U.S. Inspection Station/U.S. Custom House — NOT a house (a
  // federal border station the name classifier catches on
  // "Custom House"); v2's importance verdict is KEEP, so it is
  // excepted here. Reclassifying it as the landmark it is stays
  // a noted follow-up — do not read its presence here as a
  // claim that it is a residence.
  'us inspection station/us custom house',
  // Verlaque, Theophile, House — Ramona's founding figure; the
  // Main Street anchor (also the Woodward Museum).
  'verlaque, theophile, house',
  // Villa Montezuma — Jesse Shepard's séance-parlor mansion;
  // the deepest house shelf of the 35 (five rows).
  'villa montezuma',

  // — The local-register promotes (importance audit, 9) —
  // Alice Lee/ Irving J. Gill/ Hazel Wood Waterman House — the
  // OTHER Alice Lee house: Gill/Waterman, subject portal to
  // Waterman's own story. (The plain Alice Lee Residence three
  // doors down is audit DEAD WEIGHT — the difference is the
  // people.)
  'alice lee/ irving j gill/ hazel wood waterman house',
  // C. Arnholt Smith/ Ralph L. Frank House — the city's defining
  // bank-empire scandal, told in full.
  'c arnholt smith/ ralph l frank house',
  // Councilman Fred Heilbron House — "Mr. Water"; subject
  // portal to Heilbron's own aqueduct story.
  'councilman fred heilbron house',
  // Davis-Horton House — both founders of San Diego; Davis's
  // verbatim founder quote, Horton lived there laying out
  // downtown.
  'davis-horton house',
  // Marguerite Robinson/Lilian Jenette Rice House — Rice again,
  // in La Jolla; subject portal to her person story.
  'marguerite robinson/lilian jenette rice house',
  // T. Claude Ryan House — the Spirit of St. Louis builder;
  // subject portal to his own story.
  't claude ryan house',
  // Virginia Nuckolls/Cliff May House — the California ranch
  // house's origin point.
  'virginia nuckolls/cliff may house',
  // Whaley House Museum — Old Town's museum; the strongest
  // promote in the set. The registry dataset carries it
  // local-only (in reality a National Historic Landmark), which
  // is why it sat in the audit's population at all. Both
  // dialects: the shelf key and the registry record name.
  'whaley house museum',
  'whaley house',
  // Wheeler Bailey/Irving Gill House — Gill, with a subject
  // portal to his own story.
  'wheeler bailey/irving gill house',
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

/** True when the named place is a curated tour-important house that keeps Tier-1. */
export function isTier1HouseException(name: string): boolean {
  return EXCEPTION_SET.has(exceptionPlaceKey(name));
}
