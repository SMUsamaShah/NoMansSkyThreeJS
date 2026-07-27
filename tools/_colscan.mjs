// Find a 1px vertical seam objectively: average each column over a sky band
// and flag any column that differs sharply from BOTH its neighbours. Squinting
// at faint lines in screenshots is exactly how this project kept mis-diagnosing
// artifacts; measure instead.
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
const f = process.argv[2];
const p = PNG.sync.read(readFileSync(f));
const { width: W, height: H, data } = p;
// average each column over a sky band, then look for a column that differs
// sharply from BOTH neighbours — that is what a 1px seam looks like
const y0 = Math.round(H * 0.30), y1 = Math.round(H * 0.52);
const col = new Float64Array(W);
for (let x = 0; x < W; x++) {
  let s = 0;
  for (let y = y0; y < y1; y++) { const i = (y * W + x) * 4; s += data[i] + data[i+1] + data[i+2]; }
  col[x] = s / ((y1 - y0) * 3);
}
// ignore the HUD gutters, which are legitimately high-contrast
const X0 = Math.round(W * 0.06), X1 = Math.round(W * 0.94);
const hits = [];
for (let x = X0; x < X1; x++) {
  const d = col[x] - (col[x - 2] + col[x + 2]) / 2;
  hits.push([Math.abs(d), x, d]);
}
hits.sort((a, b) => b[0] - a[0]);
const top = hits.slice(0, 3).map(([, x, d]) => `x=${x}:${d.toFixed(2)}`).join('  ');
console.log(`${f.split('/').pop().padEnd(26)} top column anomalies /255 -> ${top}`);
