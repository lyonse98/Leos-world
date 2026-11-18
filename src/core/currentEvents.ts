// The current-events layer v1 (v16.2 Slice 2, Nov 16, 2026).
//
// Fresh eat / drink / do candidates near the driver — near the
// route and the destination as anchors — each one carrying
// hours that have passed the freshness standard
// (freshness.ts) before it may be ranked, spoken, or suggested.
// This layer is the profile's first consumer (profile.ts's read
// API exists for exactly this) and the candidate source the
// suggestion slices (4–6) will draw on. It recommends nothing
// itself: it produces a ranked, freshness-verified pool.
//
// ============================================================
// SCOPE — PLACES-ONLY v1 (LEAN, NOT RULED).
// Erik's Nov 14, 2026 lean (stack plan ◆ item 2): v1 rides the
// existing Google Places stack only. An events FEED joins when
// a source proves fresh enough to meet the standard's 48 h
// dated-source rule; none has — Ticketmaster and local
// calendars were surveyed with worse freshness and more
// liability (stack plan, Nov 13). So the feed seam below is a
// designed interface with NO implementation behind it, and the
// honest gap is named here rather than papered over: v1 knows
// what is OPEN, not what is HAPPENING. Feed candidates, when a
// feed exists, enter only through assessEvent() — the gate is
// built and sim-pinned now so a future feed cannot sneak past
// it.
//
// UPDATE (Nov 18, 2026): a feed now exists behind the seam —
// eventsFeed.ts implements it over FREE published iCal
// calendar feeds (Balboa Park + UC San Diego, verified by
// fetch in the Nov 18 source survey; Erik's ruling: free
// sources only, no signup, the Ticketmaster decision is his
// and later). The seam's default below stays NO_EVENTS_FEED:
// no production surface consumes feed events yet, so a caller
// opts into the real provider explicitly. Feed candidates
// still enter only through assessEvent(), exactly as pinned.
//
// INTEGRATION (Nov 18, 2026, later): the opt-in is now wired.
// discoverEventCandidates consumes opts.eventsFeed — gated
// feed events join the same ranked pool as candidates
// carrying their DatedEvent — and the production discovery
// call sites (the freeform Tour's pool refresh, the route
// runner's suggestion supply) pass icalEventsFeed. The
// default stays NO_EVENTS_FEED for any caller that does not
// opt in. Speech fences are untouched: a feed candidate has
// no hours, so openNow is null and the suggestion composer's
// verifiably-open-now pick can never select one in v1.
// ============================================================
//
// Data sources, honestly:
//   - Places (New) searchNearby over eat/drink/do types, with
//     regular/current opening hours + UTC offset in the field
//     mask. Every call walks all configured Google keys (the
//     route-mode discipline — the keys' restriction lists
//     differ per key), with one retry pass when no key
//     answers; the layer fails soft to an empty pool.
//     Hours are cached on-device (below)
//     so a place's schedule is not re-fetched every cycle, and
//     so a provider outage can fall back to cached records —
//     which still must pass the freshness gate at serve time.
//   - Shelf metadata: whether the library carries a story for
//     the place (the consumer injects the key set). A candidate
//     Miles can also TELL about ranks a step above one it
//     cannot — contextual color, never an eligibility rule.
//   - The profile (matchInputs / getConstraints) ranks and
//     filters. Constraints are applied only where Places data
//     actually answers them (alcohol-primary types, with-kids
//     vs bar/nightclub, servesVegetarianFood); a detour-minute
//     constraint is NOT approximated from distance — detour
//     costing belongs to the route consumer, which owns Routes
//     data. In v1 `detourMinutes` is therefore always null.
//
// Everything here fails soft and silent: no key, no network, a
// provider error — the pool is simply empty. The pool is color
// and candidate supply, never a drive-critical path.
//
// Every fetch this layer dispatches is a metered Places ask,
// governed by the live-spend sub-cap (v16.2 Slice 8,
// liveSpend.ts): charged at dispatch against the on-device
// monthly ledger, and not dispatched at all once the month's
// cap stands — discovery then serves from the hours cache
// below, which is the designed degradation, not an error.
// One ask is one anchor's fetch, however many keys its walk
// tries internally (see fetchPlacesWithKeyWalk).

import {
  assessEvent,
  assessHours,
  FRESHNESS_STANDARD,
  type DatedEvent,
  type HoursPeriod,
  type PlaceHoursRecord,
} from './freshness';
import {
  getConstraints,
  matchInputs,
  type MatchInputs,
  type ResolvedConstraints,
} from './profile';
import {
  createSpendGovernor,
  localSpendLedgerStore,
  type SpendEventSink,
  type SpendLedgerStore,
} from './liveSpend';
import {
  configuredKeys,
  MAPS_RETRY_DELAY_MS,
  type MapsCallOptions,
} from './routeMode';
import { calculateDistance } from '../utils/geo';

