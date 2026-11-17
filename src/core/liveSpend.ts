// The live-spend sub-cap (v16.2 Slice 8, Nov 16, 2026) — the
// pilot's governor on the ONE metered surface the
// suggestion / current-events layer owns: Google Places
// (New) requests dispatched by the current-events layer
// (currentEvents.ts) on behalf of pool refreshes, solicited
// asks, and proposal selections.
//
// ============================================================
// WHY THIS MODULE, WHY THIS SHAPE.
// The shotgun decision brief (Nov 12, 2026) put a standing
// per-call cost on rung 3's data layer and the v16.2 stack
// plan (◆ item 6) proposed the number: a $10/mo pilot
// sub-cap on suggestion / current-events live spend, logged
// per ask, degrading to library/places-cached answers when
// hit. The plan calls the number a CONFIG PARAMETER — Erik
// amends it; the mechanism is the build. So the number lives
// in exactly one named constant (LIVE_SPEND_POLICY below),
// the same one-module-per-policy shape freshness.ts set for
// the freshness standard. freshness.ts itself stays
// freshness-only: it owns the truth of time-sensitive
// claims, this module owns the truth of metered ones, and
// neither hard-codes the other's numbers.
//
// SCOPE — WHAT THE CAP GOVERNS, AND WHAT IT NEVER TOUCHES.
// Governed: every Places fetch the current-events layer
// dispatches (freeform pool refreshes; route-mode candidate
// supply for solicited asks and proposal arm-time selection,
// which App.tsx wires to the same discovery entry point).
// NOT governed, by the plan's fence: the library builders
// and their Vertex credit; the AI Studio live-app cap that
// the app's story generation, Q&A (suspended), and speech
// synthesis already live under — the suggestion channel's
// composed lines are SPOKEN through that shared narration
// layer, which is app-wide voice infrastructure, not a
// current-events ask, and is deliberately not metered here;
// tour story generation; anything outside the
// suggestion / current-events path. The events feed
// (NO_EVENTS_FEED) dispatches nothing and costs nothing.
//
// THE ACCOUNTING IS AN ESTIMATE, HONESTLY LABELED.
// Google bills Places per REQUEST, at the SKU of the most
// expensive field in the mask. The layer's mask carries
// opening hours (Enterprise) and the editorial summary
// (Atmosphere), so a request bills as Nearby Search
// Enterprise + Atmosphere: $40 per 1,000 requests — $0.040
// per ask — at the published first-band list price (Google
// Maps Platform pricing, read Nov 2026). The ledger charges
// that estimate for every ask DISPATCHED to the provider,
// whether the response comes back full, empty, or errored:
// the request left the device, and a governor that only
// counts successes is a governor that under-counts. Two
// honest consequences: (1) the ledger makes NO deduction
// for the SKU's 1,000 free monthly calls, so early in a
// month it overstates the bill — it is an upper bound, a
// planning number, never billing truth; (2) a dispatch the
// provider short-circuits internally (no API key configured,
// where fetchPlaces returns before any network call) is
// still charged — the governor sits at the layer's seam and
// cannot see inside the provider. At pilot scale both
// errors lean the same way: the cap trips a little early
// rather than a little late. (3) An ask is the layer's
// LOGICAL request for one anchor: the provider's key walk
// (currentEvents.ts, Nov 17, 2026) may put several HTTP
// attempts on the wire for it — one per configured key,
// plus a single retry pass — but the walk stops at the
// first key that answers, and restriction-denied or
// transport-failed attempts never become billable Google
// requests, so one ask yields at most one billable request
// and is charged exactly once, here at the seam.
//
// DEGRADATION, NEVER SILENCE.
// When the month's ledger reaches the cap, governed asks
// stop dispatching. Discovery then does exactly what it
// already does on a provider-empty day: it falls back to
// the on-device hours cache, and every cached record is
// freshness-gated at serve time as always — a degraded
// answer is a cached answer that still passes the standard,
// or the composer's honest none-answer. The channel never
// fabricates an "open now", never reaches for a stale
// record, and never cuts off mid-conversation: the cap is
// judged at DISPATCH, so an ask already in flight when the
// cap trips completes and is recorded (the ledger may close
// a month a fraction over the cap — by less than one ask).
//
// LOGGING (filed by the engines / App on the existing emit
// path via discovery's onSpendEvent hook; vocabulary fixed
// here so every surface files identical shapes):
//   live_spend_ask     { surface, est_micro_usd,
//                        month_micro_usd, month_asks,
//                        cap_micro_usd }
//   live_spend_capped  { surface, month_micro_usd,
//                        cap_micro_usd }
//   live_spend_degraded { reason: 'spend-cap',
//                        month_micro_usd, cap_micro_usd }
//                      — once per discovery that had an ask
//                        blocked; the answers composed from
//                        that pool are the degraded answers,
//                        and both engines additionally stamp
//                        spend_degraded on suggestion_answered
//                        / proposal_offered while the cap
//                        stands. Together these make the
//                        pilot's real spend shape — asks,
//                        totals, the day the cap tripped —
//                        measurable from capture alone.
// ============================================================

