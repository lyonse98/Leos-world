// Multi-tier POI & lore pipeline.
//
// Given GPS coordinates, returns a "Fact Pack" from the highest available
// tier. Each tier is tried in order; the first that returns useful data wins.
//
// TIER 1 — Wikipedia GeoSearch (articles near the coordinates)
// TIER 2 — OpenStreetMap Overpass (historical markers, plaques, features)
// TIER 3 — Historic registry (San Diego designated places, local dataset)
// TIER 4 — Google Places API (venue metadata)
// TIER 5 — Corridor fallback (generic narrative for quiet stretches)

import { historicRegistry } from './historicRegistry';

export interface POIResult {
  tier: 'google_places' | 'wikipedia' | 'openstreetmap' | 'historic_registry' | 'corridor';
  title: string;
  summary: string;
  types: string[];
  distance: number;
  // Raw tags or categories from the source, for the prompt builder.
  rawTags: string[];
}

export interface FactPack {
  lat: number;
  lng: number;
  results: POIResult[];
  tier: POIResult['tier'];
  areaLabel: string;
}

const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// --- Tier 1: Google Places ---

async function fetchGooglePlaces(lat: number, lng: number): Promise<POIResult[]> {
  if (!GOOGLE_PLACES_KEY) return [];

  // Places API (New) searchNearby (migrated Oct 25, 2026 — the legacy
  // nearbysearch endpoint cannot be enabled on new Google projects).
  // Field mask omits rating: this tier doesn't consume it, keeping these
  // calls in the cheapest field tier.
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.types,places.location',
      },
      body: JSON.stringify({
        maxResultCount: 10,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 200,
          },
        },
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();

    if (!data.places || data.places.length === 0) return [];

    return data.places
      .filter((p: any) => p.displayName?.text && p.location)
      .slice(0, 3)
      .map((p: any) => ({
        tier: 'google_places' as const,
        title: p.displayName.text,
        summary: p.formattedAddress || p.types?.join(', ') || '',
        types: p.types || [],
        distance: 0,
        rawTags: p.types || [],
      }));
  } catch {
    return [];
  }
}

// --- Tier 2: Wikipedia GeoSearch ---

async function fetchWikipedia(lat: number, lng: number): Promise<POIResult[]> {
  try {
    const geoUrl = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lng}&gsradius=500&gslimit=3&format=json&origin=*`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) return [];
    const geoData = await geoRes.json();

    const pages = geoData?.query?.geosearch;
    if (!pages || pages.length === 0) return [];

    const results: POIResult[] = [];
    for (const page of pages.slice(0, 3)) {
      const title = page.title;
      try {
        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const summaryRes = await fetch(summaryUrl);
        if (!summaryRes.ok) continue;
        const summaryData = await summaryRes.json();

        results.push({
          tier: 'wikipedia',
          title,
          summary: summaryData.extract || '',
          types: ['wikipedia'],
          distance: page.dist || 0,
          rawTags: ['wikipedia', summaryData.type || 'article'],
        });
      } catch {
        // Individual page fetch failures are fine — keep what we got
      }
    }
    return results;
  } catch {
    return [];
  }
}

// --- Tier 3: OpenStreetMap Overpass ---

async function fetchOpenStreetMap(lat: number, lng: number): Promise<POIResult[]> {
  try {
    const query = `[out:json][timeout:5]; node(around:250, ${lat}, ${lng})["historic"]; out body 3;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query,
    });
    if (!res.ok) return [];
    const data = await res.json();

    const elements = data?.elements;
    if (!elements || elements.length === 0) return [];

    return elements.slice(0, 3).map((el: any) => {
      const tags = el.tags || {};
      const name = tags.name || tags['name:en'] || 'Historical marker';
      const historicType = tags.historic || 'historic';
      const description = tags.description || tags['description:en'] || tags.note || '';

      return {
        tier: 'openstreetmap' as const,
        title: name,
        summary: description || `${historicType.replace(/_/g, ' ')} recorded by OpenStreetMap`,
        types: [historicType],
        distance: 0,
        rawTags: Object.keys(tags).slice(0, 10),
      };
    });
  } catch {
    return [];
  }
}

