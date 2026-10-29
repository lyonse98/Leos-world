// style-gate.mjs — the mechanical layer of the Leo style rubric
// (style-notes-2026-10-28.md §4, criteria A1–A15), adopted by Erik
// Oct 28, 2026 as the standing pre-TTS gate. See STYLE-GATE.md for
// the rule this script serves: NO batch renders without (i) this
// gate clean or its flags adjudicated, and (ii) a judgment audit on
// flags + sample attached to the batch report.
//
// WHAT THIS SCRIPT IS: a FLAGGER, not a judge. It runs the checks
// that are honestly mechanical and emits per-story PASS / FLAG with
// criterion codes. It never emits a style SCORE and never passes
// judgment-only criteria off as measured — those are listed at the
// end of every run as JUDGMENT-REQUIRED.
//
// WHAT IT DELIBERATELY DOES NOT DO (retired proxies — Pass 1 audit,
// Oct 28, 2026, verified these detectors against their own worst
// cases and retired them rather than reporting their output):
//   - A13 fact-run detection: the heuristic flagged vivid narrative
//     as lecture cadence in all 17 worst cases (zero true runs).
//     Lecture cadence is judgment-only until a detector survives
//     verification. (A13's countable remnants — bare-year load and
//     sentence-length variance — ARE implemented, as flags.)
//   - A1 date-opener as a verdict: prepositional date phrases whose
//     main clause is a person/conflict are GOOD opens. Implemented
//     here only as a narrow begins-with-a-year FLAG for judgment.
//   - A14 place-name position as a verdict: places are legitimately
//     identified by local name or description ("El Cap"). The
//     name-token check is an advisory flag, nothing more.
//
// Usage:
//   node style-gate.mjs <manifest.json> [--manifest <more.json> ...]
//                       [--filler] [--out <report.md>]
// Manifest: a JSON array of entries (or {stories|items|texts: [...]})
// with story text in `story_text` (or `text`/`story`), and optional
// `place_name` / `angle` for labeling.
// Exit code: 0 = no flags, 1 = flags present (adjudicate before TTS).

import { readFileSync, writeFileSync } from 'node:fs';

// ---------------------------------------------------------------- text utils

function splitSentences(text) {
  const t = String(text || '')
    .replace(/\u2026/g, '...') // ellipsis char -> dots
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return [];
  // Protect ellipses (pause beats, not sentence ends) before splitting.
  const protectedText = t.replace(/\.\.\./g, '\u0001');
  return protectedText
    .split(/(?<=[.!?])\s+/)
    .map(s => s.replace(/\u0001/g, '...').trim())
    .filter(Boolean);
}

