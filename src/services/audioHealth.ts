// Audio-health circuit breaker (Area B, Oct 26, 2026) — the playback-side
// sibling of quotaGuard, built against the Oct 26 test drive's evidence:
// 81 "audio error" diagnostics in 35 minutes, stories settling
// engine='none' after 3 attempts minutes apart, and a queue that kept
// spending its one waiting slot re-trying items the speaker could not
// play. In that storm, retries were not a cure — they were the cost:
// quota burned, queue position burned, and the banked material that
// could have carried the tour waited behind the retries.
//
// The breaker watches CONSECUTIVE playback failures (audio element
// errors, play() rejections, browser-voice errors, speech that never
// begins). A success resets the count. At the threshold the breaker
// opens for a short cooldown (escalating on repeat trips inside a few
// hours, like the quota ladder): while open, the player economy changes
// — a failing item gets ONE attempt before it surrenders and frees the
// queue, and pre-synthesis of live items pauses rather than warming
// audio the speaker currently cannot play. Banked material (library
// entries with pre-made audio, cached stories) is untouched by the
// economy change beyond that same single-attempt rule: it remains the
// fastest available sound, which is the point — fail FAST toward it.
//
// PER-ENGINE STREAKS (fix stack RC-6, Oct 27, 2026): the streak used
// to be global — Gemini TTS failures tripped the browser-voice lane
// and vice versa, so one sick engine poisoned the healthy fallback
// that was supposed to carry the tour. Each engine now keeps its own
// streak, ladder, and cooldown:
//   - preferBanked() means specifically "the GEMINI engine is
//     tripped" — the serve layer's signal to stop spending live
//     generations whose audio cannot sound, and serve banked.
//   - anyTripped() is the player-economy signal (one attempt per
//     item while ANY engine is in a storm).

import { trackDiag } from './analytics';

export type AudioEngine = 'gemini' | 'browser';

const TRIP_THRESHOLD = 3;
const BASE_COOLDOWN_MS = 90_000;
const MAX_COOLDOWN_MS = 600_000;
const LADDER_WINDOW_MS = 3 * 3_600_000; // trips within 3h escalate, like quotaGuard

interface EngineState {
  failures: number;
  trippedUntil: number;
  tripTimes: number[];
  recoveryNoted: boolean;
}

const freshState = (): EngineState => ({
  failures: 0,
  trippedUntil: 0,
  tripTimes: [],
  recoveryNoted: true,
});

const engines: Record<AudioEngine, EngineState> = {
  gemini: freshState(),
  browser: freshState(),
};

function observeRecovery(engine: AudioEngine): void {
  const s = engines[engine];
  const now = Date.now();
  if (s.trippedUntil > 0 && now >= s.trippedUntil && !s.recoveryNoted) {
    s.recoveryNoted = true;
    s.failures = 0;
    trackDiag('playback', 'audio-breaker-recovered', `${engine} audio-health cooldown elapsed — normal attempt economy restored for that engine`);
  }
}

function engineTripped(engine: AudioEngine): boolean {
  observeRecovery(engine);
  return Date.now() < engines[engine].trippedUntil;
}

export const audioHealth = {
  /** One playback failure on ONE engine. That engine's successes reset its streak. */
  recordFailure(engine: AudioEngine): void {
    const s = engines[engine];
    s.failures++;
    const now = Date.now();
    if (s.failures < TRIP_THRESHOLD || now < s.trippedUntil) return;
    s.tripTimes = s.tripTimes.filter(t => now - t < LADDER_WINDOW_MS);
    s.tripTimes.push(now);
    const cooldown = Math.min(
      BASE_COOLDOWN_MS * 2 ** (s.tripTimes.length - 1),
      MAX_COOLDOWN_MS
    );
    s.trippedUntil = now + cooldown;
    s.recoveryNoted = false;
    trackDiag(
      'playback',
      'audio-breaker-trip',
      `${engine}: ${TRIP_THRESHOLD}+ consecutive playback failures — that engine's storm economy for ${Math.round(cooldown / 1000)}s (the other engine is unaffected)`
    );
  },

  /** Audio demonstrably sounded on this engine — its failure streak is over. */
  recordSuccess(engine: AudioEngine): void {
    engines[engine].failures = 0;
  },

  /** True while a specific engine's breaker is open. */
  isEngineTripped(engine: AudioEngine): boolean {
    return engineTripped(engine);
  },

  /** True while ANY engine's breaker is open (player attempt economy). */
  anyTripped(): boolean {
    return engineTripped('gemini') || engineTripped('browser');
  },

  /**
   * True while the GEMINI playback engine is tripped — the serve
   * layer's signal to prefer banked material over live generation
   * (a live story's audio would have to sound through the tripped
   * engine). Browser-engine trouble does NOT set this: the device
   * voice failing says nothing about Gemini TTS.
   */
  preferBanked(): boolean {
    return engineTripped('gemini');
  },

  remainingMs(engine?: AudioEngine): number {
    if (engine) return Math.max(0, engines[engine].trippedUntil - Date.now());
    return Math.max(
      0,
      engines.gemini.trippedUntil - Date.now(),
      engines.browser.trippedUntil - Date.now()
    );
  },
};
