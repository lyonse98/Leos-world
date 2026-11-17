// The solicited-suggestion channel (v16.2 Slice 4, Nov 16, 2026).
//
// A Passenger/Walking listener can ASK Miles for a stop — food,
// a drink, something to do — and Miles answers with ONE
// recommendation composed entirely from the current-events
// layer's freshness-verified candidate pool (Slice 2) ranked
// under the listener's profile (Slice 3's reads). This module
// is the composer: pure functions over the pool. The engines
// (tour.ts freeform, routePlayback.ts route) own the gate, the
// spoken delivery, and the telemetry; the mode fence itself
// lives with its sibling in routeMode.ts
// (suggestionGateOpen — declared Passenger/Walking only; in
// Driving the ask surface does not exist at any layer).
//
// ============================================================
// WHAT THIS CHANNEL IS NOT.
// It is not story Q&A. The question pipeline (free text in,
// generated answer out) is untouched by this slice — no
// prompt is built, no model is called, no answer text is
// generated. A suggestion answer is a TEMPLATE over verified
// facts: the place's real name from the source, its real
// hours claim as the freshness gate computed it, a detour
// number only when a Routes-grade source actually computed
// one. If no candidate passes every gate, the answer is an
// honest "nothing I can vouch for" — Miles never invents a
// place, an hour, or an "open now" to fill the silence.
// ============================================================
//
// THE FORM (suggestion policy, adopted Nov 13, 2026 — shotgun
// decision brief, final package §Suggestion Policy):
//   - One best pick, then ONE alternate on a second ask — a
//     two-pick cap per tour (MAX_SUGGESTION_PICKS). A third
//     ask gets the honest cap answer, not a weaker pick.
//   - The spoken pick is one recommendation carrying the
//     reason (why this place, for this listener), the detour
//     cost when it is known, and a time fact — followed by an
//     off-ramp in EVERY answer: a spoken way to say no or to
//     hear the alternate. No fake urgency, ever: "closes at
//     9" is a fact and may be spoken; "hurry" may not.
//   - Sponsored suggestions are labeled. No sponsored
//     inventory exists and nothing in v1 marks a candidate
//     sponsored; the hook is the `sponsoredPlaceIds` input —
//     a pick whose place id is in that set renders the label
//     at the head of its spoken text, because in an audio
//     product a label that is only on a screen is no label.
//   - Detour cost: the composer accepts a per-candidate
//     detour from the caller (a Routes consumer) or the
//     candidate's own detourMinutes (always null in the
//     Slice 2 layer — detour costing belongs to a Routes
//     owner). Where no number exists, the clause is OMITTED.
//     Distance is never converted into a detour estimate:
//     a fabricated minute is a fabricated fact.
//
// FRESHNESS AT ANSWER TIME. The pool was gated at discovery,
// but a pool can stand while the drive continues — so the
// composer re-judges what it can still judge from the
// candidate's own provenance: hours older than the standard's
// cache age at the moment of the ask are stale and the place
// is ineligible again; a place whose computed close has since
// passed is no longer "open now" whatever discovery thought.
// The spoken pick must be verifiably open NOW (openNow ===
// true): unknown is not a claim, per the standard.
//
// CONSTRAINTS AT ANSWER TIME. Declared constraints are
// re-applied from the candidate's types (the type-based half —
// alcohol-primary, with-kids vs bar/nightclub) plus the
// declared max-detour cap whenever a detour number exists.
// The dietary check needs provider data the candidate does
// not carry; it was enforced at discovery and is not
// re-judged here — named, not papered over.
//
// LOGGING (the engines file these; the vocabulary is fixed
// here so both engines file identical shapes):
//   suggestion_asked    { intent, turn }
//   suggestion_answered { outcome: 'pick' | 'none', place_id,
//                         candidate_kind, reason_codes,
//                         primary_reason, sponsored,
//                         detour_minutes, turn }
//   suggestion_playback { completed, sounded_ms, place_id }
//   suggestion_outcome  { outcome: 'accepted' | 'dismissed' |
//                         'asked-another', place_id, intent }
// Asks, answers with reason codes, and outcomes are what make
// the policy's acceptance rate — and its demotion rule —
// measurable. An outcome is filed only when the listener
// actually gives one; a pick still pending at tour end files
// nothing (unmeasured is honest; a dismissal is not inferred).

