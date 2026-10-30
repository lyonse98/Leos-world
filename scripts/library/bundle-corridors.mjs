// Bundles the modules the library builders need, the same way
// bundle-app.mjs does for the place corpus — with ONE deliberate
// difference: WHICH persona source it bundles, which Erik's
// persona rulings govern:
//   - The original 345-story library (Oct 26) bundled v13 — the
//     frozen library stays v13 forever (Erik: "leave existing
//     library as is").
//   - ALL NEW library content (Erik's ruling, Oct 27, 2026)
//     bundles the CURRENT app persona — leo-v14 — straight from
//     the working tree's leoPersona.ts, so the banked voice is
//     the live voice: v13's voice carried whole, plus the
//     mission line, and the builders' briefs add the v14
//     instruction layer (portal rule as source-grounded per
//     Ruling 2, position-binding, design-band lengths, the WOW
//     lead). One voice going forward, by Erik's explicit call.
// This bundler therefore points at the working tree. If the
// persona is ever re-banked again, this is the file to re-point.
//
//   node scripts/library/bundle-corridors.mjs
//
// Output: /tmp/leo-corridor-bundle.mjs (a build artifact).

import { build } from 'esbuild';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const personaPath = path.join(repoRoot, 'src/services/leoPersona.ts');
if (!existsSync(personaPath)) {
  console.error('[bundle-corridors] working-tree leoPersona.ts missing at', personaPath);
  process.exit(1);
}
const entryPath = '/tmp/leo-corridor-bundle-entry.ts';
const outPath = '/tmp/leo-corridor-bundle.mjs';

const entry = [
  `export { LEO_SYSTEM_INSTRUCTION, LEO_PERSONA_VERSION, LEO_MODEL_ID } from ${JSON.stringify(personaPath)};`,
  `export { normalizePlaceKey } from ${JSON.stringify(path.join(repoRoot, 'src/services/storyLibrary.ts'))};`,
  `export { wikipedia } from ${JSON.stringify(path.join(repoRoot, 'src/services/wikipedia.ts'))};`,
  `export { wikidata } from ${JSON.stringify(path.join(repoRoot, 'src/services/wikidata.ts'))};`,
  `export { osmService } from ${JSON.stringify(path.join(repoRoot, 'src/services/osmService.ts'))};`,
  `export { CORRIDOR_SEGMENTS, corridorTargetSentences, designSpeedMps } from ${JSON.stringify(path.join(repoRoot, 'src/data/corridors.ts'))};`,
].join('\n');

writeFileSync(entryPath, entry);

await build({
  entryPoints: [entryPath],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: outPath,
  define: {
    'import.meta.env': JSON.stringify({
      VITE_MILES_SUPABASE_URL: 'https://placeholder.supabase.co',
      VITE_MILES_SUPABASE_ANON_KEY: 'placeholder-anon-key',
    }),
  },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});

const app = await import(outPath);
const checks = {
  LEO_PERSONA_VERSION: app.LEO_PERSONA_VERSION,
  LEO_MODEL_ID: app.LEO_MODEL_ID,
  systemInstructionChars: app.LEO_SYSTEM_INSTRUCTION?.length,
  segments: app.CORRIDOR_SEGMENTS?.length,
  normalizePlaceKeySample: app.normalizePlaceKey?.('I-5 South: La Jolla to Mission Bay'),
};
console.log('[bundle-corridors] bundle written to', outPath);
console.log('[bundle-corridors] checks:', JSON.stringify(checks, null, 2));
if (app.LEO_PERSONA_VERSION !== 'leo-v14' || !app.CORRIDOR_SEGMENTS?.length) {
  console.error('[bundle-corridors] FAILED: expected the v14 persona (Erik\'s Oct 27 ruling: all new library content is v14) and the segment dataset');
  process.exit(1);
}
