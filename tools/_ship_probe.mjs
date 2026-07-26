// Ship close-ups: parked on a meadow pad (daylight, shadows) and flying
// formation in space. Runs light (no volumetrics / far tier) — SwiftShader
// needs >30 s per frame on a full-detail ground scene, which trips
// screenshot timeouts; the ship's look depends on neither.
import { mkdir } from 'node:fs/promises';
import { startServer } from './server.js';
import { chromium } from 'playwright';
await mkdir('screenshots/ship', { recursive: true });
const { server, port } = await startServer(0);
const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.error('PAGEERROR:', String(e).split('\n')[0]); });
await page.goto(`http://127.0.0.1:${port}/?seed=EUCLID&nolock=1&buildms=120&vclouds=0&farflora=0`);
await page.waitForFunction('window.NMS && window.NMS.booted', null, { timeout: 90000 });
async function shot(name, timeout = 200000) {
  try { await page.waitForFunction('window.NMS.idle()', null, { timeout }); }
  catch { console.warn(`${name}: settle timeout`); }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `screenshots/ship/${name}.png`, timeout: 180000 });
  console.log('✓', name);
}
await page.evaluate('NMS.teleport(0, 0.05, {horizon: true})');
await shot('01-space-formation');
await page.evaluate("NMS.land(0, 0, 'meadow')");
await shot('02-landed');
await page.evaluate('NMS.faceShip()');
await shot('03-parked-closeup');
await page.evaluate('NMS.lookYaw(35)');
await shot('04-parked-side', 40000);
// portrait: a narrow lens on the formation pose, where the ship is big
await page.evaluate('NMS.teleport(0, 0.08, {horizon: true})');
await page.evaluate('NMS.shipPortrait(16)');
await shot('05-portrait', 60000);
await page.evaluate('NMS.lookYaw(38)');
await shot('06-portrait-side', 40000);
await page.evaluate('NMS.lookYaw(38); NMS.lookPitch(-14);');
await shot('07-portrait-top', 40000);
await page.evaluate('NMS.resetFov()');
const fails = await page.evaluate('NMS.stats().shaderFails');
if (fails > 0) { errors.push(`${fails} shader program(s) failed`); console.error('SHADER FAILS:', fails); }
console.log(errors.length ? `DONE WITH ${errors.length} ERROR(S)` : 'DONE — no errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
