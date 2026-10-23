// OpenStreetMap Overpass API service.
//
// Supplement to Google Places — pulls features that Places doesn't surface:
// historical markers, wikidata-linked entries, building dates, architect tags,
// former names, heritage designations. Used for tag enrichment and search-term
// generation for Wikipedia and Gemini, not as a primary story source.
//
// Overpass is free, CORS-enabled, and needs no API key. Requests are kept
// lightweight (small radius, bounded result count) to avoid latency spikes.

import { Position } from '../hooks/useGeolocation';
import { calculateDistance } from '../utils/geo';

export interface OsmFeature {
  name: string;
  type: string;
  subtype: string;
  distance: number;
  tags: Record<string, string>;
  wikidata?: string;
}

interface CacheEntry {
  lat: number;
  lng: number;
  features: OsmFeature[];
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_DISTANCE_M = 200;
const REQUEST_TIMEOUT_MS = 7000;
const SEARCH_RADIUS_M = 400;
const MAX_FEATURES = 15;

// Overpass QL — amenity, historic, tourism, leisure, railway, highway, bridge,
// tunnel, building tags with a name. Kept broad to catch what Places misses.
const OVERPASS_QUERY = (lat: number, lng: number, radius: number) => `
[out:json][timeout:6];
(
  node["name"](around:${radius},${lat},${lng});
  way["name"](around:${radius},${lat},${lng});
);
out tags 60;`;

class OsmService {
  private cache: CacheEntry[] = [];

  async getNearbyFeatures(position: Position, speed?: number | null): Promise<OsmFeature[]> {
    if (speed !== undefined && speed !== null && speed > 15) return [];
    const cached = this.getCached(position);
    if (cached) return cached;

    try {
      const features = await this.fetchOverpass(position);
      this.setCached(position, features);
      return features;
    } catch (error) {
      console.warn('[OSM] Overpass query failed:', error);
      return [];
    }
  }

  private getCached(position: Position): OsmFeature[] | null {
    const now = Date.now();
    for (const entry of this.cache) {
      if (now - entry.timestamp > CACHE_TTL_MS) continue;
      const dist = calculateDistance(position.lat, position.lng, entry.lat, entry.lng);
      if (dist <= CACHE_DISTANCE_M) return entry.features;
    }
    return null;
  }

  private setCached(position: Position, features: OsmFeature[]) {
    this.cache.push({ lat: position.lat, lng: position.lng, features, timestamp: Date.now() });
    if (this.cache.length > 8) this.cache.shift();
  }