// ------------------------------------------------------------ candidate model

export type EventCandidateKind = 'eat' | 'drink' | 'do';

export interface EventAnchor {
  lat: number;
  lng: number;
  /** Where the anchor sits in the drive: the driver now, a route point, or the destination. */
  kind: 'position' | 'route' | 'destination';
}

export interface EventCandidate {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  kind: EventCandidateKind;
  types: string[];
  rating: number | null;
  userRatings: number | null;
  address: string | null;
  /** Places editorial summary, when the source gave one — color for consumers. */
  editorial: string | null;
  distanceM: number;
  anchorKind: EventAnchor['kind'];
  /** From the source hours alone (freshness.ts); null = not claimable. */
  openNow: boolean | null;
  closesAtMs: number | null;
  opensAtMs: number | null;
  /** When the hours behind this candidate were fetched — the freshness provenance. */
  hoursFetchedAt: number;
  /** The shelf carries at least one story for this place. */
  hasShelfStory: boolean;
  /** Ranking score (higher = surface sooner). Eligibility is NOT score-based. */
  score: number;
  /** Detour cost in minutes. Null in v1 — see the header. */
  detourMinutes: number | null;
  /**
   * Set only for feed-event candidates (the feed lives in
   * eventsFeed.ts). Pool members since the Nov 18, 2026
   * integration; still unspoken in v1 surfaces — the
   * suggestion composer's pick must be verifiably open now,
   * and an event carries no hours claim (openNow stays null),
   * so feed candidates enrich the pool without a speech path.
   */
  event: DatedEvent | null;
}

/** A place as a provider reports it, before the freshness gate. */
export interface RawPlace {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  types: string[];
  rating: number | null;
  userRatings: number | null;
  address: string | null;
  editorial: string | null;
  servesVegetarianFood: boolean | null;
  hours: PlaceHoursRecord;
}

// ------------------------------------------------------------ providers

export interface PlaceHoursProvider {
  // nowMs is the caller's clock for this fetch (discovery's
  // judgment instant): freshly fetched records are stamped
  // with it, so a record can never read as future-dated
  // against the very pass that fetched it. Mirrors the
  // EventsFeedProvider seam below, which has always taken
  // the clock. Production callers pass discovery's nowMs,
  // which defaults to Date.now() — the stamp is the fetch
  // instant either way.
  fetchPlaces(anchor: EventAnchor, radiusM: number, nowMs?: number): Promise<RawPlace[]>;
}

export interface EventsFeedProvider {
  fetchEvents(anchor: EventAnchor, radiusM: number, nowMs: number): Promise<DatedEvent[]>;
}

/**
 * The seam's default feed: none. This is the designed seam a
 * feed plugs into; a real provider now exists behind it
 * (eventsFeed.ts, Nov 18, 2026 — published iCal feeds), but
 * the default stays empty until a caller opts in explicitly.
 * Any feed's candidates still pass through assessEvent()
 * before they can surface.
 */
export const NO_EVENTS_FEED: EventsFeedProvider = {
  async fetchEvents() {
    return [];
  },
};

/**
 * The configured Google keys for this layer's Places calls,
 * in the App's route-mode order (Places, Maps, Gemini),
 * deduped with blanks dropped — the list the key walk below
 * tries, per call (routeMode.configuredKeys). The bundle's
 * keys carry DIFFERENT API-restriction lists (Nov 3, 2026,
 * probe-verified), so no single key can be "the" Places key:
 * the key named Places may be restriction-blocked for a call
 * another key answers. (facts.ts carries the same walk for
 * freeform discovery since the Slice 9 rider, Nov 17, 2026.)
 */
const placesKeys = (): string[] =>
  configuredKeys(
    [
      import.meta.env.VITE_GOOGLE_PLACES_API_KEY as string | undefined,
      import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined,
      import.meta.env.VITE_GEMINI_API_KEY as string | undefined,
    ].filter((k): k is string => typeof k === 'string'),
  );

