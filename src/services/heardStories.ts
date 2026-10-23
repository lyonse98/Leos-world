import { supabase } from './supabase';

// Anonymous per-device identifier. It is a random string stored in local
// storage — no account, no email, no personal information. It exists so the
// app can recognise "this listener" across tours and avoid telling them the
// same story twice.
const USER_KEY_STORAGE = 'leo_user_key';

function loadOrCreateUserKey(): string {
  try {
    const existing = localStorage.getItem(USER_KEY_STORAGE);
    if (existing && existing.length > 0) return existing;

    const key = `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(USER_KEY_STORAGE, key);
    return key;
  } catch {
    // Private mode or storage disabled — fall back to a per-session key so
    // the app still works, just without cross-session memory.
    return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }
}

export let USER_KEY = loadOrCreateUserKey();

const COVERAGE_STORAGE_KEY = 'leo_story_coverage';

const MAX_HISTORY = 500;

// Durable record of everything this listener has already been told.
// The in-memory Set is the fast path; the table is the memory that survives
// closing the app and driving the same route again next week.
class HeardStoriesService {
  private heardTopics: Set<string> = new Set();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  normalize(topic: string): string {
    return topic.trim().toLowerCase();
  }

  hasHeard(topic: string): boolean {
    return this.heardTopics.has(this.normalize(topic));
  }

  markHeard(topic: string): void {
    const key = this.normalize(topic);
    if (key.length > 0) this.heardTopics.add(key);
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
          p_user_key: USER_KEY,
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
        user_key: USER_KEY,
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
    this.hydrated = false;
  }

  // Full reset for a new listener — e.g. someone else using the device, or
  // the owner wanting a clean slate. Generates a fresh per-device identity so
  // the old listener's Supabase rows stay untouched, and clears the coverage
  // and taste data from localStorage so angle rotation starts over.
  resetForNewListener(): void {
    try {
      const newKey = `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(USER_KEY_STORAGE, newKey);
      localStorage.removeItem(COVERAGE_STORAGE_KEY);
      USER_KEY = newKey;
    } catch {
      // storage unavailable — in-memory reset still works for this session
    }
    this.reset();
  }
}

export const heardStories = new HeardStoriesService();
