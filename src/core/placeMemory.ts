// Place-memory callbacks (v16.2 Slice 6, Nov 16, 2026).
//
// One FLAVOR of the Slice 5 unsolicited-proposal channel —
// not a new channel, and emphatically NOT the callback
// opener. The opener form that replayed the last drive at
// tour start was killed Nov 16, 2026 and stays dead: nothing
// here touches intro composition, tour start, or the opener
// rotation. A callback is a mid-drive proposal under the
// exact discipline of every other proposal — the same seam
// judge, the same timing fences, the same per-drive cap, the
// same tray — whose candidate is not a place that is open
// now but a STORY the listener has already driven past and
// never heard: "You passed {place} back in {month} — its
// story's still unheard."
//
// THE SOURCE. The on-device drive-record store
// (routeHistory.ts, the shell's `routeDrives` localStorage):
// one record per concluded ROUTE drive, carrying the place
// names that sounded (playedSubjects) and the place names
// the episode plan seated but the drive left unplayed at
// closeout (owedSubjects). Those records are the mechanism's
// embryo and they are all this flavor has — freeform drives
// file no drive records, so a listener who has only ever
// ridden freeform has no callbacks to give. Named, not
// papered over: widening the record to freeform is a
// different slice's question.
//
// "PASSED" — THE DEFINITION THIS FLAVOR USES. A place counts
// as passed when it stands in a concluded drive record's
// owedSubjects: the episode plan seated its story on the
// route the driver actually drove (plan stories are seated
// by GPS anchor along the path), and the drive concluded
// without the story sounding. The record's endedAt is when
// that drive concluded — the "back in {month}" the line
// speaks. The store records no per-place proximity or dwell
// of its own; plan membership on a concluded drive is the
// passed-evidence that exists, and this flavor uses nothing
// else.
//
// STILL UNHEARD — THE DISCHARGE RULES. A passed place is a
// candidate only while its story remains unheard. Evidence,
// strongest first:
//   (a) the caller's heard-name set (freeform: the heard
//       ledger hydrated into the Tour, this tour's settles
//       included; route: the current plan's subjects — see
//       the engines), and
//   (b) the store itself: a subject that stands in the
//       playedSubjects of any record NEWER than the record
//       that owes it was heard on that later drive and is
//       discharged. (The route composer never seats a heard
//       story, so owed-after-played inside the store should
//       not occur; the ledger, not this rule, is the
//       authority wherever both speak.)
// A subject owed by several drives yields ONE candidate,
// from the NEWEST owing record — the most recent pass is
// the memory the line speaks.
//
// THE PRIORITY RULE (pinned here; the engines implement it
// verbatim). When both flavors could arm at a boundary, the
// PLACE proposal wins and the callback is not armed. A place
// proposal carries a perishable, freshness-verified claim —
// open now, closing at a real time — that is worthless
// tomorrow; a callback is evergreen (the story is exactly as
// unheard next drive as this one) and loses nothing by
// waiting. Callbacks therefore fill the drives the pool has
// nothing for, and never displace a live recommendation.
// Both flavors spend the SAME per-drive cap
// (MAX_UNSOLICITED_PROPOSALS_PER_DRIVE, proposals.ts): a
// spoken callback is the drive's one proposal, full stop.
//
// THE FORM. One composed line, template only — zero AI
// calls, like every suggestion answer. The memory fact (the
// place, the month it was passed) and the unheard fact are
// both checkable against the record; nothing else is
// claimed. No off-ramp is spoken (a proposal's off-ramp is
// silence, Slice 5) and the decision surface is the same
// pending-pick row and arrival tray as any proposal.
//
// SPEAK-TIME RE-JUDGMENT. Selection and speech are different
// boundaries (proposals.ts), and a memory can die between
// them: the place's story may sound as an ordinary story in
// between. judgeCallbackAtSpeak is the flavor's freshness
// re-judgment — the story must STILL be unheard at the
// moment of speech, judged against the engine's live heard
// evidence. A failure drops the selection silently
// (proposal_dropped, reason 'heard-at-speak') and never
// spends the cap.
//
// LOGGING. The callback rides the Slice 5 proposal event
// vocabulary with one addition: every proposal_* event the
// engines file carries `flavor` ('place' | 'place-memory'),
// so callback acceptance is separately computable under the
// same demotion kill-metric as place proposals.
// MEASUREMENT ONLY, exactly as Slice 5 left it: nothing
// reads the rate back into behavior in v1.