/** Eat/drink/do types the layer asks Places about (story types stay facts.ts's list). */
const CANDIDATE_TYPES = [
  'restaurant', 'cafe', 'bakery', 'meal_takeaway', 'ice_cream_shop', 'fast_food_restaurant',
  'bar', 'pub', 'wine_bar', 'brewery', 'coffee_shop', 'tea_house', 'night_club',
  'tourist_attraction', 'museum', 'art_gallery', 'performing_arts_theater', 'movie_theater',
  'park', 'zoo', 'aquarium', 'stadium', 'shopping_mall', 'book_store', 'library', 'marina',
];

interface PlacesHoursWire {
  periods?: { open?: { day?: number; hour?: number; minute?: number }; close?: { day?: number; hour?: number; minute?: number } }[];
}

interface PlacesResultWire {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  formattedAddress?: string;
  editorialSummary?: { text?: string };
  businessStatus?: string;
  utcOffsetMinutes?: number;
  servesVegetarianFood?: boolean;
  regularOpeningHours?: PlacesHoursWire;
  currentOpeningHours?: PlacesHoursWire;
}

function wirePeriods(wire: PlacesHoursWire | undefined): HoursPeriod[] | null {
  if (!wire?.periods) return null;
  const out: HoursPeriod[] = [];
  for (const p of wire.periods) {
    if (!p.open || p.open.day === undefined || p.open.hour === undefined) continue;
    const period: HoursPeriod = {
      open: { day: p.open.day, hour: p.open.hour, minute: p.open.minute ?? 0 },
    };
    if (p.close && p.close.day !== undefined && p.close.hour !== undefined) {
      period.close = { day: p.close.day, hour: p.close.hour, minute: p.close.minute ?? 0 };
    }
    out.push(period);
  }
  return out;
}

/** Map one wire place onto the layer's shape; fetchedAt is stamped at parse. */
function mapWirePlace(p: PlacesResultWire, fetchedAt: number): RawPlace | null {
  const name = p.displayName?.text;
  const lat = p.location?.latitude;
  const lng = p.location?.longitude;
  if (!p.id || !name || lat === undefined || lng === undefined) return null;
  const current = wirePeriods(p.currentOpeningHours);
  const regular = wirePeriods(p.regularOpeningHours);
  // Current hours win when present: they already fold in
  // special-day exceptions the regular week does not know.
  const periods = current ?? regular;
  return {
    placeId: p.id,
    name,
    lat,
    lng,
    types: p.types ?? [],
    rating: p.rating ?? null,
    userRatings: p.userRatingCount ?? null,
    address: p.formattedAddress ?? null,
    editorial: p.editorialSummary?.text ?? null,
    servesVegetarianFood: p.servesVegetarianFood ?? null,
    hours: {
      periods,
      utcOffsetMinutes: p.utcOffsetMinutes ?? null,
      businessStatus: p.businessStatus ?? null,
      hoursKind: current ? 'current' : regular ? 'regular' : null,
      fetchedAt,
      source: 'places',
    },
  };
}

const placesSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * ONE pass of the searchNearby key walk: every configured
 * key in order until one ANSWERS. A key that answers — even
 * with zero places — is definitive: the service itself
 * judged the query, so later keys are not tried for it. A
 * non-OK response (a 403 restriction block above all) or a
 * transport failure moves to the next key, never fails the
 * call. This is routeMode's geocodePass discipline, carried
 * to this layer's call (v16.2 audit fix, Nov 17, 2026 — the
 * layer previously took a single key and returned [] on the
 * first error, so a restriction-blocked first key silently
 * emptied the pool on every drive).
 */
async function searchNearbyPass(
  anchor: EventAnchor,
  radiusM: number,
  keys: string[],
  fetchFn: typeof fetch,
  nowMs?: number,
): Promise<{ places: RawPlace[]; answered: boolean }> {
  for (const key of keys) {
    let res: Response;
    try {
      res = await fetchFn('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.types,places.formattedAddress,places.editorialSummary,places.businessStatus,places.utcOffsetMinutes,places.servesVegetarianFood,places.regularOpeningHours,places.currentOpeningHours',
        },
        body: JSON.stringify({
          includedTypes: CANDIDATE_TYPES,
          maxResultCount: 20,
          rankPreference: 'POPULARITY',
          locationRestriction: {
            circle: {
              center: { latitude: anchor.lat, longitude: anchor.lng },
              radius: radiusM,
            },
          },
        }),
      });
    } catch {
      continue; // transport failure → the next key
    }
    if (!res.ok) continue; // blocked / failed key → the next key
    let parsed: { places?: PlacesResultWire[] };
    try {
      parsed = (await res.json()) as { places?: PlacesResultWire[] };
    } catch {
      continue;
    }
    // Stamped with the caller's clock when one is threaded
    // (see PlaceHoursProvider): the freshness gate judges a
    // record future-dated when fetchedAt > its nowMs, so a
    // parse stamp from a DIFFERENT clock than the judging
    // pass reads as corrupt the moment the two clocks cross.
    const fetchedAt = nowMs ?? Date.now();
    const out: RawPlace[] = [];
    for (const p of parsed.places ?? []) {
      const mapped = mapWirePlace(p, fetchedAt);
      if (mapped) out.push(mapped);
    }
    return { places: out, answered: true };
  }
  return { places: [], answered: false };
}

