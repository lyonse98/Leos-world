// Highway Corridor Library builder (pre-publish stack Item 6,
// Oct 27, 2026).
//
//   git show f1b0022:src/services/leoPersona.ts > /tmp/leo-persona-v13.ts
//   node scripts/library/bundle-corridors.mjs     # once: bundle modules
//   node scripts/library/build-corridors.mjs [--segments=id1,id2] [--tts=batch|live|off] [--no-ingest]
//
// One banked story per (segment, direction) from src/data/corridors.ts,
// generated with the leo-v14 persona (Erik's ruling, Oct 27, 2026:
// all new library content is v14 — the v1 bank was generated under
// v13 before the ruling and is replaced through the swap in
// ~/workspace/leos-world/v14-library-swap.md) from free fact
// sources only: Wikipedia + OSM + Wikidata +
// the historic registry. Fact assembly is corridor-facts.mjs: the
// per-area packs the place corpus uses (lib.mjs assembleFacts),
// PLUS deep-mode retry, polyline sampling along the segment's own
// line, inheritance from library subjects the drive passes, a
// registry buffer pass, and a tier-3 name-search fallback — the
// upgrade that fixes the v1 bank's 10 zero-fact segments (see
// ~/workspace/leos-world/corridor-fact-fix-report.md). Audio: one Gemini
// Batch API TTS job per run; live synthesis is the fallback with the
// shared hard stop (85/day — Erik's interactive quota is 100/day on
// the same key and the builder never spends the last of it).
//
// Ingestion follows ingest.mjs exactly: audio → tts-audio bucket at
// library/<place_key>/corridor-v14.wav (x-upsert:false), rows →
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
  generateText, liveTts, submitTtsBatch, pollTtsBatch,
  ensureWav, wavDurationSec, liveTtsCount, bumpLiveTtsCount, LIVE_DAILY_STOP,
  TTS_MODEL, TTS_VOICE,
} from './lib.mjs';
import { assembleCorridorFacts, loadLibrarySubjects } from './corridor-facts.mjs';

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
if (app.LEO_PERSONA_VERSION !== 'leo-v14') {
  console.error(`[corridors] bundle persona is ${app.LEO_PERSONA_VERSION}, expected leo-v14 (Erik's Oct 27 ruling: all new library content is v14) — re-run bundle-corridors.mjs`);
  process.exit(1);
}
const keys = await loadKeys();
const ai = makeTextClient(keys.geminiKey);
const records = loadRegistry(repoRoot);
// Stage-C inheritance pool for corridor-facts.mjs: the banked place
// subjects (the 345) with their recorded fact sources.
const placeManifestPath =
  process.env.LEO_PLACE_MANIFEST ||
  path.join(homedir(), 'workspace/leos-world/library-corpus-v13/manifest.json');
const librarySubjects = loadLibrarySubjects(placeManifestPath);
console.log(`[corridors] ${librarySubjects.length} library subjects loaded for fact inheritance`);

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
  // THE v14 BRIEF (Erik's rulings, Oct 27, 2026 — all new library
  // content generates under this set; the neighborhood builder
  // carries its twin): mission first, the WOW lead as a gate,
  // portal connections SOURCE-GROUNDED (Ruling 2 — free invention
  // is out, even for links), and the position-binding ban at
  // segment scale.
  parts.push(
    'THE v14 BRIEF: This story exists to make the listener love this town more — to fall in love with the city for the first time, or all over again. ' +
      'THE WOW LEAD: open with the single most compelling or surprising fact in the material above — the story\'s first breath is the best thing in the pack, shaped as a hook; never spend the lead on orientation or a date. ' +
      'PORTAL, SOURCE-GROUNDED: every outward connection — neighborhood to bay, canyon, border, Navy, park — must be grounded in the material provided (the facts, published local history or lore, sourced local opinion); a connection you cannot ground, omit. Never invent a link. ' +
      'POSITION-BINDING: narrate this stretch as a place unfolding in order; no expiring micro-claims — nothing "on your left" or "on your right," no "you are about to pass" a specific building. The segment is the frame; what is true of the stretch stays true for the whole telling.'
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
  // Upgraded assembly (corridor-facts.mjs): per-area packs plus
  // deep-mode retry, polyline sampling, library-subject
  // inheritance, the registry buffer, and the tier-3 name-search
  // fallback. areaFacts keeps the { area, facts } shape the prompt
  // builder below already consumes; supplements arrive as extra
  // entries. factDetail is the per-stage account, kept on the
  // manifest entry so any bank can be audited after the fact.
  const { areaFacts, sources: allSources, detail: factDetail } = await assembleCorridorFacts(
    app, records, segment, librarySubjects
  );
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
    fact_stages: factDetail,
    // WOW/thin gate (Erik's ruling, Oct 27, 2026 — harmonized
    // with the neighborhood rule): a segment whose assembled pack
    // has neither Wikipedia nor the registry cannot support a
    // genuine wow lead from sources; flag it listen-before-
    // trusting in the v1 list.
    thin_facts: !allSources.has('wikipedia') && !allSources.has('historic_registry'),
  };
  byId.set(segment.id, entry);
  manifest.push(entry);
  saveManifest();
  console.log(`[corridors] ${segment.id}: generated ${text.length} chars${entry.thin_facts ? ' (THIN FACTS — listen before trusting)' : ''}`);
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
    // Versioned audio key (v14 re-bank, Oct 27, 2026): the v13
    // object already sits at corridor.wav and storage is
    // no-upsert — v14 audio must land at a NEW key or the swapped
    // row would point at v13 audio.
    const bucketKey = `library/${asciiPlace}/corridor-v14.wav`;
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
