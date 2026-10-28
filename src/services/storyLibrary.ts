import { supabase, SUPABASE_CONFIGURED } from './supabase';
import { LANDMARK_ANGLES, describeAngle } from './storyCoverage';
import { calculateDistance } from '../utils/geo';

// The curated library — "recorded episodes" in story_library.
//
// A library entry is an asset, not a cache fill: it was written once, on
// purpose, for an exact (place, angle), and it serves regardless of the
// current persona version (its own persona_version is stamped on the row).
// Serve order per (place, angle) is LIBRARY → ephemeral cache → live
// generation: curated beats first-come. Everything in this module fails
// to null — a missing table (the migration awaits a Bolt step), a network
// error, or a simple miss must be indistinguishable from the library not
// existing, because for most places it doesn't.

export interface LibraryStoryResult {
  text: string;
  // Object URL for the entry's pre-made audio, downloaded from the
  // tts-audio bucket the same way geminiAudio fetches shared cache audio.
  // Downloaded fresh on every lookup — the voice layer revokes the URL
  // when playback ends, so an URL is never handed out twice.
  audioUrl: string;
  // The entry's own coordinates: the serve anchor the freshness gates
  // measure against.
  lat: number;
  lng: number;
  placeName: string;
  angle: string;
  // The display topic to record this serve under ("<Place>" for the base
  // angle, "<Place> — <angle label>" for rotations) — the same shape the
  // rest of the app files stories under.
  topic: string;
}

interface LibraryRow {
  place_name: string;
  angle: string;
  lat: number;
  lng: number;
  story_text: string;
  audio_path: string;
}

const LIBRARY_PLACES_KEY = 'leo_library_place_keys';

// The one normalization for library identity, shared verbatim with the
// library builder (which bundles this module rather than copying the
// function): lowercase, collapsed whitespace, no periods/apostrophes —
// "U.S. Grant Hotel" and "US Grant Hotel" are the same place here.
export function normalizePlaceKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, ' ');
}

function displayTopic(placeName: string, angle: string): string {
  // Neighborhood-bank rows (Item 8) key on the bare area name: the
  // serve re-topics to the live intro shape ("<Area> — <angle
  // label>") at the serve site, and no other path may ever present
  // an intro row under an angle-flavored topic.
  if (angle === 'neighborhood_intro') return placeName;
  return angle === LANDMARK_ANGLES[0]
    ? placeName
    : `${placeName} — ${describeAngle(angle)}`;
}

class StoryLibraryService {
  // Row cache for the session: the table is tiny and curated, and a tour
  // may ask about the same place repeatedly (prefetch + serve). Rows are
  // cached, audio is not (see audioUrl note above). Null = known miss.
  private rowCache = new Map<string, LibraryRow | null>();
  // Whole-place row sets, for place-wide lookup (Pass 2): every angle the
  // library holds for one place, fetched in a single query. Null = the
  // place is known to have no rows.
  private placeRowsCache = new Map<string, LibraryRow[] | null>();
  // Latched when the table itself answers "not there" — until the
  // migration is applied, every lookup would 404; latch it off so the
  // serve path stays exactly as fast (and as silent) as before the
  // library existed.
  private tableMissing = false;

  private isMissingTableError(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    if (error.code === 'PGRST205') return true;
    const msg = (error.message || '').toLowerCase();
    return msg.includes('story_library') && (msg.includes('not find') || msg.includes('does not exist'));
  }

  async lookup(placeName: string, angle: string): Promise<LibraryStoryResult | null> {
    if (!SUPABASE_CONFIGURED || this.tableMissing) return null;
    const placeKey = normalizePlaceKey(placeName);
    if (!placeKey || !angle) return null;
    const cacheKey = `${placeKey}|${angle}`;

    let row = this.rowCache.get(cacheKey);
    if (row === undefined) {
      try {
        const { data, error } = await supabase
          .from('story_library')
          .select('place_name, angle, lat, lng, story_text, audio_path')
          .eq('place_key', placeKey)
          .eq('angle', angle)
          .limit(1);
        if (error) {
          if (this.isMissingTableError(error)) {
            this.tableMissing = true;
            console.warn('[StoryLibrary] story_library table not present yet — library inactive this session');
          } else {
            console.warn('[StoryLibrary] Lookup failed (continuing without):', error.message);
          }
          return null;
        }
        row = (data?.[0] as LibraryRow) ?? null;
      } catch (error) {
        console.warn('[StoryLibrary] Lookup threw (continuing without):', error);
        return null;
      }
      this.rowCache.set(cacheKey, row);
    }
    if (!row) return null;

    return this.toResult(row);
  }

