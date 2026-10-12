// Fixed-time signal model fitting. Pure maths on clock time, no dependencies.
//
// Model: green starts at `offset + k * cycle` (any integer k) and lasts `green` seconds;
// the rest of the cycle is red (amber counts as red).
//
// Observations:
//   turnedGreen  exact anchor for green start
//   turnedRed    exact anchor for green end
//   alreadyGreen / alreadyRed  consistency checks
//
// Method: for every candidate cycle length (a 30–300 s grid, plus exact divisors of short
// gaps between anchors), find the offset and green duration that agree with the most
// observations within the reaction tolerance. The best-scoring cycle wins; ties between
// genuinely different cycles are reported as ambiguous instead of guessed.

import type { ObservationKind } from '../types';

export interface FitObservation {
  id: string;
  kind: ObservationKind;
  /** Epoch seconds, already corrected for reaction lag. */
  t: number;
}

export interface FitOptions {
  minCycle: number;
  maxCycle: number;
  step: number;
  tolerance: number;
}

export type FitStatus = 'ok' | 'insufficient' | 'ambiguous' | 'notFixedTime';
export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface ObsDetail {
  id: string;
  kind: ObservationKind;
  t: number;
  /** Seconds since the most recent green start, under the fitted model. */
  phase: number;
  /** For anchors: signed seconds from the modelled change (positive = tapped late). */
  residual?: number;
  consistent: boolean;
}

export interface Fit {
  status: FitStatus;
  message: string;
  confidence: Confidence;
  counts: { turnedGreen: number; turnedRed: number; alreadyGreen: number; alreadyRed: number; total: number };
  cycle?: number;
  /** Half-width of the range of cycle lengths that fit equally well. */
  cycleUncertainty?: number;
  /** Epoch seconds of one green start. */
  offset?: number;
  /** Best estimate of green duration. */
  green?: number;
  /** Range the green duration could be in (equal when pinned by "Just turned red" taps). */
  greenRange?: [number, number];
  greenExact?: boolean;
  /** Typical anchor error (s). */
  rms?: number;
  /** Most recent anchor time, epoch seconds. Prediction uncertainty grows with distance from it. */
  lastAnchor?: number;
  inliers?: number;
  fitFraction?: number;
  /** Other cycle lengths that explain the data equally (ambiguous) or nearly as well. */
  alternatives: { cycle: number; score: number }[];
  /** Score (share of observations explained) per grid cycle length, for the debug chart. */
  curve: { cycle: number; score: number }[];
  details: ObsDetail[];
}

export const mod = (a: number, n: number) => ((a % n) + n) % n;
/** Signed difference wrapped into (-C/2, C/2]. */
const sdiff = (a: number, C: number) => {
  const m = mod(a, C);
  return m > C / 2 ? m - C : m;
};

const MIN_GREEN = 3;
const MIN_RED = 3;

interface ClusterResult {
  center: number; // epoch seconds of a representative event
  inliers: number[]; // indices into the input array
  residuals: number[]; // signed residuals for inliers
}

/** Find the phase that the most event times agree on (within tol), and refine it. */
function cluster(times: number[], C: number, tol: number): ClusterResult | null {
  if (!times.length) return null;
  let bestSeed = 0;
  let bestCount = -1;
  let bestErr = Infinity;
  for (let j = 0; j < times.length; j++) {
    let count = 0;
    let err = 0;
    for (let i = 0; i < times.length; i++) {
      const r = Math.abs(sdiff(times[i] - times[j], C));
      if (r <= tol) {
        count++;
        err += r;
      }
    }
    if (count > bestCount || (count === bestCount && err < bestErr)) {
      bestCount = count;
      bestErr = err;
      bestSeed = j;
    }
  }
  const seed = times[bestSeed];
  let sum = 0;
  let n = 0;
  for (const t of times) {
    const r = sdiff(t - seed, C);
    if (Math.abs(r) <= tol) {
      sum += r;
      n++;
    }
  }
  const center = seed + sum / n;
  const inliers: number[] = [];
  const residuals: number[] = [];
  times.forEach((t, i) => {
    const r = sdiff(t - center, C);
    if (Math.abs(r) <= tol) {
      inliers.push(i);
      residuals.push(r);
    }
  });
  return { center, inliers, residuals };
}

function checkConsistent(kind: ObservationKind, p: number, C: number, G: number, tol: number): boolean {
  const nearStart = p <= tol || p >= C - tol;
  const nearEnd = Math.abs(p - G) <= tol;
  if (nearStart || nearEnd) return true;
  return kind === 'alreadyGreen' ? p < G : p > G;
}

