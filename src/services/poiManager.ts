// Multi-tier POI & lore pipeline.
//
// Given GPS coordinates, returns a "Fact Pack" from the highest available
// tier. Each tier is tried in order; the first that returns useful data wins.
//
// TIER 1 — Wikipedia GeoSearch (articles near the coordinates)
// TIER 2 — OpenStreetMap Overpass (historical markers, plaques, features)
// TIER 3 — Google Places API (venue metadata)
// TIER 4 — Corridor fallback (generic narrative for quiet stretches)

export interface POIResult {
  tier: 'google_places' | 'wikipedia' | 'openstreetmap' | 'corridor';
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

  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=200&key=${GOOGLE_PLACES_KEY}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    if (!data.results || data.results.length === 0) return [];

    return data.results
      .filter((r: any) => r.name && r.geometry?.location)
      .slice(0, 3)
      .map((r: any) => ({
        tier: 'google_places' as const,
        title: r.name,
        summary: r.vicinity || r.types?.join(', ') || '',
        types: r.types || [],
        distance: 0,
        rawTags: r.types || [],
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

// --- Tier 4: Corridor fallback ---

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
