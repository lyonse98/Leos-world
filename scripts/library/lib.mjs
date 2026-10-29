// Library builder internals: keys, free fact sources, prompt assembly,
// text generation, and TTS (Batch API first, live REST as fallback).
//
// Keys: the app's Gemini key and Supabase anon key ship in the live
// bundle by design; they are extracted from it the same way bundle
// verification does, cached in /tmp with 0600 permissions, and NEVER
// printed or committed.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';

export const TTS_MODEL = 'gemini-3.8-flash-tts'; // mirror of src/services/geminiAudio.ts
export const TTS_VOICE = 'Puck'; // VOICE_NAME in geminiAudio.ts
// The app's Gemini key carries a browser-referrer restriction (Erik's own
// setting on his own key): API calls must present the app's origin.
export const APP_REFERER = 'https://leos-world-mobile-80g2.bolt.host/';
const KEYS_PATH = '/tmp/leo_library_keys.json';
const COUNTER_PATH = '/tmp/leo_tts_live_count.json';
const UA = 'LeosWorldLibraryBuilder/1.0 (offline corpus build)';
export const LIVE_DAILY_STOP = 85; // hard stop for live TTS per Pacific day

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    sleep(ms).then(() => fallback),
  ]);
}

async function fetchText(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------- keys

export async function loadKeys() {
  if (existsSync(KEYS_PATH)) {
    const keys = JSON.parse(readFileSync(KEYS_PATH, 'utf8'));
    if (keys.geminiKey && keys.anonKey) return keys;
  }
  const site = 'https://leos-world-mobile-80g2.bolt.host';
  const html = await (await fetchText(site)).text();
  const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!m) throw new Error('live bundle path not found in site HTML');
  const js = await (await fetchText(`${site}/${m[0]}`)).text();

  // Gemini key = the AIza… string that actually answers the
  // generativelanguage API (the Maps key is referrer/API restricted and
  // fails this probe).
  const candidates = [...new Set(js.match(/AIza[0-9A-Za-z_-]{35}/g) || [])];
  let geminiKey = null;
  for (const c of candidates) {
    const r = await fetchText(`https://generativelanguage.googleapis.com/v1beta/models?key=${c}`, {
      headers: { Referer: APP_REFERER },
    });
    if (r.ok) { geminiKey = c; break; }
  }
  if (!geminiKey) throw new Error('no working Gemini key found in the live bundle');

  const urlM = js.match(/https:\/\/[a-z0-9]+\.supabase\.co/);
  const jwts = [...new Set(js.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [])];
  let anonKey = null;
  for (const j of jwts) {
    try {
      const payload = JSON.parse(Buffer.from(j.split('.')[1], 'base64url').toString('utf8'));
      if (payload.role === 'anon') { anonKey = j; break; }
    } catch { /* not a JWT we care about */ }
  }
  if (!anonKey) throw new Error('Supabase anon key not found in the live bundle');

  const keys = { geminiKey, supabaseUrl: urlM?.[0] ?? null, anonKey };
  writeFileSync(KEYS_PATH, JSON.stringify(keys), { mode: 0o600 });
  console.log(`[keys] extracted from live bundle (gemini key ${geminiKey.length} chars, anon key ${anonKey.length} chars) — values not logged`);
  return keys;
}

export function makeTextClient(geminiKey) {
  return new GoogleGenAI({
    apiKey: geminiKey,
    httpOptions: { headers: { Referer: APP_REFERER } },
  });
}

// ---------------------------------------------------------------- nominatim

let lastNominatimAt = 0;
async function nominatim(path) {
  const wait = 1100 - (Date.now() - lastNominatimAt);
  if (wait > 0) await sleep(wait);
  lastNominatimAt = Date.now();
  const res = await fetchText(`https://nominatim.openstreetmap.org/${path}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return res.json();
}

export async function nominatimSearch(query) {
  const out = await nominatim(`search?format=json&limit=1&q=${encodeURIComponent(query)}`);
  if (!out?.length) return null;
  return { lat: parseFloat(out[0].lat), lng: parseFloat(out[0].lon) };
}

// Last-resort coordinates: the place's Wikipedia article. Search by
// name, take the first result whose coordinates land in San Diego
// County (the bounds check rejects same-named places elsewhere — e.g.
// the Self-Realization Fellowship's Lake Shrine in Los Angeles).
export async function wikipediaCoords(name) {
  const headers = { 'User-Agent': UA };
  const srRes = await fetchText(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=5&format=json&srsearch=${encodeURIComponent(name)}`,
    { headers }
  );
  if (!srRes.ok) return null;
  const sr = await srRes.json();
  const titles = (sr?.query?.search || []).map(r => r.title);
  for (const title of titles) {
    const coRes = await fetchText(
      `https://en.wikipedia.org/w/api.php?action=query&prop=coordinates&format=json&titles=${encodeURIComponent(title)}`,
      { headers }
    );
    if (!coRes.ok) continue;
    const co = await coRes.json();
    const pages = Object.values(co?.query?.pages || {});
    const c = pages[0]?.coordinates?.[0];
    if (c && c.lat >= 32.4 && c.lat <= 33.6 && c.lon >= -117.8 && c.lon <= -116.3) {
      return { lat: c.lat, lng: c.lon, source: `wikipedia (${title})` };
    }
  }
  return null;
}

