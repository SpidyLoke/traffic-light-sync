import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as store from '../lib/db';
import { uuid } from '../lib/uuid';
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  type Direction,
  type ExportFile,
  type Light,
  type Observation,
  type Road,
  type Settings,
} from '../lib/types';

interface DataState {
  ready: boolean;
  deviceId: string;
  /** Live (not deleted) records. */
  roads: Road[];
  lights: Light[];
  observations: Observation[];
  settings: Settings;
  addRoad(name: string, demo?: boolean): Promise<Road>;
  updateRoad(id: string, patch: Partial<Road>): Promise<void>;
  deleteRoad(id: string): Promise<void>;
  addLight(l: Omit<Light, 'id' | 'createdAt' | 'updatedAt'>): Promise<Light>;
  updateLights(updates: { id: string; patch: Partial<Light> }[]): Promise<void>;
  deleteLight(id: string): Promise<void>;
  addObservation(o: Omit<Observation, 'id' | 'createdAt' | 'updatedAt' | 'driverId' | 'deviceId'>): Promise<Observation>;
  deleteObservation(id: string): Promise<void>;
  setObservationDirection(id: string, dir: Direction): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  exportData(): ExportFile;
  importData(file: ExportFile, mode: 'merge' | 'replace'): Promise<{ added: number; updated: number }>;
  bulkInsert(roads: Road[], lights: Light[], observations: Observation[]): Promise<void>;
  wipe(): Promise<void>;
}

const Ctx = createContext<DataState | null>(null);

export function useData(): DataState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useData outside provider');
  return c;
}

const live = <T extends { deletedAt?: number }>(xs: T[]) => xs.filter((x) => !x.deletedAt);

