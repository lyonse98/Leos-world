// Houses are PORTAL-OR-NOTHING (Erik's ruling, Nov 14, 2026 —
// Day 10 of the habit test, after the Nov 14 afternoon freeform
// session served Alice Lee Residence (library) and A.H. Sweet
// Residences (live) back-to-back at positions 7–8 of 10, with
// two more houses queued behind them):
//
//   "the home stories i have heard so far are just not
//    compelling at all unless they are a portal into better
//    stories like we talked about days and weeks ago"
//
// The rule, binding every lane (freeform library serves,
// freeform live-generation subject picking, route composition):
// a registry-house story (the houseClass classifier's class)
// may take a serve slot ONLY when it functions as a portal
// into a stronger story — the story it portals into must be
// (a) not itself a house, (b) unheard, (c) in serve range, and
// (d) queued to play IMMEDIATELY AFTER the house as the
// payload. If the follow-on cannot play, the house does not
// play either. No standalone house serves. F1's demotion
// (houseClass) stays as the ordering backstop beneath this
// gate; never-back-to-back is now structural (a house's only
// legal successor is a non-house).
//
// Portal linkage — what ties a house to its stronger story,
// chosen by what the shelf's data actually supports, in
// Erik's preference order:
//
//   1. SUBJECT link: the house's place name embeds the person
//      it opens onto — the owner and, after a '/', the
//      architect ("Alice Lee/ Irving J Gill/ Hazel Wood
//      Waterman House", "George W Marston House") — and a
//      non-house story carries that same person as its
//      subject ("Irving Gill" landmark_people, "George
//      Marston" landmark_people). Mechanical form: a person
//      segment of the house's name (≥2 significant tokens,
//      initials and residence words dropped) is a token subset
//      of the target's name tokens, or vice versa. A
//      surname-ONLY match was measured and REJECTED: on the
//      real shelf it is dominated by false portals (Ada Black
//      House → Black Mountain, Highland House → Highland Ave
//      segments, Sharp House → Sharp Memorial Hospital) — a
//      bogus link would let a house serve on a pretext, which
//      is worse than no link.
//   2. NEIGHBORHOOD link: a non-house story on the house's own
//      ground — within PORTAL_NEIGHBORHOOD_RADIUS_M of the
//      house's anchor. The shelf carries no neighborhood field
//      for story rows; proximity is the honest proxy, and the
//      portal's payload is then the landmark/place story the
//      house's street actually opens onto.
//
// Coverage, measured with THIS algorithm on the live shelf
// (4,067 rows / 2,521 places, Nov 14, 2026): 597 house
// places. 24 carry a subject link under the bidirectional
// subset rule — the genuine person links (Marston, Gill,
// Waterman, Munk, Rice, Ryan, the Wahrenberger and Delawie
// houses) plus a few place-name subsets (a house named for
// its neighborhood linking to the neighborhood's own story)
// and corridor-segment rows the classifier's villa prong
// catches, which never serve as freeform candidates anyway.
// 585 (98%) have a non-house story within 1,000 m; 589 (99%)
// have at least one reachable portal target of either kind.
// Desert risk: only 5 house places have no non-house story
// within the 1,600 m driving serve radius at all (12 within
// 1,000 m; 37 within the 700 m walking radius; 9 are the
// only story place within 700 m) — a house is almost never
// the only candidate on its ground, so the gate costs a
// story-shaped silence, filled by the ordinary lanes,
// almost nowhere.

import { isHouseStory } from './houseClass';
import { calculateDistance } from '../utils/geo';

/** The minimal shape a story reference needs for portal judgment. */
export interface PortalStoryRef {
  placeKey: string;
  placeName: string;
  angle: string;
  topics: readonly string[];
  lat: number;
  lng: number;
}

/** Same-neighborhood reach for a portal payload, in meters. */
export const PORTAL_NEIGHBORHOOD_RADIUS_M = 1000;

