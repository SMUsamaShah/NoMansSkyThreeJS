// Procedural space stations: every system gets one, seeded, and no two are
// alike. A grammar picks a topology — spinning RING, long SPINE truss,
// radial CROSS, or podded CLUSTER — then dresses it with hull plating in
// two tones plus an accent, dotted HDR window bands (bloom picks them up),
// solar wings, dishes, antennas, blinking beacons, and a slowly rotating
// section. Pure geometry, no assets; ~6–15k triangles in 3 draw calls.

import * as THREE from 'three';
import { makeRng } from './rng.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

function paint(geo, color, rng, jitter = 0.05) {
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

// a strut between two points
function truss(rng, pal, a, b, r) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const cyl = new THREE.CylinderGeometry(r, r, len, 6, 1);
  _q.setFromUnitVectors(Y, dir.normalize());
  paint(cyl, pal.dark, rng);
  const mid = a.clone().lerp(b, 0.5);
  return place(cyl, mid.x, mid.y, mid.z, _q.clone());
}

// a dotted band of lit windows around a drum at height y (axis Y)
function windowBand(rng, out, r, y, n, tint) {
  for (let i = 0; i < n; i++) {
    if (rng() < 0.3) continue;                    // dark rooms, variety
    const a = (i / n) * Math.PI * 2;
    const box = new THREE.BoxGeometry(1.6, 1.0, 0.5);
    const c = tint.clone().multiplyScalar(1.7 + rng() * 1.3);   // HDR: bloom food
    paint(box, c, rng, 0.02);
    _q.setFromAxisAngle(Y, -a);
    out.push(place(box, Math.cos(a) * r, y, Math.sin(a) * r, _q.clone()));
  }
}

// a communications dish on a short mast, aimed by the rng
function dish(rng, pal, r) {
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector2(0.06 * r + t * r, r * 0.34 * t * t));
  }
  const lathe = new THREE.LatheGeometry(pts, 10);
  paint(lathe, pal.light, rng);
  const mast = new THREE.CylinderGeometry(r * 0.06, r * 0.06, r * 0.5, 5);
  paint(mast, pal.dark, rng);
  place(mast, 0, -r * 0.25, 0);
  const g = mergeGeos([mast, lathe]);
  _q.setFromEuler(new THREE.Euler(rng() * 1.2 - 0.6, rng() * Math.PI * 2, rng() * 1.2 - 0.6));
  g.applyQuaternion(_q);
  return g;
}

function antenna(rng, pal, len) {
  const g = new THREE.CylinderGeometry(len * 0.008, len * 0.02, len, 4);
  g.translate(0, len / 2, 0);
  return paint(g, pal.dark, rng);
}

// a habitation drum with end caps, hull stripes and greebles
function drum(rng, pal, out, win, r, len, x, y, z, quat) {
  const body = new THREE.CylinderGeometry(r, r, len, 14, 1);
  paint(body, rng() < 0.3 ? pal.dark : pal.light, rng);
  out.push(place(body, x, y, z, quat));
  for (const e of [-1, 1]) {
    const cap = new THREE.CylinderGeometry(e > 0 ? r * 0.72 : r, e > 0 ? r : r * 0.72, len * 0.09, 14, 1);
    paint(cap, pal.accent, rng, 0.03);
    const off = _v.set(0, e * (len / 2 + len * 0.045), 0).applyQuaternion(quat || _q.identity());
    out.push(place(cap, x + off.x, y + off.y, z + off.z, quat));
  }
  // dotted windows around the drum, in the drum's own frame
  const bands = 1 + (rng() * 2.4) | 0;
  for (let b = 0; b < bands; b++) {
    const local = [];
    windowBand(rng, local, r + 0.35, (rng() - 0.5) * len * 0.6, Math.max(8, (r * 0.55) | 0), pal.warm);
    for (const w of local) {
      if (quat) w.applyQuaternion(quat);
      w.translate(x, y, z);
      win.push(w);
    }
  }
  // greebles: surface boxes and a vent cylinder or two
  const n = 2 + (rng() * 4) | 0;
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const gy = (rng() - 0.5) * len * 0.7;
    const box = new THREE.BoxGeometry(r * (0.12 + rng() * 0.2), r * (0.1 + rng() * 0.25), r * 0.12);
    paint(box, rng() < 0.5 ? pal.dark : pal.accent, rng);
    _q.setFromAxisAngle(Y, -a);
    place(box, Math.cos(a) * r, gy, Math.sin(a) * r, _q.clone());
    if (quat) box.applyQuaternion(quat);
    box.translate(x, y, z);
    out.push(box);
  }
}

