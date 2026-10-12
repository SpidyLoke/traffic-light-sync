import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { bearingDeg, distanceM } from '../lib/geo';

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  /** Device clock when the fix arrived (ms). */
  at: number;
  speed: number | null;
  heading: number | null;
}

export type GeoStatus = 'starting' | 'active' | 'denied' | 'unavailable' | 'insecure' | 'error';

interface GeoState {
  status: GeoStatus;
  error?: string;
  fix: Fix | null;
  /** Smoothed speed, m/s. */
  speed: number | null;
  /** Last heading measured while actually moving, and when. Survives stopping at a light. */
  heading: number | null;
  headingAt: number | null;
  /** Fixes from the last 15 s. */
  recent: Fix[];
}

const Ctx = createContext<GeoState | null>(null);

export function useGeo(): GeoState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useGeo outside provider');
  return c;
}

const MOVING = 2; // m/s (~7 km/h)

export function GeoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GeoState>({
    status: 'starting',
    fix: null,
    speed: null,
    heading: null,
    headingAt: null,
    recent: [],
  });
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => {
    if (!window.isSecureContext) {
      setState((s) => ({ ...s, status: 'insecure', error: 'GPS needs HTTPS. Open the app over https://.' }));
      return;
    }
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, status: 'unavailable', error: 'This browser has no GPS access.' }));
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const c = pos.coords;
        const prev = ref.current;
        const fix: Fix = {
          lat: c.latitude,
          lng: c.longitude,
          accuracy: c.accuracy,
          at: now,
          speed: c.speed != null && isFinite(c.speed) ? c.speed : null,
          heading: c.heading != null && isFinite(c.heading) ? c.heading : null,
        };
        const recent = [...prev.recent.filter((f) => now - f.at < 15000), fix];

        // Speed: trust the GPS chip when it reports it, else derive from movement over ~3 s.
        let speed = fix.speed;
        const older = recent.find((f) => now - f.at >= 2500);
        if (speed == null && older) {
          const d = distanceM(older, fix);
          speed = d > Math.max(older.accuracy, fix.accuracy) * 0.5 ? d / ((now - older.at) / 1000) : 0;
        }
        const smoothed = speed == null ? prev.speed : prev.speed == null ? speed : prev.speed * 0.5 + speed * 0.5;

        // Heading: only meaningful while moving.
        let heading = prev.heading;
        let headingAt = prev.headingAt;
        if (speed != null && speed >= MOVING) {
          if (fix.heading != null) {
            heading = fix.heading;
            headingAt = now;
          } else if (older && distanceM(older, fix) > 8) {
            heading = bearingDeg(older, fix);
            headingAt = now;
          }
        }
        setState({ status: 'active', fix, speed: smoothed, heading, headingAt, recent });
      },
      (err) => {
        setState((s) => ({
          ...s,
          status: err.code === err.PERMISSION_DENIED ? 'denied' : 'error',
          error:
            err.code === err.PERMISSION_DENIED
              ? 'Location permission denied. Allow it in your browser settings for this site.'
              : err.message || 'GPS error',
        }));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

/** Best estimate of where you are now, averaging recent fixes while stationary. */
export function stationaryAverage(recent: Fix[], windowMs = 6000): Fix | null {
  if (!recent.length) return null;
  const last = recent[recent.length - 1];
  const pool = recent.filter((f) => last.at - f.at <= windowMs && distanceM(f, last) < 25);
  let w = 0;
  let lat = 0;
  let lng = 0;
  for (const f of pool) {
    const wi = 1 / Math.max(1, f.accuracy) ** 2;
    w += wi;
    lat += f.lat * wi;
    lng += f.lng * wi;
  }
  const acc = Math.min(...pool.map((f) => f.accuracy)) / Math.sqrt(pool.length);
  return { ...last, lat: lat / w, lng: lng / w, accuracy: Math.max(acc, 1) };
}
