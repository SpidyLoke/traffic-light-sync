import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Light, Observation, Road, Settings } from './types';

interface TLSDB extends DBSchema {
  roads: { key: string; value: Road };
  lights: { key: string; value: Light; indexes: { byRoad: string } };
  observations: { key: string; value: Observation; indexes: { byLight: string; byTime: number } };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<TLSDB>> | null = null;

export function db() {
  dbp ??= openDB<TLSDB>('traffic-light-sync', 1, {
    upgrade(d) {
      d.createObjectStore('roads', { keyPath: 'id' });
      d.createObjectStore('lights', { keyPath: 'id' }).createIndex('byRoad', 'roadId');
      const o = d.createObjectStore('observations', { keyPath: 'id' });
      o.createIndex('byLight', 'lightId');
      o.createIndex('byTime', 't');
      d.createObjectStore('kv');
    },
  });
  return dbp;
}

export async function loadAll() {
  const d = await db();
  const [roads, lights, observations, settings, deviceId] = await Promise.all([
    d.getAll('roads'),
    d.getAll('lights'),
    d.getAll('observations'),
    d.get('kv', 'settings') as Promise<Settings | undefined>,
    d.get('kv', 'deviceId') as Promise<string | undefined>,
  ]);
  return { roads, lights, observations, settings, deviceId };
}

export async function putRoads(items: Road[]) {
  const tx = (await db()).transaction('roads', 'readwrite');
  await Promise.all([...items.map((i) => tx.store.put(i)), tx.done]);
}
export async function putLights(items: Light[]) {
  const tx = (await db()).transaction('lights', 'readwrite');
  await Promise.all([...items.map((i) => tx.store.put(i)), tx.done]);
}
export async function putObservations(items: Observation[]) {
  const tx = (await db()).transaction('observations', 'readwrite');
  await Promise.all([...items.map((i) => tx.store.put(i)), tx.done]);
}
export async function putKV(key: string, value: unknown) {
  await (await db()).put('kv', value, key);
}

export async function clearAll() {
  const d = await db();
  const tx = d.transaction(['roads', 'lights', 'observations'], 'readwrite');
  await Promise.all([
    tx.objectStore('roads').clear(),
    tx.objectStore('lights').clear(),
    tx.objectStore('observations').clear(),
    tx.done,
  ]);
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
