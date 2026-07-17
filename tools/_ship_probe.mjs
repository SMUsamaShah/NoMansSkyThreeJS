// Ship close-ups: parked on a meadow pad (daylight, shadows) and flying
// formation in space.
import { mkdir } from 'node:fs/promises';
import { startServer } from './server.js';
import { chromium } from 'playwright';
await mkdir('screenshots/ship', { recursive: true });
const { server, port } = await startServer(0);
const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.error('PAGEERROR:', String(e).split('\n')[0]); });
await page.goto(`http://127.0.0.1:${port}/?seed=EUCLID&nolock=1&buildms=120`);
await page.waitForFunction('window.NMS && window.NMS.booted', null, { timeout: 90000 });
async function shot(name, timeout = 240000) {
  try { await page.waitForFunction('window.NMS.idle()', null, { timeout }); }
  catch { console.warn(`${name}: settle timeout`); }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `screenshots/ship/${name}.png` });
  console.log('✓', name);
}
await page.evaluate('NMS.teleport(0, 0.05, {horizon: true})');
await shot('01-space-formation');
await page.evaluate("NMS.land(0, 0, 'meadow')");
await shot('02-landed');
await page.evaluate('NMS.faceShip()');
await shot('03-parked-closeup');
await page.evaluate('NMS.lookYaw(35)');
await shot('04-parked-side', 30000);
console.log(errors.length ? `DONE WITH ${errors.length} PAGE ERROR(S)` : 'DONE — no page errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
