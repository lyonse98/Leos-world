import { supabase } from './supabase';
import { Position } from '../hooks/useGeolocation';
import { BUILD_ID } from './buildId';

type EventType = 'session_start' | 'session_end' | 'story_played' | 'ad_played' | 'question_asked' | 'story_rated' | 'story_timing' | 'generation_attempt'
  // Observational counters for field-reported symptoms (Oct 25, 2026):
  // Q&A answer latency, quota circuit-breaker trips, audio blocks, and
  // stale-story drops. Emits are fire-and-forget and must stay that way.
  | 'question_timing' | 'quota_tripped' | 'audio_blocked' | 'story_dropped'
  // First-serve audit (Oct 25, 2026): one event per tour session naming
  // what the FIRST story served actually was — event_data.source is
  // 'welcome' | 'area' | 'landmark' — so the opener sequence is
  // countable in the field. The daily-rollup trigger counts it by its
  // generic (day, event_type, source) grouping; no DDL was needed.
  | 'first_serve'
  // Per-event settle truth + unified diagnostics (Oct 26, 2026): the
  // canned opener's playback settle (opener_spoken), the Q&A answer's
  // settle and the lock's release (question_playback,
  // question_lock_released), per-story settle truth (story_playback),
  // and one sanitized diagnostic event for every pipeline error or
  // notable transition that used to live only in the on-screen status
  // line and the console (pipeline_diag). Readable per-event through
  // the analytics_recent_events view (migration 20261026221500).
  | 'opener_spoken' | 'question_playback' | 'question_lock_released' | 'story_playback' | 'pipeline_diag'
  // The rotating pre-rendered Puck opener's settle (Oct 26, 2026):
  // which clip played, that it was pre-rendered, and whether it
  // completed — the runway made countable per tour.
  | 'opener_clip'
  // Route breadcrumbs (Area G, Oct 26, 2026): a lightweight position
  // sample ~every 30s while touring and at tour end, for the owner's
  // own Bolt-panel forensics. SEALED ONLY — this kind is deliberately
  // excluded from the analytics_recent_events view entirely; it exists
  // solely in the owner-only raw table.
  | 'route_breadcrumb';

interface AnalyticsEvent {
  eventType: EventType;
  sessionId: string;
  position?: Position | null;
  movementMode?: string;
  eventData?: Record<string, unknown>;
}

class AnalyticsService {
  private sessionId: string = '';
  private tourId: string = '';
  private tourStartedAt: number | null = null;
  private queue: AnalyticsEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  init(sessionId: string): void {
    this.sessionId = sessionId;
    // A fresh random id per tour (Oct 26, 2026): events from one drive
    // can be grouped and sequenced through the recent-events view
    // without any cross-tour linkage — the id is minted here, at tour
    // start, never derived from the device, the user, or the session
    // id, and it dies with the tour.
    this.tourId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tour_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    this.tourStartedAt = Date.now();
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flush(), 15000);
    }
  }

  /** Milliseconds since this tour's analytics session began. */
  tourElapsedMs(): number {
    return this.tourStartedAt === null ? 0 : Date.now() - this.tourStartedAt;
  }

  track(eventType: EventType, position?: Position | null, movementMode?: string, eventData?: Record<string, unknown>): void {
    if (!this.sessionId) return;

    // Every event carries the tour id and the build id (Oct 26, 2026):
    // a field report is only diagnosable per-event if its events can
    // be grouped into one tour and attributed to one deployed build.
    const data: Record<string, unknown> = { ...(eventData ?? {}) };
    if (this.tourId) data.tour_id = this.tourId;
    data.build_id = BUILD_ID;

    this.queue.push({
      eventType,
      sessionId: this.sessionId,
      position,
      movementMode,
      eventData: data,
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
    this.tourId = '';
    this.tourStartedAt = null;
  }
}

export const analytics = new AnalyticsService();

// ---------------------------------------------------------------------------
// Unified pipeline diagnostics (Oct 26, 2026).
//
// The diagnostics panel's status line and the console knew WHY things
// failed — "EMPTY: deadline exceeded", "fallback: API error 429", the
// pipeline status strings — but both died with the session, so every
// field diagnosis needed Erik's screen or his memory. trackDiag is
// the single capture point: call sites pass the stage, a short reason
// code, and the raw message they already computed; sanitization and
// truncation happen HERE so no call site can leak. The payload NEVER
// carries story text, question text, or user content — call sites
// pass pipeline messages only — and anything key-shaped is stripped
// defensively regardless.
// ---------------------------------------------------------------------------

export type DiagStage = 'text' | 'tts' | 'places' | 'playback' | 'quota' | 'pipeline';

const KEY_SHAPED = /AIza[0-9A-Za-z_-]{8,}/g;
const NAMED_SECRET = /((?:api[-_]?key|access[-_]?token|token|bearer)["'\s:=]+)[0-9A-Za-z_-]{8,}/gi;

export function sanitizeDiagMessage(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? '');
  return msg
    .replace(KEY_SHAPED, '[redacted]')
    .replace(NAMED_SECRET, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function trackDiag(stage: DiagStage, reason: string, message: unknown): void {
  try {
    analytics.track('pipeline_diag', null, undefined, {
      stage,
      reason,
      message: sanitizeDiagMessage(message),
    });
  } catch { /* a diagnostic must never break the pipeline it describes */ }
}
