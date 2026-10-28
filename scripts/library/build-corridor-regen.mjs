// Corridor REGENERATION builder (corridor sameness audit,
// Oct 28, 2026 — Erik approved the audit's regeneration list).
//
//   node scripts/library/bundle-corridors.mjs            # once: bundle modules
//   node scripts/library/build-corridor-regen.mjs [--segments=id1,id2] [--tts=batch|live|off] [--facts-only=id]
//
// Regenerates ONLY the 26 audit-flagged segments (specs:
// ~/workspace/leos-world/corridor-regen-v1/specs.json), each under
// a binding brief: the audit's replacement lead + an exclusion
// list (the flagged-against segment's core facts) + the texture
// rule (never re-describe the previous segment's painted backdrop)
// + the neighbor rule (point at a neighbor's subject in one line;
// never tell it). Two SR-94 segments are SEAM rewrites: the model
// rewrites the opening only and carries the body forward intact.
// One special case (sr-52-wb-tierrasanta-kearny-mesa) gets a
// tier-3 name-search enrichment pass before generation.
//
// SWAP DISCIPLINE: story_library rows and storage objects are
// append-only / no-upsert for the anon key, so NOTHING here writes
// to the database and regenerated audio uploads under a FRESH key
// (corridor-v14r.wav). The repoint happens when Erik pastes
// ~/workspace/leos-world/corridor-regen-swap.sql into the Bolt
// database panel. Until then the live bank is untouched.
//
// Outputs: ~/workspace/leos-world/corridor-regen-v1/
// ({specs.json, manifest.json, audio/, batch-jobs.json}).
// Resumable: manifest entries with text/audio/upload are skipped.

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
const corpusDir = process.env.LEO_CORRIDOR_REGEN_DIR || path.join(homedir(), 'workspace/leos-world/corridor-regen-v1');
const audioDir = path.join(corpusDir, 'audio');
const manifestPath = path.join(corpusDir, 'manifest.json');
const batchLogPath = path.join(corpusDir, 'batch-jobs.json');
const specsPath = path.join(corpusDir, 'specs.json');
const origManifestPath = path.join(homedir(), 'workspace/leos-world/corridor-corpus-v2/manifest.json');

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : dflt;
};
const ttsMode = argVal('tts', 'batch');
const factsOnlyId = argVal('facts-only', null);

const app = await import('/tmp/leo-corridor-bundle.mjs');
if (app.LEO_PERSONA_VERSION !== 'leo-v14') {
  console.error(`[regen] bundle persona is ${app.LEO_PERSONA_VERSION}, expected leo-v14 — re-run bundle-corridors.mjs`);
  process.exit(1);
}
const keys = await loadKeys();
const ai = makeTextClient(keys.geminiKey);
const records = loadRegistry(repoRoot);
const placeManifestPath =
  process.env.LEO_PLACE_MANIFEST ||
  path.join(homedir(), 'workspace/leos-world/library-corpus-v13/manifest.json');
const librarySubjects = loadLibrarySubjects(placeManifestPath);

const specs = JSON.parse(readFileSync(specsPath, 'utf8'));
const specById = new Map(specs.map(s => [s.segment_id, s]));
const origManifest = JSON.parse(readFileSync(origManifestPath, 'utf8'));
const origById = new Map(origManifest.map(e => [e.segment_id, e]));

const selectedIds = argVal('segments', null)?.split(',').filter(Boolean) ?? specs.map(s => s.segment_id);
const segments = app.CORRIDOR_SEGMENTS.filter(s => selectedIds.includes(s.id) && specById.has(s.id));
if (segments.length === 0) { console.error('[regen] no segments selected'); process.exit(2); }
console.log(`[regen] ${segments.length} segment(s) selected`);

