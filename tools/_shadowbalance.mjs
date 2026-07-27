// Measure the shadow-to-ambient ratio (§3b 12) instead of eyeballing it.
// The reference keeps shadowed grass green and readable; ours goes near-black.
// lightProbe() reports sun vs hemi/ambient/env irradiance at the camera's spot.
import { withGame } from './harness.mjs';

await withGame({ out: 'screenshots/shadowbal', width: 640, height: 360,
  query: 'vclouds=0&farflora=0', settle: 90000, grow: 400 }, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  await g.go(`NMS.land(${lush.i}, 0, 'meadow')`, 90000);
  const p = await g.eval('NMS.lightProbe()');
  console.log(JSON.stringify(p, null, 1));
  const amb = (p.hemi || 0) + (p.ambient || 0) + (p.env || 0);
  console.log(`\nsun=${(p.sun||0).toFixed(3)}  ambient(hemi+amb+env)=${amb.toFixed(3)}`);
  console.log(`shadowed/lit irradiance ratio = ${(amb / ((p.sun || 0) + amb)).toFixed(3)}`);
  console.log(`albedoLum=${p.albedoLum} -> shadowed surface radiance ~${(amb * p.albedoLum).toFixed(4)}`);
  console.log('and the BAKED shadow multiplies albedo by uBakedLo on top of that');
  console.log('reference keeps shadowed ground clearly readable — want roughly 0.18-0.30');
});
