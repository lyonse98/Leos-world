// Bundle entry for the partner tooling scripts (scripts/partner/*.mjs).
// Bundled with esbuild (platform=node) by lib-partner.mjs, exactly the
// way scripts/fresh-verify/run.mjs bundles its engine entry — so the
// scripts run the SAME registry/drift code the app ships, never a copy.
export {
  PARTNERS,
  activePartners,
  partnerForUnit,
  partnerForPlaceName,
  partnerApprovedAngleFor,
  checkFrozenSets,
  unitPlaceKey,
  unitAngle,
} from '../../src/data/partners';
export type { Partner, PartnerStoryPin } from '../../src/data/partners';
export { estimateDurationSec } from '../../src/core/routeMode';
export { hashString } from '../../src/utils/hash';