import { normalizePlaceName, type RouteDriveRecord } from './routeHistory';
import type { SuggestionReasonCode } from './suggestions';

/** The flavor tag filed on every proposal event for this flavor. */
export const PLACE_MEMORY_FLAVOR = 'place-memory' as const;

/** The reason code a callback files as its primary (and only) reason. */
export const PLACE_MEMORY_REASON: SuggestionReasonCode = 'place-memory';

/** The candidate kind a callback carries through the pending pick and the tray record. */
export const CALLBACK_CANDIDATE_KIND = 'story' as const;

/** Stable per-place id for the callback flavor: the normalized place name, namespaced. */
export function callbackPlaceId(nameKey: string): string {
  return `memory:${nameKey}`;
}

export interface CallbackCandidate {
  /** `memory:<normalized name>` — the proposal machinery's place id for this flavor. */
  placeId: string;
  /** The place's display name, exactly as the drive record carries it. */
  name: string;
  /** normalizePlaceName(name) — the heard-evidence key. */
  nameKey: string;
  /** When the drive that passed it concluded (that record's endedAt). */
  lastPassedAt: number;
  /** The one spoken line, composed at derivation time. */
  line: string;
}

/** The "when" the line speaks, from the pass's own date — never a fabricated recency. */
function passedWhenLabel(lastPassedAt: number, nowMs: number): string {
  const then = new Date(lastPassedAt);
  const now = new Date(nowMs);
  const month = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(then);
  if (then.getFullYear() === now.getFullYear() && then.getMonth() === now.getMonth()) {
    return 'earlier this month';
  }
  if (then.getFullYear() === now.getFullYear()) return `back in ${month}`;
  return `back in ${month} ${then.getFullYear()}`;
}

/** The callback's one spoken line: the memory fact + the unheard fact, nothing else. */
export function composeCallbackLine(name: string, lastPassedAt: number, nowMs: number): string {
  return `You passed ${name} ${passedWhenLabel(lastPassedAt, nowMs)} — its story's still unheard.`;
}

/**
 * Derive the standing callback candidates from the drive
 * records: passed-but-unheard places, newest pass first
 * (records stand newest-first; within a record, the plan's
 * own owed order). Pure: the caller supplies the records,
 * its heard evidence as normalized name keys, and the clock.
 * See the header for the discharge rules and the priority
 * rule this derivation serves.
 */
export function deriveCallbackCandidates(
  records: readonly RouteDriveRecord[],
  heardNameKeys: ReadonlySet<string>,
  nowMs: number,
  opts: { excludePlaceIds?: ReadonlySet<string> } = {},
): CallbackCandidate[] {
  const discharged = new Set<string>(heardNameKeys);
  const seen = new Set<string>();
  const out: CallbackCandidate[] = [];
  for (const record of records) {
    for (const name of record.owedSubjects) {
      const nameKey = normalizePlaceName(name);
      if (!nameKey || discharged.has(nameKey) || seen.has(nameKey)) continue;
      seen.add(nameKey);
      const placeId = callbackPlaceId(nameKey);
      if (opts.excludePlaceIds?.has(placeId)) continue;
      out.push({
        placeId,
        name,
        nameKey,
        lastPassedAt: record.endedAt,
        line: composeCallbackLine(name, record.endedAt, nowMs),
      });
    }
    // This record's played subjects discharge every OLDER
    // record's owed claim on the same place (header rule b):
    // the story was heard on this later drive.
    for (const name of record.playedSubjects) {
      const nameKey = normalizePlaceName(name);
      if (nameKey) discharged.add(nameKey);
    }
  }
  return out;
}

export type CallbackSpeakBlock = 'heard-at-speak';

/**
 * The speak-time re-judgment: the story must still be
 * unheard NOW, against the engine's live heard evidence
 * (normalized name keys). A place heard between selection
 * and speech — its story sounded as an ordinary story — is
 * dropped silently; speaking "still unheard" over a story
 * the listener just heard would be a false claim.
 */
export function judgeCallbackAtSpeak(
  candidate: CallbackCandidate,
  heardNameKeys: ReadonlySet<string>,
): { ok: true } | { ok: false; reason: CallbackSpeakBlock } {
  if (heardNameKeys.has(candidate.nameKey)) return { ok: false, reason: 'heard-at-speak' };
  return { ok: true };
}
