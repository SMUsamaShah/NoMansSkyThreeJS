// Procedural alien flora: every planet grows its own SPECIES. A seeded
// grammar assembles each one from organic pieces — bent trunks, bulb
// clusters, mushroom caps, frond fans, curling tentacles, glowing pods —
// with colors baked per-vertex from a hue-shifted planet palette. Low-poly
// flat-shaded to match the art style; alien by construction.

import * as THREE from 'three';
import { makeRng } from './rng.js';
import { Simplex } from './noise.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// paint a solid (slightly dithered) vertex color onto a geometry
function paint(geo, color, rng, jitter = 0.08) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = 1 + (rng() - 0.5) * jitter * 2;
    arr[i * 3] = color.r * k; arr[i * 3 + 1] = color.g * k; arr[i * 3 + 2] = color.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function place(geo, x, y, z, quat = null, s = 1) {
  _m.compose(_v.set(x, y, z), quat || _q.identity(),
    typeof s === 'number' ? new THREE.Vector3(s, s, s) : s);
  geo.applyMatrix4(_m);
  return geo;
}

// merge geometries (indexed or triangle-soup) that all carry position+color
function mergeGeos(list) {
  let vTotal = 0, iTotal = 0;
  for (const g of list) {
    vTotal += g.attributes.position.count;
    iTotal += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vTotal * 3);
  const col = new Float32Array(vTotal * 3);
  const idx = new Uint32Array(iTotal);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    col.set(g.attributes.color.array, vo * 3);
    const n = g.attributes.position.count;
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < n; i++) idx[io + i] = i + vo;
      io += n;
    }
    vo += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  return out;
}

// a tapering tube along a quadratic bezier — trunks, stalks, tentacles
function bentTube(rng, pal, h, r0, r1, leanX, leanZ, color, segs = 5, radial = 6) {
  const parts = [];
  const pt = (t) => _v.set(
    leanX * h * t * t, h * (t - 0.12 * t * t * (leanX * leanX + leanZ * leanZ)),
    leanZ * h * t * t).clone();
  let prev = pt(0);
  for (let s = 0; s < segs; s++) {
    const t0 = s / segs, t1 = (s + 1) / segs;
    const a = prev, b = pt(t1);
    const mid = a.clone().lerp(b, 0.5);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const rA = r0 + (r1 - r0) * t0, rB = r0 + (r1 - r0) * t1;
    const cyl = new THREE.CylinderGeometry(rB, rA, len, radial, 1);
    _q.setFromUnitVectors(Y, dir.normalize());
    paint(cyl, color, rng, 0.1);
    parts.push(place(cyl, mid.x, mid.y, mid.z, _q.clone()));
    prev = b;
  }
  return { parts, top: prev };
}

// A mass of foliage, not a polyhedron.
//
// This used to be IcosahedronGeometry(r, 1) — triangle soup, so the merge gave
// it flat normals, and a flat-shaded 80-triangle ball reads as exactly what it
// is: a faceted lump on a stick. That single primitive was the loudest
// "low-poly tech demo" signal in every surface frame.
//
// Now: an INDEXED sphere (so the merge's computeVertexNormals averages across
// shared vertices and the surface shades smoothly), pushed around by seeded
// noise so the silhouette is irregular, with occlusion baked toward the
// underside and the interior. Vertex count actually drops — indexed 70 vs
// soup 240 — so this is cheaper than what it replaces.
function blob(rng, r, color, noise, opts = {}) {
  const lumps = opts.lumps ?? 1.0;
  const squash = opts.squash ?? (0.78 + rng() * 0.34);
  const g = new THREE.SphereGeometry(r, 9, 7);
  const p = g.attributes.position;
  // one offset per lobe: two lobes of the same species never share a shape
  const ox = rng() * 40, oy = rng() * 40, oz = rng() * 40;
  const _n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    _n.set(p.getX(i), p.getY(i), p.getZ(i));
    const len = _n.length() || 1e-6;
    _n.multiplyScalar(1 / len);
    // Displacement is a pure function of DIRECTION, so the duplicated seam
    // column and the pole fan all move identically and the surface cannot
    // tear open — the property the old jitter map had to work to preserve.
    const d = noise.fbm(_n.x + ox, _n.y + oy, _n.z + oz, 1.35, 3, 0.55, 2.3, 1e9);
    const k = 1 + d * 0.42 * lumps;
    p.setXYZ(i, _n.x * r * k, _n.y * r * k * squash, _n.z * r * k);
  }
  paint(g, color, rng, 0.1);
  // baked occlusion: foliage is dark underneath and where it packs together.
  // Without this a canopy is a uniformly bright blob with no interior.
  const col = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const uy = p.getY(i) / (r * squash);
    const ao = 0.62 + 0.38 * Math.sqrt(Math.max(0, uy * 0.5 + 0.5));
    col.setXYZ(i, col.getX(i) * ao, col.getY(i) * ao, col.getZ(i) * ao);
  }
  return g;
}

