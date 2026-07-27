// Triangle-cost accounting for props. Flora is instanced by the thousand, so a
// geometry change that looks cheap per-plant is not: multiply by the caps in
// scatter.js before believing any of these numbers are affordable.
import * as THREE from 'three';
import { Planet } from '../src/planet.js';
import { buildFlora } from '../src/flora.js';
import { capFor, baseGeoStats } from '../src/scatter.js';

const p = new Planet({ seed: 'EUCLID:g', name: 'G', posUniv: new THREE.Vector3(), type: 'lush' });
const f = buildFlora(p);
const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
let worst = 0;
for (const k of Object.keys(f)) {
  const g = f[k];
  if (!g || !g.attributes) continue;
  const cap = capFor(k.startsWith('far') ? 'far' : k);
  console.log(k.padEnd(8), 'verts', String(g.attributes.position.count).padStart(6),
    'tris', String(tri(g)).padStart(6), ' x cap', String(cap).padStart(6),
    '=', ((tri(g) * cap) / 1e6).toFixed(2) + ' Mtri');
  if (!k.startsWith('far')) worst += tri(g) * cap;
}
for (const [k, g] of Object.entries(baseGeoStats())) {
  console.log(k.padEnd(8), 'verts', String(g.attributes.position.count).padStart(6),
    'tris', String(tri(g)).padStart(6), ' x cap', String(capFor(k)).padStart(6),
    '=', ((tri(g) * capFor(k)) / 1e6).toFixed(2) + ' Mtri');
  worst += tri(g) * capFor(k);
}
console.log('\nworst-case near-tier prop triangles if every cap saturated:',
  (worst / 1e6).toFixed(2), 'Mtri');
