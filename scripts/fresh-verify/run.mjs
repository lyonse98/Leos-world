// Fresh-shell verification runner: bundles the engine core with
// esbuild, then runs the scenario suite and the Monte Carlo cells.
// Usage: node scripts/fresh-verify/run.mjs [--scenarios|--mc]

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const out = join(mkdtempSync(join(tmpdir(), 'fresh-engine-')), 'engine.mjs');

execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(here, 'engine-entry.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${out}`,
    '--log-level=warning',
    // The engine reads Vite's import.meta.env; give the harness a fake set.
    '--define:import.meta.env={"VITE_MILES_SUPABASE_URL":"https://fake.test","VITE_MILES_SUPABASE_ANON_KEY":"fake-anon","VITE_GEMINI_API_KEY":"fake-gemini","VITE_GOOGLE_MAPS_API_KEY":"fake-maps","VITE_GOOGLE_PLACES_API_KEY":"fake-places"}',
    // CJS deps (Supabase) use dynamic require inside the ESM bundle.
    "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  ],
  { stdio: 'inherit' },
);

const engine = await import(pathToFileURL(out).href);
const extras = {
  Player: engine.Player,
  intro: {
    daypartOf: engine.daypartOf,
    eligibleIntroForms: engine.eligibleIntroForms,
    fallbackIntroForm: engine.fallbackIntroForm,
    composeCallbackText: engine.composeCallbackText,
    callbackAssetFresh: engine.callbackAssetFresh,
    validateHookText: engine.validateHookText,
  },
  routeInterItemGapMs: engine.routeInterItemGapMs,
  CORRIDOR_SEGMENTS: engine.CORRIDOR_SEGMENTS,
  CORRIDOR_BUFFER_M: engine.CORRIDOR_BUFFER_M,
  matchCorridor: engine.matchCorridor,
  resolveFillerRegion: engine.resolveFillerRegion,
  accessGate: {
    isTesterUnlocked: engine.isTesterUnlocked,
    tryTesterUnlock: engine.tryTesterUnlock,
    TESTER_ACCESS_CODE: engine.TESTER_ACCESS_CODE,
  },
  profile: engine.profile,
  ambience: {
    AmbientBedController: engine.AmbientBedController,
    resolveAmbientBed: engine.resolveAmbientBed,
    isUrbanAreaName: engine.isUrbanAreaName,
    FULL: engine.AMBIENT_FULL_LEVEL,
    DUCK: engine.AMBIENT_DUCK_LEVEL,
  },
};

const args = process.argv.slice(2);
const { summarize } = await import('./harness.mjs');

if (!args.includes('--mc')) {
  const { runScenarios } = await import('./scenarios.mjs');
  await runScenarios(engine.Tour, extras);
}
if (!args.includes('--scenarios')) {
  const { runMonteCarlo } = await import('./montecarlo.mjs');
  await runMonteCarlo(engine.Tour, extras);
}

process.exit(summarize() ? 0 : 1);
