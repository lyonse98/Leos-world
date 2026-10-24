import { Position } from '../hooks/useGeolocation';
import {
  calculateDistance,
  resolveMovementMode,
  MovementModeHysteresis,
  bearingDegrees,
  offsetPositionByHeading,
} from '../utils/geo';

export interface NearbyPlace {
  name: string;
  types: string[];
  vicinity: string;
  rating?: number;
  distance: number;
  historicalScore: number;
  direction: string;
}

interface CacheEntry {
  places: NearbyPlace[];
  timestamp: number;
  lat: number;
  lng: number;
}

const CACHE_TTL_MS = 30_000;
const CACHE_DISTANCE_M = 50;

export interface AreaInfo {
  neighborhood: string | null;
  city: string | null;
  district: string | null;
  street: string | null;
}

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const REQUEST_TIMEOUT_MS = 8000;

// Lazily-loaded Google Maps SDK services. The JS SDK bypasses CORS by loading
// through a script tag, unlike direct REST calls which browsers block.
let mapsLoaderPromise: Promise<void> | null = null;
let placesServiceInstance: any = null;
let geocoderServiceInstance: any = null;

async function ensureMapsLoaded(): Promise<void> {
  if (mapsLoaderPromise) return mapsLoaderPromise;
  mapsLoaderPromise = (async () => {
    const { Loader } = await import('@googlemaps/js-api-loader');
    const loader = new Loader({
      apiKey: API_KEY,
      version: 'weekly',
      libraries: ['places'],
    });
    await loader.load();
    placesServiceInstance = new (window as any).google.maps.places.PlacesService(
      (window as any).document.createElement('div')
    );
    geocoderServiceInstance = new (window as any).google.maps.Geocoder();
  })();
  return mapsLoaderPromise;
}

class PlacesService {
  private cache: CacheEntry[] = [];
  private areaCache: { lat: number; lng: number; info: AreaInfo; timestamp: number }[] = [];
  private pendingRequest: Promise<NearbyPlace[]> | null = null;
  private pendingAreaRequest: Promise<AreaInfo> | null = null;
  private lastKnownMode: MovementModeHysteresis = 'stationary';

  async initialize(): Promise<void> {
    if (!API_KEY) {
      console.warn('[Places] No Google Maps API key set — places will be empty');
    }
  }

  // Load the Google Maps SDK before the first story request needs it. Called
  // at app startup so the 1-2 second script load doesn't delay the first story.
  async prewarm(): Promise<void> {
    if (!API_KEY) return;
    try {
      await ensureMapsLoaded();
    } catch (error) {
      console.warn('[Places] Pre-warm failed (will retry lazily):', error);
    }
  }

  private getCached(position: Position): NearbyPlace[] | null {
    const now = Date.now();
    for (const entry of this.cache) {
      if (now - entry.timestamp > CACHE_TTL_MS) continue;
      const dist = calculateDistance(position.lat, position.lng, entry.lat, entry.lng);
      if (dist <= CACHE_DISTANCE_M) return entry.places;
    }
    return null;
  }

  private setCached(position: Position, places: NearbyPlace[]) {
    this.cache.push({ places, timestamp: Date.now(), lat: position.lat, lng: position.lng });
    if (this.cache.length > 5) this.cache.shift();
  }