/** Choose a green duration that satisfies the most "already" checks. Returns the best interval. */
function sweepGreen(checks: { kind: ObservationKind; p: number }[], C: number, tol: number) {
  const lo0 = MIN_GREEN;
  const hi0 = C - MIN_RED;
  // Each check constrains G to one side of a threshold (unless it sits near green start).
  const lower: number[] = []; // alreadyGreen: G >= p - tol
  const upper: number[] = []; // alreadyRed:   G <= p + tol
  let free = 0;
  for (const c of checks) {
    if (c.p <= tol || c.p >= C - tol) free++;
    else if (c.kind === 'alreadyGreen') lower.push(c.p - tol);
    else upper.push(c.p + tol);
  }
  const pts = [lo0, hi0, ...lower, ...upper].filter((x) => x >= lo0 && x <= hi0).sort((a, b) => a - b);
  const uniq = pts.filter((x, i) => i === 0 || x - pts[i - 1] > 1e-6);
  // The count is piecewise constant, so sampling the thresholds and the midpoints between them is exhaustive.
  const samples: number[] = [];
  uniq.forEach((x, i) => {
    samples.push(x);
    if (i < uniq.length - 1) samples.push((x + uniq[i + 1]) / 2);
  });
  const counts = samples.map((g) => free + lower.filter((l) => g >= l).length + upper.filter((u) => g <= u).length);
  const best = Math.max(...counts);
  // Widest contiguous run at the best count.
  let bestLo = lo0;
  let bestHi = hi0;
  let widest = -1;
  let runStart: number | null = null;
  samples.forEach((g, i) => {
    if (counts[i] !== best) {
      runStart = null;
      return;
    }
    if (runStart === null) runStart = g;
    if (g - runStart > widest) {
      widest = g - runStart;
      bestLo = runStart;
      bestHi = g;
    }
  });
  return { lo: bestLo, hi: bestHi, consistent: best };
}

interface Eval {
  C: number;
  score: number;
  ssr: number;
  offset: number;
  green: number;
  greenRange: [number, number];
  greenExact: boolean;
  tgIn: number;
  trIn: number;
  rms: number;
  details: ObsDetail[];
}

function evaluate(C: number, obs: FitObservation[], tol: number, withDetails: boolean): Eval | null {
  const tg = obs.filter((o) => o.kind === 'turnedGreen');
  const tr = obs.filter((o) => o.kind === 'turnedRed');
  const checks = obs.filter((o) => o.kind === 'alreadyGreen' || o.kind === 'alreadyRed');
  const g = cluster(
    tg.map((o) => o.t),
    C,
    tol,
  );
  if (!g) return null;
  const offset = g.center;
  let ssr = g.residuals.reduce((s, r) => s + r * r, 0);
  let green: number;
  let greenRange: [number, number];
  let greenExact = false;
  let trIn = 0;
  let trResiduals: Map<number, number> | null = null;
  const r = cluster(
    tr.map((o) => o.t),
    C,
    tol,
  );
  if (r) {
    const G = mod(r.center - offset, C);
    if (G >= MIN_GREEN - tol && G <= C - MIN_RED + tol) {
      green = Math.min(Math.max(G, MIN_GREEN), C - MIN_RED);
      greenRange = [green, green];
      greenExact = true;
      trIn = r.inliers.length;
      ssr += r.residuals.reduce((s, x) => s + x * x, 0);
      trResiduals = new Map(r.inliers.map((idx, k) => [idx, r.residuals[k]]));
    }
  }
  const checkPhases = checks.map((o) => ({ kind: o.kind, p: mod(o.t - offset, C) }));
  if (!greenExact) {
    const s = sweepGreen(checkPhases, C, tol);
    greenRange = [s.lo, s.hi];
    green = (s.lo + s.hi) / 2;
  }
  // TypeScript can't see that both branches assign these.
  green = green!;
  greenRange = greenRange!;
  // Checks are judged against the whole plausible green range: consistent if any G in it works.
  let checksOk = 0;
  const checkOk = checkPhases.map((c) => {
    const ok =
      c.kind === 'alreadyGreen'
        ? checkConsistent(c.kind, c.p, C, greenRange[1], tol)
        : checkConsistent(c.kind, c.p, C, greenRange[0], tol);
    if (ok) checksOk++;
    return ok;
  });
  const anchors = g.residuals.concat(trResiduals ? [...trResiduals.values()] : []);
  const rms = anchors.length ? Math.sqrt(anchors.reduce((s, x) => s + x * x, 0) / anchors.length) : 0;
  const ev: Eval = {
    C,
    score: g.inliers.length + trIn + checksOk,
    ssr,
    offset,
    green,
    greenRange,
    greenExact,
    tgIn: g.inliers.length,
    trIn,
    rms,
    details: [],
  };
  if (withDetails) {
    const tgIdx = new Map(g.inliers.map((idx, k) => [idx, g.residuals[k]]));
    const details: ObsDetail[] = [];
    tg.forEach((o, i) => {
      const res = sdiff(o.t - offset, C);
      details.push({ id: o.id, kind: o.kind, t: o.t, phase: mod(o.t - offset, C), residual: res, consistent: tgIdx.has(i) });
    });
    tr.forEach((o, i) => {
      const res = sdiff(o.t - offset - green, C);
      const ok = greenExact ? trResiduals!.has(i) : Math.abs(res) <= tol;
      details.push({ id: o.id, kind: o.kind, t: o.t, phase: mod(o.t - offset, C), residual: res, consistent: ok });
    });
    checks.forEach((o, i) => {
      details.push({ id: o.id, kind: o.kind, t: o.t, phase: checkPhases[i].p, consistent: checkOk[i] });
    });
    ev.details = details.sort((a, b) => a.t - b.t);
  }
  return ev;
}