import { FRESHNESS_STANDARD } from './freshness';
import {
  matchedTasteIds,
  typesSurviveConstraints,
  type EventCandidate,
  type EventCandidateKind,
} from './currentEvents';
import { OPTION_LABELS, type MatchInputs, type ResolvedConstraints } from './profile';

// ------------------------------------------------------------ vocabulary

/** What the listener asked for, in the ask surface's own words. */
export type SuggestionIntent = 'food' | 'drink' | 'do' | 'any';

/** The listener's verdict on a delivered pick (filed as suggestion_outcome). */
export type SuggestionOutcome = 'accepted' | 'dismissed' | 'asked-another';

const INTENT_KINDS: Record<SuggestionIntent, readonly EventCandidateKind[] | null> = {
  food: ['eat'],
  drink: ['drink'],
  do: ['do'],
  any: null, // any eat/drink/do candidate
};

/** Two picks per tour: the best pick, then one alternate (the policy's two-turn cap). */
export const MAX_SUGGESTION_PICKS = 2;

/**
 * Reason codes, filed on every answer. Pick codes say why THIS
 * place; none codes say why there is no pick — the distinction
 * the acceptance data needs (a stale pool is a data problem, a
 * constraint shutout is a profile fact, a cap is the policy
 * working as designed).
 */
export type SuggestionReasonCode =
  | 'profile-match'
  | 'closes-soon'
  | 'shelf-story'
  | 'top-rated'
  | 'nearby'
  | 'open-now'
  // The place-memory callback flavor's reason (v16.2 Slice
  // 6, placeMemory.ts): filed as a callback proposal's
  // primary reason so its acceptance reads in the same
  // vocabulary. This composer never produces it — a callback
  // is not composed from the pool.
  | 'place-memory'
  | 'pool-empty'
  | 'intent-unmatched'
  | 'all-stale'
  | 'none-open'
  | 'constraints-excluded'
  | 'turn-cap';

export interface SuggestionPick {
  kind: 'pick';
  candidate: EventCandidate;
  /** The full spoken answer: [label] recommendation + off-ramp. */
  text: string;
  /** The recommendation alone (no off-ramp) — the engines' label/caption source. */
  recommendation: string;
  /** Every reason code that applies, in claim priority order; [0] is the spoken one. */
  reasonCodes: SuggestionReasonCode[];
  primaryReason: SuggestionReasonCode;
  /** The detour number the answer used, or null when it honestly had none. */
  detourMinutes: number | null;
  sponsored: boolean;
  /** Which pick this is: 1 = best pick, 2 = the alternate. */
  turn: number;
}

export interface SuggestionNone {
  kind: 'none';
  /** The full spoken answer: the honest no-suggestion line. */
  text: string;
  reasonCodes: SuggestionReasonCode[];
  sponsored: false;
}

export type SuggestionAnswer = SuggestionPick | SuggestionNone;

export interface ComposeSuggestionOptions {
  intent: SuggestionIntent;
  nowMs: number;
  /** Ranking provenance for the spoken reason; default = no declared tastes. */
  match?: MatchInputs;
  /** Declared constraints; default = none declared. */
  constraints?: ResolvedConstraints;
  /** Places already suggested this tour — never re-picked. */
  excludePlaceIds?: ReadonlySet<string>;
  /** Picks already delivered this tour (the two-pick cap judges this). */
  picksUsed?: number;
  /**
   * Detour costing from a Routes-owning caller. Returning null
   * (or not providing the hook) means "not computed" — the
   * answer omits the number; it is never approximated here.
   */
  detourMinutesFor?: (candidate: EventCandidate) => number | null;
  /**
   * The sponsored-labeling hook: place ids whose pick must
   * render the sponsored label. No inventory wires this in v1;
   * the set exists so the label is a property of the FORM,
   * ready before any sponsored candidate can exist.
   */
  sponsoredPlaceIds?: ReadonlySet<string>;
}

