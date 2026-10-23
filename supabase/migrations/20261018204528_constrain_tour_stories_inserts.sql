/*
  # Bound what the shared story cache will accept

  tour_stories is the shared cache: a story written by one listener is read
  back and spoken to the next listener at that spot. That sharing is the point
  of the feature, so public insert stays. What was missing is any limit on what
  a row may contain, so anyone could write unlimited arbitrary text at any
  coordinates on earth and have it narrated to other people.

  There are no accounts in this app, so there is no author to bind a row to.
  The control available is bounding the row itself: real text, a real topic,
  real coordinates, and a sane depth. Two overlapping permissive policies that
  both said `true` are replaced by one that does not.
*/

DROP POLICY IF EXISTS "Anyone can create tour stories" ON public.tour_stories;
DROP POLICY IF EXISTS "insert_tour_stories" ON public.tour_stories;
DROP POLICY IF EXISTS "Anyone can view tour stories" ON public.tour_stories;
DROP POLICY IF EXISTS "select_tour_stories" ON public.tour_stories;

CREATE POLICY "read_tour_stories"
  ON public.tour_stories
  FOR SELECT
  TO anon, authenticated
  USING (true);

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
    AND COALESCE(depth_level, 0) BETWEEN 0 AND 10
  );

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES ON public.tour_stories FROM anon, authenticated;
