// Settle the hard-edged dark region on surface frames (§3b 10a) by ELIMINATION
// rather than another theory. Same camera, same seed, three shots:
//   a  everything on
//   b  ?shadow=0        — realtime shadow map off
//   c  ?bakedshadow=0   — terrain's baked ray-marched sun shadow forced to 1
// Whichever shot loses the dark region names the culprit. If none do, it is
// neither, and the next suspect is the lighting itself.
import { withGame } from './harness.mjs';

await withGame({ out: 'screenshots/darkbisect', width: 1024, height: 576 }, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  const shot = async (tag, extra) => {
    await g.load(undefined, extra);
    await g.look(tag, `NMS.land(${lush.i}, 0, 'meadow'); NMS.faceShip();`);
  };
  await shot('a-all-on', '');
  await shot('b-no-shadowmap', 'shadow=0');
  await shot('c-no-bakedshadow', 'bakedshadow=0');
});
