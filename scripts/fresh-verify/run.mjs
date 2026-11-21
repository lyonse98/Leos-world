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
    // The app build compiles JSX with the automatic runtime;
    // the bundle must match now that profileUi.tsx is part of
    // it (SG-8 renders the profile editor, Nov 17, 2026).
    '--jsx=automatic',
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
    validateHookText: engine.validateHookText,
  },
  routeInterItemGapMs: engine.routeInterItemGapMs,
  facts: {
    discoverCandidates: engine.discoverCandidates,
    searchNearbyWithKeyWalk: engine.searchNearbyWithKeyWalk,
    isTier1HouseException: engine.isTier1HouseException,
    applyHouseDemotion: engine.applyHouseDemotion,
    applyPartnerBoost: engine.applyPartnerBoost,
    applyProfileBoost: engine.applyProfileBoost,
    candidateTopics: engine.candidateTopics,
    houseImportanceFor: engine.houseImportanceFor,
    HOUSE_SCORE_PENALTY: engine.HOUSE_SCORE_PENALTY,
    HOUSE_SCORE_PENALTY_SOLID: engine.HOUSE_SCORE_PENALTY_SOLID,
    HOUSE_SCORE_PENALTY_DEAD: engine.HOUSE_SCORE_PENALTY_DEAD,
  },
  partners: engine.partners,
  profileRank: engine.profileRank,
  freshness: engine.freshness,
  currentEvents: engine.currentEvents,
  eventsFeed: engine.eventsFeed,
  EVENT_FEEDS: engine.EVENT_FEEDS,
  suggestions: engine.suggestions,
  proposals: engine.proposals,
  liveSpend: engine.liveSpend,
  composeRoutePlan: engine.composeRoutePlan,
  hashString: engine.hashString,
  CORRIDOR_SEGMENTS: engine.CORRIDOR_SEGMENTS,
  CORRIDOR_BUFFER_M: engine.CORRIDOR_BUFFER_M,
  matchCorridor: engine.matchCorridor,
  WELCOME_REACH_CEILING_M: engine.WELCOME_REACH_CEILING_M,
  resolveFillerRegion: engine.resolveFillerRegion,
  accessGate: {
    isTesterUnlocked: engine.isTesterUnlocked,
    tryTesterUnlock: engine.tryTesterUnlock,
    TESTER_ACCESS_CODE: engine.TESTER_ACCESS_CODE,
  },
  placeMemory: engine.placeMemory,
  duo: engine.duo,
  duoPersona: engine.duoPersona,
  audioFinish: engine.audioFinish,
  profile: engine.profile,
  profileUi: {
    ProfileEditor: engine.ProfileEditor,
    formFromProfile: engine.formFromProfile,
    saveDeclaredForm: engine.saveDeclaredForm,
  },
  ambience: {
    AmbientBedController: engine.AmbientBedController,
    resolveAmbientBed: engine.resolveAmbientBed,
    isUrbanAreaName: engine.isUrbanAreaName,
    FULL: engine.AMBIENT_FULL_LEVEL,
    DUCK: engine.AMBIENT_DUCK_LEVEL,
  },
};

const args = process.argv.slice(2);
const { summarize, FRESH_VERIFY_MIN_CHECKS } = await import('./harness.mjs');

if (!args.includes('--mc')) {
  const { runScenarios } = await import('./scenarios.mjs');
  await runScenarios(engine.Tour, extras);
}
if (!args.includes('--scenarios')) {
  const { runMonteCarlo } = await import('./montecarlo.mjs');
  await runMonteCarlo(engine.Tour, extras);
}

// The check-count floor applies to the full run only (see
// harness.mjs): a partial run executes a legitimately
// smaller denominator.
const fullRun = !args.includes('--scenarios') && !args.includes('--mc');
process.exit(summarize(fullRun ? FRESH_VERIFY_MIN_CHECKS : 0) ? 0 : 1);
