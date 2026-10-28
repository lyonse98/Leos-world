// Silence Fillers builder (Erik's proposal Oct 27, 2026; manifest
// approved ~20:29 PDT — 20 items, target at least 20; spec:
// ~/workspace/leos-world/silence-fillers-v1.md; seeds:
// ~/workspace/leos-world/filler-seeds.json).
//
//   node scripts/library/build-fillers.mjs [--tts=batch|off] [--no-ingest]
//
// For each approved filler: assemble an OFFLINE fact pack (Wikipedia
// search + lead extract — the item's named sources are the search
// direction; Ruling 2: zero-basis invention prohibited, the prompt
// confines the telling to the pack), generate a ~30-second story
// (75-90 words) under the leo-v14 persona (the bundle's system
// instruction carries the voice; this prompt carries the filler
// brief), Batch-TTS everything (fillers + the 5 bridge lines), and
// ingest:
//   fillers -> story_library rows, angle 'filler', audio at
//              library/<place_key>/filler-v14.wav (ingest.mjs pattern)
//   bridges -> storage objects at fillers/bridges/<slug>.wav, NO db
//              rows (location-less clips; the stall-phrases pattern —
//              the app side wires a code manifest when the playback
//              build lands). Local copies + a bridges manifest land
//              in the corpus dir for Erik's by-ear review.
// An item whose fact pack finds no Wikipedia material is flagged
// thin_facts in the manifest and still banks (never silently
// presented as verified — the Tecolote rule).
// Resumable: items with text + audio in the manifest are skipped.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  loadKeys, makeTextClient, generateText,
  submitTtsBatch, pollTtsBatch, ensureWav, wavDurationSec,
  TTS_MODEL, TTS_VOICE,
} from './lib.mjs';

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : dflt;
};
const doIngest = !args.includes('--no-ingest');
const ttsOff = argVal('tts', 'batch') === 'off';

const wsDir = path.join(homedir(), 'workspace/leos-world');
const seeds = JSON.parse(readFileSync(path.join(wsDir, 'filler-seeds.json'), 'utf8'));
const corpusDir = path.join(wsDir, 'filler-corpus-v1');
const audioDir = path.join(corpusDir, 'audio');
mkdirSync(audioDir, { recursive: true });
const manifestPath = path.join(corpusDir, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const bySlug = new Map(manifest.map(e => [e.slug, e]));
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));

// Wikipedia search direction per item (the manifest's named sources,
// as search terms; the lead extract of the best hit is the pack).
const SEARCH = {
  'marine-layer': 'marine layer San Diego May Gray June Gloom',
  'santa-ana-winds': 'Santa Ana winds Southern California',
  'mediterranean-exception': 'Mediterranean climate five regions chaparral',
  'three-climates': 'San Diego climate microclimates',
  'imported-palms': 'Mexican fan palm California planting history',
  'eucalyptus-scheme': 'eucalyptus California railroad ties planting boom',
  'road-beneath-the-road': 'El Camino Real California missions bells',
  'the-name-san-diego': 'San Diego naming Vizcaino 1602 San Miguel Cabrillo',
  'militarys-true-size': 'military economic impact San Diego County SDMAC',
  'one-metro-two-countries': 'San Ysidro Port of Entry busiest land border crossing San Diego Tijuana metropolitan',
  'water-traveled-400-miles': 'San Diego County Water Authority imported water aqueduct Colorado River',
  'desert-in-the-county': 'Anza-Borrego Desert State Park largest California San Diego County area',
  'americas-finest-city': "America's Finest City slogan 1972 San Diego",
  'dawn-patrol': 'surfing culture Southern California dawn patrol',
  'whales-highway': 'gray whale migration Baja California lagoons distance',
  'grunion-runs': 'California grunion runs spawning season moon',
  'green-flash': 'green flash sunset atmospheric optics',
  'wireless-valley': 'Qualcomm founded 1985 San Diego biotechnology cluster',
  'avocado-country': 'San Diego County avocados production California',
  'eternal-ground': 'Kumeyaay history San Diego County thousands of years',
};

// Bridge scripts — written from the manifest's directions, told
// exactly as written (the stall-phrases pattern). First bridges frame
// a quiet stretch as Leo's choice; continuations chain a sequence.
const BRIDGE_TEXT = {
  'bridge-first-1': "While we've got a quiet stretch of road here — let me tell you something about this town most people never hear.",
  'bridge-first-2': "This is a good spot for a story that belongs to the whole county, not just one corner of it.",
  'bridge-first-3': "Give me thirty seconds on this one. It's worth it.",
  'bridge-next-1': "And since we've got the road to ourselves a little longer — here's another one.",
  'bridge-next-2': "One more, while the town catches up with us.",
};

