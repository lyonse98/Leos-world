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
  { id: 'fresh-1', text: "Hey, I'm Miles — your AI tour guide. Let's see what's around us." },
  { id: 'fresh-2', text: "Hey there, I'm Miles — your AI tour guide. Let's see what's around us." },
  { id: 'fresh-3', text: "I'm Miles — your AI tour guide. Let's look around and see what's here." },
];

export const GREETINGS_RESUME: GreetingLine[] = [
  { id: 'resume-1', text: "Alright, we're back! Picking up right where we left off — more stories coming your way." },
  { id: 'resume-2', text: "Welcome back! The tour was just getting interesting. Let's keep going." },
  { id: 'resume-3', text: "Hey, you're back! Good, I saved some good ones. Picking up where we left off." },
];

/** GREETING clip per line id: bucket key + measured duration. */
export const GREETING_CLIPS: Record<string, { path: string; durationSec: number }> = {
  // Miles edition: the name-speaking greetings were re-rendered in
  // Miles's voice under the miles/ prefix — the shared Leo clips
  // under openers/intros/ are NEVER overwritten (the A build speaks
  // from them). Durations measured from the Miles renders.
  'fresh-1': { path: 'miles/intros/fresh-1.wav', durationSec: 4.4 },
  'fresh-2': { path: 'miles/intros/fresh-2.wav', durationSec: 4.8 },
  'fresh-3': { path: 'miles/intros/fresh-3.wav', durationSec: 4.4 },
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

// ------------------------------------------------------------ intro forms (Nov 11, 2026)
//
// The intro/bridge build (design note 2026-11-10): the pre-welcome
// opener is no longer one shape. These banks back the new opener
// FORMS — day-aware (daypart greetings + daypart heads), wandering
// frame, and the regular's short open. Every line is Puck's own
// voice, rendered through the intro/opener builder pipeline into
// the same bucket; durations are measured from the renders.
// The callback form has NO bank by design (a generic callback is a
// contradiction — its clip is pre-rendered per-listener at the
// previous tour's closeout), and the hook-question form is
// generated live from the welcome's own fact pack.

export type Daypart = 'early' | 'midday' | 'golden' | 'night';

/** Daypart greetings: two per daypart, each carrying the AI disclosure. */
export const GREETINGS_DAYPART: Record<Daypart, GreetingLine[]> = {
  early: [
    { id: 'daypart-early-1', text: "Morning. I'm Miles — your AI tour guide. Let's see what the day's starting with, out here." },
    { id: 'daypart-early-2', text: "Early miles are the best miles. I'm Miles, your AI tour guide — let's go see what's awake." },
  ],
  midday: [
    { id: 'daypart-midday-1', text: "Hey, I'm Miles — your AI tour guide. Middle of the day, and the city's all lit up. Let's look around." },
    { id: 'daypart-midday-2', text: "I'm Miles, your AI tour guide. Lunchtime light, full city out there — let's see what's around us." },
  ],
  golden: [
    { id: 'daypart-golden-1', text: "Golden hour. I'm Miles — your AI tour guide — and this is when the city shows off. Let's look." },
    { id: 'daypart-golden-2', text: "Evening light coming on. I'm Miles, your AI tour guide. Let's catch the city in this mood." },
  ],
  night: [
    { id: 'daypart-night-1', text: "Night drive. I'm Miles — your AI tour guide. The city after dark tells different stories. Let's hear them." },
    { id: 'daypart-night-2', text: "I'm Miles, your AI tour guide. After dark, everything out there gets a second story. Let's find a few." },
  ],
};

/** The daypart greeting lines join the shared clip record (GREETING_CLIPS). */
export const DAYPART_GREETING_CLIPS: Record<string, { path: string; durationSec: number }> = {
  'daypart-early-1': { path: 'miles/intros/daypart-early-1.wav', durationSec: 6.4 },
  'daypart-early-2': { path: 'miles/intros/daypart-early-2.wav', durationSec: 5.8 },
  'daypart-midday-1': { path: 'miles/intros/daypart-midday-1.wav', durationSec: 6.7 },
  'daypart-midday-2': { path: 'miles/intros/daypart-midday-2.wav', durationSec: 6.0 },
  'daypart-golden-1': { path: 'miles/intros/daypart-golden-1.wav', durationSec: 6.9 },
  'daypart-golden-2': { path: 'miles/intros/daypart-golden-2.wav', durationSec: 7.5 },
  'daypart-night-1': { path: 'miles/intros/daypart-night-1.wav', durationSec: 7.6 },
  'daypart-night-2': { path: 'miles/intros/daypart-night-2.wav', durationSec: 6.8 },
};

Object.assign(GREETING_CLIPS, DAYPART_GREETING_CLIPS);

/** Day-aware opener heads: one per daypart, paired with its greeting. */
export const DAYPART_HEADS: Record<Daypart, OpenerClip> = {
  early: {
    id: 'daypart-head-early',
    path: 'openers/daypart-head-early.wav',
    durationSec: 13.2,
    lengthClass: 'short',
    transcript:
      "First light does something honest to this town — fishermen, bakers, and surfers all clock in before the traffic does. Whatever corner we're rolling through, it has a morning version of itself. Let's go meet it.",
  },
  midday: {
    id: 'daypart-head-midday',
    path: 'openers/daypart-head-midday.wav',
    durationSec: 12.4,
    lengthClass: 'short',
    transcript:
      "Midday is when a city stops posing. Delivery trucks, lunch lines, the real working rhythm of the place — that's the San Diego locals actually live in. Keep your eyes open; the good stories don't wait for golden hour.",
  },
  golden: {
    id: 'daypart-head-golden',
    path: 'openers/daypart-head-golden.wav',
    durationSec: 12.8,
    lengthClass: 'short',
    transcript:
      "This is the hour San Diego brags about — the light goes amber, the bay turns to hammered copper, and every neighborhood puts its best face on. Fair warning: it makes even the traffic bearable.",
  },
  night: {
    id: 'daypart-head-night',
    path: 'openers/daypart-head-night.wav',
    durationSec: 15.0,
    lengthClass: 'short',
    transcript:
      "After dark the map changes. The landmarks go quiet and the small places light up — the diners, the dive bars, the late ferries. Different city, same streets. I'll narrate the night version.",
  },
};

/** Wandering-frame openers: freeform framed honestly — no plan, streets pitch. */
export const WANDERING_OPENERS: OpenerClip[] = [
  {
    id: 'wandering-1',
    path: 'openers/wandering-1.wav',
    durationSec: 6.1,
    lengthClass: 'short',
    transcript: "No plan today. We roll, and the streets pitch stories. I like days like this.",
  },
  {
    id: 'wandering-2',
    path: 'openers/wandering-2.wav',
    durationSec: 6.3,
    lengthClass: 'short',
    transcript: "Freeform day — no route, no script. Wherever the road wanders, I'll find what's worth hearing on it.",
  },
  {
    id: 'wandering-3',
    path: 'openers/wandering-3.wav',
    durationSec: 6.8,
    lengthClass: 'short',
    transcript: "We go where we go today. My only job is making sure you hear what the streets are hiding as we pass.",
  },
  {
    id: 'wandering-4',
    path: 'openers/wandering-4.wav',
    durationSec: 7.1,
    lengthClass: 'short',
    transcript: "No destination, no problem. Some of the best stories only show up when nobody's aiming anywhere.",
  },
];

/** The regular's short open: earned by recency — a nod, then the road. */
export const REGULARS_SHORTS: OpenerClip[] = [
  {
    id: 'regular-1',
    path: 'openers/regular-1.wav',
    durationSec: 4.2,
    lengthClass: 'short',
    transcript: "Back again — good. Quick hello, then straight to the good stuff.",
  },
  {
    id: 'regular-2',
    path: 'openers/regular-2.wav',
    durationSec: 5.0,
    lengthClass: 'short',
    transcript: "You know the drill by now. Let's get rolling — stories first, small talk later.",
  },
  {
    id: 'regular-3',
    path: 'openers/regular-3.wav',
    durationSec: 5.1,
    lengthClass: 'short',
    transcript: "Right back at it. I'll keep the hello short; the road's got better material.",
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
  // Batch v2 (Oct 30, 2026, Erik-approved): 46 more lines. The six authored functions map onto the two kinds — settling-in and quiet-stretch open an episode ('first'); time-passing, topic-pivot, returning, and weather/light chain ('next'). The picker randomizes within kind, so bank size is the variety.
  { slug: 'v2-settle-1', kind: 'first', path: 'fillers/bridges/v2-settle-1.wav', text: "Settle in — I've got one that's pure San Diego." },
  { slug: 'v2-settle-2', kind: 'first', path: 'fillers/bridges/v2-settle-2.wav', text: "Alright, my pick this time. And it's a good one." },
  { slug: 'v2-settle-3', kind: 'first', path: 'fillers/bridges/v2-settle-3.wav', text: "Here's a story I never get tired of telling." },
  { slug: 'v2-settle-4', kind: 'first', path: 'fillers/bridges/v2-settle-4.wav', text: "Quiet stretch? Perfect. Let me tell you one about the whole county." },
  { slug: 'v2-settle-5', kind: 'first', path: 'fillers/bridges/v2-settle-5.wav', text: "This next one doesn't belong to any single place. It belongs to everywhere around here." },
  { slug: 'v2-settle-6', kind: 'first', path: 'fillers/bridges/v2-settle-6.wav', text: "Give me a minute with this one. It pays off." },
  { slug: 'v2-settle-7', kind: 'first', path: 'fillers/bridges/v2-settle-7.wav', text: "Okay. A story with no address — it rides along anywhere." },
  { slug: 'v2-settle-8', kind: 'first', path: 'fillers/bridges/v2-settle-8.wav', text: "I've been saving this one for exactly this kind of moment." },
  { slug: 'v2-settle-9', kind: 'first', path: 'fillers/bridges/v2-settle-9.wav', text: "No landmark needed for this one. Just a county truth." },
  { slug: 'v2-settle-10', kind: 'first', path: 'fillers/bridges/v2-settle-10.wav', text: "Let me take the conversation for a stretch." },
  { slug: 'v2-time-1', kind: 'next', path: 'fillers/bridges/v2-time-1.wav', text: "Miles go down smoother with a story riding on them." },
  { slug: 'v2-time-2', kind: 'next', path: 'fillers/bridges/v2-time-2.wav', text: "A few more minutes of road calls for a few more minutes of story." },
  { slug: 'v2-time-3', kind: 'next', path: 'fillers/bridges/v2-time-3.wav', text: "Time passes differently when somebody's talking." },
  { slug: 'v2-time-4', kind: 'next', path: 'fillers/bridges/v2-time-4.wav', text: "Let's spend the next stretch on something worth knowing." },
  { slug: 'v2-time-5', kind: 'next', path: 'fillers/bridges/v2-time-5.wav', text: "Nothing to hurry about. There's time, and I have material." },
  { slug: 'v2-time-6', kind: 'next', path: 'fillers/bridges/v2-time-6.wav', text: "We've got road ahead, and I've got stories. Fair trade." },
  { slug: 'v2-time-7', kind: 'next', path: 'fillers/bridges/v2-time-7.wav', text: "A long drive is just small stories stacked up. Here's another for the pile." },
  { slug: 'v2-time-8', kind: 'next', path: 'fillers/bridges/v2-time-8.wav', text: "While the miles tick by — here's something to tick along with them." },
  { slug: 'v2-pivot-1', kind: 'next', path: 'fillers/bridges/v2-pivot-1.wav', text: "Different subject entirely. Trust me on the turn." },
  { slug: 'v2-pivot-2', kind: 'next', path: 'fillers/bridges/v2-pivot-2.wav', text: "Change of subject — and I promise it's a promotion." },
  { slug: 'v2-pivot-3', kind: 'next', path: 'fillers/bridges/v2-pivot-3.wav', text: "Now for something the guidebooks walk right past." },
  { slug: 'v2-pivot-4', kind: 'next', path: 'fillers/bridges/v2-pivot-4.wav', text: "Let me change lanes, subject-wise." },
  { slug: 'v2-pivot-5', kind: 'next', path: 'fillers/bridges/v2-pivot-5.wav', text: "New topic, same county." },
  { slug: 'v2-pivot-6', kind: 'next', path: 'fillers/bridges/v2-pivot-6.wav', text: "Here's a left turn worth taking." },
  { slug: 'v2-pivot-7', kind: 'next', path: 'fillers/bridges/v2-pivot-7.wav', text: "Pivoting — because this one's too good to leave in the glovebox." },
  { slug: 'v2-pivot-8', kind: 'next', path: 'fillers/bridges/v2-pivot-8.wav', text: "Forget the famous stuff for a minute. Try this instead." },
  { slug: 'v2-quiet-1', kind: 'first', path: 'fillers/bridges/v2-quiet-1.wav', text: "Quiet roads deserve their own kind of story. This is one of those." },
  { slug: 'v2-quiet-2', kind: 'first', path: 'fillers/bridges/v2-quiet-2.wav', text: "Since it's just us and the road for a bit —" },
  { slug: 'v2-quiet-3', kind: 'first', path: 'fillers/bridges/v2-quiet-3.wav', text: "A stretch like this is made for a story like this." },
  { slug: 'v2-quiet-4', kind: 'first', path: 'fillers/bridges/v2-quiet-4.wav', text: "Nothing needs our attention for a moment. Good. Listen to this." },
  { slug: 'v2-quiet-5', kind: 'first', path: 'fillers/bridges/v2-quiet-5.wav', text: "Here's one for the empty miles." },
  { slug: 'v2-quiet-6', kind: 'first', path: 'fillers/bridges/v2-quiet-6.wav', text: "Slow moment? I know a cure." },
  { slug: 'v2-quiet-7', kind: 'first', path: 'fillers/bridges/v2-quiet-7.wav', text: "Let the quiet have a little company." },
  { slug: 'v2-return-1', kind: 'next', path: 'fillers/bridges/v2-return-1.wav', text: "And while that one settles — here's another." },
  { slug: 'v2-return-2', kind: 'next', path: 'fillers/bridges/v2-return-2.wav', text: "One story leads to another around here. This way." },
  { slug: 'v2-return-3', kind: 'next', path: 'fillers/bridges/v2-return-3.wav', text: "Before the road takes us somewhere new — a word about everywhere." },
  { slug: 'v2-return-4', kind: 'next', path: 'fillers/bridges/v2-return-4.wav', text: "That was one place. This one's the whole picture." },
  { slug: 'v2-return-5', kind: 'next', path: 'fillers/bridges/v2-return-5.wav', text: "Staying with you — and widening out for a minute." },
  { slug: 'v2-return-6', kind: 'next', path: 'fillers/bridges/v2-return-6.wav', text: "Good. Now let me show you the frame around that picture." },
  { slug: 'v2-return-7', kind: 'next', path: 'fillers/bridges/v2-return-7.wav', text: "There's more where that came from — broader, this time." },
  { slug: 'v2-sky-1', kind: 'next', path: 'fillers/bridges/v2-sky-1.wav', text: "Rain or shine, gray or gold — this one's true either way." },
  { slug: 'v2-sky-2', kind: 'next', path: 'fillers/bridges/v2-sky-2.wav', text: "Morning, noon, or midnight — this story holds." },
  { slug: 'v2-sky-3', kind: 'next', path: 'fillers/bridges/v2-sky-3.wav', text: "Some things about this county don't change with the light. This is one of them." },
  { slug: 'v2-sky-4', kind: 'next', path: 'fillers/bridges/v2-sky-4.wav', text: "The sky does its thing. The county does this. Listen." },
  { slug: 'v2-sky-5', kind: 'next', path: 'fillers/bridges/v2-sky-5.wav', text: "Any hour will do for this one. It's always true here." },
  { slug: 'v2-sky-6', kind: 'next', path: 'fillers/bridges/v2-sky-6.wav', text: "Daylight version, headlights version — same story either way." },
];
