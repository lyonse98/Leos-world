// Library corpus builder — CLI driver.
//
//   node scripts/library/bundle-app.mjs          # once: bundle app modules
//   node scripts/library/build-corpus.mjs --pilot
//   node scripts/library/build-corpus.mjs --places=13,12,3
//   node scripts/library/build-corpus.mjs --all [--tts=batch|live|off]
//
// Texts are generated with the REAL leo-v12 persona (bundled from the
// app) from free fact sources only. Audio: one Gemini Batch API TTS job
// per run by default; if the batch path fails, live synthesis is the
// fallback with a hard stop at 85 syntheses per Pacific day (Erik's
// interactive quota is 100/day on the same key — the builder never
// spends the last of it). Progress lives in the corpus manifest, so
// every run is resumable: finished stories are never regenerated.
//
// Outputs: ~/workspace/leos-world/library-corpus/{manifest.json, audio/}

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEEDS, CORRIDOR_ORDER, NORTH_PARK_ORDER } from './seeds.mjs';
import {
  loadKeys, makeTextClient, loadRegistry, registryCoordsFor, nominatimSearch,
  assembleFacts, buildPrompt, generateText, liveTts, submitTtsBatch, pollTtsBatch,
  ensureWav, wavDurationSec, liveTtsCount, bumpLiveTtsCount, LIVE_DAILY_STOP,
  TTS_MODEL, TTS_VOICE,
} from './lib.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const corpusDir = path.join(homedir(), 'workspace/leos-world/library-corpus');
const audioDir = path.join(corpusDir, 'audio');
const manifestPath = path.join(corpusDir, 'manifest.json');
const batchLogPath = path.join(corpusDir, 'batch-jobs.json');

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : dflt;
};
const ttsMode = argVal('tts', 'batch');

let selected;
if (args.includes('--pilot')) {
  selected = [1, 2, 12];
} else if (argVal('places', null)) {
  selected = argVal('places', '').split(',').map(s => parseInt(s, 10)).filter(Boolean);
} else if (args.includes('--all')) {
  const rest = SEEDS.map(s => s.n).filter(n => !CORRIDOR_ORDER.includes(n) && !NORTH_PARK_ORDER.includes(n));
  selected = [...CORRIDOR_ORDER, ...NORTH_PARK_ORDER, ...rest];
} else {
  console.error('Usage: build-corpus.mjs --pilot | --places=1,2,12 | --all [--tts=batch|live|off]');
  process.exit(2);
}

const app = await import('/tmp/leo-app-bundle.mjs');
const keys = await loadKeys();
const ai = makeTextClient(keys.geminiKey);
const records = loadRegistry(repoRoot);

mkdirSync(audioDir, { recursive: true });
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const byKey = new Map(manifest.map(e => [`${e.place_key}|${e.angle}`, e]));
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const batchLog = existsSync(batchLogPath) ? JSON.parse(readFileSync(batchLogPath, 'utf8')) : [];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const angleFor = short => {
  const a = app.LANDMARK_ANGLES.find(x => x === `landmark_${short}`);
  if (!a) throw new Error(`unknown angle short key: ${short}`);
  return a;
};

