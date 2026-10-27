// Dry-assembly verification for the corridor fact upgrade
// (corridor-facts.mjs), Oct 27, 2026.
//
//   node scripts/library/bundle-corridors.mjs   # once: bundle modules
//   node scripts/library/verify-corridor-facts.mjs
//
// NO text generation, NO TTS, NO ingestion, NO Gemini calls of any
// kind (loadKeys is never called). Free sources only: Wikipedia,
// OSM, Wikidata, the historic registry.
//
// For the 10 segments that banked with ZERO fact sources in v1
// (corridor-corpus-v1 manifest, fact_sources = []) and for 6
// healthy segments (one per freeway, Wikipedia-bearing in v1), it
// runs:
//   LEGACY   — the pre-upgrade builder behavior, verbatim:
//              lib.mjs assembleFacts once per area anchor, union.
//   UPGRADED — corridor-facts.mjs assembleCorridorFacts.
// Both run back-to-back in one process, so they share the geo
// services' own caches exactly as the real builder's single run
// would; differences come from the new stages, not from rerunning
// on a different day. Results print as a table and are written to
// /tmp/corridor-fact-verify.json for the report.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, assembleFacts } from './lib.mjs';
import { assembleCorridorFacts, loadLibrarySubjects } from './corridor-facts.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const wsRoot = path.join(homedir(), 'workspace/leos-world');

if (!existsSync('/tmp/leo-corridor-bundle.mjs')) {
  console.error('[verify] /tmp/leo-corridor-bundle.mjs missing — run bundle-corridors.mjs first');
  process.exit(1);
}
const app = await import('/tmp/leo-corridor-bundle.mjs');
const records = loadRegistry(repoRoot);
const librarySubjects = loadLibrarySubjects(path.join(wsRoot, 'library-corpus-v13/manifest.json'));
const v1 = JSON.parse(readFileSync(path.join(wsRoot, 'corridor-corpus-v1/manifest.json'), 'utf8'));
const v1Sources = new Map(v1.map(e => [e.segment_id, e.fact_sources || []]));

// The 10: v1 fact_sources empty (build report Item 6, quality flag 1).
const TEN = [
  'i-5-sb-pacific-beach-mission-bay',
  'i-5-nb-pacific-beach-la-jolla',
  'sr-52-eb-la-jolla-clairemont',
  'sr-52-wb-clairemont-la-jolla',
  'i-8-eb-allied-gardens-san-carlos',
  'i-8-wb-san-carlos-allied-gardens',
  'i-15-nb-escondido-north-escondido',
  'i-15-sb-north-escondido-escondido',
  'i-15-sb-escondido-rancho-bernardo',
  'i-15-sb-marine-corps-air-station-miramar-tierrasanta',
];

// 6 healthy spot-checks: one per freeway, Wikipedia-bearing in v1
// (prefer also registry-bearing), never one of the TEN.
const healthy = [];
for (const fw of ['I-5', 'SR-163', 'SR-52', 'I-805', 'I-8', 'SR-94']) {
  const cands = app.CORRIDOR_SEGMENTS.filter(
    s => s.freeway === fw && !TEN.includes(s.id) && (v1Sources.get(s.id) || []).includes('wikipedia')
  );
  const pick =
    cands.find(s => (v1Sources.get(s.id) || []).includes('historic_registry')) || cands[0];
  if (pick) healthy.push(pick.id);
}
console.log(`[verify] healthy spot-checks: ${healthy.join(', ')}`);

const byId = new Map(app.CORRIDOR_SEGMENTS.map(s => [s.id, s]));
const quiet = () => {};

