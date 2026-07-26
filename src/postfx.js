// The lens.
//
// Everything up to here is what the scene radiates; this is what a camera in
// front of it would actually record. A render that skips this step reads as a
// simulation viewed through a perfect window — which is exactly the difference
// between "a three.js demo" and a frame from a game that spent money on looking
// like film. Nothing here is physically necessary and all of it is what the eye
// reads as "shot", not "rendered":
//
//   - sun shafts   crepuscular rays, radially blurred from the sun's screen
//                  position. Terrain occludes them for free: the blur samples
//                  the colour buffer, so where a mountain covers the sun there
//                  is nothing bright to smear.
//   - anamorphic   the horizontal streak a wide cine lens throws off a hard
//                  highlight. One of the strongest "cinematic" tells there is.
//   - ghosts       internal reflections marching along the sun→centre axis.
//   - vignette     no real lens is evenly illuminated to the corner.
//   - aberration   radial R/B split that only bites at the frame edge.
//   - grain        breaks up banding in the dark sky and keeps flat gradients
//                  from looking like a paint bucket.
//
// One fullscreen pass, placed after bloom and before OutputPass so it works in
// HDR linear and the tonemapper still gets the last word.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from '../vendor/jsm/postprocessing/Pass.js';

const SHAFT_SAMPLES = 24;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uSun;          // sun position in UV space
uniform float uSunIn;       // 0 when the sun is behind the camera / off-frame
uniform float uShaft;
uniform float uFlare;
uniform float uVignette;
uniform float uCA;
uniform float uGrain;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// only genuinely HDR pixels throw shafts and flares — the same rule the bloom
// threshold follows, so the two agree about what counts as "a bright thing"
vec3 highlight(vec2 uv) {
  vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
  return max(c - 1.0, 0.0);
}

void main() {
  vec2 uv = vUv;

  // ---- chromatic aberration: zero in the middle, real at the corners
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  vec3 col;
  if (uCA > 1e-5) {
    vec2 off = d * r2 * uCA;
    col.r = texture2D(tDiffuse, clamp(uv + off, 0.0, 1.0)).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, clamp(uv - off, 0.0, 1.0)).b;
  } else {
    col = texture2D(tDiffuse, uv).rgb;
  }

  if (uSunIn > 0.001) {
    // ---- crepuscular rays: march toward the sun, accumulating highlights
    vec2 delta = (uSun - uv) * (1.0 / float(${SHAFT_SAMPLES}));
    vec2 p = uv;
    float w = 1.0;
    vec3 shafts = vec3(0.0);
    for (int i = 0; i < ${SHAFT_SAMPLES}; i++) {
      p += delta;
      shafts += highlight(p) * w;
      w *= 0.93;
    }
    shafts /= float(${SHAFT_SAMPLES});
    // fade with distance from the sun so the whole frame does not glow
    float sd = length((uv - uSun) * vec2(uAspect, 1.0));
    col += shafts * uShaft * uSunIn * exp(-sd * 1.15);

    // ---- anamorphic streak: a wide horizontal tap across the sun's row
    vec3 streak = vec3(0.0);
    for (int i = -10; i <= 10; i++) {
      float t = float(i) / 10.0;
      streak += highlight(vec2(uSun.x + t * 0.38, uSun.y)) * (1.0 - abs(t));
    }
    streak /= 11.0;
    float band = exp(-abs(uv.y - uSun.y) * 190.0)
               + exp(-abs(uv.y - uSun.y) * 26.0) * 0.28;
    col += streak * band * uFlare * uSunIn * vec3(0.62, 0.78, 1.0);

    // ---- ghosts: internal reflections stepping through the optical centre
    vec2 axis = (vec2(0.5) - uSun);
    for (int i = 1; i <= 3; i++) {
      float s = float(i) * 0.62;
      vec3 gh = highlight(uSun + axis * (1.0 + s));
      float fall = 1.0 / (1.0 + float(i) * 1.6);
      col += gh * fall * uFlare * 0.35 * uSunIn
           * vec3(1.0 - 0.2 * float(i), 0.85, 0.7 + 0.16 * float(i));
    }
  }

  // ---- vignette
  col *= 1.0 - uVignette * smoothstep(0.18, 0.78, r2);

  // ---- grain, scaled DOWN in bright areas the way real film sits
  float g = hash12(uv * 900.0 + fract(uTime) * 431.0) - 0.5;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += g * uGrain * (1.0 - smoothstep(0.0, 1.6, lum));

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const _p = new THREE.Vector3();

export class CinematicPass extends Pass {
  constructor(camera, opts = {}) {
    super();
    this.camera = camera;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uSunIn: { value: 0 },
        uShaft: { value: opts.shaft ?? 0.55 },
        uFlare: { value: opts.flare ?? 0.45 },
        uVignette: { value: opts.vignette ?? 0.30 },
        // Offset is d*r2*uCA in UV, and r2 maxes at 0.5 — so this is a
        // FRACTION OF THE SCREEN at the corner, not a pixel count. 0.006 puts
        // the split near a pixel where it belongs; anything in the tenths
        // smears the frame edge into a rainbow.
        uCA: { value: opts.ca ?? 0.006 },
        // applied in HDR linear, where a night sky sits around 0.01 — grain
        // that looks timid on a 0..255 scale is deafening down here
        uGrain: { value: opts.grain ?? 0.006 },
        uTime: { value: 0 },
        uAspect: { value: 1.78 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  // sunPosCam: the sun's position in render (camera-relative) space, or null.
  // Shafts and flare only exist when the sun is actually in front of the lens.
  update(dt, sunPosCam) {
    const u = this.material.uniforms;
    u.uTime.value += dt;
    if (!sunPosCam) { u.uSunIn.value = 0; return; }
    _p.copy(sunPosCam).project(this.camera);
    if (_p.z > 1) { u.uSunIn.value = 0; return; }        // behind the camera
    u.uSun.value.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5);
    // ease out as the sun leaves the frame instead of snapping off
    const m = Math.max(Math.abs(_p.x), Math.abs(_p.y));
    u.uSunIn.value = 1 - Math.min(1, Math.max(0, (m - 1.0) / 0.6));
  }

  setSize(w, h) { this.material.uniforms.uAspect.value = w / h; }

  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
