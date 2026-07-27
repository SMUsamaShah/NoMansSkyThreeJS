// The frame that showed a hard shadow-box edge and oversized grass: standing on
// the surface looking along the ground toward the parked ship.
import { withGame } from './harness.mjs';
await withGame({ out: 'screenshots/shipground', width: 1280, height: 720 }, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  await g.look('01-faceship', `NMS.land(${lush.i}, 0, 'meadow'); NMS.faceShip();`);
  await g.look('02-ground', 'NMS.lookPitch(-18)');
});
