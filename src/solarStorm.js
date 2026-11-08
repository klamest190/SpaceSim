import * as THREE from 'three';
import { sfx } from './sfx';
import { difficultyOf } from './difficulty';

// Solar storms. A flare lights up the Sun, then a cloud of fast protons and plasma (a coronal mass ejection) races
// outward as a growing shell. Where it passes, an unshielded ship soaks up radiation: shields first, then hull and
// electronics, closer to the Sun harder. Shelter is real physics: the shadow of a planet or moon, the magnetic field
// of Earth, Jupiter or Saturn, a thick atmosphere, a docking bay. The camera sensor shows the hits as snow and
// streaks, the dosimeter clicks. When the front reaches a planet with a magnetic field its aurorae flare up.

const FRONT_SPEED = 45;          // units per second outward from the Sun (Earth in about half a minute)
const FRONT_THICKNESS = 2700;    // the cloud takes about a minute to pass
const FIRST_STORM = [300, 540];  // seconds of flight before the first storm
const NEXT_STORM = [540, 960];   // and between storms
const FLARE_TIME = 4;
const AURORA_DECAY = 1 / 240;    // the aurorae calm down over about four minutes
// Reach of a magnetic field that keeps the storm out, in planet radii (at the drawn scale)
const MAGNETOSPHERES = { Earth: 4.0, Jupiter: 3.2, Saturn: 2.6 };
const AURORA_PLANETS = ['Earth', 'Jupiter', 'Saturn'];

