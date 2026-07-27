// One frame each, same camera: is the coloured speckle the FAR tier or not?
// ?farflora=0 removes the far proxy tier entirely. If the specks survive it,
// they are near-tier props rendering above SHOW_BELOW_ALT, which would be a
// cutoff bug rather than a far-tier density problem.
import { withGame } from './harness.mjs';
await withGame({ out: 'screenshots/specks', seed: 'ATLAS-7', width: 1024, height: 576 }, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  await g.look('a-all-on', `NMS.vista(${lush.i}, 1500, -7)`);
  await g.load('ATLAS-7', 'farflora=0');
  await g.look('b-no-farflora', `NMS.vista(${lush.i}, 1500, -7)`);
});
