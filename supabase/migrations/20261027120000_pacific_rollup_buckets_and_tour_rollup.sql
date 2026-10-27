/*
  # Pacific-time rollup buckets + per-tour rollup (Oct 27, 2026)

  Two changes to the safe stats export (20261025212500 daily rollup,
  20261025231500 topic rollup), both forced by the Oct 27 field test:

  1. DAY BUCKETS MOVE FROM UTC TO PACIFIC. The rollups bucketed by
     (created_at AT TIME ZONE 'UTC')::date, so one San Diego drive day
     split across two "days" at 5 PM Pacific — the Oct 27 morning
     commute landed half in Oct 27 and half in Oct 28 UTC. Trips are
     identified and compared in Pacific time, so both trigger functions
     are recreated with (created_at AT TIME ZONE 'America/Los_Angeles')
     ::date, and both rollups are REBUILT FROM SCRATCH from
     analytics_events below. The rebuild is the re-bucket: it is exact
     by construction (delete + regroup), and re-running this migration
     cannot double-count — the rebuild always reproduces the same rows
     from the raw events, and the tour backfill is guarded separately.
     Migrations run with owner rights, so reading the sealed raw table
     here is the same exception the original backfills used.

  2. analytics_tour_rollup: ONE ROW PER TOUR. The daily rollups cannot
     separate the six tours that ran on Oct 27 (session_starts are
     invisible inside a day bucket), so per-drive questions — how many
     stories, which sources, how many audio blocks and stale drops, the
     worst silence — were unanswerable. Every event the app writes
     carries event_data.tour_id (minted per tour by analytics.init) and
     event_data.build_id, so a trigger can maintain this table from the
     same insert path. AGGREGATES ONLY, same doctrine as the other
     rollups: counts, gap sums, first/last event instants. No
     coordinates, no topics, no question text. started_at_pt /
     ended_at_pt are the tour's first/last event instants read as
     Pacific wall-clock timestamps — a drive is identified by when it
     happened in San Diego, not by a UTC instant.

     Backfill covers only events that carry a tour_id. The app began
     stamping tour_id on Oct 26, 2026; earlier events have none and are
     skipped — their days remain visible in the daily/topic rollups.

  World-readable SELECT by design (safe by construction), writes
  trigger/backfill only, exactly like the other rollups.

  Read them with the app's public key, e.g.:
    GET /rest/v1/analytics_tour_rollup?select=*&order=started_at_pt.desc
*/

-- ---------------------------------------------------------------------
-- 1a. Daily rollup trigger function: Pacific day bucket.
--     Body identical to 20261025212500 except the bucket expression.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rollup_analytics_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data jsonb := coalesce(new.event_data, '{}'::jsonb);
  v_fetch double precision := public.safe_float(v_data->>'fetchTextS');
  v_synth double precision := public.safe_float(v_data->>'synthS');
  v_gap double precision := public.safe_float(v_data->>'gapS');
BEGIN
  INSERT INTO public.analytics_daily_rollup (
    day, event_type, model, source, movement_mode,
    event_count, timing_count,
    sum_fetch_s, sum_synth_s, sum_gap_s, max_gap_s,
    cache_hits, cache_misses
  ) VALUES (
    (new.created_at AT TIME ZONE 'America/Los_Angeles')::date,
    new.event_type,
    coalesce(v_data->>'model', ''),
    coalesce(v_data->>'source', ''),
    coalesce(new.movement_mode, ''),
    1,
    CASE WHEN v_fetch IS NOT NULL OR v_synth IS NOT NULL OR v_gap IS NOT NULL THEN 1 ELSE 0 END,
    coalesce(v_fetch, 0),
    coalesce(v_synth, 0),
    coalesce(v_gap, 0),
    coalesce(v_gap, 0),
    CASE WHEN v_data->>'cacheHit' = 'true' THEN 1 ELSE 0 END,
    CASE WHEN v_data->>'cacheHit' = 'false' THEN 1 ELSE 0 END
  )
  ON CONFLICT (day, event_type, model, source, movement_mode) DO UPDATE SET
    event_count  = public.analytics_daily_rollup.event_count + 1,
    timing_count = public.analytics_daily_rollup.timing_count + EXCLUDED.timing_count,
    sum_fetch_s  = public.analytics_daily_rollup.sum_fetch_s + EXCLUDED.sum_fetch_s,
    sum_synth_s  = public.analytics_daily_rollup.sum_synth_s + EXCLUDED.sum_synth_s,
    sum_gap_s    = public.analytics_daily_rollup.sum_gap_s + EXCLUDED.sum_gap_s,
    max_gap_s    = GREATEST(public.analytics_daily_rollup.max_gap_s, EXCLUDED.max_gap_s),
    cache_hits   = public.analytics_daily_rollup.cache_hits + EXCLUDED.cache_hits,
    cache_misses = public.analytics_daily_rollup.cache_misses + EXCLUDED.cache_misses;
  RETURN new;
