// MASTER RENDER CAMPAIGN (Oct 28, 2026 — Erik approved fork A:
// render the approved texts via the Gemini BATCH TTS route and
// ingest them live. Texts were approved first, per his production
// rule; this script is the voice phase only — it generates NO text.
//
//   node scripts/library/build-render-campaign.mjs [--dry-build]
//
// RENDER SET — exactly 191, in priority order:
//   1. gapfill 115 — gapfill-corpus-v14 MINUS Convoy x3 (HELD) and
//      Bird Rock Coffee x3 (HELD — seed pin unverified, flag #4)
//   2. batch2a 42 — batch2a-corpus-v14 MINUS El Cajon Mountain x3
//      (probe trio, already live) and Barona x3 (HELD); the 3
//      POLISHED stories (Living Coast origin; CVEATC origin +
//      sports) render from batch2a-polish-v1 REVISED texts
//   3. regional fillers 27 — filler-regional-corpus-v1 (region tags
//      ride the picker table commit, not the row — see report)
//   4. batch1 re-tells 7 — batch1-entertainment-v1, rendered under
//      FRESH `<angle>-v14r.wav` bucket keys, STAGED ONLY (no row
//      writes; the swap is Erik's paste — batch1-entertainment-swap.sql)
//
// Pipeline: the established builder code path — lib.mjs
// submitTtsBatch/pollTtsBatch/ensureWav, canonical story_text as the
// payload exactly as build-corpus/build-corridors/build-fillers pass
// it, chunks of 10 (build-corpus's parseable-response lesson),
// ingest per ingest.mjs/build-corridors (x-upsert:false uploads,
// ignore-duplicates inserts, ASCII-folded storage keys).
//
// RESUMABLE: the campaign manifest on disk is the progress record —
// an item marked ingested/staged is never re-rendered. A poll
// timeout leaves the job recorded as outstanding and the next run
// collects it before submitting anything new. A quota error stops
// submissions and checkpoints. Failed items retry on the next run.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  loadKeys, submitTtsBatch, pollTtsBatch, ensureWav, wavDurationSec,
  pacificDate, TTS_MODEL, TTS_VOICE,
} from './lib.mjs';

const WS = path.join(homedir(), 'workspace/leos-world');
const campaignDir = path.join(WS, 'render-campaign-2026-10-28');
const audioDir = path.join(campaignDir, 'audio');
const manifestPath = path.join(campaignDir, 'campaign-manifest.json');
const batchLogPath = path.join(campaignDir, 'batch-jobs.json');
const swapSqlPath = path.join(WS, 'batch1-entertainment-swap.sql');
const dryBuild = process.argv.includes('--dry-build');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Same ASCII fold as ingest.mjs / build-corridors.mjs (storage
// rejects non-ASCII object keys).
const asciiFold = s => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[–—]/g, '-')
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9 .'-]/gi, '')
  .replace(/\s+/g, ' ');

