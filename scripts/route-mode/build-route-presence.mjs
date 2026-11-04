// Generate src/data/routePresence.ts from the presence
// audit's per-story classes (~/workspace/leos-world/
// presence-classes.csv — the Nov 4, 2026 presence audit:
// every shelf story classified presence-bound / mixed /
// weave-safe, with the Protected register flagged; see
// scripts/route-mode/presence/ for the classification
// pipeline that produced the CSV and its provenance). The
// App joins library rows to this bundled map at runtime —
// no DB change, no paste, no per-serve fetch: presence
// rides the app bundle exactly like the route tags.
//
// DETERMINISTIC: the output is a pure function of the CSV —
// rows in CSV order, values JSON-encoded, and the generated
// header carries only the row count (no timestamps). Same
// CSV in → byte-identical file out.
//
// Usage: node scripts/route-mode/build-route-presence.mjs [csv-path]
// Default csv path: ../../presence-classes.csv relative to
// the repo root (the workspace layout). Re-run by hand when
// the classes change (a re-audit, or new shelf rows the next
// audit classifies); rows absent from the CSV are simply
// not woven-eligible — the safe direction.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const csvPath = process.argv[2] ?? join(repoRoot, '..', 'presence-classes.csv');
const outPath = join(repoRoot, 'src', 'data', 'routePresence.ts');

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

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const entries = [];
for (const r of rows) {
  const cls = (r.presence_class ?? '').trim();
  if (cls !== 'bound' && cls !== 'mixed' && cls !== 'safe') {
    throw new Error(`presence-classes: bad class "${cls}" for ${r.place_key}|${r.angle}`);
  }
  entries.push({
    key: `${r.place_key}|${r.angle}`,
    presence: cls,
    isProtected: (r.protected ?? '').trim() === '1',
  });
}

const body = entries
  .map(
    e =>
      `  ${JSON.stringify(e.key)}: { presence: ${JSON.stringify(e.presence)}, protected: ${e.isProtected} },`,
  )
  .join('\n');

const out = `// GENERATED — do not hand-edit. Built by
// scripts/route-mode/build-route-presence.mjs from
// presence-classes.csv (${entries.length} rows, the Nov 4, 2026
// presence audit). The route build joins library rows to this
// map at runtime, so no DB change is needed for route mode to
// know a story's presence register.

/**
 * A story's presence register (presence audit, Nov 4, 2026):
 * 'bound' = sustained co-location — played off its ground it
 * would sound false; 'mixed' = isolated presence touches in a
 * place-independent body; 'safe' = no presence assumptions.
 */
export type PresenceClass = 'bound' | 'mixed' | 'safe';

export interface RoutePresenceEntry {
  presence: PresenceClass;
  /** The Protected register (Nov 3 audits): never woven material, whatever its class. */
  protected: boolean;
}

/** place_key + '|' + angle → presence entry. */
export const ROUTE_PRESENCE: Record<string, RoutePresenceEntry> = {
${body}
};

export function presenceFor(placeKey: string, angle: string): RoutePresenceEntry | null {
  return ROUTE_PRESENCE[\`\${placeKey}|\${angle}\`] ?? null;
}

/**
 * Woven eligibility (Nov 4, 2026): a story may be heard OFF
 * its ground — as a through-line member seated in a route's
 * silent gaps, and as thread support — when its register is
 * weave-safe or mixed AND it is not Protected register. An
 * unclassified row is never eligible: the safe direction.
 */
export function wovenEligibleFor(placeKey: string, angle: string): boolean {
  const e = presenceFor(placeKey, angle);
  return e !== null && !e.protected && e.presence !== 'bound';
}
`;

writeFileSync(outPath, out);
console.log(`route-presence: ${entries.length} rows → ${outPath}`);