function solarWing(rng, pal, out, w, l, x, y, z, yaw) {
  const panel = new THREE.BoxGeometry(l, 0.6, w);
  paint(panel, pal.panel, rng, 0.12);
  const frame = new THREE.BoxGeometry(l * 1.02, 1.4, w * 0.06);
  paint(frame, pal.dark, rng);
  _q.setFromAxisAngle(Y, yaw);
  out.push(place(panel, x, y, z, _q.clone()));
  out.push(place(frame, x, y, z, _q.clone()));
}

function pod(rng, pal, out, win, r, x, y, z) {
  const s = new THREE.SphereGeometry(r, 12, 9);
  paint(s, rng() < 0.4 ? pal.dark : pal.light, rng);
  out.push(place(s, x, y, z));
  const ring = new THREE.TorusGeometry(r * 0.99, r * 0.05, 6, 20);
  ring.rotateX(Math.PI / 2);
  paint(ring, pal.accent, rng, 0.03);
  out.push(place(ring, x, y, z));
  const local = [];
  windowBand(rng, local, r * 0.96, r * 0.28, Math.max(8, (r * 0.5) | 0), pal.warm);
  for (const w of local) { w.translate(x, y, z); win.push(w); }
}

// ---- topologies -------------------------------------------------------------

function buildRing(rng, pal, S, R) {
  // rotating habitat torus around a static hub spire
  const tube = R * (0.09 + rng() * 0.05);
  const torus = new THREE.TorusGeometry(R, tube, 8, 32);
  torus.rotateX(Math.PI / 2);
  paint(torus, pal.light, rng);
  S.rotorHull.push(torus);
  const spokes = 3 + (rng() * 3) | 0;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    S.rotorHull.push(truss(rng, pal,
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R), tube * 0.28));
  }
  // windows dotted along the torus equator
  windowBand(rng, S.rotorWin, R + tube + 0.4, 0, (R * 0.35) | 0, pal.warm);
  // static spire through the middle
  drum(rng, pal, S.hull, S.win, R * 0.16, R * 0.75, 0, 0, 0, null);
  const domeTop = new THREE.SphereGeometry(R * 0.16, 12, 7);
  paint(domeTop, pal.accent, rng, 0.03);
  S.hull.push(place(domeTop, 0, R * 0.38, 0));
  S.hull.push(place(antenna(rng, pal, R * 0.6), 0, R * 0.45, 0));
  S.hull.push(place(dish(rng, pal, R * 0.14), R * 0.1, R * 0.3, 0));
  S.beacons.push([0, R * 1.06, 0], [R + tube, 0, 0], [-R - tube, 0, 0]);
  S.spinRate = (0.03 + rng() * 0.03) * (rng() < 0.5 ? 1 : -1);
  return R + tube;
}

