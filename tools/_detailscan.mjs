// How much high-frequency detail does the GROUND actually carry, at range?
//
// "The hills are smooth interpolated heightfield blobs" is a claim about
// spatial frequency, and squinting at a 1280x720 png cannot settle it — the
// eye invents structure at low contrast (see requirements.md §3b). This
// measures it: for a set of horizontal bands (foreground / mid / far), report
// the RMS of a high-pass of the luminance, in 1/255 units.
//
// High-pass = pixel minus the mean of a 5x5 neighbourhood, so it responds to
// grain, erosion texture and outcrop breakup and ignores the big smooth
// lighting gradients that a flat hillside is made of. A blob landscape scores
// near the dither floor (well under 1); textured ground scores several.
//
//   node tools/_detailscan.mjs a.png [b.png ...]
//   RECT=x0,y0,x1,y1 node tools/_detailscan.mjs a.png b.png
//
// Blue-dominant pixels are skipped, which removes sky, sea and the ship's
// canopy — the frame furniture that otherwise swamps the terrain number with
// its own hard edges. For an A/B on one framing prefer RECT over the default
// bands: pick a rectangle that is nothing but ground in BOTH frames and the
// comparison stops depending on what else moved.

import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const RAD = 2;   // 5x5 neighbourhood

function rectScan(lum, isSky, W, H, x0, y0, x1, y1, label = 'rect  ') {
  x0 = Math.max(RAD, x0); y0 = Math.max(RAD, y0);
  x1 = Math.min(W - RAD, x1); y1 = Math.min(H - RAD, y1);
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      if (isSky[i]) continue;
      let acc = 0, cnt = 0, bad = 0;
      for (let dy = -RAD; dy <= RAD && !bad; dy++) {
        for (let dx = -RAD; dx <= RAD; dx++) {
          const j = (y + dy) * W + (x + dx);
          if (isSky[j]) { bad = 1; break; }
          acc += lum[j]; cnt++;
        }
      }
      if (bad || cnt === 0) continue;
      const d = lum[i] - acc / cnt;
      sum += d * d; n++;
    }
  }
  return [label, n ? Math.sqrt(sum / n) : 0, n];
}

function scan(path) {
  const png = PNG.sync.read(readFileSync(path));
  const { width: W, height: H, data } = png;
  const lum = new Float64Array(W * H);
  const isSky = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // sky, sea and hull glass are all blue-dominant; vegetated and rocky
    // ground never is, at any haze level that still reads as ground.
    if (b > r + 4) isSky[i] = 1;
  }

  const rectEnv = process.env.RECT;
  // bands are fractions of image height, top of terrain to bottom of frame
  const bands = rectEnv ? null : [
    ['far   ', 0.42, 0.56],
    ['mid   ', 0.56, 0.74],
    ['near  ', 0.74, 1.00],
    ['ALL   ', 0.35, 1.00],
  ];
  if (rectEnv) {
    const [rx0, ry0, rx1, ry1] = rectEnv.split(',').map(Number);
    return [rectScan(lum, isSky, W, H, rx0, ry0, rx1, ry1)];
  }
  const out = [];
  for (const [name, y0f, y1f] of bands) {
    const y0 = Math.max(RAD, Math.floor(H * y0f));
    const y1 = Math.min(H - RAD, Math.floor(H * y1f));
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = RAD; x < W - RAD; x++) {
        const i = y * W + x;
        if (isSky[i]) continue;
        let acc = 0, cnt = 0, skySeen = 0;
        for (let dy = -RAD; dy <= RAD; dy++) {
          for (let dx = -RAD; dx <= RAD; dx++) {
            const j = (y + dy) * W + (x + dx);
            if (isSky[j]) { skySeen = 1; break; }
            acc += lum[j]; cnt++;
          }
          if (skySeen) break;
        }
        if (skySeen || cnt === 0) continue;   // skip the horizon edge itself
        const d = lum[i] - acc / cnt;
        sum += d * d; n++;
      }
    }
    out.push([name, n ? Math.sqrt(sum / n) : 0, n]);
  }
  return out;
}

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node tools/_detailscan.mjs <png>...'); process.exit(2); }
console.log('high-pass RMS of terrain luminance (1/255 units) — higher = more surface detail\n');
for (const f of files) {
  const rows = scan(f);
  console.log(f);
  for (const [name, rms, n] of rows) {
    console.log(`  ${name} ${rms.toFixed(3).padStart(7)}   (${n} px)`);
  }
  console.log('');
}
