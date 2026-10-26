import { supabase } from './supabase';
import { normalizePlaceName, placeNamesMatch } from './placeName';

// Anonymous per-device identifier. It is a random string stored in local
// storage — no account, no email, no personal information. It exists so the
// app can recognise "this listener" across tours and avoid telling them the
// same story twice.
const USER_KEY_STORAGE = 'leo_user_key';

function createUserKey(): string {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function loadOrCreateUserKey(): string {
  try {
    const existing = localStorage.getItem(USER_KEY_STORAGE);
    if (existing && existing.length > 0) return existing;

    const key = createUserKey();
    localStorage.setItem(USER_KEY_STORAGE, key);
    return key;
  } catch {
    // Private mode or storage disabled — fall back to a per-session key so
    // the app still works, just without cross-session memory.
    return createUserKey();
  }
}

let currentUserKey = loadOrCreateUserKey();

export function getUserKey(): string {
  return currentUserKey;
}

// Start over as a "new listener": mint a fresh device key so the server
// has no heard history for this device. The old rows are not deleted —
// they sit keyed to an anonymous random id nothing will ever present
// again. Used by the diagnostics story-memory reset.
export function rotateUserKey(): string {
  currentUserKey = createUserKey();
  try {
    localStorage.setItem(USER_KEY_STORAGE, currentUserKey);
  } catch {
    // storage unavailable — the new key still applies for this session
  }
  return currentUserKey;
}

const MAX_HISTORY = 500;

// Durable record of everything this listener has already been told.
// The in-memory Set is the fast path; the table is the memory that survives
// closing the app and driving the same route again next week.
class HeardStoriesService {
  private heardTopics: Set<string> = new Set();
  // Subject identities (deep-normalized bare place names) extracted from
  // every heard topic. Kept alongside the raw topics because the same
  // place arrives under variant spellings across sources and sessions,
  // and a subject check against raw topic strings misses every variant.
  private heardSubjects: Set<string> = new Set();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  normalize(topic: string): string {
    return topic.trim().toLowerCase();
  }

  hasHeard(topic: string): boolean {
    return this.heardTopics.has(this.normalize(topic));
  }

  // Subject-level check. Stories are recorded under their display topic,
  // which for a rotated telling is "<Place> — <angle label>", while most
  // callers ask about a place by its bare name. A bare-name lookup against
  // raw topics therefore misses every rotated telling and the place looks
  // unheard — the root of same-landmark retells. A subject counts as heard
  // when the bare name or any of its angle variants has been told, under
  // any spelling variant of the name.
  hasHeardSubject(name: string): boolean {
    const key = normalizePlaceName(name);
    if (key.length === 0) return false;
    if (this.heardSubjects.has(key)) return true;
    for (const heard of this.heardSubjects) {
      if (placeNamesMatch(heard, key)) return true;
    }
    return false;
  }

  markHeard(topic: string): void {
    const key = this.normalize(topic);
    if (key.length > 0) this.heardTopics.add(key);
    const bare = normalizePlaceName(topic.split(' — ')[0]);
    if (bare.length > 0) this.heardSubjects.add(bare);
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    if (this.hydrating) return this.hydrating;

    this.hydrating = (async () => {
      try {
        // The table is no longer directly readable from the browser. This
        // routine returns only the rows matching the device key we present,
        // so no caller can enumerate anyone else's listening history.
        const { data, error } = await supabase.rpc('get_heard_topics', {
          p_user_key: getUserKey(),
          p_limit: MAX_HISTORY,
        });

        if (error) throw error;

        if (data) {
          (data as { topic: string }[]).forEach(row => this.markHeard(row.topic));
        }
        this.hydrated = true;
        console.log('[HeardStories] Hydrated', this.heardTopics.size, 'previously heard topics');
      } catch (error) {
        console.error('[HeardStories] Hydration failed:', error);
      } finally {
        this.hydrating = null;
      }
    })();

    return this.hydrating;
  }

  // Fire-and-forget. A failure to record never blocks playback.
  record(entry: {
    sessionId: string;
    topic: string;
    storyText?: string;
    lat: number;
    lng: number;
  }): void {
    this.markHeard(entry.topic);

    supabase
      .from('heard_stories')
      .insert({
        session_id: entry.sessionId,
        user_key: getUserKey(),
        topic: entry.topic,
        story_text: entry.storyText || null,
        lat: entry.lat,
        lng: entry.lng,
      })
      .then(({ error }) => {
        if (error) console.error('[HeardStories] Record failed:', error.message);
      });
  }

  reset(): void {
    this.heardTopics = new Set();
    this.heardSubjects = new Set();
    this.hydrated = false;
  }
}

export const heardStories = new HeardStoriesService();
