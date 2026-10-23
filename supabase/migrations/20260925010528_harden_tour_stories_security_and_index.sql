/*
# Harden tour_stories security, add spatial index, fix function search_path

## Summary
Locks down tour_stories with proper RLS policies, adds a GiST spatial index
on the `location` geography column, and sets a safe search_path on
find_nearby_cached_story.

## Changes

### 1. RLS policies on tour_stories (no-auth app — open read/write to anon+authenticated)
- SELECT: allow anon + authenticated (stories are intentionally shared/public)
- INSERT: allow anon + authenticated (the app writes stories without login)
- UPDATE: deny all (no policy = blocked by RLS)
- DELETE: deny all (no policy = blocked by RLS)

### 2. GiST spatial index on tour_stories.location (geography column)
- Speeds up find_nearby_cached_story as the table grows

### 3. Fix find_nearby_cached_story search_path
- Sets search_path = public to prevent search_path injection
- Preserves the original function logic (checks landmarks first, then cache)

### Notes
- This is a no-auth app. The anon key is used for all database access.
- UPDATE and DELETE are intentionally denied — stories are append-only.
*/

-- 1. RLS policies
ALTER TABLE tour_stories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_tour_stories" ON tour_stories;
DROP POLICY IF EXISTS "insert_tour_stories" ON tour_stories;
DROP POLICY IF EXISTS "update_tour_stories" ON tour_stories;
DROP POLICY IF EXISTS "delete_tour_stories" ON tour_stories;

CREATE POLICY "select_tour_stories" ON tour_stories FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "insert_tour_stories" ON tour_stories FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- 2. GiST spatial index
CREATE INDEX IF NOT EXISTS idx_tour_stories_location
  ON tour_stories USING GIST (location);

-- 3. Fix find_nearby_cached_story search_path
DROP FUNCTION IF EXISTS find_nearby_cached_story(numeric, numeric, integer);
CREATE OR REPLACE FUNCTION find_nearby_cached_story(
  p_lat numeric,
  p_lng numeric,
  p_radius_m integer DEFAULT 100
)
RETURNS TABLE(
  story_text text,
  topic text,
  source text,
  distance_m numeric
)
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  user_point geography;
BEGIN
  user_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  -- 1. Check landmarks table for pre-written stories
  RETURN QUERY
  SELECT
    l.story AS story_text,
    l.name AS topic,
    'landmark'::text AS source,
    ST_Distance(l.location, user_point) AS distance_m
  FROM landmarks l
  WHERE ST_DWithin(l.location, user_point, l.radius_meters)
  ORDER BY ST_Distance(l.location, user_point)
  LIMIT 1;

  -- 2. If no landmark found, check cached AI-generated stories
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      ts.story_text,
      ts.topic,
      'cache'::text AS source,
      ST_Distance(ts.location, user_point) AS distance_m
    FROM tour_stories ts
    WHERE ts.location IS NOT NULL
      AND ts.story_text IS NOT NULL
      AND ts.story_text <> ''
      AND ST_DWithin(ts.location, user_point, p_radius_m)
    ORDER BY ST_Distance(ts.location, user_point), ts.created_at DESC
    LIMIT 1;
  END IF;
END;
$function$;