const NEUTRAL_MATCH: MatchInputs = { topics: [], cuisines: [], drinks: [], activities: [], dietary: [] };
const NEUTRAL_CONSTRAINTS: ResolvedConstraints = {
  budgetComfort: null,
  maxDetourMinutes: null,
  alcoholOk: null,
  usuallyWithKids: null,
  dogFriendly: null,
  walkingTolerance: null,
  surpriseTolerance: null,
  dietary: [],
};

// ------------------------------------------------------------ spoken form

const CLOSES_SOON_MS = 60 * 60 * 1000;
const NEARBY_M = 400;
const TOP_RATED = 4.5;

function fmtTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  } catch {
    return '';
  }
}

/** The time fact, from the candidate's gate-computed hours only. */
function timeClause(candidate: EventCandidate): string {
  if (candidate.closesAtMs !== null) {
    const t = fmtTime(candidate.closesAtMs);
    return t ? `open until ${t}` : 'open now';
  }
  // Open with no close in the source's week = the 24 h shape:
  // "around the clock" is what the source hours say, verbatim-shaped.
  return 'open around the clock';
}

/** The spoken reason clause for the primary reason — every clause is checkable against the candidate. */
function reasonClause(
  primary: SuggestionReasonCode,
  candidate: EventCandidate,
  tasteLabels: string[],
): string {
  switch (primary) {
    case 'profile-match': {
      const labels = tasteLabels.slice(0, 2).join(' and ');
      return `it matches your ${labels} ${tasteLabels.length > 1 ? 'picks' : 'pick'}`;
    }
    case 'closes-soon':
      return "it's open now, but not for long";
    case 'shelf-story':
      return "it's a place I have a story about";
    case 'top-rated':
      return "it's the best-rated stop around here";
    case 'nearby':
      return "it's right nearby";
    default:
      return "it's open right now";
  }
}

/** The off-ramp: present in EVERY pick, worded by which pick this is. */
function offRamp(turn: number): string {
  return turn >= MAX_SUGGESTION_PICKS
    ? "That's the other one I'd stand behind around here."
    : 'Not the one? Ask for another and I\'ll find a different one — or just keep rolling.';
}

const NONE_TEXT: Record<string, string> = {
  'pool-empty':
    "I don't have any stops in reach that I can vouch for right now. Ask me again once we've covered a bit more road.",
  'intent-unmatched': "Nothing like that close by that I can vouch for right now.",
  'all-stale':
    "There are places nearby, but my hours for them are too old to trust — and I won't send you somewhere on stale hours.",
  'none-open':
    "Everything nearby that I'd send you to is closed right now — or I can't verify that it's open.",
  'constraints-excluded':
    "The places nearby don't fit what you've told me, so there's nothing I'd honestly send you to.",
  'turn-cap': "That's what I've got around here — two good options beat a third mediocre one.",
};

function noneAnswer(code: SuggestionReasonCode): SuggestionNone {
  return { kind: 'none', text: NONE_TEXT[code] ?? NONE_TEXT['pool-empty'], reasonCodes: [code], sponsored: false };
}

// ------------------------------------------------------------ the composer

/**
 * Compose one suggestion answer from the pool. The pool's own
 * order is the ranking (Slice 2 ranked it, profile included);
 * the composer filters by the gates and takes the first
 * survivor — it does not re-rank, so a profile signal is never
 * counted twice. Pure: the caller supplies the pool, the
 * profile reads, and the clock.
 */
