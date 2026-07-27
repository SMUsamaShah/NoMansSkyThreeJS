import { withGame } from './harness.mjs';
await withGame({ out: 'screenshots/streak', seed: 'ATLAS-7', width: 1024, height: 576,
  query: 'lens=0' }, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  await g.look('c-no-lens', `NMS.vista(${lush.i}, 1500, -7)`);
});