/**
 * The layer's Places fetch: the key walk above, with ONE
 * retry pass after the maps backoff when NO key answered —
 * geocodeDestination's discipline verbatim (a non-definitive
 * outcome may be one transient failure on the one working
 * key, merged with a standing 403 from a blocked one;
 * definitive outcomes never retry, and no keys never walk).
 * Fail-soft throughout: every key failing both passes is
 * simply an empty result, never an exception.
 *
 * Spend accounting (liveSpend.ts): the governor charges
 * ONE ask per call to this function — the key attempts and
 * the retry pass inside it are NOT separate metered asks.
 * The walk stops at the first key that answers, and denied
 * (403) or transport-failed attempts never become billable
 * Google requests, so one call yields at most one billable
 * request; the per-ask estimate stays the ledger's upper
 * bound (see the liveSpend header).
 */
export async function fetchPlacesWithKeyWalk(
  anchor: EventAnchor,
  radiusM: number,
  apiKeys: string[],
  fetchFn: typeof fetch = fetch,
  opts: MapsCallOptions & { nowMs?: number } = {},
): Promise<RawPlace[]> {
  const keys = configuredKeys(apiKeys);
  if (keys.length === 0) return [];
  const first = await searchNearbyPass(anchor, radiusM, keys, fetchFn, opts.nowMs);
  if (first.answered) return first.places;
  await (opts.sleep ?? placesSleep)(opts.retryDelayMs ?? MAPS_RETRY_DELAY_MS);
  const second = await searchNearbyPass(anchor, radiusM, keys, fetchFn, opts.nowMs);
  return second.places;
}

/** The real provider: Places (New), walking every configured key (above). */
export const googlePlacesHoursProvider: PlaceHoursProvider = {
  async fetchPlaces(anchor, radiusM, nowMs) {
    return fetchPlacesWithKeyWalk(anchor, radiusM, placesKeys(), undefined, { nowMs });
  },
};

// ------------------------------------------------------------ hours cache
// On-device, mirroring the profile store pattern: a raw-string
// store seam, a size cap, fail-soft everywhere. The cache holds
// the last-seen RawPlace per place id so hours survive between
// cycles; freshness is judged at READ time against the
// standard, never assumed from the cache's say-so. Entries too
// old to ever pass the gate again are pruned on write.