  async getNearbyLandmarks(position: Position, radiusMeters: number = 100): Promise<NearbyPlace[]> {
    if (!API_KEY) return [];

    const cached = this.getCached(position);
    if (cached) return cached;

    if (this.pendingRequest) {
      return this.pendingRequest;
    }

    // Widened from 50-100m to 200m minimum. A temple across the street at
    // 150m was invisible under the old 50m floor because a closer low-interest
    // place would satisfy the search and suppress expansion.
    const accuracyRadius = position.accuracy > 0 ? position.accuracy * 2 : 100;
    const effectiveRadius = Math.max(200, Math.min(500, accuracyRadius));

    let searchPosition = position;
    this.lastKnownMode = resolveMovementMode(position.speed, this.lastKnownMode);
    if (this.lastKnownMode === 'driving' && position.heading !== null && !isNaN(position.heading)) {
      const lookAheadMeters = 80;
      const ahead = offsetPositionByHeading(position, position.heading, lookAheadMeters);
      searchPosition = { ...position, ...ahead };
    }

    this.pendingRequest = this.fetchNearbyLandmarks(searchPosition, effectiveRadius)
      .finally(() => { this.pendingRequest = null; });

    let places = await this.pendingRequest;

    // Always also search at 500m and merge any new unique places, even if the
    // initial search returned results. The old code only expanded when
    // places.length === 0, which meant a single close park suppressed a temple
    // or mission at 300m.
    if (effectiveRadius < 500) {
      const widerPlaces = await this.fetchNearbyLandmarks(searchPosition, 500);
      const existingNames = new Set(places.map(p => p.name));
      const newPlaces = widerPlaces.filter(p => !existingNames.has(p.name));
      places = [...places, ...newPlaces];
    }

    // For driving mode, also search at 1000m to catch large landmarks
    // (missions, cathedrals, stadiums) that sit back from the road.
    if (this.lastKnownMode === 'driving') {
      const existingNames = new Set(places.map(p => p.name));
      const widerPlaces = await this.fetchNearbyLandmarks(searchPosition, 1000);
      const newPlaces = widerPlaces.filter(p => !existingNames.has(p.name));
      places = [...places, ...newPlaces];
    }

    if (places.length === 0) {
      const movement = resolveMovementMode(position.speed, this.lastKnownMode);
      const expansionTiers = movement === 'driving' ? [1500] : [1000];
      for (const widerRadius of expansionTiers) {
        console.log(`[Places] No landmarks at ${effectiveRadius}m, expanding to ${widerRadius}m`);
        places = await this.fetchNearbyLandmarks(searchPosition, widerRadius);
        if (places.length > 0) break;
      }
    }

    this.setCached(position, places);
    return places;
  }

  private async fetchNearbyLandmarks(position: Position, radiusMeters: number): Promise<NearbyPlace[]> {
    if (!API_KEY) return [];
    try {
      await ensureMapsLoaded();
    } catch (error) {
      console.error('[Places] Failed to load Google Maps SDK:', error);
      return [];
    }

    const searchRadius = Math.min(Math.round(radiusMeters), 1500);
    const center = new (window as any).google.maps.LatLng(position.lat, position.lng);

    const request: any = {
      location: center,
      radius: searchRadius,
    };

    const places = await new Promise<NearbyPlace[]>((resolve) => {
      const allRaw: any[] = [];
      const timer = setTimeout(() => {
        console.warn('[Places] nearbySearch timed out');
        resolve(mapAndFilter(allRaw));
      }, REQUEST_TIMEOUT_MS);

      const mapAndFilter = (raw: any[]): NearbyPlace[] => {
        const mapped: NearbyPlace[] = raw
          .filter((place: any) => place.geometry?.location && place.name)
          .map((place: any) => {
            const placeLat = place.geometry.location.lat();
            const placeLng = place.geometry.location.lng();
            const distance = calculateDistance(position.lat, position.lng, placeLat, placeLng);
            const historicalScore = this.calculateHistoricalScore(place.types || [], place.name || '');
            const direction = this.directionFromTo(position, { lat: placeLat, lng: placeLng });

            return {
              name: place.name,
              types: place.types || [],
              vicinity: place.vicinity || '',
              rating: place.rating,
              distance: Math.round(distance),
              historicalScore,
              direction,
            };
          })
          .filter(place => place.distance <= searchRadius);
        return mapped;
      };

      const callback = (results: any[], status: string, pagination?: any) => {
        if (status !== 'OK' && status !== 'ZERO_RESULTS') {
          clearTimeout(timer);
          console.error('[Places] nearbySearch error:', status);
          resolve([]);
          return;
        }
        if (results) allRaw.push(...results);

        // Fetch the second page too — in dense areas a temple at 200m can be
        // pushed off the first 20-result page by closer businesses.
        if (pagination && pagination.hasNextPage) {
          pagination.nextPage();
        } else {
          clearTimeout(timer);
          resolve(mapAndFilter(allRaw));
        }
      };

      placesServiceInstance.nearbySearch(request, callback);
    });

    const uniquePlaces = Array.from(
      new Map(places.map(place => [place.name, place])).values()
    );

    return uniquePlaces
      .filter(place => place.historicalScore > 0)
      .sort((a, b) => {
        if (a.distance <= 25 && b.distance > 25) return -1;
        if (b.distance <= 25 && a.distance > 25) return 1;
        if (a.distance <= 50 && b.distance > 50) return -1;
        if (b.distance <= 50 && a.distance > 50) return 1;
        const scoreDiff = b.historicalScore - a.historicalScore;
        if (Math.abs(scoreDiff) > 20) return scoreDiff;
        return a.distance - b.distance;
      });
  }