const SHELL_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vNormal = normalize(mat3(modelMatrix) * position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;

// The cloud seen from afar, as a coronagraph sees one: a faint veil, bright only where we look along its skin,
// with a few loops and filaments in it. From inside it is all but invisible.
const SHELL_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uCam;
uniform float uFade;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  vec3 V = normalize(uCam - vWorld);
  float rim = 1.0 - abs(dot(vNormal, V));
  float edge = pow(rim, 6.0);
  vec3 n = vNormal * 5.0;
  float loops = 0.5 + 0.5 * sin(n.x * 3.1 + sin(n.y * 2.3 + uTime * 0.15) * 2.0) * sin(n.z * 2.7 + sin(n.x * 1.7) * 2.0);
  loops = pow(loops, 6.0);
  vec3 col = mix(vec3(1.0, 0.8, 0.6), vec3(0.8, 0.88, 1.0), loops);
  gl_FragColor = vec4(col * (edge * 0.38 + pow(rim, 2.5) * loops * 0.3) * uFade, 1.0);
}
`;

const rand = ([a, b]) => a + Math.random() * (b - a);

export class SolarStorm {
  constructor(game) {
    this.game = game;
    this.state = 'quiet';
    this.timer = rand(FIRST_STORM);
    this.front = 0;
    this.flareT = 0;
    this.klass = 1;
    this.rate = 0;          // radiation on the ship right now, 0..~2
    this.shelter = null;    // what keeps it off, while the storm is here
    this.wasHit = false;
    this.clickDebt = 0;
    this.aurora = {};
    AURORA_PLANETS.forEach((n) => { this.aurora[n] = 0; });
    this.reached = new Set();

    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 48),
      new THREE.ShaderMaterial({
        uniforms: { uCam: { value: new THREE.Vector3() }, uFade: { value: 0 }, uTime: { value: 0 } },
        vertexShader: SHELL_VERTEX,
        fragmentShader: SHELL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );
    this.shell.visible = false;
    this.shell.frustumCulled = false;
    this.shell.renderOrder = 6;
    game.scene.add(this.shell);

    this.sensor = document.getElementById('sensor-hits');
    this.sensorCtx = this.sensor ? this.sensor.getContext('2d') : null;
    this.alertEl = document.getElementById('hud-radiation');
    this.alertText = this.alertEl ? this.alertEl.querySelector('span') : null;
  }

  // Start a storm now (also for testing from the console: __game.storm.trigger())
  trigger() {
    this.state = 'flare';
    this.flareT = 0;
    this.front = this.game.solarSystem.planets[0].radius;
    this.klass = 1 + Math.floor(Math.random() * 9);
    this.reached.clear();
    this.wasHit = false;
    sfx.radiationAlarm();
    this.announce();
  }

  flying() {
    const g = this.game;
    return g.simRunning && !g.ship.isDocked && !g.ship.isDestroyed;
  }

  announce() {
    const g = this.game;
    if (!this.flying()) return;
    const dist = g.ship.position.length();
    const eta = Math.max(5, (dist - this.front) / FRONT_SPEED);
    const when = eta < 100 ? `in etwa ${Math.round(eta / 5) * 5} Sekunden` : `in etwa ${Math.max(2, Math.round(eta / 60))} Minuten, hier draußen schon schwächer`;
    g.comm.say(
      `Sonneneruption der Klasse X${this.klass}! Ein Teilchensturm rast nach außen und erreicht dich ${when}. ` +
      'Deckung: im Schatten eines Planeten oder Mondes, im Magnetfeld von Erde, Jupiter oder Saturn, tief in einer Atmosphäre oder angedockt.',
      { speaker: 'SOLPOL Weltraumwetter', faction: 'control', duration: 14000, urgent: true }
    );
    g.hud.toast('SONNENERUPTION · STRAHLUNGSWARNUNG', 'bad');
  }

  // How hard the storm hits a point, and what (if anything) shelters it
  exposureAt(pos) {
    const g = this.game;
    const ss = g.solarSystem;
    const d = pos.length();
    const behind = this.front - d; // how far the front has passed this point
    if (behind <= 0 || behind >= FRONT_THICKNESS) return { rate: 0, shelter: null, inStorm: false };
    const profile = THREE.MathUtils.smoothstep(behind, 0, 250) * (1 - THREE.MathUtils.smoothstep(behind, FRONT_THICKNESS - 700, FRONT_THICKNESS));
    const strength = THREE.MathUtils.clamp(1496 / Math.max(d, 1), 0.12, 2.2) * (0.75 + this.klass * 0.06);
    let factor = 1;
    let shelter = null;
    if (g.surface.active) return { rate: 0, shelter: 'Atmosphäre', inStorm: true };
    // A planet's or moon's shadow
    const sun = ss.sunVisibility;
    if (sun < 0.98) {
      factor *= sun;
      shelter = 'Planetenschatten';
    }
    // Magnetic fields and thick air
    for (const p of ss.planets) {
      const reach = MAGNETOSPHERES[p.name];
      const dist = p.group.position.distanceTo(pos);
      if (reach) {
        const inside = 1 - THREE.MathUtils.smoothstep(dist, p.radius * reach * 0.8, p.radius * reach);
        if (inside > 0.02) {
          factor *= 1 - 0.9 * inside;
          if (inside > 0.5) shelter = p.name === 'Earth' ? 'Erdmagnetfeld' : `${p.name}-Magnetfeld`;
        }
      }
      if (p.body && p.body.atmosphereTop > p.radius && dist < p.body.atmosphereTop) {
        factor *= 0.25;
        shelter = 'Atmosphäre';
      }
    }
    return { rate: profile * strength * factor, shelter: factor < 0.5 ? shelter : null, inStorm: profile > 0.05 };
  }

  update(delta) {
    const g = this.game;
    const ss = g.solarSystem;
    if (this.state === 'quiet') {
      // Only count down while flying, and not while the tutorial is still talking
      if (this.flying() && !(g.ui.tutorial && g.ui.tutorial.active)) this.timer -= delta;
      if (this.timer <= 0) this.trigger();
    } else {
      if (this.state === 'flare') {
        this.flareT += delta;
        if (this.flareT >= FLARE_TIME) this.state = 'front';
      }
      this.front += FRONT_SPEED * delta * (this.state === 'flare' ? 0.3 : 1);
      // Aurorae flare up where the front arrives
      AURORA_PLANETS.forEach((n) => {
        const p = ss.planets.find((q) => q.name === n);
        if (!this.reached.has(n) && this.front >= p.group.position.length()) {
          this.reached.add(n);
          this.aurora[n] = 1;
        }
      });
      const shipDist = g.ship.position.length();
      if (this.front - FRONT_THICKNESS > Math.max(16000, Math.min(48000, shipDist))) {
        this.state = 'quiet';
        this.timer = rand(NEXT_STORM);
      }
    }
    AURORA_PLANETS.forEach((n) => {
      if (!this.reached.has(n) || this.state === 'quiet') this.aurora[n] = Math.max(0, this.aurora[n] - AURORA_DECAY * delta);
      else this.aurora[n] = Math.max(0, this.aurora[n] - AURORA_DECAY * 0.3 * delta);
    });

    this.updateShip(delta);
    this.updateVisuals(delta);
  }

  updateShip(delta) {
    const g = this.game;
    const ship = g.ship;
    const exp = this.state === 'quiet' || !this.flying() ? { rate: 0, shelter: null, inStorm: false } : this.exposureAt(ship.position);
    this.rate = exp.rate;
    this.shelter = exp.inStorm ? exp.shelter : null;

    if (exp.inStorm && !this.wasHit) {
      this.wasHit = true;
      sfx.radiationAlarm();
      g.hud.toast(exp.shelter ? `Teilchensturm · abgeschirmt: ${exp.shelter}` : 'TEILCHENSTURM · STRAHLUNG!', exp.shelter ? 'info' : 'bad');
    }
    if (this.wasHit && !exp.inStorm && this.state !== 'quiet' && this.front - g.ship.position.length() >= FRONT_THICKNESS) {
      this.wasHit = false;
      g.comm.say('Die Sturmfront ist durch. Bei Erde, Jupiter und Saturn leuchten jetzt Polarlichter wie selten. Ein Abstecher lohnt sich.',
        { speaker: 'SOLPOL Weltraumwetter', faction: 'control', duration: 9000 });
    }

    if (this.rate > 0.01 && !ship.isDestroyed) {
      const hurt = this.rate * difficultyOf(g).damageTaken * delta;
      // Shields soak it up first and cannot recharge meanwhile, then hull and electronics take it
      ship.shieldDelay = Math.max(ship.shieldDelay || 0, 1.5);
      if (ship.shield > 0.5) ship.shield = Math.max(0, ship.shield - hurt * 7);
      else {
        ship.hull -= hurt * 1.5;
        ship.lastHullHit = performance.now();
        if (Math.random() < hurt * 0.6) ship.damageSystems(6);
        if (ship.hull <= 0) g.triggerShipExplosion('Sonnensturm');
      }
      // The dosimeter
      this.clickDebt += Math.min(60, this.rate * 45) * delta;
      let n = 0;
      while (this.clickDebt >= 1 && n < 3) {
        if (Math.random() < 0.8) sfx.geigerClick();
        this.clickDebt -= 1;
        n++;
      }
      this.clickDebt = Math.min(this.clickDebt, 2);
    }
  }

  updateVisuals(delta) {
    const g = this.game;
    const ss = g.solarSystem;
    const sun = ss.planets[0].body;
    // The flare: the corona flashes up and fades
    if (sun.corona) {
      if (!this.baseCorona) this.baseCorona = sun.corona.material.color.clone();
      const flash = this.state === 'flare' ? Math.sin(Math.min(1, this.flareT / FLARE_TIME) * Math.PI) : 0;
      sun.corona.material.color.copy(this.baseCorona).multiplyScalar(1 + flash * 2.5);
      sun.corona.scale.setScalar(sun.radius * (4.5 + flash * 2));
    }
    // The cloud racing outward
    const showShell = this.state !== 'quiet' && this.front < 60000;
    this.shell.visible = showShell;
    if (showShell) {
      this.shell.scale.setScalar(this.front);
      const u = this.shell.material.uniforms;
      u.uCam.value.copy(g.camera.position);
      u.uTime.value += delta;
      // thins out as it spreads
      // thins out as it spreads, and all but vanishes once it has swept past the camera
      const passed = THREE.MathUtils.smoothstep(this.front - g.camera.position.length(), 0, 600);
      u.uFade.value = THREE.MathUtils.clamp(1.2 * Math.sqrt(1496 / Math.max(this.front, 200)), 0.08, 1) * Math.min(1, this.front / 600) * (1 - 0.85 * passed);
    }
    ss.auroraStorm = this.aurora;

    // Hits on the camera sensor, and the radiation lamp in the cockpit
    const level = this.rate;
    if (this.sensorCtx) {
      const c = this.sensor;
      if (c.width !== window.innerWidth || c.height !== window.innerHeight) {
        c.width = window.innerWidth;
        c.height = window.innerHeight;
      }
      const ctx = this.sensorCtx;
      ctx.clearRect(0, 0, c.width, c.height);
      if (level > 0.02) {
        const hits = Math.min(400, Math.floor(level * (60 + Math.random() * 80)));
        for (let i = 0; i < hits; i++) {
          const x = Math.random() * c.width;
          const y = Math.random() * c.height;
          const r = Math.random();
          ctx.fillStyle = r < 0.6 ? 'rgba(255,255,255,0.9)' : r < 0.8 ? 'rgba(150,255,190,0.9)' : 'rgba(160,200,255,0.9)';
          if (Math.random() < 0.12) {
            // A particle crossing the sensor at a slant leaves a streak
            const a = Math.random() * Math.PI * 2;
            const len = 6 + Math.random() * 30;
            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
            ctx.stroke();
          } else {
            const s = Math.random() < 0.85 ? 1 : 2;
            ctx.fillRect(x, y, s, s);
          }
        }
      }
    }
    if (this.alertEl) {
      const storm = this.state !== 'quiet' && this.flying() && (this.rate > 0.02 || this.shelter);
      this.alertEl.classList.toggle('hidden', !storm);
      if (storm) {
        this.alertEl.classList.toggle('sheltered', !!this.shelter && this.rate < 0.15);
        this.alertText.textContent = this.shelter && this.rate < 0.15
          ? `ABGESCHIRMT · ${this.shelter.toUpperCase()}`
          : `STRAHLUNG ${Math.round(Math.min(1, this.rate / 1.5) * 100)} %`;
      }
    }
    document.body.classList.toggle('radiation-glitch', level > 0.25);
  }
}
