// Is the dark patching on cap canopies self-shadowing, or shading?
// Same frame twice: shadows on, shadows off.
import { withGame } from './harness.mjs';
const tag = process.env.TAG || 'on';
await withGame({
  out: 'screenshots/bisect', width: 900, height: 520,
  query: `vclouds=0&farflora=0${tag === 'off' ? '&shadow=0' : ''}`,
}, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  await g.look(`shadow-${tag}`, `NMS.land(${lush.i}, 0, 'meadow'); NMS.lookPitch(10);`);
});