  // Corridor lookup (pre-publish stack Item 6, Oct 27, 2026): the
  // banked story for one freeway segment-direction, keyed exactly
  // like the place corpus — (normalizePlaceKey(displayName),
  // 'corridor') — so the corridor bank is the same shelf, the same
  // ingestion, and the same serve mechanics as the 345 place
  // stories. The display names live in src/data/corridors.ts; the
  // serve layer (gemini.ts) matches position → segment and asks
  // here by name. One story per (segment, direction) in v1 — no
  // angle rotation.
  async lookupCorridor(displayName: string): Promise<LibraryStoryResult | null> {
    return this.lookup(displayName, 'corridor');
  }

  // Neighborhood bank (pre-publish stack Item 8, Oct 27, 2026): the
  // pre-rendered welcome intro for one neighborhood, keyed
  // (normalizePlaceKey(areaName), 'neighborhood_intro') — one intro
  // per area, generated offline in the leo-v13 most-compelling-story
  // format. The gemini serve checks this bank before live intro
  // generation for first-visit intro contexts; see the branch there
  // for the eligibility doctrine (no prior coverage — a return visit
  // is a live welcome_back, never the banked orientation).
  async lookupNeighborhood(areaName: string): Promise<LibraryStoryResult | null> {
    return this.lookup(areaName, 'neighborhood_intro');
  }

  // Silence-filler pool (Oct 28, 2026): every 'filler' row — the
  // county-general stories the filler lane pins on-device at tour
  // start and serves into true silence. Rows only; the lane does
  // its own audio pinning (the audio is pinned by TEXT into the
  // TTS cache, not handed out as one-shot URLs the way toResult
  // serves an episode). Fails to null like everything in this
  // module: a missing pool means an inert lane, never a broken tour.
  async loadFillerRows(): Promise<Array<{ placeName: string; text: string; audioPath: string }> | null> {
    if (!SUPABASE_CONFIGURED || this.tableMissing) return null;
    try {
      const { data, error } = await supabase
        .from('story_library')
        .select('place_name, story_text, audio_path')
        .eq('angle', 'filler')
        .limit(50);
      if (error) {
        if (this.isMissingTableError(error)) {
          this.tableMissing = true;
          console.warn('[StoryLibrary] story_library table not present yet — library inactive this session');
        } else {
          console.warn('[StoryLibrary] Filler pool load failed (continuing without):', error.message);
        }
        return null;
      }
      const rows = (data ?? []) as Array<{ place_name: string; story_text: string; audio_path: string }>;
      if (rows.length === 0) return null;
      return rows.map(r => ({ placeName: r.place_name, text: r.story_text, audioPath: r.audio_path }));
    } catch (error) {
      console.warn('[StoryLibrary] Filler pool load threw (continuing without):', error);
      return null;
    }
  }

  // Place-wide lookup (Pass 2, Oct 27, 2026): the library's episode for
  // a place, at ANY angle the caller still considers servable. The
  // exact-(place, angle) lookup above starved the library on real
  // drives: selection rotates through all twelve landmark angles, but
  // the corpus holds three per place, chosen per place — so the chosen
  // angle and the shelved angles rarely met, and a 345-story library
  // served twice in 57 plays. Here the place is the match and the
  // angle is the caller's filter: rows are tried in the corpus's own
  // angle order (LANDMARK_ANGLES), and the caller skips the angles
  // already heard or locked at its serve layer. Deterministic — the
  // same place in the same state yields the same episode.
  //
  // Deliberately NO persona-version parameter: a library row serves
  // regardless of the live persona version (see the module header).
  // Persona bumps retire ephemeral cache stories, never the shelf.
  async lookupForPlace(
    placeName: string,
    isEligible: (angle: string, topic: string) => boolean
  ): Promise<LibraryStoryResult | null> {
    if (!SUPABASE_CONFIGURED || this.tableMissing) return null;
    const placeKey = normalizePlaceKey(placeName);
    if (!placeKey) return null;

    let rows = this.placeRowsCache.get(placeKey);
    if (rows === undefined) {
      try {
        const { data, error } = await supabase
          .from('story_library')
          .select('place_name, angle, lat, lng, story_text, audio_path')
          .eq('place_key', placeKey)
          .limit(50);
        if (error) {
          if (this.isMissingTableError(error)) {
            this.tableMissing = true;
            console.warn('[StoryLibrary] story_library table not present yet — library inactive this session');
          } else {
            console.warn('[StoryLibrary] Place lookup failed (continuing without):', error.message);
          }
          return null;
        }
        rows = (data ?? []) as LibraryRow[];
      } catch (error) {
        console.warn('[StoryLibrary] Place lookup threw (continuing without):', error);
        return null;
      }
      this.placeRowsCache.set(placeKey, rows.length > 0 ? rows : null);
      for (const row of rows) {
        this.rowCache.set(`${placeKey}|${row.angle}`, row);
      }
    }
    if (!rows || rows.length === 0) return null;

    // The corpus's angle order: LANDMARK_ANGLES index order. An angle
    // outside that list (none should exist) sorts last, by name, so
    // the walk stays deterministic whatever the shelf holds.
    const angleRank = (angle: string): number => {
      const idx = LANDMARK_ANGLES.indexOf(angle);
      return idx === -1 ? LANDMARK_ANGLES.length : idx;
    };
    const ordered = [...rows].sort(
      (a, b) => angleRank(a.angle) - angleRank(b.angle) || a.angle.localeCompare(b.angle)
    );

    for (const row of ordered) {
      // Neighborhood-bank rows (Item 8) share names with places by
      // design (Balboa Park is both an area and a place) — a place
      // walk must NEVER serve a welcome intro as a place story.
      // Intros serve only through lookupNeighborhood.
      if (row.angle === 'neighborhood_intro') continue;
      if (!isEligible(row.angle, displayTopic(row.place_name, row.angle))) continue;
      const result = await this.toResult(row);
      if (result) return result;
    }
    return null;
  }