const app = await import('/tmp/leo-corridor-bundle.mjs');
if (app.LEO_PERSONA_VERSION !== 'leo-v14') {
  console.error(`[fillers] bundle persona is ${app.LEO_PERSONA_VERSION}, expected leo-v14`);
  process.exit(1);
}
const keys = await loadKeys();
const ai = makeTextClient(keys.geminiKey);
const base = keys.supabaseUrl;
const headers = { apikey: keys.anonKey, Authorization: `Bearer ${keys.anonKey}` };

async function wikiPack(query) {
  const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search'
    + `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=3&prop=extracts&explaintext=1&exchars=7000&origin=*`;
  const r = await fetch(url, { headers: { 'User-Agent': 'LeoWorldLibraryBuilder/1.0' } });
  if (!r.ok) return null;
  const j = await r.json();
  const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
  const withText = pages.filter(p => p.extract && p.extract.length > 400).sort((a, b) => a.index - b.index);
  if (!withText.length) return null;
  return withText.map(p => `SOURCE: Wikipedia, "${p.title}"\n${p.extract}`).join('\n\n');
}

const normalizeKey = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---- text generation -------------------------------------------------
for (const item of seeds.items) {
  const existing = bySlug.get(item.slug);
  if (existing?.story_text) { console.log(`[fillers] ${item.slug}: text exists, skipping`); continue; }
  const pack = await wikiPack(SEARCH[item.slug] || item.title).catch(() => null);
  const thin = !pack;
  const care = item.slug === 'eternal-ground'
    ? '\nCARE RULES (strict): public-record framing only; the depth of Kumeyaay presence and the land itself; NO spirituality content, no sacred specifics, no contested claims. Measured, respectful tone.'
    : '';
  const prompt = [
    'MODE: silence filler. The drive has gone quiet for a stretch — no place story is ready — and you are filling the pause with a short, self-contained story about SAN DIEGO COUNTY AS A WHOLE. It is not about the place outside the window; do not pretend it is, and do not name a specific location as if the listener were there.',
    'MISSION: make people love this town more.',
    `THE STORY: "${item.title}". The one strong beat: ${item.beat}`,
    pack ? `FACT PACK (the only facts you may use — invent nothing beyond it):\n${pack}` : 'FACT PACK: EMPTY. Write only the most general, uncontested framing of the beat; no numbers, no dates, no named claims.',
    `LENGTH: 75 to 90 words. Hard cap. One idea, one strong beat, complete on its own. Open with the fact, not an apology for the pause. No greeting, no sign-off.${care}`,
  ].join('\n\n');
  let text = await generateText(ai, app, prompt);
  let words = text.split(/\s+/).length;
  if (words > 110) {
    console.log(`[fillers] ${item.slug}: ${words} words — over the cap, regenerating sterner`);
    text = await generateText(ai, app, prompt + '\n\nYour previous draft ran long. Tell it again in 75 to 90 words. Cut background, keep the single strongest beat.');
    words = text.split(/\s+/).length;
  }
  const entry = {
    slug: item.slug, place_key: normalizeKey(item.title), place_name: item.title,
    angle: 'filler', lat: 32.85, lng: -117.05,
    story_text: text, word_count: words, thin_facts: thin,
    fact_sources: pack ? 'wikipedia' : 'none', persona_version: 'leo-v14',
    model: app.LEO_MODEL_ID, voice: TTS_VOICE,
  };
  manifest.push(entry); bySlug.set(item.slug, entry); saveManifest();
  console.log(`[fillers] ${item.slug}: generated ${text.length} chars / ${words} words${thin ? ' (THIN FACTS)' : ''}`);
}