END;
$$;

-- ---------------------------------------------------------------------
-- 1b. Topic rollup trigger function: Pacific day bucket.
--     Body identical to 20261025231500 except the bucket expression.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rollup_topic_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data jsonb := coalesce(new.event_data, '{}'::jsonb);
  v_topic text := v_data->>'topic';
BEGIN
  -- A story_played row without a usable topic contributes nothing.
  IF v_topic IS NULL OR btrim(v_topic) = '' THEN
    RETURN new;
  END IF;
  INSERT INTO public.analytics_topic_rollup (day, topic, source, event_count)
  VALUES (
    (new.created_at AT TIME ZONE 'America/Los_Angeles')::date,
    v_topic,
    coalesce(v_data->>'source', ''),
    1
  )
  ON CONFLICT (day, topic, source) DO UPDATE SET
    event_count = public.analytics_topic_rollup.event_count + 1;
  RETURN new;
END;
$$;

-- ---------------------------------------------------------------------
-- 1c. Re-bucket: rebuild both rollups from the raw events under the
--     Pacific day. Delete + regroup is exact and re-run safe: the
--     triggers above already bucket new inserts the same way, so the
--     rebuilt state equals what the triggers alone would have built.
-- ---------------------------------------------------------------------
DELETE FROM public.analytics_daily_rollup;
INSERT INTO public.analytics_daily_rollup (
  day, event_type, model, source, movement_mode,
  event_count, timing_count,
  sum_fetch_s, sum_synth_s, sum_gap_s, max_gap_s,
  cache_hits, cache_misses
)
SELECT
  (created_at AT TIME ZONE 'America/Los_Angeles')::date,
  event_type,
  coalesce(coalesce(event_data, '{}'::jsonb)->>'model', ''),
  coalesce(coalesce(event_data, '{}'::jsonb)->>'source', ''),
  coalesce(movement_mode, ''),
  count(*),
  sum(CASE WHEN public.safe_float(coalesce(event_data, '{}'::jsonb)->>'fetchTextS') IS NOT NULL
            OR public.safe_float(coalesce(event_data, '{}'::jsonb)->>'synthS') IS NOT NULL
            OR public.safe_float(coalesce(event_data, '{}'::jsonb)->>'gapS') IS NOT NULL
           THEN 1 ELSE 0 END),
  sum(coalesce(public.safe_float(coalesce(event_data, '{}'::jsonb)->>'fetchTextS'), 0)),
  sum(coalesce(public.safe_float(coalesce(event_data, '{}'::jsonb)->>'synthS'), 0)),
  sum(coalesce(public.safe_float(coalesce(event_data, '{}'::jsonb)->>'gapS'), 0)),
  max(coalesce(public.safe_float(coalesce(event_data, '{}'::jsonb)->>'gapS'), 0)),
  sum(CASE WHEN coalesce(event_data, '{}'::jsonb)->>'cacheHit' = 'true' THEN 1 ELSE 0 END),
  sum(CASE WHEN coalesce(event_data, '{}'::jsonb)->>'cacheHit' = 'false' THEN 1 ELSE 0 END)