// ------------------------------------------------------------ text phase
for (const n of selected) {
  const seed = SEEDS.find(s => s.n === n);
  if (!seed) { console.warn(`[build] seed #${n} not found, skipping`); continue; }
  const placeKey = app.normalizePlaceKey(seed.name);

  let coords;
  const regRec = registryCoordsFor(records, seed.name);
  if (regRec) {
    coords = { lat: regRec.lat, lng: regRec.lng, source: `registry (${regRec.coordQuality})` };
  } else {
    // Nominatim is picky about long comma-suffixed queries — fall back
    // through progressively simpler forms before giving up on a place.
    let geo = null;
    let usedQuery = null;
    for (const q of [seed.query, seed.name, `${seed.name}, California`]) {
      geo = await nominatimSearch(q).catch(() => null);
      if (geo) { usedQuery = q; break; }
    }
    if (!geo) { console.error(`[build] #${n} ${seed.name}: no coordinates found — SKIPPED`); continue; }
    coords = { ...geo, source: `nominatim (${usedQuery})` };
  }

  const facts = await assembleFacts(app, records, seed, coords);
  console.log(`[build] #${n} ${seed.name} @ ${coords.lat.toFixed(5)},${coords.lng.toFixed(5)} [${coords.source}] facts: ${facts.sources.join('+') || 'NONE'}`);

  const fullAngles = seed.angles.map(angleFor);
  for (let i = 0; i < fullAngles.length; i++) {
    const angle = fullAngles[i];
    const key = `${placeKey}|${angle}`;
    let entry = byKey.get(key);
    if (entry?.story_text) {
      console.log(`[build]   ${angle}: text exists (${entry.story_text.length} chars), skipping`);
      continue;
    }
    const prompt = buildPrompt(app, seed, coords, facts, angle, fullAngles.slice(0, i));
    const text = await generateText(ai, app, prompt);
    entry = {
      seed_n: seed.n,
      place_key: placeKey,
      place_name: seed.name,
      angle,
      lat: coords.lat,
      lng: coords.lng,
      coord_source: coords.source,
      story_text: text,
      audio_file: null,
      persona_version: app.LEO_PERSONA_VERSION,
      model: app.LEO_MODEL_ID,
      tts_model: TTS_MODEL,
      voice: TTS_VOICE,
      fact_sources: facts.sources,
    };
    byKey.set(key, entry);
    manifest.push(entry);
    saveManifest();
    console.log(`[build]   ${angle}: generated ${text.length} chars`);
    await sleep(2000);
  }
}

// ------------------------------------------------------------ TTS phase
const pending = [...byKey.values()].filter(
  e => selected.includes(e.seed_n) && e.story_text && !e.audio_file
);
console.log(`[build] TTS pending: ${pending.length} stor${pending.length === 1 ? 'y' : 'ies'} (mode: ${ttsMode}, live count today: ${liveTtsCount()})`);

function recordAudio(entry, result, route, batchJob) {
  const { bytes, format } = ensureWav(result.bytes, result.mimeType);
  const fileName = `${entry.place_key.replaceAll(' ', '-')}__${entry.angle}.wav`;
  writeFileSync(path.join(audioDir, fileName), bytes);
  entry.audio_file = fileName;
  entry.audio_format = format;
  entry.audio_bytes = bytes.length;
  entry.duration_s = wavDurationSec(bytes);
  entry.tts_route = route;
  if (batchJob) entry.batch_job = batchJob;
  delete entry.tts_error;
  saveManifest();
  console.log(`[build]   audio ${fileName}: ${bytes.length} bytes, ${entry.duration_s}s, ${format}, via ${route}`);
}

async function runLiveTts(list, route) {
  let done = 0;
  for (const entry of list) {
    if (liveTtsCount() >= LIVE_DAILY_STOP) {
      console.warn(`[tts] LIVE STOP: ${liveTtsCount()} live syntheses today (cap ${LIVE_DAILY_STOP}) — ${list.length - done} stories deferred`);
      break;
    }
    const spoken = app.applyPronunciation(entry.story_text);
    try {
      let result;
      try {
        result = await liveTts(keys.geminiKey, spoken, 'prebuilt');
      } catch (e) {
        if (String(e.message).includes('400')) {
          console.warn(`[tts] prebuilt voice config rejected, retrying SDK shape: ${e.message.slice(0, 160)}`);
          result = await liveTts(keys.geminiKey, spoken, 'sdk');
        } else throw e;
      }
      bumpLiveTtsCount();
      recordAudio(entry, result, route, null);
      done++;
    } catch (e) {
      entry.tts_error = String(e.message || e).slice(0, 300);
      saveManifest();
      console.error(`[tts] FAILED ${entry.place_key}|${entry.angle}: ${entry.tts_error}`);
      if (String(e.message).includes('429')) {
        console.warn('[tts] 429 — quota wall; stopping live TTS for this run');
        break;
      }
    }
    await sleep(1500);
  }
  return done;
}

