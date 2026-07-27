// Measure the cloud coverage field for CREASES, instead of squinting at a
// screenshot for them.
//
// The field is a function on the sphere. A crease is a discontinuity in its
// GRADIENT, so walk a great circle, take the second difference, and look for a
// spike. The old field summed three axis-aligned planar projections of the
// surface direction; a linear projection of the sphere folds along the great
// circle where its kernel lies in the tangent plane, and a fold IS a gradient
// reversal. The old dominant octave and the old finest octave both projected
// on d.xy, so 56% of the field creased along the SAME circle: z = 0.
//
// usage: node tools/_cloudfield.mjs
import { Simplex } from '../src/noise.js';
import { makeRng } from '../src/rng.js';

// --- stand in for the browser canvas so detailTexture() can build its data ---
const S = 256;
const buf = new Uint8ClampedArray(S * S * 4);
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createImageData: () => ({ data: buf }),
      putImageData: () => {},
      drawImage: () => {}, clearRect: () => {}, filter: '',
    }),
  }),
};
globalThis.location = { search: '' };
const { detailTexture, cloudFbmCPU, sampleDetailCPU } = await import('../src/shaders.js');
detailTexture();
void Simplex; void makeRng;

// --- the OLD field, verbatim, for comparison ---------------------------------
function oldFbm(x, y, z, ox, oy, oz) {
  let f = sampleDetailCPU(x * 0.55 + ox, y * 0.55 + oy, 1) * 0.5;
  f += sampleDetailCPU(y * 1.15 + oy, z * 1.15 + oz, 0) * 0.25;
  f += sampleDetailCPU(z * 2.35 + oz, x * 2.35 + ox, 1) * 0.125;
  f += sampleDetailCPU(x * 4.8 - ox, y * 4.8 - oz, 0) * 0.0625;
  return f / 0.9375;
}

const OFF = [2.13, 5.02, 1.44];

// Walk the great circle through (1,0,0) and (0,0,1) — it crosses z=0 twice, at
// angle 0 and pi, which is the old xy-projection's fold. Report |2nd diff|.
function scan(fn, label) {
  const N = 4096;
  const v = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    v[i] = fn(Math.cos(a), 0.0, Math.sin(a));
  }
  let sum = 0;
  const d2 = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const p = v[(i - 1 + N) % N], n = v[(i + 1) % N];
    d2[i] = Math.abs(p + n - 2 * v[i]);
    sum += d2[i];
  }
  const mean = sum / N;
  // the fold sits at angle 0 and pi -> indices 0 and N/2
  const at = (k) => Math.max(d2[(k - 1 + N) % N], d2[k], d2[(k + 1) % N]);
  const fold = Math.max(at(0), at(N / 2));
  console.log(`${label.padEnd(10)} mean|d2|=${mean.toExponential(2)}  `
    + `at z=0 fold: ${fold.toExponential(2)}  -> ${(fold / mean).toFixed(1)}x background`);
  return fold / mean;
}

console.log('great circle in the y=0 plane; the old xy-chart folds at z=0\n');
const oldR = scan((x, y, z) => oldFbm(x, y, z, ...OFF), 'OLD');
const newR = scan((x, y, z) => cloudFbmCPU(x, y, z, ...OFF), 'NEW');
console.log(`\ncrease ratio  old ${oldR.toFixed(1)}x  ->  new ${newR.toFixed(1)}x`);

// and the field's gross statistics, which the seeded cov0/cov1 thresholds
// were tuned against and which must not move
function stats(fn) {
  let n = 0, s = 0, s2 = 0, lo = 9, hi = -9;
  for (let i = 0; i < 20000; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const v = fn(r * Math.cos(a), u, r * Math.sin(a));
    n++; s += v; s2 += v * v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const m = s / n;
  return `mean=${m.toFixed(3)} sd=${Math.sqrt(s2 / n - m * m).toFixed(3)} range=[${lo.toFixed(2)},${hi.toFixed(2)}]`;
}
console.log('\nOLD field', stats((x, y, z) => oldFbm(x, y, z, ...OFF)));
console.log('NEW field', stats((x, y, z) => cloudFbmCPU(x, y, z, ...OFF)));
