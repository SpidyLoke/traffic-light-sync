import { mod, type Fit } from './fit';

export type LightState = 'green' | 'red' | 'turningGreen' | 'turningRed' | 'unknown';

export interface StateAt {
  state: LightState;
  /** The next definite change. */
  changeTo: 'green' | 'red';
  /** Seconds until the next change, as a range (the model's uncertainty). */
  inMin: number;
  inMax: number;
  /** Timing uncertainty (± s) at this moment. */
  uncertainty: number;
  /** True when drift since the last anchor makes the prediction worthless. */
  stale: boolean;
}

/** ± seconds of timing uncertainty at time t (epoch s). Grows with distance from the last anchor. */
export function uncertaintyAt(fit: Fit, t: number): number {
  const base = Math.max(0.7, 2 * (fit.rms ?? 0));
  const cycles = Math.abs(t - (fit.lastAnchor ?? t)) / (fit.cycle ?? 1);
  return base + cycles * (fit.cycleUncertainty ?? 0);
}

export function predictAt(fit: Fit, tMs: number): StateAt | null {
  if (fit.status !== 'ok' || fit.cycle == null || fit.offset == null || !fit.greenRange) return null;
  const t = tMs / 1000;
  const C = fit.cycle;
  const u = uncertaintyAt(fit, t);
  const [gLo, gHi] = fit.greenRange;
  if (u > C / 4) {
    return { state: 'unknown', changeTo: 'green', inMin: 0, inMax: 0, uncertainty: u, stale: true };
  }
  const p = mod(t - fit.offset, C);
  const common = { uncertainty: u, stale: false };
  if (p < u) return { ...common, state: 'turningGreen', changeTo: 'red', inMin: Math.max(0, gLo - p - u), inMax: gHi - p + u };
  if (p > C - u) return { ...common, state: 'turningGreen', changeTo: 'green', inMin: 0, inMax: C - p + u };
  if (p < gLo - u) return { ...common, state: 'green', changeTo: 'red', inMin: gLo - p - u, inMax: gHi - p + u };
  if (p <= gHi + u) return { ...common, state: 'turningRed', changeTo: 'red', inMin: 0, inMax: gHi + u - p };
  return { ...common, state: 'red', changeTo: 'green', inMin: Math.max(0, C - p - u), inMax: C - p + u };
}

export function formatCountdown(s: StateAt): string {
  if (s.stale) return '—';
  const width = s.inMax - s.inMin;
  if (width <= 2.5) return `${Math.max(0, Math.round((s.inMin + s.inMax) / 2))} s`;
  return `${Math.max(0, Math.floor(s.inMin))}–${Math.ceil(s.inMax)} s`;
}

export const STATE_LABEL: Record<LightState, string> = {
  green: 'GREEN',
  red: 'RED',
  turningGreen: 'CHANGING → GREEN',
  turningRed: 'CHANGING → RED',
  unknown: 'UNKNOWN',
};
