import { useEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent } from 'react';
import { useUi } from '../App';
import { fmtDist } from '../lib/format';
import { feedback, prepareFeedback, type Outcome } from '../lib/feedback';
import { directionAtLight, nearestLight } from '../lib/locate';
import type { ObservationKind } from '../lib/types';
import { useData } from '../state/DataContext';
import { useGeo } from '../state/GeoContext';

// Shared capture logic and pads, used full size on Capture and compact on Predict.

export const PADS: { kind: ObservationKind; title: string; sub: string; cls: string }[] = [
  { kind: 'turnedGreen', title: 'Just turned', sub: 'GREEN', cls: 'bg-go text-on-go border-go' },
  { kind: 'alreadyGreen', title: 'Already', sub: 'green', cls: 'bg-transparent text-go border-go' },
  { kind: 'turnedRed', title: 'Just turned', sub: 'RED', cls: 'bg-stop text-on-stop border-stop' },
  { kind: 'alreadyRed', title: 'Already', sub: 'red', cls: 'bg-transparent text-stop border-stop' },
];

/** Exact time of the input event on the device clock, in ms. */
function eventTime(e: PointerEvent): number {
  const now = Date.now();
  const t = Math.round(performance.timeOrigin + e.timeStamp);
  return Math.abs(t - now) < 5000 ? t : now;
}

export interface CaptureController {
  error: { message: string; at: number } | null;
  clearError(): void;
  padProps(kind: ObservationKind): ButtonHTMLAttributes<HTMLButtonElement> & { ref: (el: HTMLButtonElement | null) => void };
  ripples(kind: ObservationKind): { id: number; x: number; y: number }[];
  removeRipple(id: number): void;
}

