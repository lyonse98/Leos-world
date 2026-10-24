/*
# Create tts-audio Storage bucket

1. Purpose
- A shared cache for synthesized TTS audio so every device benefits from
  audio that was already synthesized elsewhere. Story text is already shared
  via the tour_stories table, but each phone currently re-pays Gemini TTS
  synthesis for identical text. This bucket makes that free and instant on
  repeat routes.

2. Storage Bucket
- `tts-audio` — public read, insert-only for anon/authenticated.
  Objects are keyed by a full-text fingerprint: `{voice}|{textLength}|{hash}`.
  WAV files are small (tens of KB) and immutable for a given key, so there
  is no update or delete path — insert once, read forever.

3. Security (storage.objects RLS)
- Enable RLS on `storage.objects` for the bucket.
- SELECT: public (anon, authenticated) — anyone can read cached audio.
- INSERT: anon, authenticated — any device can contribute a synthesized clip.
- No UPDATE or DELETE policies — cached audio is write-once.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('tts-audio', 'tts-audio', true)
ON CONFLICT (id) DO NOTHING;

-- SELECT: anyone can read cached TTS audio
DROP POLICY IF EXISTS "tts_audio_public_read" ON storage.objects;
CREATE POLICY "tts_audio_public_read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'tts-audio');

-- INSERT: any device can upload a newly synthesized clip
DROP POLICY IF EXISTS "tts_audio_anon_insert" ON storage.objects;
CREATE POLICY "tts_audio_anon_insert"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'tts-audio');
