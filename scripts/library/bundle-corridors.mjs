// Bundles the modules the corridor builder needs, the same way
// bundle-app.mjs does for the place corpus — with ONE deliberate
// difference: the persona comes from the leo-v13 source file
// (extracted from git commit f1b0022 to /tmp/leo-persona-v13.ts),
// because the banked library's voice is v13's. Pass 2 later edited
// leoPersona.ts for leo-v14 (unpublished); corridor stories are
// LIBRARY stories, and the library is v13 by Erik's doctrine — one
// voice across the whole bank. If the persona is ever re-banked,
// this is the file to re-point.
//
//   git show f1b0022:src/services/leoPersona.ts > /tmp/leo-persona-v13.ts
//   node scripts/library/bundle-corridors.mjs
//
// Output: /tmp/leo-corridor-bundle.mjs (a build artifact).

import { build } from 'esbuild';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const personaPath = '/tmp/leo-persona-v13.ts';
if (!existsSync(personaPath)) {
  console.error('[bundle-corridors] /tmp/leo-persona-v13.ts missing — extract it: git show f1b0022:src/services/leoPersona.ts > /tmp/leo-persona-v13.ts');
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
      VITE_SUPABASE_URL: 'https://placeholder.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'placeholder-anon-key',
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
if (app.LEO_PERSONA_VERSION !== 'leo-v13' || !app.CORRIDOR_SEGMENTS?.length) {
  console.error('[bundle-corridors] FAILED: expected the v13 persona and the segment dataset');
  process.exit(1);
}
