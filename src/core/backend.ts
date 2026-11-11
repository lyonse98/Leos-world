// Backend access for the fresh shell — one module for everything the
// shell reads or writes outside itself: the Supabase tables and the
// tts-audio bucket (spec §8A contracts), the analytics event sink
// (spec §8), and the on-device pinned-audio cache (contract D).
//
// Posture: the public anon key only. story_library is read + append
// (the shell reads it, and appends only route gap-story promotions —
// see ingestRouteGapStory), analytics is insert-only, story_likes is
// insert-only, heard_stories is scoped to the device key.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LEO_MODEL_ID, LEO_PERSONA_VERSION } from '../services/leoPersona';
import { TTS_VOICE } from './gemini';

declare const __BUILD_ID__: string;

/** Build identifier stamped on every analytics event (contract E). */
export const BUILD_ID = `fresh-${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'}`;

const url = import.meta.env.VITE_MILES_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_MILES_SUPABASE_ANON_KEY as string | undefined;

const BACKEND_CONFIGURED = Boolean(url && anon);

const db: SupabaseClient = createClient(
  BACKEND_CONFIGURED ? (url as string) : 'https://placeholder.supabase.co',
  BACKEND_CONFIGURED ? (anon as string) : 'placeholder-key',
);

const BUCKET = 'tts-audio';

