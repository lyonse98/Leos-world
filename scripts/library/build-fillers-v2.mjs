// Filler batch v2 — RENDER + INGEST only (Erik approved the reading
// copies Oct 30, 2026, 04:14). Texts are FROZEN in
// ~/workspace/leos-world/filler-batch-v2/texts.json (22 stories + 46
// bridges) — this script renders them exactly as written and lands
// them by the v1 pattern (build-fillers.mjs):
//   stories -> story_library rows, angle 'filler', place_key =
//              normalizeKey(title), lat/lng 32.85/-117.05, audio at
//              library/<place_key>/filler-v14.wav, persona leo-v14,
//              model gemini-3.8-flash, voice Puck; anon INSERT with
//              ignore-duplicates; upload x-upsert:false.
//   bridges -> storage objects ONLY at fillers/bridges/<slug>.wav,
//              no db rows (the code-manifest pattern; B's BRIDGE_CLIPS
//              in repo/src/content/clips.ts carries the 46 new lines).
// Resumable: render-state.json in the batch dir records the batch
// job name; a rerun polls the SAME job instead of re-submitting,
// and skips clips whose WAV already exists locally / remotely.
//
//   node scripts/library/build-fillers-v2.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  loadKeys, submitTtsBatch, pollTtsBatch, ensureWav, wavDurationSec, TTS_VOICE,
} from './lib.mjs';