// ------------------------------------------------------------ work list
function buildWorkList() {
  const items = [];
  const push = (group, e, storyText, bucketKey, stageOnly) => {
    items.push({
      id: `cmp-${String(items.length + 1).padStart(3, '0')}`,
      group,
      place_key: e.place_key,
      place_name: e.place_name,
      angle: e.angle,
      lat: e.lat,
      lng: e.lng,
      story_text: storyText,
      persona_version: e.persona_version || 'leo-v14',
      model: e.model || 'gemini-3.8-flash',
      voice: e.voice || TTS_VOICE,
      bucket_key: bucketKey,
      stage_only: !!stageOnly,
      regions: e.regions || null,
      segment_id: e.segment_id || null,
      slug: e.slug || null,
      status: 'pending',
      audio_file: null,
      duration_s: null,
      batch_job: null,
      error: null,
    });
  };

  // 1 — gapfill (manifest order; held: Convoy, Bird Rock Coffee)
  const gap = JSON.parse(readFileSync(path.join(WS, 'gapfill-corpus-v14/manifest.json'), 'utf8'));
  for (const e of gap) {
    if (/convoy/i.test(e.place_name) || /bird rock coffee/i.test(e.place_name)) continue;
    const key = e.angle === 'corridor'
      ? `library/${asciiFold(e.place_key)}/corridor-v14.wav`
      : `library/${asciiFold(e.place_key)}/${e.angle}.wav`;
    push('gapfill', e, e.story_text, key, false);
  }

  // 2 — batch2a (skip probe trio with audio + Barona held; polish wins)
  const b2a = JSON.parse(readFileSync(path.join(WS, 'batch2a-corpus-v14/manifest.json'), 'utf8'));
  const polish = JSON.parse(readFileSync(path.join(WS, 'batch2a-polish-v1/manifest.json'), 'utf8'));
  const polishBy = new Map(polish.map(p => [`${p.place_key}|${p.angle}`, p]));
  for (const e of b2a) {
    if (e.audio_file) continue; // El Cajon Mountain probe — already live
    if (/barona/i.test(e.place_name)) continue; // HELD
    const pol = polishBy.get(`${e.place_key}|${e.angle}`);
    push('batch2a', e, pol ? pol.story_text : e.story_text,
      `library/${asciiFold(e.place_key)}/${e.angle}.wav`, false);
    if (pol) items[items.length - 1].polished = pol.revision_of;
  }

  // 3 — regional fillers (build-fillers key pattern: raw place_key)
  const fil = JSON.parse(readFileSync(path.join(WS, 'filler-regional-corpus-v1/manifest.json'), 'utf8'));
  for (const e of fil) {
    push('fillers', e, e.story_text, `library/${e.place_key}/filler-v14.wav`, false);
  }

  // 4 — batch1 re-tells (fresh staging keys, no row writes)
  const b1 = JSON.parse(readFileSync(path.join(WS, 'batch1-entertainment-v1/manifest.json'), 'utf8'));
  for (const e of b1) {
    push('batch1-retell', e, e.story_text,
      `library/${asciiFold(e.place_key)}/${e.angle}-v14r.wav`, true);
  }
  return items;
}

// ------------------------------------------------------------ state
mkdirSync(audioDir, { recursive: true });
let state;
if (existsSync(manifestPath)) {
  state = JSON.parse(readFileSync(manifestPath, 'utf8'));
  console.log(`[campaign] resuming: ${state.items.filter(i => i.status === 'ingested' || i.status === 'staged').length}/${state.items.length} complete`);
} else {
  state = {
    campaign: 'master-render-2026-10-28',
    created_at: new Date().toISOString(),
    items: buildWorkList(),
    outstanding_job: null,
    submissions_by_date: {},
    held: [
      'Barona Cultural Center & Museum x3 (batch2a) — HELD at Erik approval',
      'Convoy Pan Asian Cultural District x3 (gapfill) — HELD at Erik approval',
      'Bird Rock Coffee Roasters x3 (gapfill) — HELD, seed pin unverified (master doc flag #4)',
      'El Cajon Mountain x3 (batch2a) — already live (probe trio), not part of the set',
    ],
  };
  saveState();
  console.log(`[campaign] work list built: ${state.items.length} items`);
}
function saveState() { writeFileSync(manifestPath, JSON.stringify(state, null, 2)); }
const byId = new Map(state.items.map(i => [i.id, i]));
const counts = g => state.items.filter(i => i.group === g).length;
console.log(`[campaign] groups: gapfill=${counts('gapfill')} batch2a=${counts('batch2a')} fillers=${counts('fillers')} batch1-retell=${counts('batch1-retell')} total=${state.items.length}`);
if (dryBuild) { console.log('[campaign] --dry-build: work list only, no API calls'); process.exit(0); }

const batchLog = existsSync(batchLogPath) ? JSON.parse(readFileSync(batchLogPath, 'utf8')) : [];
const saveBatchLog = () => writeFileSync(batchLogPath, JSON.stringify(batchLog, null, 2));

