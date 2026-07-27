// Measure aerial perspective instead of squinting at it.
//
// "Aerial perspective is a flat blue wash with no depth falloff" and "ridges are
// within a few percent luminance of the sky above them" are NUMERIC claims, and
// §3b's standing lesson is that this project mis-diagnoses everything it does
// not measure. Two reports per image:
//
//  BANDS — ten horizontal bands, each with mean luminance L, mean saturation S
//  and local contrast C (stddev of L inside the band). Aerial perspective has a
//  signature here: S must climb steeply from the horizon down to the near
//  ground, because haze desaturates and haze is a function of distance.
//
//  HORIZON — finds the horizon row (steepest downward luminance step in the
//  upper half of the frame), then reports the sky strip just above it against
//  the ridge strip just below it, and the near ground at the bottom of frame.
//  This is framing-independent, so our probes and the reference frames are
//  directly comparable even though they are composed differently.
//
// Targets, measured off reference/star-citizen/dunboro-aerial-view-microtech.jpg:
//   sky-vs-ridge luminance separation  ~0.14 absolute / ~24% relative
//   near-ground saturation / ridge saturation  ~2.9x
// A "flat blue wash" scores near 0 on the first and near 1.0 on the second.
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

const BANDS = 10;

function stats(png, y0, y1, x0, x1) {
  const { width: W, data } = png;
  let sl = 0, ss = 0, n = 0;
  const ls = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sl += l; ss += mx > 1e-4 ? (mx - mn) / mx : 0; n++;
      ls.push(l);
    }
  }
  const L = sl / n;
  let v = 0;
  for (const l of ls) v += (l - L) * (l - L);
  return { L, S: ss / n, C: Math.sqrt(v / n) };
}

function rowLum(png, y, x0, x1) {
  const { width: W, data } = png;
  let s = 0;
  for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    s += 0.2126 * data[i] / 255 + 0.7152 * data[i + 1] / 255 + 0.0722 * data[i + 2] / 255;
  }
  return s / (x1 - x0);
}

for (const f of process.argv.slice(2)) {
  const png = PNG.sync.read(readFileSync(f));
  const { width: W, height: H } = png;
  const x0 = Math.round(W * 0.08), x1 = Math.round(W * 0.92);

  console.log(`\n${f}  ${W}x${H}`);
  console.log('  band   L      S      C      (band 0 = top of frame)');
  const rows = [];
  for (let b = 0; b < BANDS; b++) {
    const ya = Math.round(H * (b / BANDS)), yb = Math.round(H * ((b + 1) / BANDS));
    const r = stats(png, ya, yb, x0, x1);
    rows.push(r);
    console.log(`  ${String(b).padStart(4)}  ${r.L.toFixed(3)}  ${r.S.toFixed(3)}  ${r.C.toFixed(3)}`);
  }

  // --- horizon: steepest DOWNWARD luminance step in the upper 65% of frame,
  // measured over a 3% smoothing window so a single dark ridge crest or a
  // cloud edge cannot win.
  const win = Math.max(2, Math.round(H * 0.03));
  let hy = -1, best = 0;
  for (let y = win; y < Math.round(H * 0.65) - win; y++) {
    let a = 0, b = 0;
    for (let k = 1; k <= win; k++) { a += rowLum(png, y - k, x0, x1); b += rowLum(png, y + k, x0, x1); }
    const d = (a - b) / win;
    if (d > best) { best = d; hy = y; }
  }
  if (hy < 0) { console.log('  HORIZON: none found'); continue; }
  const sky = stats(png, Math.max(0, hy - win * 3), Math.max(1, hy - win), x0, x1);
  const ridge = stats(png, hy + win, Math.min(H, hy + win * 4), x0, x1);
  const near = stats(png, Math.round(H * 0.85), H, x0, x1);
  const sep = sky.L - ridge.L;
  console.log(`  HORIZON row ${hy}/${H}`);
  console.log(`    sky   L=${sky.L.toFixed(3)} S=${sky.S.toFixed(3)} C=${sky.C.toFixed(3)}`);
  console.log(`    ridge L=${ridge.L.toFixed(3)} S=${ridge.S.toFixed(3)} C=${ridge.C.toFixed(3)}`);
  console.log(`    near  L=${near.L.toFixed(3)} S=${near.S.toFixed(3)} C=${near.C.toFixed(3)}`);
  console.log(`    sky-ridge separation  ${sep.toFixed(3)} abs  ${(100 * sep / Math.max(sky.L, 1e-4)).toFixed(1)}% rel   [ref ~0.14 / 24%]`);
  console.log(`    near/ridge saturation ${(near.S / Math.max(ridge.S, 1e-4)).toFixed(2)}x                  [ref ~2.9x]`);
  console.log(`    near/ridge contrast   ${(near.C / Math.max(ridge.C, 1e-4)).toFixed(2)}x`);
}
