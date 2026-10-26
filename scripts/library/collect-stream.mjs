// Streaming collector for a LARGE batch job whose inlined response is
// too big to JSON.parse (a 69-story job returns >512 MB of base64 JSON —
// past Node's max string length). Streams the job resource and extracts
// the per-request keys and audio payloads IN ORDER (inlined responses
// preserve request order) with a linear-time indexOf state machine,
// then records audio for every corpus entry still pending. Nothing is
// re-submitted and no live quota is spent: the job already succeeded
// server-side; this is purely a harvest of its response body.
//
//   node scripts/library/collect-stream.mjs batches/<id>

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadKeys, ensureWav, wavDurationSec, APP_REFERER } from './lib.mjs';

const jobName = process.argv[2];
if (!jobName) {
  console.error('Usage: collect-stream.mjs batches/<id>');
  process.exit(2);
}

const corpusDir = path.join(homedir(), 'workspace/leos-world/library-corpus');
const audioDir = path.join(corpusDir, 'audio');
const manifestPath = path.join(corpusDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const byKey = new Map(manifest.map(e => [`${e.place_key}|${e.angle}`, e]));
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const keys = await loadKeys();
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${jobName}?key=${keys.geminiKey}`, {
  headers: { Referer: APP_REFERER },
});
if (!res.ok) throw new Error(`job fetch HTTP ${res.status}`);
console.log(`[collect-stream] streaming ${jobName} ...`);

const foundKeys = [];
const foundData = [];

const KEY_MARK = '"key": "';
const DATA_MARK = '"data": "';
let mode = 'seek'; // 'seek' | 'key' | 'data'
let carry = '';
let tokenParts = [];
let lastLogged = 0;

function feed(text) {
  carry += text;
  for (;;) {
    if (mode === 'seek') {
      const ki = carry.indexOf(KEY_MARK);
      const di = carry.indexOf(DATA_MARK);
      if (ki === -1 && di === -1) {
        carry = carry.slice(-16); // keep a tail that may hold a split marker
        return;
      }
      if (di !== -1 && (ki === -1 || di < ki)) {
        mode = 'data'; tokenParts = [];
        carry = carry.slice(di + DATA_MARK.length);
      } else {
        mode = 'key'; tokenParts = [];
        carry = carry.slice(ki + KEY_MARK.length);
      }
    } else {
      const end = carry.indexOf('"');
      if (end === -1) {
        tokenParts.push(carry);
        carry = '';
        return;
      }
      tokenParts.push(carry.slice(0, end));
      const token = tokenParts.join('');
      if (mode === 'key') {
        foundKeys.push(token);
      } else {
        foundData.push(Buffer.from(token, 'base64'));
        if (foundData.length >= lastLogged + 10) {
          lastLogged = foundData.length;
          console.log(`[collect-stream] extracted ${foundData.length} payloads (${foundKeys.length} keys)`);
        }
      }
      carry = carry.slice(end + 1);
      mode = 'seek';
    }
  }
}

const decoder = new TextDecoder();
for await (const chunk of res.body) {
  feed(decoder.decode(chunk, { stream: true }));
}
console.log(`[collect-stream] stream done: ${foundKeys.length} keys, ${foundData.length} audio payloads`);

if (foundData.length < foundKeys.length || foundData.length - foundKeys.length > 1) {
  console.error('[collect-stream] ABORT: key/data counts differ by more than one trailing payload — refusing a possibly misaligned harvest; manifest untouched');
  process.exit(1);
}
if (foundData.length === foundKeys.length + 1) {
  // One payload trails the final key (observed in the 69-story job: the
  // data/key offset held at exactly 1 across all 69 entries, so the
  // extra blob follows the last real entry and the zip is aligned).
  console.warn('[collect-stream] one trailing extra payload after the last key — zipping the aligned prefix');
}

let recorded = 0;
let skippedExisting = 0;
for (let i = 0; i < foundKeys.length; i++) {
  const entry = byKey.get(foundKeys[i]);
  if (!entry) { console.warn(`[collect-stream] no corpus entry for ${foundKeys[i]} — ignored`); continue; }
  if (entry.audio_file) { skippedExisting++; continue; }
  const { bytes, format } = ensureWav(foundData[i], '');
  const fileName = `${entry.place_key.replaceAll(' ', '-')}__${entry.angle}.wav`;
  writeFileSync(path.join(audioDir, fileName), bytes);
  entry.audio_file = fileName;
  entry.audio_format = format;
  entry.audio_bytes = bytes.length;
  entry.duration_s = wavDurationSec(bytes);
  entry.tts_route = 'batch';
  entry.batch_job = jobName;
  delete entry.tts_error;
  recorded++;
}
saveManifest();
console.log(`[collect-stream] recorded ${recorded} audio files; ${skippedExisting} keys already had audio (live fallback) and were left as-is`);
