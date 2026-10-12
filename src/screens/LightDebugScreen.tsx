import { useMemo, useState, type PointerEvent as RPointerEvent } from 'react';
import { Button, Card, ConfidenceBadge, Screen } from '../components/ui';
import { bandFor } from '../lib/bands';
import { fmtDateTime, fmtTime } from '../lib/format';
import { mod, type Fit, type ObsDetail } from '../lib/model/fit';
import { uncertaintyAt } from '../lib/model/predict';
import { DIR_ARROW, directionLabel, orderedLights } from '../lib/road';
import { ALL_BANDS, getCombinedFit, getFit, groupObservations } from '../lib/signals';
import { KIND_LABEL, type Direction, type Observation } from '../lib/types';
import { href } from '../router';
import { useData } from '../state/DataContext';
import { useNow } from '../state/hooks';

export function LightDebugScreen({ id }: { id: string }) {
  const data = useData();
  const { lights, roads, observations, settings } = data;
  const now = useNow(1000);
  const light = lights.find((l) => l.id === id);
  const [dir, setDir] = useState<Direction>('fwd');
  const [bandId, setBandId] = useState<string>(() => bandFor(settings.bands, Date.now()).id);
  const [selected, setSelected] = useState<string | null>(null);

  const groups = useMemo(() => groupObservations(observations, settings.bands), [observations, settings.bands]);

  if (!light) {
    return (
      <Screen title="Light">
        <p className="text-lg">This light no longer exists.</p>
        <a className="mt-3 block font-bold text-accent underline" href={href({ name: 'lights' })}>
          Back to lights
        </a>
      </Screen>
    );
  }
  const road = roads.find((r) => r.id === light.roadId);
  const chain = orderedLights(lights, light.roadId);

  const fit: Fit = bandId === ALL_BANDS ? getCombinedFit(observations, light.id, dir, settings) : getFit(groups, light.id, dir, bandId, settings);
  const mine = observations.filter((o) => o.lightId === light.id);
  const shown = mine
    .filter((o) => o.direction === dir && (bandId === ALL_BANDS || bandFor(settings.bands, o.t).id === bandId))
    .sort((a, b) => b.t - a.t);
  const undirected = mine.filter((o) => !o.direction);
  const detailById = new Map(fit.details.map((d) => [d.id, d]));
  const bandCount = (bid: string) =>
    mine.filter((o) => o.direction === dir && (bid === ALL_BANDS || bandFor(settings.bands, o.t).id === bid)).length;

  return (
    <Screen
      title={light.name}
      right={
        <a href={href({ name: 'lights' })} className="font-bold text-accent underline">
          Lights
        </a>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(['fwd', 'rev'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDir(d)}
            className={`press chip min-h-12 truncate rounded-xl border-2 px-2 font-bold ${dir === d ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}
          >
            {DIR_ARROW[d]} {directionLabel(road, chain, d)}
          </button>
        ))}
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {[...settings.bands.map((b) => ({ id: b.id, name: b.name })), { id: ALL_BANDS, name: 'All combined' }].map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBandId(b.id)}
            className={`press chip min-h-11 shrink-0 rounded-xl border-2 px-3 text-sm font-bold ${bandId === b.id ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}
          >
            {b.name} <span className="opacity-70">({bandCount(b.id)})</span>
          </button>
        ))}
      </div>

      <FitSummary fit={fit} now={now} />

      {fit.cycle != null && fit.details.length > 0 && (
        <Card className="mt-3 p-3">
          <h2 className="mb-1 text-lg font-extrabold">Observations folded onto one cycle</h2>
          <p className="mb-2 text-sm text-muted">
            Each row is one tap, newest at the top, placed at its position within the fitted cycle. A good model lines the "Just turned"
            taps up on the edges of the green band.
          </p>
          <PhaseChart fit={fit} selected={selected} onSelect={setSelected} />
        </Card>
      )}

      {fit.curve.length > 0 && (
        <Card className="mt-3 p-3">
          <h2 className="mb-1 text-lg font-extrabold">Cycle length search</h2>
          <p className="mb-2 text-sm text-muted">Share of observations each candidate cycle length explains. One clear peak is what you want.</p>
          <CurveChart fit={fit} />
        </Card>
      )}

      {undirected.length > 0 && (
        <Card className="mt-3 border-warn">
          <h2 className="text-lg font-extrabold text-warn">{undirected.length} tap(s) with unknown direction</h2>
          <p className="mb-2 text-sm text-muted">These aren't used until you assign a direction.</p>
          {undirected.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 border-t border-line py-2">
              <div className="text-sm">
                <div className="font-bold">{KIND_LABEL[o.kind]}</div>
                <div className="tabular text-muted">{fmtDateTime(o.t)}</div>
              </div>
              <div className="flex gap-1">
                <Button onClick={() => data.setObservationDirection(o.id, 'fwd')}>→</Button>
                <Button onClick={() => data.setObservationDirection(o.id, 'rev')}>←</Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <h2 className="t-label mt-5 mb-2">Timeline ({shown.length})</h2>
      <div className="space-y-1.5">
        {shown.map((o) => (
          <ObsRow key={o.id} o={o} d={detailById.get(o.id)} selected={selected === o.id} onSelect={() => setSelected(o.id)} />
        ))}
        {!shown.length && <p className="text-muted">No observations for this direction and timing plan yet.</p>}
      </div>
    </Screen>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-muted">{label}</div>
      <div className="tabular text-xl font-black break-words">{value}</div>
      {sub && <div className="tabular text-sm text-muted">{sub}</div>}
    </div>
  );
}

function FitSummary({ fit, now }: { fit: Fit; now: number }) {
  const c = fit.counts;
  let nextGreen: number | null = null;
  if (fit.cycle != null && fit.offset != null) {
    const t = now / 1000;
    nextGreen = (t + (fit.cycle - mod(t - fit.offset, fit.cycle))) * 1000;
  }
  const g = fit.greenRange;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={fit.confidence} status={fit.status} />
      </div>
      <p className="mt-2 text-base">{fit.message}</p>
      {fit.cycle != null && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stat label="Cycle" value={`${fit.cycle.toFixed(2)} s`} sub={`± ${fit.cycleUncertainty!.toFixed(fit.cycleUncertainty! < 0.01 ? 4 : 2)} s`} />
          <Stat
            label="Green"
            value={g && g[1] - g[0] < 0.05 ? `${fit.green!.toFixed(1)} s` : `${g![0].toFixed(0)}–${g![1].toFixed(0)} s`}
            sub={fit.greenExact ? 'from "Just turned red"' : 'estimated from "Already" taps'}
          />
          <Stat
            label="Offset (a green start)"
            value={fmtTime(fit.offset! * 1000)}
            sub={`${fmtTime(fit.offset! * 1000, true)}${nextGreen ? ` · next green ${fmtTime(nextGreen)}` : ''}`}
          />
          <Stat
            label="Fit"
            value={`${fit.inliers}/${c.total}`}
            sub={`rms ${fit.rms!.toFixed(2)} s · ±${uncertaintyAt(fit, now / 1000).toFixed(1)} s now`}
          />
        </div>
      )}
      <div className="mt-3 text-sm text-muted">
        {c.turnedGreen} just-green · {c.turnedRed} just-red · {c.alreadyGreen} already-green · {c.alreadyRed} already-red
      </div>
      {fit.alternatives.length > 0 && fit.status !== 'insufficient' && (
        <div className="mt-2 text-sm text-muted">
          Runners-up: {fit.alternatives.slice(0, 4).map((a) => `${a.cycle.toFixed(1)} s (${a.score}/${c.total})`).join(', ')}
        </div>
      )}
    </Card>
  );
}

const KIND_MARK: Record<Observation['kind'], { color: string; filled: boolean; label: string }> = {
  turnedGreen: { color: 'var(--green)', filled: true, label: 'Just turned green' },
  alreadyGreen: { color: 'var(--green)', filled: false, label: 'Already green' },
  turnedRed: { color: 'var(--red)', filled: true, label: 'Just turned red' },
  alreadyRed: { color: 'var(--red)', filled: false, label: 'Already red' },
};

function PhaseChart({ fit, selected, onSelect }: { fit: Fit; selected: string | null; onSelect: (id: string) => void }) {
  const C = fit.cycle!;
  const rows = [...fit.details].sort((a, b) => b.t - a.t);
  const W = 340;
  const left = 8;
  const right = 8;
  const top = 8;
  const rowH = 14;
  const axisH = 26;
  const H = top + rows.length * rowH + axisH;
  // Show the fold from just before green start, so slightly early "Just turned green" taps sit left of the edge.
  const lead = Math.min(6, C * 0.05);
  const shift = (p: number) => (p > C - lead ? p - C : p);
  const x = (p: number) => left + ((p + lead) / C) * (W - left - right);
  const [gLo, gHi] = fit.greenRange!;
  const ticks: number[] = [];
  const stepT = C > 150 ? 30 : C > 60 ? 20 : 10;
  for (let t = 0; t <= C - lead; t += stepT) ticks.push(t);
  const sel = rows.find((r) => r.id === selected);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Observations folded onto the fitted cycle">
        <rect x={x(0)} y={top} width={x(gLo) - x(0)} height={rows.length * rowH} fill="var(--green)" opacity={0.18} />
        {gHi > gLo && <rect x={x(gLo)} y={top} width={x(gHi) - x(gLo)} height={rows.length * rowH} fill="var(--amber)" opacity={0.15} />}
        <rect x={x(gHi)} y={top} width={x(C - lead) - x(gHi)} height={rows.length * rowH} fill="var(--red)" opacity={0.1} />
        <rect x={x(-lead)} y={top} width={x(0) - x(-lead)} height={rows.length * rowH} fill="var(--red)" opacity={0.1} />
        <line x1={x(0)} x2={x(0)} y1={top} y2={top + rows.length * rowH} stroke="var(--green)" strokeWidth={2} />
        <line x1={x(fit.green!)} x2={x(fit.green!)} y1={top} y2={top + rows.length * rowH} stroke="var(--red)" strokeWidth={2} />
        {rows.map((d, i) => {
          const m = KIND_MARK[d.kind];
          const cy = top + i * rowH + rowH / 2;
          const isSel = d.id === selected;
          return (
            <g key={d.id} onClick={() => onSelect(d.id)} style={{ cursor: 'pointer' }}>
              <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill={isSel ? 'var(--accent)' : 'transparent'} opacity={isSel ? 0.2 : 0} />
              <circle
                cx={x(shift(d.phase))}
                cy={cy}
                r={5}
                fill={m.filled ? m.color : 'var(--surface)'}
                stroke={d.consistent ? m.color : 'var(--fg)'}
                strokeWidth={2}
              />
              {!d.consistent && (
                <text x={x(shift(d.phase)) + 8} y={cy + 4} fontSize={11} fontWeight={800} fill="var(--fg)">
                  ✗
                </text>
              )}
            </g>
          );
        })}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top + rows.length * rowH} y2={top + rows.length * rowH + 4} stroke="var(--muted)" />
            <text x={x(t)} y={H - 6} fontSize={11} textAnchor="middle" fill="var(--muted)">
              {t}s
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {Object.values(KIND_MARK).map((m) => (
          <span key={m.label} className="flex items-center gap-1.5">
            <svg width={14} height={14} aria-hidden>
              <circle cx={7} cy={7} r={5} fill={m.filled ? m.color : 'transparent'} stroke={m.color} strokeWidth={2} />
            </svg>
            {m.label}
          </span>
        ))}
        <span className="text-muted">✗ = disagrees with model</span>
      </div>
      {sel && (
        <p className="tabular mt-2 rounded-lg bg-surface-2 p-2 text-sm">
          {KIND_LABEL[sel.kind]} · {fmtDateTime(sel.t * 1000)} · {sel.phase.toFixed(1)} s into cycle
          {sel.residual != null ? ` · ${sel.residual >= 0 ? '+' : ''}${sel.residual.toFixed(2)} s from modelled change` : ''}
        </p>
      )}
    </div>
  );
}