export function composeSuggestion(
  pool: readonly EventCandidate[],
  opts: ComposeSuggestionOptions,
): SuggestionAnswer {
  const nowMs = opts.nowMs;
  const match = opts.match ?? NEUTRAL_MATCH;
  const constraints = opts.constraints ?? NEUTRAL_CONSTRAINTS;
  const picksUsed = opts.picksUsed ?? 0;
  const excluded = opts.excludePlaceIds ?? new Set<string>();

  if (picksUsed >= MAX_SUGGESTION_PICKS) return noneAnswer('turn-cap');
  if (pool.length === 0) return noneAnswer('pool-empty');

  const kinds = INTENT_KINDS[opts.intent];
  const ofIntent = kinds === null ? [...pool] : pool.filter(c => kinds.includes(c.kind));
  if (ofIntent.length === 0) return noneAnswer('intent-unmatched');

  // Freshness re-judged at answer time from the candidate's
  // own provenance (see the header): the standard's cache age
  // is a property of the claim's moment, not of discovery's.
  const fresh = ofIntent.filter(
    c => c.hoursFetchedAt <= nowMs && nowMs - c.hoursFetchedAt <= FRESHNESS_STANDARD.hoursMaxCacheAgeMs,
  );
  if (fresh.length === 0) return noneAnswer('all-stale');

  const detourOf = (c: EventCandidate): number | null =>
    opts.detourMinutesFor ? opts.detourMinutesFor(c) : c.detourMinutes;
  const constraintOk = fresh.filter(c => {
    if (!typesSurviveConstraints(c.types, constraints)) return false;
    const detour = detourOf(c);
    if (detour !== null && constraints.maxDetourMinutes !== null && detour > constraints.maxDetourMinutes) {
      return false;
    }
    return true;
  });
  if (constraintOk.length === 0) return noneAnswer('constraints-excluded');

  // The spoken pick must be verifiably open now: the gate said
  // so at discovery AND its close (when it has one) is still
  // ahead of this moment.
  const open = constraintOk.filter(
    c => c.openNow === true && (c.closesAtMs === null || c.closesAtMs > nowMs),
  );
  if (open.length === 0) return noneAnswer('none-open');

  const freshPicks = open.filter(c => !excluded.has(c.placeId));
  if (freshPicks.length === 0) return noneAnswer('turn-cap');

  const candidate = freshPicks[0];
  const tasteIds = matchedTasteIds(candidate.types, match);
  const tasteLabels = tasteIds.map(id => OPTION_LABELS[id] ?? id);

  const reasonCodes: SuggestionReasonCode[] = [];
  if (tasteIds.length > 0) reasonCodes.push('profile-match');
  if (candidate.closesAtMs !== null && candidate.closesAtMs - nowMs <= CLOSES_SOON_MS) {
    reasonCodes.push('closes-soon');
  }
  if (candidate.hasShelfStory) reasonCodes.push('shelf-story');
  if (candidate.rating !== null && candidate.rating >= TOP_RATED) reasonCodes.push('top-rated');
  if (candidate.distanceM <= NEARBY_M) reasonCodes.push('nearby');
  reasonCodes.push('open-now');
  const primaryReason = reasonCodes[0];

  const detourMinutes = detourOf(candidate);
  const parts = [reasonClause(primaryReason, candidate, tasteLabels)];
  if (detourMinutes !== null) parts.push(`about ${Math.max(1, Math.round(detourMinutes))} minutes off your way`);
  parts.push(timeClause(candidate));
  const recommendation = `Try ${candidate.name} — ${parts.join(', ')}.`;
  const sponsored = opts.sponsoredPlaceIds?.has(candidate.placeId) ?? false;
  const turn = picksUsed + 1;
  const text = `${sponsored ? 'Sponsored — ' : ''}${recommendation} ${offRamp(turn)}`;

  return {
    kind: 'pick',
    candidate,
    text,
    recommendation,
    reasonCodes,
    primaryReason,
    detourMinutes,
    sponsored,
    turn,
  };
}
