import { useMemo } from 'react';
import { useUi } from '../App';
import { Card, ConfidenceBadge, GpsBadge, Screen, StatePill } from '../components/ui';
import { bandFor } from '../lib/bands';
import { fmtDist, fmtKmh } from '../lib/format';
import { headingFresh, lightsAhead, locateOnRoads, type AheadLight } from '../lib/locate';
import type { Fit } from '../lib/model/fit';
import { formatCountdown, predictAt, type StateAt } from '../lib/model/predict';
import { DIR_ARROW, directionFromHeading, directionLabel, orderedLights } from '../lib/road';
import { getFit, groupObservations } from '../lib/signals';
import type { Direction, Light, Road } from '../lib/types';
import { href, navigate } from '../router';
import { useData } from '../state/DataContext';
import { useGeo } from '../state/GeoContext';
import { useNow, useWakeLock } from '../state/hooks';

const MOVING = 2; // m/s

function changeText(s: StateAt): string {
  if (s.stale) return 'Too long since the last tap to say. One "Just turned green" tap will re-anchor it.';
  return `${s.changeTo === 'green' ? 'Green' : 'Red'} in ${formatCountdown(s)}`;
}

function arrivalText(s: StateAt): string {
  if (s.stale) return '';
  const cd = formatCountdown(s);
  switch (s.state) {
    case 'green':
      return `Stays green ${cd} after you get there`;
    case 'red':
      return `Turns green ${cd} after you get there`;
    case 'turningRed':
      return 'Changing to red as you arrive';
    case 'turningGreen':
      return 'Changing to green as you arrive';
    default:
      return '';
  }
}

interface Row {
  light: Light;
  distance: number | null;
  fit: Fit;
  now: StateAt | null;
  eta: number | null;
  arrival: StateAt | null;
}

