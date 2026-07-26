// Fast guard: boot, then assert no page errors and no shader-compile failures,
// in a deliberately cheap scene. Run this BEFORE any slow visual probe after a
// shader change — a program that fails to compile is invisible in a screenshot
// but takes a whole subsystem down with it (see the 'patch' reserved-word bug
// that silently erased all terrain).
import { withGame } from './harness.mjs';

await withGame({
  out: 'screenshots/smoke', width: 640, height: 360,
  query: 'vclouds=0&farflora=0&quality=low', buildms: 40, settle: 90000, grow: 400,
}, async (g) => {
  await g.look('01-space', 'NMS.teleport(0, 2.0)');
  console.log('space:', JSON.stringify(await g.stats()));
  await g.look('02-surface', "NMS.land(0, 0, 'meadow')");
  const s = await g.stats();
  console.log('surface:', JSON.stringify(s));
  if (s.shaderFails > 0) g.fail(`${s.shaderFails} shader program(s) failed`);
});
