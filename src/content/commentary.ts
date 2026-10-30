// Colour commentary bank — B·Miles ONLY (Erik's ruling, Oct 29, 2026:
// unparked for B as a vibe test this iteration; A·Leo does not get it).
//
// Short Miles-voiced remarks BETWEEN stories: personality and presence
// in the car, distinct from the filler lane (fillers cover silence;
// commentary adds character while things are already flowing).
// Pre-rendered through the Puck pipeline under miles/commentary/ —
// NO live generation in the serve path. Selection/rotation/caps live
// in the tour engine (src/core/tour.ts), not here.
//
// Writing rules for this bank (the filler lesson, applied):
// deliberate, region/time-aware framing — never a fake reaction to a
// story the line cannot know, never a place-specific claim inside a
// region line, never a weather/day presumption outside its tod tag.

import type { FillerRegion } from '../data/fillerRegions';

export type CommentaryTod = 'morning' | 'afternoon' | 'evening' | 'night';

export interface CommentaryClip {
  id: string;
  text: string;
  path: string;
  durationSec: number;
  region?: FillerRegion;
  tod?: CommentaryTod;
}

/** Code-level master switch. The bucket kill-switch
 *  (miles/commentary/config.json, read at tour start) can also stand
 *  the lane down without a republish; this flag is the hard floor. */
export const COMMENTARY_ENABLED = true;

/** Hard frequency cap: at most one clip per ~4 minutes of tour. */
export const COMMENTARY_MIN_GAP_MS = 240_000;

export const COMMENTARY_CLIPS: CommentaryClip[] = [
  // ---- general presence (any region, any hour) ----
  { id: 'gen-1', text: "Still with me? Good. This county just keeps unfolding.", path: 'miles/commentary/gen-1.wav', durationSec: 4.9 },
  { id: 'gen-2', text: "I could drive these roads every day and still find something new. That's the whole point, really.", path: 'miles/commentary/gen-2.wav', durationSec: 5.8 },
  { id: 'gen-3', text: "Plenty of road left. Plenty of stories on it, too.", path: 'miles/commentary/gen-3.wav', durationSec: 3.7 },
  { id: 'gen-4', text: "Some of these, honestly, I think about for days after.", path: 'miles/commentary/gen-4.wav', durationSec: 4.1 },
  { id: 'gen-5', text: "This is my favorite way to see a place — just rolling through it.", path: 'miles/commentary/gen-5.wav', durationSec: 4.5 },
  { id: 'gen-6', text: "Tell you what — nobody's bored in the passenger seat today.", path: 'miles/commentary/gen-6.wav', durationSec: 3.6 },
  { id: 'gen-7', text: "We've got time. Let's use it well.", path: 'miles/commentary/gen-7.wav', durationSec: 2.7 },
  { id: 'gen-8', text: "I never get tired of this part — just us, the road, and whatever's next.", path: 'miles/commentary/gen-8.wav', durationSec: 6.5 },
  { id: 'gen-9', text: "You picked a good day to ride along.", path: 'miles/commentary/gen-9.wav', durationSec: 2.7 },
  { id: 'gen-10', text: "Every mile out here has something buried in it. Half my job is digging.", path: 'miles/commentary/gen-10.wav', durationSec: 5.8 },
  // ---- region-aware ----
  { id: 'coast-1', text: "That's the coast for you — the light out here does half the storytelling.", path: 'miles/commentary/coast-1.wav', durationSec: 4.2, region: 'coast' },
  { id: 'coast-2', text: "Out here by the water, everything slows down just a touch. Even the stories.", path: 'miles/commentary/coast-2.wav', durationSec: 6, region: 'coast' },
  { id: 'north-1', text: "North County has this easy sprawl to it — groves, hills, little towns with big pasts.", path: 'miles/commentary/north-1.wav', durationSec: 7.1, region: 'north' },
  { id: 'north-2', text: "Up here, the county breathes a little easier. Space between things.", path: 'miles/commentary/north-2.wav', durationSec: 5.6, region: 'north' },
  { id: 'central-1', text: "Right through the middle of it now — this is where the city stacks its history deepest.", path: 'miles/commentary/central-1.wav', durationSec: 5.8, region: 'central' },
  { id: 'east-1', text: "Out east, the land starts making the decisions — canyons, grades, wide-open sky.", path: 'miles/commentary/east-1.wav', durationSec: 6.7, region: 'east' },
  { id: 'south-1', text: "Down here in the South Bay, two countries share one horizon. You can feel both.", path: 'miles/commentary/south-1.wav', durationSec: 5.5, region: 'south' },
  { id: 'back-1', text: "Backcountry miles. This is where San Diego keeps its oldest stories — and its quietest.", path: 'miles/commentary/back-1.wav', durationSec: 6.6, region: 'backcountry' },
  // ---- time-of-day aware ----
  { id: 'morn-1', text: "Morning miles are the best miles. Everything's still possible.", path: 'miles/commentary/morn-1.wav', durationSec: 3.6, tod: 'morning' },
  { id: 'morn-2', text: "Early light like this — the city's not done waking up, but we are.", path: 'miles/commentary/morn-2.wav', durationSec: 4.6, tod: 'morning' },
  { id: 'aft-1', text: "Middle of the day, middle of the county. Not a bad place to be.", path: 'miles/commentary/aft-1.wav', durationSec: 4.8, tod: 'afternoon' },
  { id: 'eve-1', text: "Golden hour. San Diego shows off a little at golden hour — can't blame it.", path: 'miles/commentary/eve-1.wav', durationSec: 5.9, tod: 'evening' },
  { id: 'eve-2', text: "Evening's coming on. Stories land different in this light, I think.", path: 'miles/commentary/eve-2.wav', durationSec: 5.3, tod: 'evening' },
  { id: 'night-1', text: "Night driving changes the stories. Everything's closer in, somehow.", path: 'miles/commentary/night-1.wav', durationSec: 5.4, tod: 'night' },
];
