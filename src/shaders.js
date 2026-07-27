// Shader-level beauty: a shared procedural detail texture, triplanar
// micro-detail on terrain (so close-up ground has grain, not flat vertex
// color), animated water normals, and wind sway for vegetation.
// All injected via onBeforeCompile — no custom materials, three.js keeps
// doing lights/shadows/morphs/fog for us.

import * as THREE from 'three';
import { Simplex } from './noise.js';
import { makeRng } from './rng.js';
import { injectAerial } from './scattering.js';

// ?bakedshadow=0 lifts the terrain's baked ray-marched sun shadow to 1.0, so a
// dark region that survives it is NOT that term. Pairs with ?shadow=0 (shadow
// map) to bisect any dark area on the ground in two shots.
// 0.42 was too aggressive, and aggressive in the WRONG WAY: it multiplies
// diffuseColor, so it darkens the surface's response to *every* light source —
// including the sky, which a shadow does not block. A shadow removes the SUN.
// Measured on a lush meadow the light balance is already healthy (sun 2.75 vs
// ambient 1.05, a 0.275 shadowed/lit ratio) while ground albedo is only 0.073
// luminance, so this extra 0.42 on top was most of why shadowed ground read as
// near-black instead of staying green and readable the way it does in
// reference/star-citizen/dunboro-aerial-view-microtech.jpg.
export const BAKED_SHADOW_LO = {
  value: (typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('bakedshadow') === '0') ? 1.0 : 0.72,
};

// one global clock drives water and wind everywhere
export const TIME = { value: 0 };
export function tickShaders(dt) { TIME.value += dt; }

let _detailTex = null;
let _detailData = null;   // kept for CPU-side sampling (cloud transit fog)