// ------------------------------------------------------------ sources mirror
// Each corpus manifest stays the truthful record of its own corpus
// (the house convention the builders keep): completed items mirror
// their audio state + a copy of the wav under the corpus's audio/.
const mirrors = {
  gapfill: loadMirror('gapfill-corpus-v14'),
  batch2a: loadMirror('batch2a-corpus-v14'),
  fillers: loadMirror('filler-regional-corpus-v1'),
  'batch1-retell': loadMirror('batch1-entertainment-v1'),
};
function loadMirror(dir) {
  const p = path.join(WS, dir, 'manifest.json');
  return { dir, path: p, entries: JSON.parse(readFileSync(p, 'utf8')) };
}
function mirror(item) {
  const m = mirrors[item.group];
  if (!m) return; // groups without a corpus mirror (e.g. corridor-182-fix) are recorded in the report instead
  const e = m.entries.find(x => x.place_key === item.place_key && (x.angle || 'filler') === item.angle);
  if (!e) { console.warn(`[campaign] mirror: no source entry for ${item.id} ${item.place_key}|${item.angle}`); return; }
  const corpusAudio = path.join(WS, m.dir, 'audio');
  mkdirSync(corpusAudio, { recursive: true });
  let fileName;
  if (item.group === 'fillers') fileName = `${item.slug}__filler.wav`;
  else fileName = `${item.place_key.replaceAll(' ', '-')}__${item.angle}.wav`;
  copyFileSync(path.join(audioDir, item.audio_file), path.join(corpusAudio, fileName));
  e.audio_file = fileName;
  e.duration_s = item.duration_s;
  if (item.group === 'fillers') e.duration_sec = item.duration_s;
  e.tts_route = 'batch';
  e.batch_job = item.batch_job;
  e.audio_path = item.bucket_key;
  if (item.group === 'batch1-retell') e.staged_audio_path = item.bucket_key;
  writeFileSync(m.path, JSON.stringify(m.entries, null, 2));
}

// ------------------------------------------------------------ ingest
let applyPron = s => s;
if (state.items.some(i => i.payload_pronunciation)) {
  const app = await import('/tmp/leo-app-bundle.mjs');
  if (typeof app.applyPronunciation !== 'function') throw new Error('app bundle lacks applyPronunciation — re-run bundle-app.mjs');
  applyPron = app.applyPronunciation;
  console.log('[campaign] pronunciation payload transform armed for flagged items');
}
const keys = await loadKeys();
if (!keys.supabaseUrl) throw new Error('Supabase URL not found in live bundle');
const base = keys.supabaseUrl;
const headers = { apikey: keys.anonKey, Authorization: `Bearer ${keys.anonKey}` };

