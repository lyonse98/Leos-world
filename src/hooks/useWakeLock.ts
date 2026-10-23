import { useEffect, useRef, useState } from 'react';

interface WakeLockSentinel {
  released: boolean;
  type: 'screen';
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

type NavigatorWithWakeLock = Omit<Navigator, 'wakeLock'> & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinel>;
  };
};

export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const nav = navigator as NavigatorWithWakeLock;
    setSupported(typeof nav.wakeLock !== 'undefined' && nav.wakeLock !== undefined);
  }, []);

  useEffect(() => {
    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock) return;

    let cancelled = false;

    const requestLock = async () => {
      try {
        const sentinel = await nav.wakeLock!.request('screen');
        if (cancelled) {
          await sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null;
        });
      } catch (err) {
        console.warn('Wake Lock request failed:', err);
      }
    };

    if (active && document.visibilityState === 'visible') {
      requestLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && active && !sentinelRef.current) {
        requestLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinelRef.current) {
        sentinelRef.current.release();
        sentinelRef.current = null;
      }
    };
  }, [active]);

  return { supported };
}
