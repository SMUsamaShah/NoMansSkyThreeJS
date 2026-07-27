// Numbers, not impressions: what is actually lighting the ground at a vista.
import { withGame } from './harness.mjs';
await withGame({
  out: 'screenshots/lightprobe', width: 640, height: 360,
  query: 'vclouds=0&farflora=0&quality=low', buildms: 40, settle: 90000, grow: 400,
}, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  await g.look('01', `NMS.vista(${lush.i}, 220, -11)`);
  console.log('VISTA  ', JSON.stringify(await g.eval('NMS.lightProbe()')));
  await g.look('02', `NMS.land(${lush.i})`);
  console.log('GROUND ', JSON.stringify(await g.eval('NMS.lightProbe()')));
});
