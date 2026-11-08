// Procedural space-opera sound for the cockpit, all synthesized with the Web Audio API (no sample files):
// singing blaster bolts, chirping droid voices, roaring engines, a howling hyperdrive and a humming beam.
// Everything runs through one bus: a shared convolution reverb gives sounds a cabin and a tail,
// a compressor glues layers together and keeps stacked effects from clipping.
// Each effect is built from layers the way film sound is: a transient for the attack, a tonal body,
// filtered noise for air and texture, and a sub layer for weight.

const MASTER_VOLUME = 0.5;

class SpaceAudio {
  constructor() {
    this.ctx = null;
    this.muted = true;
    this.initialized = false;
    this.noise = {};
    this.laserSide = 1;
    this.tractorOn = false;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
      const ctx = this.ctx;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : MASTER_VOLUME;

      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -20;
      this.compressor.knee.value = 14;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.25;

      this.bus = ctx.createGain();
      this.bus.connect(this.compressor);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(2.6, 2.4);
      this.reverbReturn = ctx.createGain();
      this.reverbReturn.gain.value = 0.55;
      this.reverb.connect(this.reverbReturn);
      this.reverbReturn.connect(this.compressor);

      this.compressor.connect(this.masterGain);
      this.masterGain.connect(ctx.destination);

      this.setupEngine();
      this.setupWarp();
      this.setupAmbience();
      this.setupTractor();

      this.initialized = true;
    } catch (e) {
      console.warn('Web Audio API not supported or blocked: ', e);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Building blocks
  // ------------------------------------------------------------------------------------------

  get now() {
    return this.ctx.currentTime;
  }

  // Stereo impulse response: dense early reflections, then a darkening exponential tail
  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        // the tail loses its highs as it decays
        const cutoff = 0.55 - 0.45 * t;
        lp += cutoff * ((Math.random() * 2 - 1) - lp);
        const early = i < rate * 0.06 && Math.random() < 0.02 ? (Math.random() * 2 - 1) * 0.8 : 0;
        data[i] = (lp + early) * Math.pow(1 - t, decay);
      }
    }
    return buffer;
  }

  // Cached noise: white, pink (softer, natural) or brown (rumble)
  noiseBuffer(kind) {
    if (this.noise[kind]) return this.noise[kind];
    const rate = this.ctx.sampleRate;
    const length = rate * 3;
    const buffer = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        if (kind === 'pink') {
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.969 * b2 + white * 0.153852;
          b3 = 0.8665 * b3 + white * 0.3104856;
          b4 = 0.55 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
          b6 = white * 0.115926;
        } else if (kind === 'brown') {
          last = (last + 0.02 * white) / 1.02;
          d[i] = last * 3.5;
        } else {
          d[i] = white;
        }
      }
    }
    this.noise[kind] = buffer;
    return buffer;
  }

  noiseSource(kind, loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(kind);
    src.loop = loop;
    if (loop) src.loopStart = Math.random();
    return src;
  }

  osc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  gain(value = 0) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  // Route a voice to the bus, panned, with some of it sent to the reverb
  out(node, { pan = 0, reverb = 0.15 } = {}) {
    let tail = node;
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      tail = p;
    }
    tail.connect(this.bus);
    if (reverb > 0) {
      const send = this.gain(reverb);
      tail.connect(send);
      send.connect(this.reverb);
    }
  }

  // Attack / decay envelope on a gain param, exponential so it sounds natural
  envelope(param, t, attack, peak, decay) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // Slow modulation source: an LFO scaled by depth, connected onto a param
  lfo(rate, depth, param, type = 'sine') {
    const o = this.osc(type, rate);
    const g = this.gain(depth);
    o.connect(g);
    g.connect(param);
    o.start();
    return { osc: o, depth: g };
  }

  ramp(param, value, time = 0.12) {
    param.setTargetAtTime(value, this.now, time / 3);
  }

  // ------------------------------------------------------------------------------------------
  // Continuous layers
  // Space-opera sound: nothing is clean. Engines roar and growl, drives howl, beams buzz.
  // ------------------------------------------------------------------------------------------

  // Sublight engines: a deep, throaty roar. A low saw pair gives the growl, brown noise the body,
  // a random flutter on the volume the grit, and a resonant jet scream rises in at high thrust.
  setupEngine() {
    const e = (this.engine = {});
    e.bus = this.gain(1);
    this.out(e.bus, { reverb: 0.08 });

    // grit: slowly wandering noise modulating the roar's volume
    e.grit = this.gain(1);
    const flutter = this.noiseSource('brown', true);
    const flutterLp = this.filter('lowpass', 28, 0.5);
    e.flutterDepth = this.gain(0.25);
    flutter.connect(flutterLp).connect(e.flutterDepth).connect(e.grit.gain);
    flutter.start();
    e.grit.connect(e.bus);

    e.growl1 = this.osc('sawtooth', 38);
    e.growl2 = this.osc('sawtooth', 38);
    e.growl2.detune.value = 22;
    e.growlFilter = this.filter('lowpass', 140, 2.5);
    e.growlGain = this.gain(0.04);
    e.growl1.connect(e.growlFilter);
    e.growl2.connect(e.growlFilter);
    e.growlFilter.connect(e.growlGain).connect(e.grit);

    e.sub = this.osc('sine', 38);
    e.subGain = this.gain(0.03);
    e.sub.connect(e.subGain).connect(e.bus);

    e.roar = this.noiseSource('brown', true);
    e.roarFilter = this.filter('lowpass', 220, 0.8);
    e.roarGain = this.gain(0.035);
    e.roar.connect(e.roarFilter).connect(e.roarGain).connect(e.grit);

    e.scream = this.noiseSource('pink', true);
    e.screamFilter = this.filter('bandpass', 900, 5);
    e.screamGain = this.gain(0);
    e.scream.connect(e.screamFilter).connect(e.screamGain).connect(e.bus);

    [e.growl1, e.growl2, e.sub, e.roar, e.scream].forEach((n) => n.start());
  }

  setThrottle(value) {
    if (!this.initialized) return;
    const v = Math.max(0, Math.min(1, value));
    const e = this.engine;
    const t = 0.3;
    this.ramp(e.growl1.frequency, 38 + v * 34, t);
    this.ramp(e.growl2.frequency, 38 + v * 34, t);
    this.ramp(e.sub.frequency, 38 + v * 20, t);
    this.ramp(e.growlFilter.frequency, 140 + v * 700, t);
    this.ramp(e.growlGain.gain, 0.04 + v * 0.08, t);
    this.ramp(e.subGain.gain, 0.03 + v * 0.06, t);
    this.ramp(e.roarFilter.frequency, 220 + v * 900, t);
    this.ramp(e.roarGain.gain, 0.035 + v * 0.22, t);
    this.ramp(e.flutterDepth.gain, 0.25 + v * 0.35, t);
    this.ramp(e.screamFilter.frequency, 900 + v * 1700, t * 1.5);
    this.ramp(e.screamGain.gain, v * v * 0.09, t);
  }

  // Hyperspace: a howling tunnel of wind, two resonant noise bands sweeping past each other,
  // over a low phasing drone and a thin motivator whine
  setupWarp() {
    const w = (this.warp = {});
    w.out = this.gain(0);
    this.out(w.out, { reverb: 0.4 });

    w.bands = [[420, 0.13, 7], [1300, 0.21, 9]].map(([freq, rate, q]) => {
      const src = this.noiseSource('pink', true);
      const bp = this.filter('bandpass', freq, q);
      const sweep = this.lfo(rate, freq * 0.55, bp.frequency);
      const g = this.gain(0.5);
      src.connect(bp).connect(g).connect(w.out);
      src.start();
      return { bp, sweep, base: freq };
    });

    w.droneFilter = this.filter('lowpass', 260, 3);
    w.drone = [[49, 0], [49, 17], [73.5, -9]].map(([f, d]) => {
      const o = this.osc('sawtooth', f);
      o.detune.value = d;
      o.connect(w.droneFilter);
      o.start();
      return o;
    });
    w.droneGain = this.gain(0.35);
    w.droneFilter.connect(w.droneGain).connect(w.out);

    w.whine = this.osc('sine', 1800);
    this.lfo(7, 25, w.whine.frequency);
    w.whineGain = this.gain(0.012);
    w.whine.connect(w.whineGain).connect(w.out);
    w.whine.start();
  }

  setWarp(active) {
    if (!this.initialized) return;
    const w = this.warp;
    const t = this.now;
    const lift = active ? 1.3 : 1;
    w.drone.forEach((o, i) => {
      o.frequency.cancelScheduledValues(t);
      o.frequency.setTargetAtTime([49, 49, 73.5][i] * lift, t, active ? 0.8 : 0.25);
    });
    w.bands.forEach((b) => {
      b.bp.frequency.cancelScheduledValues(t);
      b.bp.frequency.setTargetAtTime(b.base * (active ? 1.6 : 1), t, 1.2);
    });
    w.whine.frequency.cancelScheduledValues(t);
    w.whine.frequency.setTargetAtTime(active ? 2600 : 1800, t, 1.0);
    w.out.gain.cancelScheduledValues(t);
    w.out.gain.setTargetAtTime(active ? 0.16 : 0, t, active ? 0.35 : 0.15);
    // the drive takes over from the sublight engines
    this.ramp(this.engine.bus.gain, active ? 0.4 : 1, 0.6);
  }

  // Cabin: a quiet low hum of systems and air handling, so silence never sounds dead
  setupAmbience() {
    const a = (this.ambience = {});
    a.out = this.gain(0.018);
    this.out(a.out, { reverb: 0.5 });
    a.filter = this.filter('lowpass', 380, 0.6);
    this.lfo(0.05, 140, a.filter.frequency);
    a.filter.connect(a.out);
    [[60, 0], [120, 6], [180, -5]].forEach(([f, d]) => {
      const o = this.osc('sine', f);
      o.detune.value = d;
      o.connect(a.filter);
      o.start();
    });
    a.room = this.noiseSource('pink', true);
    a.roomFilter = this.filter('bandpass', 300, 0.5);
    a.roomGain = this.gain(0.014);
    a.room.connect(a.roomFilter).connect(a.roomGain).connect(this.bus);
    a.room.start();
  }

  // Tractor beam: the buzzing hum of an energy blade, two close saws beating against each
  // other, a resonant edge and a faint feedback whine, breathing slowly
  setupTractor() {
    const b = (this.tractor = {});
    b.out = this.gain(0);
    this.out(b.out, { reverb: 0.3 });
    b.swell = this.gain(0.8);
    this.lfo(0.7, 0.2, b.swell.gain);
    b.swell.connect(b.out);

    b.filter = this.filter('lowpass', 700, 3);
    this.lfo(0.45, 120, b.filter.frequency);
    b.filter.connect(b.swell);
    b.hum = [[88, 0], [90.5, 0], [176, 7]].map(([f, d]) => {
      const o = this.osc('sawtooth', f);
      o.detune.value = d;
      o.connect(b.filter);
      o.start();
      return o;
    });
    b.whine = this.osc('sine', 1180);
    this.lfo(0.45, 9, b.whine.frequency);
    const wg = this.gain(0.04);
    b.whine.connect(wg).connect(b.swell);
    b.whine.start();
  }

  setTractorBeam(active) {
    if (!this.initialized || active === this.tractorOn) return;
    this.tractorOn = active;
    const t = this.now;
    // the blade ignites with a quick upward sweep and dies with a fall
    this.tractor.hum.forEach((o, i) => {
      const base = [88, 90.5, 176][i];
      o.frequency.cancelScheduledValues(t);
      o.frequency.setValueAtTime(base * (active ? 0.6 : 1), t);
      o.frequency.exponentialRampToValueAtTime(base * (active ? 1 : 0.55), t + (active ? 0.25 : 0.3));
    });
    this.ramp(this.tractor.out.gain, active ? 0.17 : 0, active ? 0.12 : 0.3);
  }

  // ------------------------------------------------------------------------------------------
  // One-shots
  // ------------------------------------------------------------------------------------------

  // A little droid voice: a few quick whistled notes, glides and a trill, different every time
  droidChirp(t, { notes = 4, low = 1100, high = 2600, step = 0.035, level = 0.11, rising = 0, pan = 0 } = {}) {
    const o = this.osc('sine', low);
    const vib = this.lfo(28, 0, o.frequency);
    const g = this.gain();
    let at = t;
    for (let i = 0; i < notes; i++) {
      const bias = rising ? (rising > 0 ? i / Math.max(1, notes - 1) : 1 - i / Math.max(1, notes - 1)) : Math.random();
      const f = low + (high - low) * (0.15 + 0.85 * (rising ? bias * 0.8 + Math.random() * 0.2 : bias));
      if (Math.random() < 0.5) o.frequency.setValueAtTime(f, at);
      else o.frequency.exponentialRampToValueAtTime(f, at + step * 0.8);
      at += step * (0.7 + Math.random() * 0.6);
    }
    // a trill on the last note
    vib.depth.gain.setValueAtTime(0, t);
    vib.depth.gain.setValueAtTime(Math.random() < 0.6 ? 90 : 0, at - step);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.008);
    g.gain.setValueAtTime(level, at - 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    o.connect(g);
    this.out(g, { pan, reverb: 0.12 });
    o.start(t);
    o.stop(at + 0.08);
    vib.osc.stop(at + 0.08);
  }

  playBeep() {
    if (!this.initialized || this.muted) return;
    this.droidChirp(this.now, { notes: 2 + Math.floor(Math.random() * 2), step: 0.03, level: 0.12 });
  }

  // Blasters: the struck-cable "pew". A few metallic partials fall in pitch at slightly different
  // speeds (the dispersion that makes it sing), FM adds the steel ring, a click gives the snap.
  playLaserFire() {
    if (!this.initialized || this.muted) return;
    const t0 = this.now;
    [-1, 1].forEach((side, i) => {
      const t = t0 + i * 0.04;
      const pan = side * 0.5;
      const pitch = 1 + (Math.random() - 0.5) * 0.08;
      const voice = this.gain(1);
      this.out(voice, { pan, reverb: 0.22 });

      // dispersive partials: higher ones drop faster
      [[1, 0.2, 0.16], [1.52, 0.15, 0.08], [2.31, 0.11, 0.045]].forEach(([ratio, fall, level]) => {
        const f0 = 2400 * pitch * ratio;
        const o = this.osc('sine', f0);
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.085, t + fall);
        // steel ring: an inharmonic modulator whose depth dies quickly
        const mod = this.osc('sine', f0 * 1.41);
        mod.frequency.setValueAtTime(f0 * 1.41, t);
        mod.frequency.exponentialRampToValueAtTime(f0 * 0.12, t + fall);
        const modDepth = this.gain(0);
        modDepth.gain.setValueAtTime(f0 * 0.6, t);
        modDepth.gain.exponentialRampToValueAtTime(1, t + fall * 0.7);
        mod.connect(modDepth).connect(o.frequency);
        const g = this.gain();
        this.envelope(g.gain, t, 0.0015, level, fall + 0.05);
        o.connect(g).connect(voice);
        o.start(t);
        mod.start(t);
        o.stop(t + fall + 0.08);
        mod.stop(t + fall + 0.08);
      });

      const click = this.noiseSource('white');
      const clickHp = this.filter('highpass', 3000, 0.7);
      const clickGain = this.gain();
      this.envelope(clickGain.gain, t, 0.0008, 0.14, 0.018);
      click.connect(clickHp).connect(clickGain).connect(voice);
      click.start(t, Math.random());
      click.stop(t + 0.03);
    });
  }

  // Autopilot engaged: a cheerful rising droid warble. Released or refused: a falling, glum whistle.
  playAutopilotAlert(engaged) {
    if (!this.initialized || this.muted) return;
    const t = this.now;
    if (engaged) {
      this.droidChirp(t, { notes: 5, low: 900, high: 2800, step: 0.045, level: 0.12, rising: 1 });
    } else {
      const o = this.osc('sine', 1500);
      o.frequency.setValueAtTime(1500, t);
      o.frequency.exponentialRampToValueAtTime(1650, t + 0.05);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.42);
      this.lfo(9, 30, o.frequency).osc.stop(t + 0.5);
      const g = this.gain();
      this.envelope(g.gain, t, 0.01, 0.1, 0.42);
      o.connect(g);
      this.out(g, { reverb: 0.2 });
      o.start(t);
      o.stop(t + 0.5);
    }
  }

  // Hyperspace jump: the charging saw sweep and its pop (the reference sound), with the
  // drive's whine screaming up beside it, then a dopplered rush and a deep "thoom" as the ship goes
  playWarpJump() {
    if (!this.initialized || this.muted) return;
    const now = this.now;

    const sweepGain = this.gain();
    sweepGain.gain.setValueAtTime(0.16, now);
    sweepGain.gain.setValueAtTime(0.24, now + 0.3);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    const filter = this.filter('lowpass', 400, 1.5);
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(3200, now + 0.35);
    filter.frequency.exponentialRampToValueAtTime(500, now + 0.8);
    [0, 12].forEach((detune) => {
      const o = this.osc('sawtooth', 80);
      o.detune.value = detune;
      o.frequency.setValueAtTime(80, now);
      o.frequency.exponentialRampToValueAtTime(1400, now + 0.35);
      o.frequency.setValueAtTime(50, now + 0.35);
      o.connect(filter);
      o.start(now);
      o.stop(now + 0.82);
    });
    filter.connect(sweepGain);
    this.out(sweepGain, { reverb: 0.3 });

    // motivator whine screaming up with the charge
    const whine = this.osc('sine', 500);
    whine.frequency.setValueAtTime(500, now);
    whine.frequency.exponentialRampToValueAtTime(3400, now + 0.34);
    this.lfo(14, 40, whine.frequency).osc.stop(now + 0.4);
    const whineGain = this.gain();
    whineGain.gain.setValueAtTime(0.0001, now);
    whineGain.gain.exponentialRampToValueAtTime(0.07, now + 0.3);
    whineGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    whine.connect(whineGain);
    this.out(whineGain, { reverb: 0.3 });
    whine.start(now);
    whine.stop(now + 0.42);

    // the rush past, falling in pitch like something flying away
    const rush = this.noiseSource('pink');
    const rushBp = this.filter('bandpass', 600, 1.4);
    rushBp.frequency.setValueAtTime(600, now);
    rushBp.frequency.exponentialRampToValueAtTime(5200, now + 0.36);
    rushBp.frequency.exponentialRampToValueAtTime(260, now + 1.3);
    const rushGain = this.gain();
    rushGain.gain.setValueAtTime(0.0001, now);
    rushGain.gain.exponentialRampToValueAtTime(0.38, now + 0.36);
    rushGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    rush.connect(rushBp).connect(rushGain);
    this.out(rushGain, { reverb: 0.4 });
    rush.start(now);
    rush.stop(now + 1.35);

    // thoom
    const boom = this.osc('sine', 110);
    boom.frequency.setValueAtTime(110, now + 0.35);
    boom.frequency.exponentialRampToValueAtTime(26, now + 1.3);
    const boomGain = this.gain();
    this.envelope(boomGain.gain, now + 0.35, 0.012, 0.5, 1.1);
    boom.connect(boomGain);
    this.out(boomGain, { reverb: 0.5 });
    boom.start(now + 0.34);
    boom.stop(now + 1.5);
  }

  // A big space-opera blast: crack, a deep double boom, roaring debris cloud, crackle,
  // and a metallic ring dying away in a long tail
  playShipExplosion() {
    if (!this.initialized || this.muted) return;
    const t = this.now;

    const crack = this.noiseSource('white');
    const crackHp = this.filter('highpass', 1500, 0.7);
    const crackGain = this.gain();
    this.envelope(crackGain.gain, t, 0.001, 0.55, 0.14);
    crack.connect(crackHp).connect(crackGain);
    this.out(crackGain, { reverb: 0.5 });
    crack.start(t);
    crack.stop(t + 0.2);

    [[0, 85, 0.75], [0.22, 60, 0.5]].forEach(([delay, f, level]) => {
      const boom = this.osc('sine', f);
      boom.frequency.setValueAtTime(f, t + delay);
      boom.frequency.exponentialRampToValueAtTime(18, t + delay + 1.6);
      const g = this.gain();
      this.envelope(g.gain, t + delay, 0.006, level, 1.6);
      boom.connect(g);
      this.out(g, { reverb: 0.4 });
      boom.start(t + delay);
      boom.stop(t + delay + 1.7);
    });

    const roar = this.noiseSource('brown');
    const roarLp = this.filter('lowpass', 2200, 0.9);
    roarLp.frequency.setValueAtTime(2200, t);
    roarLp.frequency.exponentialRampToValueAtTime(70, t + 3.2);
    const roarGain = this.gain();
    this.envelope(roarGain.gain, t, 0.01, 1.0, 3.2);
    roar.connect(roarLp).connect(roarGain);
    this.out(roarGain, { reverb: 0.6 });
    roar.start(t);
    roar.stop(t + 3.3);

    // ringing hull: inharmonic partials, like struck sheet metal
    [173, 287, 411, 563].forEach((f, i) => {
      const o = this.osc('sine', f);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.92, t + 2.5);
      const g = this.gain();
      this.envelope(g.gain, t + 0.02, 0.004, 0.03 / (i + 1), 2.4);
      o.connect(g);
      this.out(g, { pan: (i % 2 ? 1 : -1) * 0.3, reverb: 0.6 });
      o.start(t);
      o.stop(t + 2.6);
    });

    for (let i = 0; i < 30; i++) {
      const at = t + 0.05 + Math.pow(Math.random(), 1.5) * 2.0;
      const grain = this.noiseSource('white');
      const bp = this.filter('bandpass', 700 + Math.random() * 4000, 2);
      const g = this.gain();
      this.envelope(g.gain, at, 0.001, 0.05 + Math.random() * 0.1, 0.03 + Math.random() * 0.07);
      grain.connect(bp).connect(g);
      this.out(g, { pan: Math.random() * 1.6 - 0.8, reverb: 0.4 });
      grain.start(at, Math.random() * 2);
      grain.stop(at + 0.14);
    }
  }

  setMute(muted) {
    this.muted = muted;
    if (!this.initialized) return;
    if (this.ctx.state === 'suspended' && !muted) this.ctx.resume();
    this.masterGain.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.now, 0.04);
  }
}

export const spaceAudio = new SpaceAudio();
