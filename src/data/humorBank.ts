// The Unfiltered humor bank (humor layer, Nov 6, 2026).
//
// Erik's ruling, from the scope: the jokes must NOT be live
// AI improvisation — that is exactly what makes generated
// humor feel like AI. The layer is a CURATED bank: short,
// specific, local one-liners and deadpan asides, written
// once, human-edited line by line, and drawn contextually
// into the live tissue under strict timing discipline
// (routeColor's Unfiltered branch is the draw engine).
//
// THIS FILE SHIPS EMPTY — DELIBERATELY. The bank text is
// being drafted separately and enters this file ONLY after
// Erik's line-by-line review (the review file's final state
// IS the bank; no line ships unreviewed). With the bank
// empty, the Unfiltered state is provably inert: the draw
// finds nothing, generated Color Puck fills the color slots
// exactly as in a Standard build, and the state changes
// nothing but its own label in the capture. The harness
// pins that inertness — if lines ever land here without
// the review, the shipped-bank test screams.
//
// The record shape is the review workflow's contract:
//  - text: the line as it will be spoken (modulo the
//    standing spoken-form normalization every live piece
//    passes through). ≤ HUMOR_MAX_CHARS. May carry slot
//    fills — {road}, {destination}, {place} — filled ONLY
//    from the episode's real facts at draw time; a line
//    whose fills cannot be completed never draws.
//  - contexts: where the line may fire. A line with NO
//    contexts is context-light (the drive-deadpan pool) and
//    is eligible in any episode. A line WITH contexts must
//    match at least one declared value against the episode:
//    a road the route actually takes, a filler region the
//    cast actually sits in, a place_key in the cast, a topic
//    the cast or the thread carries, a thread anchor kind.
//  - slots: the tissue surfaces the line is shaped for, in
//    the scope's vocabulary. The draw engine maps them onto
//    the color seam's slots: 'reaction' → a reaction slot,
//    'bridge' → an aside inserted right after a story (the
//    bridge's neighborhood), 'wrap-up' → the closeout slot,
//    'preview' → the episode's FIRST color slot only (the
//    preview/first-bridge neighborhood).
//  - heat: 'warm' | 'spicy' | 'roast' — spacing discipline
//    (never two roast lines in one episode) and the audit
//    report read it.
//  - exclusions: the line's own vetoes — if the cast carries
//    any listed topic or place_key, the line never draws in
//    that episode, whatever its contexts say.
//  - expires: an ISO date (YYYY-MM-DD) after which the line
//    is dead — the refresh discipline for references that
//    date (a player, a construction project).

/** A humor line's register: spacing and the audit report read it. */
export type HumorHeat = 'warm' | 'spicy' | 'roast';

/** The tissue surfaces a line is shaped for (scope vocabulary; the draw engine maps them to color slots). */
export type HumorSlot = 'preview' | 'bridge' | 'wrap-up' | 'reaction';

export interface HumorContexts {
  /** Road names/labels the route may carry ('I-5', 'SR-163', 'the merge' as a label fragment). */
  roads?: string[];
  /** Filler region keys (src/data/fillerRegions: 'coast', 'north', 'central', 'east', 'south', 'backcountry'). */
  regions?: string[];
  /** Library place_keys that may appear in the episode's cast. */
  placeKeys?: string[];
  /** Topic tags the cast or the thread may carry ('Navy Century', 'Food & Drink', …). */
  topics?: string[];
  /** Thread anchor kinds ('destination', 'onroute', 'origin', 'feature', 'topic'). */
  anchorKinds?: string[];
}

export interface HumorExclusions {
  /** The line never draws in an episode whose cast carries any of these topics. */
  topics?: string[];
  /** The line never draws in an episode whose cast includes any of these place_keys. */
  placeKeys?: string[];
}

export interface HumorLine {
  /** Stable identity: the cooldown, the episode ledger, and the capture all key on it. */
  id: string;
  text: string;
  heat: HumorHeat;
  contexts?: HumorContexts;
  slots: HumorSlot[];
  exclusions?: HumorExclusions;
  /** ISO date (YYYY-MM-DD): the line is ineligible after this date. */
  expires?: string;
}

/** Humor pieces per episode, at most (Erik's ruling: cap 2) — inside the shared color budget, never on top of it. */
export const HUMOR_MAX_PER_EPISODE = 2;

/** A drawn line is ineligible again until this many drives have passed (Erik's ruling: 20). */
export const HUMOR_COOLDOWN_DRIVES = 20;

/** A humor line's hard character cap — tighter than color's 260: a bank beat is one breath. */
export const HUMOR_MAX_CHARS = 200;

const HUMOR_HEATS: readonly HumorHeat[] = ['warm', 'spicy', 'roast'];
const HUMOR_SLOTS: readonly HumorSlot[] = ['preview', 'bridge', 'wrap-up', 'reaction'];

/**
 * THE BANK. Empty until Erik's reviewed bank replaces it —
 * see the file header. Do not add lines here outside the
 * review workflow.
 */
export const HUMOR_BANK: HumorLine[] = [
  // ── AWAITING ERIK'S REVIEWED BANK ──────────────────────
  // The drafted lines enter here only as the review file's
  // final, line-by-line-approved state. Until then this
  // array stays empty and the Unfiltered state is inert.
];

/**
 * The bank lint (scope §10): every line tagged, length-
 * capped, slot-valid, uniquely identified. Returns a list of
 * problems (empty = clean). The harness runs it over the
 * shipped bank (trivially clean while empty) and over
 * fixtures; the review workflow runs it before any future
 * bank lands.
 */
export function validateHumorBank(bank: readonly HumorLine[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const line of bank) {
    const at = line && typeof line.id === 'string' && line.id ? line.id : '(no id)';
    if (!line || typeof line.id !== 'string' || !line.id) problems.push(`${at}: missing id`);
    else if (seen.has(line.id)) problems.push(`${at}: duplicate id`);
    else seen.add(line.id);
    if (!line || typeof line.text !== 'string' || !line.text.trim()) problems.push(`${at}: empty text`);
    else if (line.text.length > HUMOR_MAX_CHARS) problems.push(`${at}: text ${line.text.length} chars > ${HUMOR_MAX_CHARS}`);
    if (!line || !HUMOR_HEATS.includes(line.heat)) problems.push(`${at}: invalid heat ${String(line?.heat)}`);
    if (!line || !Array.isArray(line.slots) || line.slots.length === 0) problems.push(`${at}: no slots`);
    else {
      for (const s of line.slots) if (!HUMOR_SLOTS.includes(s)) problems.push(`${at}: invalid slot ${String(s)}`);
    }
    if (line?.expires !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(line.expires)) {
      problems.push(`${at}: expires is not an ISO date`);
    }
  }
  return problems;
}
