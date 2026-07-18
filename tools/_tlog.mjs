import { startServer } from './server.js';
import { chromium } from 'playwright';
const { server, port } = await startServer(0);
const browser = await chromium.launch({ args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
await page.goto(`http://127.0.0.1:${port}/?seed=EUCLID&nolock=1&buildms=60&vclouds=0&post=0`);
await page.waitForFunction('window.NMS && window.NMS.booted', null, { timeout: 90000 });
await page.waitForTimeout(6000);
const logs = await page.evaluate(() => NMS._renderer.info.programs
  .filter((p) => p.diagnostics && String(p.cacheKey).includes('terrain'))
  .map((p) => ({
    frag: String(p.diagnostics.fragmentShader && p.diagnostics.fragmentShader.log || '').slice(0, 500),
    vert: String(p.diagnostics.vertexShader && p.diagnostics.vertexShader.log || '').slice(0, 500),
    prog: String(p.diagnostics.programLog || '').slice(0, 300),
  })));
console.log(JSON.stringify(logs, null, 1));
await browser.close(); server.close(); process.exit(0);
