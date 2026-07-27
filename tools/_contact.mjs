// The "everything floats" defect: do scattered props cast a contact shadow, and
// is there any occlusion where they meet the ground? One ground-level frame per
// run, pitched down so the base of every trunk and stone is in shot — the same
// thing reference/star-citizen/drifters-microtech.jpg is filed under.
//
// Deliberately ONE shot per run: a frame costs minutes on SwiftShader, and this
// probe exists to be run several times over (before/after, gtao on/off, dry
// world/lush world), which is what the env knobs are for.
//
//   OUT=screenshots/rocks-after WORLD=dry node tools/_contact.mjs
//   OUT=screenshots/flora-noao  Q=gtao=0  node tools/_contact.mjs
//
// WORLD=dry reproduces tools/_rocks.mjs's 01-ground exactly — same size, same
// world pick, same pitch — so its output is directly comparable to
// screenshots/rocks-before/01-ground.png.
import { withGame } from './harness.mjs';

const DRY = process.env.WORLD === 'dry';

await withGame({
  out: process.env.OUT || 'screenshots/contact',
  seed: process.env.SEED || 'EUCLID',
  width: 1280, height: 720,
  query: 'vclouds=0&farflora=0' + (process.env.Q ? '&' + process.env.Q : ''),
}, async (g) => {
  const planets = await g.planets();
  let target, cmd;
  if (DRY) {
    target = planets.find((p) => !p.isMoon && (p.type === 'desert' || p.type === 'barren'))
      || planets.find((p) => !p.isMoon) || planets[0];
    cmd = `NMS.land(${target.i}); NMS.lookPitch(-22);`;
  } else {
    target = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
    cmd = `NMS.land(${target.i}, 0, 'meadow'); NMS.lookPitch(-30);`;
  }
  console.log('world:', target.i, target.type);
  await g.look('01-ground', cmd);
  console.log('stats:', JSON.stringify(await g.stats()));
  console.log('shadow:', JSON.stringify(
    await g.eval('NMS.shadowProbe ? NMS.shadowProbe() : "n/a (old build)"')));
});