function wordsOf(s) {
  return s.split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------- detectors

// A14 — relative directions (rubric grep list; expectation: ZERO).
const RELATIVE_DIRECTIONS = [
  /\bon your (left|right)\b/i,
  /\bcoming up on\b/i,
  /\bjust ahead\b/i,
  /\blook now\b/i,
  /\bwatch for\b/i,
  /\byou'?ll see\b/i,
];

// A14 — exact distance: digit + distance unit. FLAG for judgment: the
// rubric bans number+unit AS A PROXIMITY CLAIM; a digit+unit hit may
// be a fact about the place itself (a tower's height), which judgment
// adjudicates. Spelled-out quantities are not greppable reliably and
// are left to the judgment audit.
const DISTANCE_RE = /\b\d[\d,]*(?:\.\d+)?\s*(?:meters?|metres?|yards?|feet|foot|miles?|kilometers?|kilometres?|km)\b/gi;

// A11 — standing-exclusion sweep (honesty class). PSA Flight 182 is
// default-excluded (memorials-only IF Erik ever flips it explicitly);
// school shootings are excluded by the D4 standing rule.
const EXCLUSION_PATTERNS = [
  { re: /\bflight\s*182\b/i, label: 'PSA Flight 182 reference' },
  { re: /\bschool shooting/i, label: 'school-shooting reference' },
];

// A12 — speculation-pivot surface forms (unattributed speculation).
// Attributed forms ("the story goes", "locals swear", "legend has
// it") are the persona's honest moves and are NOT flagged; whether a
// flagged pivot is later answered with a sourced fact is judgment.
const SPECULATION_PATTERNS = [
  /\bsome (say|theorists|believe|claim|argue)\b/i,
  /\btheorists (say|suggest|believe)\b/i,
  /\bcould it (be|really)\b/i,
  /\bwhat if\b/i,
  /\bno ?(body|one) knows\b/i,
  /\bremains? an? (unsolved )?mystery\b/i,
  /\bcoincidence\?\s*(?:i|you) think not\b/i,
];

// A2 — wow-position proxy. Scores each sentence for claim-strength
// signals (superlatives/absolutes, quantities, amounts) and finds
// where the strongest signal sits. A peak after sentence 2 = FLAG
// (the Living Coast shape: wow named at S4). Four-digit years are
// excluded — a date is not a wow. This is a proxy: judgment confirms
// which claim is actually the story's strongest.
const SUPERLATIVES = /\b(first|only|largest|biggest|smallest|tallest|oldest|youngest|deadliest|fastest|rarest|greatest|worst|best|most|never|always|impossible|incredible|unbelievable)\b/gi;
const QUANTITIES = /\b(thousands?|hundreds?|millions?|billions?|dozens?|fifteen|fifty|eighty|ninety|seventy|sixty|forty|thirty|twenty)\b/gi;
const AMOUNTS = /\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*(?:tons?|pounds?|lbs?|gallons?|barrels?|acres|feet tall|stories (?:tall|high))\b/gi;

function wowScore(sentence) {
  const s = sentence.replace(/\b(1[5-9]\d\d|20\d\d)\b/g, ' '); // strip years
  let score = 0;
  score += (s.match(SUPERLATIVES) || []).length * 2;
  score += (s.match(QUANTITIES) || []).length * 1;
  score += (s.match(AMOUNTS) || []).length * 2;
  return score;
}

// A1 — narrow begins-with-a-year flag (see header: flag, not verdict).
const YEAR_OPENER_RE = /^\s*(in\s+)?(the year\s+)?(1[5-9]\d\d|20\d\d)\b/i;
// A1 advisory — definition opener ("X is a ...") in sentence 1.
const DEFINITION_OPENER_RE = /^[^.!?]{0,80}?\bis an?\s/i;

// ---------------------------------------------------------------- per-story

function gateStory(entry, opts) {
  const text = entry.story_text || entry.text || entry.story || '';
  const sentences = splitSentences(text);
  const flags = [];    // hard: honesty / serve-truth / speculation surface — adjudication tickets
  const advisory = []; // register heuristics (Pass 1 treated these corpus-wide, not per-story): tickets for the judgment sample
  const notes = [];
  const flag = (code, msg) => flags.push({ code, msg });
  const advise = (code, msg) => advisory.push({ code, msg });

  if (sentences.length === 0) {
    flag('EMPTY', 'no story text');
    return { flags, advisory, notes, sentences };
  }
  const s1 = sentences[0];
  const firstTwo = sentences.slice(0, 2).join(' ');

  // A14 relative directions — expect 0.
  for (const re of RELATIVE_DIRECTIONS) {
    const m = text.match(re);
    if (m) flag('A14', `relative direction: "${m[0]}"`);
  }
  // A14 exact distance (digit+unit) — adjudicate proximity vs fact.
  const dist = [...text.matchAll(DISTANCE_RE)].map(m => m[0]);
  if (dist.length) flag('A14', `digit+unit distance(s): ${[...new Set(dist)].slice(0, 3).join(', ')} — confirm not a proximity claim`);

  // A11 exclusion sweep — honesty class.
  for (const { re, label } of EXCLUSION_PATTERNS) {
    if (re.test(text)) flag('A11-HONESTY', `exclusion sweep hit: ${label}`);
  }

  // A12 speculation surface forms.
  for (const re of SPECULATION_PATTERNS) {
    const m = text.match(re);
    if (m) flag('A12', `speculation form: "${m[0]}" — judgment: is it answered with a sourced fact?`);
  }

  // A1 narrow opener flags (advisory — the verdict form was retired).
  if (YEAR_OPENER_RE.test(s1)) advise('A1', 'sentence 1 begins with a year — judgment: is the main clause a person/conflict (good) or a date (fail)?');
  else if (DEFINITION_OPENER_RE.test(s1)) advise('A1', 'sentence 1 looks like a definition opener ("X is a ...") — judgment required');

  // A14c advisory — place named in first two sentences (local-name /
  // description identification is legitimate; judgment adjudicates).
  if (entry.place_name) {
    const tokens = entry.place_name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !['center', 'park', 'san', 'diego'].includes(w));
    const ft = firstTwo.toLowerCase();
    if (tokens.length && !tokens.some(tok => ft.includes(tok))) {
      advise('A14c', `place name token absent from sentences 1–2 (local name/description may identify it)`);
    }
  }

  // A2 wow-position proxy (advisory). Flag only when a later sentence
  // carries a strong signal (score >= 4) beating the best of the
  // opening two by a clear margin (>= 2) — a later sentence merely
  // accumulating specifics is normal narrative, not a buried wow.
  // Calibrated on Batch 2A against the Pass 1 verdicts: both true A2
  // FAILs (Living Coast origin, CVEATC origin) fire; CVEATC sports —
  // judged A2-marginal in Pass 1 — sits below the threshold.
  const scores = sentences.map(wowScore);
  const maxScore = Math.max(...scores);
  const peakIdx = scores.indexOf(maxScore); // earliest peak wins ties
  const openingBest = Math.max(scores[0] || 0, scores[1] || 0);
  if (maxScore >= 4 && peakIdx > 1 && maxScore >= openingBest + 2) {
    advise('A2', `wow proxy peaks at sentence ${peakIdx + 1} of ${sentences.length} (score ${maxScore} vs opening best ${openingBest}); strongest-claim signal should sit in sentences 1–2`);
  } else if (maxScore < 2) {
    notes.push('A2: no strong-claim signal detected by proxy — judgment confirms the wow and its position');
  } else {
    notes.push(`A2: wow proxy peaks at sentence ${peakIdx + 1} ✓`);
  }

  // A10 countable remnant — pause beats (em-dash / ellipsis), cap 3.
  const beats = (text.match(/—/g) || []).length + (text.match(/\.\.\./g) || []).length;
  if (beats > 3) advise('A10', `${beats} em-dash/ellipsis marks — judgment: pause beats (rubric tolerance ≤3) vs prose parentheticals`);

  // A13 countable remnants — bare-year load + sentence variance.
  // (Fact-run detection is RETIRED — see header. Judgment-only.)
  const years = (text.match(/\b(1[5-9]\d\d|20\d\d)\b/g) || []).length;
  const yearCap = opts.filler ? 1 : 3;
  if (years > yearCap) advise('A13', `${years} year mentions — bare-date load cap is ${yearCap} (dates attached to human action are fine; judgment counts bare ones)`);
  const lengths = sentences.map(s => wordsOf(s).length);
  const hasShort = lengths.some(n => n <= 6);
  const hasLong = lengths.some(n => n >= 20);
  if (!opts.filler && (!hasShort || !hasLong)) {
    advise('A13', `sentence-variance missing: ${!hasShort ? 'no ≤6-word sentence' : ''}${!hasShort && !hasLong ? ' and ' : ''}${!hasLong ? 'no ≥20-word sentence' : ''}`);
  }

  return { flags, advisory, notes, sentences };
}

