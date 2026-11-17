// Discovery and fact packs for the fresh shell.
//
// Candidates come from Google Places (New), the historic registry
// dataset, and the curated major-places table. A live story's fact
// pack (spec S7) assembles identity + coordinates + Places data +
// Wikipedia / Wikidata / registry facts + local context; specific
// claims in a generated story must trace to this pack.

import registryData from '../data/sd-historic-registry.json';
import { MAJOR_PLACES } from '../content/majorPlaces';
import { isTier1HouseException } from '../data/tier1HouseExceptions';
import { activePartners, partnerForPlaceName, type Partner } from '../data/partners';
import { houseImportanceFor } from '../data/houseImportance';
import { isHousePlaceName } from './houseClass';
import { findNamedArea } from '../services/namedAreas';
import { calculateDistance } from '../utils/geo';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface RegistryRecord {
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  registers: string[];
  designatedYear: number | null;
  significance: string | null;
  architect: string | null;
  coordQuality: string;
}

const REGISTRY = registryData as RegistryRecord[];

export interface Candidate {
  name: string;
  lat: number;
  lng: number;
  source: 'places' | 'registry' | 'major';
  types: string[];
  rating: number | null;
  userRatings: number | null;
  address: string | null;
  tier1: boolean;
  /**
   * Partner class (v16.2): the id of the ACTIVE partner whose
   * site this candidate is, when the driver is inside that
   * partner's serve radius — set by applyPartnerBoost, the
   * partner road to Tier-1. Null everywhere else, and null
   * everywhere while the partner registry is dormant.
   */
  partnerId: string | null;
  /** Selection score (higher = serve sooner). */
  score: number;
  registry: RegistryRecord | null;
  distanceM: number;
}

const placesKey = (): string =>
  (import.meta.env.VITE_GOOGLE_PLACES_API_KEY as string | undefined) ??
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ??
  '';

const STORY_TYPES = [
  'tourist_attraction',
  'museum',
  'park',
  'church',
  'zoo',
  'aquarium',
  'stadium',
  'library',
  'university',
  'cemetery',
  'art_gallery',
  'performing_arts_theater',
  'marina',
  'lighthouse',
];

interface PlacesResult {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  formattedAddress?: string;
}

