import * as THREE from 'three';
import { controls } from './controls';
import { spaceAudio } from './audio';
import { displayName } from './names';
import { arrivalRadius } from './spaceship';

const PICK_RADIUS = 18; // canvas px
const SUN_RING = 30;   // map radius of the innermost orbit

// Top-down system map: pick a planet or station, then warp there
export class NavMap {
  constructor(game, formatDist) {
    this.game = game;
    this.formatDist = formatDist;
    this.isOpen = false;
    this.selectedIndex = 0;
    this.entries = [];
    this.pulse = 0;
    this.orbits = [0, 1];

    this.screen = document.getElementById('nav-screen');
    this.canvas = document.getElementById('nav-map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.listEl = document.getElementById('nav-list');
    this.selName = document.getElementById('nav-sel-name');
    this.selInfo = document.getElementById('nav-sel-info');

    document.getElementById('nav-warp-btn').addEventListener('click', () => this.warp());
    document.getElementById('nav-close-btn').addEventListener('click', () => this.close());
    this.canvas.addEventListener('click', e => this.pickOnMap(e));

    this.buildEntries();
  }

  // Planets in orbital order, each station listed under its planet
  buildEntries() {
    const { planets, stations } = this.game.solarSystem;
    this.entries = [];
    planets.forEach((p, i) => {
      this.entries.push({ object: p, kind: 'planet' });
      stations.filter(st => st.planetIndex === i).forEach(st => {
        this.entries.push({ object: st, kind: 'station' });
      });
    });

    this.listEl.innerHTML = '';
    this.entries.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = entry.kind;
      const name = document.createElement('span');
      name.textContent = displayName(entry.object.name).toUpperCase();
      const dist = document.createElement('span');
      dist.className = 'nav-dist';
      li.append(name, dist);
      li.addEventListener('click', () => this.select(i));
      li.addEventListener('dblclick', () => { this.select(i); this.warp(); });
      entry.row = li;
      entry.distEl = dist;
      this.listEl.appendChild(li);
    });
  }

  canOpen() {
    const { ship } = this.game;
    return this.game.simRunning && !ship.isDocked && !ship.isDestroyed && !this.game.warpState;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.isOpen || !this.canOpen()) return;
    this.isOpen = true;

    // Start on the current target if it is a nav destination, otherwise on Earth
    const target = this.game.ship.targetObject;
    let index = this.entries.findIndex(e => e.object === target);
    if (index === -1) index = this.entries.findIndex(e => e.object.name === 'Earth');
    this.screen.classList.remove('hidden');
    this.select(Math.max(0, index), true);
    document.exitPointerLock();
    spaceAudio.playBeep();
  }

  close(relock = true) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.screen.classList.add('hidden');
    if (relock) controls.requestLock();
  }

  select(index, silent = false) {
    const n = this.entries.length;
    this.selectedIndex = ((index % n) + n) % n;
    this.entries.forEach((e, i) => e.row.classList.toggle('selected', i === this.selectedIndex));
    this.entries[this.selectedIndex].row.scrollIntoView({ block: 'nearest' });
    // Selecting on the map also locks the target, like the T key does in flight
    this.game.ship.targetObject = this.entries[this.selectedIndex].object;
    if (!silent) spaceAudio.playBeep();
  }

  moveSelection(step) {
    this.select(this.selectedIndex + step);
  }

  // Fly to the selected destination [X / Enter]: a warp jump that stops at a safe distance
  warp() {
    const entry = this.departTo();
    if (entry) this.game.triggerWarpJump();
  }

  // Lock the selected destination and close the map; null if there is nowhere to go
  departTo() {
    if (!this.isOpen) return null;
    const entry = this.entries[this.selectedIndex];
    const dist = this.objectPos(entry.object).distanceTo(this.game.ship.position);
    if (dist < arrivalRadius(entry.object)) {
      spaceAudio.playAutopilotAlert(false); // already there
      return null;
    }
    this.game.ship.targetObject = entry.object;
    this.close();
    return entry;
  }

  objectPos(obj) {
    return obj.group ? obj.group.position : obj.mesh.position;
  }

  // World (x,z) -> map px. Schematic like a nav chart: every orbit gets its own evenly spaced ring,
  // anything in between (the ship) is interpolated between the neighbouring rings.
  toMap(pos) {
    const c = this.canvas.width / 2;
    const r = Math.hypot(pos.x, pos.z);
    const orbits = this.orbits; // [0 (sun), Mercury ... Neptune], sorted outward
    const step = (c - 22 - SUN_RING) / Math.max(orbits.length - 2, 1);
    const ring = k => (k === 0 ? 0 : SUN_RING + (k - 1) * step);

    let i = 1;
    while (i < orbits.length - 1 && r > orbits[i]) i++;
    const t = Math.min((r - orbits[i - 1]) / Math.max(orbits[i] - orbits[i - 1], 1e-6), 1.3);
    const s = ring(i - 1) + t * (ring(i) - ring(i - 1));
    const a = Math.atan2(pos.z, pos.x);
    return { x: c + Math.cos(a) * s, y: c + Math.sin(a) * s };
  }

  // Stations sit a fixed few px off their planet so both stay clickable
  entryMapPos(entry) {
    if (entry.kind === 'station') {
      const p = this.toMap(this.objectPos(this.game.solarSystem.planets[entry.object.planetIndex]));
      return { x: p.x + 9, y: p.y - 9 };
    }
    return this.toMap(this.objectPos(entry.object));
  }

  pickOnMap(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / rect.width;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sx;

    let best = -1;
    let bestDist = PICK_RADIUS;
    this.entries.forEach((entry, i) => {
      const p = this.entryMapPos(entry);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best !== -1) this.select(best);
  }

  update(ship, solarSystem) {
    if (!this.isOpen) return;
    this.pulse += 0.08;
    this.orbits = solarSystem.planets.map(p => Math.hypot(p.group.position.x, p.group.position.z));

    this.entries.forEach(entry => {
      entry.distEl.textContent = this.formatDist(this.objectPos(entry.object).distanceTo(ship.position));
    });

    const entry = this.entries[this.selectedIndex];
    const dist = this.objectPos(entry.object).distanceTo(ship.position);
    this.selName.textContent = displayName(entry.object.name).toUpperCase();
    const lines = [
      entry.kind === 'station' ? 'Raumstation · Handel und Werft' : entry.object.name === 'Sun' ? 'Stern · Vorsicht, Schwerefeld' : 'Planet',
      `Entfernung ${this.formatDist(dist)}`,
      dist < arrivalRadius(entry.object) ? 'Bereits vor Ort' : 'Sprungtriebwerk bereit'
    ];
    this.selInfo.textContent = lines.join('\n');

    this.draw(ship, solarSystem);
  }

  draw(ship, solarSystem) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const c = w / 2;
    ctx.clearRect(0, 0, w, w);

    // Grid
    ctx.strokeStyle = 'rgba(92, 255, 122, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = 0; g <= w; g += w / 8) {
      ctx.moveTo(g, 0); ctx.lineTo(g, w);
      ctx.moveTo(0, g); ctx.lineTo(w, g);
    }
    ctx.stroke();

    ctx.font = '15px VT323, monospace';
    ctx.textBaseline = 'middle';

    // Orbits and planets
    solarSystem.planets.forEach((p, i) => {
      const pos = this.toMap(p.group.position);
      if (i > 0) {
        ctx.strokeStyle = 'rgba(92, 255, 122, 0.16)';
        ctx.beginPath();
        ctx.arc(c, c, Math.hypot(pos.x - c, pos.y - c), 0, Math.PI * 2);
        ctx.stroke();
      }
      const isSun = i === 0;
      const big = ['Jupiter', 'Saturn'].includes(p.name);
      ctx.fillStyle = isSun ? '#ffcc00' : '#5cff7a';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, isSun ? 8 : big ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (!isSun) {
        ctx.fillStyle = 'rgba(92, 255, 122, 0.7)';
        ctx.fillText(displayName(p.name).toUpperCase(), pos.x + 8, pos.y + 9);
      }
    });

    // Stations
    this.entries.filter(e => e.kind === 'station').forEach(entry => {
      const p = this.entryMapPos(entry);
      ctx.strokeStyle = '#00f0ff';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x + 4, p.y); ctx.lineTo(p.x, p.y + 4); ctx.lineTo(p.x - 4, p.y);
      ctx.closePath();
      ctx.stroke();
    });

    // Course line from ship to selection
    const shipPos = this.toMap(ship.position);
    const sel = this.entryMapPos(this.entries[this.selectedIndex]);
    ctx.strokeStyle = 'rgba(255, 176, 0, 0.75)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(shipPos.x, shipPos.y);
    ctx.lineTo(sel.x, sel.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Selection ring
    ctx.strokeStyle = '#ffb000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sel.x, sel.y, 10 + Math.sin(this.pulse) * 2.5, 0, Math.PI * 2);
    ctx.stroke();

    // Ship: amber arrow pointing along its heading
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    const heading = Math.atan2(fwd.z, fwd.x);
    ctx.save();
    ctx.translate(shipPos.x, shipPos.y);
    ctx.rotate(heading);
    ctx.fillStyle = '#ffb000';
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