export interface HoursCacheStore {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

export const HOURS_CACHE_KEY = 'leo_place_hours_cache';
const MAX_CACHE_ENTRIES = 300;
const MAX_CACHE_CHARS = 512_000;

export const localHoursCacheStore: HoursCacheStore = {
  read() {
    try {
      return localStorage.getItem(HOURS_CACHE_KEY);
    } catch {
      return null;
    }
  },
  write(value: string) {
    try {
      localStorage.setItem(HOURS_CACHE_KEY, value);
    } catch {
      /* storage unavailable — the cache is a nicety, never a failure */
    }
  },
  clear() {
    try {
      localStorage.removeItem(HOURS_CACHE_KEY);
    } catch {
      /* ignore */
    }
  },
};

interface HoursCacheDoc {
  v: 1;
  entries: Record<string, RawPlace>;
}

function parseCache(raw: string | null): HoursCacheDoc {
  if (!raw || raw.length > MAX_CACHE_CHARS) return { v: 1, entries: {} };
  try {
    const doc = JSON.parse(raw) as HoursCacheDoc;
    if (doc?.v !== 1 || typeof doc.entries !== 'object' || doc.entries === null) return { v: 1, entries: {} };
    return doc;
  } catch {
    return { v: 1, entries: {} };
  }
}

export function loadHoursCache(store: HoursCacheStore = localHoursCacheStore): Map<string, RawPlace> {
  return new Map(Object.entries(parseCache(store.read()).entries));
}

/** Record fetched places; prune entries the standard can never pass again. */
export function cachePlaces(
  places: readonly RawPlace[],
  store: HoursCacheStore = localHoursCacheStore,
  nowMs: number = Date.now(),
): void {
  if (places.length === 0) return;
  const doc = parseCache(store.read());
  for (const p of places) doc.entries[p.placeId] = p;
  const fresh = Object.values(doc.entries).filter(
    p => nowMs - p.hours.fetchedAt <= FRESHNESS_STANDARD.hoursMaxCacheAgeMs,
  );
  fresh.sort((a, b) => b.hours.fetchedAt - a.hours.fetchedAt);
  const kept = fresh.slice(0, MAX_CACHE_ENTRIES);
  try {
    store.write(JSON.stringify({ v: 1, entries: Object.fromEntries(kept.map(p => [p.placeId, p])) } satisfies HoursCacheDoc));
  } catch {
    /* a cache write is never a failure */
  }
}

// ------------------------------------------------------------ classification + profile match

const ALCOHOL_TYPES = ['bar', 'pub', 'wine_bar', 'brewery', 'liquor_store', 'night_club'];
const EAT_TYPES = ['restaurant', 'cafe', 'bakery', 'meal_takeaway', 'meal_delivery', 'food', 'ice_cream_shop', 'sandwich_shop', 'fast_food_restaurant'];
const COFFEE_TYPES = ['coffee_shop', 'tea_house'];
const DO_TYPES = ['tourist_attraction', 'museum', 'art_gallery', 'performing_arts_theater', 'movie_theater', 'park', 'zoo', 'aquarium', 'stadium', 'shopping_mall', 'book_store', 'library', 'marina', 'event_venue'];

/** The candidate kind a place's Places types earn it, or null (not eat/drink/do supply). */
export function kindForTypes(types: readonly string[]): EventCandidateKind | null {
  if (types.some(t => ALCOHOL_TYPES.includes(t))) return 'drink';
  if (types.some(t => EAT_TYPES.includes(t) || t.endsWith('_restaurant'))) return 'eat';
  if (types.some(t => COFFEE_TYPES.includes(t))) return 'drink';
  if (types.some(t => DO_TYPES.includes(t))) return 'do';
  return null;
}

const CUISINE_TYPE_FRAGMENTS: Record<string, string[]> = {
  'tacos-mexican': ['mexican'],
  seafood: ['seafood'],
  bbq: ['barbecue', 'bbq'],
  italian: ['italian'],
  asian: ['asian', 'japanese', 'chinese', 'thai', 'korean', 'vietnamese', 'indian', 'sushi'],
  'coffee-bakery': ['coffee_shop', 'cafe', 'bakery'],
};

const DRINK_TYPE_FRAGMENTS: Record<string, string[]> = {
  coffee: ['coffee_shop', 'cafe', 'tea_house'],
  beer: ['bar', 'pub', 'brewery'],
  wine: ['wine_bar', 'bar', 'winery'],
  cocktails: ['bar', 'cocktail_bar'],
  // 'no-alcohol' is a preference against, not a match for — no positive signal.
};

const ACTIVITY_TYPE_FRAGMENTS: Record<string, string[]> = {
  'live-music': ['performing_arts_theater', 'event_venue'],
  'history-museums': ['museum', 'art_gallery', 'library'],
  'outdoors-views': ['park', 'marina', 'tourist_attraction'],
  sports: ['stadium'],
  markets: ['shopping_mall', 'market'],
  nightlife: ['night_club', 'bar', 'pub'],
  // 'weird-local-lore' has no Places-type signal; it matches nothing, honestly.
};

function matchesAny(types: readonly string[], fragments: readonly string[]): boolean {
  return types.some(t => fragments.some(f => t === f || t.includes(f)));
}

/**
 * The declared taste option ids (profile vocabulary: a cuisine,
 * a drink, an activity) this place's types actually match —
 * the evidence behind profileMatchScore, exported so a
 * consumer (the suggestion composer, Slice 4) can NAME the
 * match in its spoken reason instead of claiming a match it
 * cannot point to. Order: cuisines, drinks, activities.
 */
export function matchedTasteIds(types: readonly string[], match: MatchInputs): string[] {
  const out: string[] = [];
  for (const c of match.cuisines) {
    const frags = CUISINE_TYPE_FRAGMENTS[c];
    if (frags && matchesAny(types, frags)) out.push(c);
  }
  for (const d of match.drinks) {
    const frags = DRINK_TYPE_FRAGMENTS[d];
    if (frags && matchesAny(types, frags)) out.push(d);
  }
  for (const a of match.activities) {
    const frags = ACTIVITY_TYPE_FRAGMENTS[a];
    if (frags && matchesAny(types, frags)) out.push(a);
  }
  return out;
}

/** How strongly the declared profile tastes match this place (0 when neutral). */
export function profileMatchScore(types: readonly string[], match: MatchInputs): number {
  return Math.min(matchedTasteIds(types, match).length * PROFILE_MATCH_POINTS, PROFILE_MATCH_CAP);
}

const PROFILE_MATCH_POINTS = 12;
const PROFILE_MATCH_CAP = 24;
const SHELF_BONUS = 5;
const OPEN_NOW_BONUS = 10;
const CLOSED_NOW_PENALTY = 15;

/**
 * The type-based half of the constraint filters: everything
 * that can be judged from a place's Places types alone.
 * Exported separately because a bare EventCandidate (the
 * pool's shape) carries types but not the provider record —
 * the suggestion composer (Slice 4) re-judges the pool with
 * this at answer time, so a constraint is enforced at the
 * moment of the claim, not only at discovery.
 */
export function typesSurviveConstraints(
  types: readonly string[],
  constraints: ResolvedConstraints,
): boolean {
  const alcoholPrimary = types.some(t => ALCOHOL_TYPES.includes(t));
  if (constraints.alcoholOk === false && alcoholPrimary) return false;
  if (constraints.usuallyWithKids === true && types.some(t => t === 'bar' || t === 'night_club')) return false;
  return true;
}

/**
 * Declared-constraint filters, applied only where the data
 * answers them (see the header). Returns true when the place
 * survives. Unknown data never filters a place out — the layer
 * does not guess in either direction.
 */
export function survivesConstraints(
  raw: RawPlace,
  kind: EventCandidateKind,
  constraints: ResolvedConstraints,
): boolean {
  if (!typesSurviveConstraints(raw.types, constraints)) return false;
  if (
    kind === 'eat' &&
    constraints.dietary.includes('vegetarian') &&
    raw.servesVegetarianFood === false
  ) {
    return false;
  }
  return true;
}

// ------------------------------------------------------------ discovery

export interface DiscoverEventOptions {
  nowMs?: number;
  radiusM?: number;
  provider?: PlaceHoursProvider;
  /** Defaults to NO_EVENTS_FEED; pass eventsFeed.ts's icalEventsFeed to opt in. */
  eventsFeed?: EventsFeedProvider;
  /** Ranking inputs; default = the live profile reads (the layer is its first consumer). */
  match?: MatchInputs;
  constraints?: ResolvedConstraints;
  /** Place keys (backend dialect) the shelf carries stories for; null = unknown, no bonus. */
  shelfKeys?: ReadonlySet<string> | null;
  /** Hours cache: written on fetch, read on provider-empty fallback. Null disables. */
  cache?: HoursCacheStore | null;
  /**
   * Live-spend governance (v16.2 Slice 8, liveSpend.ts): the
   * ledger every Places ask in this discovery is charged to.
   * Default = the shipped on-device ledger — governance is
   * the layer's behavior, not an option a caller can forget.
   */
  spendStore?: SpendLedgerStore;
  /**
   * Spend telemetry sink: the engines wire their emit path
   * here so asks, cap-trips, and degraded discoveries land
   * on the existing capture. Absent = the accounting still
   * happens; it is simply not filed from this call.
   */
  onSpendEvent?: SpendEventSink;
  maxResults?: number;
}

const DEFAULT_RADIUS_M = 1200;
const DEFAULT_MAX_RESULTS = 12;

/** backend.normalizePlaceKey, mirrored (partners.ts precedent: data modules stay backend-free). */
function shelfPlaceKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, ' ');
}

