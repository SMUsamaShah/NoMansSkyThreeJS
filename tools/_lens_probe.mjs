// The lens pass, judged against itself. Every frame is shot twice — once with
// src/postfx.js active and once with ?lens=0 — so the effect can be read as a
// difference rather than guessed at. Sun in frame, sun behind terrain (shafts
// must be occluded), and a night sky (grain must not turn it to static).
import { withGame } from './harness.mjs';

const OUT = process.env.OUT || 'screenshots/lens';

await withGame({ out: OUT, seed: process.env.SEED || 'EUCLID', width: 1280, height: 720 }, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];

  for (const [tag, q] of [['on', ''], ['off', 'lens=0']]) {
    await g.load(undefined, `vclouds=0&farflora=0${q ? '&' + q : ''}`);
    await g.look(`01-sunset-${tag}`, `NMS.land(${lush.i}, 0, 'sunset')`);
    await g.look(`02-day-${tag}`, `NMS.land(${lush.i}, 0, 'meadow')`);
    await g.look(`03-night-${tag}`, `NMS.land(${lush.i}, 0, 'night')`);
    await g.look(`04-space-${tag}`, `NMS.teleport(${lush.i}, 1.2)`);
  }
});
