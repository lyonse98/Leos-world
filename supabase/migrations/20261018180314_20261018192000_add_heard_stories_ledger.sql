/*
# Heard-Story Ledger

## Purpose
Stop Leo telling the same story to the same person twice. Today the only
memory of "what has this listener already heard" is the current tour
(in-memory + localStorage), so a second drive through the same neighborhood
replays the same stories. This table gives each listener a durable record of
every story they have heard, across tours and sessions.

## 1. New table: heard_stories
- `id` (uuid, primary key)
- `session_id` (text, not null) — the tour session the story was heard in
- `user_key` (text, not null) — an anonymous per-device identifier generated
  in the browser and stored in local storage. Contains no personal
  information: a random string, not an email, name, or account id.
- `topic` (text, not null) — the landmark or subject the story was about,
  used for the "already heard this" check
- `story_text` (text, nullable) — the story itself, for future reuse
- `lat`, `lng` (numeric, nullable) — where it was heard
- `told_at` (timestamptz, not null, default now())

This table is deliberately NOT scoped by story version. If a listener has
heard the story about a place, they have heard it — a change to Leo's voice
should not cause them to be told it again.

## 2. Indexes
- `user_key` — the primary lookup path (fetch this listener's history)
- `(user_key, topic)` — the "has this person heard this story" check
- `told_at` — for pruning old rows

## 3. Security — read this before changing anything
RLS is enabled. The policies are `TO anon, authenticated` and permissive
(`USING (true)`), which means any holder of the anonymous API key can read and
write any row.

That is deliberate and it matches the rest of this app's data model: there is
NO sign-in screen, the browser talks to the database directly, and the app has
no server to authenticate a device. The `user_key` column scopes queries at
the application level — the client only ever asks for its own key — but it is
NOT a server-enforced boundary. Anyone who can call the API could supply a
different key.

This is an acceptable trade for an app with no accounts, and it is no weaker
than the existing `tour_stories` table, which already has a public SELECT
policy. It is NOT acceptable once accounts exist.

WHEN AUTH IS ADDED: add a `user_id uuid REFERENCES auth.users(id)` column,
backfill it, scope all four policies to `auth.uid() = user_id`, and drop the
`user_key`-based access entirely. Recorded history is preserved by the
backfill, so no data is lost in that migration.

## 4. Notes
1. Rows accumulate one per story heard. The app only reads the most recent 500
   per listener. Pruning old rows is a future concern.
2. Because the key lives in browser storage, clearing site data resets a
   listener's history. Acceptable trade for having no accounts.
3. No existing table is modified. No data is deleted or changed.
*/

CREATE TABLE IF NOT EXISTS heard_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_key text NOT NULL,
  topic text NOT NULL,
  story_text text,
  lat numeric,
  lng numeric,
  told_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE heard_stories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_heard_stories" ON heard_stories;
CREATE POLICY "select_own_heard_stories" ON heard_stories FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_heard_stories" ON heard_stories;
CREATE POLICY "insert_own_heard_stories" ON heard_stories FOR INSERT
  TO anon, authenticated WITH CHECK (user_key IS NOT NULL AND user_key <> '');

DROP POLICY IF EXISTS "update_own_heard_stories" ON heard_stories;
CREATE POLICY "update_own_heard_stories" ON heard_stories FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (user_key IS NOT NULL AND user_key <> '');

DROP POLICY IF EXISTS "delete_own_heard_stories" ON heard_stories;
CREATE POLICY "delete_own_heard_stories" ON heard_stories FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS heard_stories_user_key_idx ON heard_stories (user_key);
CREATE INDEX IF NOT EXISTS heard_stories_user_topic_idx ON heard_stories (user_key, topic);
CREATE INDEX IF NOT EXISTS heard_stories_told_at_idx ON heard_stories (told_at);
