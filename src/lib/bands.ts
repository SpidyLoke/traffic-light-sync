import type { TimeBand } from './types';

export function bandMatches(band: TimeBand, epochMs: number): boolean {
  if (band.fallback) return true;
  const d = new Date(epochMs);
  if (!band.days.includes(d.getDay())) return false;
  const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  if (band.endMin > band.startMin) return m >= band.startMin && m < band.endMin;
  return m >= band.startMin || m < band.endMin; // wraps past midnight
}

/** The first non-fallback band that matches, else the fallback band. */
export function bandFor(bands: TimeBand[], epochMs: number): TimeBand {
  const hit = bands.find((b) => !b.fallback && bandMatches(b, epochMs));
  return hit ?? bands.find((b) => b.fallback) ?? bands[0];
}

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function minToHHMM(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const mm = Math.round(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function describeBand(b: TimeBand): string {
  if (b.fallback) return 'Any time not covered by another band';
  const days =
    b.days.length === 7
      ? 'Every day'
      : [1, 2, 3, 4, 5].every((d) => b.days.includes(d)) && b.days.length === 5
        ? 'Mon–Fri'
        : [...b.days].sort().map((d) => DAY_SHORT[d]).join(', ');
  return `${days} ${minToHHMM(b.startMin)}–${minToHHMM(b.endMin)}`;
}
