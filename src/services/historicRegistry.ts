// San Diego historic-registry enrichment and candidates (Oct 25, 2026).
//
// Two official registers, merged into one static dataset
// (src/data/sd-historic-registry.json; provenance in
// ~/workspace/leos-world/registry/BUILD-REPORT.md):
//   - National Register of Historic Places (NPS extract + NPS points layer)
//   - San Diego Register of Historic Resources (City CHRID roster + City GIS)
//
// The dataset does two jobs, mirroring how wikidata.ts enriches the fact
// pack:
//
//   LEVEL 1 — FACTS. When Leo's lead subject is a designated place, its
//   register status, designation year and significance join the prompt as
//   hard fact, under the same verification discipline as Wikidata: the
//   record must NAME-MATCH the subject and (when it carries coordinates)
//   sit within ~300 m. Records with no trustworthy coordinate contribute
//   facts on an EXACT name match only — no guessing where they are.
//
//   LEVEL 2 — CANDIDATES. Designated places with verified coordinates
//   become story candidates in their own right ('historic_registry'
//   tier), so a designated house Google Places doesn't list is no longer
//   invisible to Leo. Guardrails (Erik's, hard requirements):
//     - 'approximate' and 'missing' coordinate records are NEVER
//       selection candidates (facts only).
//     - The registry score is bounded by construction (<= 85) and the
//       total ranked score is hard-capped in relevance.ts; registry
//       candidates are also excluded from isTier1Landmark, so a registry
//       place can win its neighborhood but can NEVER outrank or queue-
//       jump a Tier-1 landmark.
//     - Session lockout, angle coverage and the heard set apply to
//       registry candidates exactly as to Google candidates — they join
//       the same NearbyPlace[] pool and flow through the same filters.
//     - District contributors (ordinary designated houses) are eligible
//       at the base local score — no extra weight.
//
// Everything here is local and synchronous: no network, no latency, and
// every failure path degrades to '' / [] so a story never waits on, or
// dies because of, the registry.

import registryData from '../data/sd-historic-registry.json';
import { calculateDistance } from '../utils/geo';
import { placesService, NearbyPlace } from './placesService';
import type { Position } from '../hooks/useGeolocation';

export interface HistoricRegistryRecord {
  name: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  registers: Array<'national' | 'local'>;
  designatedYear: number | null;
  significance: string | null;
  architect: string | null;
  coordQuality: 'verified' | 'approximate' | 'missing';
}

export interface NearbyRegistryRecord {
  record: HistoricRegistryRecord;
  distanceM: number;
}

const RECORDS = registryData as unknown as HistoricRegistryRecord[];

// A registry fact attaches to a subject only when the record is genuinely
// at the listener's location (the subject is, by pipeline construction,
// right here). 300 m is deliberately tighter than Wikidata's 1.5 km: the
// dataset is dense (1,518 records in one county), so a loose radius would
// attach the wrong house's plaque to a story.
const FACTS_MATCH_RADIUS_M = 300;

// Bounded story-worthiness for registry candidates, on the same scale as
// placesService.calculateHistoricalScore (museum/church types ~130-175,
// park ~95, school ~25). A designated place is solidly story-worthy but
// structurally below landmark tier; the hard cap in relevance.ts is the
// second layer of the same guarantee.
export const REGISTRY_SCORE_NATIONAL = 85;
export const REGISTRY_SCORE_LOCAL = 65;

// Normalized comparison form: lowercase, punctuation stripped, leading
// "the" dropped, whitespace collapsed. Used for subject matching, dedupe
// against Google candidates, and the exact-match rule for coord-less
// records.
export function normalizeRegistryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

// True when two place names plausibly refer to the same place: equal after
// normalization, or one contains the other (with a length floor so short
// generic names can't swallow longer ones). Mirrors the label discipline
// in wikidata.ts.
export function registryNamesMatch(a: string, b: string): boolean {
  const na = normalizeRegistryName(a);
  const nb = normalizeRegistryName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  return shorter.length >= 8 && longer.includes(shorter);
}

