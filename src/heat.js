import * as THREE from 'three';
import { sfx } from './sfx';
import { difficultyOf } from './difficulty';
import { GOODS } from './world';

// Waste heat. In vacuum a ship can only get rid of heat by glowing it away through its radiators, so everything
// that makes heat counts: sunlight (far stronger close to the Sun), the afterburner, the guns, the plasma of an
// atmospheric entry, a solar storm. The radiators work best in a planet's shadow. Past the red line the guns and
// the afterburner cut out and the hull starts to cook; a ton of ice from the hold, boiled off through the
// radiators, buys time (L).
//
// heat: 0 cold, about 0.15 idling near Earth, 1 the red line.

const COOLING = 0.09;          // share of the heat radiated away per second, in full sunlight
const SHADOW_BONUS = 0.9;      // the radiators shed this much more with the Sun out of sight
const SUN_AT_EARTH = 0.014;    // heating by sunlight at Earth's distance
const BOOST_HEAT = 0.08;       // per second of afterburner: a full 8 s burn from idle stops short of the warning
const LASER_HEAT = 0.002;      // per unit of gun energy fired
const ENTRY_HEAT = 0.2;        // per second in the thick of an atmospheric entry
const STORM_HEAT = 0.04;
const VENUS_GROUND_HEAT = 0.072; // under Venus's clouds it is 460 °C: the radiators barely keep up
const WARN = 0.75;
const RECOVER = 0.8;           // guns and afterburner come back below this
const MAX_HEAT = 1.6;
const VENT_COOLING = 0.42;     // one ton of ice
const VENT_PAUSE = 1.2;

const _c = new THREE.Color();

// Glow of a hot radiator: black, dull red, orange, yellow-white (bright enough to bloom at the top)
export function glowColor(heat, out = _c) {
  const t = THREE.MathUtils.clamp((heat - 0.3) / 0.9, 0, 1);
  const r = Math.pow(t, 0.7) * (0.6 + 4.2 * t * t);
  const g = Math.pow(t, 2.2) * (0.25 + 2.6 * t * t);
  const b = Math.pow(t, 4.5) * 1.4;
  return out.setRGB(r, g, b);
}

export class Thermal {
  constructor(game) {
    this.game = game;
    this.heat = 0.15;
    this.overheated = false;
    this.ventPause = 0;
    this.alarmTimer = 0;
    this.hinted = false;
    this.sources = { sun: 0, entry: 0 };

    this.bar = document.getElementById('heat-bar');
    this.val = document.getElementById('heat-val');
    this.ext = document.getElementById('ext-heat');
    this.glow = document.getElementById('heat-glow');
  }

  reset() {
    this.heat = 0.15;
    this.overheated = false;
  }

  add(amount) {
    this.heat = Math.min(MAX_HEAT, this.heat + amount);
  }

  laserFired(energy) {
    this.add(energy * LASER_HEAT);
  }

  // What heats the ship right now, per second
  heating() {
    const g = this.game;
    const ship = g.ship;
    const ss = g.solarSystem;
    const d = Math.max(ship.position.length(), 1);
    let sun = SUN_AT_EARTH * Math.min(80, Math.pow(1496 / d, 1.6)) * ss.sunVisibility;
    let entry = 0;
    let ambient = 0;
    const surface = g.surface;
    if (surface.active) {
      // Air dims the Sun; down on Venus the air itself is an oven
      const world = surface.world;
      if (world && world.atmo) sun *= 0.5;
      if (world && world.deck && surface.local.pos.y < world.deck) ambient = VENUS_GROUND_HEAT;
    } else if (g.aero) {
      entry = g.aero.heating * ENTRY_HEAT;
    }
    this.sources.sun = sun;
    this.sources.entry = entry;
    return sun + entry + ambient
      + (ship.boosting ? BOOST_HEAT : 0)
      + Math.abs(ship.throttle) * 0.008
      + g.storm.rate * STORM_HEAT;
  }

