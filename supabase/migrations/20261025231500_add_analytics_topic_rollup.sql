/*
  # Analytics topic rollup — which places Leo actually tells about

  Approved explicitly by Erik on Oct 25, 2026. Until now the stats export
  (20261025212500) deliberately carried NO topics: a per-place tally is
  also a coarse tally of where drives happen, so it waited for his word.

  This adds analytics_topic_rollup: counts of story_played events per
  (day, topic, source). Topic is the place name exactly as the app
  displays it ("Balboa Park"); source is 'cache' or 'live'. That is the
  whole payload — day-granular counts of place names. No session id, no
  user, no coordinates, no timestamps finer than a day: coarser than the
  sealed raw rows by construction, same doctrine as the daily rollup.

  Purpose: rank the places Leo tells about most (and how often they were
  already free from cache) to seed the San Diego library build.

  A trigger keeps it current on every story_played insert; a one-time
  backfill folds in existing history (runs here, as the migration owner —
  the only place raw rows are read). World-readable SELECT by design,
  writes trigger-only, exactly like analytics_daily_rollup.

  Read it with the app's public key, e.g.:
    GET /rest/v1/analytics_topic_rollup?select=*&order=event_count.desc
*/

CREATE TABLE IF NOT EXISTS public.analytics_topic_rollup (
  day date NOT NULL,
  topic text NOT NULL,
  source text NOT NULL DEFAULT '',
  event_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, topic, source)
);

ALTER TABLE public.analytics_topic_rollup ENABLE ROW LEVEL SECURITY;

-- Public read of aggregates; writes belong to the trigger/backfill only.
DROP POLICY IF EXISTS "topic_rollup_public_read" ON public.analytics_topic_rollup;
CREATE POLICY "topic_rollup_public_read" ON public.analytics_topic_rollup
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.analytics_topic_rollup TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.analytics_topic_rollup FROM anon, authenticated;

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
    (new.created_at AT TIME ZONE 'UTC')::date,
    v_topic,
    coalesce(v_data->>'source', ''),
    1
  )
  ON CONFLICT (day, topic, source) DO UPDATE SET
    event_count = public.analytics_topic_rollup.event_count + 1;
  RETURN new;
END;
$$;

-- One-time backfill of existing history (skips itself if the topic
-- rollup already has rows, so a manual re-run cannot double-count).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.analytics_topic_rollup) THEN
    INSERT INTO public.analytics_topic_rollup (day, topic, source, event_count)
    SELECT
      (created_at AT TIME ZONE 'UTC')::date,
      coalesce(event_data, '{}'::jsonb)->>'topic',
      coalesce(coalesce(event_data, '{}'::jsonb)->>'source', ''),
      count(*)
    FROM public.analytics_events
    WHERE event_type = 'story_played'
      AND coalesce(event_data, '{}'::jsonb)->>'topic' IS NOT NULL
      AND btrim(coalesce(event_data, '{}'::jsonb)->>'topic') <> ''
    GROUP BY 1, 2, 3;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_rollup_topic_event ON public.analytics_events;
CREATE TRIGGER trg_rollup_topic_event
  AFTER INSERT ON public.analytics_events
  FOR EACH ROW
  WHEN (new.event_type = 'story_played')
  EXECUTE FUNCTION public.rollup_topic_event();