function registerDisplayNames(record: HistoricRegistryRecord): string[] {
  return record.registers.map(r =>
    r === 'national'
      ? 'National Register of Historic Places'
      : 'San Diego Register of Historic Resources'
  );
}

function formatFacts(record: HistoricRegistryRecord): string {
  const parts: string[] = [];
  parts.push(`listed on the ${registerDisplayNames(record).join(' and ')}`);
  if (record.designatedYear) parts.push(`designated ${record.designatedYear}`);
  if (record.significance) parts.push(`significance: ${record.significance}`);
  if (record.address) parts.push(`address: ${record.address}`);
  return `HISTORIC REGISTRY FACTS for ${record.name}: ${parts.join('; ')}.`;
}

function registryHistoricalScore(record: HistoricRegistryRecord): number {
  return record.registers.includes('national')
    ? REGISTRY_SCORE_NATIONAL
    : REGISTRY_SCORE_LOCAL;
}

export const historicRegistry = {
  /**
   * Every record with coordinates within radiusM of a point, nearest
   * first. Facts-grade query: all coordinate qualities are returned —
   * candidate eligibility is selectionCandidates' stricter job.
   */
  recordsNear(lat: number, lng: number, radiusM: number): NearbyRegistryRecord[] {
    const out: NearbyRegistryRecord[] = [];
    for (const record of RECORDS) {
      if (record.lat === null || record.lng === null) continue;
      const distanceM = calculateDistance(lat, lng, record.lat, record.lng);
      if (distanceM <= radiusM) out.push({ record, distanceM });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM);
  },

  /**
   * Prompt-ready registry facts block for a subject, or '' when nothing
   * verifiable matches. A record with coordinates must name-match the
   * subject AND sit within ~300 m of the given position; a record with
   * no coordinates (coordQuality 'missing') matches on exact normalized
   * name only. Never throws.
   */
  factsForSubject(name: string, lat: number, lng: number): string {
    try {
      const target = normalizeRegistryName(name);
      if (!target) return '';

      let best: NearbyRegistryRecord | null = null;
      for (const record of RECORDS) {
        const recordName = normalizeRegistryName(record.name);
        if (record.lat !== null && record.lng !== null) {
          if (!registryNamesMatch(record.name, name)) continue;
          const distanceM = calculateDistance(lat, lng, record.lat, record.lng);
          if (distanceM > FACTS_MATCH_RADIUS_M) continue;
          if (!best || distanceM < best.distanceM) best = { record, distanceM };
        } else if (recordName === target) {
          // No trustworthy coordinates: facts ride on the exact name
          // alone, and never displace a coordinate-verified match.
          if (!best) best = { record, distanceM: Number.POSITIVE_INFINITY };
        }
      }
      return best ? formatFacts(best.record) : '';
    } catch {
      return '';
    }
  },

  /**
   * The selection-eligible candidate pool near a point: ONLY records
   * with verified coordinates. 'approximate' and 'missing' records are
   * facts-only and are never returned here.
   */
  selectionCandidates(lat: number, lng: number, radiusM: number): NearbyRegistryRecord[] {
    return historicRegistry
      .recordsNear(lat, lng, radiusM)
      .filter(
        ({ record }) =>
          record.coordQuality === 'verified' && record.lat !== null && record.lng !== null
      );
  },

  /**
   * Selection candidates as NearbyPlace entries for the shared candidate
   * pool, with distance/direction computed exactly as Google candidates
   * are. Score is the bounded registry score; source marks the tier so
   * ranking caps and the Tier-1 exclusion can apply.
   */
  candidatesAsPlaces(position: Position, radiusM = 500): NearbyPlace[] {
    return historicRegistry
      .selectionCandidates(position.lat, position.lng, radiusM)
      .map(({ record }) =>
        placesService.buildNearbyPlace(position, {
          name: record.name,
          lat: record.lat as number,
          lng: record.lng as number,
          types: ['historic_registry'],
          vicinity: record.address ?? '',
          historicalScore: registryHistoricalScore(record),
          source: 'historic_registry',
        })
      );
  },

  namesMatch: registryNamesMatch,
};