  update(delta) {
    const g = this.game;
    const ship = g.ship;
    if (ship.isDestroyed) return;
    if (ship.isDocked) {
      // The station's coolant loop takes over
      this.heat += (0.12 - this.heat) * Math.min(1, delta * 2);
      this.overheated = false;
      this.updateDisplay();
      return;
    }
    const shade = 1 - g.solarSystem.sunVisibility;
    // Cool air carries heat off as well (Earth, Mars)
    const world = g.surface.active ? g.surface.world : null;
    const air = world && world.atmo && !world.deck ? 0.5 : 0;
    const cooling = COOLING * (1 + SHADOW_BONUS * shade + air);
    this.heat = THREE.MathUtils.clamp(this.heat + (this.heating() - cooling * this.heat) * delta, 0, MAX_HEAT);
    if (this.ventPause > 0) this.ventPause -= delta;

    if (!this.hinted && this.heat > 0.62 && !(g.ui.tutorial && g.ui.tutorial.active)) {
      this.hinted = true;
      g.comm.say('Bordcomputer: Die Radiatoren laufen heiß. Abwärme kommt von Sonne, Nachbrenner, Lasern und Wiedereintritt. '
        + 'Im Schatten eines Planeten kühlst du am schnellsten ab. Im Notfall verdampft L eine Tonne Eis aus dem Frachtraum.',
      { speaker: 'Bordcomputer', faction: 'control', duration: 12000 });
    }

    if (!this.overheated && this.heat >= 1) {
      this.overheated = true;
      sfx.radiationAlarm();
      g.hud.toast('ÜBERHITZT · Laser und Nachbrenner abgeschaltet', 'bad');
    } else if (this.overheated && this.heat < RECOVER) {
      this.overheated = false;
      g.hud.toast('Temperatur wieder im Rahmen', 'info');
    }

    if (this.heat > 1) {
      // The hull cooks, the electronics give up one by one
      const over = this.heat - 1;
      const hurt = (0.4 + over * 9) * difficultyOf(g).damageTaken * delta;
      ship.hull -= hurt;
      ship.lastHullHit = performance.now();
      if (Math.random() < hurt * 0.12) ship.damageSystems(5);
      this.alarmTimer -= delta;
      if (this.alarmTimer <= 0) {
        this.alarmTimer = 0.9;
        sfx.missileAlarmTick();
      }
      if (ship.hull <= 0) g.triggerShipExplosion('Hitze');
    }
    this.updateDisplay();
  }

  // L: boil a ton of ice off through the radiators
  vent() {
    const g = this.game;
    const ship = g.ship;
    if (!g.flying() || this.ventPause > 0) return;
    if (ship.cargo.ice < 1) {
      sfx.denied();
      g.hud.toast(`Notkühlung braucht ${GOODS.ice.name} im Frachtraum`, 'warn');
      return;
    }
    if (this.heat < 0.3) {
      sfx.denied();
      return;
    }
    ship.cargo.ice -= 1;
    this.ventPause = VENT_PAUSE;
    this.heat = Math.max(0.1, this.heat - VENT_COOLING);
    sfx.warpBy(ship.position);
    // Steam flashing off to both sides
    const fx = g.fx;
    const pos = g.surface.active ? g.surface.local.pos : ship.position;
    const quat = g.surface.active ? g.surface.local.quat : ship.quaternion;
    const vel = g.surface.active ? g.surface.local.vel : ship.velocity;
    [-1, 1].forEach((side) => {
      for (let i = 0; i < 4; i++) {
        const dir = new THREE.Vector3(side * (0.7 + Math.random() * 0.5), 0.5 + Math.random() * 0.5, 0.4 + Math.random()).applyQuaternion(quat);
        fx.puff(pos.clone().addScaledVector(dir, 0.6), { color: 0xd8ecff, hdr: 1.1, from: 0.5, to: 4 + Math.random() * 3, life: 0.9 + Math.random() * 0.5, vel: dir.multiplyScalar(5).add(vel) });
      }
    });
    g.hud.toast('1 t Eis verdampft · Notkühlung', 'info');
  }

  updateDisplay() {
    const h = this.heat;
    const pct = Math.round(h * 100);
    const state = h >= 1 || this.overheated ? 'alarm' : h >= WARN ? 'warn' : '';
    if (this.bar) {
      this.bar.style.width = `${Math.min(100, pct)}%`;
      if (this.bar.dataset.state !== state) {
        this.bar.dataset.state = state;
        this.bar.className = `energy-bar heat ${state}`;
      }
    }
    if (this.val && this.val.textContent !== String(pct)) {
      this.val.textContent = pct;
      this.val.classList.toggle('alarm-text', state === 'alarm');
    }
    if (this.ext) this.ext.textContent = `${pct}%`;
    if (this.glow) {
      const o = THREE.MathUtils.smoothstep(h, 0.8, 1.25) * 0.8;
      const text = o.toFixed(2);
      if (this.glowShown !== text) {
        this.glowShown = text;
        this.glow.style.opacity = text;
      }
    }
    this.game.ship.model.setHeat(h);
  }

  lampState() {
    return this.heat >= 1 || this.overheated ? 'alarm' : this.heat >= WARN ? 'warn' : '';
  }
}