  private async fetchOverpass(position: Position): Promise<OsmFeature[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let data: any;
    try {
      const query = OVERPASS_QUERY(position.lat, position.lng, SEARCH_RADIUS_M);
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal,
      });
      data = await res.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn('[OSM] Overpass timed out');
      }
      return [];
    } finally {
      clearTimeout(timer);
    }

    const elements = data?.elements;
    if (!Array.isArray(elements)) return [];

    const features: OsmFeature[] = [];

    for (const el of elements) {
      const tags = el.tags || {};
      if (!tags.name) continue;

      // Skip pure residential addresses and generic shops that Places already covers.
      if (tags.shop && !tags.historic && !tags['wikidata']) continue;
      if (tags.building === 'residential' && Object.keys(tags).length <= 3) continue;

      const type = this.classifyFeature(tags);
      if (type === 'skip') continue;

      features.push({
        name: tags.name,
        type: type,
        subtype: this.subtype(tags, type),
        distance: 0,
        tags,
        wikidata: tags.wikidata,
      });
    }

    // Deduplicate by name, cap to MAX_FEATURES.
    const seen = new Set<string>();
    const unique = features.filter(f => {
      const key = f.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort story-worthy features first — ones with historic, wikidata, tourism,
    // heritage, start_date, or architect tags — before generic amenities.
    const isStoryWorthy = (f: OsmFeature): boolean =>
      !!(f.tags.historic || f.tags.wikidata || f.tags.tourism || f.tags.heritage || f.tags.start_date || f.tags.architect);

    unique.sort((a, b) => {
      const aw = isStoryWorthy(a) ? 0 : 1;
      const bw = isStoryWorthy(b) ? 0 : 1;
      return aw - bw;
    });

    return unique.slice(0, MAX_FEATURES);
  }

  private classifyFeature(tags: Record<string, string>): string {
    if (tags.historic) return 'historic';
    if (tags.tourism) return 'tourism';
    if (tags.railway) return 'railway';
    if (tags.highway === 'bridge' || tags.bridge) return 'bridge';
    if (tags.tunnel) return 'tunnel';
    if (tags.amenity) return 'amenity';
    if (tags.leisure) return 'leisure';
    if (tags.building) return 'building';
    if (tags.man_made) return 'man_made';
    if (tags.natural) return 'natural';
    if (tags.waterway) return 'waterway';
    if (tags.place) return 'place';
    if (tags['wikidata']) return 'wikidata';
    return 'skip';
  }

  private subtype(tags: Record<string, string>, type: string): string {
    if (type === 'historic') return tags.historic || '';
    if (type === 'tourism') return tags.tourism || '';
    if (type === 'railway') return tags.railway || '';
    if (type === 'amenity') return tags.amenity || '';
    if (type === 'leisure') return tags.leisure || '';
    if (type === 'building') return tags.building || '';
    if (type === 'man_made') return tags.man_made || '';
    if (type === 'natural') return tags.natural || '';
    if (type === 'waterway') return tags.waterway || '';
    return '';
  }

  // Format features for the Gemini prompt — surface the tags that matter for
  // storytelling: heritage status, dates, architects, former names, wikidata.
  formatForPrompt(features: OsmFeature[]): string {
    if (features.length === 0) return '';

    const lines: string[] = ['OPENSTREETMAP CONTEXT — tagged features near the listener (supplements Google Places):'];

    for (const f of features) {
      const parts: string[] = [f.name];

      const storyTags: string[] = [];
      if (f.tags.historic) storyTags.push(`historic:${f.tags.historic}`);
      if (f.tags.heritage) storyTags.push(`heritage:${f.tags.heritage}`);
      if (f.tags['start_date']) storyTags.push(`built:${f.tags['start_date']}`);
      if (f.tags.architect) storyTags.push(`architect:${f.tags.architect}`);
      if (f.tags['name:etymology'] || f.tags['name:etymology:wikidata']) {
        storyTags.push('name-origin-known');
      }
      if (f.tags['alt_name'] || f.tags['old_name']) {
        const old = f.tags['old_name'] || f.tags['alt_name'];
        storyTags.push(`formerly:${old}`);
      }
      if (f.tags['wikidata']) storyTags.push('wikidata-linked');
      if (f.tags['description']) storyTags.push(`desc:${f.tags['description'].slice(0, 80)}`);

      if (storyTags.length > 0) {
        parts.push(`(${storyTags.join(', ')})`);
      } else if (f.subtype) {
        parts.push(`(${f.type}:${f.subtype})`);
      }

      lines.push(`- ${parts.join(' ')}`);
    }

    return lines.join('\n');
  }

  // Extract search terms from OSM features to use as Wikipedia/Gemini hints.
  // Pulls notable names, historical markers, and architect/heritage info.
  getSearchHints(features: OsmFeature[]): string[] {
    const hints: string[] = [];
    for (const f of features) {
      if (f.type === 'historic' || f.type === 'tourism' || f.wikidata) {
        hints.push(f.name);
      }
      if (f.tags.architect) hints.push(f.tags.architect);
      if (f.tags['old_name']) hints.push(f.tags['old_name']);
    }
    return hints.slice(0, 5);
  }
}

export const osmService = new OsmService();
