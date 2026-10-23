import { useState, useEffect, useCallback, useRef } from 'react';
import {
  calculateDistance,
  resolveMovementMode,
  MovementModeHysteresis,
  ModeDwellTracker,
} from '../utils/geo';

export interface Position {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  accuracy: number;
}

export type MovementMode = MovementModeHysteresis;

const MODE_INTERVALS: Record<MovementMode, number> = {
  walking: 10,
  driving: 45,
  stationary: 30,
};

// GPS signal hygiene: reject true teleports and dead fixes without
// starving updates in urban canyons.
const MAX_SPEED_MPS = 38;           // ~85 mph — reject positions claiming faster
const MAX_ACCURACY_M = 150;         // reject wildly inaccurate fixes only
const MEDIAN_WINDOW = 3;            // median-of-3 coordinate smoothing
const LOW_PASS_ALPHA = 0.45;        // weight for the new fix in the smoothed blend

class GpsFilter {
  private window: Position[] = [];
  private smoothed: Position | null = null;

  reset() {
    this.window = [];
    this.smoothed = null;
  }

  filter(raw: Position): Position | null {
    if (raw.speed !== null && raw.speed > MAX_SPEED_MPS) return null;
    if (raw.accuracy > MAX_ACCURACY_M) return null;

    this.window.push(raw);
    if (this.window.length > MEDIAN_WINDOW) this.window.shift();

    const median = this.medianOfWindow();
    if (!median) return null;

    if (!this.smoothed || calculateDistance(this.smoothed.lat, this.smoothed.lng, median.lat, median.lng) > 100) {
      // First fix, or a genuine large jump — snap instead of smoothing
      this.smoothed = { ...median };
      return { ...this.smoothed };
    }

    this.smoothed = {
      lat: LOW_PASS_ALPHA * median.lat + (1 - LOW_PASS_ALPHA) * this.smoothed.lat,
      lng: LOW_PASS_ALPHA * median.lng + (1 - LOW_PASS_ALPHA) * this.smoothed.lng,
      heading: median.heading,
      speed: median.speed,
      accuracy: Math.max(median.accuracy, this.smoothed.accuracy * 0.9),
    };
    return { ...this.smoothed };
  }

  private medianOfWindow(): Position | null {
    if (this.window.length === 0) return null;
    const lats = this.window.map(p => p.lat).sort((a, b) => a - b);
    const lngs = this.window.map(p => p.lng).sort((a, b) => a - b);
    const mid = Math.floor(this.window.length / 2);
    const medianLat = lats[mid];
    const medianLng = lngs[mid];
    // Pick the actual sample closest to the median point to keep heading/speed/accuracy coherent
    let best = this.window[0];
    let bestDist = Infinity;
    for (const p of this.window) {
      const d = calculateDistance(medianLat, medianLng, p.lat, p.lng);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }
}

const gpsFilter = new GpsFilter();

export const useGeolocation = () => {
  const [position, setPosition] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [movementMode, setMovementMode] = useState<MovementMode>('stationary');
  const watchIdRef = useRef<number | null>(null);
  const lastTriggerTimeRef = useRef<number | null>(null);
  const lastPositionRef = useRef<Position | null>(null);
  const lastPositionTimeRef = useRef<number>(0);
  const movementModeRef = useRef<MovementMode>('stationary');
  const onIntervalCallbackRef = useRef<((position: Position) => void) | null>(null);
  const dwellTrackerRef = useRef<ModeDwellTracker>(new ModeDwellTracker('stationary'));

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    const rawPosition: Position = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      accuracy: pos.coords.accuracy,
    };

    const filtered = gpsFilter.filter(rawPosition);
    if (!filtered) {
      console.log('[GPS] Rejected erratic fix (teleport or bad accuracy)');
      return;
    }

    const secondsSinceLastFix = lastPositionTimeRef.current > 0
      ? (Date.now() - lastPositionTimeRef.current) / 1000
      : 0;
    const rawMode = inferMode(filtered.speed, lastPositionRef.current, filtered, secondsSinceLastFix, movementModeRef.current);
    // A mode flip only sticks once it has held for ~8s, so a red light
    // or a bad fix doesn't change how Leo talks mid-story.
    const mode = dwellTrackerRef.current.update(rawMode);
    movementModeRef.current = mode;
    setMovementMode(mode);
    lastPositionRef.current = filtered;
    lastPositionTimeRef.current = Date.now();

    setPosition(filtered);

    const currentTime = Date.now();
    const intervalSeconds = MODE_INTERVALS[mode];

    if (lastTriggerTimeRef.current) {
      const elapsedSeconds = (currentTime - lastTriggerTimeRef.current) / 1000;

      if (elapsedSeconds >= intervalSeconds && onIntervalCallbackRef.current) {
        onIntervalCallbackRef.current(filtered);
        lastTriggerTimeRef.current = currentTime;
      }
    } else {
      lastTriggerTimeRef.current = currentTime;
      if (onIntervalCallbackRef.current) {
        onIntervalCallbackRef.current(filtered);
      }
    }
  }, []);

  const handleError = useCallback((err: GeolocationPositionError) => {
    let errorMessage = 'Unable to retrieve your location.';

    switch (err.code) {
      case err.PERMISSION_DENIED:
        errorMessage = 'I need your location to give you the tour. Please enable it in your browser settings.';
        break;
      case err.POSITION_UNAVAILABLE:
        errorMessage = 'Location information is unavailable.';
        break;
      case err.TIMEOUT:
        errorMessage = 'The request to get user location timed out.';
        break;
    }

    setError(errorMessage);
    setIsTracking(false);
  }, []);

  const beginWatch = useCallback(() => {
    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    };

    watchIdRef.current = navigator.geolocation.watchPosition(handlePosition, handleError, options);
  }, [handlePosition, handleError]);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }

    setIsTracking(true);
    setError(null);
    gpsFilter.reset();
    dwellTrackerRef.current.reset('stationary');
    setMovementMode('stationary');
    movementModeRef.current = 'stationary';
    lastTriggerTimeRef.current = null;

    beginWatch();
  }, [beginWatch]);

  // Mobile browsers routinely kill a position watch while the page is hidden.
  // Restarting it on return is cheap and is the difference between a tour that
  // resumes and one that is silently stuck on a stale position.
  const restartTracking = useCallback(() => {
    if (!navigator.geolocation) return;

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    gpsFilter.reset();
    lastPositionTimeRef.current = 0;
    lastTriggerTimeRef.current = null;
    setError(null);
    setIsTracking(true);

    beginWatch();
  }, [beginWatch]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
  }, []);

  const setOnInterval = useCallback((callback: (position: Position) => void) => {
    onIntervalCallbackRef.current = callback;
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return {
    position,
    error,
    isTracking,
    movementMode,
    startTracking,
    restartTracking,
    stopTracking,
    setOnInterval,
  };
};

function inferMode(
  speed: number | null,
  lastPos: Position | null,
  currentPos: Position,
  secondsSinceLastFix: number,
  previousMode: MovementMode
): MovementMode {
  if (speed !== null && speed > 0) {
    return resolveMovementMode(speed, previousMode);
  }
  if (lastPos && secondsSinceLastFix > 0) {
    const dist = calculateDistance(lastPos.lat, lastPos.lng, currentPos.lat, currentPos.lng);
    const derivedSpeed = dist / secondsSinceLastFix;
    return resolveMovementMode(derivedSpeed, previousMode);
  }
  return resolveMovementMode(0, previousMode);
}
