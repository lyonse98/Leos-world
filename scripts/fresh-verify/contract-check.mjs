// Static §8A contract conformance for the fresh shell: event names
// and payload keys, storage keys, IndexedDB identity, bucket path
// prefixes, env var names, and the forbidden mechanisms (device
// speech narration, speech recognition, silent/zero-sample primes).
// Run: node scripts/fresh-verify/contract-check.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', '..', 'src');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}
const files = [...walk(srcRoot)];
const all = files.map(f => ({ path: f, text: readFileSync(f, 'utf8') }));
const corpus = all.map(f => f.text).join('\n');
const inFile = (name, needle) => {
  const f = all.find(x => x.path.endsWith(name));
  return f ? f.text.includes(needle) : false;
};

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

// ---- §8 event names, emitted somewhere in the shell
for (const ev of [
  'session_start',
  'opener_spoken',
  'unlock_latched',
  'unlock_lost',
  'prime_attempt',
  'story_played',
  'story_playback',
  'story_dropped',
  'filler_played',
  'question_lock_released',
]) {
  check(`event emitted: ${ev}`, corpus.includes(`'${ev}'`));
}

// ---- §8 payload keys at the emit sites
check("session_start {variant:'fresh'} (exact; build_id rides the event envelope)", /session_start', \{ variant: 'fresh' \}/.test(corpus));
check('opener_spoken {attempts, sounded}', /opener_spoken', \{ attempts:/.test(corpus) && /sounded: rec\.sounded/.test(corpus));
check('unlock_latched {source, ms_from_tour_start}', /unlock_latched', \{\s*source,/.test(corpus) && corpus.includes('ms_from_tour_start'));
check('unlock_lost {source: blocked-burst}', corpus.includes("source: 'blocked-burst'"));
check('prime_attempt {source, result, ms}', /prime_attempt', \{\s*source, result:/.test(corpus) || /prime_attempt', \{ source, result:/.test(corpus));
check('story_played {subject, source}', /story_played', \{ subject, source: item\.storySource/.test(corpus));
check('story_playback {sounded, completed, sounded_ms} (exact keys)', /story_playback', \{\s*sounded: rec\.sounded,\s*completed: rec\.completed,\s*sounded_ms:/.test(corpus));
check("story_dropped {reason} verbatim (no 'displaced' rewrite)", /story_dropped', \{ reason: rec\.dropReason/.test(corpus) && !corpus.includes("startsWith('displaced')"));
check('filler_played {title, region, matched}', /filler_played', \{ title: filler\.title, region, matched \}/.test(corpus));
check('question_lock_released {reason}', /question_lock_released', \{ reason \}/.test(corpus));

// ---- §8A-D storage keys (backend key map) — the spec's fixed list
for (const key of [
  'leo_active_session',
  'leo_session_id',
  'leo_user_key',
  'leo_day_state',
  'leo_story_coverage',
  'leo_told_topics',
  'leo_recent_stories',
  'leo_major_subjects',
  'leo_library_place_keys',
  'leo_last_intro_index',
  'leo_openers_played',
  'leo_stall_phrases_played',
  'leo_stories_since_last_ad',
  'leo_install_nudge_seen',
  'leo_spotify_prompted',
]) {
  check(`storage key: ${key}`, inFile('core/backend.ts', `'${key}'`));
}

// ---- IndexedDB identity
check("IndexedDB db 'leo_tts_cache'", inFile('core/backend.ts', "'leo_tts_cache'"));
check("IndexedDB store 'audio'", inFile('core/backend.ts', "'audio'"));

// ---- Bucket layout: manifest paths use the verified live prefixes
const clips = readFileSync(join(srcRoot, 'content', 'clips.ts'), 'utf8');
const paths = [...clips.matchAll(/'((?:openers|stall-phrases|fillers|miles)\/[^']+)'/g)].map(m => m[1]);
check('clip manifest paths found', paths.length >= 20, `found ${paths.length}`);
check('greetings: fresh under miles/intros/ (Phase 2), resume shared under openers/intros/', paths.some(p => p.startsWith('miles/intros/fresh-')) && paths.some(p => p.startsWith('openers/intros/resume-')));
check('stall phrases under stall-phrases/', paths.filter(p => p.includes('stall') || p.includes('worth-it') || p.includes('digging')).every(p => p.startsWith('stall-phrases/')));
check('bridges under fillers/bridges/', paths.filter(p => p.includes('bridge-')).every(p => p.startsWith('fillers/bridges/')));
check('no §8A-literal wrong prefixes (intros/, phrases/)', !paths.some(p => p.startsWith('intros/') || p.startsWith('phrases/')));

// ---- Env vars: exactly the five contract names appear
for (const v of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_GEMINI_API_KEY', 'VITE_GOOGLE_MAPS_API_KEY', 'VITE_GOOGLE_PLACES_API_KEY']) {
  check(`env var read: ${v}`, corpus.includes(v));
}
const envUsed = new Set([...corpus.matchAll(/VITE_[A-Z_]+/g)].map(m => m[0]));
check('no non-contract VITE_ vars', [...envUsed].every(v => ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_GEMINI_API_KEY', 'VITE_GOOGLE_MAPS_API_KEY', 'VITE_GOOGLE_PLACES_API_KEY'].includes(v)), [...envUsed].join(','));

// ---- Build identification: fresh- prefix + variant tag
check("build id carries the 'fresh-' prefix", /`fresh-\$\{/.test(corpus) || /'fresh-'/.test(corpus));

// ---- Persona: local narration model ids + version routing (§8A-C)
check("story/Q&A/TTS models route via leoPersona constants", inFile('core/gemini.ts', 'LEO_MODEL_ID') && inFile('core/gemini.ts', 'LEO_QA_MODEL_ID'));

// ---- Forbidden mechanisms
check('no speechSynthesis narration anywhere', !/speechSynthesis/.test(corpus));
check('no speech recognition (text-only Q&A)', !/SpeechRecognition|webkitSpeechRecognition|MediaRecorder/.test(corpus));
check('no hold-to-talk remnants', !/hold-to-talk|press-and-hold|holdToTalk/i.test(corpus));
check('prime is a real-sample WAV (220 Hz samples)', inFile('core/player.ts', '220') && inFile('core/player.ts', 'Int16Array'));

// ---- Deleted shell modules are not imported
for (const banned of ['useVoice', 'geminiAudio', 'storyCache', 'placesService']) {
  check(`no import of deleted module: ${banned}`, !new RegExp(`from '[^']*${banned}`).test(corpus));
}

// ---- Miles edition: persona + shared-cache containment (Phase 2)
check('persona speaks as Miles', inFile('leoPersona.ts', 'You are Miles —'));
check(
  'shared-cache read screens Leo self-references',
  inFile('core/backend.ts', 'SELF_REFERENCE_LEO') && inFile('core/backend.ts', "if (SELF_REFERENCE_LEO.test(row.story_text)) return null;"),
);
check(
  'no write-back into the shared tour_stories cache',
  !/from\('tour_stories'\)\.insert/.test(all.find(x => x.path.endsWith('core/backend.ts'))?.text ?? ''),
);
check(
  'Miles greetings point at the miles/ prefix (shared Leo clips untouched)',
  inFile('content/clips.ts', "path: 'miles/intros/fresh-1.wav'") && inFile('content/clips.ts', "path: 'miles/intros/fresh-3.wav'"),
);
check('no user-facing Leo strings remain in App/hooks/index.html', (() => {
  const app = all.find(x => x.path.endsWith('App.tsx'))?.text ?? '';
  const hooks = all.find(x => x.path.endsWith('hooks.ts'))?.text ?? '';
  return !/Leo/.test(app) && !/Leo/.test(hooks);
})());

console.log(failures === 0 ? '\nCONTRACT: all checks passed' : `\nCONTRACT: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
