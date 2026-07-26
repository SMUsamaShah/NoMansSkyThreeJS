// Close-up flora review: the canopy silhouette and shading at eye height, plus
// a ground-angle shot that shows whether props actually cast contact shadows.
// This is the frame the owner judges the whole project on.
import { withGame } from './harness.mjs';

await withGame({
  out: process.env.OUT || 'screenshots/flora-close',
  seed: process.env.SEED || 'EUCLID',
  width: 1280, height: 720,
  query: 'vclouds=0&farflora=0',
}, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  await g.look('01-meadow', `NMS.land(${lush.i}, 0, 'meadow')`);
  await g.look('02-canopy', 'NMS.lookPitch(12)');
  await g.look('03-shadows', 'NMS.lookPitch(-32)');
  await g.look('04-sunset', `NMS.land(${lush.i}, 0, 'sunset')`);
});