function toCandidate(
  raw: RawPlace,
  anchor: EventAnchor,
  nowMs: number,
  match: MatchInputs,
  shelfKeys: ReadonlySet<string> | null,
): EventCandidate | null {
  const kind = kindForTypes(raw.types);
  if (!kind) return null;
  const assessment = assessHours(raw.hours, nowMs);
  if (!assessment.eligible) return null; // the standard: silently ineligible, never guessed
  const popularity =
    raw.rating !== null
      ? (raw.rating - 3.5) * 20 + Math.min(20, Math.log10((raw.userRatings ?? 0) + 1) * 8)
      : 0;
  const distanceM = calculateDistance(anchor.lat, anchor.lng, raw.lat, raw.lng);
  const hasShelfStory = shelfKeys !== null && shelfKeys.has(shelfPlaceKey(raw.name));
  let score = popularity - distanceM / 90 + profileMatchScore(raw.types, match);
  if (hasShelfStory) score += SHELF_BONUS;
  if (assessment.openNow === true) score += OPEN_NOW_BONUS;
  if (assessment.openNow === false) score -= CLOSED_NOW_PENALTY;
  return {
    placeId: raw.placeId,
    name: raw.name,
    lat: raw.lat,
    lng: raw.lng,
    kind,
    types: raw.types,
    rating: raw.rating,
    userRatings: raw.userRatings,
    address: raw.address,
    editorial: raw.editorial,
    distanceM,
    anchorKind: anchor.kind,
    openNow: assessment.openNow,
    closesAtMs: assessment.closesAtMs,
    opensAtMs: assessment.opensAtMs,
    hoursFetchedAt: raw.hours.fetchedAt,
    hasShelfStory,
    score,
    detourMinutes: null,
    event: null,
  };
}