export function useCapture(): CaptureController {
  const data = useData();
  const geo = useGeo();
  const { dirOverride, pushRecent } = useUi();
  const [error, setError] = useState<{ message: string; at: number } | null>(null);
  const lastTap = useRef<{ kind: ObservationKind; t: number } | null>(null);
  // A press only counts when the finger lifts without having scrolled or dragged away.
  // Its time is still taken from the moment the finger went down.
  const pending = useRef<{ kind: ObservationKind; pointerId: number; t: number; x: number; y: number } | null>(null);
  const pads = useRef<Partial<Record<ObservationKind, HTMLButtonElement | null>>>({});
  const [ripples, setRipples] = useState<{ id: number; kind: ObservationKind; x: number; y: number }[]>([]);
  const rippleSeq = useRef(0);
  // Sound and haptics must run inside the tap's click event (iOS ignores them elsewhere),
  // so the outcome decided on release is held here until that click arrives.
  const outcome = useRef<Outcome | null>(null);
  const flushFeedback = () => {
    if (outcome.current) feedback(outcome.current);
    outcome.current = null;
  };

  useEffect(prepareFeedback, []);

  const { lights, roads, settings } = data;

  const reject = (kind: ObservationKind, message: string, result: Outcome) => {
    outcome.current = result;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pads.current[kind]?.animate(
      reduce
        ? [{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }]
        : [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-0.375rem)' },
            { transform: 'translateX(0.375rem)' },
            { transform: 'translateX(-0.25rem)' },
            { transform: 'translateX(0)' },
          ],
      { duration: 280, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' },
    );
    setError({ message, at: Date.now() });
  };

  const confirmTap = (kind: ObservationKind, x: number, y: number) => {
    outcome.current = 'accepted';
    const id = ++rippleSeq.current;
    setRipples((r) => [...r, { id, kind, x, y }]);
  };

  const tap = async (kind: ObservationKind, t: number, x: number, y: number) => {
    if (lastTap.current && lastTap.current.kind === kind && t - lastTap.current.t < 1200) return; // double tap
    lastTap.current = { kind, t };
    if (!lights.length) return reject(kind, 'No lights registered yet. Add them on the Lights tab first.', 'error');
    const f = geo.fix;
    if (!f || t - f.at > 10000) return reject(kind, 'No recent GPS fix. Not saved.', 'error');
    const s = nearestLight(lights, roads, f);
    if (!s) return reject(kind, 'No lights registered yet.', 'error');
    if (s.distance > settings.snapRadiusM) {
      return reject(
        kind,
        `Too far from any light: nearest is ${s.light.name}, ${fmtDist(s.distance)} away (limit ${settings.snapRadiusM} m). Not saved.`,
        'declined',
      );
    }
    const d = directionAtLight(s, f, geo.heading, geo.headingAt, t, dirOverride);
    setError(null);
    confirmTap(kind, x, y);
    const o = await data.addObservation({
      lightId: s.light.id,
      direction: d.dir,
      kind,
      t,
      lat: f.lat,
      lng: f.lng,
      accuracy: f.accuracy,
      heading: geo.heading,
      speed: geo.speed,
      distanceM: Math.round(s.distance * 10) / 10,
    });
    pushRecent(o.id);
  };

  return {
    error,
    clearError: () => setError(null),
    ripples: (kind) => ripples.filter((r) => r.kind === kind),
    removeRipple: (id) => setRipples((rs) => rs.filter((x) => x.id !== id)),
    padProps: (kind) => ({
      ref: (el) => {
        pads.current[kind] = el;
      },
      onPointerDown: (e) => {
        outcome.current = null;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const r = e.currentTarget.getBoundingClientRect();
        pending.current = { kind, pointerId: e.pointerId, t: eventTime(e), x: e.clientX - r.left, y: e.clientY - r.top };
      },
      onPointerMove: (e) => {
        const p = pending.current;
        if (!p || p.pointerId !== e.pointerId) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (Math.hypot(e.clientX - r.left - p.x, e.clientY - r.top - p.y) > 10) pending.current = null; // scrolling or dragging away
      },
      onPointerCancel: () => {
        pending.current = null;
      },
      onPointerUp: (e) => {
        const p = pending.current;
        pending.current = null;
        if (p && p.pointerId === e.pointerId && p.kind === kind) tap(kind, p.t, p.x, p.y);
      },
      onClick: (e) => {
        // Keyboard activation (Enter/Space) arrives as a click with no pointer.
        if (e.detail === 0) {
          const r = e.currentTarget.getBoundingClientRect();
          tap(kind, Date.now(), r.width / 2, r.height / 2);
        }
        flushFeedback();
      },
      onContextMenu: (e) => e.preventDefault(),
    }),
  };
}

/** The four capture buttons: a 2×2 grid on Capture, one short row (`compact`) on Predict. */
export function CapturePads({ capture, compact = false }: { capture: CaptureController; compact?: boolean }) {
  return (
    <div
      className={`grid ${compact ? 'grid-cols-4 gap-1.5' : 'grid-cols-2 gap-3'}`}
      style={compact ? undefined : { height: 'min(50vh, 27.5rem)', minHeight: '17.5rem' }}
    >
      {PADS.map((b) => (
        <button
          key={b.kind}
          type="button"
          aria-label={`${b.title} ${b.sub}`}
          {...capture.padProps(b.kind)}
          className={`relative flex select-none flex-col items-center justify-center overflow-hidden press-fast ${
            compact ? 'min-h-15 rounded-xl border-[3px] px-1 py-1.5' : 'rounded-3xl border-4'
          } ${b.cls}`}
        >
          {capture.ripples(b.kind).map((r) => (
            <span
              key={r.id}
              aria-hidden
              className="tap-ripple"
              style={{ left: r.x, top: r.y }}
              onAnimationEnd={() => capture.removeRipple(r.id)}
            />
          ))}
          <span className={`relative font-bold ${compact ? 'text-xs leading-none' : 'text-xl leading-tight'}`}>{b.title}</span>
          <span className={`t-hero relative font-black ${compact ? 'mt-1 text-lg' : 'text-4xl'}`}>{b.sub}</span>
        </button>
      ))}
    </div>
  );
}
