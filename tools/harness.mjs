// Reusable probe harness. Every tools/_*probe*.mjs was re-implementing the same
// 30 lines of boilerplate: start server, launch SwiftShader chromium, wait for
// boot, collect page errors, wait for idle, screenshot, tally, exit code.
// Now: `withGame(async (g) => { await g.shot('name'); })`.
//
//   import { withGame } from './harness.mjs';
//   await withGame({ out: 'screenshots/foo', seed: 'EUCLID' }, async (g) => {
//     await g.go('NMS.land(0, 0, "meadow")');
//     await g.shot('surface');
//   });
//
// Exits non-zero if any page error, shader-compile failure, or explicit
// g.fail() was recorded — so probes double as tests.

import { mkdir } from 'node:fs/promises';
import { startServer } from './server.js';
import { chromium } from 'playwright';

const CHROME_ARGS = ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl'];

// SwiftShader renders a full-detail ground frame in minutes, not milliseconds.
const DEFAULTS = {
  out: 'screenshots/probe',
  seed: 'EUCLID',
  width: 960,
  height: 540,
  query: '',            // extra query string, e.g. 'vclouds=0&farflora=0'
  buildms: 120,
  settle: 240000,       // NMS.idle() wait budget
  grow: 1400,           // extra ms after idle for scatter grow-in / fades
  bootTimeout: 90000,
};

export async function withGame(opts, fn) {
  const o = { ...DEFAULTS, ...opts };
  await mkdir(o.out, { recursive: true });
  const { server, port } = await startServer(0);
  const browser = await chromium.launch({ args: CHROME_ARGS });
  const errors = [];
  let shots = 0;
  try {
    const g = await makeSession({ browser, port, o, errors, bump: () => shots++ });
    await fn(g);
    const fails = await g.eval('NMS.stats().shaderFails').catch(() => 0);
    if (fails > 0) errors.push(`${fails} shader program(s) failed to compile`);
  } catch (e) {
    errors.push(`probe threw: ${e && e.message ? e.message : e}`);
    console.error(e);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(errors.length
    ? `DONE — ${shots} shot(s), ${errors.length} ERROR(S):\n  ${errors.join('\n  ')}`
    : `DONE — ${shots} shot(s), no errors`);
  process.exit(errors.length ? 1 : 0);
}

async function makeSession({ browser, port, o, errors, bump }) {
  const page = await browser.newPage({ viewport: { width: o.width, height: o.height } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => {
    errors.push(String(e).split('\n')[0]);
    console.error('PAGEERROR:', String(e).split('\n')[0]);
  });

  const g = {
    page,
    fail: (msg) => { errors.push(msg); console.error('FAIL:', msg); },
    eval: (js) => page.evaluate(js),

    // Load a seed. Called once automatically; call again to switch universes.
    async load(seed = o.seed, extra = o.query) {
      const q = `seed=${encodeURIComponent(seed)}&nolock=1&buildms=${o.buildms}${extra ? '&' + extra : ''}`;
      await page.goto(`http://127.0.0.1:${port}/?${q}`);
      await page.waitForFunction('window.NMS && window.NMS.booted', null, { timeout: o.bootTimeout });
      return this;
    },

    // Run a camera/state command and let the world settle behind it.
    async go(js, settle = o.settle) {
      await page.evaluate(js);
      await this.settle(settle);
      return this;
    },

    async settle(timeout = o.settle) {
      try { await page.waitForFunction('window.NMS.idle()', null, { timeout }); }
      catch { console.warn('  (settle timeout — continuing)'); }
      await page.waitForTimeout(o.grow);
      return this;
    },

    // Screenshot. Assumes the caller already settled (via go/settle) unless
    // `settleFirst` is passed.
    async shot(name, { settleFirst = false, timeout = o.settle } = {}) {
      if (settleFirst) await this.settle(timeout);
      await page.screenshot({ path: `${o.out}/${name}.png`, timeout: 240000 });
      bump();
      console.log(`✓ ${name}`);
      return this;
    },

    // Settle + shoot in one call — the common case.
    async look(name, js, settle = o.settle) {
      if (js) await page.evaluate(js);
      await this.settle(settle);
      return this.shot(name);
    },

    planets: () => page.evaluate('window.NMS.planets()'),
    stats: () => page.evaluate('window.NMS.stats()'),
  };
  await g.load();
  return g;
}
