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
