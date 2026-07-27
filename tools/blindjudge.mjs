// Blind A/B comparator: our render vs a real Star Citizen / Elite Dangerous
// frame of the SAME kind of view, presented as A and B in randomised order,
// centre-cropped to identical dimensions.
//
// The cropping is not cosmetic — it is what makes the test blind. Our HUD
// (corners + bottom bar) identifies our frame instantly, so a judge shown the
// raw image is not comparing rendering at all. Every pair is cropped to the
// same central band, so what is left is terrain, light, atmosphere and
// materials, which is the thing under test.
//
//   node tools/blindjudge.mjs                 # build all pairs
//   node tools/blindjudge.mjs --reveal        # print the answer key
//
// Pairs land in screenshots/blind/<pair>/A.png and B.png. The key is written
// to screenshots/blind/KEY.json, which the judging agent must NOT read.

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT = 'screenshots/blind';
const W = 1100, H = 620;   // every crop normalised to this

// ours ↔ reference, matched by VIEW TYPE. Comparing our surface shot against
// their orbital shot would measure nothing.
const PAIRS = [
  { name: '01-aerial-vista', clean: 'screenshots/blind-src/aerial-vista.png',
    ours: 'screenshots/vista-atlas/01-hills-220m.png',
    ref: 'reference/star-citizen/dunboro-aerial-view-microtech.jpg',
    view: 'elevated view over vegetated hills in daylight' },
  { name: '02-surface-eye', clean: 'screenshots/blind-src/surface-eye.png',
    ours: 'screenshots/look/05-surface-meadow.png',
    ref: 'reference/star-citizen/drifters-microtech.jpg',
    view: 'ground-level / low view across terrain with vegetation and stone' },
  { name: '03-orbit-limb', clean: 'screenshots/blind-src/orbit-limb.png',
    ours: 'screenshots/look/03-orbit.png',
    ref: 'reference/elite-dangerous/ed-odyssey-atmospheric-planet.jpg',
    view: 'planet seen from orbit with its atmospheric limb' },
  { name: '04-dry-vista', clean: 'screenshots/blind-src/dry-vista.png',
    ours: 'screenshots/rocks/02-vista.png',
    ref: 'reference/star-citizen/daymar-122019-min.jpg',
    view: 'arid/rocky terrain vista' },
  { name: '05-horizon', clean: 'screenshots/blind-src/horizon.png',
    ours: 'screenshots/vista-atlas/03-horizon-1500m.png',
    ref: 'reference/elite-dangerous/canyon-planet.jpg',
    view: 'high vantage looking to a distant horizon' },
];

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
// prefer a clean hud=0 frame from tools/blindshots.mjs; fall back to the older
// HUD-bearing probe output only if that has not been shot yet
const pick = async (clean, fallback) => (await exists(clean) ? clean : fallback);

if (process.argv.includes('--reveal')) {
  console.log(await readFile(`${OUT}/KEY.json`, 'utf8'));
  process.exit(0);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();

// crop out the HUD margins, then letterbox-fill to the common size
async function normalise(file) {
  const b64 = (await readFile(file)).toString('base64');
  return page.evaluate(async ([d, w, h]) => {
    const img = new Image();
    img.src = 'data:image/*;base64,' + d;
    await img.decode();
    // drop 9% top (title/target panels), 12% bottom (control bar), 4% sides
    const sx = img.width * 0.04, sy = img.height * 0.09;
    const sw = img.width * 0.92, sh = img.height * 0.79;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    // cover-fit so neither image is stretched
    const scale = Math.max(w / sw, h / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(img, sx, sy, sw, sh, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return c.toDataURL('image/png');
  }, [b64, W, H]);
}

const key = [];
let built = 0;
for (const p of PAIRS) {
  p.ours = await pick(p.clean, p.ours);
  if (!await exists(p.ours) || !await exists(p.ref)) {
    console.warn(`! skip ${p.name}: missing ${await exists(p.ours) ? p.ref : p.ours}`);
    continue;
  }
  if (p.ours !== p.clean) console.warn(`  (${p.name}: no clean hud=0 frame yet — run tools/blindshots.mjs)`);
  await mkdir(`${OUT}/${p.name}`, { recursive: true });
  // coin flip per pair, so the judge cannot learn "ours is always A"
  const oursIsA = Math.random() < 0.5;
  const a = await normalise(oursIsA ? p.ours : p.ref);
  const b = await normalise(oursIsA ? p.ref : p.ours);
  await writeFile(`${OUT}/${p.name}/A.png`, Buffer.from(a.split(',')[1], 'base64'));
  await writeFile(`${OUT}/${p.name}/B.png`, Buffer.from(b.split(',')[1], 'base64'));
  key.push({ pair: p.name, view: p.view, A: oursIsA ? 'OURS' : 'REFERENCE',
    B: oursIsA ? 'REFERENCE' : 'OURS', oursFile: p.ours, refFile: p.ref });
  console.log(`✓ ${p.name}  (${p.view})`);
  built++;
}

await writeFile(`${OUT}/KEY.json`, JSON.stringify(key, null, 2) + '\n');
await browser.close();
console.log(`\n${built} blind pair(s) in ${OUT}/. Key written (do not show the judge).`);