/** The sub-cap and its per-ask estimate. Amend here only (see the header). */
export const LIVE_SPEND_POLICY = {
  /** The pilot sub-cap: $10.00 per calendar month, in micro-USD. */
  monthlyCapMicroUsd: 10_000_000,
  /**
   * One Places (New) searchNearby request at the layer's
   * field mask: Nearby Search Enterprise + Atmosphere list,
   * $40 / 1,000 requests (see the header). An ESTIMATE.
   */
  placesSearchNearbyMicroUsd: 40_000,
} as const;

/** The governed surface's name, as filed on every spend event. */
export const SPEND_SURFACE_PLACES = 'places-search-nearby';

// ------------------------------------------------------------ the ledger
// On-device, mirroring the profile / proposal store pattern:
// a raw-string store seam, a validated document, fail-soft
// everywhere. The document is month-keyed — each calendar
// month (the device's local month) carries its own total,
// so rollover is not an event anyone must fire: a new month
// simply reads as zero, and last month's total stays on
// record for the pilot's spend shape until the prune takes
// it. Money is integer micro-USD throughout — no float ever
// accumulates a rounding error into a cap decision.

export interface SpendLedgerStore {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

export const SPEND_LEDGER_KEY = 'leo_live_spend_ledger';
/** A ledger larger than this is not a ledger; it is corruption. Read as empty. */
const MAX_LEDGER_CHARS = 4_000;

export const localSpendLedgerStore: SpendLedgerStore = {
  read() {
    try {
      return localStorage.getItem(SPEND_LEDGER_KEY);
    } catch {
      return null;
    }
  },
  write(value: string) {
    try {
      localStorage.setItem(SPEND_LEDGER_KEY, value);
    } catch {
      /* storage unavailable — the ledger is a governor, never a failure */
    }
  },
  clear() {
    try {
      localStorage.removeItem(SPEND_LEDGER_KEY);
    } catch {
      /* ignore */
    }
  },
};

export interface SpendMonth {
  microUsd: number;
  asks: number;
}

interface SpendLedgerDoc {
  v: 1;
  months: Record<string, SpendMonth>;
}

/** The device's local calendar month for an instant: 'YYYY-MM'. */
export function spendMonthKey(nowMs: number): string {
  const d = new Date(nowMs);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

function cleanMonth(raw: unknown): SpendMonth | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.microUsd !== 'number' || !Number.isFinite(r.microUsd) || r.microUsd < 0) return null;
  if (typeof r.asks !== 'number' || !Number.isFinite(r.asks) || r.asks < 0) return null;
  return { microUsd: Math.floor(r.microUsd), asks: Math.floor(r.asks) };
}

function parseLedger(raw: string | null): SpendLedgerDoc {
  if (!raw || raw.length > MAX_LEDGER_CHARS) return { v: 1, months: {} };
  try {
    const doc = JSON.parse(raw) as SpendLedgerDoc;
    if (doc?.v !== 1 || typeof doc.months !== 'object' || doc.months === null) return { v: 1, months: {} };
    const months: Record<string, SpendMonth> = {};
    for (const [key, value] of Object.entries(doc.months)) {
      if (!/^\d{4}-\d{2}$/.test(key)) continue;
      const month = cleanMonth(value);
      if (month) months[key] = month;
    }
    return { v: 1, months };
  } catch {
    return { v: 1, months: {} };
  }
}

export function loadSpendLedger(store: SpendLedgerStore = localSpendLedgerStore): SpendLedgerDoc {
  let raw: string | null;
  try {
    raw = store.read();
  } catch {
    return { v: 1, months: {} };
  }
  return parseLedger(raw);
}

