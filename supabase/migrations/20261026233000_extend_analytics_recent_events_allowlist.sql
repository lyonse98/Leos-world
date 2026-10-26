/*
  # Analytics recent events — allowlist extension (Oct 26, 2026)

  Follow-up to 20261026221500. Four payload keys added by the opener
  work are recorded in analytics_events but were dropped by the view's
  projection until allowlisted here:

    ms_to_first_sound  (opener_spoken: the welcome's true start latency —
                        settle elapsed minus the line's own sounded time)
    opener_id          (opener_clip: which pre-rendered Puck clip played)
    length_class       (opener_clip: short | medium | long)
    segment            (opener_clip: primary | extension)

  Nothing else changes: same five columns, same 72-hour window, same
  hard exclusions (lat/lng, session_id, user_id, question text are
  structurally absent, exactly as before). The base table's seal is
  untouched.

  Reverse: re-apply the 20261026221500 view body (or DROP VIEW
  public.analytics_recent_events to remove the read path entirely).
*/

CREATE OR REPLACE VIEW public.analytics_recent_events AS
SELECT
  e.id,
  e.created_at,
  e.event_type,
  e.movement_mode,
  COALESCE((
    SELECT jsonb_object_agg(k.key, v.val)
    FROM (VALUES
      -- Provenance / grouping (Oct 26 instrumentation)
      ('tour_id'),
      ('build_id'),
      -- Which model / lane / source produced the event, and rollup keys
      ('model'),
      ('source'),
      ('lane'),
      ('kind'),
      -- Place name (already public via analytics_topic_rollup)
      ('topic'),
      -- Timings (seconds, as recorded by story_timing / question_timing)
      ('fetchTextS'),
      ('synthS'),
      ('gapS'),
      ('cacheHit'),
      -- Playback settle truth (opener_spoken / question_playback /
      -- story_playback)
      ('voice'),
      ('engine'),
      ('sounded'),
      ('completed'),
      ('attempts'),
      ('ms_from_tour_start'),
      ('sounded_ms'),
      -- Opener start edge + Puck opener identity (added by this migration)
      ('ms_to_first_sound'),
      ('opener_id'),
      ('length_class'),
      ('segment'),
      -- Q&A lock release (question_lock_released)
      ('reason'),
      -- Pipeline diagnostics (pipeline_diag; also extended onto
      -- audio_blocked / quota_tripped)
      ('stage'),
      ('message')
    ) AS k(key)
    CROSS JOIN LATERAL (
      SELECT coalesce(e.event_data, '{}'::jsonb) -> k.key AS val
    ) AS v
    WHERE v.val IS NOT NULL AND v.val <> 'null'::jsonb
  ), '{}'::jsonb) AS data
FROM public.analytics_events e
WHERE e.created_at > now() - interval '72 hours';

-- World-readable by design, like the rollups: safe by construction.
-- Deliberately NO access to analytics_events itself is granted here.
GRANT SELECT ON public.analytics_recent_events TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.analytics_recent_events FROM anon, authenticated;
