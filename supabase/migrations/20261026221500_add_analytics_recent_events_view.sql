/*
  # Analytics recent events — the sanitized per-event read (Oct 26, 2026)

  Approved explicitly by Erik on Oct 26, 2026. Until now Muse's
  self-serve analytics level was the two rollups (20261025212500,
  20261025231500): day-granular counts and sums. Three field failures
  in one afternoon (the opener that never sounded, the fallback voice
  looping, the Q&A lock releasing mid-answer) showed the limit of
  that: each diagnosis needed the SEQUENCE of individual events in a
  single tour, and the raw rows are sealed for good reason.

  This adds analytics_recent_events: a READ VIEW over analytics_events
  exposing only the last 72 hours and only an explicit allowlist of
  columns and payload keys:

    id, created_at, event_type, movement_mode, data (jsonb)

  where `data` is built key-by-key from the payload allowlist below —
  timings, source/model/lane, settle truth (sounded/completed/
  attempts/engine/voice), the per-tour id and build id, and the
  pipeline_diag fields (stage/reason/message). The raw payload is
  NEVER exposed wholesale.

  HARD EXCLUSIONS, by construction: lat, lng (the GPS columns),
  session_id, user_id, and the `question` payload key (the text of
  question_asked events). Any payload key not on the allowlist is
  dropped, including keys added by future events until they are
  deliberately allowlisted here.

  The seal on analytics_events itself is untouched: no grants change
  on the base table, direct anon SELECT there still returns
  401/42501. The view reads as its owner (the established pattern —
  the rollup triggers do the same via SECURITY DEFINER), and only
  the projected columns can ever leave through it.

  The 72-hour window is rolling, so the view is self-cleaning: a
  forgotten view exposes at most three days of sanitized diagnostics,
  never an accumulating archive.

  Read it with the app's public key, e.g.:
    GET /rest/v1/analytics_recent_events?select=*&order=created_at.desc&limit=200
  Filter one tour: ...&data->>'tour_id'=eq.<uuid> — via REST:
    /rest/v1/analytics_recent_events?select=*&data=cs.{"tour_id":"<uuid>"}

  Reverse: DROP VIEW public.analytics_recent_events;
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
