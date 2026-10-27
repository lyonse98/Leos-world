import { supabase } from './supabase';

// Opening lines Leo speaks when a tour starts. Rotated without repeats so
// consecutive sessions don't sound identical. Plain, warm tone — no slang.
//
// SHORT by design (Area A, Oct 26, 2026): the previous fresh intros ran
// ~55 words — about 24 seconds of device voice before the tour's first
// real content — so a perfectly healthy start READ as a fallback or a
// stall, and burned a third of the runway the Puck opener exists to
// cover. The greeting's whole job is to say who Leo is (with the AI
// disclosure) and hand over to the opener clip: five seconds, no more.
// The orientation the long versions carried now lives where it belongs —
// in the neighborhood welcome story that follows.
//
// PRE-RENDERED by design (Pass 1, Oct 27, 2026): every variant below
// has a stored Puck clip (INTRO_CLIPS), generated once through the
// same Batch API path as the library corpus and the opener clips
// (scripts/library/build-intros.mjs) and served from the tts-audio
// bucket. The generic welcome is the warm-up buffer while the first
// Gemini live story — the neighborhood welcome — generates; spoken
// live or in the device voice it would arrive late or in the wrong
// voice, which defeats its only job. If a variant's clip is missing
// or fails to load/play, playback falls back to the device voice
// speaking the same words.

export interface IntroLine {
  id: string;
  text: string;
}

const FRESH_INTROS: IntroLine[] = [
  { id: 'fresh-1', text: "Hey, I'm Leo — your AI tour guide. Let's see what's around us." },
  { id: 'fresh-2', text: "Hey there, I'm Leo — your AI tour guide. Let's see what's around us." },
  { id: 'fresh-3', text: "I'm Leo — your AI tour guide. Let's look around and see what's here." },
];

const RESUME_INTROS: IntroLine[] = [
  { id: 'resume-1', text: "Alright, we're back! Picking up right where we left off — more stories coming your way." },
  { id: 'resume-2', text: "Welcome back! The tour was just getting interesting. Let's keep going." },
  { id: 'resume-3', text: "Hey, you're back! Good, I saved some good ones. Picking up where we left off." },
];

// Clip manifest, keyed by IntroLine id. Paths live in the tts-audio
// bucket next to the opener clips; durations are measured from the
// rendered WAVs at build time (see build-intros.mjs output).
export const INTRO_CLIPS: Record<string, { path: string; durationSec: number }> = {
  'fresh-1': { path: 'openers/intros/fresh-1.wav', durationSec: 5.1 },
  'fresh-2': { path: 'openers/intros/fresh-2.wav', durationSec: 4.6 },
  'fresh-3': { path: 'openers/intros/fresh-3.wav', durationSec: 4.8 },
  'resume-1': { path: 'openers/intros/resume-1.wav', durationSec: 4.2 },
  'resume-2': { path: 'openers/intros/resume-2.wav', durationSec: 4.6 },
  'resume-3': { path: 'openers/intros/resume-3.wav', durationSec: 4.6 },
};

const LAST_INTRO_KEY = 'leo_last_intro_index';

function pickWithoutRepeat(pool: IntroLine[]): IntroLine {
  let lastIndex = -1;
  try {
    const stored = localStorage.getItem(LAST_INTRO_KEY);
    if (stored !== null) lastIndex = parseInt(stored, 10);
  } catch {
    // storage unavailable — treat as no history
  }

  let index = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && index === lastIndex) {
    index = (index + 1) % pool.length;
  }

  try {
    localStorage.setItem(LAST_INTRO_KEY, String(index));
  } catch {
    // storage unavailable — rotation just won't persist
  }

  return pool[index];
}

export function getIntroEntry(resume: boolean): IntroLine {
  return pickWithoutRepeat(resume ? RESUME_INTROS : FRESH_INTROS);
}

export function getIntro(resume: boolean): string {
  return getIntroEntry(resume).text;
}

// Public URL of the variant's pre-rendered Puck clip, or null when the
// variant has no clip in the manifest (the caller then speaks it in
// the device voice instead). Mirrors openerAudioUrl in openers.ts.
export function introAudioUrl(entry: IntroLine): string | null {
  const clip = INTRO_CLIPS[entry.id];
  if (!clip) return null;
  return supabase.storage.from('tts-audio').getPublicUrl(clip.path).data.publicUrl;
}
