// Neighborhood Library builder (pre-publish stack Item 8,
// Oct 27, 2026).
//
//   node scripts/library/bundle-corridors.mjs     # once: bundle modules (shared)
//   node scripts/library/build-neighborhoods.mjs [--areas=slug1,slug2] [--tts=batch|live|off] [--no-ingest]
//
// One banked welcome intro per area in neighborhoods.mjs,
// generated with the leo-v13 persona (the library's voice — the
// persona is pinned to the v13 source in the shared bundle) from
// free fact sources only: Wikipedia + OSM + Wikidata + the
// historic registry, sampled at the area's anchor — the same
// sources, assembled the same way, as the 345-story place corpus
// and the corridor bank (lib.mjs assembleFacts). Audio: one Gemini
// Batch API TTS job per run; live synthesis is the fallback with
// the shared hard stop (85/day).
//
// The intro format is the app's own first-visit doctrine
// (gemini.ts neighborhood_intro): not a preamble — the most
// compelling true story of the neighborhood, what this place is
// about and how it got that way, 10-12 sentences, complete on its
// own. FACT QUALITY GATE (the Tecolote precedent): an area whose
// fact pack assembles without Wikipedia AND without the registry —
// the two narrative sources — is flagged thin_facts in the
// manifest and in neighborhood-library-v1.md as
// listen-before-trusting; it still banks (a flagged intro is
// Erik's keep/kill call), but it is never silently presented as
// verified.
//
// Ingestion follows ingest.mjs exactly: audio → tts-audio bucket at
// library/<place_key>/neighborhood_intro.wav (x-upsert:false),
// rows → story_library with Prefer: resolution=ignore-duplicates,
// keyed (place_key = normalizePlaceKey(areaName),
// angle = 'neighborhood_intro'). Re-runnable and resumable.
//
// Outputs: LEO_NEIGHBORHOOD_DIR or
// ~/workspace/leos-world/neighborhood-corpus-v1 ({manifest.json,
// audio/})

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadKeys, makeTextClient, loadRegistry,
  assembleFacts, generateText, liveTts, submitTtsBatch, pollTtsBatch,
  ensureWav, wavDurationSec, liveTtsCount, bumpLiveTtsCount, LIVE_DAILY_STOP,
  TTS_MODEL, TTS_VOICE,
} from './lib.mjs';
import { NEIGHBORHOOD_AREAS } from './neighborhoods.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const corpusDir = process.env.LEO_NEIGHBORHOOD_DIR || path.join(homedir(), 'workspace/leos-world/neighborhood-corpus-v1');
const audioDir = path.join(corpusDir, 'audio');
const manifestPath = path.join(corpusDir, 'manifest.json');
const batchLogPath = path.join(corpusDir, 'batch-jobs.json');

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : dflt;
};
const ttsMode = argVal('tts', 'batch');
const doIngest = !args.includes('--no-ingest');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const app = await import('/tmp/leo-corridor-bundle.mjs');
if (app.LEO_PERSONA_VERSION !== 'leo-v13') {
  console.error(`[neighborhoods] bundle persona is ${app.LEO_PERSONA_VERSION}, expected leo-v13 — re-run bundle-corridors.mjs`);
  process.exit(1);
}
const keys = await loadKeys();
const ai = makeTextClient(keys.geminiKey);
const records = loadRegistry(repoRoot);

const selected = argVal('areas', null)?.split(',').filter(Boolean) ?? null;
const areas = NEIGHBORHOOD_AREAS
  .map(a => ({ ...a, id: slug(a.name) }))
  .filter(a => !selected || selected.includes(a.id));
if (areas.length === 0) {
  console.error('[neighborhoods] no areas selected');
  process.exit(2);
}
console.log(`[neighborhoods] ${areas.length} area(s) selected`);

mkdirSync(audioDir, { recursive: true });
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const byId = new Map(manifest.map(e => [e.area_id, e]));
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const batchLog = existsSync(batchLogPath) ? JSON.parse(readFileSync(batchLogPath, 'utf8')) : [];

