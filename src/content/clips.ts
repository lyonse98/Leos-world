// Stored-clip manifests for the fresh shell.
//
// DATA ONLY: clip ids, bucket keys, durations, and transcripts, drawn
// from the content layer (the offline render pipeline's manifests).
// All selection/rotation logic lives in the shell engine, not here.
//
// Bucket keys verified against the live `tts-audio` bucket on
// 2026-10-29 (public-URL probes): GREETING clips resolve under
// `openers/intros/…` and stall phrases under `stall-phrases/…`.

export interface GreetingLine {
  id: string;
  text: string;
}

export const GREETINGS_FRESH: GreetingLine[] = [
  { id: 'fresh-1', text: "Hey, I'm Leo — your AI tour guide. Let's see what's around us." },
  { id: 'fresh-2', text: "Hey there, I'm Leo — your AI tour guide. Let's see what's around us." },
  { id: 'fresh-3', text: "I'm Leo — your AI tour guide. Let's look around and see what's here." },
];

export const GREETINGS_RESUME: GreetingLine[] = [
  { id: 'resume-1', text: "Alright, we're back! Picking up right where we left off — more stories coming your way." },
  { id: 'resume-2', text: "Welcome back! The tour was just getting interesting. Let's keep going." },
  { id: 'resume-3', text: "Hey, you're back! Good, I saved some good ones. Picking up where we left off." },
];

/** GREETING clip per line id: bucket key + measured duration. */
export const GREETING_CLIPS: Record<string, { path: string; durationSec: number }> = {
  'fresh-1': { path: 'openers/intros/fresh-1.wav', durationSec: 5.1 },
  'fresh-2': { path: 'openers/intros/fresh-2.wav', durationSec: 4.6 },
  'fresh-3': { path: 'openers/intros/fresh-3.wav', durationSec: 4.8 },
  'resume-1': { path: 'openers/intros/resume-1.wav', durationSec: 4.2 },
  'resume-2': { path: 'openers/intros/resume-2.wav', durationSec: 4.6 },
  'resume-3': { path: 'openers/intros/resume-3.wav', durationSec: 4.6 },
};

export type OpenerLengthClass = 'short' | 'medium' | 'long';

export interface OpenerClip {
  id: string;
  path: string;
  durationSec: number;
  lengthClass: OpenerLengthClass;
  transcript: string;
}

/** The rotating OPENER pool (pre-rendered Puck hooks). */
export const OPENER_CLIPS: OpenerClip[] = [
  {
    id: 'promise',
    path: 'openers/promise.wav',
    durationSec: 11.8,
    lengthClass: 'short',
    transcript:
      "Before we roll, one promise: every story you're about to hear is true, and it happened right here, on ground we can see. This place hides the good stuff in plain sight.",
  },
  {
    id: 'postcard',
    path: 'openers/postcard.wav',
    durationSec: 10.2,
    lengthClass: 'short',
    transcript:
      "Nobody tells visitors this: the most interesting thing in any city is rarely the postcard. It's the story standing right next to it. Stick with me — I'll prove it.",
  },
  {
    id: 'chapters',
    path: 'openers/chapters.wav',
    durationSec: 20.7,
    lengthClass: 'medium',
    transcript:
      "Look around. Where we're standing has been a mission frontier, a working port, a tuna town, and the stage for a world's fair — sometimes in the same decade. This city stacks its chapters instead of closing them. So here's the deal: I watch the streets, you enjoy the ride, and when we pass a story worth telling, you hear it.",
  },
  {
    id: 'many-towns',
    path: 'openers/many-towns.wav',
    durationSec: 18.5,
    lengthClass: 'medium',
    transcript:
      "This is a Navy town that surfs, a beach town with a science mesa, a border city with a craft-beer problem — in the best way. Every neighborhood we're about to roll through is running at least two of those stories at once. My job is to catch them as they pass your window. Yours is just to keep your eyes open.",
  },
  {
    id: 'two-countries',
    path: 'openers/two-countries.wav',
    durationSec: 20.5,
    lengthClass: 'medium',
    transcript:
      "Two countries, one coastline, and about nine climates before lunch — that's the ground we're covering. A canyon can run ten degrees cooler than the hill above it, and the story changes just as fast. I'll keep up with all of it: the history, the oddities, the places locals love and guidebooks skip. All you have to do is ride.",
  },
  {
    id: 'how-i-work',
    path: 'openers/how-i-work.wav',
    durationSec: 33.2,
    lengthClass: 'long',
    transcript:
      "While I get my bearings, let me tell you how I work. I read everything — the plaques, the archives, the old newspapers, the stuff that never made the tour books. Then I watch where we are, block by block, and when a real story lines up with the street outside your window, I tell it: the people, the scandal, the strange little turns that made this place what it is. Some of it is grand history. Some of it is a dog park with a past. Around here, you honestly can't tell which is which until you hear the story — and that's exactly the fun of it.",
  },
  {
    id: 'bearings',
    path: 'openers/bearings.wav',
    durationSec: 27.8,
    lengthClass: 'long',
    transcript:
      "Still getting my bearings up here — give me a few more seconds, because the first story sets the tone for the whole tour and I want it to be the right one. In the meantime, a taste of what's out there: this city has been a Spanish presidio, a whaling port, a Navy stronghold, and the place comic books took over the world — and it wears every one of those lives at once. When I land on where exactly we are, we start properly. It'll be worth the breath.",
  },
];

