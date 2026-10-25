// Quota circuit breaker (Oct 25, 2026).
//
// Erik's Gemini quotas, read from his console: the TTS model allows
// 10 requests/minute and only 100 requests/day; text models carry their
// own separate limits. Yesterday's field failure was the daily TTS cap:
// once it is gone, every further synthesis fails until midnight PT — and
// the old code retried quota errors, burning the scarcest resource on
// requests that could not succeed.
//
// The breaker is keyed per lane AND per model, because Gemini quotas are
// per-model: a capped Q&A model must not block the flagship story model,
// and a TTS wall must not stop text generation. When a key sees a 429 it
// trips: callers check isTripped() and skip the API call entirely,
// serving cache instead. Cooldowns escalate on a ladder — a per-minute
// burst clears in minutes; repeated trips inside a few hours mean the
// daily cap is the likely wall, so the key stays quiet for an hour at a
// time rather than probing the wall (and spending requests) repeatedly.

import { analytics } from './analytics';

export type QuotaLane = 'text' | 'tts';

const COOLDOWN_LADDER_MS = [120_000, 900_000, 3_600_000]; // 2 min, 15 min, 60 min
const LADDER_WINDOW_MS = 3 * 3_600_000; // trips within 3h escalate the ladder

interface KeyState {
  trippedUntil: number;
  tripTimes: number[];
}

const states = new Map<string, KeyState>();

function keyFor(lane: QuotaLane, model?: string): string {
  return model ? `${lane}:${model}` : lane;
}

function stateFor(lane: QuotaLane, model?: string): KeyState {
  const key = keyFor(lane, model);
  let state = states.get(key);
  if (!state) {
    state = { trippedUntil: 0, tripTimes: [] };
    states.set(key, state);
  }
  return state;
}

function isQuotaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
}

export const quotaGuard = {
  isQuotaError,

  /** Record a quota failure for a lane+model and open its circuit. */
  trip(lane: QuotaLane, model?: string): void {
    const now = Date.now();
    const state = stateFor(lane, model);
    state.tripTimes = state.tripTimes.filter(t => now - t < LADDER_WINDOW_MS);
    state.tripTimes.push(now);
    const step = Math.min(state.tripTimes.length - 1, COOLDOWN_LADDER_MS.length - 1);
    const cooldown = COOLDOWN_LADDER_MS[step];
    state.trippedUntil = Math.max(state.trippedUntil, now + cooldown);
    console.warn(
      `[QuotaGuard] ${keyFor(lane, model)} tripped (trip #${state.tripTimes.length} in window) — quiet for ${Math.round(cooldown / 1000)}s`
    );
    // Observational only: count the trip for the daily rollup — trip
    // frequency is the Tier-1 pain metric. Wrapped so instrumentation
    // can never interfere with the breaker itself.
    try {
      analytics.track('quota_tripped', null, undefined, { model: model ?? '', source: lane, lane });
    } catch { /* a metric must never break a trip */ }
  },

  isTripped(lane: QuotaLane, model?: string): boolean {
    return Date.now() < stateFor(lane, model).trippedUntil;
  },

  remainingMs(lane: QuotaLane, model?: string): number {
    return Math.max(0, stateFor(lane, model).trippedUntil - Date.now());
  },
};
