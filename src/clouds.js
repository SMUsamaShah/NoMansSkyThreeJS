// True volumetric clouds: a raymarched shell between two radii around the
// planet. Coverage reuses the SAME field as the impostor deck, the terrain's
// cast shadows and the CPU transit fog — one cloudscape, four consumers.
// Shape and erosion come from a small tileable 3D noise texture; lighting is
// a short sun march with Beer extinction, a powder term and an HG phase.
// Everything is driven by the planet's cloud spin (frozen under ?freeze=1),
// so the seam test's static frames stay static.

import * as THREE from 'three';
import { hash3i, hashFloat } from './rng.js';
import { cloudFieldGLSL } from './shaders.js';
import { AERIAL } from './scattering.js';

let _noiseTex = null;

// wrapped-lattice value noise → guaranteed tiling in all three axes
function valueNoise3(x, y, z, N, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const v = (ix, iy, iz) => hashFloat(hash3i(((ix % N) + N) % N, ((iy % N) + N) % N, ((iz % N) + N) % N, seed), 0);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(v(xi, yi, zi), v(xi + 1, yi, zi), sx), lerp(v(xi, yi + 1, zi), v(xi + 1, yi + 1, zi), sx), sy),
    lerp(lerp(v(xi, yi, zi + 1), v(xi + 1, yi, zi + 1), sx), lerp(v(xi, yi + 1, zi + 1), v(xi + 1, yi + 1, zi + 1), sx), sy),
    sz);
}

// wrapped worley (cellular): distance to nearest feature point on a wrapped
// lattice — inverted it reads as billowing cauliflower lobes
function worley3(x, y, z, N, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 8;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        const h = hash3i(((cx % N) + N) % N, ((cy % N) + N) % N, ((cz % N) + N) % N, seed);
        const px = cx + hashFloat(h, 0), py = cy + hashFloat(h, 1), pz = cz + hashFloat(h, 2);
        const d = (px - x) * (px - x) + (py - y) * (py - y) + (pz - z) * (pz - z);
        if (d < best) best = d;
      }
    }
  }
  return Math.min(1, Math.sqrt(best));
}

// 48³ RG texture: R = perlin-worley base lobes, G = high-frequency erosion
export function cloudNoiseTexture() {
  if (_noiseTex) return _noiseTex;
  const S = 48;
  const data = new Uint8Array(S * S * S * 2);
  for (let z = 0; z < S; z++) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S, w = z / S;
        let f = 0, amp = 0.55, fr = 3;
        for (let o = 0; o < 3; o++) {
          f += valueNoise3(u * fr, v * fr, w * fr, fr, 0x51 + o) * amp;
          amp *= 0.5; fr *= 2;
        }
        const lobes = 1 - worley3(u * 5, v * 5, w * 5, 5, 0xC1);
        const base = Math.min(1, Math.max(0, f * 0.55 + lobes * 0.6));
        const ero = 1 - worley3(u * 9, v * 9, w * 9, 9, 0xE3) * 0.6
          - worley3(u * 17, v * 17, w * 17, 17, 0xE7) * 0.4;
        const k = (z * S * S + y * S + x) * 2;
        data[k] = base * 255;
        data[k + 1] = Math.min(1, Math.max(0, ero)) * 255;
      }
    }
  }
  _noiseTex = new THREE.Data3DTexture(data, S, S, S);
  _noiseTex.format = THREE.RGFormat;
  _noiseTex.minFilter = _noiseTex.magFilter = THREE.LinearFilter;
  _noiseTex.wrapS = _noiseTex.wrapT = _noiseTex.wrapR = THREE.RepeatWrapping;
  _noiseTex.needsUpdate = true;
  return _noiseTex;
}

// logDepthBufFC for the manual fragment-depth write (camera.far is fixed)
export function logDepthFC(far) { return 2.0 / (Math.log(far + 1.0) / Math.LN2); }

