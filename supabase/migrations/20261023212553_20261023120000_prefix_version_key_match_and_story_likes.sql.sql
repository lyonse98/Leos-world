/*
# Prefix version-key match + story_likes table

## Purpose
Two changes in one migration:

1. **Prefix version-key matching in find_nearby_cached_story**: The preliminary
   cache lookup in the frontend passes a partial version key (just the persona
   version + model ID, without the fact-pack hash). The current function uses
   exact equality (`ts.version_key = p_version_key`), which means a partial key
   never matches. Change to prefix matching (`starts_with`) so a partial key
   like `leo-v7|gemini-3.8-flash|` matches any story written under that persona
   version and model, regardless of the fact-pack hash. This prevents old-persona
   stories (leo-v1 through v6, which may contain slang and meter distances) from
   being served by the preliminary lookup.

   When a FULL version key is passed (as the secondary lookup does), the prefix
   match still works correctly — a full key is a prefix of itself.

2. **New table: story_likes**: A simple ledger of "likes" (heart taps) from
   listeners, stored for future analysis of which stories resonate. No dislike,
   no taste tailoring yet — just data collection.

## 1. Modified function: find_nearby_cached_story
- Changed the version-key filter from `ts.version_key = p_version_key` to
  `ts.version_key LIKE p_version_key || '%'` when a version key is provided.
- This makes both partial and full version keys work correctly.

## 2. New table: story_likes
- `id` (uuid, primary key)
- `topic` (text, not null) — the story subject the listener liked
- `story_text` (text) — the story content, for future analysis
- `lat` (numeric, not null) — listener's latitude when they liked it
- `lng` (numeric, not null) — listener's longitude when they liked it
- `session_id` (text) — the tour session
- `created_at` (timestamptz, default now())

## Security
- RLS enabled on story_likes.
- Grants: INSERT only to anon + authenticated (listeners can like, but cannot
  read or modify likes — this is a write-only ledger).
- No SELECT/UPDATE/DELETE grants — analytics queries run server-side.
- No new policies on tour_stories or landmarks.

## Notes
1. The version-key change is backward compatible — existing callers that pass
   a full version key still match their own stories (a string is a prefix of
   itself). Callers that pass NULL still skip the filter entirely.
2. story_likes is intentionally write-only from the client perspective. The
   backend can read it for analytics.
*/

-- 1. Recreate find_nearby_cached_story with prefix matching on version_key
DROP FUNCTION IF EXISTS public.find_nearby_cached_story(numeric, numeric, integer, text, text[]);

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
  --    persona version and model (prefix match on version_key), AND covers
  --    an angle this listener has not already been told.
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
      AND (p_version_key IS NULL OR starts_with(ts.version_key, p_version_key))
      AND (ts.angle IS NULL OR ts.angle <> ALL(p_excluded_angles))
      AND ST_DWithin(ts.location, user_point, p_radius_m)
    ORDER BY ST_Distance(ts.location, user_point), ts.created_at DESC
    LIMIT 1;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.find_nearby_cached_story(numeric, numeric, integer, text, text[]) TO anon, authenticated;

-- 2. Create story_likes table
CREATE TABLE IF NOT EXISTS story_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  story_text text,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  session_id text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE story_likes ENABLE ROW LEVEL SECURITY;

-- Write-only: listeners can insert likes but cannot read, update, or delete.
GRANT INSERT ON story_likes TO anon, authenticated;

DROP POLICY IF EXISTS "insert_story_likes" ON story_likes;
CREATE POLICY "insert_story_likes"
  ON story_likes FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    topic IS NOT NULL
    AND length(btrim(topic)) BETWEEN 1 AND 300
    AND lat BETWEEN -90 AND 90
    AND lng BETWEEN -180 AND 180
    AND (session_id IS NULL OR length(session_id) <= 200)
  );