async function uploadObject(item, bytes) {
  const url = `${base}/storage/v1/object/tts-audio/${item.bucket_key.split('/').map(encodeURIComponent).join('/')}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const up = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'audio/wav', 'x-upsert': 'false' },
        body: bytes,
        signal: AbortSignal.timeout(120_000),
      });
      if (up.ok) return;
      const body = await up.text();
      if (up.status === 409 || body.includes('KeyAlreadyExists') || body.includes('already exists')) return; // idempotent
      throw new Error(`HTTP ${up.status} ${body.slice(0, 200)}`);
    } catch (err) {
      if (attempt === 3) throw new Error(`storage upload failed for ${item.bucket_key}: ${err.message}`);
      console.warn(`  upload attempt ${attempt} failed for ${item.bucket_key} (${err.message}); retrying`);
      await sleep(3000);
    }
  }
}

async function insertRow(item) {
  const row = {
    place_key: item.place_key,
    place_name: item.place_name,
    angle: item.angle,
    lat: item.lat,
    lng: item.lng,
    story_text: item.story_text,
    audio_path: item.bucket_key,
    persona_version: item.persona_version,
    model: item.model,
    voice: item.voice,
  };
  const ins = await fetch(`${base}/rest/v1/story_library`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  if (!ins.ok) throw new Error(`story_library insert failed for ${item.bucket_key}: HTTP ${ins.status} ${(await ins.text()).slice(0, 200)}`);
}

async function processResult(item, result, jobName) {
  const { bytes, format } = ensureWav(result.bytes, result.mimeType);
  const fileName = `${item.id}__${item.place_key.replaceAll(' ', '-')}__${item.angle}.wav`;
  writeFileSync(path.join(audioDir, fileName), bytes);
  item.audio_file = fileName;
  item.audio_format = format;
  item.audio_bytes = bytes.length;
  item.duration_s = wavDurationSec(bytes);
  item.tts_route = 'batch';
  item.batch_job = jobName;
  await uploadObject(item, bytes);
  if (item.stage_only) {
    item.status = 'staged';
    console.log(`[campaign] ${item.id} STAGED ${item.place_name}|${item.angle}: ${item.duration_s}s -> ${item.bucket_key}`);
  } else {
    await insertRow(item);
    item.status = 'ingested';
    console.log(`[campaign] ${item.id} INGESTED ${item.place_name}|${item.angle}: ${item.duration_s}s -> ${item.bucket_key}`);
  }
  delete item.error;
  mirror(item);
  saveState();
}

// ------------------------------------------------------------ collect outstanding
async function collectJob(jobName, itemIds) {
  console.log(`[campaign] collecting job ${jobName} (${itemIds.length} items)`);
  const results = await pollTtsBatch(keys.geminiKey, jobName);
  for (const id of itemIds) {
    const item = byId.get(id);
    if (!item || item.status === 'ingested' || item.status === 'staged') continue;
    const r = results.get(id);
    if (r?.bytes) await processResult(item, r, jobName);
    else {
      item.status = 'failed';
      item.error = r?.error || 'missing from batch output';
      saveState();
      console.error(`[campaign] ${id} FAILED in ${jobName}: ${item.error}`);
    }
  }
}

if (state.outstanding_job) {
  const { job, item_ids } = state.outstanding_job;
  try {
    await collectJob(job, item_ids);
    state.outstanding_job = null;
    saveState();
  } catch (e) {
    if (String(e.message).includes('timed out')) {
      console.error(`[campaign] job ${job} still running server-side — checkpointing; re-run to collect`);
      process.exit(0);
    }
    throw e;
  }
}

// ------------------------------------------------------------ submit chunks
const pending = state.items.filter(i => i.status === 'pending' || i.status === 'failed');
console.log(`[campaign] pending this run: ${pending.length}`);
const CHUNK = 10;
let quotaStop = false;
for (let i = 0; i < pending.length && !quotaStop; i += CHUNK) {
  const chunk = pending.slice(i, i + CHUNK);
  // Payload is the canonical story_text for every item EXCEPT ones
  // flagged payload_pronunciation (the corridor-182-fix replacement,
  // per Amendment 4's explicit instruction): those get the app's
  // applyPronunciation transform on the payload only — the stored
  // story_text stays canonical, per the lexicon's own doctrine.
  const items = chunk.map(e => ({
    key: e.id,
    text: e.payload_pronunciation ? applyPron(e.story_text) : e.story_text,
  }));
  let jobName = null;
  try {
    jobName = await submitTtsBatch(keys.geminiKey, items, `leo-master-render-${new Date().toISOString().slice(0, 19)}`);
  } catch (e) {
    console.error(`[campaign] SUBMIT FAILED: ${e.message}`);
    if (/429|quota|resource_exhausted/i.test(String(e.message))) quotaStop = true;
    // Any submit failure checkpoints the run (the job was never
    // created server-side, so nothing is outstanding): a resume
    // retries submission. (Lesson of the Oct 28 service restart:
    // rethrowing here crashed the runner on a network outage.)
    console.error('[campaign] checkpointing — re-run to resume submissions');
    break;
  }
  const today = pacificDate();
  state.submissions_by_date[today] = (state.submissions_by_date[today] || 0) + items.length;
  state.outstanding_job = { job: jobName, item_ids: chunk.map(e => e.id), submitted_at: new Date().toISOString() };
  batchLog.push({ job: jobName, submitted: items.length, at: new Date().toISOString(), keys: items.map(x => x.key), chars: items.reduce((a, x) => a + x.text.length, 0) });
  saveBatchLog();
  saveState();
  console.log(`[campaign] submitted ${items.length} as ${jobName} (${state.submissions_by_date[today]} campaign items today)`);
  try {
    await collectJob(jobName, state.outstanding_job.item_ids);
    state.outstanding_job = null;
    saveState();
  } catch (e) {
    if (String(e.message).includes('timed out')) {
      console.error(`[campaign] collect timed out — job ${jobName} left running server-side; re-run to collect (no new submissions made against it)`);
      break;
    }
    if (/429|quota|resource_exhausted/i.test(String(e.message))) { quotaStop = true; break; }
    console.error(`[campaign] job ${jobName} error: ${e.message} — chunk left for next run`);
    state.outstanding_job = null;
    for (const it of chunk) if (it.status === 'pending') { it.status = 'failed'; it.error = String(e.message).slice(0, 300); }
    saveState();
  }
}

// ------------------------------------------------------------ swap SQL
function writeSwapSql() {
  const staged = state.items.filter(i => i.group === 'batch1-retell' && i.status === 'staged');
  const esc = s => s.replace(/'/g, "''");
  const lines = [
    "-- Leo's World — Batch 1 entertainment re-tell swap (Oct 28, 2026).",
    '-- Companion: ~/workspace/leos-world/batch1-entertainment-audit-2026-10-28.md',
    '-- and ~/workspace/leos-world/render-campaign-report-2026-10-28.md.',
    '--',
    `-- WHAT: ${staged.length} of the 7 entertainment-pass re-tells (5 opening-surgery`,
    '-- polishes + 2 full regenerations, texts approved by Erik Oct 28) have',
    '-- their new audio staged in the bucket under <angle>-v14r.wav keys',
    '-- (uploads are no-upsert; the current <angle>.wav objects stay untouched',
    '-- as the fallback). These UPDATEs repoint each row at the new text + new',
    '-- audio key. Nothing else changes.',
    '--',
    '-- HOW TO RUN: paste this whole file into the Bolt database panel Query',
    '-- box and run it once. After running, tell Muse and the swap will be',
    '-- verified by anon-key read (rows on -v14r.wav keys).',
    '',
  ];
  staged.forEach((item, n) => {
    lines.push(`-- ${n + 1}. ${item.place_name} (${item.angle})`);
    lines.push('UPDATE public.story_library');
    lines.push(`SET story_text = '${esc(item.story_text)}',`);
    lines.push(`    audio_path = '${item.bucket_key}'`);
    lines.push(`WHERE place_key = '${esc(item.place_key)}' AND angle = '${item.angle}';`);
    lines.push('');
  });
  writeFileSync(swapSqlPath, lines.join('\n'));
  return staged.length;
}
const stagedCount = writeSwapSql();

// ------------------------------------------------------------ summary
const done = state.items.filter(i => i.status === 'ingested' || i.status === 'staged');
const failed = state.items.filter(i => i.status === 'failed');
const left = state.items.filter(i => i.status === 'pending');
const cnt = await fetch(`${base}/rest/v1/story_library?select=place_key`, { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } });
console.log(`[campaign] SUMMARY: complete ${done.length}/${state.items.length} (ingested ${done.filter(i => !i.stage_only).length}, staged ${stagedCount}), failed ${failed.length}, pending ${left.length}, quotaStop=${quotaStop}`);
console.log(`[campaign] live census now: ${cnt.headers.get('content-range')}`);
if (failed.length) console.log(`[campaign] failed: ${failed.map(f => `${f.id}:${f.place_key}|${f.angle}`).join('; ')}`);
if (left.length) console.log(`[campaign] next up: ${left.slice(0, 3).map(f => `${f.id}:${f.place_name}|${f.angle}`).join('; ')}`);
console.log(`[campaign] swap SQL written: ${swapSqlPath} (${stagedCount} updates)`);
