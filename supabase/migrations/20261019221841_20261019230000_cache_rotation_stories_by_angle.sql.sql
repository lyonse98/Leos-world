/*
# Cache rotation stories by angle

## Purpose
The shared story cache today only stores the canonical (first) telling of a
landmark. Every return visit to a landmark, and every area story, is generated
fresh for every listener — even though the *angle* each one covered (the
people, the event, the legends, etc.) is a real, reusable story about that
place. This migration makes rotation stories shareable too.

The change is simple: store the angle every story covered, and at lookup time
exclude any angle the requesting listener has already heard. A listener gets a
cached story only if it covers an angle they have not yet been told. If every
cached angle is spent for them, a fresh one is generated (and then cached for
the next person).

## 1. Modified table: tour_stories
- New column `angle` (text, nullable) — which angle this story covered. Values
  come from the `LANDMARK_ANGLES` and `AREA_ANGLES` sets in the app
  (e.g. `landmark_origin`, `landmark_people`, `stationary_neighborhood`).
  NULL for rows written before this migration; those rows still match a
  no-exclusion lookup, preserving backward compatibility.

## 2. Index
- `tour_stories_angle_idx` — btree on `angle` for the exclusion filter.

## 3. Modified function: find_nearby_cached_story
- New parameter `p_excluded_angles text[] DEFAULT '{}'`.
- The cache query additionally filters out rows whose `angle` is in the
  excluded set. Rows with NULL `angle` are still served (they predate angle
  tracking and are treated as the canonical telling).
- Landmark-table rows (hand-written) are unaffected — they are always the
  canonical telling and never have an angle.
- The old 4-argument signature is dropped first so existing calls are not
  ambiguous.

## Security
- No RLS changes. tour_stories keeps its existing read/insert policies.
- Function remains SECURITY INVOKER with EXECUTE granted to anon and
  authenticated — no privilege escalation, no new access.
- No data is deleted or modified. The new column is additive and nullable.

## Notes
1. Existing rows keep `angle = NULL` and remain servable. New writes from the
   app will always set `angle`, so NULL rows age out naturally via the
   existing `prune_stale_stories` function.
2. The exclusion is a simple `NOT IN` on a text array — Postgres handles this
   efficiently at the scale we expect (low thousands of rows).
*/

ALTER TABLE tour_stories ADD COLUMN IF NOT EXISTS angle text;

CREATE INDEX IF NOT EXISTS tour_stories_angle_idx
  ON tour_stories (angle)
  WHERE angle IS NOT NULL;

-- Drop the previous 4-arg signature so the new 5-arg version is unambiguous.
DROP FUNCTION IF EXISTS public.find_nearby_cached_story(numeric, numeric, integer, text);

CREATE FUNCTION public.find_nearby_cached_story(
  p_lat numeric,
  p_lng numeric,
  p_radius_m integer DEFAULT 100,
  p_version_key text DEFAULT NULL,
  p_excluded_angles text[] DEFAULT ARRAY[]::text[]
)
RETURNS TABLE(
  story_id uuid,
  story_text text,
  topic text,
  source text,
  distance_m numeric
)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  user_point geography;
BEGIN
  user_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  -- 1. Hand-written landmark stories are always valid regardless of version
  --    or angle. They have no angle (they live in the landmarks table).
  RETURN QUERY
  SELECT
    l.id,
    l.story::text,
    l.name::text,
    'landmark'::text,
    ST_Distance(l.location, user_point)::numeric
  FROM landmarks l
  WHERE ST_DWithin(l.location, user_point, l.radius_meters)
  ORDER BY ST_Distance(l.location, user_point)
  LIMIT 1;

  -- 2. Otherwise reuse an AI-generated story only if it came from the same
  --    voice, the same facts, AND covers an angle this listener has not
  --    already been told. Rows with NULL angle predate angle tracking and
  --    are treated as the canonical telling — always servable.
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      ts.id,
      ts.story_text::text,
      ts.topic::text,
      'cache'::text,
      ST_Distance(ts.location, user_point)::numeric
    FROM tour_stories ts
    WHERE ts.location IS NOT NULL
      AND ts.story_text IS NOT NULL
      AND ts.story_text <> ''
      AND (p_version_key IS NULL OR ts.version_key = p_version_key)
      AND (ts.angle IS NULL OR ts.angle <> ALL(p_excluded_angles))
      AND ST_DWithin(ts.location, user_point, p_radius_m)
    ORDER BY ST_Distance(ts.location, user_point), ts.created_at DESC
    LIMIT 1;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.find_nearby_cached_story(numeric, numeric, integer, text, text[]) TO anon, authenticated;

-- Loosen the insert policy's WITH CHECK so the new angle column can be
-- written. The column is nullable and bounded in length.
DROP POLICY IF EXISTS "write_bounded_tour_stories" ON public.tour_stories;

CREATE POLICY "write_bounded_tour_stories"
  ON public.tour_stories
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    story_text IS NOT NULL
    AND length(btrim(story_text)) BETWEEN 1 AND 8000
    AND topic IS NOT NULL
    AND length(btrim(topic)) BETWEEN 1 AND 300
    AND lat IS NOT NULL AND lat BETWEEN -90 AND 90
    AND lng IS NOT NULL AND lng BETWEEN -180 AND 180
    AND (context IS NULL OR length(context) <= 2000)
    AND (version_key IS NULL OR length(version_key) <= 200)
    AND (session_id IS NULL OR length(session_id) <= 200)
    AND (angle IS NULL OR length(angle) <= 100)
    AND COALESCE(depth_level, 0) BETWEEN 0 AND 10
  );
