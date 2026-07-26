// Warp-flight visuals: hyperspace streak lines that rush past the camera.
// Streaks live in render space (camera at origin) inside a cylinder around
// the flight path; their parallax is scaled way down so at ~3,000 km/s they
// read as a light tunnel instead of single-frame noise.

import * as THREE from 'three';

const _dir = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _p = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

const PARALLAX = 0.012;            // fraction of true speed applied to streaks

export class WarpStreaks {
  constructor(scene, count = 340) {
    this.count = count;
    this.streaks = [];               // camera-relative positions
    for (let i = 0; i < count; i++) this.streaks.push(new THREE.Vector3());
    this.positions = new Float32Array(count * 2 * 3);
    const colors = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      const w = 0.55 + Math.random() * 0.45;
      colors[i * 6] = 0.72 * w; colors[i * 6 + 1] = 0.84 * w; colors[i * 6 + 2] = 1.0 * w;  // head
      colors[i * 6 + 3] = 0.02; colors[i * 6 + 4] = 0.03; colors[i * 6 + 5] = 0.05;          // tail
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  scatter(streak) {
    const r = 400 + Math.random() * 9000;
    const a = Math.random() * Math.PI * 2;
    const z = -8000 + Math.random() * 48000;
    streak.copy(_dir).multiplyScalar(z)
      .addScaledVector(_e1, Math.cos(a) * r)
      .addScaledVector(_e2, Math.sin(a) * r);
  }

  reset(velDir) {
    _dir.copy(velDir).normalize();
    _e1.crossVectors(_dir, Math.abs(_dir.y) < 0.9 ? Y : X).normalize();
    _e2.crossVectors(_dir, _e1);
    for (const s of this.streaks) this.scatter(s);
  }

  // vel: true velocity vector (m/s); intensity 0..1
  update(dt, vel, intensity) {
    if (intensity <= 0.01) { this.lines.visible = false; return; }
    const speed = vel.length();
    if (speed < 1) { this.lines.visible = false; return; }
    this.lines.visible = true;
    this.lines.material.opacity = Math.min(1, intensity) * 0.8;

    _dir.copy(vel).multiplyScalar(1 / speed);
    _e1.crossVectors(_dir, Math.abs(_dir.y) < 0.9 ? Y : X).normalize();
    _e2.crossVectors(_dir, _e1);
    const step = speed * dt * PARALLAX;
    const len = Math.min(300 + speed * 0.0022, 14000) * Math.max(0.25, intensity);

    for (let i = 0; i < this.count; i++) {
      const s = this.streaks[i];
      s.addScaledVector(_dir, -step);
      if (s.dot(_dir) < -9000) this.scatter(s);
      this.positions[i * 6] = s.x; this.positions[i * 6 + 1] = s.y; this.positions[i * 6 + 2] = s.z;
      _p.copy(s).addScaledVector(_dir, -len);
      this.positions[i * 6 + 3] = _p.x; this.positions[i * 6 + 4] = _p.y; this.positions[i * 6 + 5] = _p.z;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.lines.geometry.dispose();
    this.lines.material.dispose();
    if (this.lines.parent) this.lines.parent.remove(this.lines);
  }
}

// ============================================================================
// Sky dome: a camera-centred gradient hemisphere — horizon glow, zenith
// depth, a sun halo — blended in by atmosphere density and daylight.
// Painted first with no depth test, so it sits behind the world but over
// the stars (which fade out via their own dimming).
// ============================================================================

export class SkyDome {
  constructor(scene) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uHorizon: { value: new THREE.Color(0x88bbff) },
        uZenith: { value: new THREE.Color(0x224488) },
        uSunTint: { value: new THREE.Color(1.0, 0.92, 0.78) },
        uAlpha: { value: 0 },
      },
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uUp, uSunDir, uHorizon, uZenith, uSunTint;
        uniform float uAlpha;
        varying vec3 vDir;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 dir = normalize(vDir);
          float u = dot(dir, uUp);
          float t = pow(clamp(1.0 - max(u, 0.0), 0.0, 1.0), 3.2);
          vec3 col = mix(uZenith, uHorizon * 0.92, t);
          float sd = max(dot(dir, uSunDir), 0.0);
          col += uSunTint * (pow(sd, 700.0) * 1.3 + pow(sd, 16.0) * 0.16);
          float a = uAlpha * (u < 0.0 ? max(0.0, 1.0 + u * 2.4) : 1.0);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      // proper depth test (log-depth aware): terrain must occlude the sky —
      // transparent materials draw after opaque, so without this the dome
      // would wash over the whole world
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4e5, 48, 32), this.mat);
    this.mesh.renderOrder = -7;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(up, sunDir, horizon, zenith, alpha, sunset = 0) {
    const u = this.mat.uniforms;
    u.uUp.value.copy(up);
    u.uSunDir.value.copy(sunDir);
    u.uHorizon.value.copy(horizon);
    u.uZenith.value.copy(zenith);
    u.uAlpha.value = alpha;
    u.uSunTint.value.setRGB(1.0, 0.92 - sunset * 0.6, 0.78 - sunset * 0.68);
    this.mesh.visible = alpha > 0.01;
  }
}

