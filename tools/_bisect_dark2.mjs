// Which term is the large dark region on the ground?
//   BAKED=0 -> lift the baked ray-marched terrain shadow to 1.0
import { withGame } from './harness.mjs';
const off = process.env.BAKED === '0';
await withGame({
  out: 'screenshots/bisect', width: 900, height: 520,
  query: off ? 'bakedshadow=0' : '',
}, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  await g.look(`baked-${off ? 'off' : 'on'}`, `NMS.land(${lush.i}, 0, 'meadow'); NMS.faceShip();`);
});
