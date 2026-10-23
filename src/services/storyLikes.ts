import { supabase } from './supabase';

class StoryLikesService {
  async record(topic: string, storyText: string, lat: number, lng: number, sessionId: string | null): Promise<void> {
    try {
      const { error } = await supabase.from('story_likes').insert({
        topic,
        story_text: storyText,
        lat,
        lng,
        session_id: sessionId,
      });
      if (error) console.error('[StoryLikes] Insert failed:', error.message);
    } catch (e) {
      console.error('[StoryLikes] Error:', e);
    }
  }
}

export const storyLikes = new StoryLikesService();
