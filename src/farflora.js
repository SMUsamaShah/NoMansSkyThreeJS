// Far flora: the detailed scatter bubble only reaches ~200 m, so without
// this tier a forested world looks BARE from anywhere above walking height
// and trees visibly grow in as you approach. Here every vegetated cell out
// to ~4.5 km gets a low-poly proxy tree (same species silhouette/colours),
// instanced in two draw calls. A vertex-shader fade dissolves proxies just
// inside the detailed bubble and at the far rim, so trees stand on the
// horizon from 10+ km up and nothing ever pops or "grows".
//
// Placement is a pure function of (planet seed, coarse surface cell) —
// tiles are cached, built a few per update, and repacked into the global
// InstancedMesh, so flying laps around a planet always regrows the same
// forest.

import * as THREE from 'three';
import { hash3i, hashFloat } from './rng.js';
import { buildFlora } from './flora.js';
import { chainAerial } from './scattering.js';
import { propScale, FAR_TREE_S0, FAR_TREE_S1 } from './scatter.js';

const TILE_M = 1024;         // metres per cache tile
const CELL_M = 32;           // metres per proxy-tree cell (32 per tile edge)
const RADIUS = 4.4;          // tiles of reach around the camera (~4.5 km)
const CAP = 24000;           // per species
// Reverted to the documented reach after a failed experiment. Lowering this to
// hand over to the terrain tint sooner does NOT fix the speckling, because the
// speckling is a function of DISTANCE (proxies 500-800 m away), not altitude —
// uAltK is still 1 at 600 m up. And shortening the far range to chase it would
// narrow §2.4's explicit "proxy trees to ~4.5 km", which is not mine to trade
// away. See §3b 10b: this is spacing-bound and needs impostors.
const SHOW_BELOW = 16000;    // m altitude; fade starts at 10 km

// per-biome CLUMP probability per 32 m cell, then the species mix as
// cumulative thresholds. One proxy stands for several near-tier trees (they
// inflate with distance), so the clump probability chases the near tier's
// per-m² density as far as the instance budget allows — a 12x density cliff at
// the bubble edge reads as "the forest ends here".
//
// The mix used to be a single "tree0 share" tested against hashFloat(h, 3) —
// but lane 3 shifts past 32 bits and only ever yields 0.0005..0.0034, so that
// comparison was CONSTANT: every biome drew exactly one species for its entire
// far tier. That was the distant half of the monoculture look. Thresholds are
// cumulative over SPECIES and drawn from their own hash now.
const FAR_DENSITY = {
  forest:  [0.8,  [0.44, 0.76, 1.0]],
  grass:   [0.32, [0.40, 0.70, 1.0]],
  snow:    [0.42, [0.0, 0.6, 1.0]],
  slime:   [0.38, [0.0, 0.6, 1.0]],
  weird:   [0.5,  [0.0, 0.58, 1.0]],
  dryland: [0.1,  [0.45, 0.75, 1.0]],
};
const SPECIES = 3;

const _dir = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3();
const _jd = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _ce1 = new THREE.Vector3();
const _ce2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);

// shader hooks: proxies dissolve inside the detailed bubble, at the far rim,
// and when the camera climbs out — all on the GPU, no per-instance updates
function applyFarFade(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uCamL;
        uniform float uAltK;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        {
          float d = distance(instanceMatrix[3].xyz, uCamL);
          float g = smoothstep(150.0, 205.0, d) * (1.0 - smoothstep(3900.0, 4400.0, d)) * uAltK;
          // proxies stand for clumps: slightly large at the handoff, and
          // inflating further with distance so far canopies OVERLAP — a
          // forest must stay a forest on a hillside 3 km away
          g *= 1.15 + 1.15 * smoothstep(450.0, 2400.0, d);
          transformed *= g;
        }
        #endif`);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      #ifdef USE_COLOR
        totalEmissiveRadiance *= vColor;
      #endif`);
  };
  mat.customProgramCacheKey = () => 'far-flora';
}

export class FarFlora {
  constructor() {
    this.planet = null;
    this.meshes = null;       // [tree0 proxies, tree1 proxies]
    this.tiles = new Map();   // packed tile key -> {m: Float32Array[], n: number[]}
    this.queue = [];
    this.lastKey = '';
    this.dirty = false;
    this.uCamL = { value: new THREE.Vector3() };
    this.uAltK = { value: 1 };
  }

