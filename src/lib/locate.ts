import { distanceM, type LatLng } from './geo';
import { directionFromHeading, orderedLights, projectOntoRoad, tangentAt, type RoadPosition } from './road';
import type { Direction, Light, Road } from './types';

export interface Snap {
  light: Light;
  road: Road;
  chain: Light[];
  index: number;
  distance: number;
}

export function nearestLight(lights: Light[], roads: Road[], p: LatLng): Snap | null {
  let best: Snap | null = null;
  for (const road of roads) {
    const chain = orderedLights(lights, road.id);
    chain.forEach((light, index) => {
      const d = distanceM(p, light);
      if (!best || d < best.distance) best = { light, road, chain, index, distance: d };
    });
  }
  return best;
}

export type DirSource = 'manual' | 'heading' | 'position' | 'single' | 'none';
export type DirOverride = 'auto' | Direction;

const HEADING_MAX_AGE = 3 * 60 * 1000;

export function headingFresh(headingAt: number | null, now: number) {
  return headingAt != null && now - headingAt < HEADING_MAX_AGE;
}

/** Which way you're travelling at a snapped light. */
export function directionAtLight(
  snap: Snap,
  p: LatLng & { accuracy?: number },
  heading: number | null,
  headingAt: number | null,
  now: number,
  override: DirOverride,
): { dir: Direction | null; source: DirSource } {
  const { light, chain, index, road } = snap;
  const enabled = (['fwd', 'rev'] as const).filter((d) => light.directions[d]);
  if (override !== 'auto') return { dir: override, source: 'manual' };
  if (enabled.length === 1) return { dir: enabled[0], source: 'single' };
  const tangent = tangentAt(chain, index);
  if (tangent == null) return { dir: null, source: 'none' };
  if (heading != null && headingFresh(headingAt, now)) return { dir: directionFromHeading(tangent, heading), source: 'heading' };
  // Fallback: which side of the light you're queued on.
  const pos = projectOntoRoad(road, chain, p);
  if (pos) {
    const delta = pos.along - pos.lightAlong[index];
    if (Math.abs(delta) > Math.max(12, p.accuracy ?? 0)) return { dir: delta < 0 ? 'fwd' : 'rev', source: 'position' };
  }
  return { dir: null, source: 'none' };
}

/** The road you're on (closest line through its lights). */
export function locateOnRoads(lights: Light[], roads: Road[], p: LatLng): RoadPosition | null {
  let best: RoadPosition | null = null;
  for (const road of roads) {
    const pos = projectOntoRoad(road, orderedLights(lights, road.id), p);
    if (pos && (!best || pos.lateral < best.lateral)) best = pos;
  }
  return best;
}

export interface AheadLight {
  light: Light;
  index: number;
  /** Along-road distance from you, metres. */
  distance: number;
}

/** Lights still ahead in a direction, nearest first. A light stays "ahead" until you're 10 m past it. */
export function lightsAhead(pos: RoadPosition, dir: Direction): AheadLight[] {
  const out: AheadLight[] = [];
  pos.chain.forEach((light, index) => {
    if (!light.directions[dir]) return;
    const d = dir === 'fwd' ? pos.lightAlong[index] - pos.along : pos.along - pos.lightAlong[index];
    if (d > -10) out.push({ light, index, distance: Math.max(0, d) });
  });
  return out.sort((a, b) => a.distance - b.distance);
}