  // Row → servable result: download the entry's pre-made audio from
  // the tts-audio bucket and hand out a fresh object URL (the voice
  // layer revokes it when playback ends, so it is never reused).
  private async toResult(row: LibraryRow): Promise<LibraryStoryResult | null> {
    // Audio: same download-then-play pattern as the shared story cache —
    // fetch the blob from the bucket and hand out an object URL.
    try {
      const { data, error } = await supabase.storage.from('tts-audio').download(row.audio_path);
      if (error || !data) {
        console.warn('[StoryLibrary] Audio download failed (continuing without):', error?.message);
        return null;
      }
      const blob = data as Blob;
      if (blob.size === 0 || !blob.type.startsWith('audio')) return null;
      return {
        text: row.story_text,
        audioUrl: URL.createObjectURL(blob),
        lat: row.lat,
        lng: row.lng,
        placeName: row.place_name,
        angle: row.angle,
        topic: displayTopic(row.place_name, row.angle),
      };
    } catch (error) {
      console.warn('[StoryLibrary] Audio download threw (continuing without):', error);
      return null;
    }
  }

  // Lookup by an existing display topic, for serve paths that hold a
  // topic rather than a chosen (place, angle) — the topic's base name is
  // the place; a " — <label>" suffix names the angle (inverted through
  // describeAngle), and a bare topic is the base angle.
  async lookupForTopic(topic: string): Promise<LibraryStoryResult | null> {
    const sep = topic.indexOf(' — ');
    if (sep === -1) {
      return this.lookup(topic, LANDMARK_ANGLES[0]);
    }
    const base = topic.slice(0, sep).trim();
    const label = topic.slice(sep + 3).trim();
    const angle = LANDMARK_ANGLES.find(a => describeAngle(a) === label);
    if (!base || !angle) return null;
    return this.lookup(base, angle);
  }

  // --- Place index ---------------------------------------------------------
  // The set of place keys the library holds ANY angle for. Selection
  // layers need it synchronously (the daily cap exempts library places:
  // a curated place is not a "minor subject"), so the index is primed
  // once per session by an async fetch, persisted in localStorage so
  // it survives restarts, and read through hasPlace. Until the first
  // successful prime, hasPlace answers from the persisted copy (or
  // false on a truly fresh device) — the exemption fails open for one
  // session rather than blocking the serve path on the network.
  private placeIndex: Set<string> | null = null;
  private placeIndexPromise: Promise<void> | null = null;

  private loadPersistedPlaceIndex(): Set<string> {
    try {
      const raw = localStorage.getItem(LIBRARY_PLACES_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((k): k is string => typeof k === 'string'));
    } catch {
      return new Set();
    }
  }

  hasPlace(placeName: string): boolean {
    const key = normalizePlaceKey(placeName);
    if (!key) return false;
    const index = this.placeIndex ?? this.loadPersistedPlaceIndex();
    return index.has(key);
  }

