export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Shared movement classification with a hysteresis band so stop-and-go
// traffic doesn't flap the app between walking and driving behavior.
// Enter driving above 6.0 m/s; only drop back below 4.5 m/s.
export const DRIVING_ENTER_MPS = 6.0;
export const DRIVING_EXIT_MPS = 4.5;
export const WALKING_SPEED_MPS = 1.4;

export function resolveMovementMode(
  speed: number | null,
  previousMode: MovementModeHysteresis
): MovementModeHysteresis {
  const s = speed ?? 0;

  if (previousMode === 'driving') {
    if (s >= DRIVING_EXIT_MPS) return 'driving';
    if (s >= WALKING_SPEED_MPS) return 'walking';
    return 'stationary';
  }

  if (s >= DRIVING_ENTER_MPS) return 'driving';
  if (s >= WALKING_SPEED_MPS) return 'walking';
  return 'stationary';
}

export type MovementModeHysteresis = 'walking' | 'driving' | 'stationary';

// A mode change only takes effect after it has held for `dwellMs`. Without
// this, one red light (or one GPS jitter) flips Leo between walking and
// driving style mid-story.
export class ModeDwellTracker {
  private current: MovementModeHysteresis;
  private candidate: MovementModeHysteresis;
  private candidateSince: number;

  constructor(initial: MovementModeHysteresis = 'stationary', private dwellMs = 8000, now = Date.now()) {
    this.current = initial;
    this.candidate = initial;
    this.candidateSince = now;
  }

  update(raw: MovementModeHysteresis, now = Date.now()): MovementModeHysteresis {
    if (raw === this.current) {
      this.candidate = raw;
      this.candidateSince = now;
      return this.current;
    }

    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = now;
      return this.current;
    }

    if (now - this.candidateSince >= this.dwellMs) {
      this.current = raw;
    }
    return this.current;
  }

  reset(initial: MovementModeHysteresis = 'stationary', now = Date.now()) {
    this.current = initial;
    this.candidate = initial;
    this.candidateSince = now;
  }

  get mode(): MovementModeHysteresis {
    return this.current;
  }
}

// Compass bearing from one point to another, degrees clockwise from north.
export function bearingDegrees(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Smallest absolute angle between two headings, always 0-180.
export function headingDelta(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

// --- Story geometry (fix stack RC-3, Oct 27, 2026) -------------------
// The freshness geometry used to be fixed constants (2000m reach,
// 180s max age, a speed-only behind ladder) sized for the SHORT
// stories of an earlier persona. Pass 2's length bands tell 75–110s
// highway stories; a gate sized for 40s stories measured against them
// drops stories that are still mid-telling — and because coverage
// was spent at generation (RC-2), every such drop burned the subject.
// The gates now scale with the two quantities that actually decide
// whether a story still describes the listener's road: how long the
// story runs, and how fast the listener is covering ground during it.

// Leo speaks ~13 chars/sec (the same rate the Q&A failsafe sizes
// from). Estimates only — they steer gates, never content.
export function estimateSpeechDurationS(text: string): number {
  return Math.min(300, Math.max(5, text.length / 13));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// How far a story's anchor may be from the listener at story START
// and still be worth telling. Driving reach grows with the distance
// the listener will cover DURING the story: a place that far ahead
// (or, by symmetry of the telling window, recently passed) is inside
// the story's moment. Floors preserve today's behavior for short
// stories; caps keep a glitchy speed from licensing cross-town tales.
export function storyReachM(
  mode: MovementModeHysteresis,
  speedMps: number,
  durationS: number
): number {
  if (mode === 'driving') return clamp(1000 + speedMps * durationS, 2000, 8000);
  if (mode === 'walking') return clamp(100 + speedMps * durationS, 150, 600);
  return clamp(30 + durationS, 60, 240);
}

// How far BEHIND the direction of travel an anchor may sit at story
// start before the story is stale. The historical speed ladder
// (1500m freeway / 600m surface / 400m driving entry) is the floor;
// a long story raises the band by the distance covered during the
// telling (×0.6 — the place only needs to stay inside the telling
// window, not at its center). Infinity below driving entry: the
// gate does not exist for walking or dwell.
export function storyBehindM(speedMps: number, durationS: number): number {
  if (speedMps < 6) return Number.POSITIVE_INFINITY;
  const ladder = speedMps >= 15 ? 1500 : speedMps >= 8 ? 600 : 400;
  return Math.min(4000, Math.max(ladder, speedMps * durationS * 0.6));
}

// How old a generated story may be at dequeue. A story's useful life
// scales with its own length: generation + queue wait may reasonably
// consume ~1.5 tellings of the story being told.
export function storyMaxAgeS(durationS: number): number {
  return clamp(90 + durationS * 1.5, 180, 600);
}

// Project a point forward along a heading — used to aim story lookups and
// prefetches at the road ahead instead of the spot underfoot.
export function offsetPositionByHeading(
  pos: { lat: number; lng: number },
  headingDegrees: number,
  distanceMeters: number
): { lat: number; lng: number } {
  const R = 6371e3;
  const bearing = (headingDegrees * Math.PI) / 180;
  const lat1 = (pos.lat * Math.PI) / 180;
  const lng1 = (pos.lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceMeters / R) +
      Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distanceMeters / R) * Math.cos(lat1),
      Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}
