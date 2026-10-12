# Traffic Light Sync

A mobile web app that predicts what the traffic lights ahead will be doing when you reach them, using timing taps you capture yourself. Solo proof of concept: no backend, no login. Everything lives in the phone's browser (IndexedDB).

## Hosting

Live at **https://spidyloke.github.io/traffic-light-sync/** (GitHub Pages, HTTPS, which phone browsers require before they allow GPS).

- `.github/workflows/ci.yml` runs on every push: `npm ci`, typecheck, unit tests, build. On the default branch it uploads `dist/` and deploys it to Pages.
- One-time setup: repo Settings › Pages › Source: **GitHub Actions**.
- To ship a change: push to the default branch. The site updates in about two minutes if CI is green. The app updates itself on next open; a hard refresh forces it.
- Which build is live: the footer under More shows `version+commit`, e.g. `0.1.0+c753212`.
- `base: './'` in `vite.config.ts` makes paths work under `/traffic-light-sync/`, and hash routing (`#/capture`) means no rewrite rules.

On your phone, open the URL, allow location, then Share › **Add to Home Screen**. It runs full screen and works offline after the first load.

Vercel and Netlify also work unchanged (`vercel.json`, `netlify.toml`): build `npm run build`, publish `dist`.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173 (GPS works on localhost)
npm run dev:https    # https on your LAN, to test on the phone before deploying (accept the certificate warning)
npm test             # model tests
npm run build        # static files in dist/
```

## How to use it

1. **Lights tab:** drive the road, stop near each light, tap **Add light here**, name it. Add them in any order; each one is slotted where it fits along the road. Reorder, rename, re-pin, delete, and untick a direction if a light has no signal facing that way. Optionally name the two directions (e.g. "Towards Shah Alam").
2. **Capture tab:** tap the moment you see a change. *Just turned green / Just turned red* are the valuable ones; *Already green / Already red* are cheap sanity checks (tap on arrival). Amber counts as red. Taps snap to the nearest light within 50 m and are tagged with your direction of travel (from GPS heading, or which side of the light you're queued on). Every tap shows where it landed with **Undo** and a direction fix. The screen stays awake.
3. **Predict tab:** next light ahead, its state now, countdown to the next change, and its state when you arrive at your current speed, plus the lights after it. Each has a confidence level. Tap a light for its debug view.
4. **More tab:** export/import JSON, timing bands, model settings, sunlight (light) theme, and a **demo road** to try everything without driving.

### What data it needs

Per light, per direction, per timing band:

- At least **2 "Just turned green"** taps to attempt a fit. In practice **5+** taps spread over different trips before the cycle length is unambiguous.
- At least **1 "Just turned red"** tap to pin the green duration exactly. Without one, it's estimated from "Already" taps and shown as a range.
- A few **"Already red/green"** taps. These are what rule out the model locking on to half or double the real cycle.

The usual stop gives you two taps for free: *Already red* on arrival, *Just turned green* when it goes.

## The model

Each signal (one light, one direction, one timing band) is assumed to run a fixed-time cycle: `cycle`, `offset` (a real clock time when green started) and `green` duration.

- Every candidate cycle length from 30 to 300 s in 0.5 s steps is scored. Exact divisors of short gaps between anchor taps (up to 15 min apart) are added as candidates, so non-integer cycles are found when you have taps close together.
- For each candidate, the offset is the phase most "Just turned green" taps agree on (within the ±2 s reaction tolerance), and green duration is the phase most "Just turned red" taps agree on. "Already" taps must sit in the right part of the cycle.
- The best-scoring cycle is refined to 0.0002 s. The width of the range that scores equally well becomes the cycle uncertainty, and prediction uncertainty grows with time since your last anchor tap. When it gets too wide, the app says so instead of guessing.
- Verdicts: **Not enough data**, **Ambiguous** (several different cycle lengths fit equally; it lists them), **Not fixed-time** (best fit explains under 70% of taps: sensor-actuated or adaptive, e.g. SCATS), or a fit with **High / Medium / Low** confidence.
- Reaction lag (default 0.5 s) is subtracted from "Just turned" taps. Tolerance, lag and the search range are adjustable under More.

**Timing bands:** lights often run different plans at peak hours, so each band is fitted separately. Defaults: AM peak (Mon–Fri 07:00–09:30), PM peak (Mon–Fri 17:00–20:00), Night (23:00–06:00), Off-peak (everything else). Edit them under More. Delete all but Off-peak to fit everything together. Bands are applied at fit time, so changing them re-sorts existing taps.

**Assumptions:** the offset is global across days (the controller is phase-locked to the clock). A light that re-syncs at a different point each day will show as not fixed-time. Device clock accuracy is assumed to be within a second, which holds for phones synced to network time.

## Data model

`src/lib/types.ts`. Built so shared data, a native app or CarPlay can be added later without migration:

- `Road` → ordered `Light`s (lat/lng, `order`, which directions have a signal).
- `Observation`: light, direction, kind, millisecond timestamp, GPS position/accuracy/heading/speed, distance from the light, `driverId` and `deviceId`.
- Every record has a UUID, `createdAt`/`updatedAt` and a soft-delete `deletedAt` tombstone. Import merges by id with newest `updatedAt` winning, which is the same rule a sync server would use.
- The model (`src/lib/model/`) and geometry (`src/lib/road.ts`, `src/lib/locate.ts`) are plain TypeScript with no browser or React dependencies, so they can run on a server or in a native shell unchanged.

## Code map

```
src/lib/model/fit.ts       cycle search and scoring
src/lib/model/predict.ts   state, countdown and uncertainty at a given time
src/lib/signals.ts         grouping by light/direction/band, cached fits
src/lib/locate.ts          snapping, direction of travel, lights ahead
src/lib/db.ts              IndexedDB
src/state/                 data store, GPS tracking, wake lock
src/screens/               Predict, Capture, Lights, light debug, More
```
