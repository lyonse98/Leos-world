import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Rotating pre-rendered Puck openers (Oct 26, 2026).
//
// The canned local welcome buys the first ~20 seconds; these clips buy the
// rest of the runway. Each is a short, place-generic "capture the ear"
// piece — a hook and a promise, in Leo's voice (Puck, the same Gemini TTS
// the stories use) — synthesized OFFLINE with the library's Batch TTS
// pattern (scripts/library/build-openers.mjs), stored in the tts-audio
// bucket under openers/, and played from its public URL. Playback spends
// no synthesis quota and waits on nothing: the file already exists.
//
// Sequence at a genuine tour start:
//   canned local welcome → Puck opener → neighborhood welcome → landmarks.
// While the opener plays, the pipeline warms in parallel (the kickoff
// fetch generates the neighborhood intro; the intro's synthesis warms via
// pre-synthesis once it queues behind the opener). The opener is COVER,
// never a gate — generation starts at the tap, not at the clip's end.
//
// Selection rule (deliberately simple):
//   fresh start → a MEDIUM primary (~20s, matching the observed cold
//     first-serve latency); if the neighborhood intro still hasn't queued
//     when the primary settles, ONE long extension segment follows.
//   resume start → a SHORT primary (~10s), no extension: a returning
//     listener gets a brief bridge, not the full overture.
// Rotation: ids played within the last 7 days are excluded until the
// class pool would be empty; played ids are stamped at selection time.
// ---------------------------------------------------------------------------

export type OpenerLengthClass = 'short' | 'medium' | 'long';

export interface PuckOpener {
  id: string;
  path: string; // object key inside the tts-audio bucket
  durationSec: number;
  lengthClass: OpenerLengthClass;
  transcript: string;
}

// Manifest — durations measured from the rendered WAVs at build time
// (scripts/library/build-openers.mjs). Transcripts are the exact texts
// synthesized; Erik reviews by ear.
export const PUCK_OPENERS: PuckOpener[] = [
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

const PLAYED_KEY = 'leo_openers_played';
const ROTATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadPlayed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PLAYED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function markPlayed(id: string): void {
  try {
    const played = loadPlayed();
    played[id] = Date.now();
    localStorage.setItem(PLAYED_KEY, JSON.stringify(played));
  } catch {
    // storage unavailable — rotation just won't persist
  }
}

/** Public URL for a manifest entry (the bucket serves library audio the same way). */
export function openerAudioUrl(opener: PuckOpener): string {
  return supabase.storage.from('tts-audio').getPublicUrl(opener.path).data.publicUrl;
}

/**
 * Pick a clip of the requested class, excluding ids played within the
 * rotation window and any ids the caller already used this start. If the
 * exclusions would empty the pool, the full class pool is used (a repeat
 * beats silence). The pick is stamped played immediately.
 */
export function pickOpener(lengthClass: OpenerLengthClass, excludeIds: string[] = []): PuckOpener | null {
  const pool = PUCK_OPENERS.filter(o => o.lengthClass === lengthClass);
  if (pool.length === 0) return null;

  const played = loadPlayed();
  const now = Date.now();
  const fresh = pool.filter(
    o => !excludeIds.includes(o.id) && !(played[o.id] && now - played[o.id] < ROTATION_WINDOW_MS)
  );
  const notUsedThisStart = pool.filter(o => !excludeIds.includes(o.id));
  const candidates = fresh.length > 0 ? fresh : notUsedThisStart.length > 0 ? notUsedThisStart : pool;

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  markPlayed(pick.id);
  return pick;
}
