// Audio manager using Web Audio API for procedural space sound effects and ambient drone
class SpaceAudio {
  constructor() {
    this.ctx = null;
    this.muted = true;
    
    // Nodes
    this.masterGain = null;
    
    // Engine sound nodes (Futuristic Ion Core)
    this.engineOsc1 = null; // Low clean sine
    this.engineOsc2 = null; // Harmonic clean sine
    this.turbineOsc = null;  // High sci-fi whine (triangle)
    this.engineFilter = null;
    this.engineGain = null;
    
    // Thruster plasma noise nodes (white noise with sweeping bandpass)
    this.thrusterNoise = null;
    this.thrusterFilter = null;
    this.thrusterGain = null;
    
    // Warp/Autopilot hyper-cruise sound nodes
    this.warpOsc = null;
    this.warpGain = null;
    
    // Tractor beam sound nodes
    this.tractorOsc = null;
    this.tractorFilter = null;
    this.tractorGain = null;
    
    // Ambient drone nodes
    this.droneOsc1 = null;
    this.droneOsc2 = null;
    this.droneGain = null;
    
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
      
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.35, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      
      this.setupEngine();
      this.setupThrusters();
      this.setupWarp();
      this.setupAmbientDrone();
      this.setupTractor();
      
      this.initialized = true;
      console.log("Futuristic Space Audio Engine initialized.");
    } catch (e) {
      console.warn("Web Audio API not supported or blocked: ", e);
    }
  }

  setupEngine() {
    // Clean, futuristic Ion Reactor engine: sines + triangle turbine, low-pass filtered
    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc2 = this.ctx.createOscillator();
    this.turbineOsc = this.ctx.createOscillator();
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineGain = this.ctx.createGain();

    // Warm harmonics instead of buzzing sawtooths
    this.engineOsc1.type = 'sine';
    this.engineOsc1.frequency.setValueAtTime(110, this.ctx.currentTime); // A2 clean note

    this.engineOsc2.type = 'sine';
    this.engineOsc2.frequency.setValueAtTime(165, this.ctx.currentTime); // E3 (Fifth interval)

    this.turbineOsc.type = 'triangle';
    this.turbineOsc.frequency.setValueAtTime(180, this.ctx.currentTime); // High turbine base

    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(220, this.ctx.currentTime);
    this.engineFilter.Q.setValueAtTime(2.5, this.ctx.currentTime);

    this.engineGain.gain.setValueAtTime(0.06, this.ctx.currentTime); // Low baseline reactor hum

    // Connect
    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.turbineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    // Start oscillators
    this.engineOsc1.start(0);
    this.engineOsc2.start(0);
    this.turbineOsc.start(0);
  }

  setupThrusters() {
    // Generate white noise for thruster plasma hiss
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    this.thrusterNoise = this.ctx.createBufferSource();
    this.thrusterNoise.buffer = noiseBuffer;
    this.thrusterNoise.loop = true;

    // Resonant bandpass filter that sweeps up to sound like a jet thrusting plasma
    this.thrusterFilter = this.ctx.createBiquadFilter();
    this.thrusterFilter.type = 'bandpass';
    this.thrusterFilter.frequency.setValueAtTime(350, this.ctx.currentTime);
    this.thrusterFilter.Q.setValueAtTime(2.2, this.ctx.currentTime); // Highly resonant swept hiss

    this.thrusterGain = this.ctx.createGain();
    this.thrusterGain.gain.setValueAtTime(0, this.ctx.currentTime);

    this.thrusterNoise.connect(this.thrusterFilter);
    this.thrusterFilter.connect(this.thrusterGain);
    this.thrusterGain.connect(this.masterGain);

    this.thrusterNoise.start(0);
  }

  setupWarp() {
    // Warp/Autopilot cruise is a sweeping oscillator
    this.warpOsc = this.ctx.createOscillator();
    this.warpGain = this.ctx.createGain();

    this.warpOsc.type = 'sine';
    this.warpOsc.frequency.setValueAtTime(80, this.ctx.currentTime);

    this.warpGain.gain.setValueAtTime(0, this.ctx.currentTime);

    this.warpOsc.connect(this.warpGain);
    this.warpGain.connect(this.masterGain);

    this.warpOsc.start(0);
  }

  setupAmbientDrone() {
    // Relaxing background drone - two very low detuned sine waves
    this.droneOsc1 = this.ctx.createOscillator();
    this.droneOsc2 = this.ctx.createOscillator();
    this.droneGain = this.ctx.createGain();

    this.droneOsc1.type = 'sine';
    this.droneOsc1.frequency.setValueAtTime(73.42, this.ctx.currentTime); // D2

    this.droneOsc2.type = 'sine';
    this.droneOsc2.frequency.setValueAtTime(73.92, this.ctx.currentTime); // Slightly detuned

    this.droneGain.gain.setValueAtTime(0.06, this.ctx.currentTime); // Quiet background pad

    const droneFilter = this.ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.setValueAtTime(120, this.ctx.currentTime);

    this.droneOsc1.connect(droneFilter);
    this.droneOsc2.connect(droneFilter);
    droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.masterGain);

    this.droneOsc1.start(0);
    this.droneOsc2.start(0);
  }

  setThrottle(value) {
    if (!this.initialized) return;
    
    const now = this.ctx.currentTime;
    
    // Map throttle [0, 1] to clean reactor core sines + high turbine triangle whine
    const reactorFreq1 = 110 + (value * 90);    // 110Hz to 200Hz
    const reactorFreq2 = 165 + (value * 135);   // 165Hz to 300Hz
    const turbineFreq = 180 + (value * 500);    // 180Hz to 680Hz (crystalline energy whine)
    
    const volume = 0.06 + (value * 0.16); 
    const filterCutoff = 220 + (value * 1500);   // Opens filter wide to let the turbine whistle shine!
    
    this.engineOsc1.frequency.exponentialRampToValueAtTime(reactorFreq1, now + 0.12);
    this.engineOsc2.frequency.exponentialRampToValueAtTime(reactorFreq2, now + 0.12);
    this.turbineOsc.frequency.exponentialRampToValueAtTime(turbineFreq, now + 0.18);
    this.engineGain.gain.linearRampToValueAtTime(volume, now + 0.12);
    this.engineFilter.frequency.exponentialRampToValueAtTime(filterCutoff, now + 0.18);

    // Map throttle to plasma thruster noise: sweeps up from 350Hz to 1600Hz
    const thrusterVol = value * 0.22;
    const thrusterCutoff = 350 + (value * 1250);
    
    this.thrusterGain.gain.linearRampToValueAtTime(thrusterVol, now + 0.12);
    this.thrusterFilter.frequency.exponentialRampToValueAtTime(thrusterCutoff, now + 0.18);
  }

  setWarp(active) {
    if (!this.initialized) return;

    const now = this.ctx.currentTime;
    if (active) {
      // Ramp warp frequency up and increase volume
      this.warpOsc.frequency.setValueAtTime(80, now);
      this.warpOsc.frequency.exponentialRampToValueAtTime(660, now + 1.5); 
      this.warpGain.gain.linearRampToValueAtTime(0.35, now + 0.4);
      
      this.engineGain.gain.linearRampToValueAtTime(0.02, now + 0.4);
    } else {
      // Ramp down
      this.warpOsc.frequency.exponentialRampToValueAtTime(40, now + 0.5);
      this.warpGain.gain.linearRampToValueAtTime(0, now + 0.5);
    }
  }

  setupTractor() {
    this.tractorOsc = this.ctx.createOscillator();
    this.tractorGain = this.ctx.createGain();

    this.tractorOsc.type = 'sawtooth';
    this.tractorOsc.frequency.setValueAtTime(150, this.ctx.currentTime);

    this.tractorFilter = this.ctx.createBiquadFilter();
    this.tractorFilter.type = 'lowpass';
    this.tractorFilter.frequency.setValueAtTime(250, this.ctx.currentTime);
    this.tractorFilter.Q.setValueAtTime(4.0, this.ctx.currentTime);

    this.tractorGain.gain.setValueAtTime(0, this.ctx.currentTime);

    this.tractorOsc.connect(this.tractorFilter);
    this.tractorFilter.connect(this.tractorGain);
    this.tractorGain.connect(this.masterGain);

    this.tractorOsc.start(0);
  }

  setTractorBeam(active) {
    if (!this.initialized) return;

    const now = this.ctx.currentTime;
    if (active) {
      const modSpeed = Date.now() * 0.008;
      const freq = 130 + Math.sin(modSpeed) * 30;
      this.tractorOsc.frequency.setValueAtTime(freq, now);
      
      this.tractorGain.gain.linearRampToValueAtTime(0.18, now + 0.1);
      this.tractorFilter.frequency.setValueAtTime(250 + Math.sin(modSpeed) * 100, now);
    } else {
      this.tractorGain.gain.linearRampToValueAtTime(0, now + 0.15);
    }
  }

  playBeep() {
    if (!this.initialized || this.muted) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now); // A5 beep
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.12);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + 0.13);
  }

  playLaserFire() {
    if (!this.initialized || this.muted) return;

    const now = this.ctx.currentTime;
    
    for (let i = 0; i < 2; i++) {
      const delay = i * 0.05;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(700 - (i * 50), now + delay);
      osc.frequency.exponentialRampToValueAtTime(100, now + delay + 0.18);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, now + delay);
      filter.frequency.exponentialRampToValueAtTime(300, now + delay + 0.18);

      gain.gain.setValueAtTime(0.2, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.18);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now + delay);
      osc.stop(now + delay + 0.19);
    }
  }

  playAutopilotAlert(engaged) {
    if (!this.initialized || this.muted) return;

    const now = this.ctx.currentTime;
    
    if (engaged) {
      const b1 = this.ctx.createOscillator();
      const g1 = this.ctx.createGain();
      b1.type = 'sine';
      b1.frequency.setValueAtTime(660, now); // E5
      b1.frequency.setValueAtTime(880, now + 0.08); // A5
      g1.gain.setValueAtTime(0.15, now);
      g1.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
      b1.connect(g1);
      g1.connect(this.masterGain);
      b1.start(now);
      b1.stop(now + 0.2);
    } else {
      const b2 = this.ctx.createOscillator();
      const g2 = this.ctx.createGain();
      b2.type = 'sawtooth';
      b2.frequency.setValueAtTime(220, now); // A3
      b2.frequency.setValueAtTime(165, now + 0.08); // E3
      
      const f2 = this.ctx.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.setValueAtTime(300, now);
      
      g2.gain.setValueAtTime(0.12, now);
      g2.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      
      b2.connect(f2);
      f2.connect(g2);
      g2.connect(this.masterGain);
      b2.start(now);
      b2.stop(now + 0.22);
    }
  }

  playWarpJump() {
    if (!this.initialized || this.muted) return;

    const now = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(1400, now + 0.35);
    osc.frequency.setValueAtTime(50, now + 0.35); // warp pop pop
    
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(3000, now + 0.35);
    
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.setValueAtTime(0.28, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.75);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + 0.77);
  }

  playShipExplosion() {
    if (!this.initialized || this.muted) return;

    const now = this.ctx.currentTime;
    
    // Low-frequency rumble
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.linearRampToValueAtTime(10, now + 1.2);
    
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(250, now);
    filter.frequency.exponentialRampToValueAtTime(10, now + 1.2);
    
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(now);
    osc.stop(now + 1.25);

    // White noise explosion blast
    try {
      const bufferSize = this.ctx.sampleRate * 1.5;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      
      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(180, now);
      noiseFilter.frequency.exponentialRampToValueAtTime(20, now + 1.4);
      
      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.4, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 1.4);
      
      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      
      noiseSource.start(now);
      noiseSource.stop(now + 1.45);
    } catch (e) {
      console.warn("Noise buffer generation failed:", e);
    }
  }

  setMute(muted) {
    this.muted = muted;
    if (!this.initialized) return;

    const now = this.ctx.currentTime;
    if (muted) {
      this.masterGain.gain.linearRampToValueAtTime(0, now + 0.1);
    } else {
      this.masterGain.gain.linearRampToValueAtTime(0.35, now + 0.1);
    }
  }
}

export const spaceAudio = new SpaceAudio();