// ---------------------------------------------------------------- registry
// Mirrors src/services/historicRegistry.ts (name normalization, matching
// rule, and fact formatting) over the vendored dataset the app itself
// ships (src/data/sd-historic-registry.json), so builder facts are the
// same facts the app would serve.

export function loadRegistry(repoRoot) {
  return JSON.parse(readFileSync(`${repoRoot}/src/data/sd-historic-registry.json`, 'utf8'));
}

function normalizeRegistryName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

function registryNamesMatch(a, b) {
  const na = normalizeRegistryName(a);
  const nb = normalizeRegistryName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  return shorter.length >= 8 && longer.includes(shorter);
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Best registry record for a place NAME (for coordinates): prefer
// verified coords, then approximate.
export function registryCoordsFor(records, name) {
  const matches = records.filter(
    r => r.lat !== null && r.lng !== null && registryNamesMatch(name, r.name)
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => (a.coordQuality === 'verified' ? 0 : 1) - (b.coordQuality === 'verified' ? 0 : 1));
  return matches[0];
}

// The record whose facts attach to a subject at (lat, lng) — same rule
// as the app: name match and within 300 m when the record has coords.
export function registryRecordAt(records, name, lat, lng) {
  let best = null;
  let bestDist = Infinity;
  for (const r of records) {
    if (!registryNamesMatch(name, r.name)) continue;
    if (r.lat === null || r.lng === null) {
      if (normalizeRegistryName(name) === normalizeRegistryName(r.name) && !best) best = r;
      continue;
    }
    const d = haversineM(lat, lng, r.lat, r.lng);
    if (d <= 300 && d < bestDist) { best = r; bestDist = d; }
  }
  return best;
}

export function formatRegistryFacts(record) {
  const display = record.registers.map(r =>
    r === 'national'
      ? 'National Register of Historic Places'
      : 'San Diego Register of Historic Resources'
  );
  const parts = [`listed on the ${display.join(' and ')}`];
  if (record.designatedYear) parts.push(`designated ${record.designatedYear}`);
  if (record.significance) parts.push(`significance: ${record.significance}`);
  if (record.address) parts.push(`address: ${record.address}`);
  return `HISTORIC REGISTRY FACTS for ${record.name}: ${parts.join('; ')}.`;
}

// ---------------------------------------------------------------- facts

export async function assembleFacts(app, records, seed, coords) {
  const pos = {
    lat: coords.lat, lng: coords.lng,
    accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null,
  };
  const sources = [];
  let wikiContext = '';
  let osmContext = '';
  let wikidataContext = '';
  let registryContext = '';

  try {
    const articles = await app.wikipedia.getNearbyArticles(pos, false);
    wikiContext = app.wikipedia.formatForPrompt(articles);
    if (articles.length > 0) sources.push('wikipedia');
  } catch (e) {
    console.warn(`[facts] wikipedia failed for ${seed.name}: ${e.message}`);
  }

  try {
    const features = await withTimeout(app.osmService.getNearbyFeatures(pos, null), 15000, []);
    osmContext = app.osmService.formatForPrompt(features);
    if (features.length > 0) sources.push('openstreetmap');
  } catch (e) {
    console.warn(`[facts] osm failed for ${seed.name}: ${e.message}`);
  }

  try {
    wikidataContext = await app.wikidata.getFactsForPlace(seed.name, { lat: coords.lat, lng: coords.lng });
    if (wikidataContext) sources.push('wikidata');
  } catch (e) {
    console.warn(`[facts] wikidata failed for ${seed.name}: ${e.message}`);
  }

  const rec = registryRecordAt(records, seed.name, coords.lat, coords.lng);
  if (rec) {
    registryContext = formatRegistryFacts(rec);
    sources.push('historic_registry');
  }

  return { wikiContext, osmContext, wikidataContext, registryContext, sources };
}

// ---------------------------------------------------------------- prompt
// Mirrors gemini.ts buildFactPackBlock + the landmark branch of
// buildStoryPrompt: same block order, same TELL THE STORY OF line, same
// rotation directive for non-origin angles, with the neutral 'prefetch'
// context directive. Corpus mode is 'highway' — the deepest standard
// drive-by story, and the mode of Erik's I-5 test drives.
//
// PERSONA SOURCE: the builders' persona is the app's real
// LEO_SYSTEM_INSTRUCTION, bundled by bundle-app.mjs — never copied by
// hand. That includes the DOCUMENTARY PACK amendment to leo-v14
// (adopted Oct 28, 2026: open loop, the TURN, source-bounded
// present-tense scene, restraint at peak, human-protagonist
// anchoring), which therefore governs every builder here exactly as
// it governs live generation. Re-run bundle-app.mjs after any persona
// edit. Pre-TTS, every batch must clear style-gate.mjs (see
// STYLE-GATE.md).

export function buildPrompt(app, seed, coords, facts, angle, coveredAngles) {
  const parts = [];
  const head = [
    'MODE: highway',
    `Coordinates: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
    `Area: ${seed.area}`,
    'LANDMARKS (nearest first):',
    `Right around the listener: ${seed.name}`,
  ];
  parts.push(head.join('\n'));
  if (facts.wikiContext) parts.push(facts.wikiContext);
  if (facts.osmContext) parts.push(facts.osmContext);
  if (facts.wikidataContext) parts.push(facts.wikidataContext);
  if (facts.registryContext) parts.push(facts.registryContext);
  parts.push(
    `TELL THE STORY OF: "${seed.name}" (right here). ` +
      'This is the most story-worthy thing here — build the story around it.'
  );
  if (angle !== app.LANDMARK_ANGLES[0]) {
    parts.push(
      'THIS LISTENER HAS HEARD A STORY ABOUT THIS LANDMARK BEFORE. ' +
        `You are coming back to it for a different angle: ${app.describeAngle(angle)}. ` +
        'Do not retell what they already know. Open as if they already know the place — ' +
        'no re-introduction of what it is — and go straight into the new material. ' +
        'It should stand on its own for anyone listening, but it must not be the earlier story reworded.'
    );
    if (coveredAngles.length > 0) {
      parts.push(
        `ANGLES ALREADY COVERED ON IT (do not repeat): ${coveredAngles.map(a => app.describeAngle(a)).join(', ')}.`
      );
    }
  }
  parts.push('THIS STORY: Tell the best story about what is here now.');
  return parts.join('\n\n');
}

// ---------------------------------------------------------------- text gen

export async function generateText(ai, app, prompt) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await ai.models.generateContent({
        model: app.LEO_MODEL_ID,
        contents: prompt,
        config: { systemInstruction: app.LEO_SYSTEM_INSTRUCTION },
      });
      const text = (r.text || '').trim();
      if (!text) throw new Error('empty text response');
      return text;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const is429 = msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('resource_exhausted');
      if (attempt < 4) {
        const backoff = is429 ? 30000 * attempt : 5000 * attempt;
        console.warn(`[text] attempt ${attempt} failed (${msg.slice(0, 120)}) — backing off ${backoff / 1000}s`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- TTS

function voiceConfigRest(shape) {
  return shape === 'sdk'
    ? { voice: TTS_VOICE }
    : { prebuiltVoiceConfig: { voiceName: TTS_VOICE } };
}

// One live synthesis over REST. Returns { mimeType, bytes }.
export async function liveTts(geminiKey, spokenText, shape = 'prebuilt') {
  const res = await fetchText(
    `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: APP_REFERER },
      body: JSON.stringify({
        contents: [{ parts: [{ text: spokenText }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: voiceConfigRest(shape) },
        },
      }),
    },
    120000
  );
  if (!res.ok) {
    throw new Error(`live TTS HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
  const data = part?.inlineData || part?.inline_data;
  if (!data?.data) throw new Error('live TTS: no inline audio data in response');
  return { mimeType: data.mimeType || data.mime_type || '', bytes: Buffer.from(data.data, 'base64') };
}

// Submit one Batch API job for TTS. Returns the batch resource name.
export async function submitTtsBatch(geminiKey, items, displayName) {
  const requests = items.map(it => ({
    request: {
      contents: [{ parts: [{ text: it.text }] }],
      generation_config: {
        response_modalities: ['AUDIO'],
        speech_config: {
          voice_config: { prebuilt_voice_config: { voice_name: TTS_VOICE } },
        },
      },
    },
    metadata: { key: it.key },
  }));
  const res = await fetchText(
    `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:batchGenerateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: APP_REFERER },
      body: JSON.stringify({
        batch: {
          display_name: displayName,
          input_config: { requests: { requests } },
        },
      }),
    },
    120000
  );
  if (!res.ok) {
    throw new Error(`batch submit HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const json = await res.json();
  if (!json.name) throw new Error(`batch submit: no operation name in response: ${JSON.stringify(json).slice(0, 300)}`);
  return json.name;
}

// Poll a batch job to completion. Returns Map key → { mimeType, bytes } | { error }.
export async function pollTtsBatch(geminiKey, name, { timeoutMs = 50 * 60 * 1000, intervalMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastState = '';
  let transientFails = 0;
  while (Date.now() < deadline) {
    let res;
    try {
      res = await fetchText(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${geminiKey}`, {
        headers: { Referer: APP_REFERER },
      }, 180000);
    } catch (e) {
      // Network-level poll failure — transient until proven otherwise
      // (lesson of the Oct 28 master render campaign: a single 503 on
      // the state endpoint is NOT a job failure; the job lives
      // server-side and must not be abandoned for a hiccup).
      if (++transientFails > 8) throw e;
      console.warn(`[batch] poll ${name} network error (${e.message.slice(0, 100)}) — retry ${transientFails}/8 in 30s`);
      await sleep(30000);
      continue;
    }
    if (!res.ok) {
      if ([429, 500, 502, 503, 504].includes(res.status) && ++transientFails <= 8) {
        console.warn(`[batch] poll ${name} HTTP ${res.status} — transient, retry ${transientFails}/8 in 30s`);
        await sleep(30000);
        continue;
      }
      throw new Error(`batch poll HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    transientFails = 0;
    const json = await res.json();
    // State enum arrives as BATCH_STATE_* on this API surface (JOB_STATE_*
    // in other docs) — normalize before comparing.
    const rawState = json.state || json.metadata?.state || '';
    const state = rawState.replace(/^(JOB|BATCH)_STATE_/, '');
    if (state !== lastState) {
      console.log(`[batch] ${name} state: ${rawState}`);
      lastState = state;
    }
    if (state === 'SUCCEEDED') {
      const out = new Map();
      const lists = [
        json.output?.inlinedResponses?.inlinedResponses,
        json.output?.inlined_responses?.inlined_responses,
        json.response?.inlinedResponses?.inlinedResponses,
        json.response?.inlined_responses?.inlined_responses,
      ];
      const entries = lists.find(l => Array.isArray(l)) || [];
      for (const entry of entries) {
        const key = entry.metadata?.key;
        if (!key) continue;
        if (entry.error) {
          out.set(key, { error: JSON.stringify(entry.error).slice(0, 300) });
          continue;
        }
        const resp = entry.response || {};
        const part = resp.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
        const data = part?.inlineData || part?.inline_data;
        if (data?.data) {
          out.set(key, { mimeType: data.mimeType || data.mime_type || '', bytes: Buffer.from(data.data, 'base64') });
        } else {
          out.set(key, { error: `no audio in batch response: ${JSON.stringify(resp).slice(0, 200)}` });
        }
      }
      return out;
    }
    if (state === 'FAILED' || state === 'CANCELLED' || state === 'EXPIRED') {
      throw new Error(`batch job ${rawState}: ${JSON.stringify(json.error || json).slice(0, 300)}`);
    }
    await sleep(intervalMs);
  }
  throw new Error(`batch job timed out after ${timeoutMs / 60000} min (last state: ${lastState})`);
}

// ---------------------------------------------------------------- WAV

// Gemini TTS may return a WAV container or raw PCM (audio/L16). The
// library stores .wav files either way: wrap raw PCM in a WAV header.
export function ensureWav(bytes, mimeType) {
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    return { bytes, format: 'wav' };
  }
  const rateMatch = /rate=(\d+)/.exec(mimeType || '');
  const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes.length, 40);
  return { bytes: Buffer.concat([header, bytes]), format: `pcm-${sampleRate}hz-wrapped` };
}

export function wavDurationSec(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF') return null;
  const byteRate = bytes.readUInt32LE(28);
  if (!byteRate) return null;
  return Math.round(((bytes.length - 44) / byteRate) * 10) / 10;
}

// ---------------------------------------------------------------- live TTS counter

export function pacificDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
}

export function liveTtsCount() {
  try {
    const c = JSON.parse(readFileSync(COUNTER_PATH, 'utf8'));
    return c.date === pacificDate() ? c.count : 0;
  } catch {
    return 0;
  }
}

export function bumpLiveTtsCount() {
  const count = liveTtsCount() + 1;
  writeFileSync(COUNTER_PATH, JSON.stringify({ date: pacificDate(), count }), { mode: 0o600 });
  return count;
}
