// build-retells-render.mjs — retell batch v1, render phase.
// One Gemini Batch TTS job for all retold texts (canonical text
// verbatim, as every library render before it), audio uploaded under
// FRESH bucket keys (library/<place>/<angle>-retell-v1.wav,
// x-upsert:false), and a single swap SQL emitted for Erik's Bolt
// paste (story_library rows are locked to direct updates — probed
// Oct 30: anon PATCH = permission denied). The swap touches ONLY
// story_text + audio_path; persona_version stays leo-v14 by design
// (a v14-register rewrite; a version change could filter the rows
// out of the apps' library fetch).
// Resumable: the batch job name is persisted before polling; a
// rerun re-polls the same job instead of resubmitting.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadKeys, submitTtsBatch, pollTtsBatch, ensureWav, wavDurationSec } from './lib.mjs';

const DIR = process.env.LEO_RETELL_DIR || path.join(homedir(), 'workspace/leos-world/retells-v1');
const AUDIO_DIR = path.join(DIR, 'audio');
mkdirSync(AUDIO_DIR, { recursive: true });
const STATE = path.join(DIR, 'render-state.json');

const entries = JSON.parse(readFileSync(path.join(DIR, 'texts.json'), 'utf8'));
if (entries.length !== 23) throw new Error(`expected 23 texts, found ${entries.length}`);
const keys = await loadKeys();

const asciiPlace = pk => pk
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[–—]/g, '-')
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9 .'-]/gi, '')
  .replace(/\s+/g, ' ');
for (const e of entries) {
  e.itemKey = 'retell-' + String(entries.indexOf(e) + 1).padStart(2, '0');
  e.bucketKey = `library/${asciiPlace(e.place_key)}/${e.angle}-retell-v1.wav`;
  e.localFile = path.join(AUDIO_DIR, `${e.itemKey}.wav`);
}

let state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
if (!state.jobName) {
  const items = entries.map(e => ({ key: e.itemKey, text: e.new_text }));
  state.jobName = await submitTtsBatch(keys.geminiKey, items, 'retells-v1');
  writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(`[render] batch submitted: ${state.jobName}`);
} else {
  console.log(`[render] resuming batch: ${state.jobName}`);
}
const results = await pollTtsBatch(keys.geminiKey, state.jobName);
state.done = true;
writeFileSync(STATE, JSON.stringify(state, null, 2));

const headers = { apikey: keys.anonKey, Authorization: 'Bearer ' + keys.anonKey };
const base = keys.supabaseUrl;
const report = [];
let okCount = 0;
for (const e of entries) {
  const r = results.get(e.itemKey);
  if (!r || r.error || !r.bytes) {
    report.push(`FAIL ${e.place_name} / ${e.angle}: ${r?.error ?? 'no result'}`);
    continue;
  }
  const wav = ensureWav(r.bytes, r.mimeType).bytes;
  writeFileSync(e.localFile, wav);
  const dur = wavDurationSec(wav);
  // upload under the fresh key (create-only; duplicate = already there)
  const up = await fetch(`${base}/storage/v1/object/tts-audio/${e.bucketKey.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'audio/wav', 'x-upsert': 'false' },
    body: wav,
    signal: AbortSignal.timeout(120_000),
  });
  const upBody = await up.text();
  const uploaded = up.ok || upBody.includes('KeyAlreadyExists') || upBody.includes('already exists');
  if (!uploaded) {
    report.push(`UPLOAD FAIL ${e.place_name}: HTTP ${up.status} ${upBody.slice(0, 140)}`);
    continue;
  }
  okCount++;
  report.push(`OK ${e.place_name} / ${e.angle}: ${dur.toFixed(1)}s -> ${e.bucketKey}`);
  e.duration_s = Math.round(dur * 10) / 10;
}

// swap SQL — Erik pastes once in Bolt's SQL panel
const esc = s => s.replace(/'/g, "''");
const sql = [
  '-- Retell batch v1 swap — paste once in Bolt (Supabase SQL panel).',
  '-- Updates story_text + audio_path for the 23 retold rows.',
  '-- Audio already uploaded under the new keys; old audio stays as orphan (accepted pattern).',
  'begin;',
  ...entries.filter(e => e.duration_s).map(e =>
    `update public.story_library set story_text = '${esc(e.new_text)}', audio_path = '${esc(e.bucketKey)}' where place_key = '${esc(e.place_key)}' and angle = '${esc(e.angle)}';`),
  'commit;',
  '',
  "-- verify (expect 23 rows with audio_path like '%retell-v1%'):",
  "select count(*) from public.story_library where audio_path like '%retell-v1%';",
].join('\n');
writeFileSync(path.join(DIR, 'swap.sql'), sql);
writeFileSync(path.join(DIR, 'render-report.md'),
  `# Retell batch v1 — render report\n\nBatch job: ${state.jobName}\nRendered+uploaded: ${okCount}/${entries.length}\n\n${report.join('\n')}\n`);
console.log(report.join('\n'));
console.log(`[render] ${okCount}/${entries.length} uploaded; swap.sql written`);
