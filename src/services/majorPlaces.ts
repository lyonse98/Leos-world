// Curated major places (Area F, Oct 26, 2026).
//
// A hand-verified micro-list of majors that the generic sources
// structurally miss or under-rank — the class the major-coverage audit
// (~/workspace/leos-world/major-coverage-audit.md §2B) confirmed:
// nationally-designated places that exist in the registry only under
// a building's or vessel's registry name, at the registry's bounded
// rank, under a subject name no listener would choose ("California
// Quadrangle" for the Museum of Us and the California Tower).
//
// Every entry's coordinates are copied from a VERIFIED registry record
// (cited per entry) — no pin here was invented or geocoded for this
// list, and places whose only local coordinate is approximate-grade
// (Torrey Pines Gliderport, Scripps Institution) are deliberately NOT
// here: they are seed-wired for the library (seeds #138/#139) pending
// the owner's pin confirmation, because wiring an unverified pin into
// live selection is how the audit's §2D wrong-continent defects
// happened. The same discipline keeps the audit's no-local-pin majors
// (the naval bases, Seaport Village, the Balboa institutions without
// registry pins) OUT of this list: they are seed-wired query-only
// (seeds #116–130) and join live telling when the library build pins
// them under owner review.
//
// How an entry works (see the merge in gemini.gatherFactPack): within
// radius of the discovery center it joins the candidate pool under the
// name people actually use. If a Google or registry candidate proves
// to be the same ground (name match or ≤150 m), the entry folds into
// that candidate instead — alias-linked, and for tier1 entries the
// twin is marked a major subject, which is what lifts the place out
// of the registry's capped rank into major treatment (daily-cap
// exemption, serve priority, significance length). Standing alone, the
// entry is itself the candidate, scored like a strong Google place.

import { placesService, NearbyPlace } from './placesService';
import { calculateDistance } from '../utils/geo';
import type { Position } from '../hooks/useGeolocation';

export interface MajorPlaceEntry {
  name: string;
  lat: number;
  lng: number;
  types: string[];
  historicalScore: number;
  // Tier-1-class: on a twin fold (or standalone serve) the subject is
  // marked major — cap-exempt, priority lane, long length band.
  tier1: boolean;
  // Provenance of the pin, for the next auditor.
  source: string;
}

export const MAJOR_PLACES: MajorPlaceEntry[] = [
  {
    name: 'Museum of Us',
    lat: 32.731769,
    lng: -117.152257,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 165,
    tier1: true,
    source: 'registry — California Quadrangle (national, verified)',
  },
  {
    name: 'San Diego Air & Space Museum',
    lat: 32.726122,
    lng: -117.154539,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 160,
    tier1: true,
    source: 'registry — Ford Building (national+local, verified), 2001 Pan American Pl',
  },
  {
    name: 'Pilot Boat',
    lat: 32.7209,
    lng: -117.17348,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 130,
    tier1: false,
    source: 'registry — PILOT (Pilot Boat) (national, verified)',
  },
  {
    name: 'Cabrillo Ferry',
    lat: 32.71546,
    lng: -117.17306,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 130,
    tier1: false,
    source: 'registry — CABRILLO (Ferry) (national, verified), Broadway Pier',
  },
  {
    name: 'PCF 816 Swift Boat',
    lat: 32.722778,
    lng: -117.178333,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 120,
    tier1: false,
    source: 'registry — PCF 816 (patrol craft fast) (national, verified)',
  },
  {
    name: 'Junipero Serra Museum',
    lat: 32.759609,
    lng: -117.193429,
    types: ['museum', 'tourist_attraction'],
    historicalScore: 135,
    tier1: false,
    source: 'registry — Junipero Serra Museum (local, verified), 2727 Presidio Dr',
  },
  {
    name: 'The Lodge at Torrey Pines',
    lat: 32.92081,
    lng: -117.251775,
    types: ['lodging', 'tourist_attraction'],
    historicalScore: 140,
    tier1: false,
    source: 'registry — Torrey Pines Lodge (national, verified), 12201 Torrey Pines Park Rd',
  },
];

export interface MajorCandidate {
  place: NearbyPlace;
  tier1: boolean;
}

export const majorPlaces = {
  /** Curated entries within radiusM of the position, as candidates. */
  candidatesAsPlaces(position: Position, radiusM = 1500): MajorCandidate[] {
    const out: MajorCandidate[] = [];
    for (const entry of MAJOR_PLACES) {
      const d = calculateDistance(position.lat, position.lng, entry.lat, entry.lng);
      if (d > radiusM) continue;
      out.push({
        place: placesService.buildNearbyPlace(position, {
          name: entry.name,
          lat: entry.lat,
          lng: entry.lng,
          types: entry.types,
          vicinity: '',
          historicalScore: entry.historicalScore,
          source: 'google_places',
        }),
        tier1: entry.tier1,
      });
    }
    return out;
  },
};
