// Ambience probe: verifies the synthesized audio graph reacts to location —
// space hum in space, wind+leaves on a lush surface, muffling underwater,
// dry wind on desert. Runs headless with autoplay allowed.
import { startServer } from './server.js';
import { chromium } from 'playwright';

const { server, port } = await startServer(0);
const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl',
    '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.error('PAGEERROR:', String(e).split('\n')[0]); });
await page.goto(`http://127.0.0.1:${port}/?seed=EUCLID&nolock=1&buildms=60&vclouds=0&post=0`);
await page.waitForFunction('window.NMS && window.NMS.booted', null, { timeout: 90000 });

let failed = 0;
const check = (cond, msg) => { console.log(cond ? `✓ ${msg}` : `✗ FAIL: ${msg}`); if (!cond) failed++; };
const settle = async (ms = 4000) => page.waitForTimeout(ms);
const state = () => page.evaluate('NMS.audioState()');

check(await page.evaluate('NMS.audioStart()'), 'audio context starts');

// deep space: hum, no wind
await page.evaluate('NMS.teleport(0, 2.5)');
await settle();
let s = await state();
check(s.started && !s.muted, 'graph running');
check(s.layers.space > 0.02, `space hum in space (${s.layers.space})`);
check(s.layers.leaves < 0.005, `no leaves in space (${s.layers.leaves})`);

// lush surface: wind + leaves, chirps family
await page.evaluate('NMS.land(0)');
await settle(6000);
s = await state();
check(s.family === 'lush', `family lush on lush world (${s.family})`);
check(s.layers.leaves > 0.004, `leaf rustle on the surface (${s.layers.leaves})`);
check(s.layers.space < 0.01, `space hum faded (${s.layers.space})`);
check(s.duckHz > 10000, `no muffle above water (${s.duckHz})`);

// underwater: master lowpass ducks
const dove = await page.evaluate('NMS.dive(1)');   // planet 1 is EUCLID's ocean
await settle(5000);
s = await state();
if (dove) check(s.duckHz < 2000, `underwater muffle engaged (${s.duckHz} Hz)`);
else console.log('· dive unavailable, skipping muffle check');

// desert: dry bed replaces leaves
await page.evaluate('NMS.land(5)');
await settle(6000);
s = await state();
check(s.family === 'dry', `family dry on desert (${s.family})`);
check(s.layers.dry > 0.01, `dry wind bed (${s.layers.dry})`);
check(s.layers.leaves < 0.005, `leaves gone on desert (${s.layers.leaves})`);

console.log(errors.length || failed
  ? `DONE: ${failed} check failure(s), ${errors.length} page error(s)`
  : 'DONE — all ambience checks passed');
await browser.close();
server.close();
process.exit(errors.length || failed ? 1 : 0);
