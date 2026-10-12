import { angleDiff, bearingDeg, distanceM, toXY, type LatLng } from './geo';
import type { Direction, Light, Road } from './types';

/** Lights of one road sorted along the road (the 'fwd' direction). */
export function orderedLights(lights: Light[], roadId: string): Light[] {
  return lights.filter((l) => l.roadId === roadId).sort((a, b) => a.order - b.order);
}

/** Cumulative distance along the chain of lights, in metres, per light. */
export function chainDistances(chain: Light[]): number[] {
  const out: number[] = [];
  let acc = 0;
  chain.forEach((l, i) => {
    if (i > 0) acc += distanceM(chain[i - 1], l);
    out.push(acc);
  });
  return out;
}

/** Direction of the road (fwd) at a light, from its neighbours. Null if the road has < 2 lights. */
export function tangentAt(chain: Light[], index: number): number | null {
  if (chain.length < 2) return null;
  const a = chain[Math.max(0, index - 1)];
  const b = chain[Math.min(chain.length - 1, index + 1)];
  return bearingDeg(a, b);
}

export function directionFromHeading(roadBearing: number, heading: number): Direction {
  return angleDiff(roadBearing, heading) <= 90 ? 'fwd' : 'rev';
}

export interface RoadPosition {
  road: Road;
  chain: Light[];
  /** Distance along the road from the first light, metres. Can be negative or beyond the end. */
  along: number;
  /** Perpendicular distance from the road line, metres. */
  lateral: number;
  /** Bearing of the road (fwd) at this point. */
  bearing: number;
  /** Cumulative along-road distance of each light in `chain`. */
  lightAlong: number[];
}

/** Project a position onto the polyline of a road's lights. */
export function projectOntoRoad(road: Road, chain: Light[], p: LatLng): RoadPosition | null {
  if (chain.length < 2) return null;
  const lightAlong = chainDistances(chain);
  let best: RoadPosition | null = null;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = toXY(p, chain[i]);
    const b = toXY(p, chain[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = (-a.x * dx - a.y * dy) / len2; // p is the origin (0,0)
    // Only the end segments may extend past the first/last light.
    if (i > 0) t = Math.max(0, t);
    if (i < chain.length - 2) t = Math.min(1, t);
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const lateral = Math.hypot(px, py);
    if (!best || lateral < best.lateral) {
      best = {
        road,
        chain,
        along: lightAlong[i] + t * Math.sqrt(len2),
        lateral,
        bearing: bearingDeg(chain[i], chain[i + 1]),
        lightAlong,
      };
    }
  }
  return best;
}

/** Where a new light should go in the chain: the slot that adds the least path length. */
export function bestInsertIndex(chain: Light[], p: LatLng): number {
  if (chain.length < 2) return chain.length;
  let bestIdx = chain.length;
  let bestCost = Infinity;
  for (let i = 0; i <= chain.length; i++) {
    let cost: number;
    if (i === 0) cost = distanceM(p, chain[0]);
    else if (i === chain.length) cost = distanceM(chain[chain.length - 1], p);
    else cost = distanceM(chain[i - 1], p) + distanceM(p, chain[i]) - distanceM(chain[i - 1], chain[i]);
    if (cost < bestCost) {
      bestCost = cost;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function directionLabel(road: Road | undefined, chain: Light[], dir: Direction): string {
  if (dir === 'fwd') return road?.fwdLabel?.trim() || (chain.length ? `Towards ${chain[chain.length - 1].name}` : 'Forward');
  return road?.revLabel?.trim() || (chain.length ? `Towards ${chain[0].name}` : 'Reverse');
}

export const DIR_ARROW: Record<Direction, string> = { fwd: '→', rev: '←' };
