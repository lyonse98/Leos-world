// The freshness standard (v16.2 Slice 2, Nov 16, 2026) — the
// enforceable floor under every time-sensitive claim Miles
// makes: a recommendation, an "open now", an event time. The
// current-events layer (currentEvents.ts) gates on this module
// and nothing else; a candidate that fails here is silently
// ineligible, never guessed around.
//
// ============================================================
// STATUS: LEAN-ADOPT, NOT RULED.
// The standard below is the floor proposed in the v16.2 stack
// plan (Nov 13, 2026, ◆ item 3); Erik leaned ADOPT on Nov 14,
// 2026, and the Nov 19 gate still confirms. It lives in this
// one module so the gate's ruling — adopt as-is or amend any
// number — is a single edit here. Nothing outside this file
// hard-codes a freshness number.
// ============================================================
//
// The standard, as proposed:
//   - No known hours = no recommendation. A place whose weekly
//     hours the source never gave us cannot be recommended at
//     all — its time-validity is unknowable, and wrong-hours is
//     the trust-kill failure class this layer exists to avoid.
//   - Hours cached ≤ 7 days. A hours record older than that is
//     treated as no record: schedules change, and a stale cache
//     must never speak.
//   - "Open now" is computed ONLY from source hours (the
//     place's own weekly periods + its UTC offset), never
//     model-guessed, never inferred from popularity or type.
//     When the computation cannot be made, the answer is null
//     (unknown) — a consumer may not upgrade null to a claim.
//   - Event times require a dated source ≤ 48 h old. An event
//     whose listing carries no source timestamp, or whose
//     source is older than the window, is not an event Miles
//     may name — however plausible it sounds.

/** The standard's numbers. Amend here only (see the header). */
export const FRESHNESS_STANDARD = {
  /** Hours records older than this are treated as absent. */
  hoursMaxCacheAgeMs: 7 * 24 * 60 * 60 * 1000,
  /** An event's source timestamp may be at most this old. */
  eventMaxSourceAgeMs: 48 * 60 * 60 * 1000,
  /** The gate itself, named so a ruling can relax it in one place. */
  requireKnownHours: true,
  /** "Open now" comes from source periods or is not claimed at all. */
  openNowFromSourceOnly: true,
} as const;

// ------------------------------------------------------------ source shapes
// The hours shape is Google Places (New)'s: weekly periods in
// the place's own local time, days 0–6 with Sunday = 0 (the
// same numbering Date.getUTCDay uses), plus the place's UTC
// offset in minutes. The layer's provider maps the wire shape
// onto these types; the gates below never see the wire.

export interface HoursPoint {
  /** 0 = Sunday … 6 = Saturday (Places + getUTCDay agree). */
  day: number;
  hour: number;
  minute: number;
}

export interface HoursPeriod {
  open: HoursPoint;
  /** Absent on a period the source leaves open-ended (24 h places). */
  close?: HoursPoint;
}

/**
 * One place's hours as one fetch learned them. `fetchedAt` is
 * the cache clock the 7-day rule judges; `periods` is null when
 * the source returned no hours at all (distinct from an empty
 * list only in provenance — both are "unknown" to the gates).
 */
export interface PlaceHoursRecord {
  periods: readonly HoursPeriod[] | null;
  utcOffsetMinutes: number | null;
  /** Places businessStatus when the source gave one ('OPERATIONAL', …). */
  businessStatus: string | null;
  /** Which Places field the periods came from, for provenance. */
  hoursKind: 'current' | 'regular' | null;
  fetchedAt: number;
  source: 'places';
}

/** An event as a feed would report it: a start, and the source's own date. */
export interface DatedEvent {
  title: string;
  startsAtMs: number;
  /** When the SOURCE published/last-verified this listing. Null = undated. */
  sourceAtMs: number | null;
  sourceName: string;
}

// ------------------------------------------------------------ the hours gate

export type FreshnessFailure =
  | 'no-hours-record'
  | 'hours-unknown'
  | 'hours-stale'
  | 'not-operational';

export interface HoursAssessment {
  /** True only when every gate in the standard passes. */
  eligible: boolean;
  failures: FreshnessFailure[];
  /**
   * Computed from the source periods alone; null when the
   * computation cannot be made (ineligible record, missing
   * offset, malformed periods). Null is NOT false and never a
   * claim — consumers surface it as "hours unknown".
   */
  openNow: boolean | null;
  /** When openNow is true: the epoch ms the containing period closes. */
  closesAtMs: number | null;
  /** When openNow is false: the epoch ms of the next period opening. */
  opensAtMs: number | null;
}

const MIN_PER_WEEK = 7 * 24 * 60;

function pointMinutes(p: HoursPoint): number {
  return p.day * 1440 + p.hour * 60 + p.minute;
}

function validPoint(p: HoursPoint | undefined): p is HoursPoint {
  return (
    !!p &&
    Number.isFinite(p.day) && p.day >= 0 && p.day <= 6 &&
    Number.isFinite(p.hour) && p.hour >= 0 && p.hour <= 23 &&
    Number.isFinite(p.minute) && p.minute >= 0 && p.minute <= 59
  );
}