function frond(rng, len, wid, curl, color) {
  // a tapering strip, bent forward row by row — a leaf blade / palm frond
  const rows = 4;
  const g = new THREE.PlaneGeometry(wid, len, 1, rows);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / len;
    const taper = 1 - t * 0.8;
    p.setX(i, p.getX(i) * taper);
    p.setZ(i, Math.sin(t * curl) * len * 0.35);
    p.setY(i, p.getY(i) * (1 - 0.25 * t * curl * 0.4));
  }
  return paint(g, color, rng, 0.12);
}

// Vary a lobe's colour WITHOUT the risk of driving it to black.
//
// offsetHSL's lightness term is absolute and clamps at 0. Foliage colours are
// dark to begin with (a lifted canopy sits near 0.06 HSL lightness), so an
// offset like (rng()-0.55)*0.13 simply clamped whole lobes to pure black —
// which is what those hard dark patches on every cap canopy were. Confirmed by
// bisection: they survived with shadow mapping entirely disabled, so they were
// never self-shadowing. Vary value MULTIPLICATIVELY instead, which cannot
// reach zero, and keep the hue drift that makes a canopy read as layered.
function lobeTint(out, base, rng, hueVar = 0.05, valLo = 0.82, valHi = 1.16) {
  out.copy(base).offsetHSL((rng() - 0.5) * hueVar, 0, 0);
  return out.multiplyScalar(valLo + rng() * (valHi - valLo));
}

// ---- species builders (origin at base, ~2–6 m tall) ------------------------

export const TREE_STYLES = ['orbs', 'cap', 'fronds', 'tentacles'];

