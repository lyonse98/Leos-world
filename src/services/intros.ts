// Opening lines Leo speaks when a tour starts. Rotated without repeats so
// consecutive sessions don't sound identical. Plain, warm tone — no slang.

const FRESH_INTROS = [
  "Hey, I'm Leo, your tour guide! Full disclosure, I'm an AI, which means I've read more about this place than pretty much anyone. It's kind of my whole thing. I'll be telling you about the buildings, landmarks, and oddities we pass — and if you've got questions, just ask. Let me figure out where we are first... alright, looking around.",
  "Welcome aboard! I'm Leo, and I'll be your guide today. Fair warning: I'm an AI, so I've absorbed an unreasonable amount of local history — and I love sharing the strange parts. Buildings, landmarks, buried stories, all of it. Got a question mid-walk? Just ask. Now let me get my bearings.",
  "Hi there, I'm Leo! Think of me as that friend who reads way too much local history and finally has someone to share it with. That's you today. Everything interesting we pass, I'll tell you about — and you can ask me anything along the way. Alright, let's see where we've landed.",
  "Hey! Leo here, your guide for today. I'm an AI, which mostly means I never run out of stories about the places we pass. Buildings, monuments, strange local history — that's my territory. Questions are welcome whenever they pop into your head. Let me take a look around and get us started.",
  "Hello! I'm Leo, and today I get to show you around. A quick heads-up: I'm an AI guide, so my knowledge of this area runs deep — including the parts that never make the guidebooks. I'll point out what matters as we go, and you can ask me anything, anytime. Alright, figuring out where we are.",
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
