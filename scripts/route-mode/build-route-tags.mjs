// Generate src/data/routeTags.ts from the tagged shelf
// (~/workspace/leos-world/story-tags.csv, Nov 1 tone/topic
// tagging). The composer joins library-index rows to this
// bundled map at runtime — no DB change, no paste, no per-serve
// fetch: tags ride the app bundle.
//
// DETERMINISTIC: the output is a pure function of the CSV —
// rows in CSV order, values JSON-encoded, and the generated
// header carries only the row count (no timestamps). Same CSV
// in → byte-identical file out.
//
// Usage: node scripts/route-mode/build-route-tags.mjs [csv-path]
// Default csv path: ../../story-tags.csv relative to the repo root
// (the workspace layout). Since composer v3.1 (commit E) this
// runs automatically as the FINAL STEP of the shared library
// ingest path (repo-avatar/scripts/library — lib.mjs's
// regenRouteTags(), called by ingest.mjs and required of every
// ingest path); re-run by hand only for a tags-only change. The
// known remainder: stories the APP itself promotes at runtime
// (gap-fill) gain tags only when the next pipeline regen runs.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const csvPath = process.argv[2] ?? join(repoRoot, '..', 'story-tags.csv');
const outPath = join(repoRoot, 'src', 'data', 'routeTags.ts');

function parseCsv(text) {
  // Proper CSV parse: quoted fields may contain commas (e.g.
  // "set here, shot elsewhere") and doubled quotes. Topics use
  // ';' as their own separator, so they survive intact.
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
const entries = [];
for (const r of rows) {
  const topics = (r.topics ?? '')
    .split(';')
    .map(t => t.trim())
    .filter(Boolean);
  entries.push({
    key: `${r.place_key}|${r.angle}`,
    topics,
    tone: r.tone || null,
    toneSecondary: r.tone_secondary || null,
  });
}

const body = entries
  .map(
    e =>
      `  ${JSON.stringify(e.key)}: { topics: ${JSON.stringify(e.topics)}, tone: ${JSON.stringify(e.tone)}, toneSecondary: ${JSON.stringify(e.toneSecondary)} },`,
  )
  .join('\n');

const out = `// GENERATED — do not hand-edit. Built by
// scripts/route-mode/build-route-tags.mjs from story-tags.csv
// (${entries.length} rows, Nov 1 tone/topic tagging). The route
// composer joins library-index rows to this map at runtime, so no
// DB change is needed for route mode to see tone/topic tags.

export interface RouteTagEntry {
  topics: string[];
  tone: string | null;
  toneSecondary: string | null;
}

/** place_key + '|' + angle → tag entry. */
export const ROUTE_TAGS: Record<string, RouteTagEntry> = {
${body}
};

export function tagsFor(placeKey: string, angle: string): RouteTagEntry {
  return ROUTE_TAGS[\`\${placeKey}|\${angle}\`] ?? { topics: [], tone: null, toneSecondary: null };
}
`;

writeFileSync(outPath, out);
console.log(`route-tags: ${entries.length} rows → ${outPath}`);
