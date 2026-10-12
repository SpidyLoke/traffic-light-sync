import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card, Field, inputCls, Screen } from '../components/ui';
import { DAY_SHORT, describeBand, hhmmToMin, minToHHMM } from '../lib/bands';
import { makeDemo } from '../lib/demo';
import { requestPersistence } from '../lib/db';
import type { ExportFile, Settings, TimeBand } from '../lib/types';
import { DEFAULT_BANDS } from '../lib/types';
import { uuid } from '../lib/uuid';
import { useData } from '../state/DataContext';
import { useGeo } from '../state/GeoContext';

function NumberSetting({
  label,
  hint,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Field label={label} hint={hint}>
      <input
        className={inputCls}
        inputMode="decimal"
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = Number(text);
          if (isFinite(v) && (min == null || v >= min) && (max == null || v <= max)) onChange(v);
          else setText(String(value));
        }}
      />
    </Field>
  );
}

export function SettingsScreen() {
  const data = useData();
  const geo = useGeo();
  const { settings, updateSettings } = data;
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted);
  }, []);

  const set = (patch: Partial<Settings>) => updateSettings(patch);

  const doExport = () => {
    const file = data.exportData();
    const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `traffic-light-sync-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setMsg(`Exported ${file.lights.length} lights and ${file.observations.length} observations.`);
  };

  const doImport = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text()) as ExportFile;
      if (importMode === 'replace' && !confirm('Replace ALL data on this phone with the file contents?')) return;
      const r = await data.importData(parsed, importMode);
      setMsg(`Imported: ${r.added} new, ${r.updated} updated records.`);
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    }
  };

  const demoRoads = data.roads.filter((r) => r.demo);
  const loadDemo = async () => {
    const origin = geo.fix ?? { lat: 3.1073, lng: 101.6067 };
    const d = makeDemo(origin, settings, data.deviceId);
    await data.bulkInsert([d.road], d.lights, d.observations);
    setMsg(`Demo road added ${geo.fix ? 'starting near you' : 'in Petaling Jaya (no GPS fix)'}: 4 lights, ${d.observations.length} synthetic taps.`);
  };

  return (
    <Screen title="More">
      {msg && <p className="mb-3 rounded-xl border-2 border-accent p-3 font-bold text-accent">{msg}</p>}

      <Section title="Display">
        <div className="grid grid-cols-2 gap-2">
          {(['dark', 'light'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ theme: t })}
              className={`min-h-12 rounded-xl border-2 font-bold ${settings.theme === t ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}
            >
              {t === 'dark' ? 'Dark' : 'Sunlight (light)'}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Data">
        <p className="mb-3 text-base text-muted">
          {data.lights.length} lights · {data.observations.length} observations. Stored only on this phone.{' '}
          {persisted === true ? 'Protected from automatic clean-up.' : persisted === false ? 'Browser may clear it under storage pressure.' : ''}
        </p>
        {persisted === false && (
          <Button className="mb-3 w-full" onClick={() => requestPersistence().then((p) => setPersisted(!!p))}>
            Ask browser to keep data permanently
          </Button>
        )}
        <Button variant="primary" className="mb-3 w-full" onClick={doExport}>
          Export all data (JSON)
        </Button>
        <div className="mb-2 grid grid-cols-2 gap-2">
          {(['merge', 'replace'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setImportMode(m)}
              className={`min-h-11 rounded-xl border-2 text-sm font-bold ${importMode === m ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}
            >
              {m === 'merge' ? 'Merge with existing' : 'Replace everything'}
            </button>
          ))}
        </div>
        <Button className="w-full" onClick={() => fileRef.current?.click()}>
          Import from file…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doImport(f);
            e.target.value = '';
          }}
        />
      </Section>

      <Section title="Capture & model">
        <div className="space-y-3">
          <NumberSetting label="Snap radius (m)" hint="Taps further than this from every light are ignored." value={settings.snapRadiusM} min={5} max={500} onChange={(v) => set({ snapRadiusM: v })} />
          <NumberSetting
            label="Reaction tolerance (s)"
            hint="How far off a tap can be and still count as agreeing with a model."
            value={settings.toleranceS}
            step={0.1}
            min={0.3}
            max={10}
            onChange={(v) => set({ toleranceS: v })}
          />
          <NumberSetting
            label="Reaction lag (s)"
            hint="Your typical delay from seeing a change to tapping. Subtracted from 'Just turned' taps."
            value={settings.reactionLagS}
            step={0.1}
            min={0}
            max={3}
            onChange={(v) => set({ reactionLagS: v })}
          />
          <div className="grid grid-cols-3 gap-2">
            <NumberSetting label="Min cycle" value={settings.minCycleS} min={10} max={600} onChange={(v) => set({ minCycleS: v })} />
            <NumberSetting label="Max cycle" value={settings.maxCycleS} min={20} max={900} onChange={(v) => set({ maxCycleS: v })} />
            <NumberSetting label="Step" value={settings.cycleStepS} step={0.1} min={0.1} max={5} onChange={(v) => set({ cycleStepS: v })} />
          </div>
        </div>
      </Section>

      <Section title="Timing plans (time bands)">
        <p className="mb-3 text-base text-muted">
          Each light is fitted separately per band, because lights often run different plans at peak hours. Delete bands you don't need; with
          only the catch-all left, everything is fitted together.
        </p>
        <BandsEditor bands={settings.bands} onChange={(bands) => set({ bands })} />
      </Section>

      <Section title="Try it without driving">
        <p className="mb-3 text-base text-muted">
          Adds a fake 4-light road starting at your position with a week of synthetic taps. Light 3 behaves like a sensor-actuated light.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={loadDemo}>Load demo road</Button>
          <Button variant="danger" disabled={!demoRoads.length} onClick={() => demoRoads.forEach((r) => data.deleteRoad(r.id))}>
            Remove demo
          </Button>
        </div>
      </Section>

      <Section title="Danger zone">
        <Button
          variant="danger"
          className="w-full"
          onClick={() => {
            if (confirm('Delete ALL roads, lights and observations on this phone? Export first if unsure.') && confirm('Really delete everything?'))
              data.wipe().then(() => setMsg('All data deleted.'));
          }}
        >
          Delete all data
        </Button>
      </Section>

      <p className="mt-6 text-center text-sm text-muted">Traffic Light Sync · build {__BUILD__} · device {data.deviceId.slice(0, 8)}</p>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">{title}</h2>
      <Card>{children}</Card>
    </section>
  );
}

function BandsEditor({ bands, onChange }: { bands: TimeBand[]; onChange: (b: TimeBand[]) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const update = (id: string, patch: Partial<TimeBand>) => onChange(bands.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-2">
      {bands.map((b) => (
        <div key={b.id} className="rounded-xl border-2 border-line p-3">
          {edit === b.id ? (
            <div className="space-y-3">
              <Field label="Name">
                <input className={inputCls} value={b.name} onChange={(e) => update(b.id, { name: e.target.value })} />
              </Field>
              {!b.fallback && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_SHORT.map((d, i) => {
                      const on = b.days.includes(i);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => update(b.id, { days: on ? b.days.filter((x) => x !== i) : [...b.days, i].sort() })}
                          className={`min-h-10 min-w-12 rounded-lg border-2 text-sm font-bold ${on ? 'border-accent bg-accent text-on-accent' : 'border-line'}`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="From">
                      <input type="time" className={inputCls} value={minToHHMM(b.startMin)} onChange={(e) => update(b.id, { startMin: hhmmToMin(e.target.value) })} />
                    </Field>
                    <Field label="To">
                      <input type="time" className={inputCls} value={minToHHMM(b.endMin)} onChange={(e) => update(b.id, { endMin: hhmmToMin(e.target.value) })} />
                    </Field>
                  </div>
                </>
              )}
              <div className="flex gap-2">
                <Button onClick={() => setEdit(null)}>Done</Button>
                {!b.fallback && (
                  <Button
                    variant="danger"
                    onClick={() => {
                      onChange(bands.filter((x) => x.id !== b.id));
                      setEdit(null);
                    }}
                  >
                    Delete band
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <button type="button" className="block w-full text-left" onClick={() => setEdit(b.id)}>
              <div className="text-lg font-bold">{b.name}</div>
              <div className="text-sm text-muted">{describeBand(b)}</div>
            </button>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          onClick={() => {
            const nb: TimeBand = { id: uuid(), name: 'New band', days: [1, 2, 3, 4, 5], startMin: 12 * 60, endMin: 14 * 60 };
            // Keep the catch-all last.
            onChange([...bands.filter((x) => !x.fallback), nb, ...bands.filter((x) => x.fallback)]);
            setEdit(nb.id);
          }}
        >
          + Add band
        </Button>
        <Button onClick={() => confirm('Reset bands to the defaults?') && onChange(DEFAULT_BANDS)}>Reset</Button>
      </div>
      <p className="text-sm text-muted">Earlier bands win where they overlap.</p>
    </div>
  );
}
