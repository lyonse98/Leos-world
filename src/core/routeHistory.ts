// Route drive records — "Previously on Miles" at the drive
// level (Erik, Nov 3, 2026, addendum 2). When a route tour
// concludes, the runner files ONE record of the drive: where it
// went, the thread it followed, what actually played, and what
// it still owes. The next build to the same destination (or on
// the same thread) may carry that record into its spoken
// preview — real data only, from the record and the current
// heard ledger.
//
// Client-side only, like the rest of the shell's local state:
// localStorage through backend's ls helpers, no DB table, no
// sync. The store is bounded (the most recent DRIVE_RECORD_LIMIT
// drives, newest first) and every read path degrades silently —
// a corrupt or oversized store is simply "no records", never an
// error the build can trip on. All logic here is pure given a
// store seam, so the harness proves it offline.

export interface RouteDriveRecord {
  destinationName: string;
  /** The destination's library place_key when the build could derive one, else null. */
  destinationPlaceKey: string | null;
  threadTopic: string | null;
  /** Place names that actually sounded, in plan order. */
  playedSubjects: string[];
  /** Place names the closeout left owed (unplayed plan stories), in plan order. */
  owedSubjects: string[];
  /** Epoch ms the tour concluded. */
  endedAt: number;
}

export const DRIVE_RECORD_LIMIT = 20;
/** A store larger than this is not a drive history; it is corruption. Read as empty. */
const MAX_STORE_CHARS = 64_000;

export interface DriveRecordStore {
  read(): string | null;
  write(value: string): void;
}

/** Name matching is forgiving about case, spacing and punctuation — and nothing else. */
export function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isRecord(v: unknown): v is RouteDriveRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.destinationName === 'string' &&
    (typeof r.destinationPlaceKey === 'string' || r.destinationPlaceKey === null) &&
    (typeof r.threadTopic === 'string' || r.threadTopic === null) &&
    Array.isArray(r.playedSubjects) &&
    r.playedSubjects.every(s => typeof s === 'string') &&
    Array.isArray(r.owedSubjects) &&
    r.owedSubjects.every(s => typeof s === 'string') &&
    typeof r.endedAt === 'number' &&
    Number.isFinite(r.endedAt)
  );
}

/** Parse a raw store value. Anything unexpected — bad JSON, wrong shape, oversized — reads as no records. */
export function parseDriveRecords(raw: string | null): RouteDriveRecord[] {
  if (!raw || raw.length > MAX_STORE_CHARS) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).slice(0, DRIVE_RECORD_LIMIT);
  } catch {
    return [];
  }
}

export function loadDriveRecords(store: DriveRecordStore): RouteDriveRecord[] {
  try {
    return parseDriveRecords(store.read());
  } catch {
    return [];
  }
}

/** Newest first, capped: the 21st record evicts the oldest. */
export function appendDriveRecord(records: RouteDriveRecord[], record: RouteDriveRecord): RouteDriveRecord[] {
  return [record, ...records].slice(0, DRIVE_RECORD_LIMIT);
}

export function saveDriveRecord(store: DriveRecordStore, record: RouteDriveRecord): void {
  try {
    store.write(JSON.stringify(appendDriveRecord(loadDriveRecords(store), record)));
  } catch {
    /* storage unavailable — the record is a nicety, never a failure */
  }
}

/**
 * The relevant prior drive for a new build, deterministically —
 * at most one is ever used:
 *  (a) same destination: a place_key match outranks a
 *      (normalized) name match, and either outranks…
 *  (b) …a prior drive on the same thread topic.
 * Records are stored newest first; within a tier, the newest
 * match wins.
 */
export function selectPriorDrive(
  records: RouteDriveRecord[],
  args: { destinationPlaceKey: string | null; destinationName: string; threadTopic: string | null },
): RouteDriveRecord | null {
  if (args.destinationPlaceKey) {
    const byKey = records.find(r => r.destinationPlaceKey !== null && r.destinationPlaceKey === args.destinationPlaceKey);
    if (byKey) return byKey;
  }
  const wanted = normalizePlaceName(args.destinationName);
  if (wanted) {
    const byName = records.find(r => normalizePlaceName(r.destinationName) === wanted);
    if (byName) return byName;
  }
  if (args.threadTopic) {
    const byThread = records.find(r => r.threadTopic !== null && r.threadTopic === args.threadTopic);
    if (byThread) return byThread;
  }
  return null;
}

/**
 * A record's still-owed subjects against the CURRENT heard
 * ledger: a subject heard since that drive is discharged and
 * must never be presented as owed. Capped at two — the preview
 * carries a nod, not a debt ledger.
 */
export function stillOwedSubjects(record: RouteDriveRecord, heardNames: Set<string>): string[] {
  const heard = new Set([...heardNames].map(normalizePlaceName));
  return record.owedSubjects.filter(name => !heard.has(normalizePlaceName(name))).slice(0, 2);
}
