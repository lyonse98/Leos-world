// Unsolicited seam proposals (v16.2 Slice 5, Nov 16, 2026).
//
// Slice 4 built the SOLICITED channel: a Passenger/Walking
// listener asks, Miles answers. This module is the other
// direction — Miles speaks first, once, at a legal seam —
// plus the arrival tray that catches whatever the listener
// didn't decide while moving. The judgment lives here as
// pure functions; the engines (tour.ts freeform,
// routePlayback.ts route) own the gate, the delivery, and
// the telemetry, exactly as they do for suggestions.ts.
//
// THE GATE IS SLICE 4'S GATE. Proposals exist only where
// the suggestion channel exists: declared Passenger/Walking.
// Driving gets nothing — no spoken proposal, no tray entry,
// no surface — and the extension of unsolicited proposals
// to Driving is a separate, unruled decision (build plan,
// ruling-gated section). Nothing in this module knows or
// cares about the mode; the engines simply never call it
// with the gate closed.
//
// THE POLICY (adopted Nov 13, 2026 — shotgun decision
// brief, final package §Suggestion Policy, as narrowed by
// the build plan's Slice 5):
//   - Cap: ONE unsolicited proposal per drive
//     (MAX_UNSOLICITED_PROPOSALS_PER_DRIVE). Per-drive cap
//     ONLY: the brief's per-week cap, per-place suppression
//     window, and category cooldown were explicitly NOT
//     adopted, and none is implemented here.
//   - Form: the Slice 4 composer's recommendation line —
//     reason + detour (when known) + time fact, no fake
//     urgency. The solicited off-ramp is NOT spoken: a
//     proposal's off-ramp is silence (ignore = decline) and
//     the tray, where the decision surface lives.
//   - Timing fences, judged at the speak seam: never in the
//     first 60 s of a tour; never in the last 2 min (where
//     an end is knowable); never at a seam adjacent to
//     memorial or climax material (the settled item or the
//     next item); never near a complex interchange (an
//     engine input — neither engine has a maneuver signal
//     in v1, so both pass false and the story-boundary seam
//     is the whole discipline, as the plan allows); never
//     while the spoken channel is busy (a question, a
//     solicited answer, or a pick awaiting its outcome).
//   - Legal seams: story boundaries (the one the engines
//     wire for speech), the pre-drive preview and arrival
//     (stopped-state presentations — the tray's home; the
//     judge prices them below).
//
// SELECTION AND SPEECH ARE DIFFERENT BOUNDARIES. A proposal
// is composed (selected) at one story boundary and spoken
// at the NEXT, where everything is re-judged: the seam
// fences against the items actually adjacent then, and the
// candidate's freshness at speak time (judgeCandidateAtSpeak
// — the composer's own answer-time gates, run again). A
// candidate that closed or went stale in between is dropped
// silently; a blocked seam files its suppression and drops
// the selection with it. Nothing armed is ever carried past
// one boundary — a stale selection is worse than none, and
// re-selection at a later boundary costs nothing (the cap
// counts SPOKEN proposals only, so a drop never spends it).
//
// THE TRAY. A spoken proposal the listener doesn't decide
// while moving is written to the on-device lifecycle store
// at speak time (state 'spoken') and surfaces on the
// arrival / post-drive tray. Tray entries are re-judged at
// display (judgeTrayRecord): an entry whose open-until has
// passed, or whose hours have aged past the standard,
// renders EXPIRED — visible, honest, never actionable, never
// a live claim. Accepting on the tray records the outcome
// (and, per the standing ruling, never re-plans a drive:
// suggestions save; detour recomposition is gated
// elsewhere). Dismissing records the outcome and the entry
// leaves the tray.
//
// LOGGING (the engines file these on the existing emit
// path; the vocabulary is fixed here so both engines file
// identical shapes — the tray's outcomes are filed by the
// App on the same path with surface 'tray'):
//   proposal_offered    { place_id, candidate_kind,
//                         reason_codes, primary_reason,
//                         sponsored, detour_minutes, flavor }
//   proposal_playback   { completed, sounded_ms, place_id,
//                         flavor }
//   proposal_suppressed { reason, place_id, flavor }
//   proposal_dropped    { reason: 'stale-at-speak' |
//                         'closed-at-speak' |
//                         'heard-at-speak', place_id, flavor }
//   proposal_trayed     { place_id, flavor }
//   proposal_outcome    { outcome: 'accepted' | 'dismissed',
//                         place_id, surface: 'drive' | 'tray',
//                         flavor }
// Offered / playback / trayed / outcome are what make the
// policy's acceptance rate measurable. MEASUREMENT ONLY:
// the brief's automatic demotion of proactive mode under a
// low acceptance rate is NOT implemented in v1 — no code
// here or in the engines reads the rate back into behavior.
//
// FLAVORS (v16.2 Slice 6). A proposal is one of two flavors:
// 'place' — this slice's original, a freshness-verified stop
// from the current-events pool — and 'place-memory' — a
// callback to a story the listener passed on an earlier
// drive and never heard (placeMemory.ts). The flavor rides
// every event above so the two acceptance rates are
// separately computable under the one demotion metric. The
// flavors share the seam judge, the cap, and this tray; they
// differ in their speak-time re-judgment (a place is judged
// on its hours, a callback on its heard state) and in how a
// tray entry expires (below).

