import { supabase, SUPABASE_CONFIGURED } from './supabase';
import { LANDMARK_ANGLES, describeAngle } from './storyCoverage';

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
  return angle === LANDMARK_ANGLES[0]
    ? placeName
    : `${placeName} — ${describeAngle(angle)}`;
}

class StoryLibraryService {
  // Row cache for the session: the table is tiny and curated, and a tour
  // may ask about the same place repeatedly (prefetch + serve). Rows are
  // cached, audio is not (see audioUrl note above). Null = known miss.
  private rowCache = new Map<string, LibraryRow | null>();
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
}

export const storyLibrary = new StoryLibraryService();
