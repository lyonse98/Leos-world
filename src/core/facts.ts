// Discovery and fact packs for the fresh shell.
//
// Candidates come from Google Places (New), the historic registry
// dataset, and the curated major-places table. A live story's fact
// pack (spec S7) assembles identity + coordinates + Places data +
// Wikipedia / Wikidata / registry facts + local context; specific
// claims in a generated story must trace to this pack.

import registryData from '../data/sd-historic-registry.json';
import { MAJOR_PLACES } from '../content/majorPlaces';
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
      if (national) c.tier1 = true;
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
        tier1: national,
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
  out.sort((a, b) => b.score - a.score);
  return out;
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
