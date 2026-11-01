// Procedural sound for the cockpit, all synthesized with the Web Audio API (no sample files).
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
  // ------------------------------------------------------------------------------------------

  // Ion drive: sub thump, a detuned reactor core, a turbine whine with a little wobble,
  // brown-noise rumble from the hull and pink-noise exhaust that opens up with thrust
  setupEngine() {
    const e = (this.engine = {});
    e.bus = this.gain(1);
    this.out(e.bus, { reverb: 0.06 });

    e.sub = this.osc('sine', 46);
    e.subGain = this.gain(0.03);
    e.sub.connect(e.subGain).connect(e.bus);

    e.core1 = this.osc('sawtooth', 48);
    e.core2 = this.osc('sawtooth', 48);
    e.core2.detune.value = 14;
    e.coreFilter = this.filter('lowpass', 150, 1.2);
    e.coreGain = this.gain(0.03);
    e.core1.connect(e.coreFilter);
    e.core2.connect(e.coreFilter);
    e.coreFilter.connect(e.coreGain).connect(e.bus);

    e.whine = this.osc('sine', 400);
    e.whineGain = this.gain(0.004);
    this.lfo(5.3, 5, e.whine.frequency);
    e.whine.connect(e.whineGain).connect(e.bus);

    e.rumble = this.noiseSource('brown', true);
    e.rumbleFilter = this.filter('lowpass', 160, 0.9);
    e.rumbleGain = this.gain(0.03);
    e.rumble.connect(e.rumbleFilter).connect(e.rumbleGain).connect(e.bus);

    e.hiss = this.noiseSource('pink', true);
    e.hissFilter = this.filter('bandpass', 500, 0.8);
    e.hissGain = this.gain(0);
    e.hiss.connect(e.hissFilter).connect(e.hissGain).connect(e.bus);

    [e.sub, e.core1, e.core2, e.whine, e.rumble, e.hiss].forEach((n) => n.start());
  }

  setThrottle(value) {
    if (!this.initialized) return;
    const v = Math.max(0, Math.min(1, value));
    const e = this.engine;
    const t = 0.25;
    this.ramp(e.sub.frequency, 44 + v * 16, t);
    this.ramp(e.subGain.gain, 0.03 + v * 0.06, t);
    this.ramp(e.core1.frequency, 48 + v * 32, t);
    this.ramp(e.core2.frequency, 48 + v * 32, t);
    this.ramp(e.coreFilter.frequency, 150 + v * 1100, t);
    this.ramp(e.coreGain.gain, 0.03 + v * 0.07, t);
    this.ramp(e.whine.frequency, 380 + v * 760, t * 1.6);
    this.ramp(e.whineGain.gain, 0.004 + v * 0.018, t);
    this.ramp(e.rumbleFilter.frequency, 160 + v * 320, t);
    this.ramp(e.rumbleGain.gain, 0.03 + v * 0.2, t);
    this.ramp(e.hissFilter.frequency, 500 + v * 2000, t);
    this.ramp(e.hissGain.gain, v * 0.12, t);
  }

  // Autopilot cruise: a hyperdrive drone that spools up — fifths of detuned saws through a slowly
  // sweeping resonant filter, a throb, and a high shimmer of filtered noise
  setupWarp() {
    const w = (this.warp = {});
    w.out = this.gain(0);
    this.out(w.out, { reverb: 0.3 });

    w.throb = this.gain(0.8);
    this.lfo(2.1, 0.2, w.throb.gain);
    w.throb.connect(w.out);

    w.filter = this.filter('lowpass', 300, 5);
    w.sweep = this.lfo(0.3, 180, w.filter.frequency);
    w.filter.connect(w.throb);

    w.oscs = [[55, 0], [55, 9], [82.5, -6], [110, 4]].map(([f, detune]) => {
      const o = this.osc('sawtooth', f);
      o.detune.value = detune;
      o.connect(w.filter);
      o.start();
      return o;
    });

    w.shimmer = this.noiseSource('white', true);
    w.shimmerFilter = this.filter('bandpass', 3200, 6);
    w.shimmerGain = this.gain(0.05);
    this.lfo(5.5, 0.03, w.shimmerGain.gain);
    w.shimmer.connect(w.shimmerFilter).connect(w.shimmerGain).connect(w.out);
    w.shimmer.start();
  }

  setWarp(active) {
    if (!this.initialized) return;
    const w = this.warp;
    const t = this.now;
    const pitch = active ? 1.33 : 1;
    w.oscs.forEach((o, i) => {
      const base = [55, 55, 82.5, 110][i];
      o.frequency.cancelScheduledValues(t);
      o.frequency.setTargetAtTime(base * pitch, t, active ? 0.7 : 0.25);
    });
    w.filter.frequency.cancelScheduledValues(t);
    w.filter.frequency.setTargetAtTime(active ? 1100 : 300, t, active ? 0.9 : 0.2);
    w.out.gain.cancelScheduledValues(t);
    w.out.gain.setTargetAtTime(active ? 0.13 : 0, t, active ? 0.25 : 0.15);
    // the drive takes over from the thrusters
    this.ramp(this.engine.bus.gain, active ? 0.45 : 1, 0.6);
  }

  // Cabin ambience: a quiet, slowly breathing pad and air-handling room tone
  setupAmbience() {
    const a = (this.ambience = {});
    a.out = this.gain(0.02);
    this.out(a.out, { reverb: 0.5 });
    a.filter = this.filter('lowpass', 420, 0.6);
    this.lfo(0.04, 160, a.filter.frequency);
    a.filter.connect(a.out);
    [[73.42, 0], [110, 5], [146.83, -7], [73.42, 11]].forEach(([f, d]) => {
      const o = this.osc('sine', f);
      o.detune.value = d;
      o.connect(a.filter);
      o.start();
    });
    a.room = this.noiseSource('pink', true);
    a.roomFilter = this.filter('bandpass', 260, 0.5);
    a.roomGain = this.gain(0.015);
    a.room.connect(a.roomFilter).connect(a.roomGain).connect(this.bus);
    a.room.start();
  }

  // Tractor beam: a pulsing, resonant hum; the pulse comes from LFOs, not per-frame code
  setupTractor() {
    const b = (this.tractor = {});
    b.out = this.gain(0);
    this.out(b.out, { reverb: 0.25 });
    b.pulse = this.gain(0.7);
    this.lfo(7, 0.3, b.pulse.gain);
    b.pulse.connect(b.out);
    b.filter = this.filter('bandpass', 420, 6);
    this.lfo(0.8, 160, b.filter.frequency);
    b.filter.connect(b.pulse);
    b.osc1 = this.osc('sawtooth', 130);
    b.osc2 = this.osc('sawtooth', 195);
    b.osc2.detune.value = 8;
    this.lfo(0.8, 12, b.osc1.frequency);
    b.osc1.connect(b.filter);
    b.osc2.connect(b.filter);
    b.osc1.start();
    b.osc2.start();
  }

  setTractorBeam(active) {
    if (!this.initialized || active === this.tractorOn) return;
    this.tractorOn = active;
    this.ramp(this.tractor.out.gain, active ? 0.24 : 0, active ? 0.15 : 0.25);
  }

  // ------------------------------------------------------------------------------------------
  // One-shots
  // ------------------------------------------------------------------------------------------

  // Console blip: a clean tone with a quiet octave, very short
  playBeep() {
    if (!this.initialized || this.muted) return;
    const t = this.now;
    const g = this.gain();
    this.envelope(g.gain, t, 0.004, 0.13, 0.11);
    [[1318.5, 1], [2637, 0.22]].forEach(([f, level]) => {
      const o = this.osc('sine', f);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.94, t + 0.1);
      const lg = this.gain(level);
      o.connect(lg).connect(g);
      o.start(t);
      o.stop(t + 0.16);
    });
    this.out(g, { reverb: 0.12 });
  }

  // Twin wingtip guns, left then right: a noise click, a falling resonant zap and a short body
  playLaserFire() {
    if (!this.initialized || this.muted) return;
    const t0 = this.now;
    [-1, 1].forEach((side, i) => {
      const t = t0 + i * 0.035;
      const pan = side * 0.45;
      const wobble = 1 + (Math.random() - 0.5) * 0.06;

      const click = this.noiseSource('white');
      const clickHp = this.filter('highpass', 2500, 0.7);
      const clickGain = this.gain();
      this.envelope(clickGain.gain, t, 0.001, 0.2, 0.03);
      click.connect(clickHp).connect(clickGain);
      this.out(clickGain, { pan, reverb: 0.05 });
      click.start(t, Math.random());
      click.stop(t + 0.05);

      const zap = this.osc('square', 1700 * wobble);
      zap.frequency.setValueAtTime(1700 * wobble, t);
      zap.frequency.exponentialRampToValueAtTime(170, t + 0.17);
      const zapBp = this.filter('bandpass', 2600, 3.5);
      zapBp.frequency.setValueAtTime(2600, t);
      zapBp.frequency.exponentialRampToValueAtTime(450, t + 0.17);
      const zapGain = this.gain();
      this.envelope(zapGain.gain, t, 0.002, 0.38, 0.19);
      zap.connect(zapBp).connect(zapGain);
      this.out(zapGain, { pan, reverb: 0.16 });
      zap.start(t);
      zap.stop(t + 0.22);

      const body = this.osc('sawtooth', 420 * wobble);
      body.frequency.setValueAtTime(420 * wobble, t);
      body.frequency.exponentialRampToValueAtTime(70, t + 0.12);
      const bodyLp = this.filter('lowpass', 900, 1);
      const bodyGain = this.gain();
      this.envelope(bodyGain.gain, t, 0.002, 0.15, 0.12);
      body.connect(bodyLp).connect(bodyGain);
      this.out(bodyGain, { pan: pan * 0.5, reverb: 0.08 });
      body.start(t);
      body.stop(t + 0.15);
    });
  }

  // Engaged: a bright rising two-note chime. Released or refused: a soft falling two-tone.
  playAutopilotAlert(engaged) {
    if (!this.initialized || this.muted) return;
    const t = this.now;
    if (engaged) {
      [[659.25, 0], [987.77, 0.075]].forEach(([f, delay]) => {
        const g = this.gain();
        this.envelope(g.gain, t + delay, 0.006, 0.14, 0.38);
        [['triangle', f, 1], ['sine', f * 2, 0.3]].forEach(([type, freq, level]) => {
          const o = this.osc(type, freq);
          const lg = this.gain(level);
          o.connect(lg).connect(g);
          o.start(t + delay);
          o.stop(t + delay + 0.45);
        });
        this.out(g, { reverb: 0.3 });
      });
    } else {
      [[392, 0], [261.63, 0.09]].forEach(([f, delay]) => {
        const o = this.osc('square', f);
        const lp = this.filter('lowpass', 1100, 0.8);
        const g = this.gain();
        this.envelope(g.gain, t + delay, 0.005, 0.1, 0.16);
        o.connect(lp).connect(g);
        this.out(g, { reverb: 0.15 });
        o.start(t + delay);
        o.stop(t + delay + 0.2);
      });
    }
  }

  // Jump: the charging saw sweep and its pop, thickened by a detuned twin, an air rush that
  // swells with it, and a sub boom with a long tail when the ship goes
  playWarpJump() {
    if (!this.initialized || this.muted) return;
    const now = this.now;

    // the signature sweep
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

    // air rush rising into the jump
    const rush = this.noiseSource('pink');
    const rushBp = this.filter('bandpass', 300, 1.2);
    rushBp.frequency.setValueAtTime(300, now);
    rushBp.frequency.exponentialRampToValueAtTime(5000, now + 0.36);
    rushBp.frequency.exponentialRampToValueAtTime(400, now + 1.1);
    const rushGain = this.gain();
    rushGain.gain.setValueAtTime(0.0001, now);
    rushGain.gain.exponentialRampToValueAtTime(0.35, now + 0.34);
    rushGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    rush.connect(rushBp).connect(rushGain);
    this.out(rushGain, { reverb: 0.35 });
    rush.start(now);
    rush.stop(now + 1.15);

    // sub boom at the moment of the jump
    const boom = this.osc('sine', 140);
    boom.frequency.setValueAtTime(140, now + 0.35);
    boom.frequency.exponentialRampToValueAtTime(30, now + 1.0);
    const boomGain = this.gain();
    this.envelope(boomGain.gain, now + 0.35, 0.01, 0.4, 0.8);
    boom.connect(boomGain);
    this.out(boomGain, { reverb: 0.45 });
    boom.start(now + 0.34);
    boom.stop(now + 1.25);
  }

  // A crack, a roaring body of falling noise, a sub thump and crackling debris, in a long tail
  playShipExplosion() {
    if (!this.initialized || this.muted) return;
    const t = this.now;

    const crack = this.noiseSource('white');
    const crackHp = this.filter('highpass', 1200, 0.7);
    const crackGain = this.gain();
    this.envelope(crackGain.gain, t, 0.002, 0.5, 0.18);
    crack.connect(crackHp).connect(crackGain);
    this.out(crackGain, { reverb: 0.4 });
    crack.start(t);
    crack.stop(t + 0.25);

    const roar = this.noiseSource('brown');
    const roarLp = this.filter('lowpass', 1600, 0.9);
    roarLp.frequency.setValueAtTime(1600, t);
    roarLp.frequency.exponentialRampToValueAtTime(60, t + 2.6);
    const roarGain = this.gain();
    this.envelope(roarGain.gain, t, 0.01, 0.9, 2.6);
    roar.connect(roarLp).connect(roarGain);
    this.out(roarGain, { reverb: 0.5 });
    roar.start(t);
    roar.stop(t + 2.8);

    const thump = this.osc('sine', 95);
    thump.frequency.setValueAtTime(95, t);
    thump.frequency.exponentialRampToValueAtTime(24, t + 1.2);
    const thumpGain = this.gain();
    this.envelope(thumpGain.gain, t, 0.005, 0.7, 1.2);
    thump.connect(thumpGain);
    this.out(thumpGain, { reverb: 0.3 });
    thump.start(t);
    thump.stop(t + 1.3);

    // debris: short random grains, scattered across the stereo field
    for (let i = 0; i < 22; i++) {
      const at = t + 0.05 + Math.pow(Math.random(), 1.6) * 1.6;
      const grain = this.noiseSource('white');
      const bp = this.filter('bandpass', 800 + Math.random() * 3500, 2);
      const g = this.gain();
      this.envelope(g.gain, at, 0.001, 0.05 + Math.random() * 0.08, 0.03 + Math.random() * 0.06);
      grain.connect(bp).connect(g);
      this.out(g, { pan: Math.random() * 1.6 - 0.8, reverb: 0.35 });
      grain.start(at, Math.random() * 2);
      grain.stop(at + 0.12);
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
