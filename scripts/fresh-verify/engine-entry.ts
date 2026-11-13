// Bundle entry for the fresh-shell verification harness.
// Bundled with esbuild (platform=node) by run.mjs; never shipped.
export { Tour } from '../../src/core/tour';
export { Player, makePrimeUrl } from '../../src/core/player';
export {
  daypartOf,
  eligibleIntroForms,
  fallbackIntroForm,
  composeCallbackText,
  callbackAssetFresh,
  validateHookText,
} from '../../src/core/introForms';
export { routeInterItemGapMs } from '../../src/core/routePlayback';
export { CORRIDOR_SEGMENTS, CORRIDOR_BUFFER_M, matchCorridor } from '../../src/data/corridors';
export { resolveFillerRegion } from '../../src/data/fillerRegions';
export { isTesterUnlocked, tryTesterUnlock, TESTER_ACCESS_CODE } from '../../src/core/accessGate';
export {
  AmbientBedController,
  resolveAmbientBed,
  isUrbanAreaName,
  AMBIENT_FULL_LEVEL,
  AMBIENT_DUCK_LEVEL,
} from '../../src/core/ambience';