  async primePlaceIndex(): Promise<void> {
    if (this.placeIndex !== null || this.tableMissing) return;
    if (!SUPABASE_CONFIGURED) return;
    if (this.placeIndexPromise) return this.placeIndexPromise;
    this.placeIndexPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from('story_library')
          .select('place_key, place_name, lat, lng')
          .limit(1000);
        if (error) {
          if (this.isMissingTableError(error)) this.tableMissing = true;
          return; // leave unprimed; a later call may retry
        }
        const rows = (data ?? []) as Array<{ place_key: string; place_name: string; lat: number; lng: number }>;
        const keys = new Set<string>(rows.map(r => r.place_key).filter(Boolean));
        this.placeIndex = keys;
        // Anchors: one representative point per place (every angle of a
        // place shares its coordinates), for the tenant rule below.
        const anchors = new Map<string, PlaceAnchor>();
        for (const r of rows) {
          if (!r.place_key || anchors.has(r.place_key)) continue;
          if (typeof r.lat !== 'number' || typeof r.lng !== 'number') continue;
          const override = ANCHOR_OVERRIDES[r.place_key];
          anchors.set(r.place_key, {
            key: r.place_key,
            name: r.place_name,
            lat: override?.lat ?? r.lat,
            lng: override?.lng ?? r.lng,
            radiusM: override?.radiusM ?? DEFAULT_ANCHOR_RADIUS_M,
          });
        }
        this.placeAnchors = anchors;
        try {
          localStorage.setItem(LIBRARY_PLACES_KEY, JSON.stringify([...keys]));
        } catch {
          // persistence is a resilience bonus, not a requirement
        }
      } catch {
        // the index is an exemption hint — failing to load it must
        // never break a serve
      } finally {
        this.placeIndexPromise = null;
      }
    })();
    return this.placeIndexPromise;
  }

  // --- Tenant rule (Area C, Oct 26, 2026) --------------------------------
  // Majors have right-of-way at every serve layer: the WHOLE place
  // outranks its tenants. When a candidate sits inside a curated major
  // place's extent and that place has not been told this session, the
  // place's own story goes first; the tenant becomes eligible again
  // once the place is served or locked. The drive's case: Liberty
  // Station reached the listener as "THE LOT Liberty Station" — a
  // tenant — while the district itself was never told.
  //
  // Anchors come from the library itself: the curated corpus IS the
  // set of wholes. A candidate defers when it lies within an anchor's
  // radius AND (it is not itself a library place — a Google/registry
  // tenant — OR its name is kin to the anchor's ("THE LOT Liberty
  // Station" carries its parent's name) OR the anchor's extent is
  // strictly larger than its own (a district containing a venue).
  // A candidate that is itself Tier-1 is guarded at the call sites,
  // which never defer a Tier-1 subject.
  private placeAnchors: Map<string, PlaceAnchor> | null = null;

  containingMajorAnchor(lat: number, lng: number, candidateName: string): PlaceAnchor | null {
    if (!this.placeAnchors || this.placeAnchors.size === 0) return null;
    const candidateKey = normalizePlaceKey(candidateName);
    const candidateIsLibrary = this.placeIndex?.has(candidateKey) ?? false;
    const candidateAnchor = candidateKey ? this.placeAnchors.get(candidateKey) : undefined;

    let best: PlaceAnchor | null = null;
    let bestDistance = Infinity;
    for (const anchor of this.placeAnchors.values()) {
      if (anchor.key === candidateKey) continue;
      const d = calculateDistance(lat, lng, anchor.lat, anchor.lng);
      if (d > anchor.radiusM) continue;
      if (candidateIsLibrary) {
        const kin =
          candidateKey.includes(anchor.key) || anchor.key.includes(candidateKey);
        const larger = candidateAnchor ? anchor.radiusM > candidateAnchor.radiusM : false;
        if (!kin && !larger) continue;
      }
      if (d < bestDistance) {
        best = anchor;
        bestDistance = d;
      }
    }
    return best;
  }
}

export interface PlaceAnchor {
  key: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}

// How far a curated place's "whole" extends for the tenant rule. A
// single point with a modest radius is the honest shape for most
// library places; large complexes whose tenants scatter across a
// district get an explicit extent — and, where the library's own
// point sits at one end of the district, an explicit centroid.
// Liberty Station is the case that forced the centroid: its library
// point is the district's north end, and a circle there misses the
// district's own southern tenants (the drive's THE LOT among them).
// Keyed by normalized place key.
const DEFAULT_ANCHOR_RADIUS_M = 400;
const ANCHOR_OVERRIDES: Record<string, { lat?: number; lng?: number; radiusM: number }> = {
  'liberty station': { lat: 32.7265, lng: -117.2155, radiusM: 1250 },
  // El Prado core only, per the coverage audit's fit verdict — the
  // park's institutions inside it defer to the park's story once, on
  // first entry; the wider park is not one circle's honest shape.
  'balboa park': { radiusM: 700 },
};

export const storyLibrary = new StoryLibraryService();
