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
// Usage: node scripts/route-mode/build-route-presence.mjs
//   [presence-csv-path] [tags-csv-path] [out-path]
// Default paths: ../../presence-classes.csv and
// ../../story-tags.csv relative to the repo root (the
// workspace layout), out = src/data/routePresence.ts. Re-run
// by hand when the classes change (a re-audit, or new shelf
// rows the next audit classifies); rows absent from the CSV
// are simply not woven-eligible — the safe direction.
//
// WOVEN TWINS (Nov 4, 2026): the woven tranche's twins ride
// the shelf as sibling rows whose angle is the source angle
// + '-woven-v1' (see scripts/route-mode/woven-twins.md). A
// twin is a host-told woven-register retelling BY
// CONSTRUCTION — no presence anchoring — so it is weave-safe
// by definition and never Protected. The audit CSV predates
// the twins and is never edited (it is the audit's artifact);
// instead this generator DERIVES each twin's entry from
// story-tags.csv: any '-woven-v1' row whose key the audit CSV
// does not already carry gains { presence: 'safe',
// protected: false }, appended in tags-CSV order. An audit
// row for the twin's own key would win (the audit is the
// authority where it speaks). Two fail-closed guards:
//   - a twin whose SOURCE row is Protected aborts the build
//     — Protected register must never become woven material
//     by suffix arithmetic; a human adjudicates that twin in
//     the CSV by hand or the tranche does not ship it;
//   - a twin whose source row the audit never classified is
//     SKIPPED (with a warning): unclassified stays
//     ineligible, the safe direction, until the audit speaks.
// Because the derivation reads story-tags.csv, future twin
// ingests (the December completion render) land seatable by
// re-running the standard ingest + this generator — the
// Commit E pattern: this regen is a mandatory final step of
// ingest, and the twins ride it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const csvPath = process.argv[2] ?? join(repoRoot, '..', 'presence-classes.csv');
const tagsPath = process.argv[3] ?? join(repoRoot, '..', 'story-tags.csv');
const outPath = process.argv[4] ?? join(repoRoot, 'src', 'data', 'routePresence.ts');

/** The woven-twin angle suffix (the tranche's key convention). */
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

// Woven twins, derived from the tag index (see the header):
// weave-safe by construction, never Protected, appended in
// tags-CSV order after the audit's own rows — the audit rows
// above are emitted byte-identically, twins are additions
// only. A missing tags CSV (a bare repo checkout) simply
// derives nothing: twins stay unclassified, hence ineligible.
let twinCount = 0;
if (existsSync(tagsPath)) {
  const byKey = new Map(entries.map(e => [e.key, e]));
  for (const r of parseCsv(readFileSync(tagsPath, 'utf8'))) {
    const angle = r.angle ?? '';
    if (!angle.endsWith(WOVEN_TWIN_SUFFIX)) continue;
    const key = `${r.place_key}|${angle}`;
    if (byKey.has(key)) continue; // the audit speaks for this key itself
    const sourceKey = `${r.place_key}|${angle.slice(0, -WOVEN_TWIN_SUFFIX.length)}`;
    const source = byKey.get(sourceKey);
    if (!source) {
      console.warn(`route-presence: twin ${key} skipped — source ${sourceKey} is unclassified`);
      continue;
    }
    if (source.isProtected) {
      throw new Error(
        `route-presence: twin ${key} derives from Protected source ${sourceKey} — ` +
          'Protected register is never woven material; adjudicate this twin in presence-classes.csv by hand',
      );
    }
    const entry = { key, presence: 'safe', isProtected: false };
    entries.push(entry);
    byKey.set(key, entry);
    twinCount += 1;
  }
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
console.log(`route-presence: ${entries.length} rows (${twinCount} woven twins derived) → ${outPath}`);
