// Wikipedia geosearch service.
//
// Pulls article extracts for the area around the listener using the free
// Wikipedia Geosearch API. No key required. Results are fed into the Gemini
// prompt as additional fact-pack context, giving Leo real local material
// instead of relying solely on model training knowledge.

import { Position } from '../hooks/useGeolocation';
import { calculateDistance } from '../utils/geo';

export interface WikiArticle {
  title: string;
  extract: string;
  distance: number;
  url: string;
}

interface CacheEntry {
  lat: number;
  lng: number;
  articles: WikiArticle[];
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_DISTANCE_M = 200;
const REQUEST_TIMEOUT_MS = 6000;
const MAX_ARTICLES = 6;
const MAX_EXTRACT_CHARS = 600;
const SEARCH_RADIUS_M = 1000;

// Categories that surface the "99% Invisible" / "Mysteries at the Museum"
// vibe — the unseen forces behind the visible city. Not just ghosts and
// disasters: biography, politics, corruption, architecture, urban planning,
// labor, infrastructure, arts, demographic shifts. The goal is stories with
// human conflict, hidden history, and sensory grounding.
const PRIORITY_CATEGORY_KEYWORDS = [
  // Dark history — death, crime, scandal, the macabre
  'ghost', 'haunt', 'legend', 'myth', 'folklore', 'urban legend',
  'disaster', 'fire', 'flood', 'earthquake', 'epidemic', 'plague',
  'murder', 'crime', 'scandal', 'riot', 'protest', 'massacre',
  'demolished', 'abandoned', 'ruin', 'decay',
  'cemetery', 'grave', 'burial', 'tomb',
  'asylum', 'hospital', 'prison', 'jail', 'workhouse',
  'battle', 'war', 'military', 'fort',
  'shipwreck', 'lighthouse',
  // People — the figures behind the place
  'biograph', 'people from', 'people of', 'mayor', 'politician',
  'architect', 'builder', 'founder', 'pioneer', 'inventor',
  'businessperson', 'entrepreneur', 'philanthropist',
  'artist', 'musician', 'writer', 'poet', 'painter', 'sculptor',
  'activist', 'reformer', 'labor leader', 'union',
  // Power, money, and conflict
  'corruption', 'political scandal', 'graft', 'bribery',
  'redistrict', 'gentrification', 'demolition', 'urban renewal',
  'segregation', 'redlining', 'discrimination',
  'strike', 'labor dispute', 'walkout', 'lockout',
  'lawsuit', 'court case', 'supreme court',
  // Infrastructure and the built environment
  'railroad', 'streetcar', 'transit', 'subway', 'tunnel',
  'bridge', 'highway', 'freeway', 'interstate',
  'industrial', 'factory', 'mill', 'warehouse', 'refinery',
  'power plant', 'dam', 'reservoir', 'aqueduct',
  'port', 'harbor', 'dock', 'canal', 'wharf',
  // Architecture, urban planning, design
  'historic district', 'landmark', 'heritage', 'historic preservation',
  'architecture', 'architectural', 'building', 'skyscraper',
  'urban planning', 'city planning', 'zoning', 'subdivision',
  'public housing', 'housing project', 'tenement',
  // Culture, arts, and social history
  'fair', 'exposition', 'world\'s fair',
  'music venue', 'theater', 'cinema', 'nightclub',
  'restaurant history', 'bar history', 'hotel history',
  'immigration', 'diaspora', 'ethnic enclave',
  'religious', 'congregation', 'parish', 'diocese',
  // Natural history and geography
  'geology', 'geological', 'fault', 'earthquake',
  'river', 'creek', 'stream', 'wetland', 'marsh', 'bayou',
  'indigenous', 'native american', 'tribal',
  // Births, deaths, and notable lives
  'birthplace', 'childhood home', 'died at', 'death of', 'murder of', 'killed at', 'assassinated at',
  'shooting', 'bombing', 'explosion', 'collapse', 'protest', 'riot', 'hostage', 'kidnapping',
  'terror', 'attack', 'tragedy', 'accident', 'crash', 'mass shooting', 'assassination',
  // Scandal, secrecy, and espionage
  'conspiracy', 'cover-up', 'coverup', 'classified', 'secret', 'covert', 'espionage', 'spy',
  'cold war', 'red scare', 'surveillance', 'wiretap',
  // Sports venues and events
  'stadium', 'arena', 'ballpark', 'coliseum', 'championship', 'world series', 'super bowl',
  'olympics', 'marathon',
  // Music venues and scenes
  'concert', 'festival', 'recording studio', 'record label', 'music scene',
  // Women's history and suffrage
  'suffrage', "women's rights", 'feminist', 'first woman',
  // Notable buildings and superlatives
  'tallest', 'skyscraper', 'listed building', 'grade-listed',
  // Invention and discovery
  'invention of', 'patent', 'invented', 'discovery', 'breakthrough',
];

class WikipediaService {
  private cache: CacheEntry[] = [];