import { FRESHNESS_STANDARD } from './freshness';
import type { EventCandidate } from './currentEvents';
import { normalizePlaceName } from './routeHistory';
import type { SuggestionReasonCode } from './suggestions';

/** Which flavor of proposal a record / event belongs to. */
export type ProposalFlavor = 'place' | 'place-memory';

// ------------------------------------------------------------ the cap + fences

/** Per-drive cap on SPOKEN unsolicited proposals. The only cap (see header). */
export const MAX_UNSOLICITED_PROPOSALS_PER_DRIVE = 1;

/** Never speak a proposal in the tour's first 60 s. */
export const PROPOSAL_FIRST_MINUTE_MS = 60_000;

/** Never speak a proposal in the drive's last 2 min (where the end is knowable). */
export const PROPOSAL_LAST_MINUTES_MS = 120_000;

// ------------------------------------------------------------ the seam judge

/** Where a proposal may be presented. Only 'story-boundary' is spoken in v1. */
export type ProposalSeam = 'story-boundary' | 'preview' | 'arrival';

export type ProposalSeamBlock =
  | 'cap'
  | 'first-minute'
  | 'last-minutes'
  | 'after-solemn'
  | 'before-solemn'
  | 'interchange'
  | 'channel-busy';

export interface ProposalSeamInput {
  seam: ProposalSeam;
  /** Milliseconds since the tour started (the speak moment). */
  tourAgeMs: number;
  /**
   * Milliseconds until the drive's end, when an engine can
   * know it (route mode's progress estimate). Null = the end
   * is not knowable (freeform) and the last-minutes fence
   * cannot trigger.
   */
  remainingMs: number | null;
  /** The item that just settled was memorial or climax material. */
  prevSolemn: boolean;
  /** The item about to sound is memorial or climax material. */
  nextSolemn: boolean;
  /**
   * A complex interchange is near. No engine has a maneuver
   * signal in v1 — both pass false (see header).
   */
  interchangeNear: boolean;
  /** Proposals already SPOKEN this drive (the cap counts speech, not selections). */
  proposalsUsed: number;
  /** A question, a solicited answer, or an undecided pick owns the channel. */
  channelBusy: boolean;
}

/**
 * Judge one presentation moment. The cap binds every seam
 * (it counts speech, and stopped-state presentation rides
 * the same accounting); the spoken fences bind the spoken
 * seam only — at a stopped-state seam nothing is sounding,
 * so first-minute / last-minutes / solemn-adjacency /
 * interchange have nothing to protect. 'arrival' is the
 * tray itself: presentation there is always legal (it is
 * where undecided proposals land by design).
 */
export function judgeProposalSeam(
  input: ProposalSeamInput,
): { ok: true } | { ok: false; reason: ProposalSeamBlock } {
  if (input.seam === 'arrival') return { ok: true };
  if (input.proposalsUsed >= MAX_UNSOLICITED_PROPOSALS_PER_DRIVE) {
    return { ok: false, reason: 'cap' };
  }
  if (input.channelBusy) return { ok: false, reason: 'channel-busy' };
  if (input.seam === 'preview') return { ok: true };
  if (input.tourAgeMs < PROPOSAL_FIRST_MINUTE_MS) return { ok: false, reason: 'first-minute' };
  if (input.remainingMs !== null && input.remainingMs < PROPOSAL_LAST_MINUTES_MS) {
    return { ok: false, reason: 'last-minutes' };
  }
  if (input.prevSolemn) return { ok: false, reason: 'after-solemn' };
  if (input.nextSolemn) return { ok: false, reason: 'before-solemn' };
  if (input.interchangeNear) return { ok: false, reason: 'interchange' };
  return { ok: true };
}

// ------------------------------------------------------------ speak-time freshness

export type ProposalSpeakBlock = 'stale-at-speak' | 'closed-at-speak';

