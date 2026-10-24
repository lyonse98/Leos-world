import { supabase } from './supabase';
import { Position } from '../hooks/useGeolocation';

type EventType = 'session_start' | 'session_end' | 'story_played' | 'ad_played' | 'question_asked' | 'story_rated' | 'story_timing';

interface AnalyticsEvent {
  eventType: EventType;
  sessionId: string;
  position?: Position | null;
  movementMode?: string;
  eventData?: Record<string, unknown>;
}

class AnalyticsService {
  private sessionId: string = '';
  private queue: AnalyticsEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  init(sessionId: string): void {
    this.sessionId = sessionId;
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flush(), 15000);
    }
  }

  track(eventType: EventType, position?: Position | null, movementMode?: string, eventData?: Record<string, unknown>): void {
    if (!this.sessionId) return;

    this.queue.push({
      eventType,
      sessionId: this.sessionId,
      position,
      movementMode,
      eventData,
    });
  }

  private async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) return;

    this.isFlushing = true;
    const batch = this.queue.splice(0, this.queue.length);

    const rows = batch.map(e => ({
      session_id: e.sessionId,
      event_type: e.eventType,
      event_data: e.eventData || {},
      lat: e.position?.lat ?? null,
      lng: e.position?.lng ?? null,
      movement_mode: e.movementMode ?? null,
    }));

    try {
      await supabase.from('analytics_events').insert(rows);
    } catch {
      this.queue.unshift(...batch);
    } finally {
      this.isFlushing = false;
    }
  }

  async flushNow(): Promise<void> {
    await this.flush();
  }

  reset(): void {
    this.queue = [];
    this.sessionId = '';
  }
}

export const analytics = new AnalyticsService();
