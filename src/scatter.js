// Surface props: alien flora (seeded per-planet species from flora.js) plus
// rocks and crystals, scattered around the camera when near the ground.
// Placement is a pure function of (planet seed, surface cell) — walk away
// and come back, the same tree is waiting.

import * as THREE from 'three';
import { hash3i, hashFloat } from './rng.js';
import { applyWindSway, GROW } from './shaders.js';
import { chainAerial } from './scattering.js';
import { buildFlora } from './flora.js';

// wind strength per prop kind (0 = rigid)
const SWAY = { grass: 0.08, shrub: 0.05, pod: 0.03, tree0: 0.012, tree1: 0.012, tree2: 0.012, blob: 0.02, cactus: 0.008 };

// jagged rock: displace a subdivided solid by hashed per-vertex noise —
// crags instead of platonic dice
function craggyGeo(base, amount, seed) {
  const pos = base.attributes.position;
  const seen = new Map();   // co-located verts must move together
  for (let i = 0; i < pos.count; i++) {
    const key = pos.getX(i).toFixed(3) + ',' + pos.getY(i).toFixed(3) + ',' + pos.getZ(i).toFixed(3);
    let k = seen.get(key);
    if (k === undefined) {
      const h = hash3i(Math.round(pos.getX(i) * 97), Math.round(pos.getY(i) * 89),
        Math.round(pos.getZ(i) * 83), seed);
      k = 1 + (hashFloat(h, 0) - 0.35) * amount;
      seen.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  base.computeVertexNormals();
  return base;
}

const CELL_M = 9;            // metres per scatter cell (approx)
const RANGE = 24;            // cells of radius around the camera
// instance caps sized ABOVE the densest possible biome in range — a kind
// that saturates its cap renders an anchor-dependent subset, which shows
// up as props sliding around while you walk
const CAPS = {
  grass: 10000, shrub: 2600, tree0: 1500, tree1: 1500, tree2: 1500, pod: 1200,
  // stone litters at several per cell now, so its ceiling has to clear the
  // densest mineral biome in range or rocks visibly slide around as you walk
  rock: 6000, boulder: 2200,
  default: 2000,
};
// props that spawn several per cell rather than one
const COPIES = { grass: 22, rock: 6, boulder: 2 };
// per-kind reach in cells (default RANGE). Short reach + many copies = dense
// cover where it reads, nothing wasted at a distance where a blade is subpixel.
const REACH = { grass: 9 };

// ONE size distribution, shared by the near bubble and the far proxy tier.
// A uniform draw made every tree the same tree; this biases toward small so a
// stand reads as mostly young with a few that got to the light, the way the
// conifers do in reference/star-citizen/microtech-01-122019-min.jpg.
// It lives here and is exported because §2.4 requires the two tiers to agree:
// if their MEAN scale differs the forest visibly changes size at the handoff.
// (A cubic skew shipped briefly on the near tier alone and did exactly that —
// mean 0.92 near against 1.07 far.)
export function propScale(t, s0, s1) { return s0 + (s1 - s0) * Math.pow(t, 2.2); }
// the dominant forest recipe's tree range, which the far tier must mirror
export const FAR_TREE_S0 = 0.5;
export const FAR_TREE_S1 = 2.3;
// max random lie-angle (radians): stone is dropped, not planted
const TILTS = { rock: 0.9, boulder: 0.55 };
export function capFor(kind) { return CAPS[kind] ?? CAPS.default; }
// Radius (metres) inside which a kind is guaranteed fully faded in, so its
// props must persist bit-identically across rebuilds. Beyond it the grow-in
// fade is legitimately anchor-dependent. Exported so the walk-stability test
// derives this from the real reach instead of hardcoding one number for every
// kind — which silently became wrong the moment kinds stopped sharing a range.
export function stableRadiusM(kind) { return Math.max(0, (REACH[kind] || RANGE) - 6) * CELL_M; }
const SHOW_BELOW_ALT = 600;  // metres

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _jd = new THREE.Vector3();
const _ce1 = new THREE.Vector3();
const _ce2 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _ic = new THREE.Color();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _tilt = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// shared mineral geometries (unit-ish size, origin at base) — vegetation is
// per-planet (seeded species built by flora.js in setPlanet)
function baseGeo() {
  const shift = (g, y) => { g.translate(0, y, 0); return g; };
  return {
    rock: craggyGeo(new THREE.IcosahedronGeometry(0.7, 1), 0.75, 101),
    // detail 2, not 1: a boulder is the biggest prop on the ground and an
    // 80-triangle one reads as a cut gem. Its density is low enough that the
    // extra triangles are affordable where the same spend on `rock` would not be.
    boulder: shift(craggyGeo(new THREE.IcosahedronGeometry(1.4, 2), 0.5, 202), 0.9),
    crystal: shift(new THREE.OctahedronGeometry(1, 0), 0.9),
    blob: shift(new THREE.SphereGeometry(0.9, 6, 5), 0.5),
    cactus: shift(new THREE.CylinderGeometry(0.28, 0.36, 2.4, 6), 1.2),
  };
}
let GEO = null;
const FLORA_KINDS = ['tree0', 'tree1', 'tree2', 'shrub', 'pod', 'grass'];

// per-biome prop recipes: [kind, density 0..1, minScale, maxScale]
//
// Density is the probability that a 9 m cell picks this kind at all, so a
// recipe summing to 0.14 leaves 86% of the ground bare — which is what made
// our deserts empty next to reference/star-citizen/daymar-122019-min.jpg.
// Stone densities are way up, and stone SIZE RANGES are now wide: combined
// with propScale's skew, s0..s1 spanning an order of magnitude
// gives a power-law scree — mostly grit, occasional boulder — instead of one
// size class repeated. That spread is the thing the reference frames have and
// we did not.
const RECIPES = {
  grass:    [['grass', 0.7, 0.9, 1.7], ['shrub', 0.09, 0.7, 1.4], ['tree0', 0.025, 0.5, 1.9], ['tree2', 0.025, 0.5, 1.8], ['pod', 0.02, 0.8, 1.4], ['rock', 0.12, 0.10, 1.5]],
  forest:   [['tree0', 0.22, 0.5, 2.3], ['tree1', 0.16, 0.45, 2.0], ['tree2', 0.12, 0.5, 2.1], ['shrub', 0.14, 0.8, 1.5], ['grass', 0.2, 0.8, 1.5], ['rock', 0.12, 0.10, 1.8]],
  snow:     [['tree1', 0.03, 0.45, 2.0], ['tree2', 0.02, 0.45, 1.9], ['rock', 0.30, 0.10, 2.2], ['boulder', 0.07, 0.45, 1.8]],
  sand:     [['cactus', 0.04, 0.7, 1.5], ['shrub', 0.02, 0.5, 1.0], ['rock', 0.34, 0.08, 1.9], ['boulder', 0.04, 0.45, 1.9]],
  rock:     [['rock', 0.46, 0.10, 2.0], ['boulder', 0.12, 0.5, 2.1]],
  regolith: [['rock', 0.44, 0.09, 1.9], ['boulder', 0.11, 0.45, 2.0]],
  ice:      [['crystal', 0.06, 0.6, 1.8], ['rock', 0.26, 0.09, 1.8]],
  ash:      [['rock', 0.38, 0.09, 2.2], ['boulder', 0.08, 0.45, 1.7]],
  ember:    [['rock', 0.24, 0.09, 1.8]],
  slime:    [['pod', 0.14, 1.0, 2.0], ['tree1', 0.03, 0.6, 2.2], ['tree2', 0.02, 0.6, 2.1], ['blob', 0.14, 0.6, 2.0], ['grass', 0.2, 1.0, 1.8], ['crystal', 0.03, 0.5, 1.4]],
  weird:    [['tree1', 0.07, 0.6, 2.6], ['tree2', 0.05, 0.6, 2.4], ['crystal', 0.11, 0.7, 2.6], ['pod', 0.08, 1.0, 2.0], ['blob', 0.06, 0.8, 2.2]],
  shore:    [['rock', 0.22, 0.08, 1.4], ['shrub', 0.02, 0.5, 1.0]],
  dryland:  [['grass', 0.28, 0.7, 1.3], ['shrub', 0.055, 0.6, 1.2], ['rock', 0.20, 0.09, 1.9]],
};

function propColors(planet) {
  const p = planet.pal;
  // Stone belongs to the ground it sits on. p.rock alone is the CLIFF colour,
  // which on a pale desert is far darker than the sand — scattered over a
  // bright surface it read as a field of black cutouts, where in
  // reference/star-citizen/daymar-122019-min.jpg the stones are only a shade
  // darker than what they lie on. Pull them toward the mid land tone.
  const landMid = p.land[Math.min(1, p.land.length - 1)].c;
  const base = {
    rock: p.rock.clone().lerp(landMid, 0.38).multiplyScalar(1.1),
    boulder: p.rock.clone().lerp(landMid, 0.28).multiplyScalar(1.0),
    crystal: null,
    blob: (p.blotch || p.rock).clone(),
    cactus: new THREE.Color(0x55a04a).convertSRGBToLinear(),
  };
  switch (planet.type) {
    case 'toxic': base.crystal = (p.blotch || p.rock).clone().multiplyScalar(1.4); break;
    case 'ice': base.crystal = new THREE.Color(0x9fd0f0).convertSRGBToLinear(); break;
    case 'exotic': base.crystal = p.land[p.land.length - 1].c.clone().multiplyScalar(1.3); break;
  }
  if (!base.crystal) base.crystal = new THREE.Color(0xb0d8f0).convertSRGBToLinear();
  return base;
}

// flora carries its colour per-vertex, so a flat material.emissive can't
// follow it — patch the emissive term to inherit the vertex/instance tint.
// Pods then glow in their own accent colour at night for free.
function floraEmissive(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      #ifdef USE_COLOR
        totalEmissiveRadiance *= vColor;
      #endif`);
  };
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => (key ? key.call(mat) : '') + '-flora';
}
// self-light per flora kind (keeps vegetation readable in shadow; pods glow)
const FLORA_GLOW = { tree0: 0.16, tree1: 0.16, tree2: 0.16, shrub: 0.14, pod: 0.55, grass: 0.09 };

export class Scatter {
  constructor() {
    if (!GEO) GEO = baseGeo();
    this.planet = null;
    this.flora = null;  // per-planet species geometries
    this.meshes = {};   // kind -> InstancedMesh
    this.lastKey = '';
    this.seen = new Set();
  }

  setPlanet(planet) {
    this.clear();
    this.planet = planet;
    if (!planet) return;
    const colors = propColors(planet);
    for (const kind of Object.keys(GEO)) {
      // a touch of self-light keeps the stylized props readable in shadow
      const glow = kind === 'crystal' ? 0.35
        : (kind === 'rock' || kind === 'boulder') ? 0.08 : 0.3;
      const mat = new THREE.MeshStandardMaterial({
        color: colors[kind], roughness: 0.95, flatShading: true,
        emissive: colors[kind].clone().multiplyScalar(glow),
      });
      applyWindSway(mat, SWAY[kind] || 0);   // 0 sway still wires the grow scale
      chainAerial(mat);
      this.addMesh(planet, kind, GEO[kind], mat);
    }
    // this world's own species: geometry seeded by the planet, colours baked
    // per-vertex (material stays white; instance colour adds per-plant drift).
    // The planet owns the geometries — the far tier shares them.
    this.flora = planet.flora || (planet.flora = buildFlora(planet));
    for (const kind of FLORA_KINDS) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff, vertexColors: true, roughness: 0.9,
        // grass carries hand-authored up-normals (field-soft lighting) that
        // flat shading would discard
        // Only ROCK wants faceting. Flat-shading vegetation discards the
        // vertex normals the canopies are built with and hands back the
        // "low-poly demo" look the smooth lobes exist to kill.
        flatShading: false, side: THREE.DoubleSide,
      });
      mat.emissive.setScalar(FLORA_GLOW[kind]);
      applyWindSway(mat, SWAY[kind] || 0);
      floraEmissive(mat);
      chainAerial(mat);
      const im = this.addMesh(planet, kind, this.flora[kind], mat);
      if (kind === 'grass') im.castShadow = false;   // invisible; halves its cost
    }
    this.lastKey = '';
  }

  addMesh(planet, kind, geo, mat) {
    const im = new THREE.InstancedMesh(geo, mat, capFor(kind));
    im.count = 0;
    im.frustumCulled = false;
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    planet.group.add(im);
    this.meshes[kind] = im;
    return im;
  }

  clear() {
    if (this.planet) {
      for (const kind in this.meshes) {
        const im = this.meshes[kind];
        this.planet.group.remove(im);
        im.material.dispose();
        im.dispose();
      }
    }
    this.flora = null;   // geometries are planet-owned (planet.dispose frees them)
    this.meshes = {};
    this.planet = null;
    this.lastKey = '';
  }

  hideAll() {
    for (const kind in this.meshes) this.meshes[kind].count = 0;
  }

  // camLocal: camera in planet-local coords; alt: metres above terrain
  update(planet, camLocal, alt) {
    if (planet !== this.planet) this.setPlanet(alt < SHOW_BELOW_ALT ? planet : null);
    if (!this.planet) return;
    // climbing away: props shrink to nothing across a 200 m band instead of
    // blinking out (all at once!) the moment an altitude line is crossed
    const g = Math.max(0, Math.min(1, (SHOW_BELOW_ALT - alt) / 200));
    GROW.value = g * g * (3 - 2 * g);
    if (alt > SHOW_BELOW_ALT) { this.hideAll(); this.lastKey = ''; return; }

    const p = this.planet;
    _dir.copy(camLocal).normalize();
    const Q = p.R / CELL_M;                 // cell-id lattice radius
    const cellAng = CELL_M / p.R;

    // rebuild only when the camera crosses into a new planet-fixed cell
    const kx = Math.round(_dir.x * Q), ky = Math.round(_dir.y * Q), kz = Math.round(_dir.z * Q);
    const key = p.seed + ':' + kx + ':' + ky + ':' + kz;
    if (key === this.lastKey) return;
    this.lastKey = key;

    // discovery lattice anchored at the CANONICAL center of the camera's own
    // cell — planet-fixed, so the grid of sample points never swims
    _anchor.set(kx, ky, kz).normalize();
    if (Math.abs(_anchor.y) < 0.93) _e1.set(-_anchor.z, 0, _anchor.x).normalize();
    else _e1.set(1, 0, 0).projectOnPlane(_anchor).normalize();
    _e2.crossVectors(_anchor, _e1);

    const counts = {};
    for (const kind in this.meshes) counts[kind] = 0;
    const seedI = p.intSeed ^ 0x5ca7;
    this.seen.clear();

    // half-step oversampling, and every sample claims all 8 lattice corners
    // of its cube — so which cells get found cannot depend on how the
    // discovery grid happens to align with the planet lattice
    const STEPS = RANGE * 2;
    for (let gy = -STEPS; gy <= STEPS; gy++) {
      for (let gx = -STEPS; gx <= STEPS; gx++) {
        if (gx * gx + gy * gy > STEPS * STEPS) continue;
        _v.copy(_anchor)
          .addScaledVector(_e1, gx * 0.5 * cellAng)
          .addScaledVector(_e2, gy * 0.5 * cellAng)
          .normalize();
        const fx = Math.floor(_v.x * Q), fy = Math.floor(_v.y * Q), fz = Math.floor(_v.z * Q);
        for (let corner = 0; corner < 8; corner++) {
          const qx = fx + (corner & 1), qy = fy + ((corner >> 1) & 1), qz = fz + (corner >> 2);
          // pack ±16383 per axis (Q reaches ~13.4k on 120 km worlds)
          const ck = (qx + 16384) + (qy + 16384) * 32768 + (qz + 16384) * 1073741824;
          if (this.seen.has(ck)) continue;
          this.seen.add(ck);
          // only cells on the planet's surface shell carry a prop
          if (Math.abs(Math.hypot(qx, qy, qz) - Q) > 0.7) continue;
          this.placeCell(p, qx, qy, qz, Q, cellAng, seedI, counts);
        }
      }
    }
    for (const kind in this.meshes) {
      this.meshes[kind].count = counts[kind];
      this.meshes[kind].instanceMatrix.needsUpdate = true;
      if (this.meshes[kind].instanceColor) this.meshes[kind].instanceColor.needsUpdate = true;
    }
  }

  // everything here depends ONLY on (planet seed, qx, qy, qz):
  // the same rock stands in the same spot forever
  placeCell(p, qx, qy, qz, Q, cellAng, seedI, counts) {
    _up.set(qx, qy, qz).normalize();          // canonical cell direction
    const h0 = hash3i(qx, qy, qz, seedI);

    // props near the range edge grow in instead of popping in
    const dot = Math.min(1, Math.max(-1, _up.dot(_anchor)));
    const cells = Math.acos(dot) / cellAng;
    if (cells > RANGE - 1) return;

    const hgt = p.height(_up, p.fullMaxFreq);
    const recipe = RECIPES[p.biomeAt(_up, hgt)];
    if (!recipe) return;

    const sel = hashFloat(h0, 0);
    let acc = 0, chosen = null;
    for (const r of recipe) { acc += r[1]; if (sel < acc) { chosen = r; break; } }
    if (!chosen) return;
    const [kind, , s0, s1] = chosen;
    const im = this.meshes[kind];
    if (!im || counts[kind] >= capFor(kind)) return;

    // Per-kind reach. Grass was spread over the full 216 m at one tuft per
    // ~100 m², which is not ground cover, it is decoration. Real engines put
    // real blades in a tight ring only and let the terrain colour carry the
    // field beyond it (§2.4's albedo hand-off already does the carrying). So
    // grass gets a short reach and many more tufts per cell: the same instance
    // budget, spent where the eye can actually resolve a blade.
    const reach = REACH[kind] || RANGE;
    let edge = Math.min(1, Math.max(0, ((reach - 1) - cells) / 5));
    if (edge < 0.03) return;
    edge = edge * edge * (3 - 2 * edge);

    // cell-local tangent frame, derived from the canonical direction
    if (Math.abs(_up.y) < 0.93) _ce1.set(-_up.z, 0, _up.x).normalize();
    else _ce1.set(1, 0, 0).projectOnPlane(_up).normalize();
    _ce2.crossVectors(_up, _ce1);

    // Grass grows in clumps; stone litters. One prop per 9 m cell is fine for
    // a tree and nothing like a real rocky surface — look at reference/
    // star-citizen/daymar-122019-min.jpg or drifters-microtech.jpg: stones
    // every metre or two, spanning pebble to boulder. Those need copies.
    const copies = COPIES[kind] || 1;
    for (let c = 0; c < copies && counts[kind] < capFor(kind); c++) {
      const hc = c === 0 ? h0 : hash3i(qx + c * 131, qy - c * 57, qz + c * 263, seedI);
      // jitter inside the cell, then re-sample ground height there
      _jd.copy(_up)
        .addScaledVector(_ce1, (hashFloat(hc, 1) - 0.5) * cellAng)
        .addScaledVector(_ce2, (hashFloat(hc, 2) - 0.5) * cellAng)
        .normalize();
      const hh = p.height(_jd, p.fullMaxFreq);
      if (p.hasLiquid && hh < p.seaLevel + 0.4) continue;   // not in the sea

      _v2.copy(_jd).multiplyScalar(p.R + hh);
      _q.setFromUnitVectors(Y, _jd);
      _q2.setFromAxisAngle(Y, hashFloat(hc, 1) * Math.PI * 2);
      _q.multiply(_q2);
      // A second hash, because hashFloat only has three usable lanes (lane 3
      // would shift past 32 bits) and lane 2 was already spent on the jitter
      // offset — so size and position were correlated, which is visible as
      // patterning once you know to look.
      const hs = hash3i(qx + 977 + c * 37, qy - 401 - c * 89, qz + 733 + c * 149, seedI);
      // Skewed, not uniform: a real stand is mostly young and small with a few
      // that got to the light, and a real scree is mostly grit with the odd
      // boulder. A flat 0.7–1.3 spread made every tree the same tree, which is
      // what turned a forest into wallpaper.
      const sc = propScale(hashFloat(hs, 0), s0, s1) * edge;
      _s.set(sc, sc * (0.74 + hashFloat(hs, 1) * 0.62), sc);
      if (TILTS[kind]) {
        // stone was not planted: let it lie at whatever angle it fell, or it
        // reads as a row of eggs stood on end
        // its OWN vector: _e1 holds the cell-enumeration frame for the whole
        // rebuild, so borrowing it here corrupted every cell placed after the
        // first rock — and corrupted it differently depending on where the
        // camera stood, which is exactly the anchor-dependent churn the walk
        // test exists to catch
        _q.multiply(_q2.setFromAxisAngle(_tilt.set(1, 0, 0), (hashFloat(hs, 2) - 0.5) * TILTS[kind]));
      }
      _m.compose(_v2, _q, _s);
      if (kind === 'grass') {
        // tufts blend the ground colour with the planet's canopy tint: they
        // still belong to the terrain, but read as living growth on any soil
        p.colorAt(_jd, hh, 0.08, 64, _ic);
        _ic.lerp(this.flora.grassTint, 0.5).multiplyScalar(1.35).offsetHSL(
          (hashFloat(hc, 0) - 0.5) * 0.05, 0.06, (hashFloat(hc, 1) - 0.5) * 0.12);
      } else {
        // no two plants quite the same colour
        _ic.setRGB(1, 1, 1).offsetHSL(
          (hashFloat(hc, 0) - 0.5) * 0.05, 0, (hashFloat(hc, 1) - 0.5) * 0.16);
      }
      im.setColorAt(counts[kind], _ic);
      im.setMatrixAt(counts[kind]++, _m);
    }
  }
}
