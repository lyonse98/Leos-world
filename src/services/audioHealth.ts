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

import { trackDiag } from './analytics';

const TRIP_THRESHOLD = 3;
const BASE_COOLDOWN_MS = 90_000;
const MAX_COOLDOWN_MS = 600_000;
const LADDER_WINDOW_MS = 3 * 3_600_000; // trips within 3h escalate, like quotaGuard

let consecutiveFailures = 0;
let trippedUntil = 0;
let tripTimes: number[] = [];
let recoveryNoted = true;

export const audioHealth = {
  /** One playback failure on any engine. Successes reset the streak. */
  recordFailure(): void {
    consecutiveFailures++;
    const now = Date.now();
    if (consecutiveFailures < TRIP_THRESHOLD || now < trippedUntil) return;
    tripTimes = tripTimes.filter(t => now - t < LADDER_WINDOW_MS);
    tripTimes.push(now);
    const cooldown = Math.min(
      BASE_COOLDOWN_MS * 2 ** (tripTimes.length - 1),
      MAX_COOLDOWN_MS
    );
    trippedUntil = now + cooldown;
    recoveryNoted = false;
    trackDiag(
      'playback',
      'audio-breaker-trip',
      `${TRIP_THRESHOLD}+ consecutive playback failures — storm economy for ${Math.round(cooldown / 1000)}s (one attempt per item, live pre-synthesis paused)`
    );
  },

  /** Audio demonstrably sounded — the failure streak is over. */
  recordSuccess(): void {
    consecutiveFailures = 0;
  },

  /**
   * True while the storm economy applies. Recovery is observed (once)
   * by the first check that finds the cooldown elapsed, like quotaGuard.
   */
  preferBanked(): boolean {
    const now = Date.now();
    if (trippedUntil > 0 && now >= trippedUntil && !recoveryNoted) {
      recoveryNoted = true;
      consecutiveFailures = 0;
      trackDiag('playback', 'audio-breaker-recovered', 'audio-health cooldown elapsed — normal attempt economy restored');
    }
    return now < trippedUntil;
  },

  remainingMs(): number {
    return Math.max(0, trippedUntil - Date.now());
  },
};