function buildTree(rng, pal, canopyColor, noise, style) {
  // style is chosen WITHOUT replacement by buildFlora. Left to an independent
  // roll per species, a planet would routinely draw the same silhouette three
  // times — and at any distance where the outline is all you read, three
  // identical outlines is still a monoculture no matter how they are coloured.
  if (!style) style = TREE_STYLES[(rng() * TREE_STYLES.length) | 0];
  let h = 3.2 + rng() * 4.2;
  if (rng() < 0.18) h *= 1.6;        // some worlds grow giants
  const leanX = (rng() - 0.5) * 0.65, leanZ = (rng() - 0.5) * 0.65;
  const bulb = rng() < 0.35 ? 1.8 + rng() : 1;      // some trunks are bulbous
  const r0 = (0.05 + h * 0.028) * bulb, r1 = r0 * (0.22 + rng() * 0.2);
  const trunk = bentTube(rng, pal, h, r0, r1, leanX, leanZ, pal.trunk);
  const parts = trunk.parts;
  const top = trunk.top;

  if (style === 'orbs') {
    // A crown, not a handful of loose balls. One dominant mass sets the
    // silhouette; smaller lobes ring it at the shoulders to break the outline,
    // each tinted slightly differently so the canopy has interior depth
    // instead of reading as one flat-coloured object.
    const R = h * (0.24 + rng() * 0.12);
    const _c = new THREE.Color();
    parts.push(place(blob(rng, R, canopyColor, noise, { lumps: 1.15 }),
      top.x, top.y + R * 0.35, top.z));
    const n = 4 + (rng() * 4) | 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.8;
      const rr = R * (0.42 + rng() * 0.34);
      const reach = R * (0.72 + rng() * 0.4);
      // outer lobes catch more sky, so they sit a touch lighter and cooler
      lobeTint(_c, canopyColor, rng, 0.05, 0.88, 1.18);
      parts.push(place(blob(rng, rr, _c, noise, { lumps: 1.35 }),
        top.x + Math.cos(a) * reach,
        top.y + R * (0.05 + rng() * 0.55),
        top.z + Math.sin(a) * reach));
    }
  } else if (style === 'cap') {
    const r = h * (0.3 + rng() * 0.22), ch = r * (0.62 + rng() * 0.45);
    // A 9-segment lathe is a nonagon: from underneath it read as a flat-topped
    // umbrella, which is most of why these trees looked like cardboard. More
    // segments, more profile rows, and a rim that curls back UNDER the cap the
    // way a real one does — so the silhouette has a lip instead of an edge.
    const prof = [];
    const ROWS = 9;
    for (let i = 0; i <= ROWS; i++) {
      const t = i / ROWS;
      // bell: rises steeply, peaks wide at 55% height, tucks under at the rim
      const rr = Math.sin(Math.pow(t, 0.72) * Math.PI * 0.98);
      prof.push(new THREE.Vector2(Math.max(0.02, r * rr), ch * t));
    }
    // flare the underside lip outward so the rim is not a knife edge
    prof[1].x = Math.max(prof[1].x, r * 0.62);
    const cap = new THREE.LatheGeometry(prof, 26);
    // Break the outline. A lathe is perfectly circular, and a perfectly
    // circular dome is the single most toy-like shape there is — nothing
    // grown is that regular. Displace radially by seeded noise in (angle,
    // height) so the rim scallops and the profile ripples. Displacement is a
    // pure function of those two, so the duplicated seam column moves with
    // its twin and the surface cannot tear.
    {
      const cp = cap.attributes.position;
      const oa = rng() * 30, ob = rng() * 30;
      for (let i = 0; i < cp.count; i++) {
        const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
        const rad = Math.hypot(x, z);
        if (rad < 1e-4) continue;
        const ang = Math.atan2(z, x);
        const n = noise.fbm(Math.cos(ang) + oa, Math.sin(ang) + oa, y / ch * 1.7 + ob,
          1.9, 3, 0.55, 2.2, 1e9);
        // 0.3 across 18 segments put a 20-degree hard point at every lobe —
        // crumpled paper, not a canopy. Gentler, over more segments.
        const k = 1 + n * 0.15 * (0.35 + 0.65 * (rad / r));   // rim moves most
        cp.setXYZ(i, (x / rad) * rad * k, y, (z / rad) * rad * k);
      }
    }
    paint(cap, canopyColor, rng, 0.1);
    // darken the shaded underside — a cap lit flat top and bottom reads as a
    // decal, and the gill side is the part a viewer at eye height actually sees
    {
      const cp = cap.attributes.position, cc = cap.attributes.color;
      for (let i = 0; i < cp.count; i++) {
        // 0.55 was too deep a floor. A player stands 2 m tall under trees
        // 5-10 m tall, so the UNDERSIDE is what is actually on screen most of
        // the time — and combined with the cap shadowing itself it went to
        // near-black, reading as hard dark patches punched into the canopy.
        const k = 0.74 + 0.26 * Math.sqrt(cp.getY(i) / ch);
        cc.setXYZ(i, cc.getX(i) * k, cc.getY(i) * k, cc.getZ(i) * k);
      }
    }
    parts.push(place(cap, top.x, top.y - ch * 0.15, top.z));
    // Break the outline properly. Scalloping the lathe ripples the edge but
    // the silhouette is still one continuous curve, and a continuous curve is
    // what makes a canopy read as moulded. Real foliage dissolves into
    // separate masses at its edge — see the conifers in
    // reference/star-citizen/microtech-01-122019-min.jpg. These are small
    // lobes hung around and just under the rim, so the outline is made of
    // overlapping pieces instead of one arc.
    {
      const nRim = 7 + (rng() * 5) | 0;
      const _rc = new THREE.Color();
      for (let i = 0; i < nRim; i++) {
        const a = (i / nRim) * Math.PI * 2 + rng() * 0.7;
        const rr = r * (0.15 + rng() * 0.14);
        // Hug the rim from OUTSIDE. The first cut let clumps sit on top of the
        // cap, so the cap surface poked through them — and since flora renders
        // DoubleSide, those were backfaces with flipped normals, which showed
        // as hard black patches across every canopy.
        const reach = r * (0.94 + rng() * 0.22);
        lobeTint(_rc, canopyColor, rng, 0.04, 0.80, 1.10);
        parts.push(place(blob(rng, rr, _rc, noise, { lumps: 1.5, squash: 0.72 }),
          top.x + Math.cos(a) * reach,
          top.y - ch * 0.15 + ch * (0.02 + rng() * 0.22),
          top.z + Math.sin(a) * reach));
      }
    }
    if (rng() < 0.6) {          // glowing spots under the cap rim
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rng();
        parts.push(place(blob(rng, r * 0.08, pal.accent, noise),
          top.x + Math.cos(a) * r * 0.8, top.y + ch * 0.18, top.z + Math.sin(a) * r * 0.8));
      }
    }
  } else if (style === 'fronds') {
    const n = 5 + (rng() * 4) | 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.5;
      const f = frond(rng, h * (0.45 + rng() * 0.25), h * 0.09, 1.6 + rng(), canopyColor);
      _q.setFromAxisAngle(Y, a).multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.9 + rng() * 0.5));
      parts.push(place(f, top.x, top.y, top.z, _q.clone()));
    }
    parts.push(place(blob(rng, h * 0.07, pal.accent, noise), top.x, top.y, top.z));
  } else {                       // tentacles
    const n = 4 + (rng() * 3) | 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.6;
      const t = bentTube(rng, pal, h * (0.4 + rng() * 0.3), r1 * 1.5, 0.02,
        Math.cos(a) * (0.8 + rng() * 0.7), Math.sin(a) * (0.8 + rng() * 0.7), canopyColor, 4, 5);
      for (const g of t.parts) parts.push(place(g, top.x, top.y, top.z));
      parts.push(place(blob(rng, h * 0.045, pal.accent, noise), top.x + t.top.x, top.y + t.top.y, top.z + t.top.z));
    }
  }
  return { geo: shadeVertical(mergeGeos(parts), 0.62, 1.16), style, h };
}