/** One month's standing: its key, its estimated total, its ask count. */
export function monthSpend(
  store: SpendLedgerStore = localSpendLedgerStore,
  nowMs: number = Date.now(),
): { monthKey: string; microUsd: number; asks: number } {
  const monthKey = spendMonthKey(nowMs);
  const month = loadSpendLedger(store).months[monthKey];
  return { monthKey, microUsd: month?.microUsd ?? 0, asks: month?.asks ?? 0 };
}

/** True while the month's recorded estimate stands at or over the cap. */
export function spendCapReached(
  store: SpendLedgerStore = localSpendLedgerStore,
  nowMs: number = Date.now(),
): boolean {
  return monthSpend(store, nowMs).microUsd >= LIVE_SPEND_POLICY.monthlyCapMicroUsd;
}

/** Keep the current and previous month; older months are the pilot's history, already captured server-side. */
function pruned(doc: SpendLedgerDoc, nowMs: number): SpendLedgerDoc {
  const keep = new Set<string>();
  keep.add(spendMonthKey(nowMs));
  const prev = new Date(nowMs);
  prev.setDate(1);
  prev.setMonth(prev.getMonth() - 1);
  keep.add(spendMonthKey(prev.getTime()));
  const months: Record<string, SpendMonth> = {};
  for (const key of Object.keys(doc.months)) {
    if (keep.has(key)) months[key] = doc.months[key];
  }
  return { v: 1, months };
}

function saveSpendLedger(store: SpendLedgerStore, doc: SpendLedgerDoc, nowMs: number): void {
  try {
    store.write(JSON.stringify(pruned(doc, nowMs)));
  } catch {
    /* a ledger write is never a failure */
  }
}

// ------------------------------------------------------------ the governor

export type SpendEventSink = (type: string, payload: Record<string, unknown>) => void;

export interface SpendGovernor {
  /**
   * Ask permission for one Places dispatch, charging the
   * estimate AT dispatch. Returns the month's new standing,
   * or null when the cap already stands — the caller then
   * does not dispatch at all. Because the charge lands at
   * dispatch, an ask in flight when the cap trips is never
   * recalled: it completes, and its charge is already true.
   */
  beginPlacesAsk(): { monthMicroUsd: number; monthAsks: number } | null;
  /** The current month's recorded estimate (re-reads the ledger). */
  monthMicroUsd(): number;
  /** True while the cap stands for the current month. */
  degraded(): boolean;
  readonly capMicroUsd: number;
}

/**
 * One governor per governed operation (a discovery call):
 * created at the layer's seam, it judges and charges against
 * the shared on-device ledger, so concurrent operations on
 * the same device account against the same month.
 */
export function createSpendGovernor(opts: {
  store?: SpendLedgerStore;
  /** A fixed instant, or a clock. Default: the wall clock. */
  nowMs?: number | (() => number);
  onEvent?: SpendEventSink;
} = {}): SpendGovernor {
  const store = opts.store ?? localSpendLedgerStore;
  const now = (): number =>
    typeof opts.nowMs === 'function' ? opts.nowMs() : opts.nowMs ?? Date.now();
  const cap = LIVE_SPEND_POLICY.monthlyCapMicroUsd;
  return {
    capMicroUsd: cap,
    beginPlacesAsk() {
      const nowMs = now();
      const doc = loadSpendLedger(store);
      const monthKey = spendMonthKey(nowMs);
      const month = doc.months[monthKey] ?? { microUsd: 0, asks: 0 };
      if (month.microUsd >= cap) {
        opts.onEvent?.('live_spend_capped', {
          surface: SPEND_SURFACE_PLACES,
          month_micro_usd: month.microUsd,
          cap_micro_usd: cap,
        });
        return null;
      }
      month.microUsd += LIVE_SPEND_POLICY.placesSearchNearbyMicroUsd;
      month.asks += 1;
      doc.months[monthKey] = month;
      saveSpendLedger(store, doc, nowMs);
      opts.onEvent?.('live_spend_ask', {
        surface: SPEND_SURFACE_PLACES,
        est_micro_usd: LIVE_SPEND_POLICY.placesSearchNearbyMicroUsd,
        month_micro_usd: month.microUsd,
        month_asks: month.asks,
        cap_micro_usd: cap,
      });
      return { monthMicroUsd: month.microUsd, monthAsks: month.asks };
    },
    monthMicroUsd() {
      return monthSpend(store, now()).microUsd;
    },
    degraded() {
      return spendCapReached(store, now());
    },
  };
}
