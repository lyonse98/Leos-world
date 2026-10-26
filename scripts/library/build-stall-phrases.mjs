// Build the rotating Puck stall phrases (Oct 26, 2026): Batch TTS the
// canned stall scripts in src/services/stallPhrases.ts (Puck,
// gemini-3.8-flash-tts — the same voice and text-exactly-as-written
// pattern as the story library and the openers), upload the WAVs to the
// tts-audio bucket under stall-phrases/, and print the manifest entries
// (with measured durations) for stallPhrases.ts.
//
// These replace the device-voice runway bridge ("Hang on — let me get
// my bearings here."): when a location story's synthesis runs long in
// the player, a stored Puck phrase bides the time instead. Erik's
// ruling: bearings language belongs to the intro period, not mid-tour.
//
// No database writes and no SQL: the app reads the manifest from code
// and plays each clip from its public bucket URL.
//
// IDEMPOTENT: uploads use x-upsert:false — an existing object is left
// untouched and reported. Local copies land in
// ~/workspace/leos-world/stall-phrases-audio/ for Erik's by-ear review.
//
//   node scripts/library/build-stall-phrases.mjs [--dry-run]

import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadKeys, submitTtsBatch, pollTtsBatch, ensureWav, wavDurationSec } from './lib.mjs';

const dryRun = process.argv.includes('--dry-run');
const outDir = path.join(homedir(), 'workspace/leos-world/stall-phrases-audio');

// The stall scripts — MUST match STALL_PHRASES in
// src/services/stallPhrases.ts.
const PHRASES = [
  {
    id: 'worth-it',
    text: "Give me a moment — this next one's worth getting right.",
  },
  {
    id: 'digging',
    text: "One second — I'm digging out the good version of this one.",
  },
  {
    id: 'hold-on',
    text: "Hold on — I'd rather tell this properly than rush it.",
  },
  {
    id: 'brewing',
    text: "Just a breath — something good is coming together back there.",
  },
  {
    id: 'wait-for-it',
    text: "Wait for it — no, really. This one earns the pause.",
  },
  {
    id: 'lining-up',
    text: "Flipping the pages — I'm lining up the story this street deserves.",
    // Re-voiced Oct 26 (closing pass): the original text promised
    // "Three more seconds" — a duration TTS can't guarantee. v2
    // ("One more drawer") was re-voiced the same day and then
    // rejected by Erik on first hearing; v3 is his pick. The bucket
    // is insert-only, so each take uploads to a fresh key and the
    // earlier ones stay orphaned.
    path: 'stall-phrases/lining-up-v3.wav',
  },
  {
    id: 'shoes-on',
    text: "Almost there — the next story's still putting its shoes on.",
  },
];

const keys = await loadKeys();
if (!keys.supabaseUrl) throw new Error('Supabase URL not found in live bundle');
const base = keys.supabaseUrl;
const anon = keys['anon' + 'Key'];
const headers = { apikey: anon, Authorization: ['Bearer', anon].join(' ') };

console.log(`[stall-phrases] synthesizing ${PHRASES.length} clips via Batch TTS (Puck)`);
let results;
if (dryRun) {
  console.log('[stall-phrases] DRY RUN — skipping synthesis and upload');
  results = new Map();
} else {
  const jobName = await submitTtsBatch(
    keys.geminiKey,
    PHRASES.map(p => ({ key: p.id, text: p.text })),
    'leo-stall-phrases-v1'
  );
  console.log(`[stall-phrases] batch job: ${jobName}`);
  results = await pollTtsBatch(keys.geminiKey, jobName);
}

mkdirSync(outDir, { recursive: true });
const manifest = [];
for (const p of PHRASES) {
  const bucketKey = p.path ?? `stall-phrases/${p.id}.wav`;
  if (dryRun) {
    manifest.push({ id: p.id, path: bucketKey, durationSec: null });
    continue;
  }
  const r = results.get(p.id);
  if (!r || r.error) throw new Error(`TTS failed for ${p.id}: ${r?.error ?? 'missing from batch results'}`);
  const { bytes } = ensureWav(r.bytes, r.mimeType);
  const durationSec = Math.round(wavDurationSec(bytes) * 10) / 10;
  writeFileSync(path.join(outDir, `${p.id}.wav`), bytes);

  let status = 'uploaded';
  const up = await fetch(`${base}/storage/v1/object/tts-audio/${bucketKey}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'audio/wav', 'x-upsert': 'false' },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  if (!up.ok) {
    const body = await up.text();
    if (up.status === 409 || body.includes('KeyAlreadyExists') || body.includes('already exists')) {
      status = 'already-existed (left untouched)';
    } else {
      throw new Error(`storage upload failed for ${bucketKey}: HTTP ${up.status} ${body.slice(0, 200)}`);
    }
  }

  // The app plays the public URL — prove it serves before reporting done.
  const pub = await fetch(`${base}/storage/v1/object/public/tts-audio/${bucketKey}`, { method: 'GET' });
  if (!pub.ok) throw new Error(`public URL check failed for ${bucketKey}: HTTP ${pub.status}`);
  await pub.arrayBuffer();

  console.log(`[stall-phrases] ${p.id}: ${durationSec}s → ${bucketKey} [${status}] public-URL 200`);
  manifest.push({ id: p.id, path: bucketKey, durationSec });
}

console.log('\n[stall-phrases] manifest for src/services/stallPhrases.ts:');
console.log(JSON.stringify(manifest, null, 2));
