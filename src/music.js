import { spaceAudio as a } from './audio';

// A generative score, synthesized live like everything else in here, so it never loops the same way twice.
// Two layers on the same chord progression, crossfaded by danger:
//   calm: slow choir-like pads and a lonely bell melody
//   combat: driving bass ostinato, war drums, brass stabs, high strings
// One step scheduler with a look-ahead, so it stays tight even if frames hitch.

const BPM = 96;
const STEP = 60 / BPM / 2; // eighth notes
const LOOKAHEAD = 0.25;

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// D minor world with a modal lift. Each chord lasts 16 steps; root plus chord tones in MIDI notes.
const CHORDS = [
  { root: 38, tones: [62, 65, 69] },     // Dm
  { root: 34, tones: [62, 65, 70] },     // Bb
  { root: 41, tones: [60, 65, 69] },     // F
  { root: 36, tones: [60, 64, 67] },     // C
  { root: 38, tones: [62, 65, 69] },     // Dm
  { root: 43, tones: [62, 67, 70] },     // Gm
  { root: 34, tones: [62, 65, 70] },     // Bb
  { root: 33, tones: [61, 64, 69] },     // A
];
const SCALE = [62, 64, 65, 67, 69, 70, 72, 74, 76, 77];
const OSTINATO = [0, 0, 12, 0, 0, 7, 0, 10, 0, 0, 12, 0, 7, 0, 10, 12];
const DRUMS = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0];

class Music {
  constructor() {
    this.started = false;
    this.enabled = true;
    this.volume = 0.8;
    this.step = 0;
    this.chord = 0;
    this.danger = 0;     // 0 calm .. 1 full combat
    this.dangerTarget = 0;
    this.nextTime = 0;
  }

  start() {
    if (this.started || !a.initialized) return;
    this.started = true;
    const ctx = a.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.calmBus = ctx.createGain();
    this.combatBus = ctx.createGain();
    this.calmBus.gain.value = 0.85;
    this.combatBus.gain.value = 0;
    this.calmBus.connect(this.master);
    this.combatBus.connect(this.master);
    // Duck under effects by joining the bus just before the compressor
    this.master.connect(a.compressor);
    this.send = ctx.createGain();
    this.send.gain.value = 0.55;
    this.send.connect(a.reverb);
    this.calmBus.connect(this.send);
    this.nextTime = ctx.currentTime + 0.3;
    this.chord = 0;
    this.step = 0;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, a.now, 0.2);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && this.enabled) this.master.gain.setTargetAtTime(v, a.now, 0.1);
  }

  // Called every frame with how much danger there is, 0..1
  update(dt, danger) {
    if (!this.started) return;
    this.dangerTarget = danger;
    // Fast to rise, slow to fall: the music stays tense after the last shot
    const rate = danger > this.danger ? 1.4 : 0.14;
    this.danger += (danger - this.danger) * Math.min(1, dt * rate);
    this.calmBus.gain.setTargetAtTime(0.85 * (1 - this.danger) ** 1.5 + 0.03, a.now, 0.4);
    this.combatBus.gain.setTargetAtTime(this.danger ** 1.3 * 0.95, a.now, 0.3);

    if (!this.enabled || a.muted || a.ctx.state !== 'running') {
      this.nextTime = a.ctx.currentTime + 0.1;
      return;
    }
    while (this.nextTime < a.ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.nextTime);
      this.nextTime += STEP;
      this.step++;
      if (this.step % 16 === 0) this.chord = (this.chord + 1) % CHORDS.length;
    }
  }

  voice(type, freq, t, dur, level, bus, { attack = 0.01, release = 0.1, filter = null, q = 0.7, detune = 0, glide = null } = {}) {
    const o = a.osc(type, freq);
    o.detune.value = detune;
    if (glide) {
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    }
    const g = a.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, level), t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (filter) {
      const f = a.filter('lowpass', filter, q);
      o.connect(f).connect(g);
    } else {
      o.connect(g);
    }
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  playStep(t) {
    const s = this.step % 16;
    const chord = CHORDS[this.chord];
    if (this.danger < 0.92) this.playCalm(t, s, chord);
    if (this.danger > 0.04) this.playCombat(t, s, chord);
  }

  // Choir-ish pad: two detuned saws through a soft filter, swelling over the whole bar. A bell now and then.
  playCalm(t, s, chord) {
    const bus = this.calmBus;
    if (s === 0) {
      const dur = STEP * 16 + 0.8;
      chord.tones.forEach((n, i) => {
        [-7, 7].forEach((det) => {
          this.voice('sawtooth', midi(n), t, dur, 0.024, bus, { attack: 2.2, release: 2.4, filter: 620 + i * 90, detune: det });
        });
      });
      this.voice('sine', midi(chord.root + 12), t, dur, 0.05, bus, { attack: 1.6, release: 2 });
    }
    if ((s === 4 || s === 10 || s === 14) && Math.random() < 0.28) {
      const n = SCALE[Math.floor(Math.random() * SCALE.length)] + 12;
      this.voice('sine', midi(n), t, 1.8, 0.05, bus, { attack: 0.005, release: 1.7 });
      this.voice('sine', midi(n) * 2.76, t, 0.5, 0.012, bus, { attack: 0.003, release: 0.45 });
    }
  }

  playCombat(t, s, chord) {
    const bus = this.combatBus;
    // Bass ostinato on every eighth
    const note = chord.root + OSTINATO[s];
    this.voice('sawtooth', midi(note), t, STEP * 0.85, 0.16, bus, { attack: 0.005, release: 0.05, filter: 520 + this.danger * 500, q: 3 });
    this.voice('sine', midi(chord.root - 12 + (s % 8 === 0 ? 0 : OSTINATO[s] >= 12 ? 12 : 0)), t, STEP * 0.85, 0.13, bus, { attack: 0.004, release: 0.05 });

    // War drums
    if (DRUMS[s]) {
      this.voice('sine', 86, t, 0.28, s % 8 === 0 ? 0.42 : 0.28, bus, { attack: 0.002, release: 0.22, glide: 40 });
      const n = a.noiseSource('white');
      const f = a.filter('bandpass', 700, 0.9);
      const g = a.gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      n.connect(f).connect(g).connect(bus);
      n.start(t, Math.random());
      n.stop(t + 0.11);
    }
    if (s === 4 || s === 12) {
      const n = a.noiseSource('white');
      const f = a.filter('highpass', 1600, 0.7);
      const g = a.gain(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      n.connect(f).connect(g).connect(bus);
      n.start(t, Math.random());
      n.stop(t + 0.17);
    }

    // Brass stabs on the downbeat of a bar and a pickup
    if (s === 0 || s === 11) {
      const dur = s === 0 ? STEP * 3 : STEP * 1.6;
      chord.tones.forEach((n) => {
        [-9, 9].forEach((det) => {
          this.voice('sawtooth', midi(n), t, dur, 0.05, bus, { attack: 0.03, release: 0.12, filter: 1500, q: 1.2, detune: det });
        });
      });
    }

    // Rising string figure in the back half of the progression's bars
    if (this.chord % 2 === 1 && s >= 8) {
      const n = chord.tones[(s - 8) % 3] + 12;
      this.voice('sawtooth', midi(n), t, STEP * 0.7, 0.024, bus, { attack: 0.01, release: 0.05, filter: 3000 });
    }
  }
}

export const music = new Music();
