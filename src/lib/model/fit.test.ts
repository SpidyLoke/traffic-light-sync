import { describe, expect, it } from 'vitest';
import { fitSignal, mod, type FitObservation, type FitOptions } from './fit';
import { predictAt } from './predict';

const OPT: FitOptions = { minCycle: 30, maxCycle: 300, step: 0.5, tolerance: 2 };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Simulate driving past a fixed-time light at random moments, tapping like a human would. */
function simulate(opts: {
  C: number;
  G: number;
  offset: number;
  visits: number;
  seed: number;
  spanS?: number;
  noise?: number;
  clustered?: boolean;
}): FitObservation[] {
  const r = rng(opts.seed);
  const noise = () => (r() - 0.5) * 2 * (opts.noise ?? 0.8);
  const out: FitObservation[] = [];
  const span = opts.spanS ?? 5 * 86400;
  let id = 0;
  let t0 = opts.offset + 1000;
  for (let v = 0; v < opts.visits; v++) {
    // Clustered: pairs of visits ~5-12 min apart (driving up and back), else spread out.
    const T = opts.clustered && v % 2 === 1 ? t0 + 300 + r() * 420 : (t0 = opts.offset + r() * span);
    const p = mod(T - opts.offset, opts.C);
    if (p < opts.G) {
      // Arrive on green. Sometimes you see it go red as you approach a later light; mostly just pass.
      out.push({ id: `o${id++}`, kind: 'alreadyGreen', t: T });
      if (r() < 0.3) out.push({ id: `o${id++}`, kind: 'turnedRed', t: T - p + opts.G + noise() });
    } else {
      out.push({ id: `o${id++}`, kind: 'alreadyRed', t: T });
      out.push({ id: `o${id++}`, kind: 'turnedGreen', t: T - p + opts.C + noise() });
    }
  }
  return out;
}

describe('fitSignal', () => {
  it('needs at least two "Just turned green" taps', () => {
    const f = fitSignal([{ id: 'a', kind: 'turnedGreen', t: 1e9 }], OPT);
    expect(f.status).toBe('insufficient');
  });

  it('recovers a fixed-time light from realistic taps', () => {
    const offset = 1_760_000_000.3;
    const obs = simulate({ C: 120, G: 45, offset, visits: 30, seed: 7 });
    const f = fitSignal(obs, OPT);
    expect(f.status).toBe('ok');
    expect(f.cycle!).toBeCloseTo(120, 1);
    expect(f.green!).toBeGreaterThan(43.5);
    expect(f.green!).toBeLessThan(46.5);
    expect(Math.abs(((f.offset! - offset) % 120 + 180) % 120 - 60)).toBeLessThan(1.5);
    expect(['high', 'medium']).toContain(f.confidence);
  });

  it('recovers a non-integer cycle when some taps are minutes apart', () => {
    const offset = 1_760_000_000;
    const obs = simulate({ C: 97.3, G: 38, offset, visits: 24, seed: 3, clustered: true, spanS: 3 * 3600 });
    const f = fitSignal(obs, OPT);
    expect(f.status).toBe('ok');
    expect(f.cycle!).toBeCloseTo(97.3, 1);
  });

  it('does not mistake a light for half its cycle when "Already" taps rule it out', () => {
    const obs = simulate({ C: 120, G: 40, offset: 1_760_000_000, visits: 25, seed: 11 });
    const f = fitSignal(obs, OPT);
    expect(f.status).toBe('ok');
    expect(f.cycle!).toBeCloseTo(120, 1);
  });

  it('calls two far-apart taps ambiguous instead of guessing', () => {
    const f = fitSignal(
      [
        { id: 'a', kind: 'turnedGreen', t: 1_760_000_000 },
        { id: 'b', kind: 'turnedGreen', t: 1_760_000_000 + 3600 * 3 },
      ],
      OPT,
    );
    expect(f.status).toBe('ambiguous');
  });

  it('flags an actuated light as not fixed-time', () => {
    const r = rng(99);
    const obs: FitObservation[] = [];
    for (let i = 0; i < 25; i++) {
      const t = 1_760_000_000 + r() * 5 * 86400;
      obs.push({ id: `g${i}`, kind: 'turnedGreen', t });
      obs.push({ id: `r${i}`, kind: 'alreadyRed', t: t - 5 - r() * 20 });
      if (i % 2) obs.push({ id: `x${i}`, kind: 'turnedRed', t: t + 15 + r() * 40 });
    }
    const f = fitSignal(obs, OPT);
    expect(['notFixedTime', 'ambiguous']).toContain(f.status);
    expect(f.status).not.toBe('ok');
  });
});

describe('predictAt', () => {
  it('predicts state and countdown from a fit', () => {
    const offset = 1_760_000_000;
    const obs = simulate({ C: 100, G: 40, offset, visits: 30, seed: 5, noise: 0.3 });
    const f = fitSignal(obs, OPT);
    expect(f.status).toBe('ok');
    const anchor = f.lastAnchor!;
    const cycleStart = anchor - mod(anchor - offset, 100) + 100;
    const green = predictAt(f, (cycleStart + 10) * 1000)!;
    expect(green.state).toBe('green');
    expect((green.inMin + green.inMax) / 2).toBeCloseTo(30, 0);
    const red = predictAt(f, (cycleStart + 70) * 1000)!;
    expect(red.state).toBe('red');
    expect((red.inMin + red.inMax) / 2).toBeCloseTo(30, 0);
  });
});
