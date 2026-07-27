// Print the mean column brightness across a narrow x-range for a y-band, so a
// "seam" can be characterised (1px step? soft ramp? how wide?) instead of guessed.
// usage: node tools/_colprofile.mjs <png> <x0> <x1> [y0frac y1frac]
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
const [f, x0s, x1s, a = '0.05', b = '0.30'] = process.argv.slice(2);
const p = PNG.sync.read(readFileSync(f));
const { width: W, height: H, data } = p;
const y0 = Math.round(H * Number(a)), y1 = Math.round(H * Number(b));
const x0 = Number(x0s), x1 = Number(x1s);
const out = [];
for (let x = x0; x <= x1; x++) {
  let s = 0;
  for (let y = y0; y < y1; y++) { const i = (y * W + x) * 4; s += data[i] + data[i + 1] + data[i + 2]; }
  out.push(`${x}:${(s / ((y1 - y0) * 3)).toFixed(2)}`);
}
console.log(`${f.split('/').pop()} y[${y0},${y1})`);
console.log(out.join(' '));