mkdirSync(audioDir, { recursive: true });
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const byId = new Map(manifest.map(e => [e.segment_id, e]));
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const batchLog = existsSync(batchLogPath) ? JSON.parse(readFileSync(batchLogPath, 'utf8')) : [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// -------------------------------------------- tier-3 name search
// (build-corpus.mjs pattern): retrieve a Wikipedia article by NAME
// when the pack needs material geosearch does not assemble.
async function wikiNameSearch(query) {
  // Wikimedia throttles UA-less bursts with an HTML error page —
  // send a descriptive User-Agent (the Oct 28 facts probe failed
  // all four searches without one).
  const H = { 'User-Agent': 'LeosWorld-LibraryBuilder/1.0 (corridor-regen; repo lyonse98/Leos-world)' };
  const q = encodeURIComponent(query);
  const sres = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=3&format=json`, { headers: H, signal: AbortSignal.timeout(20_000) });
  const sjson = await sres.json();
  const title = sjson?.query?.search?.[0]?.title || null;
  if (!title) return null;
  const tres = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(title)}&format=json`, { headers: H, signal: AbortSignal.timeout(20_000) });
  const tjson = await tres.json();
  const page = Object.values(tjson?.query?.pages ?? {})[0];
  const extract = (page?.extract ?? '').trim();
  return extract.length > 400 ? { title, extract } : null;
}

// Enrichment for the special case: land/history angles around the
// Tierrasanta → Kearny Mesa crossing that the standard pack does
// not assemble (Camp Elliott's southern ground, the freeway's own
// construction history, the canyon drainages).
const ENRICH_QUERIES = ['Camp Elliott', 'California State Route 52', 'Tierrasanta, San Diego'];
async function enrichSpecial(segment) {
  const extra = [];
  const titles = [];
  for (const query of ENRICH_QUERIES) {
    try {
      const hit = await wikiNameSearch(query);
      if (hit) {
        titles.push(hit.title);
        extra.push({
          area: { name: `Enrichment — ${hit.title}` },
          facts: { wikiContext: `Wikipedia — ${hit.title}:\n${hit.extract.slice(0, 6000)}`, sources: ['wikipedia'] },
        });
        console.log(`[regen] enrichment "${query}" → "${hit.title}" (${hit.extract.length} chars)`);
      } else {
        console.log(`[regen] enrichment "${query}" → no usable article`);
      }
    } catch (e) {
      console.warn(`[regen] enrichment "${query}" failed: ${e.message}`);
    }
    await sleep(600);
  }
  return { extra, titles };
}

// ------------------------------------------------------------ prompt
// The standard corridor prompt (build-corridors.mjs wording) plus
// the REGEN BRIEF. Kept in lockstep with the bank's doctrine:
// v14 brief, corridors-as-portals, position-binding ban, WOW lead.
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
  parts.push(
    'THE v14 BRIEF: This story exists to make the listener love this town more — to fall in love with the city for the first time, or all over again. ' +
      'THE WOW LEAD: open with the single most compelling or surprising fact in the material above — the story\'s first breath is the best thing in the pack, shaped as a hook; never spend the lead on orientation or a date. ' +
      'PORTAL, SOURCE-GROUNDED: every outward connection — neighborhood to bay, canyon, border, Navy, park — must be grounded in the material provided (the facts, published local history or lore, sourced local opinion); a connection you cannot ground, omit. Never invent a link. ' +
      'CORRIDORS AS PORTALS (Erik\'s ruling, Oct 27, 2026): this segment is a jumping-off point, not the subject. Do not narrate the road itself — its lanes, exits, and sequence of neighborhoods are only the frame, and forcing the route must never force an uninteresting story. The telling\'s job is to open onto the BIGGEST story of the ground this drive crosses: the people who made this ground matter, its politics, its wildfires and floods, its migrations, its headlines. Reach past the freeway for the largest true story the material above supports, and let the drive serve that story — if the ground\'s biggest story is bigger than this segment, follow the story. The reach stays under the same discipline as every portal connection: grounded in the facts provided, published history or lore, or sourced opinion — real history only, never invented significance. ' +
      'POSITION-BINDING: narrate this stretch as a place unfolding in order; no expiring micro-claims — nothing "on your left" or "on your right," no "you are about to pass" a specific building. The segment is the frame; what is true of the stretch stays true for the whole telling.'
  );
  return parts.join('\n\n');
}

