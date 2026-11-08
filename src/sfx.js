import * as THREE from 'three';
import { spaceAudio as a } from './audio';

// Combat and world sounds, placed in space: louder when close, panned to where they happen relative to the nose.
// All synthesized on top of the primitives in audio.js and sent through its bus.

const REF = 90;      // full volume inside this distance
const CUTOFF = 1800; // silent beyond this
const v = new THREE.Vector3();
const inv = new THREE.Quaternion();

class SFX {
  constructor() {
    this.listener = null;
    this.lastNpcLaser = 0;
    this.lastHit = 0;
    this.alarm = null;
  }

  get ready() {
    return a.initialized && !a.muted;
  }

  // Volume and pan for a sound at a world position
  place(pos) {
    if (!this.listener) return { level: 1, pan: 0 };
    const d = pos.distanceTo(this.listener.position);
    if (d > CUTOFF) return null;
    const level = d < REF ? 1 : (REF / d) ** 1.1;
    inv.copy(this.listener.quaternion).invert();
    v.copy(pos).sub(this.listener.position).applyQuaternion(inv);
    const pan = d > 1 ? THREE.MathUtils.clamp(v.x / Math.max(d, 1), -0.9, 0.9) : 0;
    return { level, pan };
  }

  // Short pitched tone: frequency sweep with an exponential envelope
  tone(t, type, f0, f1, dur, level, opts = {}) {
    const o = a.osc(type, f0);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = a.gain();
    a.envelope(g.gain, t, opts.attack || 0.002, Math.max(0.0002, level), dur);
    o.connect(g);
    a.out(g, { pan: opts.pan || 0, reverb: opts.reverb ?? 0.12 });
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Burst of filtered noise
  burst(t, kind, ftype, freq, q, dur, level, opts = {}) {
    const n = a.noiseSource(kind);
    const f = a.filter(ftype, freq, q);
    if (opts.freqTo) {
      f.frequency.setValueAtTime(freq, t);
      f.frequency.exponentialRampToValueAtTime(opts.freqTo, t + dur);
    }
    const g = a.gain();
    a.envelope(g.gain, t, opts.attack || 0.002, Math.max(0.0002, level), dur);
    n.connect(f).connect(g);
    a.out(g, { pan: opts.pan || 0, reverb: opts.reverb ?? 0.15 });
    n.start(t, Math.random());
    n.stop(t + dur + 0.05);
  }

  // Each side's guns have their own voice: pirates bark low and dirty, police snap high and clean
  npcLaser(pos, faction) {
    if (!this.ready) return;
    const now = a.now;
    if (now - this.lastNpcLaser < 0.05) return;
    const place = this.place(pos);
    if (!place) return;
    this.lastNpcLaser = now;
    const f0 = faction === 'pirate' ? 900 : faction === 'police' ? 2100 : 1500;
    const type = faction === 'pirate' ? 'sawtooth' : 'triangle';
    this.tone(now, type, f0 * (0.92 + Math.random() * 0.16), f0 * 0.12, 0.16, 0.13 * place.level, { pan: place.pan, reverb: 0.25 });
  }

  // My shot connected
  hitConfirm(onHull) {
    if (!this.ready) return;
    const t = a.now;
    if (t - this.lastHit < 0.05) return;
    this.lastHit = t;
    if (onHull) {
      this.burst(t, 'white', 'bandpass', 1800, 2, 0.07, 0.16);
      this.tone(t, 'square', 320, 180, 0.07, 0.05);
    } else {
      this.tone(t, 'sine', 2600, 3800, 0.06, 0.05, { reverb: 0.05 });
    }
  }

  // Bolts hitting my shields: an electric crackle sweeping down. Hull: a metal bang inside the cabin.
  shieldHit(pan = 0) {
    if (!this.ready) return;
    const t = a.now;
    this.burst(t, 'white', 'bandpass', 3400, 3, 0.2, 0.34, { pan, freqTo: 700, reverb: 0.3 });
    this.tone(t, 'sawtooth', 480, 90, 0.22, 0.17, { pan, reverb: 0.25 });
  }

  hullHit(pan = 0) {
    if (!this.ready) return;
    const t = a.now;
    this.tone(t, 'sine', 150, 42, 0.36, 0.62, { pan, reverb: 0.3 });
    this.burst(t, 'brown', 'lowpass', 900, 0.7, 0.3, 0.6, { pan });
    this.tone(t, 'square', 620, 230, 0.14, 0.14, { pan, reverb: 0.5 });
    this.burst(t + 0.05, 'white', 'highpass', 5000, 0.7, 0.14, 0.09, { pan, reverb: 0.2 }); // sparks in the cockpit
  }

  explosionAt(pos, scale = 1) {
    if (!this.ready) return;
    const place = this.place(pos);
    if (!place) return;
    const t = a.now;
    const level = place.level * Math.min(1.1, 0.45 + scale * 0.35);
    this.tone(t, 'sine', 120, 26, 0.9 + scale * 0.3, 0.75 * level, { pan: place.pan, reverb: 0.5 });
    this.burst(t, 'brown', 'lowpass', 1400, 0.7, 0.9 + scale * 0.4, 0.95 * level, { pan: place.pan, freqTo: 180, reverb: 0.6 });
    this.burst(t, 'white', 'bandpass', 2400, 0.9, 0.22, 0.45 * level, { pan: place.pan, freqTo: 600, reverb: 0.4 });
  }

  missileLaunch(pos) {
    if (!this.ready) return;
    const place = pos ? this.place(pos) : { level: 1, pan: 0 };
    if (!place) return;
    const t = a.now;
    this.burst(t, 'white', 'bandpass', 900, 1.2, 0.9, 0.42 * place.level, { pan: place.pan, freqTo: 3400, reverb: 0.35, attack: 0.02 });
    this.tone(t, 'sawtooth', 110, 420, 0.65, 0.14 * place.level, { pan: place.pan, reverb: 0.3 });
  }

  // Pylon release: a mechanical clunk in the airframe
  missileRelease(pan = 0, pos = null) {
    if (!this.ready) return;
    const place = pos ? this.place(pos) : { level: 1, pan };
    if (!place) return;
    const t = a.now;
    this.tone(t, 'square', 180, 70, 0.12, 0.22 * place.level, { pan: place.pan, reverb: 0.2 });
    this.burst(t, 'white', 'bandpass', 900, 3, 0.05, 0.22 * place.level, { pan: place.pan });
    this.burst(t + 0.06, 'white', 'highpass', 3500, 0.7, 0.18, 0.06 * place.level, { pan: place.pan });
  }

  // Motor ignition: a crack, then a tearing roar that swells and fades as it pulls away
  missileIgnite(pos) {
    if (!this.ready) return;
    const place = this.place(pos);
    if (!place) return;
    const t = a.now;
    const l = place.level;
    this.burst(t, 'white', 'highpass', 1800, 0.7, 0.06, 0.4 * l, { pan: place.pan, reverb: 0.3 });
    this.burst(t, 'pink', 'bandpass', 700, 0.8, 2.4, 0.5 * l, { pan: place.pan, freqTo: 2600, reverb: 0.45, attack: 0.05 });
    this.burst(t, 'brown', 'lowpass', 500, 0.7, 1.8, 0.45 * l, { pan: place.pan, reverb: 0.3, attack: 0.03 });
    this.tone(t, 'sawtooth', 90, 260, 1.6, 0.07 * l, { pan: place.pan, reverb: 0.3, attack: 0.05 });
  }

  // Searching for lock: a tick that speeds up. Locked: a steady double tone.
  lockTick() {
    if (!this.ready) return;
    this.tone(a.now, 'square', 1250, 1250, 0.035, 0.05, { reverb: 0.03 });
  }

  lockOn() {
    if (!this.ready) return;
    const t = a.now;
    this.tone(t, 'square', 1850, 1850, 0.08, 0.075, { reverb: 0.03 });
    this.tone(t + 0.1, 'square', 1850, 1850, 0.08, 0.075, { reverb: 0.03 });
  }

  lockLost() {
    if (!this.ready) return;
    this.tone(a.now, 'square', 900, 500, 0.15, 0.05, { reverb: 0.05 });
  }

  // A missile is coming: a hard, fast warble
  missileAlarmTick() {
    if (!this.ready) return;
    const t = a.now;
    this.tone(t, 'square', 1700, 1000, 0.13, 0.14, { reverb: 0.03 });
    this.tone(t + 0.14, 'square', 1700, 1000, 0.13, 0.14, { reverb: 0.03 });
  }

  flare() {
    if (!this.ready) return;
    const t = a.now;
    this.burst(t, 'white', 'highpass', 2400, 0.8, 0.35, 0.22, { reverb: 0.3 });
    this.tone(t, 'sine', 900, 2800, 0.25, 0.05);
  }

  // Police siren: two falling yelps
  siren() {
    if (!this.ready) return;
    const t = a.now;
    [0, 0.42, 0.84].forEach((d) => {
      this.tone(t + d, 'sawtooth', 620, 1300, 0.2, 0.08, { reverb: 0.3, attack: 0.02 });
      this.tone(t + d + 0.2, 'sawtooth', 1300, 620, 0.2, 0.08, { reverb: 0.3, attack: 0.02 });
    });
  }

  klaxon() {
    if (!this.ready) return;
    const t = a.now;
    [0, 0.5].forEach((d) => this.tone(t + d, 'sawtooth', 240, 200, 0.4, 0.13, { reverb: 0.4, attack: 0.03 }));
  }

  // A pneumatic station door sliding open
  door() {
    if (!this.ready) return;
    const t = a.now;
    this.burst(t, 'white', 'bandpass', 700, 0.9, 0.32, 0.07, { reverb: 0.25, attack: 0.04 });
    this.tone(t, 'sine', 160, 90, 0.25, 0.05, { reverb: 0.2 });
  }

  squelch() {
    if (!this.ready) return;
    const t = a.now;
    this.burst(t, 'white', 'bandpass', 2200, 1.4, 0.11, 0.1, { reverb: 0.05 });
    this.tone(t + 0.11, 'sine', 1400, 1400, 0.05, 0.035, { reverb: 0.05 });
  }

  coin() {
    if (!this.ready) return;
    const t = a.now;
    [1319, 1760, 2637].forEach((f, i) => this.tone(t + i * 0.07, 'triangle', f, f, 0.22, 0.09, { reverb: 0.3 }));
  }

  pickup() {
    if (!this.ready) return;
    const t = a.now;
    this.tone(t, 'sine', 500, 1100, 0.14, 0.12, { reverb: 0.15 });
    this.burst(t, 'white', 'highpass', 3000, 0.7, 0.05, 0.05);
  }

  denied() {
    if (!this.ready) return;
    const t = a.now;
    this.tone(t, 'square', 210, 200, 0.14, 0.08);
    this.tone(t + 0.17, 'square', 170, 160, 0.2, 0.08);
  }

  dockClamp() {
    if (!this.ready) return;
    const t = a.now;
    this.tone(t, 'sine', 95, 40, 0.5, 0.45, { reverb: 0.5 });
    this.burst(t + 0.02, 'white', 'bandpass', 1500, 2, 0.12, 0.2, { reverb: 0.5 });
    this.burst(t + 0.28, 'white', 'highpass', 2500, 0.8, 0.5, 0.05, { reverb: 0.4, attack: 0.05 }); // pressure equalizing
  }

  warpBy(pos) {
    if (!this.ready) return;
    const place = this.place(pos);
    if (!place) return;
    const t = a.now;
    this.tone(t, 'sawtooth', 240, 1800, 0.25, 0.14 * place.level, { pan: place.pan, reverb: 0.5 });
    this.burst(t, 'pink', 'bandpass', 1200, 1, 0.5, 0.25 * place.level, { pan: place.pan, freqTo: 240, reverb: 0.5 });
  }

  crash() {
    if (!this.ready) return;
    const t = a.now;
    this.tone(t, 'sine', 90, 30, 0.6, 0.75, { reverb: 0.3 });
    this.burst(t, 'brown', 'lowpass', 1800, 0.7, 0.5, 0.75);
    this.burst(t, 'white', 'bandpass', 2200, 1.2, 0.3, 0.35, { reverb: 0.4 });
  }

  // One tick of the dosimeter: a dry click, a little random in pitch and side
  geigerClick() {
    if (!this.ready) return;
    const t = a.now;
    this.burst(t, 'white', 'highpass', 3200 + Math.random() * 2500, 0.8, 0.012, 0.09, { reverb: 0, pan: (Math.random() - 0.5) * 0.4 });
  }

  // Space weather alert: three rising chirps over a low hum
  radiationAlarm() {
    if (!this.ready) return;
    const t = a.now;
    [0, 0.28, 0.56].forEach((d) => this.tone(t + d, 'square', 880, 1320, 0.18, 0.05, { reverb: 0.3, attack: 0.01 }));
    this.tone(t, 'sawtooth', 110, 104, 0.9, 0.06, { reverb: 0.4, attack: 0.05 });
  }
}

export const sfx = new SFX();