/**
 * One gated feed event as a pool candidate. The event is the
 * candidate (its title is the label; the venue rides in the
 * payload and the address), kind is always 'do', and there is
 * no hours claim to make — openNow stays null, which is also
 * the speech fence: the suggestion composer's pick must be
 * verifiably open now, so a feed candidate can enrich the
 * pool but can never be spoken by the v1 surfaces. Scoring
 * mirrors the places scale minus everything an event cannot
 * claim: no popularity (no rating), no open-now bonus — just
 * distance and the shelf bonus when the shelf carries the
 * venue's story. Eligibility was judged by assessEvent
 * before this conversion (see discoverEventCandidates), so
 * sourceAtMs is a real, gate-fresh date here.
 */
function feedEventCandidate(
  ev: DatedEvent,
  anchor: EventAnchor,
  distanceM: number,
  shelfKeys: ReadonlySet<string> | null,
): EventCandidate | null {
  // A pool candidate is a point on the map; an event the
  // feed could not place (no GEO, geocode unresolvable) was
  // already excluded by the provider, and the seam does not
  // trust that — no coordinates, no candidate, never guessed.
  if (ev.lat == null || ev.lng == null) return null;
  const hasShelfStory =
    shelfKeys !== null && ev.venueName != null && shelfKeys.has(shelfPlaceKey(ev.venueName));
  let score = -distanceM / 90;
  if (hasShelfStory) score += SHELF_BONUS;
  return {
    placeId: `feed:${ev.sourceName}:${ev.title}:${ev.startsAtMs}`,
    name: ev.title,
    lat: ev.lat,
    lng: ev.lng,
    kind: 'do',
    types: [],
    rating: null,
    userRatings: null,
    address: ev.address ?? null,
    editorial: null,
    distanceM,
    anchorKind: anchor.kind,
    openNow: null,
    closesAtMs: null,
    opensAtMs: null,
    hoursFetchedAt: ev.sourceAtMs ?? 0,
    hasShelfStory,
    score,
    detourMinutes: null,
    event: ev,
  };
}

/**
 * The layer's one entry point: ranked, freshness-verified
 * eat/drink/do candidates near the given anchors. Anchors are
 * tried in order; a place found from several anchors is kept
 * once, judged from its nearest. Every returned place
 * candidate has passed assessHours at `nowMs`; every
 * candidate also carries its hours' fetchedAt so a consumer
 * can see the provenance of the claim it is about to make.
 * When the caller opts into a feed (opts.eventsFeed), gated
 * feed events join the same pool as candidates whose `event`
 * payload is set — they have passed assessEvent at `nowMs`
 * instead, and their provenance is the event's source date.
 */
