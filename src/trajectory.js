import * as THREE from 'three';
import { gravityRadius } from './spaceship';
import { flightFloor, atmosphereTop } from './solarSystem';
import { displayName } from './names';

// Where the ship is going to fall. With the stabilizer off the ship coasts on a real trajectory through the
// gravity of whatever is near; this draws the next minutes of it as a line ahead of the ship and marks the closest
// approach, so a swing-by or an aerobraking pass can be flown on purpose: amber for a free pass, cyan where the
// path dips into an atmosphere, red where it ends on the ground.

const STEP = 0.25;        // seconds per integration step
const STEPS = 480;        // two minutes ahead
const SAMPLE = 4;         // every fourth step becomes a point of the line
const POINTS = STEPS / SAMPLE + 1;
const REFRESH = 0.12;

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Trajectory {
  constructor(game) {
    this.game = game;
    this.timer = 0;
    this.body = null;
    this.info = null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.renderOrder = 7;
    game.scene.add(this.line);

    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.strokeStyle = '#fff';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(32, 6); g.lineTo(58, 32); g.lineTo(32, 58); g.lineTo(6, 32);
    g.closePath();
    g.stroke();
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: 0xffb000, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
    this.marker.scale.setScalar(0.035);
    this.marker.visible = false;
    this.marker.renderOrder = 8;
    game.scene.add(this.marker);
  }

  // The body whose gravity dominates here
  dominant(pos) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.game.solarSystem.planets) {
      const d = p.group.position.distanceTo(pos);
      if (d < gravityRadius(p) && d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  update(delta) {
    const g = this.game;
    const ship = g.ship;
    const on = !g.surface.active && !ship.flightAssist && !ship.autopilotActive && !ship.isWarping && !ship.isDocked && !ship.isDestroyed;
    const body = on ? this.dominant(ship.position) : null;
    if (!body) {
      this.line.visible = false;
      this.marker.visible = false;
      this.info = null;
      this.body = null;
      return;
    }
    this.timer -= delta;
    if (this.timer <= 0 || this.body !== body) {
      this.timer = REFRESH;
      this.body = body;
      this.predict(body);
    }
    // The path is kept relative to the body, so it rides along with it between refreshes
    this.line.position.copy(body.group.position);
    this.line.visible = true;
    this.marker.visible = this.hasMarker;
    if (this.hasMarker) this.marker.position.copy(body.group.position).add(this.markerRel);
  }

  predict(body) {
    const g = this.game;
    const ship = g.ship;
    const planets = g.solarSystem.planets;
    const centre = body.group.position;
    const others = planets.filter((p) => p !== body && p.group.position.distanceTo(centre) < gravityRadius(p) + gravityRadius(body));
    const pos = this.line.geometry.attributes.position;
    const limit = ship.speedLimit() * 2.5;
    const floor = body.name === 'Sun' ? body.radius * 1.02 : flightFloor(body);
    const top = body.name === 'Sun' ? 0 : atmosphereTop(body);
    const reach = gravityRadius(body) * 1.15;

    _p.copy(ship.position).sub(centre);
    _v.copy(ship.velocity).sub(body.velocity || _a.set(0, 0, 0));
    let minD = _p.length();
    let minT = 0;
    let n = 0;
    let end = 'coast';
    let airT = -1;
    this.markerRel = this.markerRel || new THREE.Vector3();
    this.markerRel.copy(_p);
    pos.setXYZ(n++, _p.x, _p.y, _p.z);
    for (let i = 1; i <= STEPS; i++) {
      const d = _p.length();
      _a.copy(_p).multiplyScalar(-body.data.gravity * (body.radius / d) ** 2 / d);
      for (const o of others) {
        _d.copy(o.group.position).sub(centre).sub(_p);
        const od = _d.length();
        if (od < gravityRadius(o) && od > o.radius * 0.5) _a.addScaledVector(_d, o.data.gravity * (o.radius / od) ** 2 / od);
      }
      _v.addScaledVector(_a, STEP);
      if (_v.length() > limit) _v.setLength(limit);
      _p.addScaledVector(_v, STEP);
      const nd = _p.length();
      if (nd < minD) {
        minD = nd;
        minT = i * STEP;
        this.markerRel.copy(_p);
      }
      if (airT < 0 && top > body.radius && nd < top) airT = i * STEP;
      if (i % SAMPLE === 0) pos.setXYZ(n++, _p.x, _p.y, _p.z);
      if (nd <= floor) { end = 'impact'; minT = i * STEP; this.markerRel.copy(_p); break; }
      if (nd > reach) { end = 'escape'; break; }
    }
    pos.needsUpdate = true;
    this.line.geometry.setDrawRange(0, n);

    const km = (dist) => Math.max(0, Math.round((dist - body.radius) * (body.data.realRadius / body.radius))).toLocaleString('de-DE');
    const name = displayName(body.name);
    const ground = !!(body.name !== 'Sun' && end === 'impact' && top <= body.radius);
    const air = airT >= 0;
    const color = ground || body.name === 'Sun' && end === 'impact' ? 0xff3b2f : air ? 0x40e0ff : 0xffb000;
    this.line.material.color.setHex(color);
    this.marker.material.color.setHex(color);
    this.hasMarker = minT > 1;
    if (ground || (body.name === 'Sun' && end === 'impact')) this.info = `KOLLISIONSKURS ${name.toUpperCase()} · ${Math.round(minT)} s`;
    else if (air) this.info = `ATMOSPHÄRE ${name.toUpperCase()} in ${Math.round(airT)} s · tiefster Punkt ${km(Math.max(minD, floor))} km`;
    else if (minT > 1) this.info = `NÄCHSTER PUNKT ${km(minD)} km über ${name} · ${Math.round(minT)} s`;
    else this.info = end === 'escape' ? `FLUCHTBAHN · ${name} bleibt zurück` : `STEIGFLUG · ${km(minD)} km über ${name}`;
  }
}
