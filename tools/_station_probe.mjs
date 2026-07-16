// Station visual probe: park beside the station in several systems and
// shoot it — verifies variety, lighting, windows, label.
import { mkdir } from 'node:fs/promises';
import { startServer } from './server.js';
import { chromium } from 'playwright';

const SEEDS = (process.env.SEEDS || 'EUCLID,OMEGA,ATLAS-7,VOYAGER-3').split(',');
const OUT = process.env.OUT || 'screenshots/station';
await mkdir(OUT, { recursive: true });
const { server, port } = await startServer(0);
const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'],
});
const errors = [];

for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => { errors.push(`[${seed}] ${e}`); console.error('PAGEERROR:', String(e).split('\n')[0]); });
  await page.goto(`http://127.0.0.1:${port}/?seed=${encodeURIComponent(seed)}&nolock=1&buildms=60&vclouds=0`);
  await page.waitForFunction('window.NMS && window.NMS.booted', null, { timeout: 90000 });
  const st = await page.evaluate('NMS.station()');
  console.log(`${seed}: ${st.name} — ${st.topology}, r=${st.radius} m`);
  await page.evaluate('NMS.stationVista(3.2)');
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${OUT}/${seed}-${st.topology}.png` });
  console.log(`✓ ${seed}-${st.topology}`);
  await page.close();
}

console.log(errors.length ? `DONE WITH ${errors.length} PAGE ERROR(S)` : 'DONE — no page errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