function buildSpine(rng, pal, S, R) {
  const L = R * 2.6;
  S.hull.push(truss(rng, pal, new THREE.Vector3(0, -L / 2, 0), new THREE.Vector3(0, L / 2, 0), R * 0.045));
  const modules = 4 + (rng() * 3.4) | 0;
  for (let i = 0; i < modules; i++) {
    const y = -L / 2 + (i + 0.5) * (L / modules);
    if (rng() < 0.25) {
      pod(rng, pal, S.hull, S.win, R * (0.16 + rng() * 0.1), 0, y, 0);
    } else {
      drum(rng, pal, S.hull, S.win, R * (0.12 + rng() * 0.1), L / modules * (0.55 + rng() * 0.25), 0, y, 0, null);
    }
  }
  // solar gantries
  const wings = 1 + (rng() * 2) | 0;
  for (let i = 0; i < wings; i++) {
    const y = (rng() - 0.5) * L * 0.6;
    const yaw = rng() * Math.PI;
    const l = R * (1.1 + rng() * 0.5);
    for (const e of [-1, 1]) {
      const dx = Math.cos(yaw) * e * (l / 2 + R * 0.2), dz = Math.sin(yaw) * e * (l / 2 + R * 0.2);
      solarWing(rng, pal, S.hull, R * 0.5, l, dx, y, dz, yaw);
      S.hull.push(truss(rng, pal, new THREE.Vector3(0, y, 0), new THREE.Vector3(dx, y, dz), R * 0.02));
    }
  }
  // an occasional small gravity ring mid-spine
  if (rng() < 0.55) {
    const rr = R * (0.5 + rng() * 0.25);
    const ring = new THREE.TorusGeometry(rr, rr * 0.14, 7, 24);
    ring.rotateX(Math.PI / 2);
    paint(ring, pal.accent, rng, 0.04);
    const y = (rng() - 0.5) * L * 0.4;
    S.rotorHull.push(place(ring, 0, y, 0));
    S.rotorY = y;
    S.spinRate = (0.05 + rng() * 0.05) * (rng() < 0.5 ? 1 : -1);
  }
  S.hull.push(place(dish(rng, pal, R * 0.2), 0, L / 2 + R * 0.05, 0));
  S.hull.push(place(antenna(rng, pal, R * 0.8), 0, -L / 2 - R * 0.05, 0, _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI).clone()));
  S.beacons.push([0, L / 2 + R * 0.12, 0], [0, -L / 2 - R * 0.12, 0]);
  return L / 2;
}

function buildCross(rng, pal, S, R) {
  const hubR = R * 0.32;
  pod(rng, pal, S.hull, S.win, hubR, 0, 0, 0);
  const arms = 3 + (rng() * 2.6) | 0;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rng() * 0.3;
    const end = new THREE.Vector3(Math.cos(a) * R, (rng() - 0.5) * R * 0.14, Math.sin(a) * R);
    S.hull.push(truss(rng, pal, new THREE.Vector3(0, 0, 0), end, hubR * 0.13));
    _q.setFromAxisAngle(Y, -a - Math.PI / 2)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
    drum(rng, pal, S.hull, S.win, hubR * (0.45 + rng() * 0.25), R * 0.5, end.x, end.y, end.z, _q.clone());
    if (i < 2) S.beacons.push([end.x * 1.25, end.y, end.z * 1.25]);
  }
  S.hull.push(truss(rng, pal, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, R * 0.7, 0), hubR * 0.1));
  pod(rng, pal, S.hull, S.win, hubR * 0.5, 0, R * 0.7, 0);
  S.hull.push(place(dish(rng, pal, hubR * 0.5), 0, hubR * 1.3, 0));
  S.beacons.push([0, R * 0.7 + hubR * 0.75, 0]);
  return R + hubR;
}

