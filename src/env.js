// Image-based lighting — the missing half of the lighting model.
//
// Until now the scene had a sun (point light) and a token AmbientLight, and
// `scene.environment` was never set. For a MeshStandardMaterial that is fatal:
// diffuse is scaled by (1 - metalness), and the *entire* specular response of a
// metal comes from the environment map. The ship hull is metalness 0.58, so its
// shadow side was not "dark" — it was arithmetically zero. A black cutout with
// two glowing engines pasted on.
//
// This bakes ONE environment map that is continuous across the whole journey:
// the nebula cubemap in deep space, blending into the planet's sky gradient as
// you enter atmosphere, with a sun disc for a real specular highlight. One
// texture, so there is never a crossfade pop between "space env" and "sky env".
//
// Re-baked on demand (a few times a second while conditions change, never when
// they don't), PMREM-filtered so roughness maps to the right blur level.

import * as THREE from 'three';

// The sun is ALREADY a real light in the scene. Putting a matching disc in the
// environment would double-count its diffuse contribution, so it goes in at a
// fraction of true radiance: enough for a metal to catch a proper moving
// highlight, not enough to wash the lighting.
const SUN_ENV_K = 0.16;

// Integrated starlight + zodiacal light: the reason a hull in deep space is
// dark rather than absent. Small, cool, always present.
const STARLIGHT_FLOOR = new THREE.Vector3(0.010, 0.013, 0.022);

const ENV_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ENV_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform samplerCube uNebula;
uniform float uHasNebula;
uniform float uNebulaK;
uniform float uAtmo;          // 0 = deep space, 1 = inside atmosphere
uniform vec3 uUp, uSunDir;
uniform vec3 uHorizon, uZenith, uGround;
uniform vec3 uSunColor;
uniform float uSunK;
uniform vec3 uFloor;

void main() {
  vec3 d = normalize(vDir);

  // ---- deep space: the baked nebula plus a starlight floor
  vec3 space = uFloor;
  if (uHasNebula > 0.5) space += textureCube(uNebula, d).rgb * uNebulaK;

  // ---- atmosphere: the same gradient the sky dome paints, so the light
  // arriving on a surface agrees with the sky behind it
  float u = dot(d, uUp);
  float t = pow(clamp(1.0 - max(u, 0.0), 0.0, 1.0), 3.2);
  vec3 sky = mix(uZenith, uHorizon * 0.92, t);
  // below the horizon the world bounces ground colour back up — this is what
  // fills the underside of a hull standing on a planet
  sky = mix(sky, uGround, smoothstep(0.0, -0.35, u));

  vec3 col = mix(space, sky, clamp(uAtmo, 0.0, 1.0));

  // ---- the sun, as an area of sky rather than a mathematical point: gives
  // metal a highlight with a real edge instead of a pinprick
  float sd = dot(d, uSunDir);
  col += uSunColor * uSunK * smoothstep(0.9986, 0.9997, sd);
  col += uSunColor * uSunK * 0.04 * pow(max(sd, 0.0), 24.0);   // forward haze

  gl_FragColor = vec4(col, 1.0);
}`;

export class EnvLighting {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uNebula: { value: null },
        uHasNebula: { value: 0 },
        uNebulaK: { value: 2.6 },
        uAtmo: { value: 0 },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uHorizon: { value: new THREE.Color(0, 0, 0) },
        uZenith: { value: new THREE.Color(0, 0, 0) },
        uGround: { value: new THREE.Color(0, 0, 0) },
        uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
        uSunK: { value: 0 },
        uFloor: { value: STARLIGHT_FLOOR.clone() },
      },
      vertexShader: ENV_VERT,
      fragmentShader: ENV_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.envScene = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), this.mat);
    box.frustumCulled = false;
    this.envScene.add(box);
    this._box = box;

    this.rt = null;
    this._cool = 0;          // seconds until the next bake is allowed
    this._dirty = true;
    this._last = { atmo: -1, day: -1, sun: new THREE.Vector3(), up: new THREE.Vector3() };
  }

  // Called when a new universe is generated. `cubeTex` is the nebula bake.
  setNebula(cubeTex) {
    this.mat.uniforms.uNebula.value = cubeTex || null;
    this.mat.uniforms.uHasNebula.value = cubeTex ? 1 : 0;
    this._dirty = true;
  }

  // Conditions come straight from the ambience pass, so the environment and
  // the visible sky can never disagree.
  //   atmo      0..1 atmosphere blend
  //   up        world-space up at the camera
  //   sunDir    world-space direction to the sun
  //   horizon/zenith/ground  linear sky colours (already daylight-scaled)
  //   sunK      sun radiance scale (0 when eclipsed/underwater)
  update(dt, c) {
    const u = this.mat.uniforms;
    u.uAtmo.value = c.atmo;
    u.uUp.value.copy(c.up);
    u.uSunDir.value.copy(c.sunDir);
    u.uHorizon.value.copy(c.horizon);
    u.uZenith.value.copy(c.zenith);
    u.uGround.value.copy(c.ground);
    u.uSunK.value = c.sunK * SUN_ENV_K;
    if (c.sunColor) u.uSunColor.value.copy(c.sunColor);

    // Re-bake only when the sky has actually moved. Parked in deep space this
    // settles to zero bakes per second; walking through a sunset it runs at
    // the cooldown rate.
    const L = this._last;
    const moved = L.sun.distanceToSquared(c.sunDir) > 1e-6
      || L.up.distanceToSquared(c.up) > 1e-6
      || Math.abs(L.atmo - c.atmo) > 0.004;
    if (moved) this._dirty = true;

    this._cool -= dt;
    if (!this._dirty || this._cool > 0) return;
    this._cool = 0.25;
    this._dirty = false;
    L.sun.copy(c.sunDir); L.up.copy(c.up); L.atmo = c.atmo;
    this._bake();
  }

  _bake() {
    const prev = this.rt;
    // bake in linear space no matter what the app's output settings are
    const prevTone = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    this.renderer.toneMapping = prevTone;
    this.scene.environment = this.rt.texture;
    if (prev) prev.dispose();
  }

  dispose() {
    if (this.rt) this.rt.dispose();
    this.pmrem.dispose();
    this._box.geometry.dispose();
    this.mat.dispose();
    this.scene.environment = null;
  }
}