function regenBrief(spec) {
  const lines = [];
  lines.push('REGENERATION BRIEF (binding — a sameness audit flagged the previous telling of this segment as a repeat of its neighbor):');
  lines.push(`REPLACEMENT LEAD: ${spec.lead}`);
  lines.push('THE WOW LEAD must be drawn from the REPLACEMENT subject\'s material, not from the excluded subject.');
  lines.push(`EXCLUSIONS — the following are the core facts of the PREVIOUS segment (${spec.against}), which already told them. Do NOT retell them, in any wording:`);
  for (const ex of spec.exclusions) lines.push(`- ${ex}`);
  lines.push(`TEXTURE RULE: the previous segment already painted this backdrop — ${spec.backdrop}. Do not re-describe that scene or stage; open on new ground and keep the telling on new scenery.`);
  lines.push('NEIGHBOR RULE: this segment may POINT AT a neighboring segment\'s subject in a single transitional line; it may not TELL that subject. Anything listed in the exclusions may receive at most that one line, total.');
  return lines.join('\n');
}

// Erik's virtues direction (Oct 28, 2026, mid-campaign): the
// regeneration doubles as an upgrade pass for segments carrying a
// `register` in their spec — connect-the-dots portal power, honest
// humor, and deliberate register variety across the regenerated
// set. Segments without a register were generated before the
// direction arrived and stand as-is (never redone for it).
function virtuesBrief(spec) {
  if (!spec.register) return null;
  const lines = [];
  lines.push('VIRTUES BRIEF (binding — this regeneration is also an upgrade pass):');
  lines.push('CONNECT THE DOTS: do not merely swap subjects — explicitly connect this ground OUTWARD to the bigger story of the drive and the neighborhood around it. Name the larger story, system, or era this ground belongs to, and land the connection in a line the listener can carry away. The connection must be grounded in the facts provided (Ruling 2) — a link you cannot ground, omit.');
  lines.push('HUMOR: where this ground honestly supports it, let the host\'s humor register breathe — a wry aside, an absurd true detail, history\'s raised eyebrow. Never force it, never invent a fact for a laugh, and never joke across the excluded subject\'s gravity.');
  lines.push(`REGISTER FOR THIS SEGMENT (the regenerated set must vary in texture, not just subject — this segment's move is): ${spec.register}`);
  if (spec.mode === 'seam') lines.push('SEAM SCOPING: the virtues apply to the NEW OPENING you are writing; the preserved body keeps its own voice.');
  return lines.join('\n');
}

// ------------------------------------------------------------ facts-only probe (special case)
if (factsOnlyId) {
  const segment = app.CORRIDOR_SEGMENTS.find(s => s.id === factsOnlyId);
  if (!segment) { console.error(`[regen] unknown segment ${factsOnlyId}`); process.exit(2); }
  const { areaFacts, sources, detail } = await assembleCorridorFacts(app, records, segment, librarySubjects);
  console.log(`[facts-only] ${segment.id}: sources=${[...sources].join('+') || 'NONE'} stages=${JSON.stringify(detail).slice(0, 400)}`);
  for (const { area, facts } of areaFacts) {
    const blocks = [facts.wikiContext, facts.osmContext, facts.wikidataContext, facts.registryContext].filter(Boolean);
    console.log(`--- AREA ${area.name}: ${blocks.join(' ').length} chars of facts`);
  }
  const { extra, titles } = await enrichSpecial(segment);
  console.log(`[facts-only] enrichment titles: ${titles.join(' | ') || 'none'}`);
  for (const e of extra) {
    console.log(`--- ENRICH ${e.area.name}: ${e.facts.wikiContext.slice(0, 600).replace(/\n/g, ' ')}…`);
  }
  process.exit(0);
}

