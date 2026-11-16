import * as THREE from 'three';
import { atmosphereTop, surfaceEntryRadius, flightFloor } from './solarSystem';
import { displayName } from './names';
import { sfx } from './sfx';

// The upper atmosphere, flown through from space. Air brakes the ship (aerobraking: with the stabilizer off it
// sheds orbital speed for free), heats it, and wraps it in plasma that glows in the colours of the gas it is made
// of: nitrogen and oxygen orange and pink, carbon dioxide blue-violet, hydrogen pink, methane cyan, Titan's
// nitrogen-methane mix violet. Skimming a gas giant, the intakes scoop hydrogen: free fuel for a hot hull.

// edge: the glow at the edges of the view; core: the hot shock ahead of the nose (CSS rgb and scene colour)
const PLASMA = {
  Venus: { edge: [255, 190, 90], core: [255, 240, 200], hex: 0xffc060 },
  Earth: { edge: [255, 110, 50], core: [255, 150, 190], hex: 0xff7040 },
  Mars: { edge: [150, 120, 255], core: [255, 170, 120], hex: 0x9a80ff },
  Jupiter: { edge: [255, 110, 190], core: [200, 220, 255], hex: 0xff70c0 },
  Saturn: { edge: [255, 130, 180], core: [210, 225, 255], hex: 0xff80b8 },
  Uranus: { edge: [90, 230, 255], core: [220, 255, 255], hex: 0x60e0ff },
  Neptune: { edge: [80, 160, 255], core: [200, 240, 255], hex: 0x5098ff },
  Titan: { edge: [190, 90, 255], core: [255, 190, 240], hex: 0xb860ff },
};
const SCOOP_WORLDS = new Set(['Jupiter', 'Saturn', 'Uranus', 'Neptune']);
const DRAG = 0.6;            // share of the speed lost per second in the densest air the ship reaches from orbit
const SCOOP_RATE = 3.2;      // fuel per second at full depth and speed
const SCOOP_SPEED = 8;

const _rel = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pos = new THREE.Vector3();
const ZERO = new THREE.Vector3();

export class Aero {
  constructor(game) {
    this.game = game;
    this.heating = 0;      // 0..1, how hard the entry heats the hull (read by heat.js)
    this.planet = null;    // whose air we are in
    this.depth = 0;
    this.scooping = false;
    this.scoopHinted = false;
    this.brakeHinted = false;
    this.wasFull = false;
    this.glowEl = document.getElementById('reentry-glow');
    this.colourOf = null;
  }

  // In space, after the ship has moved
  update(delta) {
    const g = this.game;
    const ship = g.ship;
    this.heating = 0;
    this.planet = null;
    this.depth = 0;
    this.scooping = false;
    if (ship.isDocked || ship.isDestroyed || ship.isWarping) return;

    for (const p of g.solarSystem.planets) {
      if (p.name === 'Sun') continue;
      const top = atmosphereTop(p);
      if (top <= p.radius) continue;
      const dist = ship.position.distanceTo(p.group.position);
      if (dist >= top) continue;
      const low = surfaceEntryRadius(p) || flightFloor(p);
      const depth = THREE.MathUtils.clamp((top - dist) / (top - low), 0, 1);
      const density = depth * depth;
      const planetVel = p.velocity || ZERO;
      _rel.copy(ship.velocity).sub(planetVel);
      const speed = _rel.length();
      this.planet = p;
      this.depth = depth;
      this.heating = density * THREE.MathUtils.clamp((speed - 6) / 30, 0, 1);

      // Drag (the autopilot holds its own speed)
      if (!ship.autopilotActive && speed > 0.01) {
        _rel.multiplyScalar(1 - Math.min(1, DRAG * density * delta));
        ship.velocity.copy(_rel).add(planetVel);
        if (!ship.flightAssist && depth > 0.2 && speed > 15 && !this.brakeHinted) {
          this.brakeHinted = true;
          g.hud.toast(`Aerobraking: die Luft von ${displayName(p.name)} bremst dich ab`, 'info');
        }
      }

      this.setColour(p.name);
      if (this.heating > 0.08) this.plasma(p, speed, delta);
      if (SCOOP_WORLDS.has(p.name)) this.scoop(p, depth, speed, delta);
      break;
    }
  }

  setColour(name) {
    if (this.colourOf === name || !this.glowEl) return;
    this.colourOf = name;
    const c = PLASMA[name] || PLASMA.Earth;
    this.glowEl.style.setProperty('--plasma-edge', c.edge.join(', '));
    this.glowEl.style.setProperty('--plasma-core', c.core.join(', '));
  }

  // Seen from outside: a glowing shock ahead of the ship and a trail of sparks torn off behind it
  plasma(p, speed, delta) {
    const g = this.game;
    const ship = g.ship;
    if (ship.cameraMode === 'cockpit') return;
    const c = (PLASMA[p.name] || PLASMA.Earth).hex;
    const heat = this.heating;
    const frame = p.velocity || ZERO;
    _dir.copy(_rel).normalize();
    this.puffTimer = (this.puffTimer || 0) - delta;
    if (this.puffTimer <= 0) {
      this.puffTimer = 0.035;
      _pos.copy(ship.position).addScaledVector(_dir, 1.3);
      g.fx.puff(_pos, { color: c, hdr: 0.35 + heat * 0.7, from: 1.0, to: 2.2 + heat, life: 0.2, vel: ship.velocity });
      _pos.copy(ship.position).addScaledVector(_dir, -1.5);
      g.fx.puff(_pos, { color: c, hdr: 0.25 + heat * 0.5, from: 1.0, to: 3 + heat * 2.5, life: 0.5, vel: _dir.clone().multiplyScalar(speed * 0.35).add(frame) });
    }
    g.fx.sparks(ship.position, heat > 0.5 ? 2 : 1, 4, { color: c, hdr: 3, life: 0.6, vel: _dir.clone().multiplyScalar(speed * 0.25).add(frame) });
  }

  // Hydrogen from a gas giant's upper air
  scoop(p, depth, speed, delta) {
    const g = this.game;
    const ship = g.ship;
    if (depth < 0.12 || speed < SCOOP_SPEED) return;
    if (ship.fuel >= ship.maxFuel) {
      if (!this.wasFull) {
        this.wasFull = true;
        g.hud.toast('Tank voll', 'gain');
      }
      return;
    }
    this.wasFull = false;
    this.scooping = true;
    ship.fuel = Math.min(ship.maxFuel, ship.fuel + SCOOP_RATE * depth * Math.min(1.5, speed / 30) * delta);
    if (!this.scoopHinted) {
      this.scoopHinted = true;
      sfx.pickup();
      g.comm.say(`Die Einlässe schöpfen Wasserstoff aus der Hochatmosphäre von ${displayName(p.name)}: Treibstoff umsonst. `
        + 'Je tiefer und schneller, desto mehr, aber die Reibung heizt den Rumpf auf. Behalte die Temperatur im Auge.',
      { speaker: 'Bordcomputer', faction: 'control', duration: 10000 });
    }
  }

  // One line for the flight-info readout, or null
  infoText() {
    if (!this.planet) return null;
    const parts = [];
    if (this.heating > 0.05) parts.push(`PLASMA ${Math.round(this.heating * 100)} %`);
    if (this.scooping) parts.push(`SCHÖPFE TREIBSTOFF · ${Math.round(this.game.ship.fuel)}`);
    return parts.length ? parts.join(' · ') : null;
  }
}