// --- Tier 3: Historic registry (San Diego designated places) ---

// Local dataset, no network. Any record with coordinates can inform this
// fact-grade surface; the stricter verified-only eligibility for story
// *candidates* lives in historicRegistry.selectionCandidates and is
// applied on the gemini.ts selection path, not here.
function fetchHistoricRegistry(lat: number, lng: number): POIResult[] {
  try {
    return historicRegistry.recordsNear(lat, lng, 500).slice(0, 3).map(({ record, distanceM }) => {
      const registers = record.registers
        .map(r => (r === 'national' ? 'National Register of Historic Places' : 'San Diego Register of Historic Resources'))
        .join(' and ');
      const details = [
        `designated historic place, listed on the ${registers}`,
        record.designatedYear ? `designated ${record.designatedYear}` : '',
        record.significance ? `significance: ${record.significance}` : '',
        record.address || '',
      ].filter(part => part.length > 0);

      return {
        tier: 'historic_registry' as const,
        title: record.name,
        summary: details.join(' — '),
        types: ['historic_registry'],
        distance: Math.round(distanceM),
        rawTags: record.registers.map(r => (r === 'national' ? 'national_register' : 'san_diego_register')),
      };
    });
  } catch {
    return [];
  }
}

// --- Tier 5: Corridor fallback ---

function corridorFallback(): POIResult[] {
  return [{
    tier: 'corridor',
    title: 'This stretch of road',
    summary: 'No specific points of interest were found nearby. This is a quiet stretch — tell a broader story about the region, the road itself, or the landscape.',
    types: ['corridor'],
    distance: 0,
    rawTags: ['corridor'],
  }];
}

// --- Public API ---

export async function getFactPack(lat: number, lng: number): Promise<FactPack> {
  // Wikipedia first — it has the richest historical narrative content and is
  // free. OSM historical markers second — also free, covers plaques and
  // monuments Wikipedia may miss. Google Places last as venue metadata: it's
  // useful for commercial landmarks but costs an API call and has less depth.
  const wiki = await fetchWikipedia(lat, lng);
  if (wiki.length > 0) {
    return { lat, lng, results: wiki, tier: 'wikipedia', areaLabel: wiki[0].title };
  }

  const osm = await fetchOpenStreetMap(lat, lng);
  if (osm.length > 0) {
    return { lat, lng, results: osm, tier: 'openstreetmap', areaLabel: osm[0].title };
  }

  // Designated historic places outrank raw venue metadata: a registry
  // record is a curated, citable fact; a Places listing is a pin.
  const registry = fetchHistoricRegistry(lat, lng);
  if (registry.length > 0) {
    return { lat, lng, results: registry, tier: 'historic_registry', areaLabel: registry[0].title };
  }

  const places = await fetchGooglePlaces(lat, lng);
  if (places.length > 0) {
    return { lat, lng, results: places, tier: 'google_places', areaLabel: places[0].summary };
  }

  const fallback = corridorFallback();
  return { lat, lng, results: fallback, tier: 'corridor', areaLabel: 'Quiet stretch' };
}

export function formatFactPackForPrompt(pack: FactPack): string {
  const lines: string[] = [];
  lines.push(`LOCATION: ${pack.lat.toFixed(5)}, ${pack.lng.toFixed(5)}`);
  lines.push(`DATA SOURCE: ${pack.tier}`);
  lines.push(`AREA: ${pack.areaLabel}`);

  if (pack.results.length > 0) {
    lines.push('NEARBY POINTS OF INTEREST:');
    for (const r of pack.results) {
      lines.push(`- ${r.title}: ${r.summary}`);
      if (r.rawTags.length > 0) {
        lines.push(`  Tags: ${r.rawTags.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}