// ------------------------------------------------------------ text phase
for (const segment of segments) {
  const spec = specById.get(segment.id);
  const placeKey = app.normalizePlaceKey(segment.displayName);
  let entry = byId.get(segment.id);
  if (entry?.story_text) {
    console.log(`[regen] ${segment.id}: text exists (${entry.story_text.length} chars), skipping`);
    continue;
  }
  const { areaFacts, sources: allSources, detail: factDetail } = await assembleCorridorFacts(
    app, records, segment, librarySubjects
  );
  let enrichTitles = [];
  if (spec.special) {
    const { extra, titles } = await enrichSpecial(segment);
    enrichTitles = titles;
    for (const e of extra) { areaFacts.push(e); allSources.add('wikipedia'); }
  }
  let prompt;
  if (spec.mode === 'seam') {
    const orig = origById.get(segment.id);
    if (!orig?.story_text) { console.error(`[regen] ${segment.id}: no original text for seam rewrite`); process.exit(2); }
    prompt = [
      buildCorridorPrompt(segment, areaFacts),
      regenBrief(spec),
      virtuesBrief(spec),
      'OPENING REWRITE (binding): the text below is this segment\'s CURRENT telling. Its body is already a distinct story — keep it. Rewrite ONLY the opening (the first paragraph or two): the current opening retells the previous segment\'s closing anecdote, which the exclusions above name. Delete that retell and open per the REPLACEMENT LEAD. Then carry the remainder of the current telling forward SUBSTANTIVELY INTACT — the same facts, in the same order, with the same closing — changing only what the new opening\'s join requires. Output the COMPLETE story text, new opening plus preserved body, at the same overall length.',
      `CURRENT TELLING:\n${orig.story_text}`,
    ].filter(Boolean).join('\n\n');
  } else {
    prompt = [buildCorridorPrompt(segment, areaFacts), regenBrief(spec), virtuesBrief(spec)].filter(Boolean).join('\n\n');
  }
  const text = await generateText(ai, app, prompt);
  const mid = segment.polyline[Math.floor(segment.polyline.length / 2)];
  entry = {
    segment_id: segment.id,
    place_key: placeKey,
    place_name: segment.displayName,
    angle: 'corridor',
    mode: spec.mode || 'full',
    shape: spec.shape,
    flagged_against: spec.against,
    replacement_lead: spec.lead,
    exclusions: spec.exclusions,
    lat: mid.lat,
    lng: mid.lng,
    coord_source: 'segment polyline midpoint (hand-laid, Item 6 Part A)',
    target_sentences: app.corridorTargetSentences(segment),
    story_text: text,
    audio_file: null,
    audio_path: null,
    persona_version: app.LEO_PERSONA_VERSION,
    model: app.LEO_MODEL_ID,
    tts_model: TTS_MODEL,
    voice: TTS_VOICE,
    fact_sources: [...allSources],
    fact_stages: factDetail,
    enrichment_titles: enrichTitles,
    virtues_brief: Boolean(spec.register),
    register: spec.register || null,
    thin_facts: !allSources.has('wikipedia') && !allSources.has('historic_registry'),
  };
  byId.set(segment.id, entry);
  manifest.push(entry);
  saveManifest();
  console.log(`[regen] ${segment.id}: generated ${text.length} chars${entry.thin_facts ? ' (THIN FACTS — listen before trusting)' : ''}`);
  await sleep(2000);
}

// ------------------------------------------------------------ TTS phase
const pending = [...byId.values()].filter(
  e => segments.some(s => s.id === e.segment_id) && e.story_text && !e.audio_file
);
console.log(`[regen] TTS pending: ${pending.length} (mode: ${ttsMode}, live count today: ${liveTtsCount()})`);

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
  console.log(`[regen]   audio ${fileName}: ${bytes.length} bytes, ${entry.duration_s}s, ${format}, via ${route}`);
}

async function runLiveTts(list, route) {
  let done = 0;
  for (const entry of list) {
    if (liveTtsCount() >= LIVE_DAILY_STOP) {
      console.warn(`[regen] LIVE STOP: ${liveTtsCount()} live syntheses today (cap ${LIVE_DAILY_STOP}) — ${list.length - done} deferred`);
      break;
    }
    try {
      let result;
      try {
        result = await liveTts(keys.geminiKey, entry.story_text, 'prebuilt');
      } catch (e) {
        if (String(e.message).includes('400')) result = await liveTts(keys.geminiKey, entry.story_text, 'sdk');
        else throw e;
      }
      bumpLiveTtsCount();
      recordAudio(entry, result, route, null);
      done++;
    } catch (e) {
      entry.tts_error = String(e?.message || e).slice(0, 300);
      saveManifest();
      console.warn(`[regen]   live TTS failed for ${entry.segment_id}: ${entry.tts_error}`);
    }
    await sleep(1500);
  }
}

