/*
  # Analytics daily rollup — the safe stats export (Oct 25, 2026)

  analytics_events is insert-only from the client by design (migration
  20261018204317): its rows carry GPS coordinates, so nobody — not even
  Muse — may read them back with the app's public key. Verified live
  Oct 25, 2026: anon SELECT returns 401 / 42501 permission denied.

  But the timing analysis still needs answers: how long does story text
  take, how long does voicing take, how long was the silence between
  stories, what share of stories came from cache — per day, per model.

  This migration creates analytics_daily_rollup: AGGREGATES ONLY.
  One row per (day, event_type, model, source, movement_mode) holding
  counts and sums — never a coordinate, never a session id, never a
  topic, never a question's text. A trigger keeps it current on every
  insert; a one-time backfill folds in the existing history (it runs
  here, as the migration owner — the only place raw rows are read).

  The rollup is world-readable ON PURPOSE (SELECT policy below): it is
  safe by construction, the same way the story cache is. Averages are
  computed by the reader from sum/count, so the stored math stays exact.

  Read it with the app's public key, e.g.:
    GET /rest/v1/analytics_daily_rollup?select=*&order=day.desc
*/

CREATE TABLE IF NOT EXISTS public.analytics_daily_rollup (
  day date NOT NULL,
  event_type text NOT NULL,
  model text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  movement_mode text NOT NULL DEFAULT '',
  event_count integer NOT NULL DEFAULT 0,
  timing_count integer NOT NULL DEFAULT 0,
  sum_fetch_s double precision NOT NULL DEFAULT 0,
  sum_synth_s double precision NOT NULL DEFAULT 0,
  sum_gap_s double precision NOT NULL DEFAULT 0,
  max_gap_s double precision NOT NULL DEFAULT 0,
  cache_hits integer NOT NULL DEFAULT 0,
  cache_misses integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event_type, model, source, movement_mode)
);

ALTER TABLE public.analytics_daily_rollup ENABLE ROW LEVEL SECURITY;

-- Public read of aggregates; writes belong to the trigger/backfill only.
DROP POLICY IF EXISTS "rollup_public_read" ON public.analytics_daily_rollup;
CREATE POLICY "rollup_public_read" ON public.analytics_daily_rollup
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.analytics_daily_rollup TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.analytics_daily_rollup FROM anon, authenticated;

-- Bulletproof numeric extraction: a malformed event_data value must
-- never make the trigger fail an analytics insert.
CREATE OR REPLACE FUNCTION public.safe_float(p_text text)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN p_text::double precision;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

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
    (new.created_at AT TIME ZONE 'UTC')::date,
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

-- One-time backfill of existing history (skips itself if the rollup
-- already has rows, so a manual re-run cannot double-count).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.analytics_daily_rollup) THEN
    INSERT INTO public.analytics_daily_rollup (
      day, event_type, model, source, movement_mode,
      event_count, timing_count,
      sum_fetch_s, sum_synth_s, sum_gap_s, max_gap_s,
      cache_hits, cache_misses
    )
    SELECT
      (created_at AT TIME ZONE 'UTC')::date,
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
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_rollup_analytics_event ON public.analytics_events;
CREATE TRIGGER trg_rollup_analytics_event
  AFTER INSERT ON public.analytics_events
  FOR EACH ROW EXECUTE FUNCTION public.rollup_analytics_event();
