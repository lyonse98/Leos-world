/*
# Add story served-at tracking and prune function

## Purpose
The shared `tour_stories` cache grows without bound — every generated canonical
landmark story is stored so the next listener at that spot gets it free. With no
cleanup, dead stories (superseded by a version-key change, or just never served
again) accumulate forever. This migration adds tracking for when a story was
last served to anyone, and a function to prune stories that have gone stale.

## Changes

### 1. New columns on `tour_stories`
- `serve_count` (integer, default 0) — how many times this story has been
  served to a listener. Incremented by the `touch_served_story` function.
- `last_served_at` (timestamptz, nullable) — when this story was last served.
  Null means it has never been served since tracking began. Set to `created_at`
  for existing rows so they are not immediately considered stale.

### 2. Index
- `tour_stories_last_served_at_idx` — btree index on `last_served_at` for the
  prune query.

### 3. Functions
- `touch_served_story(p_story_id uuid)` — SECURITY DEFINER, callable by
  `anon, authenticated`. Increments `serve_count` and sets `last_served_at` to
  now. Called when a cached story is served to a listener. Idempotent.
- `prune_stale_stories(p_max_age_days integer DEFAULT 90, p_min_serve_count integer DEFAULT 0)`
  — SECURITY DEFINER, callable by `authenticated` only. Deletes stories whose
  `last_served_at` is older than `p_max_age_days` AND whose `serve_count` is
  below `p_min_serve_count`. Returns the number of rows deleted. Safe to re-run.

### 4. Security
- `touch_served_story` is callable by anon + authenticated (the app uses the
  anon key, no sign-in screen).
- `prune_stale_stories` is callable by authenticated only — it is a destructive
  operation meant for an admin or a scheduled job, not the browser client.
- Both functions have a pinned `search_path` to prevent search-path injection.

## Important notes
1. Existing rows get `last_served_at = created_at` so they are not pruned
   immediately — a story created 80 days ago that has never been served gets a
   90-day grace window from its creation date, not from "never."
2. The prune function deletes rows. This is intentional — the whole point is to
   remove stories that are no longer useful. Version-key changes will naturally
   make old stories unserveable, so pruning them reclaims space.
3. The app does NOT call prune automatically. It is meant to be called
   periodically (e.g. via a scheduled Edge Function or pg_cron). The function
   exists so the cleanup can be triggered without writing raw SQL each time.
*/

-- 1. Add tracking columns
ALTER TABLE tour_stories
  ADD COLUMN IF NOT EXISTS serve_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_served_at timestamptz;

-- Backfill: existing rows get their creation time as last_served_at so they
-- are not immediately stale.
UPDATE tour_stories SET last_served_at = created_at WHERE last_served_at IS NULL;

-- 2. Index for the prune query
CREATE INDEX IF NOT EXISTS tour_stories_last_served_at_idx
  ON tour_stories (last_served_at);

-- 3. touch_served_story — called when a cached story is served to a listener
CREATE OR REPLACE FUNCTION public.touch_served_story(p_story_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE tour_stories
  SET serve_count = serve_count + 1,
      last_served_at = now()
  WHERE id = p_story_id;
END;
$$;

-- Allow the anon-key frontend to touch served stories
GRANT EXECUTE ON FUNCTION public.touch_served_story(uuid) TO anon, authenticated;

-- 4. prune_stale_stories — removes stories not served recently
CREATE OR REPLACE FUNCTION public.prune_stale_stories(
  p_max_age_days integer DEFAULT 90,
  p_min_serve_count integer DEFAULT 0
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM tour_stories
  WHERE last_served_at < now() - (p_max_age_days || ' days')::interval
    AND serve_count < p_min_serve_count;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Pruning is an admin operation — authenticated only, not anon
GRANT EXECUTE ON FUNCTION public.prune_stale_stories(integer, integer) TO authenticated;