FROM public.analytics_events
GROUP BY 1, 2, 3, 4, 5;

DELETE FROM public.analytics_topic_rollup;
INSERT INTO public.analytics_topic_rollup (day, topic, source, event_count)
SELECT
  (created_at AT TIME ZONE 'America/Los_Angeles')::date,
  coalesce(event_data, '{}'::jsonb)->>'topic',
  coalesce(coalesce(event_data, '{}'::jsonb)->>'source', ''),
  count(*)
FROM public.analytics_events
WHERE event_type = 'story_played'
  AND coalesce(event_data, '{}'::jsonb)->>'topic' IS NOT NULL
  AND btrim(coalesce(event_data, '{}'::jsonb)->>'topic') <> ''
GROUP BY 1, 2, 3;

-- ---------------------------------------------------------------------
-- 2. Per-tour rollup.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analytics_tour_rollup (
  tour_id text NOT NULL PRIMARY KEY,
  started_at_pt timestamp NOT NULL,
  ended_at_pt timestamp NOT NULL,
  build_id text NOT NULL DEFAULT '',
  stories_played integer NOT NULL DEFAULT 0,
  stories_live integer NOT NULL DEFAULT 0,
  stories_cache integer NOT NULL DEFAULT 0,
  stories_library integer NOT NULL DEFAULT 0,
  audio_blocked_count integer NOT NULL DEFAULT 0,
  story_dropped_count integer NOT NULL DEFAULT 0,
  sum_gap_s double precision NOT NULL DEFAULT 0,
  max_gap_s double precision NOT NULL DEFAULT 0,
  first_serve_source text NOT NULL DEFAULT ''
);

ALTER TABLE public.analytics_tour_rollup ENABLE ROW LEVEL SECURITY;

-- Public read of aggregates; writes belong to the trigger/backfill only.
DROP POLICY IF EXISTS "tour_rollup_public_read" ON public.analytics_tour_rollup;
CREATE POLICY "tour_rollup_public_read" ON public.analytics_tour_rollup
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.analytics_tour_rollup TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.analytics_tour_rollup FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.rollup_tour_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data jsonb := coalesce(new.event_data, '{}'::jsonb);
  v_tour text := v_data->>'tour_id';
  v_gap double precision := public.safe_float(v_data->>'gapS');
  v_pt timestamp := (new.created_at AT TIME ZONE 'America/Los_Angeles');