// ---- TTS (batch): fillers + bridges ----------------------------------
const pending = manifest.filter(e => e.story_text && !e.audio_file);
const bridgesPending = seeds.bridges.filter(b => !existsSync(path.join(audioDir, `bridge__${b.slug}.wav`)));
if (!ttsOff && (pending.length || bridgesPending.length)) {
  const items = [
    ...pending.map(e => ({ key: e.slug, text: e.story_text })),
    ...bridgesPending.map(b => ({ key: `bridge__${b.slug}`, text: BRIDGE_TEXT[b.slug] })),
  ];
  console.log(`[fillers] TTS batch: ${items.length} clips (${pending.length} fillers, ${bridgesPending.length} bridges)`);
  const name = await submitTtsBatch(keys.geminiKey, items, 'leo-fillers-v1');
  const results = await pollTtsBatch(keys.geminiKey, name);
  for (const e of pending) {
    const got = results.get(e.slug);
    if (!got || got.error || !got.bytes) { console.warn(`[fillers] no audio returned for ${e.slug}: ${got?.error || 'missing'}`); continue; }
    const { bytes: wav } = ensureWav(got.bytes, got.mimeType);
    const fn = `${e.slug}__filler.wav`;
    writeFileSync(path.join(audioDir, fn), wav);
    e.audio_file = fn; e.duration_sec = Math.round(wavDurationSec(wav) * 10) / 10;
    console.log(`[fillers] audio ${e.slug}: ${wav.length} bytes, ${e.duration_sec}s`);
  }
  for (const b of bridgesPending) {
    const got = results.get(`bridge__${b.slug}`);
    if (!got || got.error || !got.bytes) { console.warn(`[fillers] no audio returned for bridge ${b.slug}: ${got?.error || 'missing'}`); continue; }
    const { bytes: wav } = ensureWav(got.bytes, got.mimeType);
    writeFileSync(path.join(audioDir, `bridge__${b.slug}.wav`), wav);
    console.log(`[fillers] audio bridge ${b.slug}: ${wav.length} bytes, ${Math.round(wavDurationSec(wav))}s`);
  }
  saveManifest();
}

// ---- ingest ------------------------------------------------------------
if (doIngest) {
  let uploaded = 0, rows = 0;
  for (const e of manifest.filter(x => x.audio_file)) {
    const bucketKey = `library/${e.place_key}/filler-v14.wav`;
    const bytes = readFileSync(path.join(audioDir, e.audio_file));
    const up = await fetch(`${base}/storage/v1/object/tts-audio/${bucketKey.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'audio/wav', 'x-upsert': 'false' },
      body: bytes, signal: AbortSignal.timeout(120_000),
    });
    if (up.ok) uploaded++;
    else { const b = await up.text(); if (!(up.status === 409 || b.includes('KeyAlreadyExists') || b.includes('already exists'))) throw new Error(`upload failed ${bucketKey}: HTTP ${up.status} ${b.slice(0, 160)}`); }
    const row = {
      place_key: e.place_key, place_name: e.place_name, angle: 'filler',
      lat: e.lat, lng: e.lng, story_text: e.story_text, audio_path: bucketKey,
      persona_version: e.persona_version, model: e.model, voice: e.voice,
    };
    const ins = await fetch(`${base}/rest/v1/story_library`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    if (!ins.ok) throw new Error(`insert failed ${bucketKey}: HTTP ${ins.status} ${(await ins.text()).slice(0, 160)}`);
    rows++;
    console.log(`[fillers] ingested ${e.slug} -> ${bucketKey}`);
  }
  // Bridges: storage objects only (fillers/bridges/<slug>.wav) + manifest file.
  const bridgeManifest = [];
  for (const b of seeds.bridges) {
    const fn = path.join(audioDir, `bridge__${b.slug}.wav`);
    if (!existsSync(fn)) continue;
    const bucketKey = `fillers/bridges/${b.slug}.wav`;
    const bytes = readFileSync(fn);
    const up = await fetch(`${base}/storage/v1/object/tts-audio/${bucketKey.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'audio/wav', 'x-upsert': 'false' },
      body: bytes, signal: AbortSignal.timeout(120_000),
    });
    if (!up.ok) { const t = await up.text(); if (!(up.status === 409 || t.includes('KeyAlreadyExists') || t.includes('already exists'))) throw new Error(`bridge upload failed ${bucketKey}: HTTP ${up.status} ${t.slice(0, 160)}`); }
    bridgeManifest.push({ slug: b.slug, kind: b.kind, text: BRIDGE_TEXT[b.slug], bucket_key: bucketKey, duration_sec: Math.round(wavDurationSec(bytes) * 10) / 10 });
    console.log(`[fillers] bridge stored ${b.slug} -> ${bucketKey}`);
  }
  writeFileSync(path.join(corpusDir, 'bridges-manifest.json'), JSON.stringify(bridgeManifest, null, 1));
  console.log(`[fillers] ingest complete: ${uploaded} audio uploaded, ${rows} rows attempted, ${bridgeManifest.length} bridges stored`);
}
const banked = manifest.filter(e => e.audio_file).length;
console.log(`[fillers] DONE: ${banked}/${seeds.items.length} fillers banked; thin: ${manifest.filter(e => e.thin_facts).map(e => e.slug).join(', ') || 'none'}`);
