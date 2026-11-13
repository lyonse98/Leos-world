// Generate src/data/shortCuts.ts from the short-cuts
// program's manifest + production ledger (~/workspace/
// leos-world/short-cuts-2026-11-12/: manifest.csv carries
// the 469 base→twin pairs the program ingested Nov 12, 2026;
// ledger.csv carries each twin's MEASURED audio duration).
//
// A short cut is the same story at a second length: a NEW
// story_library row, same place_key as its base, angle =
// base angle + ' (short cut)'. Erik's version logic (Nov 12,
// 2026 — "density sets the cut"): seating order is unchanged;
// the composer/freeform assign the VERSION per seat by local
// density. The app joins rows to this bundled map at runtime
// exactly like the tags/presence/memorial maps — the pair map
// says which rows are versions of one story (heard
// unification keys on it), and the duration map carries the
// MEASURED seconds, because window math must price the audio
// that actually exists, never the 55–90 s design target
// (43 shipped twins measure over 90 s, max 100.7 s; one
// measures 37.0 s).
//
// DETERMINISTIC: the output is a pure function of the two
// CSVs — rows in manifest order, keys JSON-encoded, the
// generated header carries only counts (no timestamps).
// Same CSVs in → byte-identical file out.
//
// Usage: node scripts/route-mode/build-short-cuts.mjs
//   [manifest-csv] [ledger-csv] [tags-csv] [out-path]
// Defaults: ../../short-cuts-2026-11-12/manifest.csv,
// ../../short-cuts-2026-11-12/ledger.csv,
// ../../story-tags.csv (all relative to the repo root — the
// workspace layout), out = src/data/shortCuts.ts.
//
// FAIL-CLOSED GUARDS (in the spirit of build-route-
// memorial.mjs): a drifted suffix, a cross-place pair, a
// duplicate, a woven-twin base (short cuts of woven twins
// are NOT a supported class — the producing program minted
// none, and the guard keeps it that way), a pair missing
// from the tag map, or a twin with no measured duration in
// the ledger aborts the build. A silent drift in any of
// these would otherwise sit in the bundle forever, quietly
// breaking the version machinery it exists to feed.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const manifestPath = process.argv[2] ?? join(repoRoot, '..', 'short-cuts-2026-11-12', 'manifest.csv');
const ledgerPath = process.argv[3] ?? join(repoRoot, '..', 'short-cuts-2026-11-12', 'ledger.csv');
const tagsPath = process.argv[4] ?? join(repoRoot, '..', 'story-tags.csv');
const outPath = process.argv[5] ?? join(repoRoot, 'src', 'data', 'shortCuts.ts');

const SHORT_CUT_SUFFIX = ' (short cut)';
const WOVEN_TWIN_SUFFIX = '-woven-v1';

function parseCsv(text) {
  // Proper CSV parse: quoted fields may contain commas and
  // doubled quotes (mirrors build-route-tags.mjs).
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some(v => v.trim().length > 0)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows[0];
  return rows.slice(1).map(parts => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = parts[i] ?? '';
    });
    return obj;
  });
}

function abort(msg) {
  console.error(`build-short-cuts: ABORT — ${msg}`);
  process.exit(1);
}

// Measured durations from the ledger: keyed place|twin-angle.
// Production re-runs append rows; a completed ('ok') row's
// measurement is authoritative, a 'skip-done' row only
// witnesses one. Last ok wins; skip-done fills gaps.
const durations = new Map();
for (const r of parseCsv(readFileSync(ledgerPath, 'utf8'))) {
  const sec = Number.parseFloat(r.actual_seconds ?? '');
  if (!Number.isFinite(sec) || sec <= 0) continue;
  const key = `${r.place_key}|${r.twin_angle}`;
  if (r.status === 'ok' || !durations.has(key)) durations.set(key, Math.round(sec * 10) / 10);
}

// The tag map is the wiring's ground truth for "this row is
// a real, tagged shelf row" (the memorial generator's guard).
const tagKeys = new Set(parseCsv(readFileSync(tagsPath, 'utf8')).map(r => `${r.place_key}|${r.angle}`));

