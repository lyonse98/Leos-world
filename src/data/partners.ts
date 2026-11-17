// Partner registry (v16.2 Slice 1, Nov 16, 2026).
//
// The data model behind the partner pilot offer (Erik's shape,
// Nov 16, 2026): a partner institution gets (1) its stories
// PRE-APPROVED — the exact tellings about its property frozen
// for its sign-off before anything plays; (2) those tellings
// treated as top-tier near its site (the partner-class boost in
// facts.ts discovery and in the route composer's rank chain);
// (3) later, its own in-facility library and a sponsorship
// surface — neither is modeled here yet.
//
// A partner entry is: an identity, the site it owns (library
// place_keys + the site's pin), a serve radius, and the
// APPROVED STORY SET as explicit story pins. A story is
// identified the way the whole shelf identifies one — the unit
// id `place_key|angle` (shortCuts.ts, routeTags.ts) — and a pin
// also freezes the row's audio_path at approval time, plus a
// hash of its text when the freeze records one. The pin is the
// frozen set: checkFrozenSets() below compares pins against
// live rows and flags any drift, so a library batch can never
// silently change what a partner approved (the swap workflow
// re-renders under a FRESH audio key, so an approved telling
// that gets edited moves its audio_path — the movement is the
// detectable signal).
//
// STATUS is the honesty switch:
//   'dormant' — a prospect or a shape example. Dormant entries
//     have ZERO effect anywhere: no boost, no serve preference,
//     nothing a listener can hear. The registry ships dormant.
//   'active'  — a signed pilot. Only an Erik ruling flips an
//     entry active, in the same edit that freezes its approved
//     set from live rows (scripts/partner/export-transcripts.mjs
//     produces the approval document the set is frozen from).
//
// This module stays backend-free like the other data modules
// (tier1HouseExceptions.ts is the precedent): the place-key
// normalization is mirrored here rather than imported, so
// facts.ts and route tooling never drag the Supabase client
// into their graph through it.

import { hashString } from '../utils/hash';

export interface PartnerStoryPin {
  /** place_key + '|' + angle — the shelf's story identity. */
  unitId: string;
  /** The live row's audio_path at freeze time. */
  audioPath: string;
  /** hashString(story_text) at freeze time, when recorded. */
  textHash?: string;
}

export interface Partner {
  id: string;
  /** Display name — the institution, not the building. */
  name: string;
  status: 'dormant' | 'active';
  site: {
    /** Library place_keys the partner's property carries (writer's dialect). */
    placeKeys: readonly string[];
    lat: number;
    lng: number;
  };
  /** The boost's reach: the partner class applies only within this of the site. */
  serveRadiusM: number;
  /** The frozen, partner-approved story set. Empty until signing. */
  approvedStories: readonly PartnerStoryPin[];
}

export const PARTNERS: readonly Partner[] = [
  {
    // DORMANT EXAMPLE — a prospect, NOT a partner. The Gaslamp
    // Museum (Gaslamp Quarter Historical Foundation) is the
    // shortlist's first call (partner-shortlist-2026-11-16.md);
    // nothing is signed, nothing is approved, and this entry
    // exists so the machinery ships exercised in shape and
    // inert in fact. The site pin is the registry dataset's own
    // Davis-Horton House record (402 Island Ave). The approved
    // set is populated only at signing, from live rows.
    id: 'gaslamp-museum',
    name: 'Gaslamp Museum at the Davis-Horton House',
    status: 'dormant',
    site: {
      placeKeys: ['davis-horton house'],
      lat: 32.7106,
      lng: -117.160751,
    },
    serveRadiusM: 500,
    approvedStories: [],
  },
];

/** backend.normalizePlaceKey, mirrored (see the note above). */
function partnerPlaceKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, ' ');
}

/** The place_key half of a unit id (angles never contain '|'). */
export function unitPlaceKey(unitId: string): string {
  const i = unitId.lastIndexOf('|');
  return i >= 0 ? unitId.slice(0, i) : unitId;
}

