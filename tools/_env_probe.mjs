// Image-based lighting check: the ship's SHADOW side in deep space. Before
// scene.environment existed this was pure black (metalness 0.58 with no env map
// has no diffuse and no specular — arithmetically zero). These frames must show
// a readable hull: nebula-tinted fill, a sun-side specular edge, panel lines.
import { withGame } from './harness.mjs';

await withGame({
  out: process.env.OUT || 'screenshots/env',
  seed: process.env.SEED || 'EUCLID',
  width: 960, height: 540,
  query: 'vclouds=0&farflora=0',
}, async (g) => {
  await g.go('NMS.teleport(3, 1.5)');
  // shipPortrait poses the SHIP; camera yaw then swings the sun around it, so
  // these three frames are the same model under three lighting angles.
  await g.look('01-ship-shadow-side', 'NMS.shipPortrait(); NMS.lookYaw(150);');
  await g.look('02-ship-backlit', 'NMS.lookYaw(-150)');
  await g.look('03-ship-3q', 'NMS.lookYaw(75)');
  await g.look('04-station', 'NMS.resetFov(); NMS.stationVista(2.6);');
});
