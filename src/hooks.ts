// Browser hooks for the fresh shell: geolocation and screen wake lock.
// (Q&A is text-only by Erik's Oct 29 decision — there is deliberately
// no speech-recognition hook in this shell.)

import { useEffect, useRef, useState } from 'react';
import type { Position } from './core/tour';

export function usePosition(onPosition: (pos: Position) => void): {
  position: Position | null;
  error: string | null;
  granted: boolean;
} {
  const [position, setPosition] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);
  const cbRef = useRef(onPosition);
  cbRef.current = onPosition;

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('This device does not offer location.');
      return;
    }
    let last: GeolocationPosition | null = null;
    const watchId = navigator.geolocation.watchPosition(
      geo => {
        setGranted(true);
        setError(null);
        let heading = geo.coords.heading;
        if ((heading === null || Number.isNaN(heading)) && last) {
          // Derive a heading from the last fix when the sensor offers none.
          const dLat = geo.coords.latitude - last.coords.latitude;
          const dLng = geo.coords.longitude - last.coords.longitude;
          if (Math.abs(dLat) + Math.abs(dLng) > 0.00005) {
            heading = ((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360;
          }
        }
        last = geo;
        const pos: Position = {
          lat: geo.coords.latitude,
          lng: geo.coords.longitude,
          speedMps: geo.coords.speed !== null && geo.coords.speed >= 0 ? geo.coords.speed : 0,
          headingDeg: heading !== null && !Number.isNaN(heading) ? heading : null,
        };
        setPosition(pos);
        cbRef.current(pos);
      },
      err => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location is off for this site — Miles needs it to know where you are.'
            : 'Still looking for a location fix…',
        );
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return { position, error, granted };
}

/** Keep the screen awake during a tour; re-acquire when the page returns. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let sentinel: WakeLockSentinel | null = null;
    let released = false;
    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        /* wake lock is a nicety, never a tour blocker */
      }
    };
    void acquire();
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !released) void acquire();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