  setPlanet(planet) {
    this.clear();
    this.planet = planet;
    if (!planet) return;
    const flora = planet.flora || (planet.flora = buildFlora(planet));
    this.meshes = [flora.far0, flora.far1, flora.far2].map((geo) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff, vertexColors: true, roughness: 0.95, flatShading: true,
      });
      mat.emissive.setScalar(0.10);   // was another brightener stacked on the same problem
      applyFarFade(mat, { uCamL: this.uCamL, uAltK: this.uAltK });
      chainAerial(mat);
      const im = new THREE.InstancedMesh(geo, mat, CAP);
      im.count = 0;
      im.frustumCulled = false;
      im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      planet.group.add(im);
      return im;
    });
  }

  clear() {
    if (this.planet && this.meshes) {
      for (const im of this.meshes) {
        this.planet.group.remove(im);
        im.material.dispose();
        im.dispose();      // geometry is planet-owned
      }
    }
    this.meshes = null;
    this.planet = null;
    this.tiles.clear();
    this.queue.length = 0;
    this.lastKey = '';
    this.dirty = false;
  }

  pending() { return this.queue.length; }

  update(planet, camLocal, alt) {
    if (planet !== this.planet) this.setPlanet(alt < SHOW_BELOW ? planet : null);
    if (!this.planet) return;
    if (alt > SHOW_BELOW) { this.clear(); return; }
    const p = this.planet;
    this.uCamL.value.copy(camLocal);
    this.uAltK.value = smooth01((13000 - alt) / 3000);

    // tile discovery on crossing a tile-sized cell of the coarse lattice
    _dir.copy(camLocal).normalize();
    const Q = p.R / TILE_M;
    const kx = Math.round(_dir.x * Q), ky = Math.round(_dir.y * Q), kz = Math.round(_dir.z * Q);
    const key = kx + ':' + ky + ':' + kz;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.anchorK = [kx, ky, kz];
      const want = new Set();
      _anchor.set(kx, ky, kz).normalize();
      frame(_anchor, _e1, _e2);
      const STEPS = Math.ceil(RADIUS) * 2 + 1;
      const ang = TILE_M / p.R;
      for (let gy = -STEPS; gy <= STEPS; gy++) {
        for (let gx = -STEPS; gx <= STEPS; gx++) {
          if (gx * gx + gy * gy > (RADIUS * 2 + 1) * (RADIUS * 2 + 1)) continue;
          _v.copy(_anchor)
            .addScaledVector(_e1, gx * 0.5 * ang)
            .addScaledVector(_e2, gy * 0.5 * ang)
            .normalize();
          const fx = Math.floor(_v.x * Q), fy = Math.floor(_v.y * Q), fz = Math.floor(_v.z * Q);
          for (let c = 0; c < 8; c++) {
            const qx = fx + (c & 1), qy = fy + ((c >> 1) & 1), qz = fz + (c >> 2);
            if (Math.abs(Math.hypot(qx, qy, qz) - Q) > 0.71) continue;
            want.add((qx + 512) + (qy + 512) * 1024 + (qz + 512) * 1048576);
          }
        }
      }
      for (const k of this.tiles.keys()) {
        if (!want.has(k)) { this.tiles.delete(k); this.dirty = true; }
      }
      const missing = [];
      for (const k of want) if (!this.tiles.has(k)) missing.push(k);
      missing.sort((a, b) => a - b);          // deterministic build order
      this.queue = missing;
    }

    // build a couple of tiles per frame (each is ~600 height/biome samples)
    let built = 0;
    while (this.queue.length && built < 2) {
      const k = this.queue.shift();
      if (!this.tiles.has(k)) {
        this.tiles.set(k, this.buildTile(p, k));
        this.dirty = true;
        built++;
      }
    }

    if (this.dirty) this.repack();
  }

  buildTile(p, key) {
    const qx = (key % 1024) - 512;
    const qy = (Math.floor(key / 1024) % 1024) - 512;
    const qz = Math.floor(key / 1048576) - 512;
    const Q = p.R / TILE_M;
    const Q3 = p.R / CELL_M;
    const cellAng = CELL_M / p.R;
    const seedI = p.intSeed ^ 0xfa12;
    _anchor.set(qx, qy, qz).normalize();
    frame(_anchor, _e1, _e2);
    const SUB = Math.round(TILE_M / CELL_M) + 1;
    const buckets = Array.from({ length: SPECIES }, () => []);
    const seen = new Set();
    for (let gy = -SUB; gy <= SUB; gy++) {
      for (let gx = -SUB; gx <= SUB; gx++) {
        _v.copy(_anchor)
          .addScaledVector(_e1, gx * 0.5 * cellAng)
          .addScaledVector(_e2, gy * 0.5 * cellAng)
          .normalize();
        // the candidate belongs to THIS tile only (no double-planting from
        // the neighbour's overlapping scan)
        if (Math.round(_v.x * Q) !== qx || Math.round(_v.y * Q) !== qy
          || Math.round(_v.z * Q) !== qz) continue;
        const cx = Math.floor(_v.x * Q3), cy = Math.floor(_v.y * Q3), cz = Math.floor(_v.z * Q3);
        for (let c = 0; c < 8; c++) {
          const ux = cx + (c & 1), uy = cy + ((c >> 1) & 1), uz = cz + (c >> 2);
          const ck = ux + ':' + uy + ':' + uz;
          if (seen.has(ck)) continue;
          seen.add(ck);
          if (Math.abs(Math.hypot(ux, uy, uz) - Q3) > 0.7) continue;
          _up.set(ux, uy, uz).normalize();
          if (Math.round(_up.x * Q) !== qx || Math.round(_up.y * Q) !== qy
            || Math.round(_up.z * Q) !== qz) continue;
          const h0 = hash3i(ux, uy, uz, seedI);
          const hgt = p.height(_up, 96);
          const dens = FAR_DENSITY[p.biomeAt(_up, hgt)];
          if (!dens) continue;
          const sel = hashFloat(h0, 0);
          if (sel >= dens[0]) continue;
          // jitter inside the cell, ground the tree at full terrain detail
          frame(_up, _ce1, _ce2);
          _jd.copy(_up)
            .addScaledVector(_ce1, (hashFloat(h0, 1) - 0.5) * cellAng)
            .addScaledVector(_ce2, (hashFloat(h0, 2) - 0.5) * cellAng)
            .normalize();
          // full terrain frequency: a coarse height differs from the drawn
          // surface by tens of metres — trees planted with it are BURIED
          const hh = p.height(_jd, p.fullMaxFreq);
          if (p.hasLiquid && hh < p.seaLevel + 0.6) continue;
          _p.copy(_jd).multiplyScalar(p.R + hh - 0.4);
          _q.setFromUnitVectors(Y, _jd);
          _q2.setFromAxisAngle(Y, hashFloat(h0, 1) * Math.PI * 2);
          _q.multiply(_q2);
          // same skew and same range as the near bubble — §2.4: if the two
          // tiers disagree about mean scale the forest changes size at the
          // handoff, which is exactly the popping this tier exists to prevent
          const sc = propScale(hashFloat(h0, 2), FAR_TREE_S0, FAR_TREE_S1);
          _s.set(sc, sc * (0.85 + hashFloat(h0, 0) * 0.4), sc);
          _m.compose(_p, _q, _s);
          // its own hash: lane 3 of h0 is degenerate (see FAR_DENSITY)
          const hsp = hashFloat(hash3i(ux + 613, uy - 209, uz + 887, seedI), 0);
          let si = SPECIES - 1;
          for (let k = 0; k < SPECIES; k++) { if (hsp < dens[1][k]) { si = k; break; } }
          buckets[si].push(..._m.elements);
        }
      }
    }
    return {
      m: buckets.map((b) => new Float32Array(b)),
      n: buckets.map((b) => b.length / 16),
    };
  }

  repack() {
    this.dirty = false;
    if (!this.meshes) return;
    // nearest tiles pack first: if a fully-forested world overflows the
    // instance budget, the holes appear at the far rim, never underfoot
    const [ax, ay, az] = this.anchorK || [0, 0, 0];
    const dist2 = (k) => {
      const qx = (k % 1024) - 512;
      const qy = (Math.floor(k / 1024) % 1024) - 512;
      const qz = Math.floor(k / 1048576) - 512;
      return (qx - ax) * (qx - ax) + (qy - ay) * (qy - ay) + (qz - az) * (qz - az);
    };
    const keys = [...this.tiles.keys()].sort((a, b) => (dist2(a) - dist2(b)) || (a - b));
    const counts = new Array(SPECIES).fill(0);
    const arrs = this.meshes.map((im) => im.instanceMatrix.array);
    for (const k of keys) {
      const t = this.tiles.get(k);
      for (let si = 0; si < SPECIES; si++) {
        const c = Math.min(t.n[si], CAP - counts[si]);
        if (c > 0) { arrs[si].set(t.m[si].subarray(0, c * 16), counts[si] * 16); counts[si] += c; }
      }
    }
    for (let si = 0; si < SPECIES; si++) {
      this.meshes[si].count = counts[si];
      this.meshes[si].instanceMatrix.needsUpdate = true;
    }
  }
}

function frame(u, a, b) {
  if (Math.abs(u.y) < 0.93) a.set(-u.z, 0, u.x).normalize();
  else a.set(1, 0, 0).projectOnPlane(u).normalize();
  b.crossVectors(u, a);
}

function smooth01(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}