async function searchNearby(center: GeoPoint, radiusM: number): Promise<Candidate[]> {
  const key = placesKey();
  if (!key) return [];
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'places.displayName,places.location,places.rating,places.userRatingCount,places.types,places.formattedAddress',
      },
      body: JSON.stringify({
        includedTypes: STORY_TYPES,
        maxResultCount: 20,
        rankPreference: 'POPULARITY',
        locationRestriction: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius: radiusM,
          },
        },
      }),
    });
    if (!res.ok) return [];
    const parsed = (await res.json()) as { places?: PlacesResult[] };
    const out: Candidate[] = [];
    for (const p of parsed.places ?? []) {
      const name = p.displayName?.text;
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      if (!name || lat === undefined || lng === undefined) continue;
      out.push({
        name,
        lat,
        lng,
        source: 'places',
        types: p.types ?? [],
        rating: p.rating ?? null,
        userRatings: p.userRatingCount ?? null,
        address: p.formattedAddress ?? null,
        tier1: false,
        partnerId: null,
        score: 0,
        registry: null,
        distanceM: calculateDistance(center.lat, center.lng, lat, lng),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Registry records near a point. Selection-eligible = verified coords only; the rest are facts-only. */
export function registryNear(center: GeoPoint, radiusM: number): RegistryRecord[] {
  return REGISTRY.filter(r => calculateDistance(center.lat, center.lng, r.lat, r.lng) <= radiusM);
}

function isNational(rec: RegistryRecord): boolean {
  return rec.registers.includes('national');
}

/**
 * Does this registry record confer Tier-1 on the candidate it
 * folds onto? A national listing does — UNLESS the candidate is
 * a house (Erik's ruling, Nov 15, 2026): a registered residence
 * is a residence however it is listed, and the Nov 14 field
 * evidence was National-Register houses riding the Tier-1
 * pending lane and displacement protection like landmark
 * stories. The score boost is untouched (a national house still
 * out-scores a local one); only the tier privilege goes.
 *
 * For a house, the curated exception list is the ONLY road to
 * Tier-1, whatever its register: the Nov 15 tour-importance
 * audits judged houses on story, people and portal value, not
 * on register class — and nine of the 24 exceptions are
 * local-register houses the audits promoted (the Whaley House
 * among them: a National Historic Landmark in reality, carried
 * as local-only by this dataset). The exception is judged on
 * either name the candidate carries (the Places display name or
 * the registry's own), the same two-dialect rule the portal
 * gate judges a place by.
 */
function registryConfersTier1(candidateName: string, rec: RegistryRecord): boolean {
  const house = isHousePlaceName(candidateName) || isHousePlaceName(rec.name);
  if (house) return isTier1HouseException(candidateName) || isTier1HouseException(rec.name);
  return isNational(rec);
}

const REGISTRY_BOOST_CAP = 25;

/**
 * Merge Places + registry + major candidates around a center, fold
 * duplicates (same ground within 150 m or same name), and score.
 * Registry significance boost is capped for local-only records and
 * uncapped for national/both (the registry doctrine).
 */
export async function discoverCandidates(center: GeoPoint, radiusM: number): Promise<Candidate[]> {
  const places = await searchNearby(center, radiusM);
  const byGround = new Map<string, Candidate>();
  const groundKey = (c: Candidate) => c.name.toLowerCase().trim();

  for (const p of places) byGround.set(groundKey(p), p);

  for (const rec of registryNear(center, radiusM)) {
    if (rec.coordQuality !== 'verified') continue; // facts-only, never selection-eligible
    const dist = calculateDistance(center.lat, center.lng, rec.lat, rec.lng);
    const national = isNational(rec);
    const boost = national ? 45 : REGISTRY_BOOST_CAP;
    const existingKey = [...byGround.keys()].find(k => {
      const c = byGround.get(k) as Candidate;
      return k === rec.name.toLowerCase().trim() || calculateDistance(c.lat, c.lng, rec.lat, rec.lng) <= 150;
    });
    if (existingKey) {
      const c = byGround.get(existingKey) as Candidate;
      c.registry = rec;
      c.score += boost;
      if (registryConfersTier1(c.name, rec)) c.tier1 = true;
    } else {
      byGround.set(rec.name.toLowerCase().trim(), {
        name: rec.name,
        lat: rec.lat,
        lng: rec.lng,
        source: 'registry',
        types: ['historic_site'],
        rating: null,
        userRatings: null,
        address: rec.address,
        tier1: registryConfersTier1(rec.name, rec),
        partnerId: null,
        score: 20 + boost,
        registry: rec,
        distanceM: dist,
      });
    }
  }

  for (const major of MAJOR_PLACES) {
    const dist = calculateDistance(center.lat, center.lng, major.lat, major.lng);
    if (dist > Math.max(radiusM, 1500)) continue;
    const existingKey = [...byGround.keys()].find(k => {
      const c = byGround.get(k) as Candidate;
      return k === major.name.toLowerCase().trim() || calculateDistance(c.lat, c.lng, major.lat, major.lng) <= 150;
    });
    if (existingKey) {
      const c = byGround.get(existingKey) as Candidate;
      c.name = major.name; // the name people actually use wins
      c.score += major.historicalScore / 4;
      if (major.tier1) c.tier1 = true;
    } else {
      byGround.set(major.name.toLowerCase().trim(), {
        name: major.name,
        lat: major.lat,
        lng: major.lng,
        source: 'major',
        types: major.types,
        rating: null,
        userRatings: null,
        address: null,
        tier1: major.tier1,
        partnerId: null,
        score: 30 + major.historicalScore / 4,
        registry: null,
        distanceM: dist,
      });
    }
  }

  const out = [...byGround.values()];
  for (const c of out) {
    const popularity = c.rating !== null ? (c.rating - 3.5) * 20 + Math.min(20, Math.log10((c.userRatings ?? 0) + 1) * 8) : 0;
    c.score += popularity - c.distanceM / 90;
  }
  applyHouseDemotion(out);
  applyPartnerBoost(out);
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * House demotion in freeform discovery (field fix F1, Nov 12,
 * 2026 — the same Erik ruling the route composer applies):
 * a residence-subject candidate (a registry spec house, a
 * named cottage/mansion/residence) loses points — enough to
 * sink it below the landmarks, majors and ordinary places it
 * competes with in the serve cycle's ordering, registry boost
 * included. Ordering only, as a backstop: the serve cycle's
 * portal-or-nothing gate (Nov 14, 2026) decides whether a house
 * may serve at all. Nothing here ever removes a candidate —
 * the serve cycle falls through the ordered list, so a sunk
 * house still serves when it is the only licensed story in
 * range.
 *
 * Since Nov 15, 2026 the penalty is graduated by the
 * tour-importance audits (houseImportance.ts), because the
 * flat F1 penalty could not tell houses apart: in a dense pool
 * every house took the same −50, so dead-weight houses ordered
 * among themselves by distance alone and surfaced exactly as
 * often as solid ones (the Day-10 Alice Lee Residence serve —
 * audit DEAD WEIGHT, style prose, anonymous owner). Now:
 *   SOLID audited houses       −30 (closer to ordinary places)
 *   unaudited houses           −50 (the flat F1 penalty, exact)
 *   DEAD WEIGHT audited houses −70 (last resort among houses)
 * The 20-point steps are sized against the distance term
 * (−1 point per 90 m): a step is worth ~1.8 km of distance,
 * more than the serve radius spans, so in a pool the
 * importance class — not a few hundred metres — decides
 * house-vs-house order, while distance still orders within a
 * class. Tier-1 exception houses are untouched by the
 * graduation: their F1 −50 stands exactly as the tier build
 * left it (their privilege is the tier lane, not score). A
 * PROMOTE-class record without an exception grant (none exist
 * by construction — all 24 PROMOTEs are exceptions) would take
 * the SOLID step rather than sink unaudited.
 */
export const HOUSE_SCORE_PENALTY = 50;
export const HOUSE_SCORE_PENALTY_SOLID = 30;
export const HOUSE_SCORE_PENALTY_DEAD = 70;

function houseScorePenalty(c: Candidate): number {
  if (isTier1HouseException(c.name) || (c.registry && isTier1HouseException(c.registry.name))) {
    return HOUSE_SCORE_PENALTY;
  }
  const imp = houseImportanceFor(c.name) ?? (c.registry ? houseImportanceFor(c.registry.name) : null);
  if (!imp) return HOUSE_SCORE_PENALTY;
  return imp.verdict === 'DEAD WEIGHT' ? HOUSE_SCORE_PENALTY_DEAD : HOUSE_SCORE_PENALTY_SOLID;
}

export function applyHouseDemotion(candidates: Candidate[]): void {
  for (const c of candidates) {
    if (isHousePlaceName(c.name)) c.score -= houseScorePenalty(c);
  }
}

/**
 * Partner class in freeform discovery (v16.2 Slice 1, Nov 16,
 * 2026): a candidate that IS an ACTIVE partner's site — judged
 * on either name it carries, the Places display name or the
 * registry's own, the same two-dialect rule as the Tier-1
 * house exceptions — and whose ground lies inside the
 * partner's serve radius (the candidate's distanceM is the
 * driver's distance to the site itself) earns Tier-1 and
 * carries the partner's id. This is the partner's road to the
 * Tier-1 lane: the approved telling of their own property wins
 * its serve class near their site (tour.ts additionally
 * prefers the frozen set's exact telling for the place).
 *
 * Like the house-exception road, the boost touches the TIER
 * only, never the score: the partner's ground orders among
 * ordinary candidates exactly as it did, house demotion
 * included. And while the registry holds no active partner —
 * today it holds one dormant prospect — this function is a
 * no-op on every candidate, by construction.
 */
export function applyPartnerBoost(candidates: Candidate[], partners: readonly Partner[] = activePartners()): void {
  if (partners.length === 0) return;
  for (const c of candidates) {
    const partner = partnerForPlaceName(c.name, partners) ?? (c.registry ? partnerForPlaceName(c.registry.name, partners) : null);
    if (!partner) continue;
    if (c.distanceM > partner.serveRadiusM) continue;
    c.tier1 = true;
    c.partnerId = partner.id;
  }
}

// ------------------------------------------------------------ place context

export interface AreaContext {
  neighborhood: string | null;
  city: string | null;
  road: string | null;
}

export async function reverseArea(lat: number, lng: number): Promise<AreaContext> {
  const named = findNamedArea(lat, lng);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return { neighborhood: named?.name ?? null, city: null, road: null };
    const parsed = (await res.json()) as {
      address?: Record<string, string>;
    };
    const a = parsed.address ?? {};
    return {
      neighborhood:
        named?.name ??
        a.neighbourhood ??
        a.suburb ??
        a.city_district ??
        a.quarter ??
        null,
      city: a.city ?? a.town ?? a.village ?? a.county ?? null,
      road: a.road ?? null,
    };
  } catch {
    return { neighborhood: named?.name ?? null, city: null, road: null };
  }
}

// ------------------------------------------------------------ fact pack (S7)

async function wikipediaExtract(title: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`,
    );
    if (!res.ok) return null;
    const parsed = (await res.json()) as {
      query?: { pages?: Record<string, { extract?: string }> };
    };
    const pages = parsed.query?.pages ?? {};
    const first = Object.values(pages)[0];
    const extract = first?.extract?.trim();
    return extract ? extract.slice(0, 1600) : null;
  } catch {
    return null;
  }
}

async function wikidataSummary(name: string): Promise<string | null> {
  try {
    const search = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&origin=*&limit=1`,
    );
    if (!search.ok) return null;
    const parsed = (await search.json()) as {
      search?: { description?: string }[];
    };
    return parsed.search?.[0]?.description ?? null;
  } catch {
    return null;
  }
}

export interface FactPack {
  name: string;
  lat: number;
  lng: number;
  types: string[];
  rating: number | null;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  wikipedia: string | null;
  wikidata: string | null;
  registryFacts: string[];
  nearbyNames: string[];
}

export async function buildFactPack(
  candidate: Candidate,
  area: AreaContext,
  nearby: Candidate[],
): Promise<FactPack> {
  const [wiki, wd] = await Promise.all([
    wikipediaExtract(candidate.name),
    wikidataSummary(candidate.name),
  ]);
  const registryFacts: string[] = [];
  const rec = candidate.registry ?? registryNear(candidate, 200)[0] ?? null;
  if (rec) {
    if (rec.significance) registryFacts.push(`Historic register entry: ${rec.name} — ${rec.significance}.`);
    if (rec.designatedYear) registryFacts.push(`Designated ${rec.designatedYear}.`);
    if (rec.architect) registryFacts.push(`Architect: ${rec.architect}.`);
    if (rec.address) registryFacts.push(`Address on record: ${rec.address}.`);
  }
  return {
    name: candidate.name,
    lat: candidate.lat,
    lng: candidate.lng,
    types: candidate.types,
    rating: candidate.rating,
    address: candidate.address,
    neighborhood: area.neighborhood,
    city: area.city,
    wikipedia: wiki,
    wikidata: wd,
    registryFacts,
    nearbyNames: nearby.filter(c => c.name !== candidate.name).slice(0, 5).map(c => c.name),
  };
}

/** Render a fact pack as prompt text (the honesty contract's input). */
export function factPackText(pack: FactPack): string {
  const lines: string[] = [
    `PLACE: ${pack.name}`,
    `Coordinates: ${pack.lat.toFixed(5)}, ${pack.lng.toFixed(5)}`,
  ];
  if (pack.types.length) lines.push(`Types: ${pack.types.join(', ')}`);
  if (pack.rating !== null) lines.push(`Visitor rating: ${pack.rating} / 5`);
  if (pack.address) lines.push(`Address: ${pack.address}`);
  if (pack.neighborhood) lines.push(`Neighborhood: ${pack.neighborhood}`);
  if (pack.city) lines.push(`City: ${pack.city}`);
  for (const fact of pack.registryFacts) lines.push(`Registry fact: ${fact}`);
  if (pack.wikidata) lines.push(`Wikidata description: ${pack.wikidata}`);
  if (pack.wikipedia) lines.push(`Wikipedia extract:\n${pack.wikipedia}`);
  if (pack.nearbyNames.length) lines.push(`Also nearby: ${pack.nearbyNames.join('; ')}`);
  return lines.join('\n');
}
