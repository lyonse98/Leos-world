// Welcome-intro clip builder (Pass 1, Oct 2026).
//
// The generic tour welcome (src/services/intros.ts) used to be spoken by
// the device's browser voice while every other opener element is Puck.
// This renders each intro variant once, in Puck, through the SAME Batch
// API path the library corpus and the opener clips used, and uploads
// the WAVs to the tts-audio bucket at openers/intros/<id>.wav. The app
// references them through the manifest in intros.ts (INTRO_CLIPS) and
// falls back to the browser voice when a clip fails to load or play, so
// a missing clip degrades gracefully — do not fake one.
//
// Usage: node scripts/library/build-intros.mjs
// Idempotent-ish: the bucket is insert-only (x-upsert: false); a re-run
// reports any clip that already exists and skips re-rendering nothing —
// it re-renders and lets the upload refuse duplicates, which is the
// signal the clip is already live. Local copies land in
// ~/workspace/leos-world/intros-audio/ for Erik's by-ear review.
//
// Prints the INTRO_CLIPS manifest JSON (durations measured from the
// WAVs) to paste into src/services/intros.ts.

import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  loadKeys,
  submitTtsBatch,
  pollTtsBatch,
  ensureWav,
  wavDurationSec,
  pacificDate,
} from './lib.mjs';

// The pool — MUST stay text-identical to src/services/intros.ts. The
// spoken text is the string exactly as written: the pronunciation
// transform (src/services/pronunciation.ts) is applied only on the live
// synthesis path, and none of these lines contain a lexicon entry, so
// the transform would be a no-op here.
const INTROS = [
  { id: 'fresh-1', text: "Hey, I'm Leo — your AI tour guide. Let's see what's around us." },
  { id: 'fresh-2', text: "Hey there, I'm Leo — your AI tour guide. Let's see what's around us." },
  { id: 'fresh-3', text: "I'm Leo — your AI tour guide. Let's look around and see what's here." },
  { id: 'resume-1', text: "Alright, we're back! Picking up right where we left off — more stories coming your way." },
  { id: 'resume-2', text: "Welcome back! The tour was just getting interesting. Let's keep going." },
  { id: 'resume-3', text: "Hey, you're back! Good, I saved some good ones. Picking up where we left off." },
];

const SUPABASE_URL = 'https://mdfbeobaldoegfmmlaya.supabase.co';
const OUT_DIR = join(homedir(), 'workspace', 'leos-world', 'intros-audio');

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const { geminiKey, anonKey } = await loadKeys();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  console.log(`Submitting ${INTROS.length} intro clips as one batch job...`);
  const opName = await submitTtsBatch(
    geminiKey,
    INTROS.map(o => ({ key: o.id, text: o.text })),
    `intros-${stamp}`
  );
  console.log(`Batch job: ${opName}`);
  const byKey = await pollTtsBatch(geminiKey, opName);
  console.log(`Batch done (${pacificDate()} PT): ${byKey.size}/${INTROS.length} clips rendered.`);

  const manifest = {};
  const report = [];
  for (const intro of INTROS) {
    const got = byKey.get(intro.id);
    if (!got) {
      report.push(`${intro.id}: MISSING from batch results`);
      continue;
    }
    if (got.error) {
      report.push(`${intro.id}: batch ERROR: ${got.error}`);
      continue;
    }
    // pollTtsBatch yields { mimeType, bytes: Buffer } per key, and
    // ensureWav returns { bytes, format } (raw WAV or wrapped PCM).
    const { bytes: wav } = ensureWav(got.bytes, got.mimeType);
    const durationSec = Math.round(wavDurationSec(wav) * 10) / 10;
    const path = `openers/intros/${intro.id}.wav`;
    writeFileSync(join(OUT_DIR, `${intro.id}.wav`), wav);

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/tts-audio/${path}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'audio/wav',
        'x-upsert': 'false',
      },
      body: wav,
    });
    if (!up.ok) {
      report.push(`${intro.id}: upload FAILED HTTP ${up.status}: ${(await up.text()).slice(0, 200)}`);
      continue;
    }
    manifest[intro.id] = { path, durationSec };
    report.push(`${intro.id}: uploaded ${path} (${durationSec}s, ${wav.length} bytes)`);
  }

  console.log('\n--- per-clip report ---');
  for (const line of report) console.log(line);
  console.log('\n--- manifest for src/services/intros.ts (INTRO_CLIPS) ---');
  console.log(JSON.stringify(manifest, null, 2));
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (Object.keys(manifest).length !== INTROS.length) {
    console.error(`\nINCOMPLETE: ${Object.keys(manifest).length}/${INTROS.length} clips uploaded.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('build-intros failed:', err);
  process.exit(1);
});
