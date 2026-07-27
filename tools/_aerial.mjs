// The probe for the atmosphere / aerial-perspective / orbital-lighting pass.
//
// One run covers both halves of the defect area, so before/after is a single
// comparison rather than four:
//   01/02  elevated vistas — aerial perspective, judged with tools/_depthscan.mjs
//          against reference/star-citizen/dunboro-aerial-view-microtech.jpg
//   03     orbit with the sun over the shoulder
//   04     orbit with the sun ~20 deg above the sub-camera point, so the
//          terminator sweeps across the visible disc — judged with
//          tools/_orbitscan.mjs against
//          reference/elite-dangerous/ed-odyssey-atmospheric-planet.jpg
//   05     low orbit directly over the sub-SOLAR point of a world with seas,
//          which is the only geometry where specular sun glint can appear at
//          all. A glint shot aimed anywhere else proves nothing.
//
// The orbit framings are searched rather than hard-coded: teleport() takes a
// world-space direction but the sun's direction is per-seed, so a fixed vector
// gives a different lighting geometry on every world. NMS.lightProbe() reports
// the sun elevation at the sub-camera point, which is exactly the angle that
// has to be controlled, so the probe hunts for it.
//
// hud=0 throughout: HUD text kept being read as scene content.
import { withGame } from './harness.mjs';

const OUT = process.env.OUT || 'screenshots/aerial';

// Candidate view directions on a sphere, deterministic (a golden-angle spiral).
const DIRS = [];
for (let i = 0; i < 48; i++) {
  const y = 1 - (i + 0.5) * (2 / 48);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = i * 2.399963;
  DIRS.push([Math.cos(th) * r, y, Math.sin(th) * r]);
}

await withGame({
  out: OUT,
  seed: process.env.SEED || 'EUCLID',
  width: 1280, height: 720,
  query: 'hud=0' + (process.env.EXTRA ? '&' + process.env.EXTRA : ''),
}, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  const wet = planets.find((p) => !p.isMoon && p.hasLiquid && p.liquid === 'water') || lush;

  // find the view direction whose sub-camera sun elevation is closest to `want`
  const aim = async (i, alt, want) => {
    let best = DIRS[0], bestErr = 1e9, bestElev = 0;
    for (const d of DIRS) {
      await g.eval(`NMS.teleport(${i}, ${alt}, {dir: [${d}]})`);
      await g.page.waitForTimeout(60);
      const lp = await g.eval('NMS.lightProbe()');
      if (!lp || lp.error === undefined && lp.sunElevDeg === undefined) continue;
      if (lp.sunElevDeg === undefined) continue;
      const err = Math.abs(lp.sunElevDeg - want);
      if (err < bestErr) { bestErr = err; best = d; bestElev = lp.sunElevDeg; }
    }
    console.log(`  aim(want ${want} deg) -> dir [${best.map((v) => v.toFixed(2))}] elev ${bestElev} deg`);
    return best;
  };

  await g.look('01-vista-220m', `NMS.vista(${lush.i}, 220, -11)`);
  console.log('  lightProbe 220m:', JSON.stringify(await g.eval('NMS.lightProbe()')));
  await g.look('02-vista-1500m', `NMS.vista(${lush.i}, 1500, -7)`);
  console.log('  lightProbe 1500m:', JSON.stringify(await g.eval('NMS.lightProbe()')));

  await g.look('03-orbit', `NMS.teleport(${lush.i}, 0.55)`);
  const term = await aim(lush.i, 0.9, 20);
  await g.look('04-orbit-terminator', `NMS.teleport(${lush.i}, 0.9, {dir: [${term}]})`);
  const subsolar = await aim(wet.i, 0.32, 90);
  await g.look('05-ocean-glint', `NMS.teleport(${wet.i}, 0.32, {dir: [${subsolar}]})`);
});
