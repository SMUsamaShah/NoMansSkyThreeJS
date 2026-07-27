// Shoot exactly the frames tools/blindjudge.mjs pairs against the real games,
// with the HUD off.
//
// The first blind round leaked: our HUD text survived the crop in four of five
// pairs and the judge said so unprompted. Cropping harder throws away image;
// hiding the overlay at the source does not. Every frame here uses hud=0, so
// what reaches the judge is rendering and nothing else.
//
//   node tools/blindshots.mjs            (env: SEED=EUCLID OUT=screenshots/blind-src)

import { withGame } from './harness.mjs';

const OUT = process.env.OUT || 'screenshots/blind-src';

await withGame({
  out: OUT, seed: process.env.SEED || 'EUCLID',
  width: 1280, height: 720, query: 'hud=0',
}, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  const dry = planets.find((p) => !p.isMoon && (p.type === 'desert' || p.type === 'barren'));

  // matched to the reference view types in blindjudge.mjs PAIRS
  await g.look('aerial-vista', `NMS.vista(${lush.i}, 220, -11)`);
  await g.look('horizon', `NMS.vista(${lush.i}, 1500, -7)`);
  await g.look('surface-eye', `NMS.land(${lush.i}, 0, 'meadow'); NMS.lookPitch(4);`);
  await g.look('orbit-limb', `NMS.teleport(${lush.i}, 0.55)`);
  if (dry) await g.look('dry-vista', `NMS.vista(${dry.i}, 300, -12)`);
});
