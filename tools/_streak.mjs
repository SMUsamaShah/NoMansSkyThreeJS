// A faint vertical line runs down the upper part of many high-altitude frames
// (vista-atlas 01/03, specks). Same camera, four shots, one suspect removed
// each time: volumetric clouds, the lens pass, the nebula background.
import { withGame } from './harness.mjs';
await withGame({ out: 'screenshots/streak', seed: 'ATLAS-7', width: 1024, height: 576 }, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  const shot = async (tag, extra) => {
    if (extra !== null) await g.load('ATLAS-7', extra);
    await g.look(tag, `NMS.vista(${lush.i}, 1500, -7)`);
  };
  await shot('a-all-on', '');
  await shot('b-no-vclouds', 'vclouds=0');
  await shot('c-no-lens', 'lens=0');
  await shot('d-no-nebula', 'nebula=0');
});