/** The angle half of a unit id. */
export function unitAngle(unitId: string): string {
  const i = unitId.lastIndexOf('|');
  return i >= 0 ? unitId.slice(i + 1) : '';
}

/** Partners whose boost and freeze are live. Dormant entries never appear here. */
export function activePartners(list: readonly Partner[] = PARTNERS): Partner[] {
  return list.filter(p => p.status === 'active');
}

/** The partner whose approved set contains this story, if any (any status). */
export function partnerForUnit(unitId: string, list: readonly Partner[] = PARTNERS): Partner | null {
  return list.find(p => p.approvedStories.some(pin => pin.unitId === unitId)) ?? null;
}

/**
 * The partner who owns the named place, if any (any status).
 * Judged on the normalized key, so a Places display name, a
 * registry record name, or a shelf place_key all match — the
 * same two-dialect tolerance the Tier-1 exception list uses.
 */
export function partnerForPlaceName(name: string, list: readonly Partner[] = PARTNERS): Partner | null {
  const key = partnerPlaceKey(name);
  return list.find(p => p.site.placeKeys.some(k => partnerPlaceKey(k) === key)) ?? null;
}

/**
 * The angle a serve should prefer for this place: the approved
 * telling's angle, when an ACTIVE partner owns the place and
 * its frozen set covers it. Null in every other case — which,
 * while the registry is dormant, is every case.
 */
export function partnerApprovedAngleFor(placeKey: string, list: readonly Partner[] = PARTNERS): string | null {
  const key = partnerPlaceKey(placeKey);
  for (const p of activePartners(list)) {
    if (!p.site.placeKeys.some(k => partnerPlaceKey(k) === key)) continue;
    const pin = p.approvedStories.find(pin => partnerPlaceKey(unitPlaceKey(pin.unitId)) === key);
    if (pin) return unitAngle(pin.unitId);
  }
  return null;
}

// ------------------------------------------------------------ frozen sets

/** The live-row shape the drift check reads (a Map keyed by unit id). */
export interface LiveRowLite {
  audioPath: string | null;
  storyText?: string | null;
}

export type FrozenDriftKind = 'missing' | 'audio-moved' | 'text-changed';

export interface FrozenDrift {
  partnerId: string;
  unitId: string;
  kind: FrozenDriftKind;
  /** What the pin froze. */
  expected: string;
  /** What the live row carries now (null = the row is gone). */
  actual: string | null;
}

/**
 * Compare every partner's frozen set against live rows and
 * report drift. Pure: the caller supplies the rows (the verify
 * suites supply fixtures; scripts/partner/check-frozen.mjs
 * supplies the live shelf). A pin drifts when its row is gone,
 * when the row's audio_path moved off the frozen path (the
 * swap workflow's signature), or — when the pin recorded a
 * text hash — when the text under the same audio changed.
 * Dormant partners are checked too: an empty set cannot drift,
 * and a populated dormant set is a freeze-in-waiting whose
 * drift is worth seeing before signing, not after.
 */
export function checkFrozenSets(
  list: readonly Partner[],
  liveRows: ReadonlyMap<string, LiveRowLite>,
): FrozenDrift[] {
  const drift: FrozenDrift[] = [];
  for (const p of list) {
    for (const pin of p.approvedStories) {
      const row = liveRows.get(pin.unitId);
      if (!row) {
        drift.push({ partnerId: p.id, unitId: pin.unitId, kind: 'missing', expected: pin.audioPath, actual: null });
        continue;
      }
      if (row.audioPath !== pin.audioPath) {
        drift.push({ partnerId: p.id, unitId: pin.unitId, kind: 'audio-moved', expected: pin.audioPath, actual: row.audioPath });
        continue;
      }
      if (pin.textHash !== undefined && row.storyText != null && hashString(row.storyText) !== pin.textHash) {
        drift.push({ partnerId: p.id, unitId: pin.unitId, kind: 'text-changed', expected: pin.textHash, actual: hashString(row.storyText) });
      }
    }
  }
  return drift;
}
