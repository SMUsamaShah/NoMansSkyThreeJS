// The lookbook: one broad, fixed spread of "how does the game actually LOOK"
// frames, in the order you'd judge it — space, approach, surface, detail,
// hardware, light. Run it after any visual change and review the images.
//   node tools/lookbook.mjs            (env: SEED=EUCLID OUT=screenshots/look)
//
// This is the review instrument, not a pass/fail test: it still exits non-zero
// on page errors / shader failures, but its job is to produce comparable
// frames. Keep the shot list STABLE so before/after diffs mean something.

import { withGame } from './harness.mjs';

const SEED = process.env.SEED || 'EUCLID';
const OUT = process.env.OUT || 'screenshots/look';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

await withGame({ out: OUT, seed: SEED, width: 1280, height: 720 }, async (g) => {
  const want = (tag) => !ONLY || ONLY.has(tag);
  const planets = await g.planets();
  console.log('planets:', planets.map((p) => `${p.i}:${p.type}${p.isMoon ? '(m)' : ''}`).join(' '));
  const pick = (pred) => planets.find((p) => !p.isMoon && pred(p)) || planets[0];
  const lush = pick((p) => p.type === 'lush');
  const wet = pick((p) => p.hasLiquid);
  const any = pick(() => true);

  // 1. deep space — the nebula sky, away from the sun
  if (want('space')) {
    await g.go(`NMS.teleport(${any.i}, 3.0)`);
    await g.look('01-space-nebula', 'NMS.lookYaw(150); NMS.lookPitch(20);');
    await g.look('02-space-planet', 'NMS.lookYaw(-150); NMS.lookPitch(-20);');
  }

  // 2. the approach — planet filling the frame, terminator visible
  if (want('orbit')) {
    await g.look('03-orbit', `NMS.teleport(${lush.i}, 0.45)`);
    await g.look('04-high-atmo', `NMS.teleport(${lush.i}, 0.06, {horizon: true})`);
  }

  // 3. surface — the frames the owner actually judges on
  if (want('surface')) {
    await g.look('05-surface-meadow', `NMS.land(${lush.i}, 0, 'meadow')`);
    await g.look('06-surface-horizon', 'NMS.lookPitch(6)');
    await g.look('07-surface-ground', 'NMS.lookPitch(-30)');
    await g.look('08-surface-sunset', `NMS.land(${lush.i}, 0, 'sunset')`);
    await g.look('09-surface-night', `NMS.land(${lush.i}, 0, 'night')`);
  }

  // 4. water
  if (want('water') && wet.hasLiquid) {
    await g.look('10-coast', `NMS.coast(${wet.i})`);
  }

  // 5. hardware — ship and station, the two artificial objects
  if (want('hardware')) {
    await g.go(`NMS.land(${lush.i}, 0, 'meadow')`);
    await g.look('11-ship-parked', 'NMS.faceShip()');
    await g.look('12-station', 'NMS.resetFov(); NMS.stationVista(3.0);');
  }
});
