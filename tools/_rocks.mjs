// Ground litter, judged against reference/star-citizen/daymar-122019-min.jpg
// and drifters-microtech.jpg: stone every metre or two, spanning pebble to
// boulder. Shot on a DRY world, where the ground is the subject rather than
// something hiding behind vegetation.
import { withGame } from './harness.mjs';

await withGame({
  out: 'screenshots/rocks', seed: process.env.SEED || 'EUCLID',
  width: 1280, height: 720, query: 'vclouds=0&farflora=0',
}, async (g) => {
  const planets = await g.planets();
  const dry = planets.find((p) => !p.isMoon && (p.type === 'desert' || p.type === 'barren'))
    || planets.find((p) => !p.isMoon) || planets[0];
  console.log('dry world:', dry.i, dry.type);
  await g.look('01-ground', `NMS.land(${dry.i}); NMS.lookPitch(-22);`);
  await g.look('02-vista', 'NMS.lookPitch(16)');
  await g.look('03-sunset', `NMS.land(${dry.i}, 0, 'sunset'); NMS.lookPitch(-10);`);
});
