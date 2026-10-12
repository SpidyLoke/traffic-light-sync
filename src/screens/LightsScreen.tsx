import { useState } from 'react';
import { Button, Card, Field, GpsBadge, inputCls, Screen } from '../components/ui';
import { fmtDist } from '../lib/format';
import { distanceM, toXY } from '../lib/geo';
import { bestInsertIndex, DIR_ARROW, directionLabel, orderedLights } from '../lib/road';
import type { Light, Road } from '../lib/types';
import { href } from '../router';
import { useData } from '../state/DataContext';
import { stationaryAverage, useGeo, type Fix } from '../state/GeoContext';

export function LightsScreen() {
  const data = useData();
  const geo = useGeo();
  const { roads, lights, observations } = data;
  const [roadId, setRoadId] = useState<string | null>(null);
  const road = roads.find((r) => r.id === roadId) ?? roads[0];
  const chain = road ? orderedLights(lights, road.id) : [];
  const [pending, setPending] = useState<{ fix: Fix; name: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const startAdd = () => {
    const f = stationaryAverage(geo.recent);
    if (!f || Date.now() - f.at > 10000) return setMsg('No recent GPS fix yet.');
    setMsg(null);
    setPending({ fix: f, name: `Light ${chain.length + 1}` });
  };

  const saveAdd = async () => {
    if (!pending) return;
    const r = road ?? (await data.addRoad('My road'));
    const current = orderedLights(data.lights, r.id);
    const idx = bestInsertIndex(current, pending.fix);
    // Shift everything after the insert point, then add.
    await data.updateLights(current.slice(idx).map((l, k) => ({ id: l.id, patch: { order: idx + k + 1 } })));
    await data.addLight({
      roadId: r.id,
      name: pending.name.trim() || `Light ${current.length + 1}`,
      lat: pending.fix.lat,
      lng: pending.fix.lng,
      accuracy: pending.fix.accuracy,
      order: idx,
      directions: { fwd: true, rev: true },
    });
    setRoadId(r.id);
    setMsg(
      idx === current.length ? `Added as #${idx + 1}.` : `Added as #${idx + 1} (between existing lights). Reorder if that's wrong.`,
    );
    setPending(null);
  };

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= chain.length) return;
    const next = [...chain];
    [next[i], next[j]] = [next[j], next[i]];
    data.updateLights(next.map((l, k) => ({ id: l.id, patch: { order: k } })));
  };

  const repin = (l: Light) => {
    const f = stationaryAverage(geo.recent);
    if (!f || Date.now() - f.at > 10000) return setMsg('No recent GPS fix yet.');
    const d = distanceM(f, l);
    if (!confirm(`Move "${l.name}" to where you are now? That's ${fmtDist(d)} from its current pin (GPS ±${Math.round(f.accuracy)} m).`))
      return;
    data.updateLights([{ id: l.id, patch: { lat: f.lat, lng: f.lng, accuracy: f.accuracy } }]);
  };

  const del = (l: Light) => {
    const n = observations.filter((o) => o.lightId === l.id).length;
    if (!confirm(`Delete "${l.name}" and its ${n} observation${n === 1 ? '' : 's'}?`)) return;
    data.deleteLight(l.id).then(() => {
      const rest = orderedLights(data.lights, l.roadId).filter((x) => x.id !== l.id);
      data.updateLights(rest.map((x, k) => ({ id: x.id, patch: { order: k } })));
    });
  };

  return (
    <Screen title="Lights" right={<GpsBadge status={geo.status} accuracy={geo.fix?.accuracy} />}>
      {roads.length > 1 && (
        <div className="mb-3 flex gap-2 overflow-x-auto">
          {roads.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoadId(r.id)}
              className={`min-h-11 shrink-0 rounded-xl border-2 px-3 font-bold ${r.id === road?.id ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      {pending ? (
        <Card className="mb-3 border-accent">
          <Field label="Name this light" hint={`Pinned at GPS ±${Math.round(pending.fix.accuracy)} m`}>
            <input
              autoFocus
              className={inputCls}
              value={pending.name}
              onChange={(e) => setPending({ ...pending, name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && saveAdd()}
            />
          </Field>
          {pending.fix.accuracy > 20 && (
            <p className="mt-2 font-bold text-warn">GPS is rough right now. Consider waiting a few seconds and re-pinning later.</p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveAdd}>
              Save
            </Button>
          </div>
        </Card>
      ) : (
        <Button variant="primary" className="mb-3 min-h-16 w-full text-xl" onClick={startAdd} disabled={geo.status !== 'active'}>
          ✚ Add light here
        </Button>
      )}
      {msg && <p className="mb-3 text-base font-bold text-accent">{msg}</p>}

      {road && <RoadEditor road={road} chain={chain} />}

      {chain.length > 0 && <Schematic chain={chain} me={geo.fix} />}

      <div className="space-y-2">
        {chain.map((l, i) => {
          const n = observations.filter((o) => o.lightId === l.id).length;
          return (
            <Card key={l.id} className="py-3">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-lg font-black">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {editing === l.id ? (
                    <input
                      autoFocus
                      className={inputCls}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => {
                        if (editName.trim()) data.updateLights([{ id: l.id, patch: { name: editName.trim() } }]);
                        setEditing(null);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  ) : (
                    <a href={href({ name: 'light', id: l.id })} className="block truncate text-xl font-extrabold underline-offset-4 active:underline">
                      {l.name}
                    </a>
                  )}
                  <div className="text-sm text-muted">
                    {i > 0 ? `${fmtDist(distanceM(chain[i - 1], l))} from #${i}` : 'Start of road'} · {n} obs
                    {geo.fix ? ` · ${fmtDist(distanceM(geo.fix, l))} from you` : ''}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button className="min-w-12" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">
                  ↑
                </Button>
                <Button className="min-w-12" onClick={() => move(i, 1)} disabled={i === chain.length - 1} title="Move down">
                  ↓
                </Button>
                <Button
                  onClick={() => {
                    setEditing(l.id);
                    setEditName(l.name);
                  }}
                >
                  Rename
                </Button>
                <Button onClick={() => repin(l)} disabled={geo.status !== 'active'}>
                  Re-pin
                </Button>
                <Button variant="danger" onClick={() => del(l)}>
                  Delete
                </Button>
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span className="text-muted">Has a signal for:</span>
                {(['fwd', 'rev'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      data.updateLights([{ id: l.id, patch: { directions: { ...l.directions, [d]: !l.directions[d] } } }])
                    }
                    className={`min-h-10 rounded-lg border-2 px-2 font-bold ${l.directions[d] ? 'border-go text-go' : 'border-line text-muted line-through'}`}
                  >
                    {DIR_ARROW[d]} {d === 'fwd' ? 'Fwd' : 'Rev'}
                  </button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      {!chain.length && !pending && (
        <Card>
          <p className="text-lg">
            Drive the road, stop near each light, and tap <b>Add light here</b>. Add them in any order: each new light is slotted where it
            fits along the road.
          </p>
        </Card>
      )}

      <div className="mt-4 flex gap-2">
        <Button
          onClick={async () => {
            const name = prompt('Name of the new road?');
            if (name?.trim()) setRoadId((await data.addRoad(name.trim())).id);
          }}
        >
          + New road
        </Button>
        {road && (
          <Button
            variant="danger"
            onClick={() => {
              if (confirm(`Delete road "${road.name}" with all its lights and observations?`)) data.deleteRoad(road.id);
            }}
          >
            Delete road
          </Button>
        )}
      </div>
    </Screen>
  );
}

function RoadEditor({ road, chain }: { road: Road; chain: Light[] }) {
  const { updateRoad } = useData();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mb-3 w-full text-left">
        <div className="text-2xl font-black">{road.name}</div>
        <div className="text-sm text-muted">
          → {directionLabel(road, chain, 'fwd')} · ← {directionLabel(road, chain, 'rev')} · <span className="text-accent underline">edit</span>
        </div>
      </button>
    );
  }
  return (
    <Card className="mb-3 space-y-3">
      <Field label="Road name">
        <input className={inputCls} defaultValue={road.name} onBlur={(e) => e.target.value.trim() && updateRoad(road.id, { name: e.target.value.trim() })} />
      </Field>
      <Field label="→ Forward direction (towards the last light) name" hint="e.g. Towards Shah Alam. Leave blank for automatic.">
        <input className={inputCls} defaultValue={road.fwdLabel ?? ''} onBlur={(e) => updateRoad(road.id, { fwdLabel: e.target.value.trim() })} />
      </Field>
      <Field label="← Reverse direction name">
        <input className={inputCls} defaultValue={road.revLabel ?? ''} onBlur={(e) => updateRoad(road.id, { revLabel: e.target.value.trim() })} />
      </Field>
      <Button onClick={() => setOpen(false)}>Done</Button>
    </Card>
  );
}

/** Bird's-eye sketch of the lights and you, north up. */
function Schematic({ chain, me }: { chain: Light[]; me: Fix | null }) {
  const origin = chain[0];
  const pts = chain.map((l) => toXY(origin, l));
  const mePt = me && distanceM(me, origin) < 20000 ? toXY(origin, me) : null;
  const all = mePt ? [...pts, mePt] : pts;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const W = 320;
  const H = 180;
  const pad = 22;
  const scale = Math.min((W - 2 * pad) / Math.max(maxX - minX, 50), (H - 2 * pad) / Math.max(maxY - minY, 50));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const sx = (x: number) => W / 2 + (x - cx) * scale;
  const sy = (y: number) => H / 2 - (y - cy) * scale;
  return (
    <Card className="mb-3 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Map sketch of registered lights">
        <polyline
          points={pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
          fill="none"
          stroke="var(--border)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {pts.map((p, i) => (
          <g key={chain[i].id}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={11} fill="var(--surface-2)" stroke="var(--fg)" strokeWidth={2} />
            <text x={sx(p.x)} y={sy(p.y) + 5} textAnchor="middle" fontSize={13} fontWeight={800} fill="var(--fg)">
              {i + 1}
            </text>
          </g>
        ))}
        {mePt && <circle cx={sx(mePt.x)} cy={sy(mePt.y)} r={7} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />}
        <text x={W - 8} y={16} textAnchor="end" fontSize={12} fill="var(--muted)">
          N ↑
        </text>
      </svg>
    </Card>
  );
}
