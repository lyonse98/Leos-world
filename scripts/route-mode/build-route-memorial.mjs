// Generate src/data/routeMemorial.ts from the memorial
// audit's per-story classifications (~/workspace/leos-world/
// memorial-classes.csv — the Nov 7, 2026 memorial audit:
// every Protected-register row and every somber-primary row
// of the shelf, read against its live telling and classified
// memorial / not-memorial; see the audit's basis column for
// the per-row evidence). The App joins library rows to this
// bundled map at runtime — no DB change, no paste, no
// per-serve fetch: the memorial class rides the app bundle
// exactly like the presence register and the route tags.
//
// WHY AN AUDITED SET, NOT A RULE (Erik's ruling, Nov 7,
// 2026): the humor layer's episode-wide kill originally read
// "Protected register OR somber primary tone" mechanically.
// That reading made Mount Soledad — Protected on every
// angle, a fixture of Erik's NBSD commute — silence every
// episode it touched, though only one of its angles is a
// memorial telling. The kill now belongs to the audited set
// alone: tellings whose SUBJECT is a real death event or a
// memorial itself (PSA Flight 182's class). Per-slot
// adjacency suppression keeps the wider mechanical class
// (colorSuppressedFor) — only the episode-wide kill narrows.
//
// DETERMINISTIC: the output is a pure function of the CSV —
// rows in CSV order, keys JSON-encoded, and the generated
// header carries only counts (no timestamps). Same CSV in →
// byte-identical file out.
//
// Usage: node scripts/route-mode/build-route-memorial.mjs
//   [memorial-csv-path] [tags-csv-path] [out-path]
// Default paths: ../../memorial-classes.csv and
// ../../story-tags.csv relative to the repo root (the
// workspace layout), out = src/data/routeMemorial.ts.
// Re-run by hand when the audit changes (a re-audit, or new
// shelf rows a future audit classifies); rows absent from
// the CSV are simply not memorial — the safe direction for
// an opt-in humor layer's kill switch is NOT silencing an
// episode over an unclassified telling.
//
// WOVEN TWINS: no twin derivation. Twins of Protected
// sources abort the tranche by convention, and none of this
// audit's non-Protected memorial sources (the Hickman
// corridors, Cabrillo, the Serra Museum telling) carries a
// '-woven-v1' twin as of the audit. A future twin of a
// memorial source lands unclassified — not memorial — until
// a re-audit speaks; the tranche ingest's regen step is
// where that re-audit belongs.
//
// FAIL-CLOSED GUARD: a memorial row whose key appears in
// NEITHER the tag index nor the presence classes aborts the
// build — a typo'd key would otherwise sit in the bundle
// forever, silently never firing the kill it exists to fire.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const csvPath = process.argv[2] ?? join(repoRoot, '..', 'memorial-classes.csv');
const tagsPath = process.argv[3] ?? join(repoRoot, '..', 'story-tags.csv');
const presencePath = join(repoRoot, '..', 'presence-classes.csv');
const outPath = process.argv[4] ?? join(repoRoot, 'src', 'data', 'routeMemorial.ts');

function parseCsv(text) {
  // Proper CSV parse: quoted fields may contain commas and
  // doubled quotes (mirrors build-route-presence.mjs).
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

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const seen = new Set();
const memorialKeys = [];
let audited = 0;
for (const r of rows) {
  const key = `${r.place_key}|${r.angle}`;
  if (seen.has(key)) throw new Error(`memorial-classes: duplicate row for ${key}`);
  seen.add(key);
  const flag = (r.memorial ?? '').trim();
  if (flag !== '0' && flag !== '1') {
    throw new Error(`memorial-classes: bad memorial flag "${flag}" for ${key}`);
  }
  audited += 1;
  if (flag === '1') memorialKeys.push(key);
}

// Fail-closed key check (see the header): every memorial
// key must be a real shelf row in one of the two indexes
// the audit drew its candidate set from.
const known = new Set();
for (const p of [tagsPath, presencePath]) {
  if (!existsSync(p)) continue;
  for (const r of parseCsv(readFileSync(p, 'utf8'))) known.add(`${r.place_key}|${r.angle}`);
}
if (known.size > 0) {
  for (const key of memorialKeys) {
    if (!known.has(key)) {
      throw new Error(`memorial-classes: ${key} is classified memorial but appears in neither the tag index nor the presence classes — a typo'd key would never fire`);
    }
  }
}

const body = memorialKeys
  .map(k => `  ${JSON.stringify(k)}: true,`)
  .join('\n');

const out = `// GENERATED — do not hand-edit. Built by
// scripts/route-mode/build-route-memorial.mjs from
// memorial-classes.csv (${audited} audited rows, the
// Nov 7, 2026 memorial audit: every Protected-register
// and somber-primary row of the shelf, classified against
// its live telling). The route build joins library rows
// to this map at runtime, so no DB change is needed for
// route mode to know a story's memorial class.

/**
 * The audited memorial set (Erik's ruling, Nov 7, 2026):
 * the tellings whose SUBJECT is a real death event or a
 * memorial itself — PSA Flight 182's class. Only these
 * trip the humor layer's EPISODE-WIDE kill. The wider
 * mechanical neighborhood (Protected register, somber or
 * spooky tones, the scandal angle) still suppresses humor
 * in its own slots via colorSuppressedFor; it no longer
 * silences a whole episode. A row absent from this map is
 * not memorial — the safe direction.
 */

/** place_key + '|' + angle → true (memorial rows only). */
export const ROUTE_MEMORIAL: Record<string, true> = {
${body}
};

export function memorialFor(placeKey: string, angle: string): boolean {
  return ROUTE_MEMORIAL[\`\${placeKey}|\${angle}\`] === true;
}
`;

writeFileSync(outPath, out);
console.log(`routeMemorial: ${audited} audited rows, ${memorialKeys.length} memorial → ${outPath}`);
