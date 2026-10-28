// Batch 1 ENTERTAINMENT PASS builder (Oct 28, 2026 — Erik: "beef up
// both batches with those requests for humor and entertainment";
// production rule change Oct 28 ~10:20 PDT: TEXT ONLY this run —
// TTS renders later, as one batch, after Erik approves the texts).
//
//   node scripts/library/build-batch1-entertainment.mjs
//
// Scope: the 7 stories flagged by the entertainment audit
// (~/workspace/leos-world/batch1-entertainment-audit-2026-10-28.md;
// specs: ~/workspace/leos-world/batch1-entertainment-v1/specs.json) —
// 5 POLISH (opening surgery, body preserved) + 2 REGENERATE (full
// re-tell). Everything else in Batch 1 stands as Erik approved it.
//
// Discipline:
// - The base prompt is the ORIGINAL Batch 1 prompt, rebuilt exactly
//   as build-corpus.mjs built it (same fact assembly incl. the
//   tier-3 name-search rescue, same seed brief + angle brief carried
//   verbatim), plus a binding ENTERTAINMENT BRIEF and the CURRENT
//   TELLING as the closed fact source. FACTS DO NOT CHANGE: the new
//   text may only use facts present in the current telling or the
//   reassembled fact pack. No new claims, names, dates, or color.
// - The standalone rule in the brief explicitly supersedes the
//   rotation directive's "open as if they already know the place"
//   phrasing for this set — that phrasing is what produced the
//   "So we already talked about…" openings the audit flagged.
// - NO TTS, NO uploads, NO database writes. Outputs are texts +
//   manifest in ~/workspace/leos-world/batch1-entertainment-v1/.
//   The render + swap phase (fresh `<angle>-v14r.wav` keys + one
//   swap SQL for Erik's paste) happens only after Erik approves
//   these texts. Resumable: manifest entries with story_text are
//   skipped.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEEDS } from './seeds.mjs';
import {
  loadKeys, makeTextClient, loadRegistry,
  assembleFacts, buildPrompt, generateText,
} from './lib.mjs';

const outDir = path.join(homedir(), 'workspace/leos-world/batch1-entertainment-v1');
const specsPath = path.join(outDir, 'specs.json');
const manifestPath = path.join(outDir, 'manifest.json');
const origManifestPath = path.join(homedir(), 'workspace/leos-world/batch1-corpus-v14/manifest.json');

const app = await import('/tmp/leo-app-bundle.mjs');
if (app.LEO_PERSONA_VERSION !== 'leo-v14') {
  console.error(`[ent] bundle persona is ${app.LEO_PERSONA_VERSION}, expected leo-v14 — re-run bundle-app.mjs`);
  process.exit(1);
}
const keys = await loadKeys();
const ai = makeTextClient(keys.geminiKey);
const records = loadRegistry(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));

const specs = JSON.parse(readFileSync(specsPath, 'utf8'));
const origManifest = JSON.parse(readFileSync(origManifestPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const byKey = new Map(manifest.map(e => [`${e.seed_n}|${e.angle}`, e]));
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const angleFor = short => {
  const a = app.LANDMARK_ANGLES.find(x => x === `landmark_${short}`);
  if (!a) throw new Error(`unknown angle short key: ${short}`);
  return a;
};

// Tier-3 name-search rescue — copied from build-corpus.mjs so the
// reassembled fact pack matches the original Batch 1 runs.
async function rescueFacts(seed, facts) {
  if (facts.sources.includes('wikipedia') || facts.sources.includes('historic_registry')) return facts;
  try {
    let title = seed.wikiTitle || null;
    if (!title) {
      const q = encodeURIComponent(seed.name);
      const sres = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=3&format=json`, { signal: AbortSignal.timeout(20_000) });
      const sjson = await sres.json();
      const wanted = seed.name.toLowerCase().replace(/-/g, ' ');
      title = (sjson?.query?.search ?? []).map(r => r.title)
        .find(t => t.toLowerCase().replace(/-/g, ' ').includes(wanted)) || null;
    }
    if (title) {
      const tres = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(title)}&format=json`, { signal: AbortSignal.timeout(20_000) });
      const tjson = await tres.json();
      const page = Object.values(tjson?.query?.pages ?? {})[0];
      const extract = (page?.extract ?? '').trim();
      if (extract.length > 400) {
        facts.wikiContext = [facts.wikiContext, `Wikipedia — ${title}:\n${extract.slice(0, 6000)}`].filter(Boolean).join('\n');
        facts.sources.push('wikipedia');
        console.log(`[ent] ${seed.name}: name-search Wikipedia rescue found "${title}" (${extract.length} chars)`);
      }
    }
  } catch (e) {
    console.warn(`[ent] ${seed.name}: name-search rescue failed: ${e.message}`);
  }
  return facts;
}

// ------------------------------------------------------------ QA
const BANNED = ['already talked', 'you already know', 'as i mentioned', 'already covered', 'we talked about', 'you\'ll remember'];
const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sentences = t => t.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);