// bilinear, wrapping sample of the detail texture on the CPU — must agree
// with what the GPU sees so fog can thicken exactly where a cloud is
export function sampleDetailCPU(u, v, ch) {
  if (!_detailData) return 0.5;
  const S = 256;
  let x = (u - Math.floor(u)) * S, y = (v - Math.floor(v)) * S;
  const x0 = x | 0, y0 = y | 0;
  const x1 = (x0 + 1) % S, y1 = (y0 + 1) % S;
  const fx = x - x0, fy = y - y0;
  const c = ch === 0 ? 0 : 1;
  const a = _detailData[(y0 * S + x0) * 4 + c], b = _detailData[(y0 * S + x1) * 4 + c];
  const d = _detailData[(y1 * S + x0) * 4 + c], e = _detailData[(y1 * S + x1) * 4 + c];
  return ((a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy) / 255;
}

export function detailTexture() {
  if (_detailTex || typeof document === 'undefined') return _detailTex;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const n1 = new Simplex(makeRng('detail:1'));
  const n2 = new Simplex(makeRng('detail:2'));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // tileable via toroidal mapping
      const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
      const cx = Math.cos(a), sx = Math.sin(a), cy = Math.cos(b), sy = Math.sin(b);
      const v1 = n1.fbm(cx + 3, sx + cy, sy - cx, 1.5, 4, 0.55, 2.2, 1e9);
      const v2 = n2.fbm(cy - 1, sy + sx, cx + 2, 3.1, 4, 0.55, 2.2, 1e9);
      const k = (y * S + x) * 4;
      img.data[k] = (v1 * 0.5 + 0.5) * 255;
      img.data[k + 1] = (v2 * 0.5 + 0.5) * 255;
      img.data[k + 2] = 128;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _detailData = img.data;
  _detailTex = new THREE.CanvasTexture(canvas);
  _detailTex.wrapS = _detailTex.wrapT = THREE.RepeatWrapping;
  _detailTex.colorSpace = THREE.NoColorSpace;
  return _detailTex;
}

// CPU twin of the GLSL cloudFbm below — same octaves, same channels
export function cloudDensityCPU(d, cov0, cov1, ox, oy, oz) {
  let f = sampleDetailCPU(d.x * 0.55 + ox, d.y * 0.55 + oy, 1) * 0.5;
  f += sampleDetailCPU(d.y * 1.15 + oy, d.z * 1.15 + oz, 0) * 0.25;
  f += sampleDetailCPU(d.z * 2.35 + oz, d.x * 2.35 + ox, 1) * 0.125;
  f += sampleDetailCPU(d.x * 4.8 - ox, d.y * 4.8 - oz, 0) * 0.0625;
  f /= 0.9375;
  const t = Math.min(1, Math.max(0, (f - cov0) / Math.max(cov1 - cov0, 1e-5)));
  const s = t * t * (3 - 2 * t);
  return Math.pow(s, 1.3);
}

let _blankTex = null;
function blankTexture() {
  if (!_blankTex) {
    _blankTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    _blankTex.needsUpdate = true;
  }
  return _blankTex;
}

// Triplanar terrain detail in stable planet-local space (the aLocal
// attribute — world space would swim under camera-relative rendering).
// Per-vertex biome weights (aMat) blend rock strata against organic mottle,
// micro-normals give relief, and the planet's own cloud layer casts moving
// shadows via one extra texture sample.
export function applyTerrainDetail(material, planet, strength = 0.2, macroK = 0.4, scale1 = 1 / 26, scale2 = 1 / 3.2) {
  const tex = detailTexture();
  if (!tex) return;
  material.onBeforeCompile = (shader) => {
    // compiled at first render — by then the planet knows if it has clouds
    const cloudTex = planet.cloudShadowTex || blankTexture();
    shader.uniforms.uDetailTex = { value: tex };
    shader.uniforms.uBakedLo = BAKED_SHADOW_LO;
    shader.uniforms.uDetailK = { value: strength };
    shader.uniforms.uMacroK = { value: macroK };
    shader.uniforms.uDetailS = { value: new THREE.Vector2(scale1, scale2) };
    shader.uniforms.uCloudTex = { value: cloudTex };
    shader.uniforms.uCloudK = { value: planet.cloudMesh ? 0.42 : 0 };
    shader.uniforms.uCloudMat = { value: new THREE.Matrix3() };
    const pal = planet.pal;
    shader.uniforms.uSnowK = { value: pal && pal.snow ? 1 : 0 };
    shader.uniforms.uSnowColor = { value: pal && pal.snow ? pal.snow : new THREE.Color(1, 1, 1) };
    shader.uniforms.uSnowLine = { value: pal ? pal.snowLine : 1e9 };
    shader.uniforms.uSnowBand = { value: planet.hAmp * 0.1 };
    shader.uniforms.uSnowCap = { value: pal && pal.capLat ? pal.capLat : 9.0 };
    shader.uniforms.uPlanetR = { value: planet.R };
    // the whole palette, evaluated per-pixel
    const U = planet.palU;
    shader.uniforms.uLandT = { value: U.landT };
    shader.uniforms.uLandC = { value: U.landC };
    shader.uniforms.uLandN = { value: U.landN };
    shader.uniforms.uSeaT = { value: U.seaT };
    shader.uniforms.uSeaC = { value: U.seaC };
    shader.uniforms.uSeaN = { value: U.seaN };
    shader.uniforms.uHasSea = { value: U.hasSea };
    shader.uniforms.uT0 = { value: U.t0 };
    shader.uniforms.uTSpan = { value: U.tSpan };
    shader.uniforms.uSeaDepthSpan = { value: U.seaDepthSpan };
    shader.uniforms.uRockC = { value: U.rock };
    shader.uniforms.uSlopeLo = { value: U.slopeLo };
    shader.uniforms.uSlopeHi = { value: U.slopeHi };
    shader.uniforms.uForestC = { value: U.forest };
    shader.uniforms.uBlotchC = { value: U.blotch };
    shader.uniforms.uStripeA = { value: U.stripeA };
    shader.uniforms.uStripeB = { value: U.stripeB };
    shader.uniforms.uStripeK = { value: U.stripeK };
    shader.uniforms.uExtraC = { value: U.extraC };
    shader.uniforms.uExtraMode = { value: U.extraMode };
    // mist pools over WATER worlds; magma seas get a whisper of heat haze,
    // not lake fog (basins on lava planets drowned in red soup otherwise)
    // halved: this pools blue over the low country, and with the aerial term
    // now doing distance haze properly it was the second of three blue washes
    const mistBase = planet.liquid === 'lava' ? 0.04 : (planet.hasLiquid ? 0.13 : 0.06);
    shader.uniforms.uMistK = {
      value: mistBase * Math.min(planet.atmoDensity || 0.4, 1),
    };
    shader.uniforms.uMistH = { value: planet.hAmp * 0.12 };
    shader.uniforms.uMistColor = { value: planet.skyColor.clone() };
    material.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aLocal;
        attribute vec3 aMat;
        attribute vec4 aExtra;
        varying vec3 vLocalPos;
        varying vec3 vLocalNrm;
        varying vec3 vMat;
        varying vec4 vExtra;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocalPos = aLocal;
        vLocalNrm = normal;
        vMat = aMat;
        vExtra = aExtra;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetailTex;
        uniform float uBakedLo;
        uniform float uDetailK;
        uniform float uMacroK;
        uniform vec2 uDetailS;
        uniform sampler2D uCloudTex;
        uniform float uCloudK;
        uniform mat3 uCloudMat;
        uniform float uSnowK;
        uniform vec3 uSnowColor;
        uniform float uSnowLine;
        uniform float uSnowBand;
        uniform float uSnowCap;
        uniform float uPlanetR;
        uniform float uLandT[7];
        uniform vec3 uLandC[7];
        uniform float uLandN;
        uniform float uSeaT[7];
        uniform vec3 uSeaC[7];
        uniform float uSeaN;
        uniform float uHasSea;
        uniform float uT0;
        uniform float uTSpan;
        uniform float uSeaDepthSpan;
        uniform vec3 uRockC;
        uniform float uSlopeLo;
        uniform float uSlopeHi;
        uniform vec3 uForestC;
        uniform vec3 uBlotchC;
        uniform vec3 uStripeA;
        uniform vec3 uStripeB;
        uniform float uStripeK;
        uniform float uExtraMode;
        uniform vec3 uExtraC;
        uniform float uMistK;
        uniform float uMistH;
        uniform vec3 uMistColor;
        varying vec3 vLocalPos;
        varying vec3 vLocalNrm;
        varying vec3 vMat;
        varying vec4 vExtra;
        float gSnowW = 0.0;
        float gPatch = 0.0;
        float triDetail(vec3 p, vec3 w, float s, int ch) {
          vec2 a = texture2D(uDetailTex, p.yz * s).rg;
          vec2 b = texture2D(uDetailTex, p.zx * s).rg;
          vec2 c = texture2D(uDetailTex, p.xy * s).rg;
          vec2 m = a * w.x + b * w.y + c * w.z;
          return ch == 0 ? m.r : m.g;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // ---- the palette, per-pixel: exact height & slope, so coasts,
          // depth gradients and rock bands stay crisp at every distance
          vec3 nd = normalize(vLocalPos);
          float hgt = length(vLocalPos) - uPlanetR;
          float slope = 1.0 - clamp(dot(normalize(vLocalNrm), nd), 0.0, 1.0);
          vec3 base;
          if (uHasSea > 0.5 && hgt < uT0) {
            float t = clamp(1.0 - (uT0 - hgt) / uSeaDepthSpan, 0.0, 1.0);
            base = uSeaC[0];
            for (int i = 1; i < 7; i++) {
              if (float(i) >= uSeaN) break;
              base = mix(base, uSeaC[i],
                clamp((t - uSeaT[i - 1]) / max(uSeaT[i] - uSeaT[i - 1], 1e-5), 0.0, 1.0));
            }
          } else {
            float t = clamp((hgt - uT0) / uTSpan, 0.0, 1.0);
            base = uLandC[0];
            for (int i = 1; i < 7; i++) {
              if (float(i) >= uLandN) break;
              base = mix(base, uLandC[i],
                clamp((t - uLandT[i - 1]) / max(uLandT[i] - uLandT[i - 1], 1e-5), 0.0, 1.0));
            }
            base = mix(base, uForestC, vExtra.x);
            base = mix(base, uBlotchC, vExtra.y);
            if (uStripeK > 0.001) base = mix(base, mix(uStripeA, uStripeB, vExtra.z), uStripeK);
            if (uExtraMode > 2.5) base *= 1.0 + (vExtra.w - 0.5) * 0.2;
            else if (uExtraMode > 0.5) base = mix(base, uExtraC, vExtra.w);
            base = mix(base, uRockC, smoothstep(uSlopeLo, uSlopeHi, slope));
          }
          diffuseColor.rgb = base;

          // ---- baked ray-marched sun shadows: mountains shade whole
          // valleys, kilometres beyond the realtime shadow map's reach
          diffuseColor.rgb *= mix(uBakedLo, 1.0, vMat.z);

          // ---- micro grain, biome-styled
          vec3 w = pow(abs(normalize(vLocalNrm)), vec3(4.0));
          w /= (w.x + w.y + w.z);
          float grain = (triDetail(vLocalPos, w, uDetailS.x, 0) - 0.5)
                      + (triDetail(vLocalPos, w, uDetailS.y, 1) - 0.5) * 0.8;
          float strat = texture2D(uDetailTex, vec2(length(vLocalPos) * 0.055, 0.31)).r - 0.5;
          float d = mix(grain, grain * 0.5 + strat * 1.15, vMat.x);
          d += (triDetail(vLocalPos, w, uDetailS.y * 0.32, 0) - 0.5) * vMat.y * 0.75;
          diffuseColor.rgb *= 1.0 + d * uDetailK;

          // ---- continental-scale tint drift: dry-brown swathes
          float macro = triDetail(vLocalPos, w, 0.0013, 0)
                      + triDetail(vLocalPos, w, 0.00028, 1) - 1.0;
          float mw = clamp(macro * 1.5 + 0.5, 0.0, 1.0) * uMacroK;
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.09, 0.99, 0.84), mw);

          // ---- mid-scale patchiness (~100–500 m): soil and moisture
          // variation seen from a hilltop — the octave between micro grain
          // and continental swathes that uniform game terrain lacks
          float pch = triDetail(vLocalPos, w, 0.0035, 1)
                      + triDetail(vLocalPos, w, 0.0012, 0) - 1.0;
          gPatch = pch;
          diffuseColor.rgb *= 1.0 + pch * (0.30 + 0.20 * vMat.z) * (0.5 + uMacroK);
          // damp hollows darken and cool slightly
          diffuseColor.rgb = mix(diffuseColor.rgb,
            diffuseColor.rgb * vec3(0.88, 0.97, 0.92),
            clamp(-pch * 1.8, 0.0, 0.5) * uMacroK);

          // ---- near-field grit. The finest octave above is ~3 m, so the
          // metre of ground closest to the eye — the part a standing player
          // looks straight down at — resolved to a single flat colour. These
          // two octaves are sub-metre and fade out by 25 m, so they fill the
          // foreground without aliasing into noise across a whole valley.
          // (vAerialView comes from scattering.js, injected by this same hook.)
          float nearK = 1.0 - smoothstep(5.0, 25.0, length(vAerialView));
          if (nearK > 0.002) {
            float fine  = triDetail(vLocalPos, w, 0.62, 0) - 0.5;   // ~1.6 m
            float finer = triDetail(vLocalPos, w, 2.90, 1) - 0.5;   // ~0.35 m
            diffuseColor.rgb *= 1.0 + (fine * 0.55 + finer * 0.75) * nearK * uDetailK * 1.6;
          }

          // ---- per-pixel snowline: crisp caps from orbit
          if (uSnowK > 0.5) {
            float lat = abs(nd.y) + (texture2D(uDetailTex, nd.xz * 2.0 + nd.y).r - 0.5) * 0.12;
            float sl = uSnowLine * (1.0 - 0.65 * smoothstep(0.45, 0.95, lat));
            float sw = smoothstep(sl, sl + uSnowBand, hgt);
            sw = max(sw, smoothstep(uSnowCap, uSnowCap + 0.07, lat));
            sw *= 1.0 - smoothstep(0.55, 0.8, slope) * 0.85;
            diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, sw);
            gSnowW = sw;
          }

          // ---- the cloud deck overhead casts drifting shadows
          vec3 cd = uCloudMat * nd;
          float cu = 0.5 + atan(cd.z, -cd.x) * 0.15915494;
          float cvv = 1.0 - acos(clamp(cd.y, -1.0, 1.0)) * 0.31830988;
          diffuseColor.rgb *= 1.0 - texture2D(uCloudTex, vec2(cu, cvv)).g * uCloudK;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // snow glints, damp hollows go faintly glossy, dry rises stay matte —
        // low-sun specular variation is a big part of ground reading as real
        roughnessFactor = clamp(roughnessFactor - gSnowW * 0.42 + gPatch * 0.14, 0.05, 1.0);`)
      .replace('#include <fog_fragment>', `
        #ifdef USE_FOG
        {
          // valley mist: haze pools in the low country and thickens with
          // distance — the depth cue that sells scale from altitude
          float mist = uMistK
            * smoothstep(uMistH, 0.0, (length(vLocalPos) - uPlanetR) - uT0)
            * (1.0 - exp(-vFogDepth * 3.2e-4));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistColor, clamp(mist, 0.0, 0.6));
        }
        #endif
        #include <fog_fragment>`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          // micro-relief: bend the shading normal with the same detail field —
          // this, more than geometry, is what makes ground read as *real*
          vec3 wN = pow(abs(normalize(vLocalNrm)), vec3(4.0));
          wN /= (wN.x + wN.y + wN.z);
          float gx = triDetail(vLocalPos + vec3(0.35, 0.0, 0.0), wN, uDetailS.y, 1)
                   - triDetail(vLocalPos - vec3(0.35, 0.0, 0.0), wN, uDetailS.y, 1);
          float gy = triDetail(vLocalPos + vec3(0.0, 0.35, 0.0), wN, uDetailS.y, 1)
                   - triDetail(vLocalPos - vec3(0.0, 0.35, 0.0), wN, uDetailS.y, 1);
          vec3 tang = normalize(cross(normal, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
          vec3 bitn = cross(normal, tang);
          normal = normalize(normal + (tang * gx + bitn * gy) * uDetailK * (1.7 + vMat.x * 1.5));
          // Mid-range relief. The perturbation above runs at uDetailS.y (~3 m),
          // which is sub-pixel past a few hundred metres and averages away to
          // nothing — so every hill between 100 m and a couple of km shaded
          // like a smooth shell, which is most of why our vistas read soft next
          // to reference/star-citizen/daymar-122019-min.jpg, where erosion
          // texture is legible at every range. This works at ~26 m, fading IN
          // where the fine octave fades out, so the two hand over rather than
          // stack.
          {
            float md = length(vAerialView);
            float mk = smoothstep(40.0, 160.0, md) * (1.0 - smoothstep(2200.0, 5000.0, md));
            if (mk > 0.002) {
              float e2 = 2.6;
              float mx = triDetail(vLocalPos + vec3(e2, 0.0, 0.0), wN, uDetailS.x, 0)
                       - triDetail(vLocalPos - vec3(e2, 0.0, 0.0), wN, uDetailS.x, 0);
              float my = triDetail(vLocalPos + vec3(0.0, e2, 0.0), wN, uDetailS.x, 0)
                       - triDetail(vLocalPos - vec3(0.0, e2, 0.0), wN, uDetailS.x, 0);
              vec3 mt = normalize(cross(normal, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
              normal = normalize(normal + (mt * mx + cross(normal, mt) * my) * mk * 1.9);
            }
          }

          // matching sub-metre relief up close, so near ground catches the low
          // sun in grazing highlights instead of shading like a painted plane
          float nk = 1.0 - smoothstep(4.0, 20.0, length(vAerialView));
          if (nk > 0.002) {
            float hx = triDetail(vLocalPos + vec3(0.06, 0.0, 0.0), wN, 2.9, 1)
                     - triDetail(vLocalPos - vec3(0.06, 0.0, 0.0), wN, 2.9, 1);
            float hy = triDetail(vLocalPos + vec3(0.0, 0.06, 0.0), wN, 2.9, 1)
                     - triDetail(vLocalPos - vec3(0.0, 0.06, 0.0), wN, 2.9, 1);
            normal = normalize(normal + (tang * hx + bitn * hy) * nk * 2.4);
          }
        }`);
    // terrain knows its own altitude exactly, so its haze thins correctly up
    // a mountainside instead of using the camera's height everywhere
    injectAerial(shader, 'length(vLocalPos) - uPlanetR');
  };
  material.customProgramCacheKey = () => 'terrain-palette-v8';
}

// Living water: scrolling normal perturbation, plus Beer–Lambert depth
// absorption — the terrain depth beneath each vertex is baked at build, so
// deeps go dark, shallows glow, and shorelines fade in softly.
export function applyWaterWaves(material, planet, waveScale = 1 / 14) {
  const tex = detailTexture();
  if (!tex) return;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetailTex = { value: tex };
    shader.uniforms.uTime = TIME;
    shader.uniforms.uWaveS = { value: waveScale };
    const deep = planet && planet.pal && planet.pal.sea
      ? planet.pal.sea[0].c.clone().lerp(planet.liquidColor.clone(), 0.4)
      : new THREE.Color(0.02, 0.08, 0.15);
    const shallow = planet
      ? planet.liquidColor.clone().lerp(new THREE.Color(1, 1, 1), 0.3)
      : new THREE.Color(0.4, 0.75, 0.8);
    shader.uniforms.uDeepC = { value: deep };
    shader.uniforms.uShallowC = { value: shallow };
    // grazing angles mirror the sky instead of showing the deep diffuse —
    // without this, water toward the horizon reads as a near-black sheet
    const sky = planet && planet.skyColor
      ? planet.skyColor.clone().multiplyScalar(0.6)
      : new THREE.Color(0.25, 0.4, 0.55);
    shader.uniforms.uSkyC = { value: sky };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aLocal;
        attribute float aDepth;
        varying vec3 vLocalPos;
        varying float vDepth;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocalPos = aLocal;
        vDepth = aDepth;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetailTex;
        uniform float uTime;
        uniform float uWaveS;
        uniform vec3 uDeepC;
        uniform vec3 uShallowC;
        uniform vec3 uSkyC;
        varying vec3 vLocalPos;
        varying float vDepth;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float dep = max(vDepth, 0.0);
          float ab = 1.0 - exp(-dep * 0.05);          // absorption e-fold ~20 m
          diffuseColor.rgb = mix(uShallowC, uDeepC, ab);
          // shorelines fade in instead of cutting a hard waterline
          diffuseColor.a *= mix(0.22, 1.0, 1.0 - exp(-dep * 0.12));
          // Fresnel: at grazing angles the surface turns into a sky mirror
          // (abs() so the DoubleSide underside behaves when submerged)
          float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 5.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, uSkyC, fres * 0.65);
          diffuseColor.a = mix(diffuseColor.a, min(1.0, diffuseColor.a * 2.2 + 0.25), fres);
        }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          vec2 uv1 = vLocalPos.xy * uWaveS + vec2(uTime * 0.021, uTime * -0.013);
          vec2 uv2 = vLocalPos.yz * uWaveS * 3.7 + vec2(uTime * -0.033, uTime * 0.027);
          vec2 g = (texture2D(uDetailTex, uv1).rg - 0.5) * 0.5
                 + (texture2D(uDetailTex, uv2).rg - 0.5) * 0.3;
          normal = normalize(normal + vec3(g.x, g.y, 0.0) * 0.55);
        }
        {
          // Fresnel-driven opacity.
          //
          // The liquid is a transparent material with a CONSTANT opacity (0.66
          // for water), and three.js has no reason to vary that with viewing
          // angle. So looking across a lake at a grazing angle — where a real
          // water surface goes bright and very nearly a mirror, one of the most
          // recognisable cues there is — ours stayed 66% dark blue with the
          // seabed showing through, and the sky reflection never got a chance
          // to dominate. Schlick against the wave-perturbed normal, so the
          // ripples break the sheen up instead of laying a flat gloss over it.
          float cosT = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
          float F = pow(1.0 - cosT, 5.0);
          diffuseColor.a = clamp(mix(diffuseColor.a, 1.0, F * 0.92), 0.0, 1.0);
        }`);
  };
  material.customProgramCacheKey = () => 'water-fresnel-waves';
}

