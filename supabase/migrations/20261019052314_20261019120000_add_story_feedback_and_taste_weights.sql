/*
# Story Feedback — the taste signal that makes Leo get better

## Purpose
Leo currently decides which story to tell from the landmark, the distance,
and whether the listener has heard it before. Nothing in that model knows
whether the listener actually *enjoyed* the last story. This migration adds
the missing half: a durable record of what this listener liked and did not
like, plus a server-side aggregation that turns those ratings into per-tag
preference weights.

The point is the loop. Every rating sharpens the next story selection, so a
listener's own tours produce a ranked picture of what works for them — an
asset that starts at zero for anyone else.

## 1. New table: story_feedback
One row per rated story, per listener, per tour.

- `id` (uuid, primary key)
- `user_key` (text, not null) — the anonymous per-device identifier already
  used by `heard_stories`. A random string from local storage: no email, no
  name, no account. It is what lets the app recognise "this listener" across
  tours without asking anyone to sign in.
- `session_id` (text, not null, default '') — the tour the rating happened on.
  Defaulted to an empty string rather than left null so the uniqueness rule
  below works for every row.
- `topic` (text, not null) — the landmark or subject the story was about.
- `lat`, `lng` (numeric, nullable) — where it was rated.
- `value` (smallint, not null) — +1 (enjoyed) or -1 (not for me). Deliberately
  only two values: a scale invites indecision, and on a drive there is no time
  for nuance.
- `source` (text, not null) — how the rating was given:
  - `explicit` — the listener tapped a thumb or said "more like this".
  - `skip` — the listener skipped the story very early. Recorded separately
    from an explicit rating because a skip is ambiguous: it may mean "not my
    subject" or merely "wrong moment". The app weights it far lower, and it
    only counts when the story was abandoned in the first few seconds.
- `skip_seconds` (numeric, nullable) — how long the story played before the
  skip. Null for explicit ratings.
- `tags` (text[], not null, default '{}') — the subject tags the story carried
  (for example `{crime,people,driving}`). This is what makes taste portable:
  a rating attaches to the *kind* of story, not just that one story, so one
  thumbs-up on a Prohibition tale also lifts other Prohibition tales.
- `rated_at` (timestamptz, not null, default now()) — when it was rated.

Constraints bound every client-supplied field: value must be +1 or -1, source
must be `explicit` or `skip`, topic 1–300 characters, at most 24 tags, and
skip_seconds between 0 and 3600.

### Uniqueness
A unique index on `(user_key, session_id, topic, source)` means a listener can
hold at most one rating per story per tour per source. Tapping a thumb twice,
or changing your mind and tapping the other thumb, updates the existing row
instead of inflating the score. Skips and explicit ratings are tracked as
separate rows on purpose — they are different signals and both are kept.

## 2. New functions

### `record_story_feedback(...)`
The single write path. Inserts or updates one rating. Passing `p_value = 0`
deletes the rating instead, which is how the app implements "tap the same
thumb again to undo" — important while driving, where a mis-tap should be
trivially reversible.

### `get_taste_weights(p_user_key, p_limit)`
Returns one row per tag with three numbers:
- `score` — the decayed sum of ratings. Each rating counts for less as it ages
  (a 60-day half-life), so taste tracks the listener as they change rather
  than averaging their entire history forever.
- `weight` — the decayed total number of ratings behind that tag, i.e. how
  much evidence there is.
- `n` — the raw count of ratings, for diagnostics.

The decay is computed here because it is cheap in SQL and does not need to
change. The smoothing and scaling that turn `score`/`weight` into an actual
score contribution live in the app, so they can be tuned without a migration.

## 3. Security — read this before changing anything
RLS is enabled on `story_feedback`, with the four standard policies present.

**All direct table access is revoked from the client.** The `anon` and
`authenticated` roles hold NO privileges on this table. Every read and write
goes through the two `SECURITY DEFINER` functions above, both of which pin
`search_path` to `public, pg_temp` so a caller cannot shadow a name they call.

This is deliberately stricter than the older tables in this database. Ratings
are the asset this whole feature exists to build, so the browser is given no
way to enumerate or edit them — not even its own. It can only append a rating
for the key it presents, and can only read back aggregate weights for that
same key.

Like `heard_stories`, the `user_key` is an application-level scope, not a
server-enforced identity: the app has no sign-in, so nothing proves the caller
owns the key it sends. That is an accepted trade for an account-less app and
is no weaker than the existing tables.

WHEN AUTH IS ADDED: add `user_id uuid REFERENCES auth.users(id)`, backfill it,
scope the function bodies to `auth.uid() = user_id`, and stop accepting
`p_user_key` from the client. Recorded ratings survive that migration intact.

## 4. Notes
1. Rows accumulate one per rated story. The app reads at most 200 tag weights
   per listener. Pruning is a future concern.
2. Because the key lives in browser storage, clearing site data resets a
   listener's taste profile. Accepted trade for having no accounts.
3. No existing table is modified. No data is deleted or changed. With no
   ratings recorded, every aggregate is empty and Leo's behaviour is exactly
   what it is today — the feature degrades to a no-op rather than to a
   regression.
*/

