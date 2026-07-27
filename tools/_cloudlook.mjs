// Cloud-focused probe: the four frames the cloud defect actually shows up in.
// Framed against reference/star-citizen/aresion-microtech-volumetricclouds.jpg
// (cloud deck seen from just above, sunlit rim, mountain behind) and
// arccorp-clouds.jpg (towering cumulus with self-shadowing from high up).
//
// OUT=... SEED=... VC=0 (to bisect the impostor deck) node tools/_cloudlook.mjs
import { withGame } from './harness.mjs';

const extra = process.env.VC === '0' ? 'hud=0&vclouds=0' : 'hud=0';

await withGame({
  out: process.env.OUT || 'screenshots/cloudlook',
  seed: process.env.SEED || 'ATLAS-7',
  query: extra,
  width: 1280, height: 720,
}, async (g) => {
  const planets = await g.planets();
  const cloudy = planets.filter((p) => !p.isMoon && p.cloudAlt > 0);
  console.log('cloudy planets:', JSON.stringify(cloudy));
  if (!cloudy.length) { g.fail('no planet on this seed has clouds'); return; }
  const p = cloudy.find((q) => q.type === 'lush') || cloudy[0];
  console.log('using planet', p.i, p.name, p.type, 'R', p.R, 'cloudAlt', p.cloudAlt);

  // 1) sky-filling frame from a vantage: this is where the coverage field's
  //    own creases and the march banding are most legible.
  await g.look('01-sky-400m', `NMS.vista(${p.i}, 400, 12)`);
  console.log('  stats:', JSON.stringify(await g.stats()));
  // 2) horizon frame: distant clouds against hazed ridges — do they sit
  //    BEHIND the aerial perspective, or cut through it?
  await g.look('02-ridge-900m', `NMS.vista(${p.i}, 900, 1)`);
  // 3) just above the deck, looking down over the cloud tops (the aresion shot)
  const above = (p.cloudAlt * 2.4 / p.R).toFixed(7);
  await g.look('03-abovedeck', `NMS.teleport(${p.i}, ${above}, {horizon:true, pitch:-0.22})`);
  console.log('  stats:', JSON.stringify(await g.stats()));
  // 4) high up, deck-to-volume crossfade region
  await g.look('04-high', `NMS.teleport(${p.i}, 0.9, {horizon:true, pitch:-0.30})`);
});
