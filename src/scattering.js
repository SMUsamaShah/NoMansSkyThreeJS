// Aerial perspective — the depth cue that makes a planet read as planet-sized.
//
// The scene had FogExp2 at a density of 1e-5 above 2.5 km, which over a 30 km
// vista is an 8% wash: effectively nothing. So a mountain range 30 km away
// arrived at the eye as saturated and contrasty as the hillside underfoot, and
// the whole world collapsed to the scale of a diorama. Distance haze is the
// single strongest scale cue there is, and it was missing.
//
// This is the cheap single-scattering approximation everyone uses (after
// Quílez): extinction that grows with path length and thins with altitude, an
// inscatter colour that is the sky's own, and a Mie forward-scattering lobe so
// that looking toward the sun the haze goes bright and warm while away from it
// it stays cool and blue. That sun dependence is most of why it reads as air
// and not as grey fog.
//
// The uniform objects are shared by reference — like TIME in shaders.js — so
// terrain, water, props, and far flora all sample one atmosphere and can never
// disagree about it.

import * as THREE from 'three';

export const AERIAL = {
  uAerialSunView: { value: new THREE.Vector3(0, 0, -1) },  // sun dir, VIEW space
  uAerialColor: { value: new THREE.Color(0, 0, 0) },       // cool inscatter (sky)
  uAerialSunCol: { value: new THREE.Color(0, 0, 0) },      // warm, toward the sun
  uAerialK: { value: 0 },                                  // density at sea level, 1/m
  uAerialH: { value: 9000 },                               // scale height, m
  uAerialMax: { value: 0.92 },                             // never quite erase the world
  uAerialCamAlt: { value: 0 },
  uAerialR: { value: 1e7 },                                // planet radius
};

// Feed from the ambience pass once per frame. `camera` is needed to put the
// sun into view space, which is where the fragment shader can use it without
// every material having to agree on a world-space varying.
const _sv = new THREE.Vector3();
export function updateAerial(camera, {
  sunDirWorld, color, sunColor, density, scaleHeight, camAlt, planetR,
}) {
  _sv.copy(sunDirWorld).transformDirection(camera.matrixWorldInverse);
  AERIAL.uAerialSunView.value.copy(_sv);
  AERIAL.uAerialColor.value.copy(color);
  AERIAL.uAerialSunCol.value.copy(sunColor);
  AERIAL.uAerialK.value = density;
  AERIAL.uAerialH.value = scaleHeight;
  AERIAL.uAerialCamAlt.value = camAlt;
  AERIAL.uAerialR.value = planetR;
}

const DECL = /* glsl */`
uniform vec3 uAerialSunView;
uniform vec3 uAerialColor;
uniform vec3 uAerialSunCol;
uniform float uAerialK;
uniform float uAerialH;
uniform float uAerialMax;
uniform float uAerialCamAlt;
uniform float uAerialR;
varying vec3 vAerialView;
`;

// `heightExpr` must evaluate to the fragment's altitude above sea level. Terrain
// already carries vLocalPos and can be exact; props and far flora are close
// enough to the ground to just use the camera's altitude.
export function aerialFragment(heightExpr = 'uAerialCamAlt') {
  return /* glsl */`
  {
    if (uAerialK > 1e-9) {
      // Density is averaged over the two endpoints rather than integrated
      // along the ray. Over a vista both ends sit in the same slab, and the
      // error is far smaller than the thing it replaces (nothing at all).
      float hAvg = max(0.0, (uAerialCamAlt + (${heightExpr})) * 0.5);
      float dens = uAerialK * exp(-hAvg / uAerialH);
      float dist = length(vAerialView);
      float f = 1.0 - exp(-dist * dens);
      vec3 rayDir = normalize(vAerialView);
      // Mie forward lobe: haze toward the sun is bright and warm, away from it
      // cool — the asymmetry that separates air from grey fog
      float sunAmt = max(dot(rayDir, uAerialSunView), 0.0);
      vec3 haze = mix(uAerialColor, uAerialSunCol,
                      pow(sunAmt, 5.0) * 0.75 + pow(sunAmt, 40.0) * 0.25);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, haze, clamp(f, 0.0, 1.0) * uAerialMax);
    }
  }`;
}

// Mutate a shader object from inside an existing onBeforeCompile hook.
// Carries its OWN view-space varying rather than borrowing vViewPosition, so it
// works on Standard, Physical and Lambert alike.
export function injectAerial(shader, heightExpr) {
  Object.assign(shader.uniforms, AERIAL);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vAerialView;`)
    .replace('#include <project_vertex>', `#include <project_vertex>
      vAerialView = mvPosition.xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${DECL}`)
    // before three's own fog, so cloud-transit whiteout and underwater still
    // have the last word
    .replace('#include <fog_fragment>', `${aerialFragment(heightExpr)}\n#include <fog_fragment>`);
  return shader;
}

// Add aerial perspective to a material, preserving any hook already installed
// (wind sway, emissive tinting, far-fade) instead of clobbering it.
export function chainAerial(material, heightExpr) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    injectAerial(shader, heightExpr);
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (key ? key.call(material) : '') + '-aerial1';
  return material;
}