const PORTAL_STOPWORDS = new Set([
  'the',
  'and',
  'of',
  'spec',
  'home',
  'historic',
  'district',
  'contributor',
  'house',
  'houses',
  'cottage',
  'cottages',
  'residence',
  'residences',
  'mansion',
  'mansions',
  'bungalow',
  'bungalows',
  'villa',
  'villas',
]);

/** Name tokens for linkage: punctuation and initials dropped (initials carry no identity). */
export function portalNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[/&.,'’()#-]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

/**
 * The person segments a house's name embeds: slash-separated
 * name parts (owner / architect / architect in the shelf's
 * registry-house dialect), each reduced to its significant
 * tokens (residence words and stopwords dropped). Segments
 * with fewer than two tokens name nobody mechanically
 * reachable and are dropped.
 */
export function portalPersonSegments(placeName: string): string[][] {
  const out: string[][] = [];
  for (const part of placeName.split('/')) {
    const toks = portalNameTokens(part).filter(t => !PORTAL_STOPWORDS.has(t));
    if (toks.length >= 2) out.push(toks);
  }
  return out;
}

/**
 * The subject link: a person segment of the house's name is a
 * token subset of the target's name tokens, or the target's
 * tokens are a subset of the segment (the same person, with
 * or without a middle initial — "George Marston" the person
 * story against "George W Marston House"). Surname-only
 * matches do NOT qualify (measured false-portal rate, see
 * the header).
 */
export function houseSubjectLink(houseName: string, targetName: string): boolean {
  const targetTokens = new Set(portalNameTokens(targetName));
  if (targetTokens.size < 2) return false;
  for (const seg of portalPersonSegments(houseName)) {
    const segSet = new Set(seg);
    const segInTarget = seg.every(t => targetTokens.has(t));
    const targetInSeg = [...targetTokens].every(t => segSet.has(t));
    if (segInTarget || targetInSeg) return true;
  }
  return false;
}

export type PortalLinkKind = 'subject' | 'neighborhood';

/** The link between a house and a candidate payload, or null when the candidate is no portal target. */
export function portalLinkKind(
  house: PortalStoryRef,
  target: PortalStoryRef,
  distanceM: number,
): PortalLinkKind | null {
  if (target.placeKey === house.placeKey) return null;
  if (isHouseStory(target)) return null;
  if (houseSubjectLink(house.placeName, target.placeName)) return 'subject';
  if (distanceM <= PORTAL_NEIGHBORHOOD_RADIUS_M) return 'neighborhood';
  return null;
}

/** True when `target` may serve as `house`'s portal payload (distance computed from the anchors). */
export function isPortalTarget(house: PortalStoryRef, target: PortalStoryRef): boolean {
  return (
    portalLinkKind(house, target, calculateDistance(house.lat, house.lng, target.lat, target.lng)) !==
    null
  );
}

/**
 * The strongest portal target for a house in a candidate pool:
 * subject links outrank neighborhood links (Erik's preference
 * order); within a kind, landmark-class angles first, then
 * nearest ground. The pool is the caller's to filter (unheard,
 * in serve range, story angles only) — this ranks what it is
 * given and returns null when nothing in it links.
 */
export function findPortalTarget<T extends PortalStoryRef>(
  house: PortalStoryRef,
  pool: readonly T[],
): { target: T; kind: PortalLinkKind } | null {
  let best: { target: T; kind: PortalLinkKind; dist: number } | null = null;
  for (const cand of pool) {
    const dist = calculateDistance(house.lat, house.lng, cand.lat, cand.lng);
    const kind = portalLinkKind(house, cand, dist);
    if (!kind) continue;
    if (!best) {
      best = { target: cand, kind, dist };
      continue;
    }
    if (kind !== best.kind) {
      if (kind === 'subject') best = { target: cand, kind, dist };
      continue;
    }
    const candLm = cand.angle.startsWith('landmark') ? 0 : 1;
    const bestLm = best.target.angle.startsWith('landmark') ? 0 : 1;
    if (candLm !== bestLm) {
      if (candLm < bestLm) best = { target: cand, kind, dist };
      continue;
    }
    if (dist < best.dist) best = { target: cand, kind, dist };
  }
  return best ? { target: best.target, kind: best.kind } : null;
}
