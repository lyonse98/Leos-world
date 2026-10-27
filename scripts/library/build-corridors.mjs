// Highway Corridor Library builder (pre-publish stack Item 6,
// Oct 27, 2026).
//
//   git show f1b0022:src/services/leoPersona.ts > /tmp/leo-persona-v13.ts
//   node scripts/library/bundle-corridors.mjs     # once: bundle modules
//   node scripts/library/build-corridors.mjs [--segments=id1,id2] [--tts=batch|live|off] [--no-ingest]
//
// One banked story per (segment, direction) from src/data/corridors.ts,
// generated with the leo-v13 persona (the library's voice — see
// bundle-corridors.mjs for why the persona is pinned to the v13
// source) from free fact sources only: Wikipedia + OSM + Wikidata +
// the historic registry, sampled at each neighborhood anchor along
// the segment — the same sources, assembled the same way, as the
// 345-story place corpus (lib.mjs assembleFacts). Audio: one Gemini
// Batch API TTS job per run; live synthesis is the fallback with the
// shared hard stop (85/day — Erik's interactive quota is 100/day on
// the same key and the builder never spends the last of it).
//
// Ingestion follows ingest.mjs exactly: audio → tts-audio bucket at
// library/<place_key>/corridor.wav (x-upsert:false), rows →
// story_library with Prefer: resolution=ignore-duplicates, keyed
// (place_key = normalizePlaceKey(displayName), angle = 'corridor').
// Re-runnable and resumable: the manifest is the progress record;
// finished stories are never regenerated.
//
// Outputs: LEO_CORRIDOR_DIR or ~/workspace/leos-world/corridor-corpus-v1
// ({manifest.json, audio/})

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

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const corpusDir = process.env.LEO_CORRIDOR_DIR || path.join(homedir(), 'workspace/leos-world/corridor-corpus-v1');
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

const app = await import('/tmp/leo-corridor-bundle.mjs');
if (app.LEO_PERSONA_VERSION !== 'leo-v13') {
  console.error(`[corridors] bundle persona is ${app.LEO_PERSONA_VERSION}, expected leo-v13 — re-run bundle-corridors.mjs`);
  process.exit(1);
}
const keys = await loadKeys();
const ai = makeTextClient(keys.geminiKey);
const records = loadRegistry(repoRoot);

const selectedIds = argVal('segments', null)?.split(',').filter(Boolean) ?? null;
const segments = app.CORRIDOR_SEGMENTS.filter(s => !selectedIds || selectedIds.includes(s.id));
if (segments.length === 0) {
  console.error('[corridors] no segments selected');
  process.exit(2);
}
console.log(`[corridors] ${segments.length} segment(s) selected`);

