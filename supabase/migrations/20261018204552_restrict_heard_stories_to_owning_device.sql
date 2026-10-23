/*
  # Stop bulk access to per-device listening history

  The policies were named "own" but every predicate was `USING true`, so
  anyone could download every device's listening history with coordinates,
  and wipe or rewrite any of it. The app's own .eq('user_key', ...) filter is
  a query, not a policy: a direct caller simply omits it.

  There are no accounts, so ownership is the random per-device key. Direct
  SELECT is removed and the one legitimate read is served by a definer
  function that requires the caller to present that key, which turns a bulk
  dump into a lookup of an unguessable value. UPDATE and DELETE are removed
  outright: the client never performs either.
*/

DROP POLICY IF EXISTS "select_own_heard_stories" ON public.heard_stories;
DROP POLICY IF EXISTS "update_own_heard_stories" ON public.heard_stories;
DROP POLICY IF EXISTS "delete_own_heard_stories" ON public.heard_stories;

REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.heard_stories FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_heard_topics(
  p_user_key text,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(topic text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A caller must present the device key. Without it, nothing is returned,
  -- so there is no way to enumerate other devices.
  IF p_user_key IS NULL OR btrim(p_user_key) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT hs.topic
    FROM heard_stories hs
   WHERE hs.user_key = p_user_key
   ORDER BY hs.told_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
END;
$$;

REVOKE ALL ON FUNCTION public.get_heard_topics(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_heard_topics(text, integer) TO anon, authenticated;