BEGIN
  -- Events written before tour_id stamping (pre Oct 26, 2026) carry no
  -- tour to attribute to — the daily/topic rollups still hold them.
  IF v_tour IS NULL OR btrim(v_tour) = '' THEN
    RETURN new;
  END IF;
  INSERT INTO public.analytics_tour_rollup (
    tour_id, started_at_pt, ended_at_pt, build_id,
    stories_played, stories_live, stories_cache, stories_library,
    audio_blocked_count, story_dropped_count,
    sum_gap_s, max_gap_s, first_serve_source
  ) VALUES (
    v_tour,
    v_pt,
    v_pt,
    coalesce(v_data->>'build_id', ''),
    CASE WHEN new.event_type = 'story_played' THEN 1 ELSE 0 END,
    CASE WHEN new.event_type = 'story_played' AND v_data->>'source' = 'live' THEN 1 ELSE 0 END,
    CASE WHEN new.event_type = 'story_played' AND v_data->>'source' = 'cache' THEN 1 ELSE 0 END,
    CASE WHEN new.event_type = 'story_played' AND v_data->>'source' = 'library' THEN 1 ELSE 0 END,
    CASE WHEN new.event_type = 'audio_blocked' THEN 1 ELSE 0 END,
    CASE WHEN new.event_type = 'story_dropped' THEN 1 ELSE 0 END,
    coalesce(v_gap, 0),
    coalesce(v_gap, 0),
    CASE WHEN new.event_type = 'first_serve' THEN coalesce(v_data->>'source', '') ELSE '' END
  )
  ON CONFLICT (tour_id) DO UPDATE SET
    started_at_pt = LEAST(public.analytics_tour_rollup.started_at_pt, EXCLUDED.started_at_pt),
    ended_at_pt   = GREATEST(public.analytics_tour_rollup.ended_at_pt, EXCLUDED.ended_at_pt),
    build_id      = CASE WHEN public.analytics_tour_rollup.build_id = ''
                         THEN EXCLUDED.build_id
                         ELSE public.analytics_tour_rollup.build_id END,
    stories_played       = public.analytics_tour_rollup.stories_played + EXCLUDED.stories_played,
    stories_live         = public.analytics_tour_rollup.stories_live + EXCLUDED.stories_live,
    stories_cache        = public.analytics_tour_rollup.stories_cache + EXCLUDED.stories_cache,
    stories_library      = public.analytics_tour_rollup.stories_library + EXCLUDED.stories_library,
    audio_blocked_count  = public.analytics_tour_rollup.audio_blocked_count + EXCLUDED.audio_blocked_count,
    story_dropped_count  = public.analytics_tour_rollup.story_dropped_count + EXCLUDED.story_dropped_count,
    sum_gap_s = public.analytics_tour_rollup.sum_gap_s + EXCLUDED.sum_gap_s,
    max_gap_s = GREATEST(public.analytics_tour_rollup.max_gap_s, EXCLUDED.max_gap_s),
    -- The tour's first first_serve wins; later ones (restarts inside a
    -- tour) leave the original serve source standing.
    first_serve_source = CASE WHEN public.analytics_tour_rollup.first_serve_source = ''
                              THEN EXCLUDED.first_serve_source
                              ELSE public.analytics_tour_rollup.first_serve_source END;
  RETURN new;
END;
$$;

-- One-time backfill of tour-carrying history (skips itself if the tour
-- rollup already has rows, so a manual re-run cannot double-count;
-- the trigger keeps it current from the moment this migration lands).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.analytics_tour_rollup) THEN
    INSERT INTO public.analytics_tour_rollup (
      tour_id, started_at_pt, ended_at_pt, build_id,
      stories_played, stories_live, stories_cache, stories_library,
      audio_blocked_count, story_dropped_count,
      sum_gap_s, max_gap_s, first_serve_source
    )
    SELECT
      d->>'tour_id',
      min(created_at AT TIME ZONE 'America/Los_Angeles'),
      max(created_at AT TIME ZONE 'America/Los_Angeles'),
      coalesce(max(d->>'build_id'), ''),
      count(*) FILTER (WHERE event_type = 'story_played'),
      count(*) FILTER (WHERE event_type = 'story_played' AND d->>'source' = 'live'),
      count(*) FILTER (WHERE event_type = 'story_played' AND d->>'source' = 'cache'),
      count(*) FILTER (WHERE event_type = 'story_played' AND d->>'source' = 'library'),
      count(*) FILTER (WHERE event_type = 'audio_blocked'),
      count(*) FILTER (WHERE event_type = 'story_dropped'),
      coalesce(sum(public.safe_float(d->>'gapS')), 0),
      coalesce(max(public.safe_float(d->>'gapS')), 0),
      coalesce(
        (array_agg(d->>'source' ORDER BY created_at) FILTER (WHERE event_type = 'first_serve'))[1],
        ''
      )
    FROM public.analytics_events
    CROSS JOIN LATERAL (SELECT coalesce(event_data, '{}'::jsonb) AS d) AS x
    WHERE coalesce(d->>'tour_id', '') <> ''
    GROUP BY 1;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_rollup_tour_event ON public.analytics_events;
CREATE TRIGGER trg_rollup_tour_event
  AFTER INSERT ON public.analytics_events
  FOR EACH ROW EXECUTE FUNCTION public.rollup_tour_event();