function candidateCycles(obs: FitObservation[], opt: FitOptions): { grid: number[]; extra: number[] } {
  const grid: number[] = [];
  for (let c = opt.minCycle; c <= opt.maxCycle + 1e-9; c += opt.step) grid.push(Math.round(c * 1000) / 1000);
  // Short gaps between anchors of the same type pin the cycle exactly: gap / k for whole k.
  const extra = new Set<number>();
  for (const kind of ['turnedGreen', 'turnedRed'] as const) {
    const ts = obs
      .filter((o) => o.kind === kind)
      .map((o) => o.t)
      .sort((a, b) => a - b);
    for (let i = 0; i < ts.length && extra.size < 4000; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const gap = ts[j] - ts[i];
        if (gap > 900) break;
        if (gap < opt.minCycle - opt.tolerance) continue;
        for (let k = Math.max(1, Math.ceil(gap / opt.maxCycle)); gap / k >= opt.minCycle; k++) {
          extra.add(Math.round((gap / k) * 20) / 20);
        }
      }
    }
  }
  return { grid, extra: [...extra] };
}

function emptyFit(status: FitStatus, message: string, counts: Fit['counts']): Fit {
  return { status, message, confidence: 'none', counts, alternatives: [], curve: [], details: [] };
}

export function fitSignal(obs: FitObservation[], opt: FitOptions): Fit {
  const counts = {
    turnedGreen: obs.filter((o) => o.kind === 'turnedGreen').length,
    turnedRed: obs.filter((o) => o.kind === 'turnedRed').length,
    alreadyGreen: obs.filter((o) => o.kind === 'alreadyGreen').length,
    alreadyRed: obs.filter((o) => o.kind === 'alreadyRed').length,
    total: obs.length,
  };
  if (counts.turnedGreen < 2) {
    const need = 2 - counts.turnedGreen;
    return emptyFit(
      'insufficient',
      `Not enough data: need ${need} more "Just turned green" tap${need > 1 ? 's' : ''}.`,
      counts,
    );
  }

  const tol = opt.tolerance;
  const { grid, extra } = candidateCycles(obs, opt);
  const evals: Eval[] = [];
  const curve: { cycle: number; score: number }[] = [];
  for (const C of grid) {
    const e = evaluate(C, obs, tol, false);
    if (e) {
      evals.push(e);
      curve.push({ cycle: C, score: e.score / counts.total });
    }
  }
  for (const C of extra) {
    const e = evaluate(C, obs, tol, false);
    if (e) evals.push(e);
  }
  if (!evals.length) return emptyFit('insufficient', 'Not enough data.', counts);

  const better = (a: Eval, b: Eval) => a.score > b.score || (a.score === b.score && a.ssr < b.ssr);
  let best = evals[0];
  for (const e of evals) if (better(e, best)) best = e;

  // Refine around the winner at 0.01 s: find the range of cycle lengths that score as well,
  // and pick the one with the smallest squared error. The range width is the cycle uncertainty.
  let refined = best;
  let lo = best.C;
  let hi = best.C;
  const span = Math.max(opt.step, 0.5);
  for (let c = best.C - span; c <= best.C + span + 1e-9; c += 0.01) {
    if (c < opt.minCycle - 1e-9 || c > opt.maxCycle + 1e-9) continue;
    const e = evaluate(Math.round(c * 1000) / 1000, obs, tol, false);
    if (!e || e.score < best.score) continue;
    if (e.score > best.score) {
      // Found strictly better nearby: restart the range from it.
      best = e;
      refined = e;
      lo = hi = e.C;
      continue;
    }
    lo = Math.min(lo, e.C);
    hi = Math.max(hi, e.C);
    if (e.ssr < refined.ssr) refined = e;
  }
  // Anchors days apart pin the cycle far tighter than 0.01 s, so measure narrow peaks finer.
  if (hi - lo < 0.02) {
    lo = hi = refined.C;
    const centre = refined.C;
    for (let c = centre - 0.012; c <= centre + 0.012 + 1e-12; c += 0.0002) {
      const e = evaluate(c, obs, tol, false);
      if (!e || e.score < best.score) continue;
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
      if (e.score > refined.score || (e.score === refined.score && e.ssr < refined.ssr)) refined = e;
    }
  }
  const final = evaluate(refined.C, obs, tol, true)!;
  const cycleUncertainty = Math.max(0.0002, (hi - lo) / 2);

  // Distinct alternative peaks: best score among candidates more than 1 s away from the winner
  // (and from each other).
  const sorted = [...evals].sort((a, b) => b.score - a.score || a.ssr - b.ssr);
  const alternatives: { cycle: number; score: number }[] = [];
  for (const e of sorted) {
    if (Math.abs(e.C - final.C) <= 1) continue;
    if (alternatives.some((a) => Math.abs(a.cycle - e.C) <= 1)) continue;
    alternatives.push({ cycle: Math.round(e.C * 100) / 100, score: e.score });
    if (alternatives.length >= 5) break;
  }

  const fitFraction = final.score / counts.total;
  const tgShare = final.tgIn / counts.turnedGreen;
  const lastAnchor = Math.max(
    ...final.details.filter((d) => d.consistent && (d.kind === 'turnedGreen' || d.kind === 'turnedRed')).map((d) => d.t),
  );
  const base: Fit = {
    status: 'ok',
    message: '',
    confidence: 'low',
    counts,
    cycle: final.C,
    cycleUncertainty,
    offset: final.offset,
    green: final.green,
    greenRange: final.greenRange,
    greenExact: final.greenExact,
    rms: final.rms,
    lastAnchor,
    inliers: final.score,
    fitFraction,
    alternatives,
    curve,
    details: final.details,
  };

  if ((counts.total >= 5 && fitFraction < 0.7) || (counts.turnedGreen >= 3 && tgShare < 0.6)) {
    return {
      ...base,
      status: 'notFixedTime',
      confidence: 'none',
      message: `Not fixed-time: the best cycle (${base.cycle!.toFixed(1)} s) only explains ${Math.round(
        fitFraction * 100,
      )}% of observations. This light is probably sensor-actuated or adaptive.`,
    };
  }

  const tied = alternatives.filter((a) => a.score >= final.score);
  if (tied.length) {
    const list = [final.C, ...tied.map((a) => a.cycle)]
      .slice(0, 4)
      .map((c) => `${c.toFixed(1)} s`)
      .join(', ');
    return {
      ...base,
      status: 'ambiguous',
      confidence: 'none',
      message: `Not enough data to tell the cycle apart: ${list}${tied.length > 3 ? '…' : ''} all fit. More "Just turned green" and "Already red/green" taps will settle it.`,
    };
  }

  const margin = final.score - (alternatives[0]?.score ?? 0);
  const greenWidth = final.greenRange[1] - final.greenRange[0];
  let confidence: Confidence = 'low';
  if (final.tgIn >= 4 && final.trIn >= 2 && fitFraction >= 0.9 && margin >= 2 && greenWidth <= 1) confidence = 'high';
  else if (final.tgIn >= 3 && fitFraction >= 0.8 && margin >= 1 && greenWidth <= 10) confidence = 'medium';

  const notes: string[] = [];
  if (!final.greenExact) notes.push('no "Just turned red" tap yet, so green length is estimated');
  if (margin < 2) notes.push(`${alternatives[0]?.cycle.toFixed(1)} s is a close runner-up`);
  return {
    ...base,
    confidence,
    message: notes.length ? `Fitted, but ${notes.join('; ')}.` : 'Fitted.',
  };
}