// ------------------------------------------------------------ prompt
// The welcome telling: the app's first-visit intro doctrine in the
// library's generation form. One compelling story, whole and
// complete — not an orientation list, not a gazetteer entry. The
// honesty contract is the library's own: facts come from the fact
// blocks below or they do not appear.
function buildIntroPrompt(area, facts) {
  const parts = [];
  parts.push(
    [
      'MODE: neighborhood_intro',
      `Neighborhood: ${area.name}, San Diego, California.`,
      'The listener has just arrived in this neighborhood for the first time on this tour, and this welcome is their introduction to it.',
    ].join('\n')
  );
  const blocks = [facts.wikiContext, facts.osmContext, facts.wikidataContext, facts.registryContext].filter(Boolean);
  if (blocks.length > 0) parts.push(`FACTS — ${area.name}:\n${blocks.join('\n')}`);
  parts.push(
    `TELL THE STORY OF: arriving in ${area.name}. ` +
      'This intro is not a preamble — it IS a story. Tell the single most compelling true story of this neighborhood: ' +
      'what this place is about and how it got that way — the founding bet, the disaster, the eccentric, the turning point ' +
      'that made it what it is. Make it complete on its own; do not bolt a separate landmark story onto the end of it — ' +
      'landmarks here get their own turns later. If the neighborhood opens onto a bigger story — the bay, the border, ' +
      'the Navy, the canyon system, the old towns under the new ones — let it open. Write it as a welcome: the listener ' +
      'should finish knowing what kind of place they have arrived in, and wanting to stay a while. ' +
      'LENGTH: 10 to 12 sentences. Depth from the facts at hand, never from invention.'
  );
  return parts.join('\n\n');
}

// ------------------------------------------------------------ text phase
for (const area of areas) {
  const placeKey = app.normalizePlaceKey(area.name);
  let entry = byId.get(area.id);
  if (entry?.story_text) {
    console.log(`[neighborhoods] ${area.id}: text exists (${entry.story_text.length} chars), skipping`);
    continue;
  }
  const facts = await assembleFacts(app, records, { name: area.name }, { lat: area.lat, lng: area.lng });
  console.log(`[neighborhoods] ${area.id} · ${area.name}: facts ${facts.sources.join('+') || 'NONE'}`);
  const prompt = buildIntroPrompt(area, facts);
  const text = await generateText(ai, app, prompt);
  const thinFacts = !facts.sources.includes('wikipedia') && !facts.sources.includes('historic_registry');
  entry = {
    area_id: area.id,
    place_key: placeKey,
    place_name: area.name,
    angle: 'neighborhood_intro',
    lat: area.lat,
    lng: area.lng,
    radius_m: area.radiusM,
    coord_source: 'neighborhood anchor (approximate center, neighborhoods.mjs)',
    story_text: text,
    audio_file: null,
    persona_version: app.LEO_PERSONA_VERSION,
    model: app.LEO_MODEL_ID,
    tts_model: TTS_MODEL,
    voice: TTS_VOICE,
    fact_sources: [...facts.sources],
    thin_facts: thinFacts,
  };
  byId.set(area.id, entry);
  manifest.push(entry);
  saveManifest();
  console.log(`[neighborhoods] ${area.id}: generated ${text.length} chars${thinFacts ? ' (THIN FACTS — listen before trusting)' : ''}`);
  await sleep(2000);
}

// ------------------------------------------------------------ TTS phase
const pending = [...byId.values()].filter(
  e => areas.some(a => a.id === e.area_id) && e.story_text && !e.audio_file
);
console.log(`[neighborhoods] TTS pending: ${pending.length} stor${pending.length === 1 ? 'y' : 'ies'} (mode: ${ttsMode}, live count today: ${liveTtsCount()})`);

function recordAudio(entry, result, route, batchJob) {
  const { bytes, format } = ensureWav(result.bytes, result.mimeType);
  const fileName = `${entry.place_key.replaceAll(' ', '-')}__neighborhood_intro.wav`;
  writeFileSync(path.join(audioDir, fileName), bytes);
  entry.audio_file = fileName;
  entry.audio_format = format;
  entry.audio_bytes = bytes.length;
  entry.duration_s = wavDurationSec(bytes);
  entry.tts_route = route;
  if (batchJob) entry.batch_job = batchJob;
  delete entry.tts_error;
  saveManifest();
  console.log(`[neighborhoods]   audio ${fileName}: ${bytes.length} bytes, ${entry.duration_s}s, ${format}, via ${route}`);
}

