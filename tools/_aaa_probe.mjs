// AAA pass probe: nebula sky from deep space, throttle flight behaviour,
// ship + station looks. Fails on shader-compile errors.
import { mkdir } from 'node:fs/promises';
import { startServer } from './server.js';
import { chromium } from 'playwright';
await mkdir('screenshots/aaa', { recursive: true });
const { server, port } = await startServer(0);
const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.error('PAGEERROR:', String(e).split('\n')[0]); });
await page.goto(`http://127.0.0.1:${port}/?seed=EUCLID&nolock=1&buildms=60&vclouds=0&farflora=0`);
await page.waitForFunction('window.NMS && window.NMS.booted', null, { timeout: 90000 });
const shot = async (n, ms = 1500) => {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `screenshots/aaa/${n}.png`, timeout: 180000 });
  console.log('✓', n);
};
// deep space, looking away from the sun: the nebula sky
await page.evaluate('NMS.teleport(3, 1.5)');
await page.evaluate('NMS.lookYaw(150); NMS.lookPitch(25);');
await shot('01-nebula-a', 4000);
await page.evaluate('NMS.lookYaw(95)');
await shot('02-nebula-b', 2500);
await page.evaluate('NMS.lookPitch(-55)');
await shot('03-nebula-c', 2500);
// station against the new sky
await page.evaluate('NMS.stationVista(3.0)');
await shot('04-station', 5000);
// throttle flight: ramp up and confirm the ship ACCELERATES rather than jumps
const p0 = await page.evaluate('NMS.pos()');
await page.evaluate('NMS.throttle(1)');
await page.waitForTimeout(1500);
const s1 = await page.evaluate('NMS.speed()');
await page.waitForTimeout(2500);
const s2 = await page.evaluate('NMS.speed()');
const p1 = await page.evaluate('NMS.pos()');
const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
console.log(`throttle: speed ${s1.toFixed(0)} → ${s2.toFixed(0)} m/s, moved ${(moved / 1000).toFixed(1)} km`);
if (!(s2 > s1 * 1.2)) { errors.push('throttle did not keep accelerating'); }
if (!(moved > 1000)) { errors.push('throttle produced no travel'); }
await page.evaluate('NMS.throttle(0)');
const fails = await page.evaluate('NMS.stats().shaderFails');
if (fails > 0) { errors.push(`${fails} shader program(s) failed`); console.error('SHADER FAILS:', fails); }
console.log(errors.length ? `DONE WITH ${errors.length} ERROR(S): ${errors.join(' | ')}` : 'DONE — no errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