export function DataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  // All records including tombstones, so that deletions survive export/import (and later, sync).
  const [roadsAll, setRoadsAll] = useState<Road[]>([]);
  const [lightsAll, setLightsAll] = useState<Light[]>([]);
  const [obsAll, setObsAll] = useState<Observation[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    store.loadAll().then(async (d) => {
      let id = d.deviceId;
      if (!id) {
        id = uuid();
        await store.putKV('deviceId', id);
      }
      setDeviceId(id);
      setRoadsAll(d.roads);
      setLightsAll(d.lights);
      setObsAll(d.observations.sort((a, b) => a.t - b.t));
      if (d.settings) setSettings({ ...DEFAULT_SETTINGS, ...d.settings });
      setReady(true);
    });
  }, []);

  const upsert = <T extends { id: string }>(xs: T[], items: T[]) => {
    const m = new Map(xs.map((x) => [x.id, x]));
    items.forEach((i) => m.set(i.id, i));
    return [...m.values()];
  };

  const addRoad = useCallback(async (name: string, demo?: boolean) => {
    const now = Date.now();
    const r: Road = { id: uuid(), name, demo, createdAt: now, updatedAt: now };
    await store.putRoads([r]);
    setRoadsAll((xs) => [...xs, r]);
    store.requestPersistence();
    return r;
  }, []);

  const updateRoad = useCallback(
    async (id: string, patch: Partial<Road>) => {
      const r = roadsAll.find((x) => x.id === id);
      if (!r) return;
      const next = { ...r, ...patch, updatedAt: Date.now() };
      await store.putRoads([next]);
      setRoadsAll((xs) => upsert(xs, [next]));
    },
    [roadsAll],
  );

  const deleteLightsAndObs = async (lightIds: Set<string>, now: number) => {
    const ls = lightsAll.filter((l) => lightIds.has(l.id) && !l.deletedAt).map((l) => ({ ...l, deletedAt: now, updatedAt: now }));
    const os = obsAll.filter((o) => lightIds.has(o.lightId) && !o.deletedAt).map((o) => ({ ...o, deletedAt: now, updatedAt: now }));
    await store.putLights(ls);
    await store.putObservations(os);
    setLightsAll((xs) => upsert(xs, ls));
    setObsAll((xs) => upsert(xs, os));
  };

  const deleteRoad = useCallback(
    async (id: string) => {
      const r = roadsAll.find((x) => x.id === id);
      if (!r) return;
      const now = Date.now();
      await deleteLightsAndObs(new Set(lightsAll.filter((l) => l.roadId === id).map((l) => l.id)), now);
      const next = { ...r, deletedAt: now, updatedAt: now };
      await store.putRoads([next]);
      setRoadsAll((xs) => upsert(xs, [next]));
    },
    [roadsAll, lightsAll, obsAll],
  );

  const addLight = useCallback(async (l: Omit<Light, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now();
    const light: Light = { ...l, id: uuid(), createdAt: now, updatedAt: now };
    await store.putLights([light]);
    setLightsAll((xs) => [...xs, light]);
    return light;
  }, []);

  const updateLights = useCallback(
    async (updates: { id: string; patch: Partial<Light> }[]) => {
      const now = Date.now();
      const next = updates
        .map((u) => {
          const l = lightsAll.find((x) => x.id === u.id);
          return l ? { ...l, ...u.patch, updatedAt: now } : null;
        })
        .filter((x): x is Light => !!x);
      await store.putLights(next);
      setLightsAll((xs) => upsert(xs, next));
    },
    [lightsAll],
  );

  const deleteLight = useCallback(
    (id: string) => deleteLightsAndObs(new Set([id]), Date.now()),
    [lightsAll, obsAll],
  );

  const addObservation = useCallback(
    async (o: Omit<Observation, 'id' | 'createdAt' | 'updatedAt' | 'driverId' | 'deviceId'>) => {
      const now = Date.now();
      const obs: Observation = { ...o, id: uuid(), driverId: 'me', deviceId, createdAt: now, updatedAt: now };
      setObsAll((xs) => [...xs, obs]);
      await store.putObservations([obs]);
      return obs;
    },
    [deviceId],
  );

  const patchObservation = useCallback(
    async (id: string, patch: Partial<Observation>) => {
      const base = obsAll.find((o) => o.id === id);
      if (!base) return;
      const next = { ...base, ...patch, updatedAt: Date.now() };
      setObsAll((xs) => xs.map((o) => (o.id === id ? next : o)));
      await store.putObservations([next]);
    },
    [obsAll],
  );

  const deleteObservation = useCallback((id: string) => patchObservation(id, { deletedAt: Date.now() }), [patchObservation]);
  const setObservationDirection = useCallback(
    (id: string, direction: Direction) => patchObservation(id, { direction }),
    [patchObservation],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      await store.putKV('settings', next);
    },
    [settings],
  );

  const exportData = useCallback(
    (): ExportFile => ({
      app: 'traffic-light-sync',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      deviceId,
      roads: roadsAll,
      lights: lightsAll,
      observations: obsAll,
      settings,
    }),
    [deviceId, roadsAll, lightsAll, obsAll, settings],
  );

  const importData = useCallback(
    async (file: ExportFile, mode: 'merge' | 'replace') => {
      if (file.app !== 'traffic-light-sync') throw new Error('Not a Traffic Light Sync export file.');
      if (file.schemaVersion > SCHEMA_VERSION) throw new Error('This file is from a newer version of the app.');
      let added = 0;
      let updated = 0;
      // Merge: newest updatedAt wins per record, which is also how multi-device sync would work.
      const merge = <T extends { id: string; updatedAt: number }>(cur: T[], inc: T[]) => {
        const m = new Map(cur.map((x) => [x.id, x]));
        const changed: T[] = [];
        for (const x of inc) {
          const c = m.get(x.id);
          if (!c) added++;
          else if (x.updatedAt > c.updatedAt) updated++;
          else continue;
          m.set(x.id, x);
          changed.push(x);
        }
        return { all: [...m.values()], changed };
      };
      if (mode === 'replace') {
        await store.clearAll();
        await store.putRoads(file.roads);
        await store.putLights(file.lights);
        await store.putObservations(file.observations);
        setRoadsAll(file.roads);
        setLightsAll(file.lights);
        setObsAll([...file.observations].sort((a, b) => a.t - b.t));
        added = file.roads.length + file.lights.length + file.observations.length;
        if (file.settings) {
          const s = { ...DEFAULT_SETTINGS, ...file.settings };
          setSettings(s);
          await store.putKV('settings', s);
        }
      } else {
        const r = merge(roadsAll, file.roads);
        const l = merge(lightsAll, file.lights);
        const o = merge(obsAll, file.observations);
        await store.putRoads(r.changed);
        await store.putLights(l.changed);
        await store.putObservations(o.changed);
        setRoadsAll(r.all);
        setLightsAll(l.all);
        setObsAll(o.all.sort((a, b) => a.t - b.t));
      }
      store.requestPersistence();
      return { added, updated };
    },
    [roadsAll, lightsAll, obsAll],
  );

  const bulkInsert = useCallback(async (roads: Road[], lights: Light[], observations: Observation[]) => {
    await store.putRoads(roads);
    await store.putLights(lights);
    await store.putObservations(observations);
    setRoadsAll((xs) => upsert(xs, roads));
    setLightsAll((xs) => upsert(xs, lights));
    setObsAll((xs) => upsert(xs, observations).sort((a, b) => a.t - b.t));
  }, []);

  const wipe = useCallback(async () => {
    await store.clearAll();
    setRoadsAll([]);
    setLightsAll([]);
    setObsAll([]);
  }, []);

  const value = useMemo<DataState>(
    () => ({
      ready,
      deviceId,
      roads: live(roadsAll),
      lights: live(lightsAll),
      observations: live(obsAll),
      settings,
      addRoad,
      updateRoad,
      deleteRoad,
      addLight,
      updateLights,
      deleteLight,
      addObservation,
      deleteObservation,
      setObservationDirection,
      updateSettings,
      exportData,
      importData,
      bulkInsert,
      wipe,
    }),
    [ready, deviceId, roadsAll, lightsAll, obsAll, settings, addRoad, updateRoad, deleteRoad, addLight, updateLights, deleteLight, addObservation, deleteObservation, setObservationDirection, updateSettings, exportData, importData, bulkInsert, wipe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
