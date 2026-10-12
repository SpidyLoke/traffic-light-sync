export function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

export function fmtTime(ms: number, withMs = false): string {
  const d = new Date(ms);
  const s = d.toLocaleTimeString('en-GB', { hour12: false });
  return withMs ? `${s}.${String(d.getMilliseconds()).padStart(3, '0')}` : s;
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(ms, true)}`;
}

export function fmtKmh(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '—';
  return `${Math.round(ms * 3.6)} km/h`;
}

export function fmtAgo(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