  private directionFromTo(from: Position, to: { lat: number; lng: number }): string {
    const bearing = bearingDegrees(from, to);

    if (from.heading !== null && !isNaN(from.heading)) {
      let relative = bearing - from.heading;
      relative = ((relative % 360) + 360) % 360;
      if (relative < 22.5 || relative >= 337.5) return 'dead ahead';
      if (relative < 67.5) return 'ahead to your right';
      if (relative < 112.5) return 'to your right';
      if (relative < 157.5) return 'behind to your right';
      if (relative < 202.5) return 'directly behind you';
      if (relative < 247.5) return 'behind to your left';
      if (relative < 292.5) return 'to your left';
      return 'ahead to your left';
    }

    const compassDirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
    const idx = Math.round(bearing / 45) % 8;
    return compassDirs[idx];
  }

  private distance(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
    return calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);
  }

  // Reserved for places important enough to move to the front of the story
  // queue. This is deliberately much stricter than "worth a story": an
  // ordinary university, cemetery, movie theater, or museum does not qualify
  // on category alone. The place needs an unmistakably major name signal, or
  // both a very strong historical score and a strong public rating.
  isTier1Landmark(place: NearbyPlace): boolean {
    const nameLower = place.name.toLowerCase();

    const majorNameSignals = [
      'national park', 'national memorial', 'national monument',
      'world heritage', 'capitol building', 'state capitol', 'u.s. capitol',
      'cathedral', 'basilica', 'grand central', 'union station',
      'state house', 'city hall', 'botanical garden', 'historic district',
      'observatory',
    ];
    if (majorNameSignals.some(signal => nameLower.includes(signal))) {
      return true;
    }

    const majorDestinationTypes = new Set([
      'stadium', 'amusement_park', 'aquarium', 'zoo',
    ]);
    if (
      place.types.some(t => majorDestinationTypes.has(t)) &&
      place.rating !== undefined &&
      place.rating >= 4.4
    ) {
      return true;
    }

    return place.historicalScore >= 175 &&
      place.rating !== undefined &&
      place.rating >= 4.5;
  }

  private calculateHistoricalScore(types: string[], name: string): number {
    let score = 0;
    const highValueTypes = new Set([
      'landmark', 'museum', 'tourist_attraction', 'church', 'place_of_worship',
      'city_hall', 'town_square', 'historical_landmark', 'monument', 'art_gallery',
      'university', 'library', 'stadium', 'cemetery', 'synagogue', 'hindu_temple',
      'mosque', 'courthouse', 'embassy', 'transit_station',
      'movie_theater', 'performing_arts_theater', 'night_club', 'amusement_park',
      'casino', 'bowling_alley', 'aquarium', 'zoo',
      'town_hall', 'city_hall', 'plaza', 'square',
      'subway_station', 'train_station', 'bus_station', 'light_rail_station',
      'transit_station', 'airport',
      'pier', 'wharf', 'marina', 'ferry_terminal'
    ]);

    const genericTypes = new Set([
      'establishment', 'point_of_interest', 'premise', 'subpremise',
      'political', 'route', 'street_address', 'geocode'
    ]);

    const historicNameKeywords = [
      'historic', 'historical', 'heritage', 'memorial', 'monument', 'museum',
      'cathedral', 'basilica', 'fort', 'castle', 'palace', 'hall', 'tower',
      'bridge', 'square', 'plaza', 'district', 'quarter', 'mansion', 'estate',
      'house', 'manor', 'villa', 'cottage', 'building', 'theater', 'theatre',
      'opera', 'symphony', 'auditorium', 'arena', 'coliseum', 'stadium',
      'ballpark', 'field', 'grounds', 'college', 'university', 'institute',
      'library', 'academy', 'station', 'terminal', 'depot', 'pier', 'wharf',
      'dock', 'lighthouse', 'arch', 'gate', 'obelisk', 'statue', 'fountain',
      'cemetery', 'graveyard', 'tomb', 'mausoleum', 'battlefield', 'preserve',
      'sanctuary', 'garden', 'park', 'commons', 'green', 'mall', 'esplanade',
      'promenade', 'boardwalk', 'overlook', 'viewpoint', 'lookout', 'springs',
      'hotel', 'inn', 'tavern', 'saloon', 'speakeasy', 'brewery', 'distillery',
      'market', 'bazaar', 'exchange', 'arsenal', 'armory', 'barracks',
      'courthouse', 'jail', 'prison', 'asylum', 'hospital', 'ward',
      'chapel', 'abbey', 'shrine', 'temple',
      'birthplace', 'childhood home', 'historic house', 'former home'
    ];

    const notableBusinessKeywords = [
      'historic', 'historical', 'oldest', 'original', 'famous', 'legendary',
      'iconic', 'landmark', 'heritage', 'classic', 'famed', 'renowned',
      'founded', 'est.', 'established', 'since 18', 'since 19', 'since 20'
    ];

    const darkHistoryKeywords = [
      'haunt', 'ghost', 'witch', 'murder', 'cursed', 'cemetery', 'graveyard',
      'tomb', 'crypt', 'gallows', 'witch', 'vampire', 'legend', 'mystery',
      'spooky', 'paranormal', 'asylum', 'sanitarium', 'workhouse', 'almshouse',
      'battlefield', 'massacre', 'duel'
    ];

    const mediumValueTypes = new Set([
      'park', 'neighborhood', 'locality', 'sublocality', 'point_of_interest',
      'establishment', 'route', 'street_address', 'premise', 'natural_feature',
      'political'
    ]);

    const suburbanValueTypes = new Set([
      'school', 'primary_school', 'secondary_school', 'fire_station', 'police',
      'post_office', 'community_center', 'city_hall', 'town_hall',
      'stadium', 'sports_complex', 'golf_course', 'amusement_park', 'aquarium',
      'bowling_alley', 'rv_park', 'campground'
    ]);

    const excludeTypes = new Set([
      'store', 'shopping_mall', 'restaurant', 'cafe', 'bar', 'food',
      'gas_station', 'parking', 'atm', 'bank', 'pharmacy', 'doctor',
      'hospital', 'supermarket', 'grocery_or_supermarket', 'laundry',
      'car_repair', 'car_wash', 'storage', 'real_estate_agency',
      'insurance_agency', 'lawyer', 'accounting', 'dentist', 'hair_care',
      'beauty_salon', 'spa', 'gym', 'lodging', 'convenience_store'
    ]);

    const hasExcludedType = types.some(type => excludeTypes.has(type));
    const hasSuburbanType = types.some(type => suburbanValueTypes.has(type));
    const hasHighValueType = types.some(type => highValueTypes.has(type));
    const nameLower = name.toLowerCase();

    const isNotableBusiness = notableBusinessKeywords.some(k => nameLower.includes(k));
    if (hasExcludedType && !hasSuburbanType && !hasHighValueType && !isNotableBusiness) return 0;

    const businessNameBlacklist = [
      'clinic', 'dental', 'dentist', 'orthodontics', 'law', 'attorney', 'lawyer',
      'legal', 'plumbing', 'plumber', 'insurance', 'tires', 'chiropractic',
      'veterinary', 'vet clinic', 'animal hospital', ' Urgent Care', 'medical center',
      'pharmacy', 'pawn', 'payday', 'towing', 'self storage', 'locksmith',
      'realty', 'real estate', 'title loans', 'check cashing'
    ];

    const nameAllowlist = [
      'park', 'trail', 'trailhead', 'point', 'overlook', 'historic', 'wharf',
      'pier', 'memorial', 'museum', 'monument', 'garden', 'beach', 'bridge',
      'island', 'lake', 'creek', 'river', 'preserve', 'sanctuary', 'battlefield',
      'cemetery', 'lighthouse', 'fort', 'temple', 'cathedral', 'basilica',
      'chapel', 'abbey', 'shrine', 'mission', 'observatory', 'theater', 'theatre',
      'stadium', 'arena', 'coliseum', 'aquarium', 'zoo', 'university', 'college'
    ];

    const nameIsAllowlisted = nameAllowlist.some(word => nameLower.includes(word));
    if (!nameIsAllowlisted) {
      for (const word of businessNameBlacklist) {
        const pattern = new RegExp(`\\b${word.trim()}\\b`, 'i');
        if (pattern.test(name)) return 0;
      }
    }

    types.forEach(type => {
      if (highValueTypes.has(type)) score += 130;
      else if (mediumValueTypes.has(type) && !genericTypes.has(type)) score += 50;
      else if (suburbanValueTypes.has(type)) score += 25;
    });

    for (const keyword of historicNameKeywords) {
      if (nameLower.includes(keyword)) {
        score += 45;
        break;
      }
    }

    for (const keyword of darkHistoryKeywords) {
      if (nameLower.includes(keyword)) {
        score += 25;
        break;
      }
    }

    return score;
  }

  async getAreaInfo(position: Position): Promise<AreaInfo> {
    if (!API_KEY) return { neighborhood: null, city: null, district: null, street: null };

    const cached = this.areaCache.find(
      c => this.distance(position, { lat: c.lat, lng: c.lng }) < 100
    );
    if (cached && Date.now() - cached.timestamp < 300000) {
      return cached.info;
    }

    if (this.pendingAreaRequest) {
      try { return await this.pendingAreaRequest; } catch { /* fall through */ }
    }

    this.pendingAreaRequest = this.fetchAreaInfo(position);
    try {
      const info = await this.pendingAreaRequest;
      this.areaCache.push({ lat: position.lat, lng: position.lng, info, timestamp: Date.now() });
      if (this.areaCache.length > 20) this.areaCache.shift();
      return info;
    } finally {
      this.pendingAreaRequest = null;
    }
  }

  private async fetchAreaInfo(position: Position): Promise<AreaInfo> {
    if (!API_KEY) return { neighborhood: null, city: null, district: null, street: null };
    try {
      await ensureMapsLoaded();
    } catch (error) {
      console.error('[Places] Failed to load Google Maps SDK for geocode:', error);
      return { neighborhood: null, city: null, district: null, street: null };
    }

    const request: any = {
      location: { lat: position.lat, lng: position.lng },
    };

    return new Promise<AreaInfo>((resolve) => {
      const timer = setTimeout(() => {
        console.warn('[Places] Geocode timed out');
        resolve({ neighborhood: null, city: null, district: null, street: null });
      }, REQUEST_TIMEOUT_MS);

      geocoderServiceInstance.geocode(request, (results: any[], status: string) => {
        clearTimeout(timer);
        if (status !== 'OK' || !results) {
          resolve({ neighborhood: null, city: null, district: null, street: null });
          return;
        }

        let neighborhood: string | null = null;
        let city: string | null = null;
        let district: string | null = null;
        let street: string | null = null;

        for (const result of results) {
          for (const comp of result.address_components) {
            const types = comp.types;
            if (!neighborhood && (types.includes('neighborhood') || types.includes('sublocality'))) {
              neighborhood = comp.long_name;
            }
            if (!city && (types.includes('locality') || types.includes('administrative_area_level_2'))) {
              city = comp.long_name;
            }
            if (!district && types.includes('administrative_area_level_1')) {
              district = comp.long_name;
            }
            if (!street && types.includes('route')) {
              street = comp.long_name;
            }
          }
          if (neighborhood && city) break;
        }

        resolve({ neighborhood, city, district, street });
      });
    });
  }

  formatPlacesForPrompt(places: NearbyPlace[]): string {
    if (places.length === 0) {
      return 'No specific landmarks detected in immediate vicinity.';
    }

    return places
      .map(place => {
        const typeInfo = place.types.slice(0, 2).join(', ');
        return `- ${place.name} (${place.direction}) [${typeInfo}]`;
      })
      .join('\n');
  }

  clearCache() {
    this.cache = [];
  }
}

export const placesService = new PlacesService();
