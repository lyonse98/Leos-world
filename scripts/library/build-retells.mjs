// build-retells.mjs — first-person retell batch (Erik's GO, Oct 30,
// 2026): retell the audit's truly-benefiting stories in a present-day
// first-person witness voice, colour commentary as texture inside the
// telling, FACTS FROZEN to the original text (it is the only fact
// source). Erik's selection criterion: stories that can be told
// through the five senses especially. Caution tier excluded (needs
// his explicit call); do-not-retell list untouched.
//
//   node scripts/library/bundle-app.mjs            # if bundle stale
//   node scripts/library/build-retells.mjs          # text phase only
//
// Outputs (~/workspace/leos-world/retells-v1/): texts.json
// (resumable — finished rows never regenerate) + reading.md.
// Render + swap are separate phases (build-retells-render.mjs /
// swap SQL), run only after the style gate + judgment audit pass.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadKeys, makeTextClient, generateText } from './lib.mjs';

const OUT_DIR = process.env.LEO_RETELL_DIR || path.join(homedir(), 'workspace/leos-world/retells-v1');
mkdirSync(OUT_DIR, { recursive: true });
const OUT_JSON = path.join(OUT_DIR, 'texts.json');

// [place_name (exact story_library value), angle]
const TARGETS = [
  // corridors — the commute core
  ['SR-163 North: Downtown to Hillcrest', 'corridor'],
  ['SR-163 South: Mission Valley to Hillcrest', 'corridor'],
  ['SR-94 East: Emerald Hills to Lemon Grove', 'corridor'],
  ['SR-52 West: Clairemont to La Jolla', 'corridor'],
  ['I-5 South: Chula Vista to South Chula Vista', 'corridor'],
  ['I-5 North: Through Sorrento Valley (2)', 'corridor'],
  ['I-15 North: Through Marine Corps Air Station Miramar', 'corridor'],
  // neighborhood intros — the emptiest shelf
  ['Point Loma', 'neighborhood_intro'],
  ['Carlsbad', 'neighborhood_intro'],
  ['Pacific Beach', 'neighborhood_intro'],
  ['Kearny Mesa', 'neighborhood_intro'],
  ['Bankers Hill', 'neighborhood_intro'],
  ['Sunset Cliffs', 'neighborhood_intro'],
  ['Coronado', 'neighborhood_intro'],
  ['Julian', 'neighborhood_intro'],
  // landmarks — sensory microhistory portals
  ['Gordon & Smith Surfboards', 'landmark_origin'],
  ['Del Mar Racetrack', 'landmark_people'],
  ['Humphreys Concerts by the Bay', 'landmark_event'],
  ['The Casbah', 'landmark_origin'],
  ['Balboa Stadium', 'landmark_event'],
  ['Granger Hall', 'landmark_origin'],
  ['Bird Rock Coffee Roasters', 'landmark_origin'],
  ['Whaley House Museum', 'landmark_legends'],
];

const keys = await loadKeys();
const app = await import('/tmp/leo-app-bundle.mjs');
console.log(`[retell] persona bundle: ${app.LEO_PERSONA_VERSION}`);
const ai = makeTextClient(keys.geminiKey);

const H = { apikey: keys.anonKey, Authorization: 'Bearer ' + keys.anonKey };
const base = keys.supabaseUrl + '/rest/v1/story_library';

const done = existsSync(OUT_JSON) ? JSON.parse(readFileSync(OUT_JSON, 'utf8')) : [];
const doneKeys = new Set(done.map(d => d.place_key + '|' + d.angle));

for (const [placeName, angle] of TARGETS) {
  const q = `${base}?select=place_key,place_name,angle,story_text,persona_version&place_name=eq.${encodeURIComponent(placeName)}&angle=eq.${angle}`;
  const res = await fetch(q, { headers: H });
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    console.error(`[retell] ROW LOOKUP FAILED for ${placeName} / ${angle}: ${JSON.stringify(rows).slice(0, 160)}`);
    continue;
  }
  const row = rows[0];
  const k = row.place_key + '|' + row.angle;
  if (doneKeys.has(k)) { console.log(`[retell] skip (done): ${placeName}`); continue; }
  const orig = row.story_text.trim();
  const origWords = orig.split(/\s+/).length;
  const prompt = [
    'REWRITE TASK. Below is a story already in the library. Retell it — same story, same facts, new telling.',
    '',
    'FACTS ARE FROZEN. The original is your ONLY source of facts. Add nothing: no new names, dates, numbers, events, claims, or places. Anything the original does not say, you do not say. You may reorder material for a stronger opening.',
    '',
    'THE RETELL REGISTER. Tell it in the first person where it genuinely makes sense — you are a present-day witness riding along with the listener: what you can see, hear, smell, and feel on this stretch of road, in this place, today. Lead with the senses. Weave colour commentary in as texture — a dry aside, an honest reaction — never as a separate bit and never forced. Your "I" lives in the present tense of the drive: NEVER invent a personal past (no "when I was a kid," no being present at historical events). Where first person would be dishonest or would flatten the material, stay in documentary voice for that stretch — presence is a judgment call, sentence by sentence.',
    '',
    'SHAPE. Keep the length within about 15% of the original (' + origWords + ' words). Put the wow in the first two sentences. No greeting, no announcement of the place name as an opener, no sign-off, no mention of this task. Output the story only.',
    '',
    'ORIGINAL:',
    orig,
  ].join('\n');
  const text = (await generateText(ai, app, prompt)).trim();
  const entry = {
    place_key: row.place_key, place_name: row.place_name, angle: row.angle,
    from_persona: row.persona_version, orig_text: orig, new_text: text,
    orig_words: origWords, new_words: text.split(/\s+/).length,
  };
  done.push(entry);
  doneKeys.add(k);
  writeFileSync(OUT_JSON, JSON.stringify(done, null, 2));
  console.log(`[retell] ${placeName} / ${angle}: ${origWords} -> ${entry.new_words} words`);
}

const md = done.map(d =>
  `## ${d.place_name} (${d.angle}) — ${d.orig_words} -> ${d.new_words} words\n\n${d.new_text}\n`
).join('\n---\n\n');
writeFileSync(path.join(OUT_DIR, 'reading.md'), '# Retell batch v1 — reading copies\n\n' + md);
console.log(`[retell] DONE: ${done.length}/${TARGETS.length} texts in ${OUT_DIR}`);
