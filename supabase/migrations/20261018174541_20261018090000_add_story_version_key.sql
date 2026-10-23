/*
# Story Cache Versioning

## Purpose
Make cached stories safe to change. Today a story written under one voice
(persona + model + prompt shape) is served forever, even after the voice
changes. This migration adds a version key to every cached story so a story is
only reused when it was written by the SAME voice AND from the SAME facts.

## 1. Modified table: tour_stories
- New column `version_key` (text, nullable) — a fingerprint combining the
  persona version, the model id, and a hash of the facts the story was written
  from (landmarks, area, mode). Stories generated before this migration have
  NULL and are treated as unversioned.

## 2. Modified function: find_nearby_cached_story
- Adds a 4th parameter `p_version_key text DEFAULT NULL`.
- When a version key is supplied, only cached stories with an EXACTLY matching
  version_key are returned. Landmark stories (hand-written, always valid) are
  unaffected and still returned regardless of version.
- When the parameter is NULL or omitted, behavior is unchanged (any cached
  story matches), so nothing breaks for older clients.
- The old 3-argument signature is dropped first so calls with 3 arguments are
  not ambiguous.

## 3. Indexes
- Partial index on `version_key` for the new filtered lookup path.

## Security
- No RLS changes. tour_stories keeps its existing public SELECT policy.
- Function remains SECURITY INVOKER with EXECUTE granted to anon and
  authenticated — no privilege escalation, no new access.
- No data is deleted or modified. The new column is additive and nullable.

## Notes
1. Unversioned rows (version_key IS NULL) stop being served for AI-generated
   lookups once the client always sends a version key. They remain in the
   table — nothing is lost.
2. Changing Leo's voice later means bumping the persona version in the app.
   Old stories then stop matching automatically; no manual purge needed.
*/

ALTER TABLE tour_stories ADD COLUMN IF NOT EXISTS version_key text;

CREATE INDEX IF NOT EXISTS tour_stories_version_key_idx
  ON tour_stories (version_key)
  WHERE version_key IS NOT NULL;

DROP FUNCTION IF EXISTS find_nearby_cached_story(numeric, numeric, integer);

CREATE OR REPLACE FUNCTION find_nearby_cached_story(
  p_lat numeric,
  p_lng numeric,
  p_radius_m integer DEFAULT 100,
  p_version_key text DEFAULT NULL
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

  -- 1. Hand-written landmark stories are always valid regardless of version.
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

  -- 2. Otherwise reuse an AI story only if it came from the same voice
  --    and the same facts.
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
      AND (p_version_key IS NULL OR ts.version_key = p_version_key)
      AND ST_DWithin(ts.location, user_point, p_radius_m)
    ORDER BY ST_Distance(ts.location, user_point), ts.created_at DESC
    LIMIT 1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION find_nearby_cached_story(numeric, numeric, integer, text) TO anon, authenticated;
