import { bandFor } from './bands';
import { fitSignal, type Fit, type FitObservation, type FitOptions } from './model/fit';
import type { Direction, Observation, Settings, TimeBand } from './types';

// A "signal" is one light seen from one direction of travel. Each signal gets an
// independent model per time band.

export const ALL_BANDS = '__all__';

export const signalKey = (lightId: string, dir: Direction) => `${lightId}|${dir}`;
export const fitKey = (lightId: string, dir: Direction, bandId: string) => `${lightId}|${dir}|${bandId}`;

export function fitOptions(s: Settings): FitOptions {
  return { minCycle: s.minCycleS, maxCycle: s.maxCycleS, step: s.cycleStepS, tolerance: s.toleranceS };
}

export function toFitObs(o: Observation, s: Settings): FitObservation {
  const lag = o.kind === 'turnedGreen' || o.kind === 'turnedRed' ? s.reactionLagS : 0;
  return { id: o.id, kind: o.kind, t: o.t / 1000 - lag };
}

const cache = new Map<string, { sig: string; fit: Fit }>();

function cachedFit(key: string, obs: Observation[], s: Settings): Fit {
  const opt = fitOptions(s);
  const sig = `${JSON.stringify(opt)}|${s.reactionLagS}|${obs.map((o) => `${o.id}:${o.t}:${o.kind}`).join(',')}`;
  const hit = cache.get(key);
  if (hit && hit.sig === sig) return hit.fit;
  const fit = fitSignal(
    obs.map((o) => toFitObs(o, s)),
    opt,
  );
  cache.set(key, { sig, fit });
  return fit;
}

/** Observations usable for fitting: live, with a known direction. */
export function groupObservations(observations: Observation[], bands: TimeBand[]) {
  const groups = new Map<string, Observation[]>();
  for (const o of observations) {
    if (o.deletedAt || !o.direction) continue;
    const key = fitKey(o.lightId, o.direction, bandFor(bands, o.t).id);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(o);
  }
  return groups;
}

export function getFit(
  groups: Map<string, Observation[]>,
  lightId: string,
  dir: Direction,
  bandId: string,
  s: Settings,
): Fit {
  const key = fitKey(lightId, dir, bandId);
  return cachedFit(key, groups.get(key) ?? [], s);
}

/** A fit across every band, for comparison in the debug view. */
export function getCombinedFit(observations: Observation[], lightId: string, dir: Direction, s: Settings): Fit {
  const obs = observations.filter((o) => !o.deletedAt && o.lightId === lightId && o.direction === dir);
  return cachedFit(fitKey(lightId, dir, ALL_BANDS), obs, s);
}