  async getNearbyArticles(position: Position, deepMode = false): Promise<WikiArticle[]> {
    const cached = this.getCached(position);
    if (cached) return cached;

    try {
      const articles = await this.fetchGeosearch(position, deepMode);
      this.setCached(position, articles);
      return articles;
    } catch (error) {
      console.warn('[Wikipedia] Geosearch failed:', error);
      return [];
    }
  }

  private getCached(position: Position): WikiArticle[] | null {
    const now = Date.now();
    for (const entry of this.cache) {
      if (now - entry.timestamp > CACHE_TTL_MS) continue;
      const dist = calculateDistance(position.lat, position.lng, entry.lat, entry.lng);
      if (dist <= CACHE_DISTANCE_M) return entry.articles;
    }
    return null;
  }

  private setCached(position: Position, articles: WikiArticle[]) {
    this.cache.push({ lat: position.lat, lng: position.lng, articles, timestamp: Date.now() });
    if (this.cache.length > 10) this.cache.shift();
  }

  private async fetchGeosearch(position: Position, deepMode = false): Promise<WikiArticle[]> {
    const searchRadius = deepMode ? 2000 : SEARCH_RADIUS_M;
    const maxArticles = deepMode ? 10 : MAX_ARTICLES;
    const maxExtract = deepMode ? 1000 : MAX_EXTRACT_CHARS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let data: any;
    try {
      const url =
        `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${position.lat}|${position.lng}` +
        `&gsradius=${searchRadius}&gslimit=20&format=json&origin=*`;
      const res = await fetch(url, { signal: controller.signal });
      data = await res.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn('[Wikipedia] Geosearch timed out');
      }
      return [];
    } finally {
      clearTimeout(timer);
    }

    const results = data?.query?.geosearch;
    if (!Array.isArray(results) || results.length === 0) return [];

    const sorted = results.sort((a: any, b: any) => a.dist - b.dist).slice(0, maxArticles * 2);

    // Fetch extracts for the closest articles in a single batch request.
    const titles = sorted.map((r: any) => r.title).join('|');
    const extractUrl =
      `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|categories&cllimit=5` +
      `&exintro&explaintext&exchars=${maxExtract}&titles=${encodeURIComponent(titles)}&format=json&origin=*`;

    let extractData: any;
    try {
      const extractController = new AbortController();
      const extractTimer = setTimeout(() => extractController.abort(), REQUEST_TIMEOUT_MS);
      const extractRes = await fetch(extractUrl, { signal: extractController.signal });
      extractData = await extractRes.json();
      clearTimeout(extractTimer);
    } catch {
      return [];
    }

    const pages = extractData?.query?.pages;
    if (!pages) return [];

    const articles: WikiArticle[] = [];
    for (const result of sorted) {
      const page = Object.values(pages as Record<string, any>).find(
        (p: any) => p.title === result.title
      );
      if (!page || !page.extract) continue;

      const categories = (page.categories || []).map((c: any) => c.title.toLowerCase());
      const priorityScore = this.scorePriority(categories, result.title);

      articles.push({
        title: result.title,
        extract: page.extract.slice(0, maxExtract),
        distance: result.dist,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title.replace(/ /g, '_'))}`,
        ...({ priorityScore } as any),
      });
    }

    // Sort by priority score (descending), then by distance.
    articles.sort((a, b) => {
      const sa = (a as any).priorityScore || 0;
      const sb = (b as any).priorityScore || 0;
      if (sb !== sa) return sb - sa;
      return a.distance - b.distance;
    });

    return articles.slice(0, maxArticles);
  }

  private scorePriority(categories: string[], title: string): number {
    let score = 0;
    const titleLower = title.toLowerCase();
    for (const cat of categories) {
      for (const keyword of PRIORITY_CATEGORY_KEYWORDS) {
        if (cat.includes(keyword)) {
          score += 10;
          break;
        }
      }
    }
    for (const keyword of PRIORITY_CATEGORY_KEYWORDS) {
      if (titleLower.includes(keyword)) {
        score += 5;
        break;
      }
    }
    return score;
  }

  // Format articles for injection into the Gemini prompt.
  formatForPrompt(articles: WikiArticle[]): string {
    if (articles.length === 0) return '';

    const lines: string[] = ['WIKIPEDIA CONTEXT — real articles about this area (use as factual source, prioritize ones with hidden history, human conflict, or the unseen forces behind the place):'];
    for (const article of articles) {
      lines.push(`- ${article.title} (${Math.round(article.distance)}m away): ${article.extract}`);
    }

    return lines.join('\n');
  }
}

export const wikipedia = new WikipediaService();
