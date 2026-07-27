// Framed deliberately against reference/star-citizen/dunboro-aerial-view-microtech.jpg:
// an elevated vantage a couple of hundred metres up, looking out and slightly
// down over rolling vegetated hills in full daylight, with the sun over the
// shoulder so the terrain's own relief is doing the shading.
//
// This is the shot the project should be judged on. The `meadow` bias used by
// _flora_close.mjs does the opposite on purpose: it stands you in a clearing
// facing the tree line, which fills the frame with flora and hides the land,
// and it often picks a slope facing away from the sun — hence the dim, blue,
// vegetation-only frames.
import { withGame } from './harness.mjs';

await withGame({
  out: process.env.OUT || 'screenshots/vista',
  seed: process.env.SEED || 'EUCLID',
  width: 1280, height: 720,
}, async (g) => {
  const planets = await g.planets();
  const lush = planets.find((p) => !p.isMoon && p.type === 'lush') || planets[0];
  const dry = planets.find((p) => !p.isMoon && (p.type === 'desert' || p.type === 'barren'));
  const R = lush.R * 1000;
  const alt = (m) => m / R;      // altFactor from metres

  // Dunboro framing: ~220 m up, nose a little below the horizon so the far
  // ridges and the haze band both stay in frame.
  await g.look('01-hills-220m', `NMS.teleport(${lush.i}, ${alt(220)}, {horizon: true, pitch: -0.20})`);
  await g.look('02-hills-600m', `NMS.teleport(${lush.i}, ${alt(600)}, {horizon: true, pitch: -0.26})`);
  // flatter nose: maximum aerial perspective, horizon high in frame
  await g.look('03-horizon-1200m', `NMS.teleport(${lush.i}, ${alt(1200)}, {horizon: true, pitch: -0.10})`);
  // and the dry world against daymar-122019-min.jpg
  if (dry) {
    await g.look('04-dry-300m', `NMS.teleport(${dry.i}, ${300 / (dry.R * 1000)}, {horizon: true, pitch: -0.18})`);
  }
});
