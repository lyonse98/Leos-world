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

const FRESH_INTROS = [
  "Hey, I'm Leo — your AI tour guide. Let's see what's around us.",
  "Hey there, I'm Leo — your AI tour guide. Let's see what's around us.",
  "I'm Leo — your AI tour guide. Let's look around and see what's here.",
];

const RESUME_INTROS = [
  "Alright, we're back! Picking up right where we left off — more stories coming your way.",
  "Welcome back! The tour was just getting interesting. Let's keep going.",
  "Hey, you're back! Good, I saved some good ones. Picking up where we left off.",
];

const LAST_INTRO_KEY = 'leo_last_intro_index';

function pickWithoutRepeat(pool: string[]): string {
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

export function getIntro(resume: boolean): string {
  return pickWithoutRepeat(resume ? RESUME_INTROS : FRESH_INTROS);
}
