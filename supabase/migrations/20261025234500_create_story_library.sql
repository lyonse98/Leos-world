/*
  # Story library — curated "recorded episodes" (Oct 25, 2026)

  The shared story cache (tour_stories) is keyed by persona version: bump
  the persona and every cached story stops being served — deliberate for
  throwaway drive-cache, wrong for a curated library. A library entry is
  an ASSET, not a cache miss that happened to be filled early.

  So the library lives in its OWN table, keyed by (place, angle):

  - place_key is the normalized place name (lowercase, trimmed — the
    storyLibrary.normalizePlaceKey function in the app is the one source
    of truth, and the builder uses the same function).
  - angle is one of the app's own LANDMARK_ANGLES strings
    (storyCoverage.ts), so a library entry answers the exact question the
    serve path asks: "this place, this angle."
  - persona_version / model / voice stamp what MADE the entry. Entries
    serve regardless of the app's current persona version — a persona
    bump retires only the ephemeral cache, never the library.
    Regeneration, when a persona change is stylistically material, is a
    deliberate batch job over the keepers — never an accident of a key
    change. (That regeneration is a future, deliberate operation; it is
    why UPDATE/DELETE are revoked below rather than merely unpolicied.)

  Serve order per (place, angle), per Erik's correction: LIBRARY first,
  then the ephemeral cache, then live generation. Curated beats
  first-come.

  Access posture mirrors tour_stories: this is a no-auth app; the rows
  are non-personal curated content, world-readable by design. INSERT is
  open to the anon key because the library builder writes with the app's
  public key, exactly as the app writes tour_stories. UPDATE and DELETE
  are revoked from anon/authenticated — the library is append-only from
  the client's side of the glass.

  Audio lives in the existing tts-audio bucket under
  library/<place_key>/<angle>.wav; audio_path stores that bucket key.
*/

CREATE TABLE IF NOT EXISTS public.story_library (
  place_key text NOT NULL,
  place_name text NOT NULL,
  angle text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  story_text text NOT NULL,
  audio_path text NOT NULL,
  persona_version text NOT NULL,
  model text NOT NULL,
  voice text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (place_key, angle)
);

ALTER TABLE public.story_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_story_library" ON public.story_library;
DROP POLICY IF EXISTS "insert_story_library" ON public.story_library;

CREATE POLICY "select_story_library" ON public.story_library FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "insert_story_library" ON public.story_library FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- No UPDATE or DELETE policies exist, and the privileges are revoked
-- outright: from the public key this table is read + append only.
GRANT SELECT, INSERT ON public.story_library TO anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.story_library FROM anon, authenticated;