const collectBatch = argVal('collect-batch', null);
if (collectBatch && pending.length > 0) {
  // Attach to a batch job submitted by an earlier run (jobs live
  // server-side; a killed or timed-out client loses nothing).
  console.log(`[batch] collecting existing job ${collectBatch}`);
  try {
    const results = await pollTtsBatch(keys.geminiKey, collectBatch);
    let ok = 0;
    for (const entry of pending) {
      const r = results.get(`${entry.place_key}|${entry.angle}`);
      if (r?.bytes) { recordAudio(entry, r, 'batch', collectBatch); ok++; }
      else {
        entry.tts_error = r?.error || 'missing from batch output';
        saveManifest();
        console.error(`[batch] no audio for ${entry.place_key}|${entry.angle}: ${entry.tts_error}`);
      }
    }
    console.log(`[batch] collected ${ok}/${pending.length} audio files from ${collectBatch}`);
    const failed = pending.filter(e => !e.audio_file);
    if (failed.length > 0) await runLiveTts(failed, 'live-after-batch-failure');
  } catch (e) {
    console.error(`[batch] COLLECT FAILED: ${e.message}`);
    if (String(e.message).includes('timed out')) {
      // The job is almost certainly still running server-side. NEVER
      // fall back to live quota on a mere client timeout — re-run
      // --collect-batch later instead.
      console.error('[batch] collect timed out — job left running server-side; NOT falling back to live TTS');
    } else {
      await runLiveTts(pending, 'live-fallback');
    }
  }
} else if (ttsMode !== 'off' && pending.length > 0) {
  if (ttsMode === 'batch') {
    // Chunked submissions: 10 requests per job keeps each job's inlined
    // response ~40 MB — JSON.parse-able in one piece. (Lesson of the
    // 69-story job: its response was >512 MB, past Node's max string
    // length; it needed the streaming collector in collect-stream.mjs.)
    const CHUNK = 10;
    const chunks = [];
    for (let i = 0; i < pending.length; i += CHUNK) chunks.push(pending.slice(i, i + CHUNK));
    for (const chunkEntries of chunks) {
      const items = chunkEntries.map(e => ({
        key: `${e.place_key}|${e.angle}`,
        text: app.applyPronunciation(e.story_text),
      }));
      let jobName = null;
      try {
        jobName = await submitTtsBatch(keys.geminiKey, items, `leo-library-${new Date().toISOString().slice(0, 19)}`);
        batchLog.push({ job: jobName, submitted: items.length, at: new Date().toISOString(), keys: items.map(i => i.key) });
        writeFileSync(batchLogPath, JSON.stringify(batchLog, null, 2));
        console.log(`[batch] submitted ${items.length} requests as ${jobName}`);
        const results = await pollTtsBatch(keys.geminiKey, jobName);
        let ok = 0;
        for (const entry of chunkEntries) {
          const r = results.get(`${entry.place_key}|${entry.angle}`);
          if (r?.bytes) { recordAudio(entry, r, 'batch', jobName); ok++; }
          else {
            entry.tts_error = r?.error || 'missing from batch output';
            saveManifest();
            console.error(`[batch] no audio for ${entry.place_key}|${entry.angle}: ${entry.tts_error}`);
          }
        }
        console.log(`[batch] ${ok}/${chunkEntries.length} audio files from batch job`);
        // Per-item failures stay pending for a later targeted run —
        // at corpus scale an automatic live fallback spends Erik's
        // interactive quota on what is usually a content problem that
        // would fail live too. (The pilot-scale whole-batch failure
        // below is the brief's fallback case.)
      } catch (e) {
        console.error(`[batch] CHUNK FAILED: ${e.message}`);
        batchLog.push({ job: jobName, error: String(e.message).slice(0, 300), at: new Date().toISOString() });
        writeFileSync(batchLogPath, JSON.stringify(batchLog, null, 2));
        if (jobName && String(e.message).includes('timed out')) {
          // Job submitted and likely still running server-side — collect
          // it later with --collect-batch instead of burning live quota.
          console.error(`[batch] poll timed out; job ${jobName} left running — NOT falling back to live TTS`);
        } else if (!jobName) {
          // Submission itself failed: the batch path looks unavailable,
          // which is exactly the brief's live-fallback case.
          console.log('[batch] submit failed — falling back to live TTS for this chunk');
          await runLiveTts(chunkEntries, 'live-fallback');
        } else {
          console.error('[batch] job failed server-side; chunk left pending for a later run (no live fallback)');
          for (const entry of chunkEntries) entry.tts_error = String(e.message).slice(0, 300);
          saveManifest();
        }
      }
    }
  } else {
    await runLiveTts(pending, 'live');
  }
}

// ------------------------------------------------------------ summary
const mine = manifest.filter(e => selected.includes(e.seed_n));
const withText = mine.filter(e => e.story_text).length;
const withAudio = mine.filter(e => e.audio_file).length;
console.log(`[build] DONE for [${selected.join(',')}]: texts ${withText}, audio ${withAudio}, live TTS today ${liveTtsCount()}`);
