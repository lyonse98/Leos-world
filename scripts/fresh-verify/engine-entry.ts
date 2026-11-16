// Bundle entry for the fresh-shell verification harness.
// Bundled with esbuild (platform=node) by run.mjs; never shipped.
export { Tour } from '../../src/core/tour';
export { Player, makePrimeUrl } from '../../src/core/player';
export {
  discoverCandidates,
  applyHouseDemotion,
  HOUSE_SCORE_PENALTY,
  HOUSE_SCORE_PENALTY_SOLID,
  HOUSE_SCORE_PENALTY_DEAD,
} from '../../src/core/facts';
export { isTier1HouseException } from '../../src/data/tier1HouseExceptions';
export { houseImportanceFor } from '../../src/data/houseImportance';
export {
  daypartOf,
  eligibleIntroForms,
  fallbackIntroForm,
  validateHookText,
} from '../../src/core/introForms';
export { routeInterItemGapMs } from '../../src/core/routePlayback';
export { CORRIDOR_SEGMENTS, CORRIDOR_BUFFER_M, matchCorridor } from '../../src/data/corridors';
export { resolveFillerRegion } from '../../src/data/fillerRegions';
export { isTesterUnlocked, tryTesterUnlock, TESTER_ACCESS_CODE } from '../../src/core/accessGate';
export * as profile from '../../src/core/profile';
export {
  AmbientBedController,
  resolveAmbientBed,
  isUrbanAreaName,
  AMBIENT_FULL_LEVEL,
  AMBIENT_DUCK_LEVEL,
} from '../../src/core/ambience';