// a ~40-triangle stand-in with the species' silhouette and colours — the far
// tier draws thousands of these out to the horizon so a forest is a forest
// from any altitude, not a bubble that grows around the camera
function buildFarTree(rng, pal, style, h, canopyColor) {
  const parts = [];
  const r0 = 0.06 + h * 0.03;
  const trunk = new THREE.CylinderGeometry(r0 * 0.55, r0 * 1.15, h, 5, 1);
  trunk.translate(0, h * 0.5, 0);
  paint(trunk, pal.trunk, rng, 0.06);
  parts.push(trunk);
  // Canopies are WIDER than their near-tier counterparts on purpose. The far
  // tier is instance-budget bound — one proxy per 32 m cell — so at a few
  // hundred metres up the proxies are spaced further apart than they are wide
  // and the forest reads as discrete coloured dots. A proxy is a stand-in for
  // several near trees anyway (that is why FAR_DENSITY is tuned per-m² rather
  // than per-tree), so widening it makes neighbours overlap into a canopy mass
  // for no extra instances. Roughly doubles covered area.
  let canopy;
  if (style === 'cap') {
    canopy = new THREE.ConeGeometry(h * 0.60, h * 0.34, 7);
    canopy.translate(0, h * 0.98, 0);
  } else if (style === 'fronds') {
    canopy = new THREE.ConeGeometry(h * 0.50, h * 0.46, 6);
    canopy.rotateX(Math.PI);
    canopy.translate(0, h * 1.04, 0);
  } else {           // orbs / tentacles read as a lumpy ball from afar
    canopy = new THREE.IcosahedronGeometry(h * 0.52, 0);
    canopy.scale(1, 0.78, 1);
    canopy.translate(0, h * 0.98, 0);
  }
  // Was multiplied by 1.6 to survive being washed out — a compensation for two
  // things that are now fixed: distance haze was applied three times over, and
  // the palette was 3-10x too dark. With both corrected, that over-brightening
  // makes every proxy POP against the forest-tinted ground, so a wooded slope
  // seen from a few hundred metres reads as colour confetti instead of a
  // canopy mass. Barely lifted now, and less per-vertex jitter, so proxies
  // merge into a surface the way the far tier is supposed to.
  paint(canopy, canopyColor.clone().multiplyScalar(1.06), rng, 0.05);
  parts.push(canopy);
  return shadeVertical(mergeGeos(parts), 0.6, 1.15);
}