export async function discoverEventCandidates(
  anchors: readonly EventAnchor[],
  opts: DiscoverEventOptions = {},
): Promise<EventCandidate[]> {
  const nowMs = opts.nowMs ?? Date.now();
  const radiusM = opts.radiusM ?? DEFAULT_RADIUS_M;
  const provider = opts.provider ?? googlePlacesHoursProvider;
  const match = opts.match ?? matchInputs();
  const constraints = opts.constraints ?? getConstraints();
  const shelfKeys = opts.shelfKeys ?? null;
  const cache = opts.cache === undefined ? localHoursCacheStore : opts.cache;

  const byPlace = new Map<string, { raw: RawPlace; anchor: EventAnchor; distanceM: number }>();
  const consider = (raw: RawPlace, anchor: EventAnchor) => {
    const distanceM = calculateDistance(anchor.lat, anchor.lng, raw.lat, raw.lng);
    if (distanceM > radiusM) return;
    const existing = byPlace.get(raw.placeId);
    if (!existing || distanceM < existing.distanceM) byPlace.set(raw.placeId, { raw, anchor, distanceM });
  };

  // Live-spend governance (Slice 8): each anchor's fetch is
  // one metered ask, charged at dispatch by the governor.
  // A blocked ask is simply not dispatched — the anchor
  // contributes nothing, and if every ask is blocked the
  // provider-empty cache fallback below is the degradation
  // path: cached records, freshness-gated at serve time as
  // always. An ask already dispatched when the cap trips
  // completes normally (the governor never recalls one).
  const governor = createSpendGovernor({
    store: opts.spendStore ?? localSpendLedgerStore,
    nowMs,
    onEvent: opts.onSpendEvent,
  });
  let spendBlocked = false;
  let fetchedAny = false;
  for (const anchor of anchors) {
    if (governor.beginPlacesAsk() === null) {
      spendBlocked = true;
      continue;
    }
    let places: RawPlace[] = [];
    try {
      places = await provider.fetchPlaces(anchor, radiusM, nowMs);
    } catch {
      places = [];
    }
    if (places.length > 0) {
      fetchedAny = true;
      if (cache) cachePlaces(places, cache, nowMs);
      for (const raw of places) consider(raw, anchor);
    }
  }
  if (spendBlocked) {
    opts.onSpendEvent?.('live_spend_degraded', {
      reason: 'spend-cap',
      month_micro_usd: governor.monthMicroUsd(),
      cap_micro_usd: governor.capMicroUsd,
    });
  }
  // Provider-empty fallback: cached records near the anchors —
  // still gated at serve time below, so a stale cache entry is
  // exactly as ineligible as a stale fetch.
  if (!fetchedAny && cache) {
    const cached = loadHoursCache(cache);
    for (const anchor of anchors) {
      for (const raw of cached.values()) consider(raw, anchor);
    }
  }

  const out: EventCandidate[] = [];
  for (const { raw, anchor } of byPlace.values()) {
    const kind = kindForTypes(raw.types);
    if (!kind) continue;
    if (!survivesConstraints(raw, kind, constraints)) continue;
    const candidate = toCandidate(raw, anchor, nowMs, match, shelfKeys);
    if (candidate) out.push(candidate);
  }

  // Feed events, when the caller opted in (opts.eventsFeed):
  // the same pool, entered only through assessEvent — the
  // gate discoverFeedEvents applies — judged from the
  // nearest anchor like a place, deduped across anchors.
  // Fail-soft throughout, and independent of the Places
  // pass: a spend-blocked or empty places discovery does not
  // starve the feed, and a dead feed costs the pool nothing.
  if (opts.eventsFeed) {
    const feed = opts.eventsFeed;
    const byEvent = new Map<string, { candidate: EventCandidate; distanceM: number }>();
    for (const anchor of anchors) {
      let events: DatedEvent[] = [];
      try {
        events = await feed.fetchEvents(anchor, radiusM, nowMs);
      } catch {
        events = [];
      }
      for (const ev of events) {
        if (!assessEvent(ev, nowMs).eligible) continue;
        if (ev.lat == null || ev.lng == null) continue;
        const distanceM = calculateDistance(anchor.lat, anchor.lng, ev.lat, ev.lng);
        if (distanceM > radiusM) continue;
        const candidate = feedEventCandidate(ev, anchor, distanceM, shelfKeys);
        if (!candidate) continue;
        const existing = byEvent.get(candidate.placeId);
        if (!existing || distanceM < existing.distanceM) {
          byEvent.set(candidate.placeId, { candidate, distanceM });
        }
      }
    }
    for (const { candidate } of byEvent.values()) out.push(candidate);
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, opts.maxResults ?? DEFAULT_MAX_RESULTS);
}

/**
 * Feed-event candidates near the anchors, gated by
 * assessEvent(). Defaults to NO_EVENTS_FEED (always empty);
 * it exists so the gate — not a future integrator's care — is
 * what stands between a feed and the listener.
 */
export async function discoverFeedEvents(
  anchors: readonly EventAnchor[],
  opts: DiscoverEventOptions = {},
): Promise<DatedEvent[]> {
  const feed = opts.eventsFeed ?? NO_EVENTS_FEED;
  const nowMs = opts.nowMs ?? Date.now();
  const radiusM = opts.radiusM ?? DEFAULT_RADIUS_M;
  const out: DatedEvent[] = [];
  for (const anchor of anchors) {
    let events: DatedEvent[] = [];
    try {
      events = await feed.fetchEvents(anchor, radiusM, nowMs);
    } catch {
      events = [];
    }
    for (const ev of events) {
      if (assessEvent(ev, nowMs).eligible) out.push(ev);
    }
  }
  out.sort((a, b) => a.startsAtMs - b.startsAtMs);
  return out;
}
