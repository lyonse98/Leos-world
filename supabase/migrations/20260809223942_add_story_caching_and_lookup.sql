/*
# Story Caching and Proximity Lookup

## Purpose
Reduce Gemini API usage by (1) checking the landmarks table for pre-written
stories before generating new ones, and (2) caching AI-generated stories in
tour_stories with spatial indexing so future visits to the same spot can reuse
them instead of calling Gemini again.

## Changes to existing tables

### tour_stories (modified)
- Added `context` (text, nullable) — the story context tag (e.g. 'new_landmarks', 'moved', 'stationary_neighborhood')
- Added `depth_level` (integer, default 0) — how deep into a stationary topic the story goes
- Added `location` (geography POINT 4326, nullable) — PostGIS point for spatial proximity queries
- Backfilled `location` from existing lat/lng rows
- Added GIST index on `location` for fast proximity lookups
- Added a BEFORE INSERT/UPDATE trigger that auto-populates `location` from lat/lng so the frontend never needs to construct geography values

### New function: find_nearby_cached_story(p_lat, p_lng, p_radius_m)
- Checks the `landmarks` table first for pre-written stories within each landmark's own radius_meters
- If no landmark story found, checks `tour_stories` for cached AI-generated stories within p_radius_m
- Returns (story_text, topic, source, distance_m) for the nearest match
- SECURITY INVOKER — runs as the caller's role, so existing public SELECT policies apply
- Granted EXECUTE to anon and authenticated so the no-auth frontend can call it

## Security
- No new tables created
- No RLS policy changes — existing public SELECT on landmarks and tour_stories is preserved
- Function is SECURITY INVOKER (not DEFINER) — no privilege escalation
- Trigger function is SECURITY DEFINER (required for triggers) but only sets a column value, no external side effects
*/

-- Add columns to tour_stories
ALTER TABLE tour_stories ADD COLUMN IF NOT EXISTS context text;
ALTER TABLE tour_stories ADD COLUMN IF NOT EXISTS depth_level integer DEFAULT 0;
ALTER TABLE tour_stories ADD COLUMN IF NOT EXISTS location geography(POINT, 4326);

-- Backfill location from existing lat/lng data
UPDATE tour_stories
SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
WHERE location IS NULL AND lat IS NOT NULL AND lng IS NOT NULL;

-- Spatial index for proximity queries
CREATE INDEX IF NOT EXISTS tour_stories_location_idx ON tour_stories USING GIST(location);

-- Trigger function: auto-populate location from lat/lng on insert or update
CREATE OR REPLACE FUNCTION set_tour_story_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop and recreate trigger for idempotency
DROP TRIGGER IF EXISTS set_tour_story_location_trigger ON tour_stories;
CREATE TRIGGER set_tour_story_location_trigger
  BEFORE INSERT OR UPDATE ON tour_stories
  FOR EACH ROW
  EXECUTE FUNCTION set_tour_story_location();

-- Lookup function: finds the nearest pre-written or cached story
CREATE OR REPLACE FUNCTION find_nearby_cached_story(
  p_lat numeric,
  p_lng numeric,
  p_radius_m integer DEFAULT 100
)
RETURNS TABLE (
  story_text text,
  topic text,
  source text,
  distance_m numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
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
$$;

-- Grant execute to anon and authenticated (no-auth app uses anon key)
GRANT EXECUTE ON FUNCTION find_nearby_cached_story(numeric, numeric, integer) TO anon, authenticated;
