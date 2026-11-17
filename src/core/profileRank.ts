// Profile ranking signal (v16.2 Slice 3, Nov 16, 2026).
//
// The composer-side half of the personalization package. The
// profile tool (profile.ts) has stored declared + inferred
// story-topic affinities on-device since Nov 13, 2026, and
// until this slice nothing in story selection read them (its
// first consumer was the current-events layer, Slice 2). This
// module is the ONE seam through which the affinity signal
// enters story ranking — freeform discovery (facts.ts), the
// route composer and the coverage guarantee's shelf ranking
// (routeMode.ts / routeGapFill.ts) all take their weights
// from here, so the fences live in exactly one place:
//
//   - SELECTION ONLY, the tone doctrine applied to taste: the
//     signal orders stories that are already eligible. It
//     never filters a story out, never changes a spoken word,
//     never speaks, and never touches heard-history, the tier
//     structure, portal discipline, climax protection, or the
//     F2 promise rules — those systems run exactly as they did
//     and consult this module for nothing.
//   - SOFT + BOUNDED. A unit's signal is the STRONGEST weight
//     among its topics, with the weights exactly as
//     matchInputs resolved them at read time: a declared
//     affinity weighs 1; an inferred one weighs its aged
//     confidence (90-day grace, 30-day half-life, 0.15 floor
//     — profile.ts owns the aging; this module never re-ages).
//     In the composers' lexicographic rank chains the term
//     sits BELOW every structural term (family boundary,
//     partner class, house class) and below this drive's own
//     tone steer — a stored taste never outranks a choice the
//     listener made for THIS drive — so it reorders within a
//     class and cannot promote across one. In freeform's
//     numeric score the boost is capped (below), under half
//     the smallest structural step in that score, so it can
//     swap near-tied candidates and nothing more.
//   - PARITY. No profile, an empty profile, and a paused
//     profile all resolve to zero weights (matchInputs
//     empties itself when paused), and a zero weight is an
//     exact no-op in every consumer: rank terms read their
//     neutral 1 and the score boost adds 0. Behavior with no
//     signal is arithmetically the pre-slice behavior.
//
// Declared CONSTRAINTS are not part of this signal and gain
// no new consumer here: they keep their existing hard-filter
// behavior in the surfaces that already implement it (the
// current-events layer), unwidened and unweakened.

import type { MatchInputs } from './profile';

/** One topic weight as matchInputs resolved it: declared = 1, inferred = aged confidence. */
export type ProfileTopicWeight = MatchInputs['topics'][number];

/**
 * The freeform score cap. facts.ts's structural steps are far
 * larger: the house-importance graduation steps by 20 points
 * (SOLID −30 / unaudited −50 / DEAD WEIGHT −70), the local
 * registry boost caps at 25, and the distance term runs
 * −1 point per 90 m. A boost of at most 8 points (~720 m of
 * distance) can swap candidates that were already near-tied
 * and can never bridge a structural step.
 */
export const PROFILE_FREEFORM_BOOST_MAX = 8;

/** Topic → weight lookup. Duplicate topics keep the strongest weight; weights clamp to 0..1. */
export function profileWeightMap(
  topics: readonly { topic: string; weight: number }[] | undefined,
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const t of topics ?? []) {
    const w = Math.min(1, Math.max(0, t.weight));
    if (w > (map.get(t.topic) ?? 0)) map.set(t.topic, w);
  }
  return map;
}

/** A story's profile signal: the strongest weight among its topics, 0 when none match. */
export function profileWeightOf(topics: readonly string[], weights: ReadonlyMap<string, number>): number {
  let best = 0;
  for (const t of topics) {
    const w = weights.get(t) ?? 0;
    if (w > best) best = w;
  }
  return best;
}

/**
 * Rank-term form for the composers' lexicographic chains:
 * lower ranks first, so a declared match reads 0, no match
 * reads the neutral 1, and an inferred match lands strictly
 * between — weaker than declared by construction.
 */
export function profileRankOf(topics: readonly string[], weights: ReadonlyMap<string, number>): number {
  return 1 - profileWeightOf(topics, weights);
}

/** Score form for freeform discovery: the capped boost a candidate's topics earn. */
export function profileScoreBoost(topics: readonly string[], weights: ReadonlyMap<string, number>): number {
  return PROFILE_FREEFORM_BOOST_MAX * profileWeightOf(topics, weights);
}