export interface StallClip {
  id: string;
  path: string;
  durationSec: number;
  transcript: string;
}

/** Pre-rendered stall phrases (spec S12: cover a synthesis wait at 4 s). */
export const STALL_CLIPS: StallClip[] = [
  { id: 'worth-it', path: 'stall-phrases/worth-it.wav', durationSec: 3.7, transcript: "Give me a moment — this next one's worth getting right." },
  { id: 'digging', path: 'stall-phrases/digging.wav', durationSec: 3.3, transcript: "One second — I'm digging out the good version of this one." },
  { id: 'hold-on', path: 'stall-phrases/hold-on.wav', durationSec: 3.1, transcript: "Hold on — I'd rather tell this properly than rush it." },
  { id: 'brewing', path: 'stall-phrases/brewing.wav', durationSec: 3.8, transcript: "Just a breath — something good is coming together back there." },
  { id: 'wait-for-it', path: 'stall-phrases/wait-for-it.wav', durationSec: 4.0, transcript: "Wait for it — no, really. This one earns the pause." },
  { id: 'lining-up', path: 'stall-phrases/lining-up-v3.wav', durationSec: 4.6, transcript: "Flipping the pages — I'm lining up the story this street deserves." },
  { id: 'shoes-on', path: 'stall-phrases/shoes-on.wav', durationSec: 3.5, transcript: "Almost there — the next story's still putting its shoes on." },
];

export type BridgeKind = 'first' | 'next';

export interface BridgeClip {
  slug: string;
  kind: BridgeKind;
  path: string;
  text: string;
}

/** Filler-episode bridges (spec F7). Bucket keys: fillers/bridges/<slug>.wav. */
export const BRIDGE_CLIPS: BridgeClip[] = [
  { slug: 'bridge-first-1', kind: 'first', path: 'fillers/bridges/bridge-first-1.wav', text: "While we've got a quiet stretch of road here — let me tell you something about this town most people never hear." },
  { slug: 'bridge-first-2', kind: 'first', path: 'fillers/bridges/bridge-first-2.wav', text: 'This is a good spot for a story that belongs to the whole county, not just one corner of it.' },
  { slug: 'bridge-first-3', kind: 'first', path: 'fillers/bridges/bridge-first-3.wav', text: "Give me thirty seconds on this one. It's worth it." },
  { slug: 'bridge-next-1', kind: 'next', path: 'fillers/bridges/bridge-next-1.wav', text: "And since we've got the road to ourselves a little longer — here's another one." },
  { slug: 'bridge-next-2', kind: 'next', path: 'fillers/bridges/bridge-next-2.wav', text: "One more, while the town catches up with us." },
];
