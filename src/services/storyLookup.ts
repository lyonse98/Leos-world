import { supabase } from './supabase';

export interface CachedStoryResult {
  storyText: string;
  topic: string;
  source: 'landmark' | 'cache';
  distanceM: number;
}

class StoryLookupService {
  // versionKey scopes the search to stories written by the same voice and from
  // the same facts. Landmark stories ignore it. Omit it to accept any story.
  // excludedAngles filters out cached stories whose angle the listener has
  // already been told — this is what makes rotation stories shareable: a cached
  // `landmark_people` story is only served to someone who has not heard the
  // people angle yet.
  async findNearbyStory(
    lat: number,
    lng: number,
    radiusM = 100,
    versionKey?: string,
    excludedAngles: string[] = []
  ): Promise<CachedStoryResult | null> {
    const { data, error } = await supabase.rpc('find_nearby_cached_story', {
      p_lat: lat,
      p_lng: lng,
      p_radius_m: radiusM,
      p_version_key: versionKey ?? null,
      p_excluded_angles: excludedAngles,
    });

    if (error || !data || data.length === 0) return null;

    const row = data[0];
    if (!row.story_text) return null;

    // Mark this story as served so the prune function knows it is still useful.
    // Fire-and-forget — a failure here never blocks playback.
    if (row.story_id) {
      supabase.rpc('touch_served_story', { p_story_id: row.story_id }).then(({ error: touchError }) => {
        if (touchError) console.error('[StoryLookup] touch_served_story failed:', touchError.message);
      });
    }

    return {
      storyText: row.story_text,
      topic: row.topic,
      source: row.source,
      distanceM: row.distance_m,
    };
  }

  async hasStoryForLocation(lat: number, lng: number, radiusM = 50): Promise<boolean> {
    const result = await this.findNearbyStory(lat, lng, radiusM);
    return result !== null;
  }
}

export const storyLookup = new StoryLookupService();
