// Ingest the built library corpus into Supabase: audio → tts-audio
// bucket at library/<place_key>/<angle>.wav, rows → story_library.
//
// IDEMPOTENT: storage uploads use x-upsert:false (an existing object is
// left untouched), and row inserts carry
// `Prefer: resolution=ignore-duplicates` (an existing (place_key,
// angle) row is left untouched). Safe to re-run.
//
// DO NOT RUN until the story_library migration
// (20261025234500_create_story_library.sql) has been applied — the table
// does not exist yet. Written Oct 25, 2026, alongside the corpus build;
// the corpus manifest is the input.
//
//   node scripts/library/ingest.mjs [--dry-run]

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadKeys } from './lib.mjs';

const corpusDir = path.join(homedir(), 'workspace/leos-world/library-corpus');
const manifestPath = path.join(corpusDir, 'manifest.json');
const audioDir = path.join(corpusDir, 'audio');
const dryRun = process.argv.includes('--dry-run');

if (!existsSync(manifestPath)) {
  console.error('[ingest] no corpus manifest found — build the corpus first');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const ready = manifest.filter(e => e.story_text && e.audio_file);
console.log(`[ingest] ${ready.length} corpus entries ready (${manifest.length - ready.length} incomplete, skipped)`);

const keys = await loadKeys();
if (!keys.supabaseUrl) throw new Error('Supabase URL not found in live bundle');
const base = keys.supabaseUrl;
const headers = {
  apikey: keys.anonKey,
  Authorization: `Bearer ${keys.anonKey}`,
};

let uploaded = 0;
let rows = 0;
for (const e of ready) {
  const bucketKey = `library/${e.place_key}/${e.angle}.wav`;
  const filePath = path.join(audioDir, e.audio_file);
  if (dryRun) {
    console.log(`[ingest] DRY RUN would upload ${e.audio_file} → ${bucketKey} and upsert (${e.place_key}, ${e.angle})`);
    continue;
  }
  const bytes = readFileSync(filePath);
  const up = await fetch(`${base}/storage/v1/object/tts-audio/${bucketKey.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'audio/wav', 'x-upsert': 'false' },
    body: bytes,
  });
  if (up.ok) uploaded++;
  else {
    const body = await up.text();
    // 409 = object already exists — the idempotent outcome, not an error.
    if (up.status !== 409) throw new Error(`storage upload failed for ${bucketKey}: HTTP ${up.status} ${body.slice(0, 200)}`);
  }

  const row = {
    place_key: e.place_key,
    place_name: e.place_name,
    angle: e.angle,
    lat: e.lat,
    lng: e.lng,
    story_text: e.story_text,
    audio_path: bucketKey,
    persona_version: e.persona_version,
    model: e.model,
    voice: e.voice,
  };
  const ins = await fetch(`${base}/rest/v1/story_library`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!ins.ok) {
    throw new Error(`story_library insert failed for ${bucketKey}: HTTP ${ins.status} ${(await ins.text()).slice(0, 200)}`);
  }
  rows++;
}
console.log(`[ingest] done: ${uploaded} audio uploads (${ready.length - uploaded} already present), ${rows} row upserts attempted`);
