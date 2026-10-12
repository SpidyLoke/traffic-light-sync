import { bandFor } from './bands';
import { offset as move, type LatLng } from './geo';
import { mod } from './model/fit';
import type { Direction, Light, Observation, Road, Settings } from './types';
import { uuid } from './uuid';

// Generates a fake road with synthetic taps so every screen can be tried without driving.
// Lights 1, 2 and 4 are fixed-time (a green wave); light 3 is actuated, to show the
// "not fixed-time" verdict.

const BAND_CYCLE: Record<string, number> = { 'am-peak': 140, 'pm-peak': 150, night: 80, 'off-peak': 120 };

export function makeDemo(origin: LatLng, settings: Settings, deviceId: string) {
  const now = Date.now();
  const road: Road = {
    id: uuid(),
    name: 'Demo road',
    fwdLabel: 'Northbound',
    revLabel: 'Southbound',
    demo: true,
    createdAt: now,
    updatedAt: now,
  };
  const names = ['Demo 1: School', 'Demo 2: Petronas', 'Demo 3: Mosque', 'Demo 4: Mall'];
  const lights: Light[] = names.map((name, i) => {
    const p = move(origin, 20, 120 + i * 380);
    return {
      id: uuid(),
      roadId: road.id,
      name,
      lat: p.lat,
      lng: p.lng,
      accuracy: 5,
      order: i,
      directions: { fwd: true, rev: true },
      createdAt: now,
      updatedAt: now,
    };
  });

  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const observations: Observation[] = [];
  const bandIds = settings.bands.map((b) => b.id);
  const epoch = Math.floor(now / 1000 / 86400) * 86400; // midnight UTC today

  lights.forEach((light, li) => {
    (['fwd', 'rev'] as Direction[]).forEach((dir) => {
      const counts: Record<string, number> = {};
      let guard = 0;
      while (bandIds.some((b) => (counts[b] ?? 0) < 18) && guard++ < 20000) {
        const T = now / 1000 - 400 - rand() * 7 * 86400;
        const band = bandFor(settings.bands, T * 1000);
        if ((counts[band.id] ?? 0) >= 18) continue;
        counts[band.id] = (counts[band.id] ?? 0) + 1;

        const C = BAND_CYCLE[band.id] ?? 110;
        const G = dir === 'fwd' ? Math.round(C * 0.45) : Math.round(C * 0.3);
        const off = epoch + li * 27 + (dir === 'rev' ? Math.round(C * 0.5) : 0);
        const noise = () => 0.2 + rand() * 1.0; // human lag after the change
        const at = (t: number, kind: Observation['kind']) => {
          const p = move(light, dir === 'fwd' ? 200 : 20, 15 + rand() * 25);
          observations.push({
            id: uuid(),
            lightId: light.id,
            direction: dir,
            kind,
            t: Math.round(t * 1000),
            lat: p.lat,
            lng: p.lng,
            accuracy: 6,
            heading: dir === 'fwd' ? 20 : 200,
            speed: 0,
            distanceM: 25,
            driverId: 'demo',
            deviceId,
            createdAt: now,
            updatedAt: now,
          });
        };

        if (li === 2) {
          // Actuated: green comes whenever the sensor decides.
          at(T, 'alreadyRed');
          at(T + 5 + rand() * 60, 'turnedGreen');
          continue;
        }
        const p = mod(T - off, C);
        if (p < G) {
          at(T, 'alreadyGreen');
          if (rand() < 0.35) at(T - p + G + noise(), 'turnedRed');
        } else {
          at(T, 'alreadyRed');
          at(T - p + C + noise(), 'turnedGreen');
        }
      }
    });
  });
  return { road, lights, observations };
}