/** Usable periods only; a record with none usable has unknown hours. */
function usablePeriods(rec: PlaceHoursRecord): HoursPeriod[] {
  if (!rec.periods) return [];
  return rec.periods.filter(p => validPoint(p.open) && (p.close === undefined || validPoint(p.close)));
}

/** Minutes into the place-local week for an epoch instant. */
function localWeekMinutes(nowMs: number, utcOffsetMinutes: number): number {
  const local = new Date(nowMs + utcOffsetMinutes * 60_000);
  return local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();
}

/**
 * Open-now, computed from source periods only. Also derives
 * the containing period's close (when open) or the next
 * opening (when closed) as epoch instants, minute-precise.
 * An open-ended period (no close — the 24 h shape) is honored
 * for a day past its opening, which covers the overnight case
 * without claiming the whole week from one period.
 */
export function computeOpenNow(
  periods: readonly HoursPeriod[],
  nowMs: number,
  utcOffsetMinutes: number,
): { openNow: boolean; closesAtMs: number | null; opensAtMs: number | null } {
  const nowMin = localWeekMinutes(nowMs, utcOffsetMinutes);
  let closesInMin: number | null = null;
  let opensInMin: number | null = null;
  for (const p of periods) {
    const openMin = pointMinutes(p.open);
    const closeMinRaw = p.close ? pointMinutes(p.close) : openMin + 1440;
    const closeMin = closeMinRaw <= openMin ? closeMinRaw + MIN_PER_WEEK : closeMinRaw;
    // The interval may start in the previous week cycle and
    // wrap into this one, so test both this week's instant
    // and its next-cycle twin against the interval.
    for (const probe of [nowMin, nowMin + MIN_PER_WEEK]) {
      if (probe >= openMin && probe < closeMin) {
        const delta = closeMin - probe;
        if (closesInMin === null || delta < closesInMin) closesInMin = delta;
      }
    }
    // Next opening strictly after now (a period opening this
    // very minute is the open case above, not the next one).
    const deltaOpen = (openMin - nowMin + MIN_PER_WEEK) % MIN_PER_WEEK;
    if (deltaOpen > 0 && (opensInMin === null || deltaOpen < opensInMin)) opensInMin = deltaOpen;
  }
  if (closesInMin !== null) {
    return { openNow: true, closesAtMs: nowMs + closesInMin * 60_000, opensAtMs: null };
  }
  return {
    openNow: false,
    closesAtMs: null,
    opensAtMs: opensInMin !== null ? nowMs + opensInMin * 60_000 : null,
  };
}

/**
 * Judge one place's hours record against the standard. Pure:
 * the caller supplies the record and the instant. Every failed
 * gate is named in `failures` (a record can fail several);
 * `eligible` is the conjunction. Open-now is computed only
 * for an eligible record — an ineligible record's openNow is
 * null, so stale hours can never leak a claim downstream.
 */
export function assessHours(rec: PlaceHoursRecord | null, nowMs: number): HoursAssessment {
  const failures: FreshnessFailure[] = [];
  if (!rec) {
    return { eligible: false, failures: ['no-hours-record'], openNow: null, closesAtMs: null, opensAtMs: null };
  }
  const periods = usablePeriods(rec);
  if (FRESHNESS_STANDARD.requireKnownHours && (periods.length === 0 || rec.utcOffsetMinutes === null)) {
    failures.push('hours-unknown');
  }
  if (!(nowMs - rec.fetchedAt <= FRESHNESS_STANDARD.hoursMaxCacheAgeMs) || rec.fetchedAt > nowMs) {
    failures.push('hours-stale');
  }
  if (rec.businessStatus !== null && rec.businessStatus !== 'OPERATIONAL') {
    failures.push('not-operational');
  }
  if (failures.length > 0 || rec.utcOffsetMinutes === null) {
    return { eligible: failures.length === 0, failures, openNow: null, closesAtMs: null, opensAtMs: null };
  }
  const { openNow, closesAtMs, opensAtMs } = computeOpenNow(periods, nowMs, rec.utcOffsetMinutes);
  return { eligible: true, failures, openNow, closesAtMs, opensAtMs };
}

// ------------------------------------------------------------ the event gate

export type EventFreshnessFailure =
  | 'event-undated'
  | 'event-source-stale'
  | 'event-source-future'
  | 'event-past';

/**
 * Judge one feed event against the standard. An event Miles
 * may name must carry a source date inside the 48 h window
 * (and not from the future — a source dated ahead of now is
 * corrupt, not fresh) and must not already have started.
 */
export function assessEvent(
  ev: DatedEvent,
  nowMs: number,
): { eligible: boolean; failures: EventFreshnessFailure[] } {
  const failures: EventFreshnessFailure[] = [];
  if (ev.sourceAtMs === null || !Number.isFinite(ev.sourceAtMs)) {
    failures.push('event-undated');
  } else if (ev.sourceAtMs > nowMs) {
    failures.push('event-source-future');
  } else if (nowMs - ev.sourceAtMs > FRESHNESS_STANDARD.eventMaxSourceAgeMs) {
    failures.push('event-source-stale');
  }
  if (!Number.isFinite(ev.startsAtMs) || ev.startsAtMs < nowMs) {
    failures.push('event-past');
  }
  return { eligible: failures.length === 0, failures };
}