function buildCluster(rng, pal, S, R) {
  const cR = R * 0.34;
  pod(rng, pal, S.hull, S.win, cR, 0, 0, 0);
  const pods = 4 + (rng() * 3) | 0;
  for (let i = 0; i < pods; i++) {
    const dir = new THREE.Vector3(rng() * 2 - 1, (rng() * 2 - 1) * 0.5, rng() * 2 - 1).normalize();
    const d = cR * (2.1 + rng() * 1.1);
    const r = cR * (0.4 + rng() * 0.35);
    const p = dir.multiplyScalar(d);
    S.hull.push(truss(rng, pal, new THREE.Vector3(0, 0, 0), p, cR * 0.08));
    pod(rng, pal, S.hull, S.win, r, p.x, p.y, p.z);
    if (i < 2) S.beacons.push([p.x * 1.2, p.y * 1.2 + r, p.z * 1.2]);
  }
  S.hull.push(place(antenna(rng, pal, cR * 2.2), 0, cR * 0.8, 0));
  S.beacons.push([0, cR * 3, 0]);
  return R * 1.15;
}

// ---- assembly ---------------------------------------------------------------

const TOPOLOGIES = [
  ['ring', buildRing, 0.34], ['spine', buildSpine, 0.26],
  ['cross', buildCross, 0.22], ['cluster', buildCluster, 0.18],
];

export function makeStation(seed, name) {
  const rng = makeRng(seed);
  const hue = rng();
  const pal = {
    light: new THREE.Color().setHSL(hue, 0.06 + rng() * 0.08, 0.58 + rng() * 0.12),
    dark: new THREE.Color().setHSL(hue, 0.1, 0.22 + rng() * 0.08),
    accent: new THREE.Color().setHSL((hue + 0.35 + rng() * 0.3) % 1, 0.7, 0.45),
    panel: new THREE.Color(0.06, 0.12, 0.22),
    warm: new THREE.Color(1.0, 0.82, 0.55),
  };
  let pick = rng(), topology = TOPOLOGIES[0];
  for (const t of TOPOLOGIES) { pick -= t[2]; if (pick <= 0) { topology = t; break; } }
  const R = 260 + rng() * 420;
  const S = { hull: [], win: [], rotorHull: [], rotorWin: [], beacons: [], spinRate: 0, rotorY: 0 };
  const radius = topology[1](rng, pal, S, R);

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  // a random tilt so no two stations sit on the same axis
  body.quaternion.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.7, rng() * Math.PI * 2, (rng() - 0.5) * 0.7));

  const hullMat = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.45, roughness: 0.5, flatShading: true,
  });
  hullMat.emissive.setScalar(0.03);
  const winMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const meshes = [];
  const add = (parts, mat, parent) => {
    if (!parts.length) return null;
    const mesh = new THREE.Mesh(mergeGeos(parts), mat);
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  add(S.hull, hullMat, body);
  add(S.win, winMat, body);
  const rotor = new THREE.Group();
  rotor.position.y = S.rotorY;
  body.add(rotor);
  if (S.rotorHull.length) {
    for (const g of S.rotorHull) g.translate(0, -S.rotorY, 0);
    add(S.rotorHull, hullMat, rotor);
  }
  if (S.rotorWin.length) {
    for (const g of S.rotorWin) g.translate(0, -S.rotorY, 0);
    add(S.rotorWin, winMat, rotor);
  }
  // beacons: one merged mesh, one shared blinking material
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });
  if (S.beacons.length) {
    const bg = [];
    for (const [x, y, z] of S.beacons) {
      const s = new THREE.SphereGeometry(3.2, 6, 5);
      paint(s, new THREE.Color(1, 1, 1), rng, 0);
      bg.push(place(s, x, y, z));
    }
    add(bg, beaconMat, body);
  }

  let t = rng() * 10;
  return {
    group, radius, name, topology: topology[0], posUniv: new THREE.Vector3(),
    update(animDt) {
      t += animDt;
      rotor.rotation.y = t * S.spinRate;
      const k = Math.pow(Math.max(0, Math.sin(t * 2.1)), 14) * 2.6 + 0.12;
      beaconMat.color.setRGB(k * 1.5, k * 0.22, k * 0.16);
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      hullMat.dispose();
      winMat.dispose();
      beaconMat.dispose();
    },
  };
}