if (pending.length > 0 && ttsMode !== 'off') {
  if (ttsMode === 'batch') {
    try {
      const items = pending.map(e => ({ key: e.segment_id, text: e.story_text }));
      const name = await submitTtsBatch(keys.geminiKey, items, `leo-corridor-regen-${new Date().toISOString().slice(0, 10)}`);
      batchLog.push({ name, submittedAt: new Date().toISOString(), keys: items.map(i => i.key) });
      writeFileSync(batchLogPath, JSON.stringify(batchLog, null, 2));
      console.log(`[regen] batch job submitted: ${name} (${items.length} items)`);
      const results = await pollTtsBatch(keys.geminiKey, name);
      const failed = [];
      for (const entry of pending) {
        const r = results.get(entry.segment_id);
        if (r && !r.error) recordAudio(entry, r, 'batch', name);
        else { failed.push(entry); console.warn(`[regen]   batch item failed for ${entry.segment_id}: ${r?.error ? String(r.error).slice(0, 200) : 'missing from results'}`); }
      }
      if (failed.length > 0) {
        console.log(`[regen] falling back to live TTS for ${failed.length} item(s)`);
        await runLiveTts(failed, 'live-fallback');
      }
    } catch (e) {
      console.warn(`[regen] batch path failed (${String(e?.message || e).slice(0, 200)}) — falling back to live TTS`);
      await runLiveTts(pending, 'live-fallback');
    }
  } else {
    await runLiveTts(pending, 'live');
  }
}

// ------------------------------------------------------------ upload (fresh keys, NO db writes)
const ready = [...byId.values()].filter(
  e => segments.some(s => s.id === e.segment_id) && e.story_text && e.audio_file && !e.audio_path
);
if (ready.length > 0) {
  if (!keys.supabaseUrl) throw new Error('Supabase URL not found in live bundle');
  const base = keys.supabaseUrl;
  const headers = { apikey: keys.anonKey, Authorization: `Bearer ${keys.anonKey}` };
  for (const e of ready) {
    const asciiPlace = e.place_key
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[–—]/g, '-')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9 .'-]/gi, '')
      .replace(/\s+/g, ' ');
    const bucketKey = `library/${asciiPlace}/corridor-v14r.wav`;
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
        if (up.ok) { done = true; console.log(`[regen] uploaded ${e.segment_id} → ${bucketKey}`); }
        else {
          const body = await up.text();
          if (up.status === 409 || body.includes('KeyAlreadyExists') || body.includes('already exists')) {
            done = true;
            console.log(`[regen] ${e.segment_id}: ${bucketKey} already present (prior run), keeping`);
          } else throw new Error(`HTTP ${up.status} ${body.slice(0, 200)}`);
        }
      } catch (err) {
        if (attempt === 3) throw new Error(`storage upload failed for ${bucketKey}: ${err.message}`);
        console.warn(`  upload attempt ${attempt} failed for ${bucketKey} (${err.message}); retrying`);
      }
    }
    e.audio_path = bucketKey;
    saveManifest();
  }
}

const complete = [...byId.values()].filter(e => segments.some(s => s.id === e.segment_id) && e.story_text && e.audio_file && e.audio_path);
console.log(`[regen] DONE: ${complete.length}/${segments.length} selected segments complete (text + audio + v14r upload)`);
const incomplete = segments.filter(s => !(byId.get(s.id)?.story_text && byId.get(s.id)?.audio_file && byId.get(s.id)?.audio_path)).map(s => s.id);
if (incomplete.length > 0) console.log(`[regen] incomplete: ${incomplete.join(', ')}`);