const pairs = [];
const seenBase = new Set();
const seenTwin = new Set();
for (const r of parseCsv(readFileSync(manifestPath, 'utf8'))) {
  const baseId = `${r.base_place_key}|${r.base_angle}`;
  const twinId = `${r.twin_place_key}|${r.twin_angle}`;
  if (r.twin_place_key !== r.base_place_key) abort(`pair crosses places: ${baseId} → ${twinId}`);
  if (r.twin_angle !== r.base_angle + SHORT_CUT_SUFFIX) abort(`twin angle is not base + '${SHORT_CUT_SUFFIX}': ${twinId}`);
  if (r.base_angle.endsWith(SHORT_CUT_SUFFIX)) abort(`base is itself a short cut: ${baseId}`);
  if (r.base_angle.endsWith(WOVEN_TWIN_SUFFIX)) {
    abort(`short cut of a woven twin is not a supported class: ${baseId}`);
  }
  if (seenBase.has(baseId)) abort(`duplicate base: ${baseId}`);
  if (seenTwin.has(twinId)) abort(`duplicate twin: ${twinId}`);
  seenBase.add(baseId);
  seenTwin.add(twinId);
  if (!tagKeys.has(baseId)) abort(`base missing from story-tags.csv: ${baseId}`);
  if (!tagKeys.has(twinId)) abort(`twin missing from story-tags.csv: ${twinId}`);
  const sec = durations.get(twinId);
  if (sec === undefined) abort(`no measured duration in the ledger for twin: ${twinId}`);
  pairs.push({ baseId, twinId, sec });
}

const twinOf = pairs.map(p => `  ${JSON.stringify(p.baseId)}: ${JSON.stringify(p.twinId)},`).join('\n');
const baseOf = pairs.map(p => `  ${JSON.stringify(p.twinId)}: ${JSON.stringify(p.baseId)},`).join('\n');
const durOf = pairs.map(p => `  ${JSON.stringify(p.twinId)}: ${p.sec},`).join('\n');

const out = `// GENERATED — do not hand-edit. Built by
// scripts/route-mode/build-short-cuts.mjs from the short-cuts
// program's manifest + production ledger
// (short-cuts-2026-11-12/: ${pairs.length} pairs, Nov 12, 2026).
//
// Short cuts (Nov 12, 2026, Erik's ruling): the same story at
// a second length — a library row whose angle is the base
// angle + ' (short cut)'. Seating order never reads this map
// (no length bias in who gets picked); the composer and
// freeform read it to assign the VERSION per seat by local
// density ("density sets the cut"), and heard unification
// keys on it: hearing either version marks the story heard.

/** Base unit id (place_key|angle) → its short cut's unit id. */
export const SHORT_CUT_TWIN_OF: Record<string, string> = {
${twinOf}
};

/** Short-cut unit id → its base unit id. */
export const SHORT_CUT_BASE_OF: Record<string, string> = {
${baseOf}
};

/**
 * Short-cut unit id → MEASURED audio duration, seconds (the
 * production ledger's probe of the rendered file). Window
 * and pace math price these numbers, never the program's
 * 55–90 s design target: the shipped twins measure
 * 37.0–100.7 s.
 */
export const SHORT_CUT_DURATION_SEC: Record<string, number> = {
${durOf}
};

export function shortCutTwinIdFor(placeKey: string, angle: string): string | null {
  return SHORT_CUT_TWIN_OF[\`\${placeKey}|\${angle}\`] ?? null;
}

export function shortCutBaseIdFor(placeKey: string, angle: string): string | null {
  return SHORT_CUT_BASE_OF[\`\${placeKey}|\${angle}\`] ?? null;
}

export function isShortCutId(id: string): boolean {
  return id in SHORT_CUT_BASE_OF;
}

/** Measured duration (seconds) of a short cut, or null when the id is not one. */
export function shortCutDurationSecFor(placeKey: string, angle: string): number | null {
  return SHORT_CUT_DURATION_SEC[\`\${placeKey}|\${angle}\`] ?? null;
}

/**
 * Heard unification (Nov 12, 2026): expand a set of heard
 * unit ids with each heard story's other version, in both
 * directions — a short cut and its base are ONE story to the
 * ledger, so hearing either excludes both from future
 * seating. Operates on the bundled pair map (not the fetched
 * units), so it also covers a counterpart that fell outside
 * a build's fetch window.
 */
export function expandShortCutHeard(keys: ReadonlySet<string>): Set<string> {
  const out = new Set(keys);
  for (const id of keys) {
    const twin = SHORT_CUT_TWIN_OF[id];
    if (twin) out.add(twin);
    const base = SHORT_CUT_BASE_OF[id];
    if (base) out.add(base);
  }
  return out;
}
`;

writeFileSync(outPath, out);
console.log(`short-cuts: ${pairs.length} pairs → ${outPath}`);