function buildShrub(rng, pal) {
  const parts = [];
  const n = 6 + (rng() * 4) | 0;
  const len = 0.7 + rng() * 0.6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.7;
    const f = frond(rng, len * (0.8 + rng() * 0.4), len * 0.16, 1.2 + rng() * 0.9,
      rng() < 0.25 ? pal.accent : pal.canopy);
    _q.setFromAxisAngle(Y, a).multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.55 + rng() * 0.6));
    parts.push(place(f, 0, 0.02, 0, _q.clone()));
  }
  return shadeVertical(mergeGeos(parts), 0.7, 1.15);
}

function buildPodPlant(rng, pal, noise) {
  // person-height glowing bulbs on bent stalks — a landmark, not a pebble
  const parts = [];
  const n = 2 + (rng() * 2.4) | 0;
  for (let i = 0; i < n; i++) {
    const h = 1.0 + rng() * 1.0;
    const t = bentTube(rng, pal, h, 0.05, 0.03,
      (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.9, pal.trunk, 4, 5);
    parts.push(...t.parts);
    parts.push(place(blob(rng, 0.2 + rng() * 0.16, pal.accent, noise), t.top.x, t.top.y + 0.08, t.top.z));
  }
  return { geo: shadeVertical(mergeGeos(parts), 0.78, 1.1), glow: pal.accent.clone() };
}

function buildGrassTuft(rng) {
  // real blades (white — each instance is tinted per-planet at placement).
  // The baked root→tip brightness gradient is what makes grass read as
  // grass instead of spikes: dark at the soil, light where the sun sits.
  const white = new THREE.Color(1, 1, 1);
  const parts = [];
  const n = 7 + (rng() * 3) | 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const len = 0.55 + rng() * 0.45;
    const f = frond(rng, len, 0.055, 0.8 + rng() * 0.9, white);
    const pos = f.attributes.position, col = f.attributes.color;
    for (let v = 0; v < pos.count; v++) {
      const t = Math.max(0, Math.min(1, pos.getY(v) / len));
      const k = 0.45 + 0.75 * t;
      col.setXYZ(v, col.getX(v) * k, col.getY(v) * k, col.getZ(v) * k);
    }
    _q.setFromAxisAngle(Y, a).multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.22 + rng() * 0.4));
    parts.push(place(f, (rng() - 0.5) * 0.22, 0, (rng() - 0.5) * 0.22, _q.clone()));
  }
  const g = mergeGeos(parts);
  // blades light like the field, not like spinning planes: every normal
  // points straight up (instance rotation aligns it to the terrain), so a
  // meadow shades softly with the ground instead of flickering dark/bright
  const nrm = g.attributes.normal;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  return g;
}

// fake ambient occlusion, baked: plants darken toward the ground and
// brighten toward the crown — flat-shaded solids stop reading as bare
// untextured primitives the moment they carry a light gradient
function shadeVertical(geo, k0 = 0.68, k1 = 1.14) {
  const pos = geo.attributes.position, col = geo.attributes.color;
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const span = Math.max(1e-4, yMax - yMin);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - yMin) / span;
    const k = k0 + (k1 - k0) * Math.sqrt(t);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return geo;
}

