// build-commentary.mjs — render the B·Miles colour-commentary bank v1
// (Erik's ruling, Oct 29, 2026: B only, vibe test). 24 short lines via
// the existing live Puck pipeline (lib.mjs liveTts), uploaded under
// miles/commentary/ with the campaign's no-upsert POST pattern, plus
// the bucket kill-switch config (miles/commentary/config.json).
// Local copies + manifest (with measured durations) land in
// ~/workspace/leos-world/commentary-v1/ for the build record; patch the
// measured durations into src/content/commentary.ts afterwards.
// No pronunciation transform: no line contains a lexicon entry.

import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadKeys, liveTts, ensureWav, wavDurationSec } from './lib.mjs';

const LINES = [
  ['gen-1', "Still with me? Good. This county just keeps unfolding."],
  ['gen-2', "I could drive these roads every day and still find something new. That's the whole point, really."],
  ['gen-3', "Plenty of road left. Plenty of stories on it, too."],
  ['gen-4', "Some of these, honestly, I think about for days after."],
  ['gen-5', "This is my favorite way to see a place — just rolling through it."],
  ['gen-6', "Tell you what — nobody's bored in the passenger seat today."],
  ['gen-7', "We've got time. Let's use it well."],
  ['gen-8', "I never get tired of this part — just us, the road, and whatever's next."],
  ['gen-9', "You picked a good day to ride along."],
  ['gen-10', "Every mile out here has something buried in it. Half my job is digging."],
  ['coast-1', "That's the coast for you — the light out here does half the storytelling."],
  ['coast-2', "Out here by the water, everything slows down just a touch. Even the stories."],
  ['north-1', "North County has this easy sprawl to it — groves, hills, little towns with big pasts."],
  ['north-2', "Up here, the county breathes a little easier. Space between things."],
  ['central-1', "Right through the middle of it now — this is where the city stacks its history deepest."],
  ['east-1', "Out east, the land starts making the decisions — canyons, grades, wide-open sky."],
  ['south-1', "Down here in the South Bay, two countries share one horizon. You can feel both."],
  ['back-1', "Backcountry miles. This is where San Diego keeps its oldest stories — and its quietest."],
  ['morn-1', "Morning miles are the best miles. Everything's still possible."],
  ['morn-2', "Early light like this — the city's not done waking up, but we are."],
  ['aft-1', "Middle of the day, middle of the county. Not a bad place to be."],
  ['eve-1', "Golden hour. San Diego shows off a little at golden hour — can't blame it."],
  ['eve-2', "Evening's coming on. Stories land different in this light, I think."],
  ['night-1', "Night driving changes the stories. Everything's closer in, somehow."],
];

const outDir = path.join(homedir(), 'workspace/leos-world/commentary-v1');
mkdirSync(outDir, { recursive: true });

const keys = await loadKeys();
if (!keys.supabaseUrl) throw new Error('Supabase URL not found');
const base = keys.supabaseUrl;
const headers = { apikey: keys.anonKey, Authorization: `Bearer ${keys.anonKey}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function upload(key, bytes, contentType, upsert) {
  const url = `${base}/storage/v1/object/tts-audio/${key.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    method: upsert ? 'PUT' : 'POST',
    headers: { ...headers, 'Content-Type': contentType, 'x-upsert': String(upsert) },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body: body.slice(0, 160) };
}

const manifest = [];
for (const [id, text] of LINES) {
  const key = `miles/commentary/${id}.wav`;
  const tts = await liveTts(keys.geminiKey, text);
  const { bytes } = ensureWav(tts.bytes, tts.mimeType);
  const durationSec = Math.round(wavDurationSec(bytes) * 10) / 10;
  const up = await upload(key, bytes, 'audio/wav', false);
  const already = !up.ok && (up.status === 409 || up.body.includes('already exists'));
  if (!up.ok && !already) throw new Error(`upload failed for ${key}: ${up.status} ${up.body}`);
  writeFileSync(path.join(outDir, `${id}.wav`), bytes);
  manifest.push({ id, text, path: key, durationSec });
  console.log(`${id}: ${durationSec}s ${already ? '(already in bucket)' : 'uploaded'}`);
  await sleep(800);
}

// Kill-switch config: create enabled:true, then PROVE the flip path
// (PUT upsert) works with the anon key, restoring enabled:true after.
const cfgKey = 'miles/commentary/config.json';
const cfg = enabled => Buffer.from(JSON.stringify({ enabled, updated: new Date().toISOString() }));
let r = await upload(cfgKey, cfg(true), 'application/json', false);
console.log('config POST:', r.ok || r.status === 409 ? 'ok/exists' : `${r.status} ${r.body}`);
r = await upload(cfgKey, cfg(true), 'application/json', true);
console.log('config PUT (kill-switch flip path):', r.ok ? 'WORKS — bucket flip needs no republish' : `FAILED ${r.status} ${r.body}`);

writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`DONE ${manifest.length} clips; manifest at ${outDir}/manifest.json`);
