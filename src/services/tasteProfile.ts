import { supabase } from './supabase';
import { getUserKey } from './heardStories';
import { deriveTags, describeTag, isInterestTag, TagInput } from './storyTags';

// What this listener likes, learned from their own ratings.
//
// The database stores a decayed score and an evidence count per tag. Turning
// those into a preference happens here, so the smoothing can be tuned without
// touching the schema.
//
//   affinity = score / (K + weight)
//
// K is the smoothing constant: it is how much evidence it takes before a tag is
// trusted. One thumbs-up moves a tag to about 0.4 rather than all the way to
// 1.0, which stops a single stray tap from reshaping everything.

const SMOOTHING_K = 1.5;

// Points added to a candidate's relevance score at full confidence. The cap
// keeps taste a strong tiebreaker without letting it outrank the fact that a
// landmark is genuinely major.
const BOOST_SCALE = 45;
const MAX_BOOST = 50;

// A tag has to clear this before Leo is told about it. Below it, the evidence
// is one rating or a wash, and acting on that would be noise.
const SUMMARY_THRESHOLD = 0.15;
const MAX_SUMMARY_TAGS = 5;

export type RatingValue = 1 | -1 | 0;
export type FeedbackSource = 'explicit' | 'skip';

// A skip only counts as a taste signal when the listener barely gave the story
// a chance. Leaving after half a minute usually means the subject wasn't for
// them; leaving after two seconds usually means the timing was wrong, and
// rating that would teach Leo the wrong lesson.
export const SKIP_FEEDBACK_WINDOW_SECONDS = 8;

interface TagWeight {
  score: number;
  weight: number;
}

export interface TasteSummary {
  liked: string[];
  disliked: string[];
}

class TasteProfileService {
  private weights = new Map<string, TagWeight>();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;
  private sessionId = '';

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    if (this.hydrating) return this.hydrating;

    this.hydrating = (async () => {
      try {
        // The table is not readable from the browser. This returns only the
        // aggregate weights for the device key we present, so no caller can
        // read anyone else's taste profile — or even its own raw rows.
        const { data, error } = await supabase.rpc('get_taste_weights', {
          p_user_key: getUserKey(),
          p_limit: 200,
        });

        if (error) throw error;

        if (data) {
          for (const row of data as { tag: string; score: number; weight: number }[]) {
            const weight = Number(row.weight);
            const score = Number(row.score);
            if (!row.tag || !isFinite(weight) || !isFinite(score)) continue;
            this.weights.set(row.tag, { score, weight });
          }
        }

        this.hydrated = true;
        console.log('[Taste] Hydrated', this.weights.size, 'tag weights');
      } catch (error) {
        console.error('[Taste] Hydration failed:', error);
      } finally {
        this.hydrating = null;
      }
    })();

    return this.hydrating;
  }

  private affinity(tag: string): number {
    const entry = this.weights.get(tag);
    if (!entry) return 0;
    return entry.score / (SMOOTHING_K + entry.weight);
  }

  // Points to add to a candidate's relevance score. Averages over the tags the
  // candidate actually carries, so a place with no rated tags at all returns
  // exactly zero and behaves as it did before any of this existed.
  boostFor(tags: string[]): number {
    if (tags.length === 0 || this.weights.size === 0) return 0;

    let sum = 0;
    for (const tag of tags) sum += this.affinity(tag);

    const points = Math.round((sum / tags.length) * BOOST_SCALE);
    if (points === 0) return 0;
    return Math.max(-MAX_BOOST, Math.min(MAX_BOOST, points));
  }

  record(input: {
    topic: string;
    types?: string[];
    text?: string;
    context?: string | null;
    mode?: string | null;
    lat?: number;
    lng?: number;
    value: RatingValue;
    source?: FeedbackSource;
    skipSeconds?: number;
  }): string[] {
    const source: FeedbackSource = input.source ?? 'explicit';
    const tags = deriveTags({
      topic: input.topic,
      types: input.types,
      text: input.text,
      context: input.context,
      mode: input.mode,
    } as TagInput);

    if (tags.length > 0) this.applyLocally(tags, input.value, source);

    // Fire-and-forget: a rating that fails to save must never interrupt the
    // tour, and the local weights already reflect it.
    supabase
      .rpc('record_story_feedback', {
        p_user_key: getUserKey(),
        p_session_id: this.sessionId,
        p_topic: input.topic,
        p_lat: input.lat ?? null,
        p_lng: input.lng ?? null,
        p_value: input.value,
        p_source: source,
        p_skip_seconds: input.skipSeconds ?? null,
        p_tags: tags,
      })
      .then(({ error }) => {
        if (error) console.error('[Taste] Record failed:', error.message);
      });

    return tags;
  }

  // Keeps scoring responsive without a round trip. It is an approximation of
  // the decayed server value — close enough to steer the next pick, and the
  // server value replaces it on the next hydration.
  private applyLocally(tags: string[], value: RatingValue, source: FeedbackSource): void {
    const magnitude = source === 'skip' ? 0.2 : 1;
    for (const tag of tags) {
      const entry = this.weights.get(tag) ?? { score: 0, weight: 0 };
      if (value === 0) {
        // Undo: we do not know the value being removed, so drop the tag's
        // evidence and let the next hydration restore the true figure.
        this.weights.delete(tag);
        continue;
      }
      this.weights.set(tag, {
        score: entry.score + value * magnitude,
        weight: entry.weight + magnitude,
      });
    }
  }

  // What Leo is told about the listener. Only tags with real evidence behind
  // them are surfaced, so one rating never becomes a personality trait.
  getSummary(): TasteSummary {
    const liked: Array<[string, number]> = [];
    const disliked: Array<[string, number]> = [];

    for (const [tag, entry] of this.weights) {
      if (!isInterestTag(tag)) continue;
      const value = entry.score / (SMOOTHING_K + entry.weight);
      if (value >= SUMMARY_THRESHOLD) liked.push([tag, value]);
      else if (value <= -SUMMARY_THRESHOLD) disliked.push([tag, value]);
    }

    liked.sort((a, b) => b[1] - a[1]);
    disliked.sort((a, b) => a[1] - b[1]);

    return {
      liked: liked.slice(0, MAX_SUMMARY_TAGS).map(([tag]) => describeTag(tag)),
      disliked: disliked.slice(0, MAX_SUMMARY_TAGS).map(([tag]) => describeTag(tag)),
    };
  }

  getTagCount(): number {
    return this.weights.size;
  }

  reset(): void {
    this.weights = new Map();
    this.hydrated = false;
  }
}

export const tasteProfile = new TasteProfileService();