export function makeCloudVolumeMaterial(planet, band, detailTex, far) {
  const thick = band.rOut - band.rIn;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    // PREMULTIPLIED alpha. The march accumulates `col += T * a * radiance`,
    // which is already premultiplied — and the default SrcAlpha blend then
    // multiplied it by alpha a SECOND time. Every low-density sample was
    // therefore attenuated quadratically, so wisps and cloud edges went to
    // nothing while dense cores (alpha≈1) were untouched. That is precisely
    // the "flat blob with a hard boundary" look: the soft part of a cloud is
    // the part the double-multiply erased.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      ...AERIAL,          // shared by reference: clouds haze like everything else
      uNoise3: { value: cloudNoiseTexture() },
      uCloudNoise: { value: detailTex },
      uCov0: { value: band.cov0 },
      uCov1: { value: band.cov1 },
      uCOff: { value: new THREE.Vector3(band.ox, band.oy, band.oz) },
      uCenter: { value: new THREE.Vector3() },     // planet center, camera space
      uSpin: { value: new THREE.Matrix3() },       // same rotation as the shadows
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uRin: { value: band.rIn },
      uRout: { value: band.rOut },
      uSunC: { value: new THREE.Color(1, 0.98, 0.94) },
      uAmbC: { value: new THREE.Color(0.35, 0.42, 0.55) },
      uTint: { value: new THREE.Color(band.tint || 0xffffff) },
      uEngage: { value: 0 },
      uLogFC: { value: logDepthFC(far) },
      uThick: { value: thick },
      uCloudAlt: { value: (band.rIn + band.rOut) * 0.5 - planet.R },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      varying vec3 vView;
      void main() {
        // camera-relative rendering: the camera sits at the origin, so the
        // world position of a shell vertex IS the ray direction
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz;
        // ...and its VIEW-space direction, which is what the log depth buffer
        // measures along. Depth was being written from the ray LENGTH, which
        // overstates depth by 1/cos(angle-off-axis) — up to ~15% at the corners
        // of a 1280x720 frame. Distant clouds therefore sank behind ridges at
        // the edges of the frame but not at its centre.
        vView = (viewMatrix * vec4(wp.xyz, 0.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      precision highp sampler3D;
      uniform sampler3D uNoise3;
      uniform sampler2D uCloudNoise;
      uniform float uCov0, uCov1, uRin, uRout, uEngage, uLogFC, uThick, uCloudAlt;
      uniform vec3 uCOff, uCenter, uSunDir, uSunC, uAmbC, uTint;
      uniform mat3 uSpin;
      uniform vec3 uAerialColor, uAerialSunCol;
      uniform float uAerialK, uAerialH, uAerialMax, uAerialCamAlt;
      varying vec3 vDir;
      varying vec3 vView;

      // the SAME coverage field the impostor deck, the terrain's cast shadows
      // and the CPU transit fog use — one sky, four consumers (§2.3). Explicit
      // LOD: implicit derivatives are UNDEFINED in the divergent march loop.
      ${cloudFieldGLSL(true)}

      // both intersections of |p - C| = r along o=0 + t*dir
      vec2 sphereHits(vec3 C, float r, vec3 dir) {
        float b = dot(dir, C);
        float disc = b * b - dot(C, C) + r * r;
        if (disc < 0.0) return vec2(-1.0);
        float s = sqrt(disc);
        return vec2(b - s, b + s);
      }

      // Shape given an already-known coverage. Splitting shape from coverage is
      // what pays for the (better, triplanar) coverage field: coverage depends
      // only on the surface DIRECTION, and over the ~1 km sun march that
      // direction turns by ~2° on an 80 km world, so it was being resampled in
      // full four times per step for almost no change. Now it is sampled once
      // per step and displaced by its own large-scale octave toward the sun.
      // `lod` fades the carving detail out as the step grows, mean-preserved,
      // so far-field samples converge to smooth coverage instead of aliasing.
      float shapeAt(vec3 local, float cov, float lodK, float detail) {
        if (cov < 0.01) return 0.0;
        float r = length(local);
        float h = clamp((r - uRin) / (uRout - uRin), 0.0, 1.0);
        // puffy bottoms, wispy tops; thicker coverage climbs higher
        float prof = smoothstep(0.0, 0.16, h) * (1.0 - smoothstep(0.45 + 0.4 * cov, 1.0, h));
        vec3 q = uSpin * local / (uThick * 1.9);
        float n = textureLod(uNoise3, q, 0.0).r;
        float carve = mix(0.46, 1.0 - n, lodK) * 0.42;
        float d = clamp(cov * prof - carve, 0.0, 1.0);
        if (detail > 0.01 && d > 0.0) {
          float ero = textureLod(uNoise3, q * 3.7, 0.0).g;
          d = clamp(d - (ero - 0.5 * (1.0 - detail)) * 0.3 * detail * (1.0 - d), 0.0, 1.0);
        }
        return d;
      }

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float hgPhase(float mu, float g) {
        float g2 = g * g;
        return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
      }

      void main() {
        if (uEngage < 0.01) discard;
        vec3 dir = normalize(vDir);
        vec2 outer = sphereHits(uCenter, uRout, dir);
        if (outer.y <= 0.0) discard;
        vec2 inner = sphereHits(uCenter, uRin, dir);
        // march the FIRST pass through the shell only (the re-entry segment
        // on the far side is behind the planet for any ray that matters)
        float t0 = max(outer.x, 0.0);
        float t1 = (inner.x > 0.0) ? inner.x : outer.y;
        float camR = length(uCenter);
        if (camR < uRin && inner.y > 0.0) { t0 = max(inner.y, 0.0); t1 = outer.y; }
        float thick = uRout - uRin;
        // grazing rays: bound the cost. The old bound was 14 shell thicknesses
        // and the density simply STOPPED there — a straight wall of cloud edge
        // across the sky at a fixed range. The bound is now far enough to reach
        // the horizon of a small world, and the density ramps to zero into it.
        float tCap = t0 + thick * 30.0;
        float trunc = t1 > tCap ? 1.0 : 0.0;
        t1 = min(t1, tCap);
        if (t1 <= t0) discard;

        float seg = t1 - t0;
        // Steps are distributed as a power law from the shell entry: dense
        // where the eye can resolve a cloud's silhouette, sparse beyond. A
        // UNIFORM dt over a 30 km grazing segment came out around 1 km — wider
        // than the shape noise's own lobes, so every cloud was reconstructed as
        // a handful of slabs one step thick, which is exactly the "quads
        // stacking and popping against each other" the frame shows.
        const float P = 1.75;
        int STEPS = int(clamp(seg / (thick * 0.07), 20.0, 40.0));
        float invN = 1.0 / float(STEPS);
        float jitter = hash12(gl_FragCoord.xy);

        float sigma = 5.2 / thick;                  // extinction scale
        float mu = dot(dir, uSunDir);

        vec3 col = vec3(0.0);
        float T = 1.0;
        float dSum = 0.0, dW = 0.0;
        for (int i = 0; i < 40; i++) {
          if (i >= STEPS || T < 0.015) break;
          float u = (float(i) + jitter) * invN;
          float t = t0 + seg * pow(u, P);
          // the distribution's own derivative IS this sample's step length
          float dt = seg * P * pow(max(u, 1e-3), P - 1.0) * invN;
          vec3 local = dir * t - uCenter;
          float lodK = clamp(1.0 - dt / (thick * 1.1), 0.0, 1.0);
          float detail = clamp(1.0 - dt / (thick * 0.25), 0.0, 1.0);

          vec3 sd = uSpin * normalize(local);
          float o0;
          float f = cloudFbmO(sd, o0);
          float cov = smoothstep(uCov0, uCov1, f);
          // ramp into the far bound so a truncated march dissolves, never ends
          // (GLSL smoothstep is UNDEFINED for edge0 >= edge1 — invert instead)
          cov *= mix(1.0, 1.0 - smoothstep(0.62, 1.0, u), trunc);
          float d = shapeAt(local, cov, lodK, detail);
          if (d > 0.003) {
            // Sun march. Coverage is displaced by its own large-scale octave
            // toward the light, which is what actually casts a cloud-to-cloud
            // shadow — three extra taps instead of thirty-six.
            float ls = thick * 0.35;
            vec3 sdS = uSpin * normalize(local + uSunDir * ls * 2.0);
            float covS = smoothstep(uCov0, uCov1, f + (cloudOct0(sdS) - o0));
            float od = shapeAt(local + uSunDir * ls * 0.6, covS, lodK, 0.0) * ls * 0.6
                     + shapeAt(local + uSunDir * ls * 1.5, covS, lodK, 0.0) * ls * 0.9
                     + shapeAt(local + uSunDir * ls * 3.0, covS, lodK, 0.0) * ls * 1.5;
            float odS = od * sigma;
            // Multiple scattering as octaves of Beer-Lambert (Wrenninge): one
            // extinction term alone renders a cloud as a flat silhouette with a
            // bright edge and a black core. The deeper, wider-phase octaves are
            // what put light INSIDE the mass and give the sunward face the
            // graded, self-shadowed relief the reference frames have.
            float lum = 0.0;
            float att = 0.9, wgt = 1.0, ecc = 0.72;
            for (int o = 0; o < 3; o++) {
              lum += wgt * exp(-odS * att) * mix(0.0796, hgPhase(mu, ecc), 0.72);
              att *= 0.42; wgt *= 0.55; ecc *= 0.6;
            }
            // powder: the sunward SURFACE of a cloud is darker than just under
            // it. Applied to the sun term only — it used to scale the ambient
            // as well, which drove every low-density wisp to black.
            float powder = 1.0 - exp(-odS * 2.0 - d * 1.5);
            float hFrac = clamp((length(local) - uRin) / thick, 0.0, 1.0);
            vec3 s = uSunC * (lum * 18.0 * mix(0.55, 1.0, powder))
                   + uAmbC * (0.45 + 0.55 * hFrac);
            float a = 1.0 - exp(-d * sigma * dt);
            float wc = T * a;
            col += wc * s * uTint;
            dSum += wc * t; dW += wc;
            T *= 1.0 - a;
          }
        }
        float alpha = (1.0 - T) * uEngage;
        if (alpha < 0.004) discard;

        // Transmittance-weighted depth: where the cloud VISUALLY sits. The old
        // "first sample above threshold" inherited the march's per-pixel jitter,
        // so the depth written varied by a whole step between neighbouring
        // pixels and the cloud/terrain intersection came out stippled.
        float depth = dW > 1e-5 ? dSum / dW : t0;

        // Aerial perspective. Terrain, water, props and far flora all haze with
        // distance; the clouds did not, so a cloud 25 km out arrived at full
        // contrast in front of ridges that were half dissolved, and read as
        // nearer than them. Same law, same shared uniforms.
        if (uAerialK > 1e-9) {
          float hAvg = max(0.0, (uAerialCamAlt + uCloudAlt) * 0.5);
          float dens = uAerialK * exp(-hAvg / uAerialH);
          float fz = clamp(1.0 - exp(-depth * dens), 0.0, 1.0);
          float sunAmt = max(dot(dir, uSunDir), 0.0);
          vec3 haze = mix(uAerialColor, uAerialSunCol,
                          pow(sunAmt, 5.0) * 0.75 + pow(sunAmt, 40.0) * 0.25);
          col = mix(col, haze * alpha, fz * uAerialMax);
        }

        float cosA = max(-normalize(vView).z, 1e-4);
        gl_FragDepth = log2(1.0 + max(depth * cosA, 0.001)) * uLogFC * 0.5;
        gl_FragColor = vec4(col * uEngage, alpha);
      }`,
  });
  mat.userData.band = band;
  return mat;
}