// ---------------------------------------------------------------- judgment list

const JUDGMENT_REQUIRED = [
  'A1  cold open — the main-clause test (person/conflict/anomaly vs date/definition) beyond the narrow year-opener flag',
  'A2  wow singularity + which claim is truly the strongest (the proxy locates signals, not meaning)',
  'A3  open loop — planted in the first third, paid with fact in the final third (fillers: optional)',
  'A4  the TURN — one underlineable recontextualizing sentence',
  'A5  single thread — one-sentence retell; ≤2 subjects with >2 sentences',
  'A6  specifics traceability + swap test (density counting is mechanical-lite; honesty is judgment)',
  'A7  present-tense scene — exists at the pivot AND every scene detail traces to sources (highest fabrication risk)',
  'A8  button landing — classification of the final sentence; affection landings ≤1 in 3 per batch',
  'A9  Leo presence + contested-claim attribution (note: first-person register is Erik\'s open ruling — not gated here)',
  'A11 dark-material grammar — human before toll, toll once, no victim-targeted jokes (the exclusion SWEEP above is mechanical)',
  'A12 speculation payoff — every pivot answered with a sourced fact (surface forms flagged above)',
  'A13 lecture cadence / fact-runs — JUDGMENT-ONLY: the mechanical fact-run detector was retired in the Pass 1 audit (17/17 worst cases were vivid narrative)',
  'A15 human protagonist — a specific human\'s choices drive ≥half the beats (N/A only for flagged-thin packs)',
];

