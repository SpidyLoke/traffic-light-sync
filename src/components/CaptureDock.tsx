import { useUi } from '../App';
import { fmtDist } from '../lib/format';
import { nearestLight } from '../lib/locate';
import { DIR_ARROW } from '../lib/road';
import { KIND_LABEL } from '../lib/types';
import { useData } from '../state/DataContext';
import { useGeo } from '../state/GeoContext';
import { useNow } from '../state/hooks';
import { CapturePads, useCapture } from './capture';

/** Compact capture strip that sits above the tab bar on Predict, so you can log taps without switching tabs. */
export function CaptureDock() {
  const capture = useCapture();
  const { lights, roads, observations, settings, deleteObservation, setObservationDirection } = useData();
  const geo = useGeo();
  const { recent } = useUi();
  const now = useNow(500);

  if (!lights.length) return null;

  const last = recent[0] ? observations.find((o) => o.id === recent[0]) : undefined;
  const err = capture.error;
  const showError = err && now - err.at < 6000 && (!last || err.at >= last.createdAt);
  const showSaved = !showError && last && now - last.createdAt < 10000;
  const fix = geo.fix && now - geo.fix.at < 10000 ? geo.fix : null;
  const snap = fix ? nearestLight(lights, roads, fix) : null;
  const inRange = snap && snap.distance <= settings.snapRadiusM;

  let status = null;
  if (showError) {
    status = (
      <p role="alert" className="enter min-w-0 flex-1 truncate text-sm font-bold text-stop">
        {err.message}
      </p>
    );
  } else if (showSaved) {
    const light = lights.find((l) => l.id === last.lightId);
    status = (
      <div className="enter flex min-w-0 flex-1 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-bold">
          <span className={last.kind.endsWith('Green') ? 'text-go' : 'text-stop'}>✓ {KIND_LABEL[last.kind]}</span>
          <span className="text-muted">
            {' '}
            · {light?.name ?? 'Deleted light'} {last.direction ? DIR_ARROW[last.direction] : ''}
          </span>
        </p>
        {!last.direction &&
          (['fwd', 'rev'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setObservationDirection(last.id, d)}
              className="press chip min-h-9 rounded-lg border-2 border-warn px-2 text-sm font-bold text-warn"
              aria-label={d === 'fwd' ? 'Set direction forward' : 'Set direction reverse'}
            >
              {DIR_ARROW[d]}
            </button>
          ))}
        <button
          type="button"
          onClick={() => deleteObservation(last.id)}
          className="press min-h-9 shrink-0 rounded-lg border-2 border-stop px-3 text-sm font-bold text-stop"
        >
          Undo
        </button>
      </div>
    );
  } else if (!inRange) {
    // Only speak up when a tap would be rejected; the next-light card already says where you are.
    status = (
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-warn">
        {!snap ? 'Waiting for GPS…' : `Too far to capture: ${snap.light.name} is ${fmtDist(snap.distance)} away`}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 pt-2.5 pb-1">
      {status && <div className="mb-2 flex min-h-9 items-center">{status}</div>}
      <CapturePads capture={capture} compact />
    </div>
  );
}
