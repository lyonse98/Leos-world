/*
  # Analytics recent events — tell-geometry allowlist (Area G, Oct 26, 2026)

  Follow-up to 20261026233000. The tell-geometry instrumentation adds
  per-story RELATIVE geometry to story_played / story_playback /
  story_dropped / story_timing — a per-story correlation id joining a
  tell back to its serve decision, the subject's PUBLIC anchor
  coordinates, listener-to-subject distance and relative bearing,
  speed/heading, queue discipline, and the prediction error of the
  fetch that produced the story. Thirteen keys join the allowlist:

    story_id            correlation id, minted at the serve decision
    subject_lat         subject anchor latitude (public place coords)
    subject_lng         subject anchor longitude
    distance_m          listener-to-subject distance at the event
    bearing_offset_deg  relative bearing (0 = dead ahead, 180 = behind)
    speed_mps           listener speed at the event
    heading_deg         listener heading at the event
    queue_depth         waiting stories when the story was queued
    time_in_queue_s     queue wait, reported on the playback settle
    told_late           subject rear-hemisphere (>120°) at play start
    horizon_s           look-ahead horizon the fetch aimed with
    prediction_error_m  projected center vs actual play position
    center_offset_m     discovery center's offset ahead of the fetch

  HARD EXCLUSIONS, unchanged and structural: the LISTENER's absolute
  lat/lng remain absent — only the subject's public coordinates and
  listener-RELATIVE measurements are exposed. And route_breadcrumb
  events (the sealed-only route samples, Area G) are excluded from
  this view ENTIRELY — the new WHERE clause keeps them out even
  though the view's columns would otherwise match.

  Nothing else changes: same five columns, same 72-hour window, same
  grants, base table's seal untouched.

  Reverse: re-apply the 20261026233000 view body.
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
      -- Opener start edge + Puck opener identity
      ('ms_to_first_sound'),
      ('opener_id'),
      ('length_class'),
      ('segment'),
      -- Q&A lock release (question_lock_released)
      ('reason'),
      -- Pipeline diagnostics (pipeline_diag; also extended onto
      -- audio_blocked / quota_tripped)
      ('stage'),
      ('message'),
      -- Tell geometry (Area G): correlation + RELATIVE geometry only.
      -- subject_lat/subject_lng are the PUBLIC place coordinates;
      -- distance/bearing/speed/heading describe the listener only in
      -- relation to that subject. The listener's own absolute
      -- coordinates are NOT keys here and remain structurally absent.
      ('story_id'),
      ('subject_lat'),
      ('subject_lng'),
      ('distance_m'),
      ('bearing_offset_deg'),
      ('speed_mps'),
      ('heading_deg'),
      ('queue_depth'),
      ('time_in_queue_s'),
      ('told_late'),
      ('horizon_s'),
      ('prediction_error_m'),
      ('center_offset_m')
    ) AS k(key)
    CROSS JOIN LATERAL (
      SELECT coalesce(e.event_data, '{}'::jsonb) -> k.key AS val
    ) AS v
    WHERE v.val IS NOT NULL AND v.val <> 'null'::jsonb
  ), '{}'::jsonb) AS data
FROM public.analytics_events e
WHERE e.created_at > now() - interval '72 hours'
  -- Breadcrumbs are sealed-only forensic material (Area G): the route
  -- shape itself never enters the readable surface.
  AND e.event_type <> 'route_breadcrumb';

-- World-readable by design, like the rollups: safe by construction.
-- Deliberately NO access to analytics_events itself is granted here.
GRANT SELECT ON public.analytics_recent_events TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.analytics_recent_events FROM anon, authenticated;
