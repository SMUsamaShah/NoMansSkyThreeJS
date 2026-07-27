// Are the coloured specks on wooded slopes the far proxy tier, or the terrain?
// Same frame with the far tier on and off.
import { withGame } from './harness.mjs';
const off = process.env.FF === '0';
await withGame({
  out: 'screenshots/bisect', width: 900, height: 520,
  query: off ? 'farflora=0' : '',
}, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  await g.look(`far-${off ? 'off' : 'on'}`, `NMS.vista(${lush.i}, 600, -14)`);
});