/**
 * The speak-time re-judgment: the Slice 4 composer's
 * answer-time gates, run on the selected candidate at the
 * moment of speech. The pool gated this candidate at
 * discovery and again at selection; a drive has passed
 * since, and the spoken claim must be true NOW — hours
 * still inside the standard's cache age, verifiably open,
 * and its close (when it has one) still ahead.
 */
export function judgeCandidateAtSpeak(
  candidate: EventCandidate,
  nowMs: number,
): { ok: true } | { ok: false; reason: ProposalSpeakBlock } {
  if (
    candidate.hoursFetchedAt > nowMs ||
    nowMs - candidate.hoursFetchedAt > FRESHNESS_STANDARD.hoursMaxCacheAgeMs
  ) {
    return { ok: false, reason: 'stale-at-speak' };
  }
  if (candidate.openNow === false) return { ok: false, reason: 'closed-at-speak' };
  if (candidate.openNow !== true) return { ok: false, reason: 'stale-at-speak' };
  if (candidate.closesAtMs !== null && candidate.closesAtMs <= nowMs) {
    return { ok: false, reason: 'closed-at-speak' };
  }
  return { ok: true };
}

// ------------------------------------------------------------ the lifecycle store

/**
 * One spoken proposal's lifecycle record, written at speak
 * time and resolved by its outcome. 'spoken' = offered and
 * undecided (this IS the tray entry once the drive ends);
 * 'accepted' = saved (in-drive or on the tray); 'dismissed'
 * = declined (leaves the tray; the record stays as the
 * ledger's memory until the cap trims it).
 */
export type ProposalRecordState = 'spoken' | 'accepted' | 'dismissed';

export interface ProposalRecord {
  placeId: string;
  name: string;
  /**
   * The candidate's kind: a place flavor carries its pool
   * kind (eat / drink / do); a place-memory callback carries
   * 'story' — the thing being proposed is a telling.
   */
  kind: EventCandidate['kind'] | 'story';
  primaryReason: SuggestionReasonCode;
  closesAtMs: number | null;
  hoursFetchedAt: number;
  offeredAt: number;
  /** The drive that offered it (the outcome event's session), when known. */
  sessionId: string | null;
  state: ProposalRecordState;
  /** The proposal's flavor (Slice 6). Records written before the flavor existed read as 'place'. */
  flavor: ProposalFlavor;
  /**
   * Place-memory only: when the drive that passed the place
   * concluded — the tray's "passed back in {month}" fact.
   * Null on every place record.
   */
  passedAt: number | null;
}

export interface ProposalStore {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

export const PROPOSAL_STORE_KEY = 'leo_suggestion_tray';
/** A store larger than this is not a tray; it is corruption. Read as empty. */
const MAX_STORE_CHARS = 32_000;
/** The tray is recent history, not an archive: the newest records only. */
const MAX_TRAY_RECORDS = 20;

/** The app default: localStorage, touched only inside functions (profile pattern). */
export const localProposalStore: ProposalStore = {
  read() {
    try {
      return localStorage.getItem(PROPOSAL_STORE_KEY);
    } catch {
      return null;
    }
  },
  write(value: string) {
    try {
      localStorage.setItem(PROPOSAL_STORE_KEY, value);
    } catch {
      /* storage unavailable — the tray is a nicety, never a failure */
    }
  },
  clear() {
    try {
      localStorage.removeItem(PROPOSAL_STORE_KEY);
    } catch {
      /* ignore */
    }
  },
};

function cleanRecord(raw: unknown): ProposalRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.placeId !== 'string' || r.placeId.length === 0) return null;
  if (typeof r.name !== 'string' || r.name.length === 0) return null;
  if (r.kind !== 'eat' && r.kind !== 'drink' && r.kind !== 'do' && r.kind !== 'story') return null;
  if (typeof r.primaryReason !== 'string' || r.primaryReason.length === 0) return null;
  if (r.closesAtMs !== null && typeof r.closesAtMs !== 'number') return null;
  if (typeof r.hoursFetchedAt !== 'number' || typeof r.offeredAt !== 'number') return null;
  if (r.state !== 'spoken' && r.state !== 'accepted' && r.state !== 'dismissed') return null;
  // Flavor + passedAt are Slice 6 fields: a record written
  // before they existed is a place record with no pass date.
  if (r.flavor !== undefined && r.flavor !== 'place' && r.flavor !== 'place-memory') return null;
  if (r.passedAt !== undefined && r.passedAt !== null && typeof r.passedAt !== 'number') return null;
  return {
    placeId: r.placeId,
    name: r.name,
    kind: r.kind,
    primaryReason: r.primaryReason as SuggestionReasonCode,
    closesAtMs: r.closesAtMs as number | null,
    hoursFetchedAt: r.hoursFetchedAt,
    offeredAt: r.offeredAt,
    sessionId: typeof r.sessionId === 'string' ? r.sessionId : null,
    state: r.state,
    flavor: (r.flavor as ProposalFlavor | undefined) ?? 'place',
    passedAt: (r.passedAt as number | null | undefined) ?? null,
  };
}

