import { useEffect, useState } from 'react';

/** Keep the screen on while the calling component is mounted. Re-acquires after the tab is hidden. */
export function useWakeLock(enabled = true): 'on' | 'off' | 'unsupported' {
  const [status, setStatus] = useState<'on' | 'off' | 'unsupported'>('off');
  useEffect(() => {
    if (!enabled) return;
    if (!('wakeLock' in navigator)) {
      setStatus('unsupported');
      return;
    }
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          lock.release();
          return;
        }
        setStatus('on');
        lock.addEventListener('release', () => !cancelled && setStatus('off'));
      } catch {
        setStatus('off');
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release();
    };
  }, [enabled]);
  return status;
}

/** Current time, re-rendering every `ms`. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