// ============================================================================
// The ship: a low-poly craft flying just ahead of the camera whenever
// you're in flight — banks into turns, engines glow with speed, fades out
// when you step onto a planet. We are no longer a disembodied camera.
// ============================================================================

const _sq = new THREE.Quaternion();
const _sv = new THREE.Vector3();
const _sf = new THREE.Vector3();
const _su = new THREE.Vector3();
const _sr = new THREE.Vector3();

// plated hull texture: panel seams, rivet rows, mottled tone shifts, faint
// streaks and access hatches — the difference between a toy and a machine.
// Doubles as bump (red channel: seams indent) and roughness variation.
function shipHullTexture() {
  let s = 1234;                              // fixed seed: same hull every boot
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d8dbe0';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {             // mottle: subtly different panels
    ctx.fillStyle = `rgba(${100 + rnd() * 80 | 0},${105 + rnd() * 80 | 0},${115 + rnd() * 80 | 0},0.07)`;
    ctx.fillRect(rnd() * size, rnd() * size, 40 + rnd() * 120, 25 + rnd() * 80);
  }
  ctx.strokeStyle = 'rgba(40,45,55,0.34)';   // panel seams
  ctx.lineWidth = 1.2;
  for (let x = 0; x < size; x += 22 + rnd() * 26) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rnd() - 0.5) * 8, size); ctx.stroke();
  }
  for (let y = 0; y < size; y += 40 + rnd() * 46) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y + (rnd() - 0.5) * 6); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(35,40,50,0.30)';     // rivet rows along the seams
  for (let i = 0; i < 900; i++) ctx.fillRect(rnd() * size, rnd() * size, 1.6, 1.6);
  for (let i = 0; i < 26; i++) {             // weathering streaks
    const x = rnd() * size, y = rnd() * size;
    const grd = ctx.createLinearGradient(x, y, x, y + 30 + rnd() * 60);
    grd.addColorStop(0, 'rgba(30,32,38,0.13)');
    grd.addColorStop(1, 'rgba(30,32,38,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(x, y, 1.5 + rnd() * 2.5, 30 + rnd() * 60);
  }
  for (let i = 0; i < 14; i++) {             // access hatches
    const x = rnd() * size, y = rnd() * size, w = 10 + rnd() * 16, h = 8 + rnd() * 12;
    ctx.fillStyle = 'rgba(50,55,65,0.22)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(230,235,240,0.25)';
    ctx.strokeRect(x, y, w, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export class Ship {
  constructor(scene) {
    const g = new THREE.Group();
    const hullTex = shipHullTexture();
    this.hullTex = hullTex;
    // titanium, not white paint: under the HDR sun a near-white flat panel
    // exceeds the bloom threshold and the whole wing flashes — a darker
    // hull keeps full sunlight below it while the plating stays readable
    const hull = new THREE.MeshStandardMaterial({
      color: 0x9aa1ac, metalness: 0.58, roughness: 0.62,
      map: hullTex, bumpMap: hullTex, bumpScale: 1.6, roughnessMap: hullTex,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x2b3038, metalness: 0.7, roughness: 0.5, map: hullTex, bumpMap: hullTex, bumpScale: 1.2,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: 0xc2512d, metalness: 0.5, roughness: 0.45, map: hullTex, bumpMap: hullTex, bumpScale: 1.2,
    });
    const canopy = new THREE.MeshPhysicalMaterial({
      color: 0x0d1a24, metalness: 0.1, roughness: 0.06,
      clearcoat: 1.0, clearcoatRoughness: 0.08,
    });
    const engineGlowMat = new THREE.MeshStandardMaterial({
      color: 0x143040, emissive: new THREE.Color(0x66ddff), emissiveIntensity: 2.2,
    });

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.scale.set(sx, sy, sz);
      g.add(m);
      return m;
    };

    // fuselage: a lofted body, not a cylinder — nose at -Z
    {
      const prof = [
        [0.001, 0], [0.1, 0.05], [0.26, 0.5], [0.42, 1.2], [0.55, 2.1],
        [0.64, 3.1], [0.66, 4.0], [0.6, 5.0], [0.48, 5.9], [0.3, 6.6],
        [0.18, 7.0], [0.001, 7.15],
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const body = new THREE.LatheGeometry(prof, 18);
      body.rotateX(-Math.PI / 2);            // +Y (nose end) → -Z? no: → +Z
      body.rotateY(Math.PI);                 // flip so the taper faces forward
      body.translate(0, 0, 3.55);            // nose ≈ -3.6, tail ≈ +3.55
      body.scale(1, 0.82, 1);                // squashed cross-section
      add(body, hull, 0, 0, 0);
    }
    // spine hump fairing behind the canopy
    add(new THREE.SphereGeometry(0.5, 12, 9), hull, 0, 0.3, 0.7, 0, 0, 0, 1, 0.62, 2.6);
    // glass canopy + dark frame sill
    add(new THREE.SphereGeometry(0.52, 16, 12), canopy, 0, 0.42, -1.35, 0, 0, 0, 0.86, 0.6, 1.65);
    add(new THREE.SphereGeometry(0.54, 12, 8), dark, 0, 0.34, -1.35, 0, 0, 0, 0.9, 0.34, 1.72);

    // wings: swept, tapered, extruded with a real edge — not flat boxes
    const wing = (sign) => {
      // shape in (x=span, y→z chord after the fold): root LE forward,
      // tip swept 1.7 m back with a 45% taper
      const sh = new THREE.Shape();
      sh.moveTo(0.4, -1.3);
      sh.lineTo(sign * 3.9, 0.4);
      sh.lineTo(sign * 3.9, 1.35);
      sh.lineTo(0.4, 1.05);
      sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 1 });
      geo.rotateX(Math.PI / 2);              // planform flat in XZ, thickness in Y
      geo.translate(0, 0.02, 2.0);
      return geo;
    };
    add(wing(1), hull, 0, -0.12, 0, 0, 0, 0.05);
    add(wing(-1), hull, 0, -0.12, 0, 0, 0, -0.05);
    // wingtip endplates + accent tips
    for (const e of [1, -1]) {
      add(new THREE.BoxGeometry(0.09, 0.55, 1.15), dark, e * 3.86, 0.1, 2.42, 0.1 * e);
      add(new THREE.BoxGeometry(0.5, 0.16, 1.0), accent, e * 3.55, -0.02, 2.35);
    }
    // tail fin, swept, with accent trim
    {
      const sh = new THREE.Shape();
      sh.moveTo(-0.2, 0); sh.lineTo(1.6, 0.9); sh.lineTo(1.6, 1.45); sh.lineTo(0.25, 0.6); sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
      geo.rotateY(-Math.PI / 2);             // upright, thickness across X
      add(geo, hull, 0, 0.28, 1.6);
      add(new THREE.BoxGeometry(0.1, 0.5, 0.5), accent, 0, 1.55, 3.15, 0.5);
    }
    // racing stripes along the flanks
    for (const e of [1, -1]) {
      add(new THREE.BoxGeometry(0.03, 0.24, 4.6), accent, e * 0.58, 0.06, 0.6, 0, e * 0.02, 0);
    }
    // engine nacelles: lathed, with dark intake lips and inner nozzles
    for (const e of [1, -1]) {
      const prof = [
        [0.30, 0], [0.44, 0.15], [0.48, 0.55], [0.44, 1.25], [0.5, 1.55], [0.34, 1.95],
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const nac = new THREE.LatheGeometry(prof, 14);
      nac.rotateX(Math.PI / 2);              // axis → Z, intake forward
      add(nac, hull, e * 1.12, -0.16, 2.15);
      const lip = new THREE.TorusGeometry(0.37, 0.06, 6, 14);
      add(lip, dark, e * 1.12, -0.16, 2.12);
      const nozzle = new THREE.CylinderGeometry(0.3, 0.34, 0.5, 12, 1, true);
      add(nozzle, dark, e * 1.12, -0.16, 3.95, -Math.PI / 2);
    }
    this.glowA = add(new THREE.CylinderGeometry(0.24, 0.3, 0.3, 10), engineGlowMat, 1.12, -0.16, 4.05, -Math.PI / 2);
    this.glowB = add(new THREE.CylinderGeometry(0.24, 0.3, 0.3, 10), engineGlowMat, -1.12, -0.16, 4.05, -Math.PI / 2);
    // greebles: nose sensors, dorsal antenna, belly skids
    add(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 5), dark, 0.16, -0.08, -3.7, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5), dark, -0.16, -0.08, -3.55, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.015, 0.03, 0.75, 4), dark, 0, 0.62, 2.3);
    for (const e of [1, -1]) add(new THREE.BoxGeometry(0.26, 0.16, 2.0), dark, e * 0.62, -0.62, 0.7);
    // navigation lights: port red, starboard green, both blink in update()
    this.navMatL = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    this.navMatR = new THREE.MeshBasicMaterial({ color: 0x22ff44 });
    add(new THREE.SphereGeometry(0.07, 6, 5), this.navMatL, -3.88, 0.12, 2.0);
    add(new THREE.SphereGeometry(0.07, 6, 5), this.navMatR, 3.88, 0.12, 2.0);
    this.navT = 0;

    g.traverse((m) => { m.castShadow = true; m.receiveShadow = true; });
    this.group = g;
    scene.add(g);

    this.smQuat = new THREE.Quaternion();
    this.roll = 0;
    this.engineMat = engineGlowMat;

    // when you land, the ship sets down on a pad beside you and waits
    this.parkedPosUniv = null;
    this.parkedQuat = new THREE.Quaternion();
    this.parkAmt = 0;
    this.portrait = false;      // hero framing for screenshots / admiring it
  }

  setParked(posUniv, quat) {
    this.parkedPosUniv = posUniv.clone();
    this.parkedQuat.copy(quat);
  }

  update(dt, nav, state, speed, warp) {
    const wantsPark = (state === 'walk' || state === 'landing') && !!this.parkedPosUniv;
    this.parkAmt += ((wantsPark ? 1 : 0) - this.parkAmt) * (1 - Math.exp(-dt * 2.0));

    // formation pose: nose lags the camera a touch, which reads as mass
    this.smQuat.slerp(nav.quat, 1 - Math.exp(-dt * 6));
    _sq.copy(this.smQuat).invert().multiply(nav.quat);
    const rollTarget = Math.max(-0.55, Math.min(0.55, -_sq.y * 14));
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-dt * 5));
    _sf.set(0, 0, -1).applyQuaternion(this.smQuat);   // forward
    _su.set(0, 1, 0).applyQuaternion(this.smQuat);
    // formation offset — or, in portrait mode, a three-quarter hero pose
    // close in front of the lens (the flight offset sits 13.6° below the
    // camera axis, outside any narrow framing)
    if (this.portrait) {
      _sr.set(1, 0, 0).applyQuaternion(this.smQuat);
      _sv.copy(_sf).multiplyScalar(24).addScaledVector(_su, -2.2).addScaledVector(_sr, 5.5);
    } else {
      _sv.copy(_sf).multiplyScalar(19).addScaledVector(_su, -4.6);
    }
    const formQuat = _sq2.copy(this.smQuat)
      .multiply(_sq.setFromAxisAngle(_sr.set(0, 0, 1), this.roll));

    if (this.parkedPosUniv && this.parkAmt > 0.002) {
      // glide between flying formation and the landing pad
      _sp.copy(this.parkedPosUniv).sub(nav.pos);      // camera-relative pad
      const e = this.parkAmt * this.parkAmt * (3 - 2 * this.parkAmt);
      this.group.position.lerpVectors(_sv, _sp, e);
      this.group.quaternion.copy(formQuat).slerp(this.parkedQuat, e);
    } else {
      this.group.position.copy(_sv);
      this.group.quaternion.copy(formQuat);
    }

    const burnK = 1 - this.parkAmt;
    this.engineMat.emissiveIntensity = 0.15 + (1.2 + Math.min(1.6, speed / 1.5e6 + warp * 1.4) * 2.6) * burnK;
    const stretch = 1 + Math.min(8, speed / 4e5 + warp * 7) * burnK;
    this.glowA.scale.set(1, stretch, 1);
    this.glowB.scale.set(1, stretch, 1);

    // aviation strobes: sharp asynchronous double-flash
    this.navT += dt;
    const bl = (t) => Math.pow(Math.max(0, Math.sin(t)), 24) * 2.2 + 0.12;
    this.navMatL.color.setRGB(bl(this.navT * 3.4), 0.02, 0.02);
    this.navMatR.color.setRGB(0.02, bl(this.navT * 3.4 + 2.1), 0.03);
  }
}
const _sq2 = new THREE.Quaternion();
const _sp = new THREE.Vector3();