// Procedural cloud coverage evaluated per-FRAGMENT: a texture-based fBm
// with an analytic threshold. A baked cloud texture shows its texels as
// hard squares from orbit; this is smooth at every distance.
export function applyCloudField(material, coverage, offX, offY, offZ) {
  const tex = detailTexture();
  if (!tex) return;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCloudNoise = { value: tex };
    shader.uniforms.uCov0 = { value: 0.55 - coverage * 0.24 };
    shader.uniforms.uCov1 = { value: 0.86 - coverage * 0.14 };
    shader.uniforms.uCOff = { value: new THREE.Vector3(offX, offY, offZ) };
    // the shell fades away as the camera nears its own altitude — the
    // transit white-out fog takes over, so you fly THROUGH, never POP through
    shader.uniforms.uCamProx = { value: 1 };
    // sun direction in the deck's own (rotating) frame, for self-shadowing
    shader.uniforms.uCSun = { value: new THREE.Vector3(0, 1, 0) };
    material.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCDir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCDir = normalize(position);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uCloudNoise;
        uniform float uCov0;
        uniform float uCov1;
        uniform vec3 uCOff;
        uniform float uCamProx;
        uniform vec3 uCSun;
        varying vec3 vCDir;
        float cloudFbm(vec3 d) {
          float f = texture2D(uCloudNoise, d.xy * 0.55 + uCOff.xy).g * 0.5;
          f += texture2D(uCloudNoise, d.yz * 1.15 + uCOff.yz).r * 0.25;
          f += texture2D(uCloudNoise, d.zx * 2.35 + uCOff.zx).g * 0.125;
          f += texture2D(uCloudNoise, d.xy * 4.8 - uCOff.xz).r * 0.0625;
          return f / 0.9375;
        }`)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        {
          vec3 nd = normalize(vCDir);
          float a = smoothstep(uCov0, uCov1, cloudFbm(nd));
          diffuseColor.a *= pow(a, 1.3) * uCamProx;
          // volumetric look from one extra tap: density INCREASING toward
          // the sun means we're in a cloud's shadowed core; decreasing
          // means a sunlit edge. Thick cores also darken (their own bulk).
          float aSun = smoothstep(uCov0, uCov1, cloudFbm(normalize(nd + uCSun * 0.05)));
          float self = clamp(1.0 - (aSun - a) * 1.9, 0.42, 1.18);
          diffuseColor.rgb *= self * (1.0 - a * 0.22);
        }`);
  };
  material.customProgramCacheKey = () => 'cloud-field';
}

