// build-commentary-batch.mjs — finisher for the commentary bank v1:
// the live-TTS pass rendered 11/24 then hit the 10-req/min live quota
// (HTTP 429). The remaining 13 lines go through ONE Batch API job —
// the pipeline's canonical quota-disciplined path. Also merges the
// full manifest (first-11 durations re-measured from their local
// WAVs) and creates + flip-tests the bucket kill-switch config.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadKeys, submitTtsBatch, pollTtsBatch, ensureWav, wavDurationSec } from './lib.mjs';

const ALL = [
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
const keys = await loadKeys();
const base = keys.supabaseUrl;
const headers = { apikey: keys.anonKey, Authorization: `Bearer ${keys.anonKey}` };

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
const remaining = [];
for (const [id, text] of ALL) {
  const local = path.join(outDir, `${id}.wav`);
  if (existsSync(local)) {
    const dur = Math.round(wavDurationSec(readFileSync(local)) * 10) / 10;
    manifest.push({ id, text, path: `miles/commentary/${id}.wav`, durationSec: dur });
    console.log(`${id}: local render present (${dur}s)`);
  } else {
    remaining.push({ key: id, text });
  }
}

if (remaining.length > 0) {
  const job = await submitTtsBatch(keys.geminiKey, remaining, `miles-commentary-v1-${new Date().toISOString().slice(0, 19)}`);
  console.log('batch job:', job);
  const results = await pollTtsBatch(keys.geminiKey, job);
  const textOf = Object.fromEntries(ALL);
  for (const { key: id } of remaining) {
    const r = results.get(id);
    if (!r || r.error) throw new Error(`batch result missing/error for ${id}: ${r?.error ?? 'none'}`);
    const { bytes } = ensureWav(r.bytes, r.mimeType);
    const durationSec = Math.round(wavDurationSec(bytes) * 10) / 10;
    const up = await upload(`miles/commentary/${id}.wav`, bytes, 'audio/wav', false);
    const already = !up.ok && (up.status === 409 || up.body.includes('already exists'));
    if (!up.ok && !already) throw new Error(`upload failed for ${id}: ${up.status} ${up.body}`);
    writeFileSync(path.join(outDir, `${id}.wav`), bytes);
    manifest.push({ id, text: textOf[id], path: `miles/commentary/${id}.wav`, durationSec });
    console.log(`${id}: ${durationSec}s uploaded (batch)`);
  }
}

manifest.sort((a, b) => ALL.findIndex(x => x[0] === a.id) - ALL.findIndex(x => x[0] === b.id));

const cfgKey = 'miles/commentary/config.json';
const cfg = enabled => Buffer.from(JSON.stringify({ enabled, updated: new Date().toISOString() }));
let r = await upload(cfgKey, cfg(true), 'application/json', false);
console.log('config POST:', r.ok || r.status === 409 || r.body.includes('already exists') ? 'ok/exists' : `${r.status} ${r.body}`);
r = await upload(cfgKey, cfg(true), 'application/json', true);
console.log('config PUT (kill-switch flip path):', r.ok ? 'WORKS' : `FAILED ${r.status} ${r.body}`);

writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`DONE ${manifest.length}/24 clips; manifest written`);
