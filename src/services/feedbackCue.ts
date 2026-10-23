// Confirmation tones for rating a story.
//
// A rating is given by someone whose eyes are on the road, so the confirmation
// cannot be something they have to look down to see. A short tone says "that
// landed" without interrupting the story that is still playing — which a spoken
// confirmation would do, since Leo's own voice is busy.
//
// The shapes are deliberately distinct from each other so the listener learns
// them in a few uses: a rising pair means "enjoyed", a falling pair means "not
// for me", and a single flat note means "undone".

let ctx: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

function tone(audio: AudioContext, frequency: number, startOffset: number, duration: number): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = 'sine';
  osc.frequency.value = frequency;

  const start = audio.currentTime + startOffset;
  // Ramped rather than switched on and off — a square edge on a sine is an
  // audible click, which on a car stereo sounds like a fault.
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.09, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export type FeedbackCue = 'enjoyed' | 'not-for-me' | 'undone' | 'unavailable';

export function playFeedbackCue(cue: FeedbackCue): void {
  const audio = ensureContext();
  if (!audio) return;

  // Tones only make sense once the graph is running. Outside a gesture the
  // context starts suspended, and resuming it here would be a no-op that
  // silently drops the cue — the visual feedback still carries it.
  if (audio.state === 'suspended') {
    audio.resume().catch(() => {});
  }

  switch (cue) {
    case 'enjoyed':
      tone(audio, 587.33, 0, 0.12);
      tone(audio, 880, 0.1, 0.16);
      break;
    case 'not-for-me':
      tone(audio, 440, 0, 0.12);
      tone(audio, 293.66, 0.1, 0.18);
      break;
    case 'undone':
      tone(audio, 392, 0, 0.16);
      break;
    case 'unavailable':
      tone(audio, 220, 0, 0.1);
      tone(audio, 220, 0.14, 0.1);
      break;
  }
}