// ============================================================================
// Space dust: motes streaking past the canopy. Without something passing you,
// velocity is invisible in space — this is the cue that makes a throttle feel
// like speed. Motes live in a cube that follows the camera and WRAPS, so a
// thousand segments cover unlimited travel.
// ============================================================================

const DUST_N = 900;
const DUST_D = 700;          // cube side, metres

export class SpaceDust {
  constructor(scene) {
    this.pos = new Float32Array(DUST_N * 3);
    for (let i = 0; i < DUST_N * 3; i++) this.pos[i] = (Math.random() - 0.5) * DUST_D;
    const geo = new THREE.BufferGeometry();
    this.verts = new Float32Array(DUST_N * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this.verts, 3));
    this.mat = new THREE.LineBasicMaterial({
      color: 0xbfd6ff, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.LineSegments(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this._prev = new THREE.Vector3();
    this._first = true;
  }

  // navPos: universe position; vel: current velocity (m/s)
  update(navPos, vel, visible) {
    if (this._first) { this._prev.copy(navPos); this._first = false; }
    _sv.copy(navPos).sub(this._prev);        // camera travel since last frame
    this._prev.copy(navPos);

    const speed = vel.length();
    // a band: too slow and there is nothing to see, too fast and it becomes
    // a strobe (that regime belongs to the warp streaks)
    const k = visible ? Math.min(1, Math.max(0, (speed - 12) / 260))
                      * (1 - Math.min(1, Math.max(0, (speed - 2600) / 3000))) : 0;
    this.mat.opacity = k * 0.5;
    this.mesh.visible = k > 0.01;
    if (!this.mesh.visible) return;

    // streak length grows with speed, capped so it never smears the screen
    const streak = Math.min(70, 0.06 * speed + 1.5);
    _su.copy(vel).normalize().multiplyScalar(-streak);
    const H = DUST_D / 2;
    for (let i = 0; i < DUST_N; i++) {
      const j = i * 3;
      // wrap the mote cube around the camera's travel
      for (let a = 0; a < 3; a++) {
        let v = this.pos[j + a] - (a === 0 ? _sv.x : a === 1 ? _sv.y : _sv.z);
        if (v > H) v -= DUST_D; else if (v < -H) v += DUST_D;
        this.pos[j + a] = v;
      }
      const k6 = i * 6;
      this.verts[k6] = this.pos[j];
      this.verts[k6 + 1] = this.pos[j + 1];
      this.verts[k6 + 2] = this.pos[j + 2];
      this.verts[k6 + 3] = this.pos[j] + _su.x;
      this.verts[k6 + 4] = this.pos[j + 1] + _su.y;
      this.verts[k6 + 5] = this.pos[j + 2] + _su.z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