function qa(origText, newText, mode) {
  const bannedHits = BANNED.filter(b => norm(newText).includes(norm(b)));
  const origSents = sentences(origText);
  const bodySents = origSents.slice(3).map(norm).filter(s => s.length >= 40);
  const newNorm = norm(newText);
  const preserved = bodySents.filter(s => newNorm.includes(s) || newNorm.includes(s.slice(0, 50))).length;
  return {
    banned_hits: bannedHits,
    preservation: mode === 'polish' && bodySents.length > 0
      ? Number((preserved / bodySents.length).toFixed(2)) : null,
    body_sentences_checked: mode === 'polish' ? bodySents.length : null,
    length_ratio: Number((newText.length / origText.length).toFixed(2)),
  };
}

// ------------------------------------------------------------ briefs
function entertainmentBrief(spec) {
  const lines = [];
  lines.push('ENTERTAINMENT REGENERATION BRIEF (binding — an entertainment audit flagged the CURRENT TELLING below against the doctrine Erik set on Oct 28, 2026: entertaining first, never a lecture, a friend riding shotgun who knows amazing things — education is the payload, entertainment is the vehicle; a story that teaches but bores fails even if every fact is right):');
  lines.push('FACTS DO NOT CHANGE: the CURRENT TELLING below, together with the fact material above, is the complete and closed source. Every fact in your new text must appear in the current telling or the fact material. Add NO new claims, names, dates, numbers, or invented color — humor and shape change; facts do not.');
  lines.push('STANDALONE RULE (this supersedes any "open as if they already know the place" phrasing above — that phrasing governs what subject you choose, never how you address the listener): the new telling stands entirely on its own. NEVER refer to another telling — no "we already talked about", no "you already know", no "as I mentioned". A listener may hear this story first, last, or only. Open in the scene, not in a recap.');
  lines.push('REGISTER: talking WITH the driver, not at them. No lecture cadence, no fact-stacking, no "did you know" chains, no first-then-finally schoolroom sequencing. Humor where the ground honestly supports it — never forced, never a joke bought with an invented fact.');
  lines.push(`THE WOW LEAD for this telling: ${spec.wow}`);
  if (spec.mode === 'polish') {
    lines.push('OPENING SURGERY (binding): rewrite ONLY the opening — roughly the first two to three sentences — so the telling LEADS with the wow above. Then carry the remainder of the CURRENT TELLING forward SUBSTANTIVELY INTACT: the same facts, in the same order, with the same closing, changing only what the new opening\'s join requires and the specific adjustments named in the fix notes. Output the COMPLETE story text at about the same length.');
  } else {
    lines.push('FULL RE-TELL (binding): rewrite the whole telling around the wow lead above. Same facts, same ground — new shape: the arresting fact leads, the story moves as scenes and stakes rather than catalogues, and any list of specifications in the current telling must be broken up and carried by the human action it enables. Same overall length, within about fifteen percent.');
  }
  lines.push(`FIX NOTES (from the audit, ${spec.audit_ref}): ${spec.fix_notes}`);
  return lines.join('\n');
}

