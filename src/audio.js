// Procedural ambience: every sound is synthesized — no audio files. A small
// mixer of looping layers (space hum, wind, per-world surface beds) plus a
// Poisson scheduler for one-shot events (chirps, bubbles, crackles, creaks),
// all crossfaded by where you are: deep space → atmosphere → surface →
// underwater. Starts on the first user gesture (autoplay policy), M mutes.
//
// Layer map by planet type:
//   lush/ocean   leaf-rustle bed + day chirps
//   desert/barren dry low wind
//   ice          crystalline shimmer + rare deep creaks
//   lava         rumble + ember crackle
//   toxic/exotic alien murmur + bubble pops

const FAMILY = {
  lush: 'lush', ocean: 'lush', desert: 'dry', barren: 'dry',
  ice: 'ice', lava: 'lava', toxic: 'weird', exotic: 'weird',
};

export class Ambience {
  constructor(enabled = true) {
    this.enabled = enabled && typeof AudioContext !== 'undefined';
    this.started = false;
    this.muted = false;
    this.family = null;
    this._nextEvent = 0;
    if (!this.enabled) return;
    const start = () => { this.start(); };
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }

  start() {
    if (this.started || !this.enabled) return;
    this.started = true;
    const ctx = this.ctx = new AudioContext();
    ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = 0.38;
    // one filter muffles the whole world underwater
    this.duck = ctx.createBiquadFilter();
    this.duck.type = 'lowpass';
    this.duck.frequency.value = 20000;
    this.master.connect(this.duck).connect(ctx.destination);

    // shared noise loop
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    const noise = (filterType, freq, q = 1) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { gain: g, filter: f };
    };
    const tone = (freq, type = 'sine') => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g).connect(this.master);
      o.start();
      return { gain: g, osc: o };
    };

    // ---- beds ----
    this.space = tone(52);                    // deep-space hum (plus its 5th)
    this.space2 = tone(78.2);
    this.wind = noise('bandpass', 600, 0.8);
    this.leaves = noise('highpass', 2400);    // rustle: AM'd below
    this.dry = noise('bandpass', 240, 1.2);
    this.rumble = noise('lowpass', 95);
    this.murmur = noise('bandpass', 130, 2.5);  // alien resonant murmur
    this.shimmer = [2350, 3140, 3920].map((f) => tone(f));

    // slow LFOs make the beds breathe (gusts, rustle waves)
    const lfo = (rate, target, depth, base) => {
      const o = ctx.createOscillator(); o.frequency.value = rate;
      const g = ctx.createGain(); g.gain.value = depth;
      o.connect(g).connect(target);
      target.value = base;
      o.start();
    };
    lfo(0.09, this.wind.filter.frequency, 240, 600);
    lfo(0.17, this.leaves.gain.gain, 0.012, 0);     // rustle comes in waves
    lfo(0.11, this.rumble.gain.gain, 0.02, 0);
    this.shimmer.forEach((s, i) => lfo(0.05 + i * 0.023, s.gain.gain, 0.004, 0));
  }

  // smooth gain move (no zipper noise)
  _to(node, v, t = 0.6) {
    node.gain.gain !== undefined
      ? node.gain.gain.setTargetAtTime(v, this.ctx.currentTime, t)
      : node.gain.setTargetAtTime(v, this.ctx.currentTime, t);
  }

  toggleMute() {
    if (!this.started) return false;
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.38, this.ctx.currentTime, 0.1);
    return this.muted;
  }

  // env: {inAtmo 0..1, day 0..1, underwater bool, alt m, speed m/s, type, state}
  update(dt, env) {
    if (!this.started || this.muted) return;
    const ctx = this.ctx;
    this.family = FAMILY[env.type] || 'dry';
    const surface = Math.max(0, Math.min(1, (900 - env.alt) / 700)) * env.inAtmo;

    // beds
    this._to(this.space, 0.05 * (1 - env.inAtmo));
    this._to(this.space2, 0.022 * (1 - env.inAtmo));
    const speedK = Math.min(1, env.speed / 260);
    this._to(this.wind, env.inAtmo * (0.02 + surface * 0.05 + speedK * 0.12), 0.3);
    this._to(this.leaves, this.family === 'lush' ? surface * 0.018 * (0.4 + 0.6 * env.day) : 0);
    this._to(this.dry, this.family === 'dry' ? surface * 0.05 : 0);
    this._to(this.rumble, this.family === 'lava' ? surface * 0.09 : 0);
    this._to(this.murmur, this.family === 'weird' ? surface * 0.045 : 0);
    for (const s of this.shimmer) this._to(s, this.family === 'ice' ? surface * 0.006 : 0);

    // underwater: everything muffles, plus its own bubble stream
    this.duck.frequency.setTargetAtTime(env.underwater ? 520 : 20000, ctx.currentTime, 0.15);

    // ---- one-shot events, Poisson-spaced ----
    this._nextEvent -= dt;
    if (this._nextEvent <= 0 && surface > 0.5) {
      this._nextEvent = 3 + Math.random() * 9;
      const f = this.family;
      if (env.underwater) this._bubble(140 + Math.random() * 120, 0.09);
      else if (f === 'lush' && env.day > 0.35) this._chirp();
      else if (f === 'weird') this._bubble(240 + Math.random() * 200, 0.07);
      else if (f === 'lava') this._crackle();
      else if (f === 'ice' && Math.random() < 0.4) this._creak();
      else this._nextEvent = 1 + Math.random() * 3;
    }
  }

  // a two-note alien bird: FM blip with a falling tail
  _chirp() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    const f0 = 1400 + Math.random() * 1800;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (0.55 + Math.random() * 0.3), t + 0.14);
    if (Math.random() < 0.5) {
      o.frequency.setValueAtTime(f0 * 1.15, t + 0.19);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.3);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.028 + Math.random() * 0.018, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.36);
  }

  _bubble(f0, vol) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0 * 2.2, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.09);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.13);
  }

  _crackle() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = 3 + (Math.random() * 4) | 0;
    for (let i = 0; i < n; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 1500;
      const g = ctx.createGain();
      const tt = t + i * (0.03 + Math.random() * 0.07);
      g.gain.setValueAtTime(0.05, tt);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.03);
      src.connect(f).connect(g).connect(this.master);
      src.start(tt, Math.random() * 1.5, 0.05);
    }
  }

  _creak() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70 + Math.random() * 50, t);
    o.frequency.linearRampToValueAtTime(55 + Math.random() * 30, t + 0.5);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 300;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(f).connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.65);
  }

  state() {
    if (!this.started) return { enabled: this.enabled, started: false };
    const g = (l) => Number(l.gain.gain.value.toFixed(4));
    return {
      enabled: this.enabled, started: true, muted: this.muted, family: this.family,
      duckHz: Math.round(this.duck.frequency.value),
      layers: {
        space: g(this.space), wind: g(this.wind), leaves: g(this.leaves),
        dry: g(this.dry), rumble: g(this.rumble), murmur: g(this.murmur),
        shimmer: g(this.shimmer[0]),
      },
    };
  }
}
