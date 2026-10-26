// Build the rotating Puck openers (Oct 26, 2026): Batch TTS the canned
// opener scripts in src/services/openers.ts (Puck, gemini-3.8-flash-tts —
// the same voice and text-exactly-as-written pattern as the story
// library), upload the WAVs to the tts-audio bucket under openers/, and
// print the manifest entries (with measured durations) for openers.ts.
//
// No database writes and no SQL: the app reads the manifest from code
// and plays each clip from its public bucket URL.
//
// IDEMPOTENT: uploads use x-upsert:false — an existing object is left
// untouched and reported. Local copies land in
// ~/workspace/leos-world/openers-audio/ for Erik's by-ear review.
//
//   node scripts/library/build-openers.mjs [--dry-run]

import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadKeys, submitTtsBatch, pollTtsBatch, ensureWav, wavDurationSec } from './lib.mjs';

const dryRun = process.argv.includes('--dry-run');
const outDir = path.join(homedir(), 'workspace/leos-world/openers-audio');

// The opener scripts — MUST match PUCK_OPENERS in src/services/openers.ts.
const OPENERS = [
  {
    id: 'promise',
    lengthClass: 'short',
    text: "Before we roll, one promise: every story you're about to hear is true, and it happened right here, on ground we can see. This place hides the good stuff in plain sight.",
  },
  {
    id: 'postcard',
    lengthClass: 'short',
    text: "Nobody tells visitors this: the most interesting thing in any city is rarely the postcard. It's the story standing right next to it. Stick with me — I'll prove it.",
  },
  {
    id: 'chapters',
    lengthClass: 'medium',
    text: "Look around. Where we're standing has been a mission frontier, a working port, a tuna town, and the stage for a world's fair — sometimes in the same decade. This city stacks its chapters instead of closing them. So here's the deal: I watch the streets, you enjoy the ride, and when we pass a story worth telling, you hear it.",
  },
  {
    id: 'many-towns',
    lengthClass: 'medium',
    text: "This is a Navy town that surfs, a beach town with a science mesa, a border city with a craft-beer problem — in the best way. Every neighborhood we're about to roll through is running at least two of those stories at once. My job is to catch them as they pass your window. Yours is just to keep your eyes open.",
  },
  {
    id: 'two-countries',
    lengthClass: 'medium',
    text: "Two countries, one coastline, and about nine climates before lunch — that's the ground we're covering. A canyon can run ten degrees cooler than the hill above it, and the story changes just as fast. I'll keep up with all of it: the history, the oddities, the places locals love and guidebooks skip. All you have to do is ride.",
  },
  {
    id: 'how-i-work',
    lengthClass: 'long',
    text: "While I get my bearings, let me tell you how I work. I read everything — the plaques, the archives, the old newspapers, the stuff that never made the tour books. Then I watch where we are, block by block, and when a real story lines up with the street outside your window, I tell it: the people, the scandal, the strange little turns that made this place what it is. Some of it is grand history. Some of it is a dog park with a past. Around here, you honestly can't tell which is which until you hear the story — and that's exactly the fun of it.",
  },
  {
    id: 'bearings',
    lengthClass: 'long',
    text: "Still getting my bearings up here — give me a few more seconds, because the first story sets the tone for the whole tour and I want it to be the right one. In the meantime, a taste of what's out there: this city has been a Spanish presidio, a whaling port, a Navy stronghold, and the place comic books took over the world — and it wears every one of those lives at once. When I land on where exactly we are, we start properly. It'll be worth the breath.",
  },
];

const keys = await loadKeys();
if (!keys.supabaseUrl) throw new Error('Supabase URL not found in live bundle');
const base = keys.supabaseUrl;
const anon = keys['anon' + 'Key'];
const headers = { apikey: anon, Authorization: ['Bearer', anon].join(' ') };

console.log(`[openers] synthesizing ${OPENERS.length} clips via Batch TTS (Puck)`);
let results;
if (dryRun) {
  console.log('[openers] DRY RUN — skipping synthesis and upload');
  results = new Map();
} else {
  const jobName = await submitTtsBatch(
    keys.geminiKey,
    OPENERS.map(o => ({ key: o.id, text: o.text })),
    'leo-openers-v1'
  );
  console.log(`[openers] batch job: ${jobName}`);
  results = await pollTtsBatch(keys.geminiKey, jobName);
}

mkdirSync(outDir, { recursive: true });
const manifest = [];
for (const o of OPENERS) {
  const bucketKey = `openers/${o.id}.wav`;
  if (dryRun) {
    manifest.push({ id: o.id, path: bucketKey, durationSec: null, lengthClass: o.lengthClass });
    continue;
  }
  const r = results.get(o.id);
  if (!r || r.error) throw new Error(`TTS failed for ${o.id}: ${r?.error ?? 'missing from batch results'}`);
  const { bytes } = ensureWav(r.bytes, r.mimeType);
  const durationSec = Math.round(wavDurationSec(bytes) * 10) / 10;
  writeFileSync(path.join(outDir, `${o.id}.wav`), bytes);

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

  console.log(`[openers] ${o.id}: ${durationSec}s (${o.lengthClass}) → ${bucketKey} [${status}] public-URL 200`);
  manifest.push({ id: o.id, path: bucketKey, durationSec, lengthClass: o.lengthClass });
}

console.log('\n[openers] manifest for src/services/openers.ts:');
console.log(JSON.stringify(manifest, null, 2));
