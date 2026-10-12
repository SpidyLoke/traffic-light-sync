// Domain model. Kept deliberately plain and sync-friendly:
// every record has a stable UUID, created/updated timestamps and a soft-delete
// tombstone, and observations carry who captured them. That is enough to add
// multi-driver sharing later without migrating the shape of the data.

export type Direction = 'fwd' | 'rev';
export type ObservationKind = 'turnedGreen' | 'alreadyGreen' | 'turnedRed' | 'alreadyRed';

export interface Road {
  id: string;
  name: string;
  /** Optional names for the two directions, e.g. "Towards Shah Alam". */
  fwdLabel?: string;
  revLabel?: string;
  demo?: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface Light {
  id: string;
  roadId: string;
  name: string;
  lat: number;
  lng: number;
  /** GPS accuracy (m) when the light was pinned. */
  accuracy?: number;
  /** Position along the road. Lower comes first in the 'fwd' direction. */
  order: number;
  /** Which directions of travel actually face a signal at this light. */
  directions: { fwd: boolean; rev: boolean };
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface Observation {
  id: string;
  lightId: string;
  /** Null until the direction of travel is known or assigned by hand. */
  direction: Direction | null;
  kind: ObservationKind;
  /** Device clock at the moment of the tap, epoch milliseconds. */
  t: number;
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number | null;
  speed?: number | null;
  /** Distance from the snapped light when tapped (m). */
  distanceM: number;
  /** Who captured it. Always 'me' for now; ready for shared data later. */
  driverId: string;
  deviceId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface TimeBand {
  id: string;
  name: string;
  /** 0 = Sunday ... 6 = Saturday. */
  days: number[];
  /** Minutes after local midnight. If end <= start the band wraps past midnight. */
  startMin: number;
  endMin: number;
  /** The catch-all band used when no other band matches. Exactly one exists. */
  fallback?: boolean;
}

export interface Settings {
  snapRadiusM: number;
  /** Tolerance (s) for reaction time when matching observations to a model. */
  toleranceS: number;
  /** Typical delay (s) between a light changing and your tap. Subtracted from "Just turned" taps. */
  reactionLagS: number;
  minCycleS: number;
  maxCycleS: number;
  cycleStepS: number;
  bands: TimeBand[];
  theme: 'dark' | 'light';
}

export interface ExportFile {
  app: 'traffic-light-sync';
  schemaVersion: number;
  exportedAt: string;
  deviceId: string;
  roads: Road[];
  lights: Light[];
  observations: Observation[];
  settings: Settings;
}

export const KIND_LABEL: Record<ObservationKind, string> = {
  turnedGreen: 'Just turned green',
  alreadyGreen: 'Already green',
  turnedRed: 'Just turned red',
  alreadyRed: 'Already red',
};

export const DEFAULT_BANDS: TimeBand[] = [
  { id: 'am-peak', name: 'AM peak', days: [1, 2, 3, 4, 5], startMin: 7 * 60, endMin: 9 * 60 + 30 },
  { id: 'pm-peak', name: 'PM peak', days: [1, 2, 3, 4, 5], startMin: 17 * 60, endMin: 20 * 60 },
  { id: 'night', name: 'Night', days: [0, 1, 2, 3, 4, 5, 6], startMin: 23 * 60, endMin: 6 * 60 },
  { id: 'off-peak', name: 'Off-peak', days: [0, 1, 2, 3, 4, 5, 6], startMin: 0, endMin: 0, fallback: true },
];

export const DEFAULT_SETTINGS: Settings = {
  snapRadiusM: 50,
  toleranceS: 2,
  reactionLagS: 0.5,
  minCycleS: 30,
  maxCycleS: 300,
  cycleStepS: 0.5,
  bands: DEFAULT_BANDS,
  theme: 'dark',
};

export const SCHEMA_VERSION = 1;