/** Public URL for a bucket object key. */
export function bucketUrl(path: string): string {
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// ------------------------------------------------------------ storage keys

const LS = {
  activeSession: 'leo_active_session',
  sessionId: 'leo_session_id',
  userKey: 'leo_user_key',
  dayState: 'leo_day_state',
  coverage: 'leo_story_coverage',
  toldTopics: 'leo_told_topics',
  recentStories: 'leo_recent_stories',
  recentSubjects: 'leo_major_subjects',
  libraryPlaceKeys: 'leo_library_place_keys',
  lastIntroIndex: 'leo_last_intro_index',
  openersPlayed: 'leo_openers_played',
  stallPhrasesPlayed: 'leo_stall_phrases_played',
  storiesSinceLastAd: 'leo_stories_since_last_ad',
  installNudgeSeen: 'leo_install_nudge_seen',
  spotifyPrompted: 'leo_spotify_prompted',
  routeDrives: 'leo_route_drives',
  introFormHistory: 'leo_intro_form_history',
  lastTourStartAt: 'leo_last_tour_start_at',
  daypartGreetingsPlayed: 'leo_daypart_greetings_played',
  callbackNext: 'leo_callback_next',
} as const;

export function lsGet(key: keyof typeof LS): string | null {
  try {
    return localStorage.getItem(LS[key]);
  } catch {
    return null;
  }
}

export function lsSet(key: keyof typeof LS, value: string): void {
  try {
    localStorage.setItem(LS[key], value);
  } catch {
    /* storage unavailable — the shell degrades, never dies */
  }
}

export function lsDel(key: keyof typeof LS): void {
  try {
    localStorage.removeItem(LS[key]);
  } catch {
    /* ignore */
  }
}

export function lsJson<T>(key: keyof typeof LS): T | null {
  const raw = lsGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function lsJsonSet(key: keyof typeof LS, value: unknown): void {
  try {
    lsSet(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Device identity for heard_stories (contract D), minted once. */
export function deviceKey(): string {
  let key = lsGet('userKey');
  if (!key) {
    key = `leo-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    lsSet('userKey', key);
  }
  return key;
}

// ------------------------------------------------------------ story library

export interface LibraryRow {
  place_key: string;
  place_name: string;
  angle: string;
  lat: number;
  lng: number;
  story_text: string;
  audio_path: string;
  persona_version: string;
  model: string;
  voice: string;
  created_at: string;
}

export interface LibraryIndexEntry {
  place_key: string;
  place_name: string;
  angle: string;
  lat: number;
  lng: number;
}

/** place_key normalization: lowercase, trimmed (§8A). */
export function placeKeyOf(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * The library-identity normalization the shelf's rows were WRITTEN
 * with (A's normalizePlaceKey, shared verbatim with the library
 * builder): trimmed, lowercase, periods/apostrophes removed,
 * whitespace collapsed — "U.S. Grant Hotel" and "US Grant Hotel"
 * are the same place there. Distinct from placeKeyOf (the shell's
 * §8A subject rule): a row lookup must speak the writer's dialect
 * or a punctuated name silently misses its row.
 */
export function normalizePlaceKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * The library index (no story text): one light fetch makes library
 * lookup local for the whole tour — spec S4/S5 place-first serving
 * without a network round-trip per serve. Cached to
 * leo_library_place_keys so a warm start works before the fetch lands.
 */
export async function fetchLibraryIndex(): Promise<LibraryIndexEntry[]> {
  if (!BACKEND_CONFIGURED) return [];
  const { data, error } = await db
    .from('story_library')
    .select('place_key, place_name, angle, lat, lng')
    .limit(5000);
  if (error || !data) return [];
  const rows = data as LibraryIndexEntry[];
  lsJsonSet('libraryPlaceKeys', rows.map(r => r.place_key));
  return rows;
}

/** One full library row (text + audio path) by primary key. */
export async function fetchLibraryRow(placeKey: string, angle: string): Promise<LibraryRow | null> {
  if (!BACKEND_CONFIGURED) return null;
  const { data, error } = await db
    .from('story_library')
    .select('*')
    .eq('place_key', placeKey)
    .eq('angle', angle)
    .maybeSingle();
  if (error || !data) return null;
  return data as LibraryRow;
}

/**
 * The banked neighborhood intro for an area: the story_library row
 * keyed (normalizePlaceKey(areaName), 'neighborhood_intro') — the
 * same lookup A's serve performs for mid-tour area entries. Null
 * when the shelf holds no intro for the area (or the read fails);
 * the caller falls back to live generation.
 */
export async function fetchIntroRow(areaName: string): Promise<LibraryRow | null> {
  return fetchLibraryRow(normalizePlaceKey(areaName), 'neighborhood_intro');
}

/** The two intro variants an area may hold on the shelf (Nov 1). */
export interface IntroRows {
  /** The plain intro: angle 'neighborhood_intro'. */
  plain: LibraryRow | null;
  /** The greeting intro: angle 'neighborhood_intro_greet' — the plain body behind a greeting line, rendered as its own row. */
  greet: LibraryRow | null;
}

/**
 * Both intro variants for an area in ONE query (Nov 1): the
 * welcome serve chooses between them by the listener's cross-day
 * heard state (first entry → greeting variant; re-entry → plain),
 * and the choice must not cost a second round trip on the serve
 * path. Either side is null when the shelf holds no such row.
 */
export async function fetchIntroRows(areaName: string): Promise<IntroRows> {
  if (!BACKEND_CONFIGURED) return { plain: null, greet: null };
  const { data, error } = await db
    .from('story_library')
    .select('*')
    .eq('place_key', normalizePlaceKey(areaName))
    .in('angle', ['neighborhood_intro', 'neighborhood_intro_greet']);
  if (error || !data) return { plain: null, greet: null };
  const rows = data as LibraryRow[];
  return {
    plain: rows.find(r => r.angle === 'neighborhood_intro') ?? null,
    greet: rows.find(r => r.angle === 'neighborhood_intro_greet') ?? null,
  };
}

/**
 * The HOSTED filler pool (Nov 2, 2026): story_library rows with
 * angle = 'filler_hosted' — bridge + story merged into one authored
 * segment, location-agnostic by design. story_text rides along so
 * the lane can estimate each segment's duration from its word
 * count. Invisible to A·Leo: the avatar lane reads only 'filler'.
 */
export async function fetchHostedFillerRows(): Promise<
  { place_key: string; place_name: string; audio_path: string; story_text: string }[]
> {
  if (!BACKEND_CONFIGURED) return [];
  const { data, error } = await db
    .from('story_library')
    .select('place_key, place_name, audio_path, story_text')
    .eq('angle', 'filler_hosted')
    .limit(500);
  if (error || !data) return [];
  return data as { place_key: string; place_name: string; audio_path: string; story_text: string }[];
}

/** The filler pool: story_library rows with angle = 'filler' (§8A). */
export async function fetchFillerRows(): Promise<
  { place_key: string; place_name: string; audio_path: string }[]
> {
  if (!BACKEND_CONFIGURED) return [];
  const { data, error } = await db
    .from('story_library')
    .select('place_key, place_name, audio_path')
    .eq('angle', 'filler')
    .limit(500);
  if (error || !data) return [];
  return data as { place_key: string; place_name: string; audio_path: string }[];
}

// ------------------------------------------------------------ shared story cache (tour_stories)

export interface CachedStory {
  topic: string;
  story_text: string;
  lat: number;
  lng: number;
  /** The row's own creation time (Q9 honest age for cache serves). */
  created_at: string | null;
}

/**
 * Nearest shared-cache story near a point for the current persona
 * version, via the backend's own proximity function (§8A: the
 * ephemeral cache is keyed by persona version).
 */
export async function findCachedStory(
  lat: number,
  lng: number,
  radiusM: number,
  personaVersion: string,
): Promise<CachedStory | null> {
  if (!BACKEND_CONFIGURED) return null;
  const { data, error } = await db.rpc('find_nearby_cached_story', {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: Math.round(radiusM),
    p_version_key: personaVersion,
  });
  if (error || !data || data.length === 0) return null;
  const row = data[0] as { story_text: string; topic: string; created_at?: string };
  if (!row.story_text) return null;
  // SHARED-CACHE CONTAINMENT (Miles edition): tour_stories is shared
  // with the live Leo build. A cached text in which the guide
  // introduces himself as Leo must never be served by this build —
  // it reads as a cache MISS and the story is generated fresh under
  // the Miles persona. (The screen applies only to this ephemeral
  // cache, never to the curated library: real people and places
  // named Leo, e.g. Leo Carrillo, are content, not self-reference.)
  if (SELF_REFERENCE_LEO.test(row.story_text)) return null;
  return { topic: row.topic, story_text: row.story_text, lat, lng, created_at: row.created_at ?? null };
}

/** First-person Leo self-references a shared-cache row may carry. */
const SELF_REFERENCE_LEO = /\bI['’]m Leo\b|\bI am Leo\b|\bmy name is Leo\b|\bthis is Leo\b/i;

/**
 * Write a freshly generated story into the shared cache.
 *
 * SHARED-CACHE CONTAINMENT (Miles edition): this build deliberately
 * does NOT write back. Its live generations speak as Miles; the
 * shared tour_stories cache is read by the live Leo build, which
 * must never serve a Miles-voiced text. The seam stays (the tour
 * calls it uniformly); the write is suppressed here, in one place.
 */
export async function putCachedStory(
  sessionId: string,
  topic: string,
  storyText: string,
  lat: number,
  lng: number,
  personaVersion: string,
): Promise<void> {
  void sessionId;
  void topic;
  void storyText;
  void lat;
  void lng;
  void personaVersion;
  return;
}

/**
 * Shelf promotion for a route-mode gap story (Coverage Guarantee,
 * Nov 3, 2026): a story generated at plan time for a bare stretch
 * — already style-gated by the caller — is written into
 * story_library so future builds serve it from the shelf. This is
 * NOT the shared tour_stories cache above (that containment
 * stands): story_library is the shared shelf both editions read,
 * and its rows are Miles-voiced library content by construction
 * (persona leo-v14, voice Puck — the same voice the shelf's
 * renders carry).
 *
 * The audio lands under a FRESH storage key carrying the
 * -route-gap-v1 marker (the library ingest dialect:
 * library/<place_key>/<angle>-…-route-gap-v1.wav) so these rows
 * stay findable; the row insert is ignore-duplicates on
 * (place_key, angle), matching the library tooling's Prefer
 * header. Resolves the stored audio path when the upload landed
 * (the caller plays the unit from the bucket; the row insert is
 * best-effort behind it), null on any failure — ingest failure
 * never affects the tour.
 *
 * Audience coloring (Nov 5, 2026): the GENERATING RATING is
 * stamped into the key — a story generated under Family is
 * promoted under the -route-gap-fam-v1 marker, everything
 * else under the standing -route-gap-v1. The key is the one
 * field that survives promotion, so it is where the stamp
 * lives: future builds read it back off the row's audio_path
 * (routeMode.generatedRatingForAudioPath), and a Family build
 * treats a Standard-stamped row as gray-zone fixed audio.
 */
export async function ingestRouteGapStory(args: {
  /** Writer-dialect place key (normalizePlaceKey) — the row's identity. */
  placeKey: string;
  placeName: string;
  angle: string;
  lat: number;
  lng: number;
  storyText: string;
  audio: Blob;
  /** The rating the story was generated under (audience coloring); absent = 'standard'. */
  rating?: 'standard' | 'family';
}): Promise<string | null> {
  if (!BACKEND_CONFIGURED) return null;
  const discriminator = Math.random().toString(36).slice(2, 8);
  const marker = args.rating === 'family' ? '-route-gap-fam-v1' : '-route-gap-v1';
  const audioPath = `library/${args.placeKey}/${args.angle}-${discriminator}${marker}.wav`;
  try {
    const { error: uploadError } = await db.storage
      .from(BUCKET)
      .upload(audioPath, args.audio, { contentType: 'audio/wav', upsert: false });
    if (uploadError) return null;
    await db.from('story_library').upsert(
      {
        place_key: args.placeKey,
        place_name: args.placeName,
        angle: args.angle,
        lat: args.lat,
        lng: args.lng,
        story_text: args.storyText,
        audio_path: audioPath,
        persona_version: LEO_PERSONA_VERSION,
        model: LEO_MODEL_ID,
        voice: TTS_VOICE,
      },
      { onConflict: 'place_key,angle', ignoreDuplicates: true },
    );
    return audioPath;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ heard ledger + likes

export async function fetchHeardTopics(userKey: string, limit = 500): Promise<string[]> {
  if (!BACKEND_CONFIGURED) return [];
  const { data, error } = await db
    .from('heard_stories')
    .select('topic')
    .eq('user_key', userKey)
    .order('told_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as { topic: string }[]).map(r => r.topic);
}

/**
 * The heard ledger's filed story texts (route mode's
 * story-level heard derivation, composer v3.1): the same rows
 * fetchHeardTopics reads, projected to each telling's verbatim
 * story text — the only (place, angle)-identifying evidence
 * the ledger holds (recordHeard files it on every telling).
 * Read-side only: the ledger's shape is unchanged and
 * freeform never calls this.
 */
export async function fetchHeardStoryTexts(userKey: string, limit = 500): Promise<string[]> {
  if (!BACKEND_CONFIGURED) return [];
  const { data, error } = await db
    .from('heard_stories')
    .select('story_text')
    .eq('user_key', userKey)
    .order('told_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as { story_text: string | null }[])
    .map(r => r.story_text)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
}

export async function recordHeard(
  sessionId: string,
  userKey: string,
  topic: string,
  storyText: string | null,
  lat: number | null,
  lng: number | null,
): Promise<void> {
  if (!BACKEND_CONFIGURED) return;
  try {
    await db.from('heard_stories').insert({
      session_id: sessionId,
      user_key: userKey,
      topic,
      story_text: storyText,
      lat,
      lng,
    });
  } catch {
    /* best-effort */
  }
}

export async function recordLike(
  sessionId: string,
  topic: string,
  storyText: string | null,
  lat: number,
  lng: number,
): Promise<void> {
  if (!BACKEND_CONFIGURED) return;
  try {
    await db.from('story_likes').insert({
      topic,
      story_text: storyText,
      lat,
      lng,
      session_id: sessionId,
    });
  } catch {
    /* best-effort */
  }
}

// ------------------------------------------------------------ analytics (spec §8)

export interface EventContext {
  lat: number | null;
  lng: number | null;
  movementMode: string | null;
}

/**
 * Insert one analytics event. The payload carries the §8 scorecard
 * fields plus build_id and tour_id on every event (the grading view's
 * allowlist keys). Insert-only; failures are swallowed — telemetry
 * must never break a tour.
 */
export async function emitEvent(
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
  ctx: EventContext,
): Promise<void> {
  if (!BACKEND_CONFIGURED) return;
  try {
    await db.from('analytics_events').insert({
      session_id: sessionId,
      event_type: type,
      event_data: { ...payload, build_id: BUILD_ID, tour_id: sessionId },
      lat: ctx.lat,
      lng: ctx.lng,
      movement_mode: ctx.movementMode,
    });
  } catch {
    /* best-effort */
  }
}

// ------------------------------------------------------------ episode capture (Nov 4, 2026)

/**
 * Insert one route_episodes row (episode capture — see
 * core/episodeCapture.ts and route-episodes-capture.sql).
 * Append-only; the table is created by Erik's SQL paste, on
 * independent timing from the app publish, so a missing table
 * is an EXPECTED state, not an error: the insert simply does
 * not land. Returns whether the row landed; never throws —
 * capture is observation only and must stay inert until the
 * table exists and harmless forever after.
 */
export async function captureRouteEpisode(row: {
  tourId: string;
  kind: 'plan' | 'outcome';
  buildId: string;
  payload: Record<string, unknown>;
}): Promise<boolean> {
  if (!BACKEND_CONFIGURED) return false;
  try {
    const { error } = await db.from('route_episodes').insert({
      tour_id: row.tourId,
      kind: row.kind,
      build_id: row.buildId,
      payload: row.payload,
    });
    return !error;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ on-device audio cache (contract D)

const IDB_NAME = 'leo_tts_cache';
const IDB_STORE = 'audio';

let idbPromise: Promise<IDBDatabase | null> | null = null;

function openIdb(): Promise<IDBDatabase | null> {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return idbPromise;
}

export async function audioCacheGet(key: string): Promise<Blob | null> {
  const dbInst = await openIdb();
  if (!dbInst) return null;
  return new Promise(resolve => {
    try {
      const req = dbInst.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function audioCachePut(key: string, blob: Blob): Promise<void> {
  const dbInst = await openIdb();
  if (!dbInst) return;
  return new Promise(resolve => {
    try {
      const tx = dbInst.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function audioCacheHas(key: string): Promise<boolean> {
  return (await audioCacheGet(key)) !== null;
}

/** Fetch a bucket object into the pinned cache (idempotent). Returns true if pinned after the call. */
export async function pinBucketAudio(path: string): Promise<boolean> {
  if (await audioCacheHas(path)) return true;
  try {
    const res = await fetch(bucketUrl(path));
    if (!res.ok) return false;
    const blob = await res.blob();
    await audioCachePut(path, blob);
    return true;
  } catch {
    return false;
  }
}