// Wind: vegetation bends with a per-instance phase, stronger toward the tip.
// all scatter props share this scale: 1 on the ground, easing to 0 as the
// camera climbs out — thousands of props must never blink out in one frame
export const GROW = { value: 1 };

export function applyWindSway(material, amount) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = TIME;
    shader.uniforms.uGrow = GROW;
    shader.uniforms.uSway = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uGrow;
        uniform float uSway;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        {
          transformed *= uGrow;
          vec3 ip = instanceMatrix[3].xyz;
          float ph = ip.x * 0.61 + ip.y * 0.53 + ip.z * 0.47;
          float k = uSway * max(transformed.y, 0.0);
          transformed.x += (sin(uTime * 1.6 + ph) + 0.4 * sin(uTime * 3.7 + ph * 1.7)) * k;
          transformed.z += (cos(uTime * 1.3 + ph * 1.3) + 0.4 * sin(uTime * 2.9 + ph)) * k * 0.7;
        }
        #endif`);
  };
  material.customProgramCacheKey = () => 'wind-sway-' + amount;
}

// ============================================================================
// Flora surface detail.
//
// This is the answer to "it still looks childish". Species count, size spread
// and silhouette variety were all real gaps, but none of them was THE gap: a
// smooth, single-colour surface reads as moulded plastic no matter how many
// shapes you make out of it. Every tree here was one flat albedo with no
// texture, no relief and no self-shadowing, which is the difference between a
// toy and a plant. Compare any leaf mass in reference/star-citizen/ — it is
// mottled, it darkens into its own interior, and it catches light unevenly.
//
// Triplanar, in the geometry's OWN local space (the raw `position` attribute,
// captured before wind sway so the texture cannot swim as the plant moves).
// That also means it costs no UVs — which is just as well, since mergeGeos
// discards them.
// ============================================================================
export function applyFloraDetail(material, opts = {}) {
  const tex = detailTexture();
  if (!tex) return material;
  const fine = opts.fine ?? 5.5;      // ~18 cm — leaf clumps, bark grain
  const coarse = opts.coarse ?? 1.5;  // ~65 cm — branch masses, trunk swelling
  const amt = opts.amount ?? 0.34;
  // Sample in WORLD-metric space, not raw object space.
  //
  // Every prop here is one geometry drawn at instance scales spanning an order
  // of magnitude (propScale's power law puts stone from 0.08 to 2.2 and trees
  // from 0.5 to 2.3). Sampling the raw `position` attribute gives all of them
  // the SAME number of texture repeats regardless of how big they actually
  // are, so a boulder's grain is stretched ~27x wider than a pebble's and the
  // two stop reading as the same material. Dividing the sample position by the
  // instance's own scale makes feature size constant in metres, which is what
  // "micro-normal at a consistent scale" means.
  const worldScale = opts.worldScale !== false;
  // 1.5 was nearly four times the terrain's equivalent, and on a small rim
  // clump — a 0.4 m sphere sampled at 0.18 m feature scale — the perturbation
  // exceeded the base normal and flipped it, which renders as hard black
  // patches across the canopy. Relief has to stay well under the normal it
  // is bending.
  const relief = opts.relief ?? 0.45;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    shader.uniforms.uFlTex = { value: tex };
    shader.uniforms.uFlS = { value: new THREE.Vector2(fine, coarse) };
    shader.uniforms.uFlK = { value: amt };
    shader.uniforms.uFlRelief = { value: relief };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFlPos;
        varying vec3 vFlNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // the UNDEFORMED position attribute, never the swayed one — wind must
        // not drag the texture across the surface
        vFlPos = position;
        vFlNrm = normal;
        ${worldScale ? `#ifdef USE_INSTANCING
          vFlPos *= length(instanceMatrix[0].xyz);
        #endif` : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uFlTex;
        uniform vec2 uFlS;
        uniform float uFlK;
        uniform float uFlRelief;
        varying vec3 vFlPos;
        varying vec3 vFlNrm;
        float flTri(vec3 p, vec3 w, float s, int ch) {
          vec2 a = texture2D(uFlTex, p.yz * s).rg;
          vec2 b = texture2D(uFlTex, p.zx * s).rg;
          vec2 c = texture2D(uFlTex, p.xy * s).rg;
          vec2 m = a * w.x + b * w.y + c * w.z;
          return ch == 0 ? m.r : m.g;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 fw = pow(abs(normalize(vFlNrm)), vec3(4.0));
          fw /= (fw.x + fw.y + fw.z);
          float f = flTri(vFlPos, fw, uFlS.x, 0) - 0.5;
          float c = flTri(vFlPos, fw, uFlS.y, 1) - 0.5;
          // mottle
          diffuseColor.rgb *= 1.0 + (f * 0.9 + c * 1.15) * uFlK;
          // and a touch of interior occlusion — but MEAN-PRESERVING. The
          // first cut multiplied by up to 0.81 on top of blob()'s baked AO,
          // shadeVertical()'s gradient and the palette's own darkening, and
          // four stacked multipliers turned every canopy black. Lift and
          // darken symmetrically so the average albedo is unchanged.
          diffuseColor.rgb *= 1.0 + clamp((f + c) * 0.5, -0.20, 0.20) * uFlK;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          vec3 fw = pow(abs(normalize(vFlNrm)), vec3(4.0));
          fw /= (fw.x + fw.y + fw.z);
          roughnessFactor = clamp(
            roughnessFactor + (flTri(vFlPos, fw, uFlS.x, 1) - 0.5) * 0.35, 0.12, 1.0);
        }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          // relief: this, more than albedo, is what stops a surface reading
          // as moulded — it makes the light break up across it
          vec3 fw = pow(abs(normalize(vFlNrm)), vec3(4.0));
          fw /= (fw.x + fw.y + fw.z);
          float e = 0.035;
          float gx = flTri(vFlPos + vec3(e, 0.0, 0.0), fw, uFlS.x, 0)
                   - flTri(vFlPos - vec3(e, 0.0, 0.0), fw, uFlS.x, 0);
          float gy = flTri(vFlPos + vec3(0.0, e, 0.0), fw, uFlS.x, 0)
                   - flTri(vFlPos - vec3(0.0, e, 0.0), fw, uFlS.x, 0);
          vec3 t = normalize(cross(normal, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
          normal = normalize(normal + (t * gx + cross(normal, t) * gy) * uFlRelief);
        }`);
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () =>
    (key ? key.call(material) : '') + '-floradetail2' + (worldScale ? 'w' : '');
  return material;
}

// ============================================================================
// Foliage: alpha-cut leaf cards, and light that goes THROUGH a leaf.
//
// The two things a canopy made of solid lobes cannot do, no matter how lumpy
// the lobes are:
//
//   1. Break its own silhouette. A lobe's outline is a smooth closed curve, so
//      a canopy of lobes is a union of smooth curves — still an arc, still
//      moulded. In reference/star-citizen/microtech-01-122019-min.jpg the
//      conifers dissolve into individual needles at the outline: the boundary
//      between tree and sky is *stochastic*, not a curve. Only a cutout mask
//      does that.
//   2. Transmit. A leaf is thin and translucent; the sun behind a canopy makes
//      it glow, and the terminator on a lit canopy is soft and warm rather
//      than the hard cosine an opaque dielectric gives. Without it, foliage
//      shades exactly like painted plastic — which is what it is.
//
// The alpha comes from a real `material.alphaMap` + `alphaTest` rather than a
// discard injected by hand, because three.js's shadow pass builds its own
// MeshDepthMaterial and copies ONLY `map`/`alphaMap`/`alphaTest` off the source
// material (WebGLShadowMap.getDepthMaterial) — an onBeforeCompile discard is
// invisible to it, and every leaf card would cast a solid rectangular shadow.
// ============================================================================

// Atlas layout: 2x2 cells. The bottom-left cell is deliberately SOLID, and
// every non-leaf vertex (trunks, lobes, caps, stone) is given its centre uv —
// so one material, one draw call, and one alphaMap covers both the cutout
// foliage and the solid parts of the same plant.
export const FOLIAGE_OPAQUE_UV = [0.25, 0.25];
// [u0, v0] of each cutout cell; each cell is 0.5 x 0.5 in uv
export const FOLIAGE_CELLS = { needle: [0.5, 0.0], broad: [0.0, 0.5], blade: [0.5, 0.5] };

let _foliageTex = null;

// Map a 0..1 card uv into a cell, inset from the cell border. The inset is not
// cosmetic: mip levels below ~8x8 blend neighbouring cells, and the neighbour
// here is the fully-opaque cell. Keeping the mask off the border means the
// worst that bleeding can do at extreme range is make a distant card slightly
// too solid — which is the failure direction alpha-tested foliage wants (the
// other direction is the classic "canopy dissolves as you back away").
const CELL_INSET = 0.06;
export function foliageUV(cell, u, v) {
  const c = FOLIAGE_CELLS[cell] || FOLIAGE_CELLS.broad;
  const s = 0.5 * (1 - CELL_INSET * 2);
  return [c[0] + 0.5 * CELL_INSET + u * s, c[1] + 0.5 * CELL_INSET + v * s];
}

// The mask itself, drawn in code (no downloaded assets — §4).
//   G channel = coverage. three.js's alphamap_fragment reads .g, and so does
//               the depth material's, so this is what cuts the silhouette.
//   R channel = a baked leaf shading term, 0.5 = neutral. Leaf bases and the
//               spine sit dark, tips catch light — the gradient that stops a
//               card reading as a flat stamp.
export function foliageTexture() {
  if (_foliageTex || typeof document === 'undefined') return _foliageTex;
  const S = 256, H = S / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  // background: fully transparent (G=0) with neutral shading (R=128)
  ctx.fillStyle = 'rgb(128,0,128)';
  ctx.fillRect(0, 0, S, S);
  // the opaque cell — bottom-left in uv, which is TOP-left in canvas rows.
  // (uv v=0 is the bottom row of the image; we only ever sample its centre,
  // so orientation of the solid block does not matter, but the leaf cells'
  // does: they are drawn tip-up in canvas space and used tip-up in uv.)
  ctx.fillStyle = 'rgb(128,255,128)';
  ctx.fillRect(0, H, H, H);

  const rng = makeRng('foliage:mask');
  const shade = (t) => `rgb(${Math.round(255 * (0.34 + 0.42 * t))},255,128)`;

  // --- needle spray (uv cell [0.5,0]) : a conifer sprig -------------------
  // This is the one that matters for the reference frames. A sprig is a rachis
  // with a hundred fine needles fanning forward; its outline is not a shape,
  // it is a comb, and that is exactly what the eye reads as "conifer" at any
  // distance where individual needles are sub-pixel.
  ctx.save();
  ctx.translate(H + H * 0.5, H + H * 0.5);         // cell centre (canvas)
  ctx.lineCap = 'round';
  for (let branch = 0; branch < 5; branch++) {
    const bx = (rng() - 0.5) * H * 0.30;
    const ba = (rng() - 0.5) * 0.9;
    const blen = H * (0.34 + rng() * 0.14);
    ctx.save();
    ctx.translate(bx, H * (0.16 + rng() * 0.18));
    ctx.rotate(ba);
    // the rachis
    ctx.strokeStyle = shade(0.15);
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -blen); ctx.stroke();
    const N = 26 + ((rng() * 10) | 0);
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const y = -blen * t;
      const side = i % 2 ? 1 : -1;
      const len = blen * (0.42 + rng() * 0.26) * (1 - t * 0.72);
      const ang = (0.62 + rng() * 0.5) * side;
      ctx.strokeStyle = shade(0.25 + t * 0.75 + rng() * 0.12);
      ctx.lineWidth = 1.1 + rng() * 1.1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(Math.sin(ang) * len, y - Math.cos(ang) * len * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  // --- broad-leaf cluster (uv cell [0,0.5]) -------------------------------
  ctx.save();
  ctx.translate(H * 0.5, H * 0.5);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rng() * 0.7;
    const rr = H * (0.10 + rng() * 0.22);
    const lx = Math.cos(a) * H * (0.06 + rng() * 0.20);
    const ly = Math.sin(a) * H * (0.06 + rng() * 0.20) - H * 0.04;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(a + Math.PI * 0.5);
    ctx.fillStyle = shade(0.3 + rng() * 0.65);
    ctx.beginPath();
    ctx.ellipse(0, -rr * 0.6, rr * 0.42, rr, 0, 0, Math.PI * 2);
    ctx.fill();
    // midrib, darker: a leaf without one is a coloured pebble
    ctx.strokeStyle = shade(0.05);
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -rr * 1.5); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // --- serrated blade (uv cell [0.5,0.5]) : fronds, shrub leaves ----------
  ctx.save();
  ctx.translate(H + H * 0.5, H * 0.5);
  {
    const L = H * 0.44, W = H * 0.15;
    ctx.fillStyle = shade(0.62);
    ctx.beginPath();
    ctx.moveTo(0, L);
    ctx.quadraticCurveTo(W, L * 0.1, 0, -L);
    ctx.quadraticCurveTo(-W, L * 0.1, 0, L);
    ctx.fill();
    // bite notches out of both edges so the outline is torn, not moulded
    ctx.fillStyle = 'rgb(128,0,128)';
    for (let i = 0; i < 16; i++) {
      const t = rng();
      const y = L - t * L * 2;
      const w = W * (1 - Math.abs(y) / L) * 1.15;
      const side = i % 2 ? 1 : -1;
      const r = W * (0.20 + rng() * 0.32);
      ctx.beginPath();
      ctx.arc(side * (w + r * 0.45), y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = shade(0.12);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, L * 0.95); ctx.lineTo(0, -L * 0.95); ctx.stroke();
  }
  ctx.restore();

  _foliageTex = new THREE.CanvasTexture(canvas);
  _foliageTex.wrapS = _foliageTex.wrapT = THREE.ClampToEdgeWrapping;
  _foliageTex.colorSpace = THREE.NoColorSpace;
  _foliageTex.anisotropy = 4;
  return _foliageTex;
}

// Wire the atlas onto a flora material, plus the two shading behaviours that
// the cards need and the solid parts must NOT get.
//
// `aLeaf` (0 on solid geometry, 1 on a card) is a real vertex attribute rather
// than a uv-region test, because the two branches want different things and a
// float compare is cheaper than reasoning about atlas coordinates in the
// fragment shader.
export function applyFoliageCards(material, opts = {}) {
  const tex = foliageTexture();
  if (!tex) return material;
  material.alphaMap = tex;
  // Low on purpose. Foliage cutouts erode as their mask mips down (mean
  // coverage falls below the threshold and the canopy thins with distance);
  // a low threshold trades a slightly softer near-field edge for a canopy
  // that still has leaves 150 m away.
  material.alphaTest = opts.alphaTest ?? 0.34;
  const leafShade = opts.leafShade ?? 0.55;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    shader.uniforms.uLeafTex = { value: tex };
    shader.uniforms.uLeafShade = { value: leafShade };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aLeaf;
        varying float vLeaf;
        varying vec2 vLeafUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeaf = aLeaf;
        vLeafUv = uv;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uLeafTex;
        uniform float uLeafShade;
        varying float vLeaf;
        varying vec2 vLeafUv;`)
      // the baked leaf gradient (R channel): dark at the leaf base and along
      // the midrib, light at the tips. Without it a card is a flat stamp of
      // one colour, which is the same defect as the lobe it replaced.
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        if (vLeaf > 0.5) {
          float lsh = texture2D(uLeafTex, vLeafUv).r - 0.5;
          diffuseColor.rgb *= 1.0 + lsh * uLeafShade * 2.0;
        }`)
      // A card is a flat quad standing edge-out of the canopy, so half of them
      // are back-facing from any given view, and DOUBLE_SIDED flips the normal
      // on a back face — which for an authored canopy-radial normal means the
      // card lights from the wrong hemisphere and goes black. (This project
      // has already shipped that exact bug once, from rim clumps poking
      // through a cap; see flora.js.) Cards carry the canopy's own normal
      // deliberately, so undo the flip for them and only for them.
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          if (vLeaf > 0.5) normal *= faceDirection;
        #endif`);
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (key ? key.call(material) : '') + '-leafcards1';
  return material;
}

