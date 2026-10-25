// Bundles the app's own modules for build-time use by the library builder.
//
// The persona, the pronunciation lexicon, the library key normalization,
// the angle vocabulary and the free fact sources are NEVER copied by
// hand: this script bundles the production TypeScript modules with
// esbuild and the builder imports the real code from the bundle. If the
// app changes the persona or the lexicon, re-running this script is the
// only step needed for the builder to pick it up.
//
// Output: /tmp/leo-app-bundle.mjs (a build artifact — regenerate freely).
// The app's supabase client is constructed at module top level from
// import.meta.env; dummy values are defined in so the bundle loads in
// Node. Nothing in the builder calls that client.

import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const entryPath = '/tmp/leo-bundle-entry.ts';
const outPath = '/tmp/leo-app-bundle.mjs';

const entry = [
  `export { LEO_SYSTEM_INSTRUCTION, LEO_PERSONA_VERSION, LEO_MODEL_ID } from ${JSON.stringify(path.join(repoRoot, 'src/services/leoPersona.ts'))};`,
  `export { applyPronunciation } from ${JSON.stringify(path.join(repoRoot, 'src/services/pronunciation.ts'))};`,
  `export { normalizePlaceKey } from ${JSON.stringify(path.join(repoRoot, 'src/services/storyLibrary.ts'))};`,
  `export { LANDMARK_ANGLES, describeAngle } from ${JSON.stringify(path.join(repoRoot, 'src/services/storyCoverage.ts'))};`,
  `export { wikipedia } from ${JSON.stringify(path.join(repoRoot, 'src/services/wikipedia.ts'))};`,
  `export { wikidata } from ${JSON.stringify(path.join(repoRoot, 'src/services/wikidata.ts'))};`,
  `export { osmService } from ${JSON.stringify(path.join(repoRoot, 'src/services/osmService.ts'))};`,
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
  // The Supabase packages are CJS and dynamically require node builtins;
  // give the ESM bundle a real `require` so they load under Node.
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
  landmarkAngles: app.LANDMARK_ANGLES?.length,
  normalizePlaceKeySample: app.normalizePlaceKey?.('  U.S. Grant  Hotel '),
  pronunciationSample: app.applyPronunciation?.('La Jolla'),
  describeAngleSample: app.describeAngle?.(app.LANDMARK_ANGLES?.[0]),
};
console.log('[bundle-app] bundle written to', outPath);
console.log('[bundle-app] checks:', JSON.stringify(checks, null, 2));
if (!app.LEO_SYSTEM_INSTRUCTION || !app.applyPronunciation || !app.normalizePlaceKey) {
  console.error('[bundle-app] FAILED: required exports missing');
  process.exit(1);
}
