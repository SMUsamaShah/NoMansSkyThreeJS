// Measure planet-scale lighting from an orbit frame.
//
// The complaint is literally positional — "the landmass at top-left is the same
// brightness and contrast as the landmass at bottom-right" — so the measurement
// is positional too: a grid of mean luminance over PLANET pixels only (space is
// excluded by a luminance floor), and the spread across that grid. A planet
// with a real terminator has a large cell-to-cell range along one axis; a
// uniformly-lit ball has none.
//
// Reference reading, reference/elite-dangerous/ed-odyssey-atmospheric-planet.jpg:
// the lit-side cells run ~4x the terminator-side cells and the darkest occupied
// cells fall to a few percent luminance. Anything under ~1.6x is "flat".
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

const GX = 4, GY = 4;
const SPACE = 0.02;      // below this the pixel is sky/space, not planet

for (const f of process.argv.slice(2)) {
  const png = PNG.sync.read(readFileSync(f));
  const { width: W, height: H, data } = png;
  const sum = new Float64Array(GX * GY), cnt = new Float64Array(GX * GY);
  let all = 0, alln = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const l = 0.2126 * data[i] / 255 + 0.7152 * data[i + 1] / 255 + 0.0722 * data[i + 2] / 255;
      if (l < SPACE) continue;                 // deep space
      const c = Math.min(GX - 1, (x * GX / W) | 0) + Math.min(GY - 1, (y * GY / H) | 0) * GX;
      sum[c] += l; cnt[c]++; all += l; alln++;
    }
  }
  console.log(`\n${f}  ${W}x${H}   lit coverage ${(100 * alln / (W * H)).toFixed(1)}%  mean L ${(all / Math.max(alln, 1)).toFixed(3)}`);
  const cells = [];
  for (let gy = 0; gy < GY; gy++) {
    const line = [];
    for (let gx = 0; gx < GX; gx++) {
      const c = gx + gy * GX;
      const fill = cnt[c] / (W * H / (GX * GY));
      if (fill < 0.12) { line.push('   --  '); continue; }   // mostly empty space
      const v = sum[c] / cnt[c];
      cells.push(v);
      line.push(` ${v.toFixed(3)} `);
    }
    console.log('   ' + line.join(''));
  }
  if (cells.length >= 2) {
    const mx = Math.max(...cells), mn = Math.min(...cells);
    console.log(`   occupied-cell range ${mn.toFixed(3)} .. ${mx.toFixed(3)}   ratio ${(mx / Math.max(mn, 1e-4)).toFixed(2)}x   [flat < 1.6x]`);
  }
}
