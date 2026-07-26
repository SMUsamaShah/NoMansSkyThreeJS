// The four frames that carry this pass: the limb from orbit, the hull in deep
// space, and the surface by day and at sunset.
import { withGame } from './harness.mjs';

await withGame({
  out: 'screenshots/final', seed: process.env.SEED || 'EUCLID',
  width: 1280, height: 720, query: 'vclouds=0&farflora=0',
}, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  await g.look('01-limb', `NMS.teleport(${lush.i}, 0.55)`);
  await g.look('02-limb-terminator', `NMS.teleport(${lush.i}, 0.9, {dir: [0.75, 0.3, 0.6]})`);
  await g.look('03-ship', `NMS.teleport(${lush.i}, 2.0); NMS.shipPortrait(); NMS.lookYaw(120);`);
  await g.look('04-surface', `NMS.resetFov(); NMS.land(${lush.i}, 0, 'meadow');`);
  await g.look('05-sunset', `NMS.land(${lush.i}, 0, 'sunset')`);
});