function CurveChart({ fit }: { fit: Fit }) {
  const pts = fit.curve;
  const [hover, setHover] = useState<{ cycle: number; score: number } | null>(null);
  const W = 340;
  const H = 140;
  const l = 34;
  const r = 8;
  const t = 8;
  const b = 24;
  const minC = pts[0].cycle;
  const maxC = pts[pts.length - 1].cycle;
  const x = (c: number) => l + ((c - minC) / (maxC - minC || 1)) * (W - l - r);
  const y = (s: number) => t + (1 - s) * (H - t - b);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.cycle).toFixed(1)},${y(p.score).toFixed(1)}`).join('');
  const ticks: number[] = [];
  for (let c = Math.ceil(minC / 30) * 30; c <= maxC; c += 30) ticks.push(c);
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * W;
    const c = minC + ((cx - l) / (W - l - r)) * (maxC - minC);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.cycle - c) < Math.abs(best.cycle - c)) best = p;
    setHover(best);
  };
  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full touch-none"
        role="img"
        aria-label="Score by candidate cycle length"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((s) => (
          <g key={s}>
            <line x1={l} x2={W - r} y1={y(s)} y2={y(s)} stroke="var(--border)" strokeWidth={1} />
            <text x={l - 4} y={y(s) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {s * 100}%
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--fg)" strokeWidth={1.5} strokeLinejoin="round" />
        {fit.cycle != null && (
          <>
            <line x1={x(fit.cycle)} x2={x(fit.cycle)} y1={t} y2={H - b} stroke="var(--accent)" strokeWidth={2} strokeDasharray="4 3" />
            <text x={Math.min(x(fit.cycle) + 4, W - 60)} y={t + 12} fontSize={12} fontWeight={800} fill="var(--accent)">
              {fit.cycle.toFixed(1)} s
            </text>
          </>
        )}
        {hover && (
          <>
            <line x1={x(hover.cycle)} x2={x(hover.cycle)} y1={t} y2={H - b} stroke="var(--muted)" strokeWidth={1} />
            <circle cx={x(hover.cycle)} cy={y(hover.score)} r={4} fill="var(--fg)" stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
        {ticks.map((c) => (
          <text key={c} x={x(c)} y={H - 6} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {c}s
          </text>
        ))}
      </svg>
      <p className="tabular mt-1 h-5 text-sm text-muted">
        {hover ? `${hover.cycle.toFixed(1)} s cycle explains ${Math.round(hover.score * 100)}%` : 'Touch the chart to read values.'}
      </p>
    </div>
  );
}

function ObsRow({ o, d, selected, onSelect }: { o: Observation; d?: ObsDetail; selected: boolean; onSelect: () => void }) {
  const { deleteObservation } = useData();
  const isGreen = o.kind.endsWith('Green');
  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2 ${selected ? 'border-accent' : 'border-line'} bg-surface`}
    >
      <span
        className={`size-4 shrink-0 rounded-full border-2 ${isGreen ? 'border-go' : 'border-stop'} ${
          o.kind.startsWith('turned') ? (isGreen ? 'bg-go' : 'bg-stop') : ''
        }`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="text-base font-bold">{KIND_LABEL[o.kind]}</div>
        <div className="tabular text-sm text-muted">
          {fmtDateTime(o.t)} · {Math.round(o.distanceM)} m
          {d ? ` · ${d.phase.toFixed(1)} s in` : ''}
          {d?.residual != null ? ` · ${d.residual >= 0 ? '+' : ''}${d.residual.toFixed(2)} s` : ''}
        </div>
      </div>
      {d && (
        <span className={`text-lg font-black ${d.consistent ? 'text-go' : 'text-stop'}`} title={d.consistent ? 'Agrees' : 'Disagrees'}>
          {d.consistent ? '✓' : '✗'}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm('Delete this observation?')) deleteObservation(o.id);
        }}
        className="press min-h-10 rounded-lg border-2 border-line px-2 text-sm font-bold text-muted"
        aria-label="Delete observation"
      >
        Del
      </button>
    </div>
  );
}