CREATE TABLE IF NOT EXISTS story_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key text NOT NULL,
  session_id text NOT NULL DEFAULT '',
  topic text NOT NULL,
  lat numeric,
  lng numeric,
  value smallint NOT NULL,
  source text NOT NULL,
  skip_seconds numeric,
  tags text[] NOT NULL DEFAULT '{}',
  rated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT story_feedback_value_check CHECK (value IN (-1, 1)),
  CONSTRAINT story_feedback_source_check CHECK (source IN ('explicit', 'skip')),
  CONSTRAINT story_feedback_topic_len_check CHECK (length(btrim(topic)) BETWEEN 1 AND 300),
  CONSTRAINT story_feedback_tags_len_check CHECK (array_length(tags, 1) IS NULL OR array_length(tags, 1) <= 24),
  CONSTRAINT story_feedback_skip_seconds_check CHECK (skip_seconds IS NULL OR (skip_seconds >= 0 AND skip_seconds <= 3600))
);

ALTER TABLE story_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_story_feedback" ON story_feedback;
CREATE POLICY "select_story_feedback" ON story_feedback FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_story_feedback" ON story_feedback;
CREATE POLICY "insert_story_feedback" ON story_feedback FOR INSERT
  TO anon, authenticated WITH CHECK (user_key IS NOT NULL AND user_key <> '');

DROP POLICY IF EXISTS "update_story_feedback" ON story_feedback;
CREATE POLICY "update_story_feedback" ON story_feedback FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (user_key IS NOT NULL AND user_key <> '');

DROP POLICY IF EXISTS "delete_story_feedback" ON story_feedback;
CREATE POLICY "delete_story_feedback" ON story_feedback FOR DELETE
  TO anon, authenticated USING (true);

-- The browser gets no direct access to this table. Both functions below are
-- SECURITY DEFINER and are the only way in or out.
REVOKE ALL ON story_feedback FROM anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS story_feedback_unique_idx
  ON story_feedback (user_key, session_id, topic, source);
CREATE INDEX IF NOT EXISTS story_feedback_user_key_idx ON story_feedback (user_key);
CREATE INDEX IF NOT EXISTS story_feedback_rated_at_idx ON story_feedback (rated_at);

CREATE OR REPLACE FUNCTION record_story_feedback(
  p_user_key text,
  p_session_id text,
  p_topic text,
  p_lat numeric,
  p_lng numeric,
  p_value integer,
  p_source text,
  p_skip_seconds numeric,
  p_tags text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session text := btrim(COALESCE(p_session_id, ''));
  v_topic text := btrim(COALESCE(p_topic, ''));
  v_source text := CASE WHEN p_source = 'skip' THEN 'skip' ELSE 'explicit' END;
BEGIN
  IF p_user_key IS NULL OR length(btrim(p_user_key)) = 0 OR length(btrim(p_user_key)) > 200 THEN
    RAISE EXCEPTION 'invalid user key';
  END IF;

  IF v_topic = '' OR length(v_topic) > 300 THEN
    RAISE EXCEPTION 'invalid topic';
  END IF;

  -- Value 0 is the undo path: the listener tapped the same thumb twice.
  IF p_value = 0 THEN
    DELETE FROM story_feedback
     WHERE user_key = btrim(p_user_key)
       AND session_id = v_session
       AND topic = v_topic
       AND source = v_source;
    RETURN;
  END IF;

  IF p_value NOT IN (-1, 1) THEN
    RAISE EXCEPTION 'invalid value';
  END IF;

  INSERT INTO story_feedback (
    user_key, session_id, topic, lat, lng, value, source, skip_seconds, tags, rated_at
  )
  VALUES (
    btrim(p_user_key),
    v_session,
    v_topic,
    p_lat,
    p_lng,
    p_value::smallint,
    v_source,
    CASE WHEN p_skip_seconds IS NULL THEN NULL ELSE GREATEST(0, LEAST(p_skip_seconds, 3600)) END,
    COALESCE(p_tags, '{}'),
    now()
  )
  ON CONFLICT (user_key, session_id, topic, source) DO UPDATE
    SET value = EXCLUDED.value,
        tags = EXCLUDED.tags,
        skip_seconds = EXCLUDED.skip_seconds,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        rated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION get_taste_weights(
  p_user_key text,
  p_limit integer DEFAULT 60
)
RETURNS TABLE(tag text, score numeric, weight numeric, n bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH rated AS (
    SELECT f.value::double precision AS v,
           EXTRACT(EPOCH FROM (now() - f.rated_at)) / 86400.0 AS age_days,
           t.tag
      FROM story_feedback f
      CROSS JOIN LATERAL unnest(f.tags) AS t(tag)
     WHERE p_user_key IS NOT NULL
       AND f.user_key = btrim(p_user_key)
       AND f.tags IS NOT NULL
  ),
  decayed AS (
    -- 60-day half-life constant: recent taste outweighs old taste.
    SELECT tag,
           v * exp(-(age_days / 60.0)) AS weighted_value,
           exp(-(age_days / 60.0)) AS weighted_count
      FROM rated
  )
  SELECT tag,
         SUM(weighted_value)::numeric AS score,
         SUM(weighted_count)::numeric AS weight,
         COUNT(*)::bigint AS n
    FROM decayed
   GROUP BY tag
   ORDER BY weight DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200);
$$;
