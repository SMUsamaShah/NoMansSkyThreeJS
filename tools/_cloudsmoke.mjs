// Fast shader-compile guard for the VOLUMETRIC cloud path. _smoke.mjs runs
// with ?vclouds=0, which never compiles the raymarch program at all — a shader
// that fails to link there is invisible in every frame it should have drawn.
// Small viewport, low quality: this is about VALIDATE_STATUS, not beauty.
import { withGame } from './harness.mjs';

await withGame({
  out: 'screenshots/cloudsmoke', width: 480, height: 270,
  seed: process.env.SEED || 'ATLAS-7',
  query: 'hud=0&farflora=0&quality=low', buildms: 40, settle: 120000, grow: 300,
}, async (g) => {
  const p = (await g.planets()).find((q) => q.cloudAlt > 0);
  if (!p) { g.fail('no cloudy planet on this seed'); return; }
  // high enough that only the deck+volume are drawn (no terrain build storm)
  await g.look('01-vol', `NMS.teleport(${p.i}, 0.35, {horizon:true, pitch:-0.25})`);
  const s = await g.stats();
  console.log('vol:', JSON.stringify(s));
  if (s.shaderFails > 0) g.fail(`${s.shaderFails} shader program(s) failed`);
});