export function PredictScreen() {
  const { lights, roads, observations, settings } = useData();
  const geo = useGeo();
  const { dirOverride, setDirOverride } = useUi();
  const now = useNow(200);
  useWakeLock();

  const groups = useMemo(() => groupObservations(observations, settings.bands), [observations, settings.bands]);
  const band = bandFor(settings.bands, now);
  const fix = geo.fix;
  const pos = fix ? locateOnRoads(lights, roads, fix) : null;
  const onRoad = pos && pos.lateral <= 150;
  const moving = (geo.speed ?? 0) >= MOVING;

  let dir: Direction | null = dirOverride === 'auto' ? null : dirOverride;
  if (!dir && onRoad && geo.heading != null && headingFresh(geo.headingAt, now)) dir = directionFromHeading(pos.bearing, geo.heading);

  const road: Road | undefined = onRoad ? pos.road : roads[0];
  const chain = road ? orderedLights(lights, road.id) : [];
  const shownDir: Direction = dir ?? 'fwd';

  const rowFor = (light: Light, distance: number | null): Row => {
    const fit = getFit(groups, light.id, shownDir, band.id, settings);
    const eta = distance != null && moving && geo.speed ? distance / geo.speed : null;
    return {
      light,
      distance,
      fit,
      now: predictAt(fit, now),
      eta,
      arrival: eta != null ? predictAt(fit, now + eta * 1000) : null,
    };
  };

  let rows: Row[];
  if (onRoad && dir) rows = lightsAhead(pos, dir).map((a: AheadLight) => rowFor(a.light, a.distance));
  else {
    const ordered = shownDir === 'fwd' ? chain : [...chain].reverse();
    rows = ordered.filter((l) => l.directions[shownDir]).map((l) => rowFor(l, null));
  }
  const [next, ...rest] = rows;

  let notice: string | null = null;
  if (!lights.length) notice = null;
  else if (!fix) notice = 'No GPS position yet. Showing all lights; no arrival times.';
  else if (!onRoad) notice = `You're ${fmtDist(pos?.lateral ?? 0)} from the nearest registered road. Showing all lights.`;
  else if (!dir) notice = 'Direction unknown until you move. Pick one below, or start driving.';

  return (
    <Screen title="Predict" right={<GpsBadge status={geo.status} accuracy={fix?.accuracy} />}>
      {geo.error && <p className="mb-3 rounded-xl border-2 border-stop p-3 font-bold text-stop">{geo.error}</p>}

      {!lights.length ? (
        <Card>
          <p className="text-lg">
            No lights registered. Go to <a className="font-bold text-accent underline" href={href({ name: 'lights' })}>Lights</a>{' '}
            to add them, or load the demo road under More.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <div className="tabular text-4xl font-black leading-none">{fmtKmh(geo.speed)}</div>
              <div className="mt-1 text-base text-muted">
                {road?.name ?? ''} · {DIR_ARROW[shownDir]} {road ? directionLabel(road, chain, shownDir) : ''}
              </div>
            </div>
            <div className="text-right text-sm text-muted">
              Timing plan
              <div className="text-base font-bold text-fg">{band.name}</div>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Direction">
            {(['auto', 'fwd', 'rev'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={dirOverride === d}
                onClick={() => setDirOverride(d)}
                className={`min-h-11 rounded-xl border-2 font-bold ${dirOverride === d ? 'border-accent bg-accent text-on-accent' : 'border-line text-fg'}`}
              >
                {d === 'auto' ? 'Auto dir' : d === 'fwd' ? '→ Fwd' : '← Rev'}
              </button>
            ))}
          </div>

          {notice && <p className="mb-3 rounded-xl border-2 border-warn p-3 text-base font-bold text-warn">{notice}</p>}

          {next ? (
            <NextCard row={next} moving={moving} />
          ) : (
            <Card>
              <p className="text-lg">No more lights ahead in this direction.</p>
            </Card>
          )}

          {rest.length > 0 && (
            <div className="mt-4">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">Then</h2>
              <div className="space-y-2">
                {rest.map((r) => (
                  <SmallRow key={r.light.id} row={r} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}

function FitProblem({ fit }: { fit: Fit }) {
  return <p className="text-lg font-semibold text-muted">{fit.message}</p>;
}

function NextCard({ row, moving }: { row: Row; moving: boolean }) {
  const { light, fit, now, arrival, distance, eta } = row;
  return (
    <button type="button" onClick={() => navigate({ name: 'light', id: light.id })} className="block w-full text-left">
      <Card className="border-2">
        <div className="text-sm font-bold uppercase tracking-wider text-muted">Next light</div>
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0 text-3xl font-black leading-tight break-words">{light.name}</div>
          {distance != null && <div className="tabular shrink-0 text-2xl font-black">{fmtDist(distance)}</div>}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <ConfidenceBadge confidence={fit.confidence} status={fit.status} />
          {eta != null && <span className="tabular text-lg font-bold text-muted">ETA {Math.round(eta)} s</span>}
        </div>

        {fit.status !== 'ok' || !now ? (
          <div className="mt-4">
            <FitProblem fit={fit} />
          </div>
        ) : (
          <>
            <div className="mt-4">
              <div className="mb-1 text-sm font-bold uppercase tracking-wider text-muted">Right now</div>
              <StatePill state={now.state} big />
              <div className="tabular mt-2 text-2xl font-extrabold">{changeText(now)}</div>
            </div>
            <div className="mt-4 border-t-2 border-line pt-3">
              <div className="mb-1 text-sm font-bold uppercase tracking-wider text-muted">When you arrive</div>
              {arrival ? (
                <>
                  <StatePill state={arrival.state} big />
                  <div className="tabular mt-2 text-xl font-bold">{arrivalText(arrival)}</div>
                </>
              ) : (
                <div className="text-lg text-muted">
                  {distance == null ? 'Needs your position on the road.' : moving ? '—' : 'Start moving to get an arrival prediction.'}
                </div>
              )}
            </div>
            {now.uncertainty > 2.5 && (
              <div className="mt-3 text-sm text-muted">Timing uncertain by ±{now.uncertainty.toFixed(1)} s</div>
            )}
          </>
        )}
      </Card>
    </button>
  );
}

function SmallRow({ row }: { row: Row }) {
  const { light, fit, now, arrival, distance } = row;
  return (
    <a href={href({ name: 'light', id: light.id })} className="block">
      <Card className="py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-lg font-extrabold">{light.name}</span>
          {distance != null && <span className="tabular text-lg font-bold">{fmtDist(distance)}</span>}
        </div>
        {fit.status !== 'ok' || !now ? (
          <div className="mt-1 flex items-center gap-2">
            <ConfidenceBadge confidence={fit.confidence} status={fit.status} />
          </div>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatePill state={now.state} />
            <span className="tabular text-base font-bold">{formatCountdown(now)}</span>
            {arrival && (
              <>
                <span className="text-muted">· arrive</span>
                <StatePill state={arrival.state} />
              </>
            )}
            <span className="ml-auto">
              <ConfidenceBadge confidence={fit.confidence} status={fit.status} />
            </span>
          </div>
        )}
      </Card>
    </a>
  );
}