// ------------------------------------------------------------ run
for (const spec of specs) {
  const seed = SEEDS.find(s => s.n === spec.seed_n);
  if (!seed) { console.error(`[ent] seed ${spec.seed_n} not found`); process.exit(2); }
  const angle = angleFor(spec.angle_short);
  const orig = origManifest.find(e => e.seed_n === spec.seed_n && e.angle === angle);
  if (!orig?.story_text) { console.error(`[ent] no original text for seed ${spec.seed_n} ${angle}`); process.exit(2); }
  const mkey = `${spec.seed_n}|${angle}`;
  if (byKey.get(mkey)?.story_text) {
    console.log(`[ent] ${seed.name} ${angle}: new text exists, skipping`);
    continue;
  }
  if (!seed.coords) { console.error(`[ent] seed ${spec.seed_n} has no pinned coords — refusing to resolve fresh`); process.exit(2); }
  const coords = { lat: seed.coords.lat, lng: seed.coords.lng, source: seed.coords.source };

  let facts = await assembleFacts(app, records, seed, coords);
  facts = await rescueFacts(seed, facts);
  console.log(`[ent] ${seed.name} ${angle} (${spec.mode}): facts ${facts.sources.join('+') || 'NONE'}`);

  const idx = seed.angles.indexOf(spec.angle_short);
  const covered = seed.angles.slice(0, idx).map(angleFor);
  let prompt = buildPrompt(app, seed, coords, facts, angle, covered);
  if (seed.brief) prompt += `\n\nBRIEF FOR THIS PLACE (binding): ${seed.brief}`;
  const angleBrief = seed.angleBriefs?.[spec.angle_short];
  if (angleBrief) prompt += `\n\nBRIEF FOR THIS ANGLE (binding): ${angleBrief}`;
  prompt += `\n\n${entertainmentBrief(spec)}\n\nCURRENT TELLING:\n${orig.story_text}`;

  let text = await generateText(ai, app, prompt);
  let q = qa(orig.story_text, text, spec.mode);
  console.log(`[ent]   attempt 1: ${text.length} chars, qa=${JSON.stringify(q)}`);
  const fails = q.banned_hits.length > 0 || (spec.mode === 'polish' && q.preservation !== null && q.preservation < 0.45);
  if (fails) {
    const stern = spec.mode === 'polish'
      ? '\n\nSECOND ATTEMPT (binding): the first attempt either referenced another telling or failed to preserve the current telling\'s body. Preserve MORE of the body verbatim — change the opening and the named fix points only — and never reference another telling.'
      : '\n\nSECOND ATTEMPT (binding): the first attempt referenced another telling, which is prohibited. Rewrite it standing entirely on its own.';
    const text2 = await generateText(ai, app, prompt + stern);
    const q2 = qa(orig.story_text, text2, spec.mode);
    console.log(`[ent]   attempt 2: ${text2.length} chars, qa=${JSON.stringify(q2)}`);
    const better = q2.banned_hits.length === 0 &&
      (spec.mode !== 'polish' || (q2.preservation ?? 0) >= (q.preservation ?? 0));
    if (better) { text = text2; q = q2; }
  }

  const entry = {
    seed_n: spec.seed_n,
    place_key: orig.place_key,
    place_name: seed.name,
    angle,
    mode: spec.mode,
    audit_ref: spec.audit_ref,
    wow_lead: spec.wow,
    orig_story_text: orig.story_text,
    story_text: text,
    orig_duration_s: orig.duration_s,
    orig_audio_file: orig.audio_file,
    fact_sources: facts.sources,
    qa: q,
    persona_version: app.LEO_PERSONA_VERSION,
    model: app.LEO_MODEL_ID,
  };
  byKey.set(mkey, entry);
  manifest.push(entry);
  saveManifest();
  console.log(`[ent] ${seed.name} ${angle}: DONE (${text.length} chars, preservation=${q.preservation}, banned=${q.banned_hits.length})`);
  await sleep(2000);
}

console.log(`[ent] COMPLETE: ${manifest.filter(e => e.story_text).length}/${specs.length} entertainment texts staged in ${outDir} (TEXT ONLY — no TTS, no uploads, per Erik's Oct 28 rule)`);