mkdirSync(audioDir, { recursive: true });
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const byId = new Map(manifest.map(e => [e.segment_id, e]));
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const batchLog = existsSync(batchLogPath) ? JSON.parse(readFileSync(batchLogPath, 'utf8')) : [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------ prompt
// The corridor telling (Item 6 doctrine): a long-arc region
// narrative, not a point story. Narrate the neighborhoods IN THE
// ORDER the driver passes them; each neighborhood is a portal —
// its paragraph opens onto the bigger story it belongs to (the bay,
// the canyon system, the border, the Navy's presence, the park).
// Direction-aware: what is ahead and on the driver's side, never a
// rear-view narration. LENGTH IS SIZED BY THE ROAD (Erik's sizing
// rule, Oct 27, 2026): the story fills ~85-90% of this segment's
// traversal at its design speed — corridorTargetSentences() in the
// dataset is the rule as code. The honesty contract is the
// library's own: facts come from the fact blocks below or they do
// not appear.
function buildCorridorPrompt(segment, areaFacts) {
  const parts = [];
  const targetSentences = app.corridorTargetSentences(segment);
  const traversalMin = (segment.lengthKm * 1000) / app.designSpeedMps(segment) / 60;
  const driveLine =
    segment.fromName === segment.toName
      ? `The drive: the stretch of freeway through ${segment.fromName}, about ${segment.lengthKm} km of freeway.`
      : `The drive: from ${segment.fromName} to ${segment.toName}, about ${segment.lengthKm} km of freeway.`;
  parts.push(
    [
      'MODE: highway',
      `Freeway: ${segment.freeway}, ${segment.direction}`,
      driveLine,
      `Areas the drive passes, IN ORDER: ${segment.areas.map(a => a.name).join(', ')}.`,
    ].join('\n')
  );
  for (const { area, facts } of areaFacts) {
    const blocks = [facts.wikiContext, facts.osmContext, facts.wikidataContext, facts.registryContext].filter(Boolean);
    if (blocks.length > 0) parts.push(`FACTS — ${area.name}:\n${blocks.join('\n')}`);
  }
  parts.push(
    `TELL THE STORY OF: this drive — "${segment.displayName}". ` +
      'The listener is ON this freeway, moving, and will be for the next several minutes. ' +
      'Narrate the country they are passing through: take the neighborhoods in the order the drive passes them, ' +
      'and let each one open onto the bigger story it belongs to — the bay and the canyons, the border, the Navy, ' +
      'the park, the old towns under the new ones. This is one continuous telling about a place unfolding, ' +
      'not a list of exits and not a point story about a single landmark. ' +
      'Speak of what is ahead of the driver and around them now — never narrate what is already behind them. ' +
      'Where the drive climbs, crosses, or opens a view, say so; the road itself is the narrator\'s stage. ' +
      `LENGTH: about ${targetSentences} sentences — this stretch takes roughly ${traversalMin.toFixed(1)} minutes to drive at free-flow speed, and the story should fill most of that drive, finishing just before the road hands off to the next stretch. Depth from the facts at hand, never from invention.`
  );
  return parts.join('\n\n');
}

// ------------------------------------------------------------ text phase
for (const segment of segments) {
  const placeKey = app.normalizePlaceKey(segment.displayName);
  let entry = byId.get(segment.id);
  if (entry?.story_text) {
    console.log(`[corridors] ${segment.id}: text exists (${entry.story_text.length} chars), skipping`);
    continue;
  }
  const areaFacts = [];
  const allSources = new Set();
  for (const area of segment.areas) {
    const facts = await assembleFacts(app, records, { name: area.name }, { lat: area.lat, lng: area.lng });
    facts.sources.forEach(s => allSources.add(s));
    areaFacts.push({ area, facts });
    console.log(`[corridors] ${segment.id} · ${area.name}: facts ${facts.sources.join('+') || 'NONE'}`);
  }
  const prompt = buildCorridorPrompt(segment, areaFacts);
  const text = await generateText(ai, app, prompt);
  const mid = segment.polyline[Math.floor(segment.polyline.length / 2)];
  entry = {
    segment_id: segment.id,
    place_key: placeKey,
    place_name: segment.displayName,
    angle: 'corridor',
    lat: mid.lat,
    lng: mid.lng,
    coord_source: 'segment polyline midpoint (hand-laid, Item 6 Part A)',
    target_sentences: app.corridorTargetSentences(segment),
    story_text: text,
    audio_file: null,
    persona_version: app.LEO_PERSONA_VERSION,
    model: app.LEO_MODEL_ID,
    tts_model: TTS_MODEL,
    voice: TTS_VOICE,
    fact_sources: [...allSources],
  };
  byId.set(segment.id, entry);
  manifest.push(entry);
  saveManifest();
  console.log(`[corridors] ${segment.id}: generated ${text.length} chars`);
  await sleep(2000);
}

// ------------------------------------------------------------ TTS phase
const pending = [...byId.values()].filter(
  e => segments.some(s => s.id === e.segment_id) && e.story_text && !e.audio_file
);
console.log(`[corridors] TTS pending: ${pending.length} stor${pending.length === 1 ? 'y' : 'ies'} (mode: ${ttsMode}, live count today: ${liveTtsCount()})`);

function recordAudio(entry, result, route, batchJob) {
  const { bytes, format } = ensureWav(result.bytes, result.mimeType);
  const fileName = `${entry.place_key.replaceAll(' ', '-')}__corridor.wav`;
  writeFileSync(path.join(audioDir, fileName), bytes);
  entry.audio_file = fileName;
  entry.audio_format = format;
  entry.audio_bytes = bytes.length;
  entry.duration_s = wavDurationSec(bytes);
  entry.tts_route = route;
  if (batchJob) entry.batch_job = batchJob;
  delete entry.tts_error;
  saveManifest();
  console.log(`[corridors]   audio ${fileName}: ${bytes.length} bytes, ${entry.duration_s}s, ${format}, via ${route}`);
}

async function runLiveTts(list, route) {
  let done = 0;
  for (const entry of list) {
    if (liveTtsCount() >= LIVE_DAILY_STOP) {
      console.warn(`[corridors] LIVE STOP: ${liveTtsCount()} live syntheses today (cap ${LIVE_DAILY_STOP}) — ${list.length - done} stories deferred`);
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
      console.warn(`[corridors]   live TTS failed for ${entry.segment_id}: ${entry.tts_error}`);
    }
    await sleep(1500);
  }
}

if (pending.length > 0 && ttsMode !== 'off') {
  if (ttsMode === 'batch') {
    try {
      const items = pending.map(e => ({ key: e.segment_id, text: e.story_text }));
      const name = await submitTtsBatch(keys.geminiKey, items, `leo-corridors-${new Date().toISOString().slice(0, 10)}`);
      batchLog.push({ name, submittedAt: new Date().toISOString(), keys: items.map(i => i.key) });
      writeFileSync(batchLogPath, JSON.stringify(batchLog, null, 2));
      console.log(`[corridors] batch job submitted: ${name} (${items.length} items)`);
      const results = await pollTtsBatch(keys.geminiKey, name);
      const failed = [];
      for (const entry of pending) {
        const r = results.get(entry.segment_id);
        if (r && !r.error) recordAudio(entry, r, 'batch', name);
        else {
          failed.push(entry);
          console.warn(`[corridors]   batch item failed for ${entry.segment_id}: ${r?.error ? String(r.error).slice(0, 200) : 'missing from results'}`);
        }
      }
      if (failed.length > 0) {
        console.log(`[corridors] falling back to live TTS for ${failed.length} item(s)`);
        await runLiveTts(failed, 'live-fallback');
      }
    } catch (e) {
      console.warn(`[corridors] batch path failed (${String(e?.message || e).slice(0, 200)}) — falling back to live TTS`);
      await runLiveTts(pending, 'live-fallback');
    }
  } else {
    await runLiveTts(pending, 'live');
  }
}

// ------------------------------------------------------------ ingest
const ready = [...byId.values()].filter(
  e => segments.some(s => s.id === e.segment_id) && e.story_text && e.audio_file
);
if (doIngest && ready.length > 0) {
  if (!keys.supabaseUrl) throw new Error('Supabase URL not found in live bundle');
  const base = keys.supabaseUrl;
  const headers = {
    apikey: keys.anonKey,
    Authorization: `Bearer ${keys.anonKey}`,
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
    const bucketKey = `library/${asciiPlace}/corridor.wav`;
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
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    if (!ins.ok) {
      throw new Error(`story_library insert failed for ${bucketKey}: HTTP ${ins.status} ${(await ins.text()).slice(0, 200)}`);
    }
    rows++;
    console.log(`[corridors] ingested ${e.segment_id} → ${bucketKey}`);
  }
  console.log(`[corridors] ingest done: ${uploaded} audio uploads (${ready.length - uploaded} already present), ${rows} row upserts attempted`);
}

const complete = [...byId.values()].filter(e => segments.some(s => s.id === e.segment_id) && e.story_text && e.audio_file);
console.log(`[corridors] DONE: ${complete.length}/${segments.length} selected segments complete (text + audio${doIngest ? ' + ingest attempted' : ''})`);
const incomplete = segments.filter(s => !byId.get(s.id)?.audio_file).map(s => s.id);
if (incomplete.length > 0) console.log(`[corridors] incomplete: ${incomplete.join(', ')}`);
