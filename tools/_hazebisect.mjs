// Which of the overlapping distance washes is flattening the vista — and the
// matching "before" frames for the orbital half of the same pass.
//
// The 220 m vista shows a mountain at close range already desaturated to
// near-sky value with no further falloff on the ridges behind it. Several
// things in this renderer can do that, and this project's history (§3b 5b,
// §3b 12, §3b 0) is that guessing between them costs several round trips every
// single time. So: same seed, same deterministic camera (NMS.vista is a pure
// function of the seed), one switch off at a time.
//
//   00-all        everything on — the frame under complaint
//   01-noaerial   ?aerial=0  the src/scattering.js term, alone
//   02-nopost     ?post=0    bloom + the lens pass (shafts, ghosts, glare)
//   03-noclouds   ?vclouds=0 the raymarched cloud volume
//
// then, on the all-on load, the orbital frames for the second half of the
// defect: planet-scale lighting and sun glint on water.
//
// Judge with tools/_depthscan.mjs and tools/_orbitscan.mjs, not by eye.
import { withGame } from './harness.mjs';

const VARIANTS = [
  ['01-noaerial', 'aerial=0'],
  ['02-nopost', 'post=0'],
  ['03-noclouds', 'vclouds=0'],
];

// deterministic golden-angle sphere of candidate view directions
const DIRS = [];
for (let i = 0; i < 32; i++) {
  const y = 1 - (i + 0.5) * (2 / 32);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = i * 2.399963;
  DIRS.push([Math.cos(th) * r, y, Math.sin(th) * r]);
}

const SEED = process.env.SEED || 'EUCLID';

await withGame({
  out: process.env.OUT || 'screenshots/hazebisect',
  seed: SEED,
  width: 1024, height: 576,
  buildms: 500,
}, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  const wet = planets.find((p) => !p.isMoon && p.hasLiquid && p.liquid === 'water') || lush;

  // teleport() takes a WORLD-space direction but each seed puts its sun
  // somewhere different, so a hard-coded vector gives a different lighting
  // geometry on every world. lightProbe() reports the sun elevation at the
  // sub-camera point, which is the angle that actually has to be controlled.
  const aim = async (i, alt, want) => {
    let best = DIRS[0], bestErr = 1e9, bestElev = 0;
    for (const d of DIRS) {
      await g.eval(`NMS.teleport(${i}, ${alt}, {dir: [${d}]})`);
      await g.page.waitForTimeout(50);
      const lp = await g.eval('NMS.lightProbe()');
      if (!lp || lp.sunElevDeg === undefined) continue;
      const err = Math.abs(lp.sunElevDeg - want);
      if (err < bestErr) { bestErr = err; best = d; bestElev = lp.sunElevDeg; }
    }
    console.log(`  aim(${want} deg) -> [${best.map((v) => v.toFixed(2))}] elev ${bestElev}`);
    return best;
  };

  await g.load(SEED, 'hud=0');
  await g.look('00-all', `NMS.vista(${lush.i}, 220, -11)`);
  console.log('  lightProbe 220m:', JSON.stringify(await g.eval('NMS.lightProbe()')));
  // orbital "before" frames, from the same all-on load (cheap: few chunks)
  await g.look('10-orbit', `NMS.teleport(${lush.i}, 0.55)`);
  const term = await aim(lush.i, 0.9, 18);
  await g.look('11-orbit-terminator', `NMS.teleport(${lush.i}, 0.9, {dir: [${term}]})`);
  const sub = await aim(wet.i, 0.32, 90);
  await g.look('12-ocean-glint', `NMS.teleport(${wet.i}, 0.32, {dir: [${sub}]})`);

  for (const [name, extra] of VARIANTS) {
    await g.load(SEED, 'hud=0&' + extra);
    await g.look(name, `NMS.vista(${lush.i}, 220, -11)`);
  }
});
