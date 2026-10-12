import { useRef, useState, type PointerEvent } from 'react';
import { useUi } from '../App';
import { Button, Card, GpsBadge, Screen } from '../components/ui';
import { fmtDist, fmtTime } from '../lib/format';
import { directionAtLight, nearestLight, type DirSource } from '../lib/locate';
import { DIR_ARROW, directionLabel, orderedLights } from '../lib/road';
import { KIND_LABEL, type Direction, type ObservationKind } from '../lib/types';
import { href } from '../router';
import { useData } from '../state/DataContext';
import { useGeo } from '../state/GeoContext';
import { useNow, useWakeLock } from '../state/hooks';

const BUTTONS: { kind: ObservationKind; title: string; sub: string; cls: string }[] = [
  { kind: 'turnedGreen', title: 'Just turned', sub: 'GREEN', cls: 'bg-go text-on-go border-go' },
  { kind: 'alreadyGreen', title: 'Already', sub: 'green', cls: 'bg-transparent text-go border-go' },
  { kind: 'turnedRed', title: 'Just turned', sub: 'RED', cls: 'bg-stop text-on-stop border-stop' },
  { kind: 'alreadyRed', title: 'Already', sub: 'red', cls: 'bg-transparent text-stop border-stop' },
];

const SOURCE_LABEL: Record<DirSource, string> = {
  manual: 'set by you',
  heading: 'from heading',
  position: 'from position',
  single: 'only direction',
  none: 'unknown',
};

/** Exact time of the input event on the device clock, in ms. */
function eventTime(e: PointerEvent): number {
  const now = Date.now();
  const t = Math.round(performance.timeOrigin + e.timeStamp);
  return Math.abs(t - now) < 5000 ? t : now;
}

