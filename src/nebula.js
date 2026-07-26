// The deep-space backdrop: a real nebula sky, GPU-baked once per universe
// into a cubemap. Because it is baked, the shader can be as expensive as it
// likes — domain-warped multi-octave noise, dust lanes, star-forming knots,
// a galactic band with its own dark rift — and cost nothing per frame
// afterwards (it becomes scene.background: one texture fetch).
//
// This replaces the old additive sprite/plane hack, whose radial gradients
// read as circular halos pinned to the sky.

import * as THREE from 'three';
import { makeRng } from './rng.js';

const NEB_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uBand;          // galactic plane normal
uniform vec3 uColA, uColB, uColC;
uniform vec3 uOff;           // per-universe domain offset
uniform float uBandK;        // band brightness
uniform float uCloudK;       // nebula cloud brightness

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
// ridged noise makes filaments instead of blobs — the shape real nebulae have
float ridge(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    s += a * n * n;
    p *= 2.11;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 p = d * 2.4 + uOff;

  // ---- domain warp: the difference between "clouds" and "gas"
  vec3 w = vec3(fbm(p * 1.7, 4), fbm(p * 1.7 + 5.2, 4), fbm(p * 1.7 + 11.3, 4)) - 0.5;
  vec3 pw = p + w * 1.9;

  // ---- the galactic band: a luminous river with a dark central rift
  float lat = dot(d, normalize(uBand));
  float bandN = fbm(p * 0.9 + 3.1, 5);
  float band = exp(-pow(abs(lat) * (2.7 + bandN * 1.6), 2.0));
  float rift = smoothstep(0.35, 0.62, fbm(p * 2.6 + 7.7, 5));       // dust lanes
  band *= mix(0.28, 1.0, rift);
  // the band is made of unresolved stars: grainy, not smooth
  band *= 0.55 + 0.9 * fbm(pw * 5.5, 5);

  // ---- nebula clouds: ridged filaments, gated by a big soft mask so the
  // sky has clear regions instead of uniform soup
  float mask = smoothstep(0.42, 0.78, fbm(p * 0.55 + 21.0, 4));
  float fil = ridge(pw * 2.2, 6);
  float cloud = pow(max(fil - 0.42, 0.0) * 1.7, 1.5) * mask;
  float cloud2 = pow(max(ridge(pw * 4.1 + 13.0, 5) - 0.5, 0.0) * 1.9, 1.7)
               * smoothstep(0.5, 0.85, fbm(p * 0.7 + 44.0, 4));

  // ---- colour: two gas species plus hot cores
  vec3 col = uColA * cloud * 1.15 + uColB * cloud2 * 0.95;
  float knot = pow(max(cloud - 0.55, 0.0) * 2.2, 3.0);              // star-forming knots
  col += uColC * knot * 2.2;
  col *= uCloudK;
  col += uColC * band * uBandK * 0.42;
  col += vec3(0.55, 0.62, 0.85) * band * uBandK * 0.5;

  // ---- occlusion by foreground dust: cold dark filaments over everything
  float dust = smoothstep(0.55, 0.85, ridge(pw * 3.3 + 61.0, 5)) * mask;
  col *= 1.0 - dust * 0.55;

  // a faint cold floor so deep space is not pure black
  col += vec3(0.008, 0.010, 0.020);
  gl_FragColor = vec4(col, 1.0);
}`;

const NEB_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Bake the sky for `seed` and return a cube texture. Disposal of the previous
// one is the caller's business (universe rebuilds).
export function bakeNebula(renderer, seed, size = 512) {
  const rng = makeRng(seed + ':nebula');
  // seeded palette: two gas species that are NOT the same hue, plus a hot core
  const hA = rng();
  const hB = (hA + 0.28 + rng() * 0.34) % 1;
  const hC = (hA + 0.5 + rng() * 0.2) % 1;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBand: { value: new THREE.Vector3(rng() - 0.5, 1, rng() - 0.5).normalize() },
      uColA: { value: new THREE.Color().setHSL(hA, 0.72, 0.5) },
      uColB: { value: new THREE.Color().setHSL(hB, 0.66, 0.46) },
      uColC: { value: new THREE.Color().setHSL(hC, 0.5, 0.62) },
      uOff: { value: new THREE.Vector3(rng() * 40, rng() * 40, rng() * 40) },
      uBandK: { value: 0.5 + rng() * 0.45 },
      uCloudK: { value: 0.5 + rng() * 0.5 },
    },
    vertexShader: NEB_VERT,
    fragmentShader: NEB_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });

  const scene = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), mat);
  box.frustumCulled = false;
  scene.add(box);

  const rt = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,           // HDR: bright knots can bloom
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cam = new THREE.CubeCamera(0.1, 100, rt);
  // bake in linear space regardless of the app's current output settings
  const prevTarget = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  cam.update(renderer, scene);
  renderer.toneMapping = prevTone;
  renderer.setRenderTarget(prevTarget);

  box.geometry.dispose();
  mat.dispose();
  return rt;      // rt.texture is the cube map; rt.dispose() frees it
}