// planet.js caches this at construction (planet.floraPal) so the terrain
// palette can borrow the canopy colour BEFORE it gets blended — deriving it
// twice from a mutated base would drift the species colours
export function floraPalette(planet, rng) {
  const base = (planet.pal.forest || planet.pal.land[Math.min(2, planet.pal.land.length - 1)].c).clone();
  // alien hue drift: exotic/toxic worlds shift hard, lush worlds sometimes
  const shift = planet.type === 'exotic' ? 0.15 + rng() * 0.5
    : planet.type === 'toxic' ? 0.1 + rng() * 0.3
      : rng() < 0.4 ? 0.06 + rng() * 0.24 : (rng() - 0.5) * 0.08;
  // Saturation used to go UP by 0.18 here, which is most of why the flora read
  // as candy rather than as plants. Nothing in reference/star-citizen or
  // reference/elite-dangerous is this saturated: natural foliage is muted and
  // sits in a narrow value band. Alien hue drift stays — alien colour is a
  // requirement (§2.4) — but the chroma comes down and the value goes down.
  // Saturation used to go UP by 0.18 here, which is most of why the flora read
  // as candy. But planet.js blends this same colour into the TERRAIN's forest
  // tint, so cutting it to -0.09 drained the green out of whole landscapes and
  // left every lush world reading blue-grey. Land near neutral: much less candy
  // than +0.18, without bleaching the world it tints.
  const canopy = base.clone().offsetHSL(shift, 0.01, 0.02);
  const canopy2 = canopy.clone().offsetHSL(0.3 + rng() * 0.35, -0.03, (rng() - 0.4) * 0.08);
  // a third species: two trees per world meant every stand was a duet, and at
  // any distance where the silhouette is all you read, a duet is a monoculture
  const canopy3 = canopy.clone().offsetHSL(0.14 + rng() * 0.22, -0.10, (rng() - 0.3) * 0.11);
  const trunk = (planet.pal.rock || base).clone()
    .lerp(new THREE.Color(0.34, 0.24, 0.17), 0.4 + rng() * 0.25);
  const accent = new THREE.Color().setHSL(rng(), 0.85, 0.58);
  // Same albedo floor the terrain palette gets, and for the same measured
  // reason. tree1's vertex colours were bottoming out at 0.008 luminance with
  // 12.7% of the mesh below 0.02 — black. Foliage starts dark, then blob()'s
  // baked AO (0.62 floor) and shadeVertical()'s gradient (0.62 floor) multiply
  // to 0.38, and 0.38 of an already-dark colour is nothing at all. Lift the
  // source into real vegetation albedo (0.05-0.12 linear) so the AO passes
  // have something to darken.
  const lumOf = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const lift = (c, target) => {
    const l = lumOf(c);
    if (l > 1e-5 && l < target) c.multiplyScalar(target / l);
    return c;
  };
  lift(canopy, 0.085); lift(canopy2, 0.075); lift(canopy3, 0.080);
  lift(trunk, 0.055);   // bark is dark, but it is not a silhouette
  return { canopy, canopy2, canopy3, trunk, accent };
}

// every geometry here is a pure function of the planet seed
export function buildFlora(planet) {
  const rng = makeRng(planet.seed + ':flora');
  // its OWN stream: building a Simplex burns 255 draws, and taking those from
  // `rng` would shift every species decision downstream of it
  const noise = new Simplex(makeRng(planet.seed + ':flora:shape'));
  const pal = planet.floraPal || floraPalette(planet, rng);
  const pod = buildPodPlant(rng, pal, noise);
  // three DIFFERENT silhouettes, drawn without replacement
  const pool = TREE_STYLES.slice();
  const takeStyle = () => pool.splice((rng() * pool.length) | 0, 1)[0];
  const t0 = buildTree(rng, pal, pal.canopy, noise, takeStyle());
  const t1 = buildTree(rng, pal, pal.canopy2, noise, takeStyle());
  const t2 = buildTree(rng, pal, pal.canopy3 || pal.canopy2, noise, takeStyle());
  return {
    tree0: t0.geo,
    tree1: t1.geo,
    tree2: t2.geo,
    shrub: buildShrub(rng, pal),
    pod: pod.geo,
    podGlow: pod.glow,
    grass: buildGrassTuft(rng),
    // meadows lean toward the planet's canopy colour instead of bare dirt —
    // the ground tint alone made grass vanish on dark soils
    grassTint: pal.canopy.clone().offsetHSL(0, 0.02, 0.10),
    // horizon-range proxies for the far tier
    far0: buildFarTree(rng, pal, t0.style, t0.h, pal.canopy),
    far1: buildFarTree(rng, pal, t1.style, t1.h, pal.canopy2),
    far2: buildFarTree(rng, pal, t2.style, t2.h, pal.canopy3 || pal.canopy2),
  };
}
