import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Rotating pre-rendered Puck stall phrases (Oct 26, 2026).
//
// When a location story's synthesis runs long INSIDE the player (the
// story was not pre-synthesized in time), one of these short stored
// clips bides the wait so the listener never sits in uncovered silence.
// They replace the device-voice runway bridge ("Hang on — let me get
// my bearings here.") — Erik's ruling: bearings language belongs to
// the intro period (the canned welcome already closes with "Now let
// me get my bearings."); mid-tour stalls are Leo's own voice, stored,
// with character.
//
// Production mirrors the openers exactly: synthesized OFFLINE with the
// library's Batch TTS pattern (scripts/library/build-stall-phrases.mjs),
// stored in the tts-audio bucket under stall-phrases/, played from the
// public URL. Playback spends no synthesis quota and waits on nothing.
//
// Rotation mirrors the openers' persistence: ids played within the
// last 7 days are excluded while any fresher phrase remains, and ids
// are stamped at selection time. On top of that, a phrase NEVER
// repeats within a single tour (module-level session set) — if the
// whole set has cycled inside one tour, no phrase fires at all; a
// repeat would be worse than a few seconds of quiet. If a clip fails
// to load or play, the bridge simply doesn't fire, for the same
// reason: silence beats the wrong voice here.
// ---------------------------------------------------------------------------

export interface StallPhrase {
  id: string;
  path: string; // object key inside the tts-audio bucket
  durationSec: number;
  transcript: string;
}

// Manifest — durations measured from the rendered WAVs at build time
// (scripts/library/build-stall-phrases.mjs). Transcripts are the exact
// texts synthesized; Erik reviews by ear.
export const STALL_PHRASES: StallPhrase[] = [
  {
    id: 'worth-it',
    path: 'stall-phrases/worth-it.wav',
    durationSec: 3.7,
    transcript: "Give me a moment — this next one's worth getting right.",
  },
  {
    id: 'digging',
    path: 'stall-phrases/digging.wav',
    durationSec: 3.3,
    transcript: "One second — I'm digging out the good version of this one.",
  },
  {
    id: 'hold-on',
    path: 'stall-phrases/hold-on.wav',
    durationSec: 3.1,
    transcript: "Hold on — I'd rather tell this properly than rush it.",
  },
  {
    id: 'brewing',
    path: 'stall-phrases/brewing.wav',
    durationSec: 3.8,
    transcript: "Just a breath — something good is coming together back there.",
  },
  {
    id: 'wait-for-it',
    path: 'stall-phrases/wait-for-it.wav',
    durationSec: 4.0,
    transcript: "Wait for it — no, really. This one earns the pause.",
  },
  {
    id: 'lining-up',
    // v2 (Oct 26 closing pass): re-voiced without the promised
    // duration ("Three more seconds" broke the honesty contract —
    // no small-talk exceptions). The bucket is insert-only, so the
    // new take lives at a v2 key; the original stays orphaned at
    // stall-phrases/lining-up.wav.
    path: 'stall-phrases/lining-up-v2.wav',
    durationSec: 4.4,
    transcript: "One more drawer — I'm lining up the story this street deserves.",
  },
  {
    id: 'shoes-on',
    path: 'stall-phrases/shoes-on.wav',
    durationSec: 3.5,
    transcript: "Almost there — the next story's still putting its shoes on.",
  },
];

const PLAYED_KEY = 'leo_stall_phrases_played';
const ROTATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — same window as the openers

// Ids already played during this app session (one tour's lifetime in
// practice): an absolute exclusion, so a phrase can never repeat
// within a tour no matter how often the stall trigger fires.
const playedThisSession = new Set<string>();

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
  playedThisSession.add(id);
  try {
    const played = loadPlayed();
    played[id] = Date.now();
    localStorage.setItem(PLAYED_KEY, JSON.stringify(played));
  } catch {
    // storage unavailable — session rotation still applies
  }
}

/** Public URL for a manifest entry (the bucket serves opener audio the same way). */
export function stallPhraseAudioUrl(phrase: StallPhrase): string {
  return supabase.storage.from('tts-audio').getPublicUrl(phrase.path).data.publicUrl;
}

/**
 * Pick the next stall phrase: never one already played this session;
 * among the rest, prefer ids outside the 7-day rotation window. If
 * every phrase has played this session, returns null — the bridge
 * stays silent rather than repeating (Erik's doctrine for this slot).
 * The pick is stamped played immediately.
 */
export function pickStallPhrase(): StallPhrase | null {
  const unusedThisSession = STALL_PHRASES.filter(p => !playedThisSession.has(p.id));
  if (unusedThisSession.length === 0) return null;

  const played = loadPlayed();
  const now = Date.now();
  const fresh = unusedThisSession.filter(
    p => !(played[p.id] && now - played[p.id] < ROTATION_WINDOW_MS)
  );
  const candidates = fresh.length > 0 ? fresh : unusedThisSession;

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  markPlayed(pick.id);
  return pick;
}