export function CaptureScreen() {
  const data = useData();
  const geo = useGeo();
  const { dirOverride, setDirOverride } = useUi();
  const wake = useWakeLock();
  const now = useNow(500);
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastTap = useRef<{ kind: ObservationKind; t: number } | null>(null);

  const { lights, roads, observations, settings } = data;
  const fix = geo.fix;
  const fixFresh = fix && now - fix.at < 10000;
  const snap = fix ? nearestLight(lights, roads, fix) : null;
  const inRange = snap && snap.distance <= settings.snapRadiusM;
  const dirInfo = snap && fix ? directionAtLight(snap, fix, geo.heading, geo.headingAt, now, dirOverride) : null;

  const tap = async (kind: ObservationKind, e: PointerEvent) => {
    const t = eventTime(e);
    if (lastTap.current && lastTap.current.kind === kind && t - lastTap.current.t < 1200) return; // double tap
    lastTap.current = { kind, t };
    if (!lights.length) return setError('No lights registered yet. Add them on the Lights tab first.');
    const f = geo.fix;
    if (!f || t - f.at > 10000) return setError('No recent GPS fix. Not saved.');
    const s = nearestLight(lights, roads, f);
    if (!s) return setError('No lights registered yet.');
    if (s.distance > settings.snapRadiusM) {
      navigator.vibrate?.([60, 60, 60]);
      return setError(
        `Too far from any light: nearest is ${s.light.name}, ${fmtDist(s.distance)} away (limit ${settings.snapRadiusM} m). Not saved.`,
      );
    }
    const d = directionAtLight(s, f, geo.heading, geo.headingAt, t, dirOverride);
    setError(null);
    navigator.vibrate?.(35);
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
    setRecent((r) => [o.id, ...r].slice(0, 5));
  };

  const recentObs = recent.map((id) => observations.find((o) => o.id === id)).filter((o) => !!o);

  return (
    <Screen
      title="Capture"
      right={
        <div className="flex flex-col items-end gap-1">
          <GpsBadge status={geo.status} accuracy={fix?.accuracy} />
          <span className={`text-xs font-bold ${wake === 'on' ? 'text-go' : 'text-muted'}`}>
            {wake === 'on' ? 'Screen stays on' : wake === 'unsupported' ? 'Keep-awake unsupported' : 'Keep-awake off'}
          </span>
        </div>
      }
    >
      {geo.error && <p className="mb-3 rounded-xl border-2 border-stop p-3 font-bold text-stop">{geo.error}</p>}

      <Card className="mb-3 py-3">
        {!lights.length ? (
          <p className="text-lg">
            No lights yet. <a className="font-bold text-accent underline" href={href({ name: 'lights' })}>Register lights</a> first.
          </p>
        ) : !snap || !fixFresh ? (
          <p className="text-lg text-muted">Waiting for GPS…</p>
        ) : (
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-xl font-extrabold ${inRange ? 'text-fg' : 'text-muted'}`}>{snap.light.name}</span>
              <span className={`tabular text-lg font-bold ${inRange ? 'text-go' : 'text-stop'}`}>{fmtDist(snap.distance)}</span>
            </div>
            <div className="mt-1 text-base text-muted">
              {inRange ? 'Taps will snap here' : `Out of range (limit ${settings.snapRadiusM} m)`} ·{' '}
              {dirInfo?.dir
                ? `${DIR_ARROW[dirInfo.dir]} ${directionLabel(snap.road, snap.chain, dirInfo.dir)} (${SOURCE_LABEL[dirInfo.source]})`
                : 'direction unknown'}
            </div>
          </div>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Direction">
          {(['auto', 'fwd', 'rev'] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={dirOverride === d}
              onClick={() => setDirOverride(d)}
              className={`press chip min-h-11 rounded-xl border-2 font-bold ${dirOverride === d ? 'border-accent bg-accent text-on-accent' : 'border-line text-fg'}`}
            >
              {d === 'auto' ? 'Auto dir' : d === 'fwd' ? '→ Fwd' : '← Rev'}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3" style={{ height: 'min(50vh, 27.5rem)', minHeight: '17.5rem' }}>
        {BUTTONS.map((b) => (
          <button
            key={b.kind}
            type="button"
            onPointerDown={(e) => tap(b.kind, e)}
            onContextMenu={(e) => e.preventDefault()}
            className={`flex select-none flex-col items-center justify-center press-fast rounded-3xl border-4 ${b.cls}`}
          >
            <span className="text-xl font-bold leading-tight">{b.title}</span>
            <span className="t-hero text-4xl font-black">{b.sub}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-sm text-muted">Amber counts as red. Tap the moment it changes.</p>

      {error && (
        <div role="alert" className="enter mt-3 rounded-(--radius-lg) border-4 border-stop p-3 text-lg font-bold text-stop">
          {error}
        </div>
      )}

      {recentObs.length > 0 && (
        <div className="mt-3 space-y-2">
          {recentObs.map((o, i) => {
            const light = lights.find((l) => l.id === o.lightId);
            const road = roads.find((r) => r.id === light?.roadId);
            const chain = light ? orderedLights(lights, light.roadId) : [];
            const flip = (d: Direction) => data.setObservationDirection(o.id, d);
            return (
              <Card key={o.id} className={`enter ${i === 0 ? 'border-accent' : 'opacity-80'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className={`text-lg font-extrabold ${o.kind.endsWith('Green') ? 'text-go' : 'text-stop'}`}>
                      {KIND_LABEL[o.kind]}
                    </div>
                    <div className="truncate text-lg font-bold">{light?.name ?? 'Deleted light'}</div>
                    <div className="tabular text-sm text-muted">
                      {fmtTime(o.t, true)} · {fmtDist(o.distanceM)} away
                    </div>
                  </div>
                  <Button variant="danger" onClick={() => data.deleteObservation(o.id)}>
                    Undo
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(['fwd', 'rev'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => flip(d)}
                      className={`press chip min-h-11 truncate rounded-xl border-2 px-2 text-sm font-bold ${
                        o.direction === d ? 'border-accent bg-accent text-on-accent' : 'border-line text-muted'
                      }`}
                    >
                      {DIR_ARROW[d]} {directionLabel(road, chain, d)}
                    </button>
                  ))}
                </div>
                {!o.direction && <p className="mt-2 text-sm font-bold text-warn">Pick a direction or this tap won't be used.</p>}
              </Card>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