function wikiTitlesOf(contexts) {
  const out = new Set();
  for (const c of contexts) {
    for (const m of (c || '').matchAll(/^- (.+?) \(\d+m away\):/gm)) out.add(m[1]);
    for (const m of (c || '').matchAll(/^Wikipedia — (.+?):$/gm)) out.add(m[1]);
  }
  return out;
}
function registryNamesOf(contexts) {
  const out = new Set();
  for (const c of contexts) {
    for (const m of (c || '').matchAll(/HISTORIC REGISTRY FACTS for (.+?): /g)) out.add(m[1]);
  }
  return out;
}
function osmCountOf(contexts) {
  let n = 0;
  for (const c of contexts) {
    for (const line of (c || '').split('\n')) if (line.startsWith('- ')) n++;
  }
  return n;
}

async function legacyAssemble(segment) {
  const sources = new Set();
  const perArea = {};
  const wikiCtx = [];
  const regCtx = [];
  const osmCtx = [];
  for (const area of segment.areas) {
    const facts = await assembleFacts(app, records, { name: area.name }, { lat: area.lat, lng: area.lng });
    facts.sources.forEach(s => sources.add(s));
    perArea[area.name] = facts.sources;
    wikiCtx.push(facts.wikiContext);
    regCtx.push(facts.registryContext);
    osmCtx.push(facts.osmContext);
  }
  return {
    sources: [...sources].sort(),
    perArea,
    wikiTitles: [...wikiTitlesOf(wikiCtx)].sort(),
    registryNames: [...registryNamesOf(regCtx)].sort(),
    osmFeatures: osmCountOf(osmCtx),
  };
}

const results = [];
for (const id of [...TEN, ...healthy]) {
  const segment = byId.get(id);
  if (!segment) {
    console.error(`[verify] segment not found: ${id}`);
    process.exitCode = 2;
    continue;
  }
  console.log(`\n[verify] ${id} — legacy…`);
  const legacy = await legacyAssemble(segment);
  console.log(`[verify] ${id} — upgraded…`);
  const { areaFacts, sources, detail } = await assembleCorridorFacts(app, records, segment, librarySubjects, quiet);
  const wikiCtx = areaFacts.map(x => x.facts.wikiContext);
  const regCtx = areaFacts.map(x => x.facts.registryContext);
  const osmCtx = areaFacts.map(x => x.facts.osmContext);
  const upgraded = {
    sources: [...sources].sort(),
    wikiTitles: [...wikiTitlesOf(wikiCtx)].sort(),
    registryNames: [...registryNamesOf(regCtx)].sort(),
    osmFeatures: osmCountOf(osmCtx),
    detail,
    thinGate: !sources.has('wikipedia') && !sources.has('historic_registry'),
  };
  const row = {
    segment_id: id,
    displayName: segment.displayName,
    kind: TEN.includes(id) ? 'zero-in-v1' : 'healthy-spot-check',
    v1RecordedSources: v1Sources.get(id) || [],
    legacy,
    upgraded,
  };
  results.push(row);
  console.log(
    `[verify] ${id}: v1=${row.v1RecordedSources.join('+') || 'NONE'} legacy=${legacy.sources.join('+') || 'NONE'} upgraded=${upgraded.sources.join('+') || 'NONE'} wikiTitles=${upgraded.wikiTitles.length} registry=${upgraded.registryNames.length} osm=${upgraded.osmFeatures}${upgraded.thinGate ? ' STILL-THIN' : ''}`
  );
}

writeFileSync('/tmp/corridor-fact-verify.json', JSON.stringify(results, null, 2));
console.log(`\n[verify] wrote /tmp/corridor-fact-verify.json (${results.length} segments)`);
const stillThin = results.filter(r => r.kind === 'zero-in-v1' && r.upgraded.thinGate);
console.log(`[verify] zero-in-v1 segments still thin under the harmonized gate: ${stillThin.length}/10`);
const regressed = results.filter(
  r => r.kind === 'healthy-spot-check' && !r.legacy.sources.every(s => r.upgraded.sources.includes(s))
);
console.log(`[verify] healthy spot-checks whose upgraded sources do NOT cover legacy: ${regressed.length}/6`);