// ---------------------------------------------------------------- main

function loadManifest(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const arr = Array.isArray(raw) ? raw : raw.stories || raw.items || raw.texts || [];
  return arr;
}

function main() {
  const args = process.argv.slice(2);
  const opts = { filler: args.includes('--filler'), out: null };
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') opts.out = args[++i];
    else if (args[i] === '--manifest') paths.push(args[++i]);
    else if (!args[i].startsWith('--')) paths.push(args[i]);
  }
  if (!paths.length) {
    console.error('usage: node style-gate.mjs <manifest.json> [--filler] [--out report.md]');
    process.exit(2);
  }

  const lines = [];
  let total = 0, flagged = 0, advised = 0;
  const byCode = {};
  const honestyHits = [];

  for (const path of paths) {
    const entries = loadManifest(path);
    lines.push(`\n## ${path} — ${entries.length} stories`);
    for (const entry of entries) {
      total++;
      const label = `${entry.place_name || entry.place_key || '(unnamed)'}${entry.angle ? ' — ' + entry.angle : ''}`;
      const { flags, advisory, notes } = gateStory(entry, opts);
      for (const f of [...flags, ...advisory]) byCode[f.code] = (byCode[f.code] || 0) + 1;
      for (const f of flags) if (f.code.includes('HONESTY')) honestyHits.push(`${label}: ${f.msg}`);
      if (flags.length) {
        flagged++;
        lines.push(`FLAG  ${label}`);
        for (const f of flags) lines.push(`        [${f.code}] ${f.msg}`);
        for (const f of advisory) lines.push(`        [${f.code}~] ${f.msg} (advisory)`);
      } else if (advisory.length) {
        advised++;
        lines.push(`PASS+ ${label}  (advisories for the judgment sample)`);
        for (const f of advisory) lines.push(`        [${f.code}~] ${f.msg}`);
      } else {
        lines.push(`PASS  ${label}${notes.length ? '  (' + notes.join('; ') + ')' : ''}`);
      }
    }
  }

  const header = [
    `# Style gate — mechanical layer (rubric A1–A15, style-notes-2026-10-28 §4)`,
    `Stories: ${total} · PASS clean: ${total - flagged - advised} · PASS with advisories: ${advised} · FLAGGED (hard): ${flagged}`,
    `Flag counts by criterion: ${Object.entries(byCode).sort().map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}`,
    honestyHits.length
      ? `\n⚠ HONESTY-CLASS HITS (${honestyHits.length}) — REGENERATE class regardless of anything else:\n${honestyHits.map(h => '  - ' + h).join('\n')}`
      : `\nHonesty-class sweep (A11 exclusions): clean.`,
    `\nA FLAG is an adjudication ticket, not a verdict: the judgment audit (STYLE-GATE.md step ii) clears or confirms each one. PASS+ advisories (marked ~) are register heuristics — the Pass 1 audit treated them as corpus-wide findings, not per-story fails; they steer the judgment sample, they do not block.`,
    `\n## JUDGMENT-REQUIRED criteria (never scored by this script)`,
    ...JUDGMENT_REQUIRED.map(j => `  - ${j}`),
  ];
  const report = [...header, ...lines].join('\n') + '\n';
  if (opts.out) writeFileSync(opts.out, report);
  console.log(report);
  process.exit(flagged ? 1 : 0);
}

main();