// Transmission through a leaf.
//
// Two lobes, because foliage does two visibly different things:
//   - BACK-SCATTER: sun behind the canopy, light exits toward the eye. The
//     classic cheap model (Frostbite/DICE): build a half-vector that leans the
//     light direction into the surface, then a tight lobe around viewing
//     straight down it.
//   - WRAP: on the sunlit side the terminator is soft and warm, because light
//     that entered a leaf a centimetre away comes back out here. A plain
//     N-dot-L terminator is the giveaway that a canopy is a solid.
//
// Both are added at lights_fragment_end, where the direct/indirect split is
// already resolved and the sun's own colour is still available. The shadow
// mask damps them without killing them — a leaf in a mountain's shadow is
// still lit through by the sky, just not by the sun.
export function applyFoliageTranslucency(material, opts = {}) {
  const color = opts.color || new THREE.Color(1.0, 0.92, 0.62);
  const back = opts.back ?? 0.85;
  const wrap = opts.wrap ?? 0.35;
  const power = opts.power ?? 3.0;
  const distort = opts.distort ?? 0.35;
  const leafOnly = opts.leafOnly ?? false;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    shader.uniforms.uSssColor = { value: color };
    shader.uniforms.uSssBack = { value: back };
    shader.uniforms.uSssWrap = { value: wrap };
    shader.uniforms.uSssPow = { value: power };
    shader.uniforms.uSssDist = { value: distort };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSssColor;
        uniform float uSssBack;
        uniform float uSssWrap;
        uniform float uSssPow;
        uniform float uSssDist;`)
      // Light 0 explicitly, not a loop over NUM_DIR_LIGHTS: the sun is the only
      // DirectionalLight in this scene (main.js), and the `directLight` struct
      // left over from lights_fragment_begin belongs to whichever light ran
      // last — which is the headlamp PointLight, not the sun.
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        {
          float sssK = 1.0;
          ${leafOnly ? 'sssK = step(0.5, vLeaf);' : ''}
          if (sssK > 0.0) {
            float sssShadow = 1.0;
            #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
            {
              DirectionalLightShadow sssDL = directionalLightShadows[ 0 ];
              float sm = receiveShadow ? getShadow( directionalShadowMap[ 0 ],
                sssDL.shadowMapSize, sssDL.shadowIntensity, sssDL.shadowBias,
                sssDL.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
              // a shaded leaf is still lit THROUGH by the sky, just not the sun
              sssShadow = mix(0.30, 1.0, sm);
            }
            #endif
            vec3 sssN = geometryNormal;
            vec3 sssV = geometryViewDir;
            vec3 sssL = directionalLights[ 0 ].direction;
            // light that went through the leaf and came out toward the eye
            vec3 sssH = normalize(sssL + sssN * uSssDist);
            float bk = pow(clamp(dot(sssV, -sssH), 0.0, 1.0), uSssPow) * uSssBack;
            // and the soft warm terminator on the lit side
            float nl = dot(sssN, sssL);
            float wr = max(0.0, (nl + uSssWrap) / (1.0 + uSssWrap)) - max(0.0, nl);
            reflectedLight.directDiffuse += directionalLights[ 0 ].color * uSssColor
              * diffuseColor.rgb * (bk + wr * 2.0) * sssShadow * sssK;
          }
        }
        #endif`);
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (key ? key.call(material) : '') + '-sss1';
  return material;
}
