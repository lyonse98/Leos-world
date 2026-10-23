/*
  # Make the returned distance match the declared return type

  ST_Distance returns double precision while the function declares distance_m
  as numeric, so the landmark branch raised a type error whenever a landmark
  actually matched. Explicit casts only; the logic and grants are unchanged.
*/

CREATE OR REPLACE FUNCTION public.find_nearby_cached_story(
  p_lat numeric,
  p_lng numeric,
  p_radius_m integer DEFAULT 100,
  p_version_key text DEFAULT NULL::text
)
RETURNS TABLE(story_text text, topic text, source text, distance_m numeric)
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  user_point geography;
BEGIN
  user_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  RETURN QUERY
  SELECT
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