async function runLiveTts(list, route) {
  let done = 0;
  for (const entry of list) {
    if (liveTtsCount() >= LIVE_DAILY_STOP) {
      console.warn(`[neighborhoods] LIVE STOP: ${liveTtsCount()} live syntheses today (cap ${LIVE_DAILY_STOP}) — ${list.length - done} stories deferred`);
      break;
    }
    try {
      let result;
      try {
        result = await liveTts(keys.geminiKey, entry.story_text, 'prebuilt');
      } catch (e) {
        if (String(e.message).includes('400')) {
          result = await liveTts(keys.geminiKey, entry.story_text, 'sdk');
        } else throw e;
      }
      bumpLiveTtsCount();
      recordAudio(entry, result, route, null);
      done++;
    } catch (e) {
      entry.tts_error = String(e?.message || e).slice(0, 300);
      saveManifest();
      console.warn(`[neighborhoods]   live TTS failed for ${entry.area_id}: ${entry.tts_error}`);
    }
    await sleep(1500);
  }
}

if (pending.length > 0 && ttsMode !== 'off') {
  if (ttsMode === 'batch') {
    try {
      const items = pending.map(e => ({ key: e.area_id, text: e.story_text }));
      const name = await submitTtsBatch(keys.geminiKey, items, `leo-neighborhoods-${new Date().toISOString().slice(0, 10)}`);
      batchLog.push({ name, submittedAt: new Date().toISOString(), keys: items.map(i => i.key) });
      writeFileSync(batchLogPath, JSON.stringify(batchLog, null, 2));
      console.log(`[neighborhoods] batch job submitted: ${name} (${items.length} items)`);
      const results = await pollTtsBatch(keys.geminiKey, name);
      const failed = [];
      for (const entry of pending) {
        const r = results.get(entry.area_id);
        if (r && !r.error) recordAudio(entry, r, 'batch', name);
        else {
          failed.push(entry);
          console.warn(`[neighborhoods]   batch item failed for ${entry.area_id}: ${r?.error ? String(r.error).slice(0, 200) : 'missing from results'}`);
        }
      }
      if (failed.length > 0) {
        console.log(`[neighborhoods] falling back to live TTS for ${failed.length} item(s)`);
        await runLiveTts(failed, 'live-fallback');
      }
    } catch (e) {
      console.warn(`[neighborhoods] batch path failed (${String(e?.message || e).slice(0, 200)}) — falling back to live TTS`);
      await runLiveTts(pending, 'live-fallback');
    }
  } else {
    await runLiveTts(pending, 'live');
  }
}

// ------------------------------------------------------------ ingest
const ready = [...byId.values()].filter(
  e => areas.some(a => a.id === e.area_id) && e.story_text && e.audio_file
);
if (doIngest && ready.length > 0) {
  if (!keys.supabaseUrl) throw new Error('Supabase URL not found in live bundle');
  const base = keys.supabaseUrl;
  const headers = {
    apikey: <redacted>
    Authorization: <redacted>
    'Content-Type': 'application/json',
  };
  let uploaded = 0;
  let rows = 0;
  for (const e of ready) {
    // Same ASCII fold as ingest.mjs: storage rejects non-ASCII keys.
    const asciiPlace = e.place_key
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[–—]/g, '-')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9 .'-]/gi, '')
      .replace(/\s+/g, ' ');
    const bucketKey = `library/${asciiPlace}/neighborhood_intro.wav`;
    e.audio_path = bucketKey;
    saveManifest();
    const bytes = readFileSync(path.join(audioDir, e.audio_file));
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        const up = await fetch(`${base}/storage/v1/object/tts-audio/${bucketKey.split('/').map(encodeURIComponent).join('/')}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'audio/wav', 'x-upsert': 'false' },
          body: bytes,
          signal: AbortSignal.timeout(120_000),
        });
        if (up.ok) { uploaded++; done = true; }
        else {
          const body = await up.text();
          if (up.status === 409 || body.includes('KeyAlreadyExists') || body.includes('already exists')) done = true;
          else throw new Error(`HTTP ${up.status} ${body.slice(0, 200)}`);
        }
      } catch (err) {
        if (attempt === 3) throw new Error(`storage upload failed for ${bucketKey}: ${err.message}`);
        console.warn(`  upload attempt ${attempt} failed for ${bucketKey} (${err.message}); retrying`);
      }
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
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(60_000),
    });
    if (!ins.ok) throw new Error(`row insert failed for ${e.place_key}: HTTP ${ins.status} ${(await ins.text()).slice(0, 200)}`);
    rows++;
    console.log(`[neighborhoods] ingested ${e.area_id} → ${bucketKey}`);
  }
  console.log(`[neighborhoods] ingest complete: ${uploaded} audio uploaded, ${rows} rows attempted (ignore-duplicates)`);
}

const doneCount = [...byId.values()].filter(e => areas.some(a => a.id === e.area_id) && e.audio_path).length;
console.log(`[neighborhoods] DONE: ${doneCount}/${areas.length} areas banked`);
