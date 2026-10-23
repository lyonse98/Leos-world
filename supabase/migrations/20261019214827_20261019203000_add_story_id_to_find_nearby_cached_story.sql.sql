/*
# Add story id to find_nearby_cached_story return

## Purpose
The `touch_served_story` function needs the story's UUID to increment its serve
count. The existing `find_nearby_cached_story` function returns story_text,
topic, source, and distance_m — but not the id. This migration drops and
recreates the function to also return `story_id`, so the frontend can call
`touch_served_story` after serving a cached story.

## Changes
1. Drops the existing `find_nearby_cached_story` function (return type change
   requires DROP + CREATE, not CREATE OR REPLACE).
2. Recreates it with `story_id uuid` as the first column.
3. Grants EXECUTE to anon + authenticated (same as before).

## Security
- No new policies. The function reads from `landmarks` and `tour_stories`,
  which already have SELECT policies for anon + authenticated.
*/

DROP FUNCTION IF EXISTS public.find_nearby_cached_story(numeric, numeric, integer, text);

CREATE FUNCTION public.find_nearby_cached_story(
  p_lat numeric,
  p_lng numeric,
  p_radius_m integer DEFAULT 100,
  p_version_key text DEFAULT NULL
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
    AND ST_DWithin(ts.location, user_point, p_radius_m)
    ORDER BY ST_Distance(ts.location, user_point), ts.created_at DESC
    LIMIT 1;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.find_nearby_cached_story(numeric, numeric, integer, text) TO anon, authenticated;
