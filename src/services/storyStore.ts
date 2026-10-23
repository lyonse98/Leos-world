import { supabase } from './supabase';

export interface StoryRecord {
  sessionId: string;
  topic: string;
  lat: number;
  lng: number;
  storyText: string;
  context?: string;
  depthLevel?: number;
  versionKey?: string;
  // Which angle this story covered (e.g. landmark_origin, landmark_people,
  // stationary_neighborhood). Stored so the next listener at this spot can be
  // served this story only if they have not already heard this angle.
  angle?: string | null;
}

// The shared story store. Every story written here — canonical and rotation —
// is available to every listener at that spot, filtered by which angles they
// have already been told. One person's drive pays for the next person's
// narration; the library fills in as more people pass.
// Fire-and-forget: a failure here never blocks playback.
class StoryStore {
  async save(record: StoryRecord): Promise<void> {
    try {
      await supabase.from('tour_stories').insert({
        session_id: record.sessionId,
        topic: record.topic,
        lat: record.lat,
        lng: record.lng,
        story_text: record.storyText,
        context: record.context || null,
        depth_level: record.depthLevel ?? 0,
        version_key: record.versionKey || null,
        angle: record.angle ?? null,
      });
    } catch (error) {
      console.error('[StoryStore] Error saving story:', error);
    }
  }
}

export const storyStore = new StoryStore();