const wsDir = path.join(homedir(), 'workspace/leos-world');
const batchDir = path.join(wsDir, 'filler-batch-v2');
const audioDir = path.join(batchDir, 'audio');
mkdirSync(audioDir, { recursive: true });
const statePath = path.join(batchDir, 'render-state.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const saveState = () => writeFileSync(statePath, JSON.stringify(state, null, 2));

const batch = JSON.parse(readFileSync(path.join(batchDir, 'texts.json'), 'utf8'));
const normalizeKey = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// App kind mapping (B BRIDGE_CLIPS kinds 'first' | 'next'; mirrors A's
// 'first' | 'continuation'): episode-opening functions -> first,
// chain functions -> next.
const KIND = {
  settling_in: 'first',
  quiet_stretch: 'first',
  time_passing: 'next',
  topic_pivot: 'next',
  returning: 'next',
  weather_light: 'next',
};

const stories = batch.stories.map(s => ({
  slug: s.slug,
  place_name: s.title,
  place_key: normalizeKey(s.title),
  story_text: s.story_text,
  file: `${s.slug}__filler.wav`,
}));
const bridges = batch.bridges.map(b => ({
  slug: b.slug,
  fn: b.function,
  kind: KIND[b.function],
  text: b.text,
  file: `bridge__${b.slug}.wav`,
  bucket_key: `fillers/bridges/${b.slug}.wav`,
}));
if (bridges.some(b => !b.kind)) throw new Error('unmapped bridge function');

const keys = await loadKeys();
const base = keys.supabaseUrl;
const headers = { apikey: keys.anonKey, Authorization: `Bearer ${keys.anonKey}` };

// ---- TTS (one batch job: 22 stories + 46 bridges) --------------------
const missing = [
  ...stories.filter(s => !existsSync(path.join(audioDir, s.file))).map(s => ({ key: s.slug, text: s.story_text })),
  ...bridges.filter(b => !existsSync(path.join(audioDir, b.file))).map(b => ({ key: `bridge__${b.slug}`, text: b.text })),
];
if (missing.length) {
  let name = state.jobName;
  if (!name) {
    name = await submitTtsBatch(keys.geminiKey, missing, 'leo-fillers-v2');
    state.jobName = name;
    state.submitted = new Date().toISOString();
    state.itemCount = missing.length;
    saveState();
    console.log(`[fillers-v2] submitted batch ${name} (${missing.length} clips)`);
  } else {
    console.log(`[fillers-v2] resuming batch ${name} (${missing.length} clips still missing locally)`);
  }
  const results = await pollTtsBatch(keys.geminiKey, name);
  let got = 0;
  for (const item of missing) {
    const r = results.get(item.key);
    if (!r || r.error || !r.bytes) { console.warn(`[fillers-v2] no audio for ${item.key}: ${r?.error || 'missing'}`); continue; }
    const { bytes: wav } = ensureWav(r.bytes, r.mimeType);
    const isBridge = item.key.startsWith('bridge__');
    const fn = isBridge ? `${item.key}.wav` : `${item.key}__filler.wav`;
    writeFileSync(path.join(audioDir, fn), wav);
    got++;
    console.log(`[fillers-v2] audio ${item.key}: ${wav.length} bytes, ${Math.round(wavDurationSec(wav) * 10) / 10}s`);
  }
  console.log(`[fillers-v2] batch returned audio for ${got}/${missing.length} requested clips`);
} else {
  console.log('[fillers-v2] all clips already rendered locally — skipping TTS');
}

// ---- ingest: stories --------------------------------------------------
let uploaded = 0, alreadyThere = 0, rowsAttempted = 0;
for (const s of stories) {
  const fp = path.join(audioDir, s.file);
  if (!existsSync(fp)) { console.warn(`[fillers-v2] SKIP story ${s.slug}: no local audio`); continue; }
  const bucketKey = `library/${s.place_key}/filler-v14.wav`;
  const bytes = readFileSync(fp);
  const up = await fetch(`${base}/storage/v1/object/tts-audio/${bucketKey.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'audio/wav', 'x-upsert': 'false' },
    body: bytes, signal: AbortSignal.timeout(120_000),
  });
  if (up.ok) uploaded++;
  else {
    const b = await up.text();
    if (up.status === 409 || b.includes('KeyAlreadyExists') || b.includes('already exists') || b.includes('Duplicate')) { alreadyThere++; }
    else throw new Error(`upload failed ${bucketKey}: HTTP ${up.status} ${b.slice(0, 160)}`);
  }
  const row = {
    place_key: s.place_key, place_name: s.place_name, angle: 'filler',
    lat: 32.85, lng: -117.05, story_text: s.story_text, audio_path: bucketKey,
    persona_version: 'leo-v14', model: 'gemini-3.8-flash', voice: TTS_VOICE,
  };
  const ins = await fetch(`${base}/rest/v1/story_library`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  if (!ins.ok) throw new Error(`insert failed ${bucketKey}: HTTP ${ins.status} ${(await ins.text()).slice(0, 160)}`);
  rowsAttempted++;
  console.log(`[fillers-v2] ingested story ${s.slug} -> ${bucketKey}`);
}

// ---- ingest: bridges (storage only) -----------------------------------
const bridgeManifest = [];
let bUploaded = 0, bAlready = 0;
for (const b of bridges) {
  const fp = path.join(audioDir, b.file);
  if (!existsSync(fp)) { console.warn(`[fillers-v2] SKIP bridge ${b.slug}: no local audio`); continue; }
  const bytes = readFileSync(fp);
  const up = await fetch(`${base}/storage/v1/object/tts-audio/${b.bucket_key.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'audio/wav', 'x-upsert': 'false' },
    body: bytes, signal: AbortSignal.timeout(120_000),
  });
  if (up.ok) bUploaded++;
  else {
    const t = await up.text();
    if (up.status === 409 || t.includes('KeyAlreadyExists') || t.includes('already exists') || t.includes('Duplicate')) { bAlready++; }
    else throw new Error(`bridge upload failed ${b.bucket_key}: HTTP ${up.status} ${t.slice(0, 160)}`);
  }
  bridgeManifest.push({
    slug: b.slug, function: b.fn, kind: b.kind, text: b.text,
    bucket_key: b.bucket_key, duration_sec: Math.round(wavDurationSec(bytes) * 10) / 10,
  });
  console.log(`[fillers-v2] bridge stored ${b.slug} -> ${b.bucket_key}`);
}
writeFileSync(path.join(batchDir, 'bridges-manifest.json'), JSON.stringify(bridgeManifest, null, 1));
state.ingested = new Date().toISOString();
saveState();
console.log(`[fillers-v2] DONE: stories ${uploaded} uploaded (${alreadyThere} already present), ${rowsAttempted} rows attempted; bridges ${bUploaded} uploaded (${bAlready} already present), manifest ${bridgeManifest.length} entries`);
