// Rolling latency model for adaptive look-ahead (Area D, Oct 26, 2026).
//
// The old discovery/prefetch geometry aimed at a FIXED ~90-second
// horizon around the CURRENT position. The Oct 26 drive's measured
// reality: fetch+synth latency ran 40–60s on degraded cell, so a place
// discovered "now" was narrated when it was beside or BEHIND the
// listener — the geometry, not the content, was late. Erik's framing:
// it is about search radius combined with looking ahead and not behind.
//
// This module keeps rolling medians of the three numbers that decide
// where a story will actually land: how long fetching+generating text
// takes, how long synthesis takes, and how long stories sound. The
// look-ahead horizon for a fetch made while a story is playing is:
//
//   horizon = current story's remaining time + median(fetch + synth)
//
// — the moment the NEXT story can start speaking, plus the time it
// takes to have it ready. Samples are few and recent by design (a
// dozen per lane): the model tracks THIS drive's connection, not a
// lifetime average. Fallbacks are the healthy-network measurements
// (~6s fetch, ~6s synth, ~60s story) so a cold start behaves like the
// old fixed horizon until real samples land.

const MAX_SAMPLES = 12;
const FALLBACK_FETCH_S = 6;
const FALLBACK_SYNTH_S = 6;
const FALLBACK_STORY_S = 60;

const HORIZON_MIN_S = 20;
const HORIZON_MAX_S = 240;

const fetchSamples: number[] = [];
const synthSamples: number[] = [];
const storySamples: number[] = [];

function push(samples: number[], value: number): void {
  if (!Number.isFinite(value) || value <= 0) return;
  samples.push(value);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

function median(samples: number[], fallback: number): number {
  if (samples.length === 0) return fallback;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const latencyModel = {
  recordFetchText(seconds: number): void {
    push(fetchSamples, seconds);
  },

  recordSynth(seconds: number): void {
    push(synthSamples, seconds);
  },

  recordStoryDuration(seconds: number): void {
    push(storySamples, seconds);
  },

  /** Median fetch+synth latency (seconds) — the pipeline's reaction time. */
  latencyS(): number {
    return median(fetchSamples, FALLBACK_FETCH_S) + median(synthSamples, FALLBACK_SYNTH_S);
  },

  /**
   * The adaptive look-ahead horizon (seconds). While a story plays,
   * the next story cannot speak until it ends, so the horizon starts
   * at its remaining time; when the caller cannot say (a fetch inside
   * the cache layer), a mid-story estimate stands in — half the median
   * story, since fetches are typically triggered mid-play.
   */
  horizonS(currentStoryRemainingS?: number | null): number {
    const remaining =
      currentStoryRemainingS !== null && currentStoryRemainingS !== undefined
        ? Math.max(0, currentStoryRemainingS)
        : median(storySamples, FALLBACK_STORY_S) * 0.5;
    const horizon = remaining + this.latencyS();
    return Math.min(HORIZON_MAX_S, Math.max(HORIZON_MIN_S, horizon));
  },

  /** Current medians, for diagnostics and the tell-geometry joins. */
  medians(): { fetchTextS: number; synthS: number; storyS: number } {
    return {
      fetchTextS: median(fetchSamples, FALLBACK_FETCH_S),
      synthS: median(synthSamples, FALLBACK_SYNTH_S),
      storyS: median(storySamples, FALLBACK_STORY_S),
    };
  },
};