/** All lifecycle records, newest first. Corrupt or oversized stores read as empty. */
export function loadProposalRecords(store: ProposalStore = localProposalStore): ProposalRecord[] {
  let raw: string | null;
  try {
    raw = store.read();
  } catch {
    return [];
  }
  if (!raw || raw.length > MAX_STORE_CHARS) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ProposalRecord[] = [];
  for (const entry of parsed) {
    const rec = cleanRecord(entry);
    if (rec) out.push(rec);
  }
  out.sort((a, b) => b.offeredAt - a.offeredAt);
  return out.slice(0, MAX_TRAY_RECORDS);
}

function saveProposalRecords(store: ProposalStore, records: ProposalRecord[]): void {
  try {
    store.write(JSON.stringify(records.slice(0, MAX_TRAY_RECORDS)));
  } catch {
    /* the tray is a nicety, never a failure */
  }
}

/**
 * File a freshly spoken proposal. A re-offer of the same
 * place replaces its older record — the tray shows the
 * fresh offer, never a stack of duplicates.
 */
export function recordProposal(store: ProposalStore, record: ProposalRecord): void {
  const rest = loadProposalRecords(store).filter(r => r.placeId !== record.placeId);
  saveProposalRecords(store, [record, ...rest]);
}

/**
 * Resolve the newest record for a place (an in-drive or
 * tray verdict). Returns false when no record stands —
 * resolving is the caller's outcome event to file either
 * way; this only reports whether the ledger moved.
 */
export function resolveProposalRecord(
  store: ProposalStore,
  placeId: string,
  outcome: 'accepted' | 'dismissed',
): boolean {
  const records = loadProposalRecords(store);
  const idx = records.findIndex(r => r.placeId === placeId);
  if (idx < 0) return false;
  records[idx] = { ...records[idx], state: outcome };
  saveProposalRecords(store, records);
  return true;
}

// ------------------------------------------------------------ tray display judgment

export interface TrayJudgment {
  /** On the tray at all (dismissed records are not). */
  visible: boolean;
  /**
   * The entry's window has passed: its open-until is behind
   * us, or its hours have aged past the standard. An expired
   * entry renders as expired — never as a live claim.
   */
  expired: boolean;
  /** The listener may still act on it (undecided + unexpired). */
  actionable: boolean;
}

/**
 * Judge one record for display, at display time — the same
 * freshness discipline as speech, applied to the screen:
 * what the tray shows must be true when it is shown.
 *
 * Expiry is flavor-shaped. A PLACE entry expires on its
 * hours: its open-until passed, or its hours aged past the
 * standard. A PLACE-MEMORY entry has no hours and no closing
 * time — its claim is "this story is still unheard", so it
 * expires exactly when that stops being true: the place
 * stands in the caller's heard-name set (normalized keys).
 * A caller that cannot supply heard evidence passes no set,
 * and a callback then renders unexpired — fail-open toward
 * showing the entry, because the tray's heard fetch is
 * best-effort everywhere else in the shell too; the entry it
 * might wrongly keep actionable is a story the listener can
 * simply dismiss.
 */
export function judgeTrayRecord(
  record: ProposalRecord,
  nowMs: number,
  heardNameKeys?: ReadonlySet<string>,
): TrayJudgment {
  if (record.state === 'dismissed') return { visible: false, expired: false, actionable: false };
  const expired =
    record.flavor === 'place-memory'
      ? heardNameKeys !== undefined && heardNameKeys.has(normalizePlaceName(record.name))
      : (record.closesAtMs !== null && record.closesAtMs <= nowMs) ||
        nowMs - record.hoursFetchedAt > FRESHNESS_STANDARD.hoursMaxCacheAgeMs;
  return {
    visible: true,
    expired,
    actionable: record.state === 'spoken' && !expired,
  };
}

/** The tray's entries: visible records with their display judgments, newest first. */
export function trayEntries(
  store: ProposalStore,
  nowMs: number,
  heardNameKeys?: ReadonlySet<string>,
): { record: ProposalRecord; judgment: TrayJudgment }[] {
  return loadProposalRecords(store)
    .map(record => ({ record, judgment: judgeTrayRecord(record, nowMs, heardNameKeys) }))
    .filter(e => e.judgment.visible);
}
