// Star-field magnitude distribution, measured. A real sky has a steep
// distribution — most stars barely visible, a few bright. "Uniform dots" (§3b)
// should show up as nearly all star pixels landing in one brightness bucket.
// Samples only the dark upper corners, away from planet/HUD.
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
const p = PNG.sync.read(readFileSync(process.argv[2]));
const { width: W, height: H, data } = p;
const bins = new Array(8).fill(0);
let n = 0;
for (let y = Math.round(H * 0.18); y < Math.round(H * 0.75); y++) {
  for (let x = 0; x < W; x++) {
    if (x > W * 0.22 && x < W * 0.78) continue;      // skip the planet
    const i = (y * W + x) * 4;
    const v = Math.max(data[i], data[i + 1], data[i + 2]);
    if (v < 12) continue;                            // background
    bins[Math.min(7, Math.floor(v / 32))]++; n++;
  }
}
console.log(`${process.argv[2].split('/').pop()}  star pixels=${n}`);
console.log(bins.map((b, i) => `${i * 32}-${i * 32 + 31}:${(100 * b / Math.max(n, 1)).toFixed(1)}%`).join('  '));
