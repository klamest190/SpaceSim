import * as THREE from 'three';
import { controls } from './controls';
import { sfx } from './sfx';
import { pilotSettings } from './spaceship';
import { ShipInterior, INTERIOR_SCALE, FLOOR_Y, SEATED_EYE, WINDOWS } from './shipInterior';
import { GOODS, GOOD_KEYS } from './world';
import { displayName } from './names';

// Getting out of the pilot seat (U) and walking through the ship while it flies on without anyone at the stick.
// The ship keeps its course, throttle and autopilot; gravity, pirates, police, planets and moons all carry on.
// Gravity plates hold you to the deck, the inertial dampers let a trace of the ship's own acceleration through,
// so a braking autopilot or a hit tugs at you. WASD walk, Shift runs, Space jumps, E uses, at the seat E / U sits.

const EYE_HEIGHT = 1.68;    // metres above the deck
const WALK_SPEED = 1.7;     // m/s
const RUN_SPEED = 3.8;
const JUMP_SPEED = 3.1;
const GRAVITY = 9.81;
const STAND_TIME = 1.1;
const SIT_TIME = 0.9;
const STEP_LENGTH = 0.78;
const DAMPER_LEAK = 0.0035;  // share of the ship's acceleration (world units = 10 m) that reaches the crew
const MAX_FELT = 2.6;        // m/s², what the dampers never let past
const LOOK_SENS = 0.0021;
const STAND_SPOT = new THREE.Vector3(0.82, FLOOR_Y, -4.0);
const ALERT_REPEAT = 3.2;    // seconds between klaxons

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

function objectPos(o) {
  if (!o) return null;
  if (o.group) return o.group.position;
  if (o.mesh) return o.mesh.position;
  return o.pos || o.position || null;
}

function formatDist(d) {
  const km = d * 100000;
  if (km > 149600000) return `${(km / 149597870.7).toFixed(2).replace('.', ',')} AE`;
  return `${Math.round(km).toLocaleString('de-DE')} km`;
}

function smooth(k) {
  return k * k * (3 - 2 * k);
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class OnFoot {
  constructor(game) {
    this.game = game;
    this.interior = new ShipInterior();
    game.scene.add(this.interior.group);

    this.active = false;     // out of the seat, including the stand-up and sit-down moves
    this.phase = null;       // 'standing' | 'walking' | 'sitting'
    this.t = 0;
    this.pos = new THREE.Vector3();  // feet, ship metres
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.jumpY = 0;
    this.vy = 0;
    this.stepPhase = 0;
    this.stepDist = 0;
    this.felt = new THREE.Vector3();   // m/s² in ship axes, what the body feels
    this.lastVel = null;
    this.eye = SEATED_EYE.clone();
    this.from = { eye: new THREE.Vector3(), yaw: 0, pitch: 0 };
    this.to = { eye: new THREE.Vector3(), yaw: 0, pitch: 0 };
    this.coffee = 0;
    this.alertKind = '';
    this.alertTimer = 0;
    this.hintTimer = 0;
    this.focus = null;
    this.firstTime = true;
    this.savedNear = 0.05;

    this.buildHud();
  }

  buildHud() {
    const hud = document.createElement('div');
    hud.id = 'walk-hud';
    hud.className = 'walk-hud';
    hud.innerHTML = `
      <div class="walk-dot"></div>
      <div class="walk-room" id="walk-room">BRÜCKE</div>
      <div class="walk-prompt hidden" id="walk-prompt"></div>
      <div class="walk-hint" id="walk-hint">WASD gehen · Shift rennen · Leertaste springen · E / Klick benutzen · am Pilotensitz E: hinsetzen</div>`;
    document.getElementById('hud').appendChild(hud);
    this.hud = hud;
    this.roomEl = hud.querySelector('#walk-room');
    this.promptEl = hud.querySelector('#walk-prompt');
    this.hintEl = hud.querySelector('#walk-hint');

    // In the seat: the prompt to get up, beside the sight
    const stand = document.createElement('div');
    stand.id = 'stand-prompt';
    stand.className = 'stand-prompt hidden';
    document.getElementById('hud').appendChild(stand);
    this.standEl = stand;
    this.standState = null;
  }

  // While seated, every frame: offer "[E] Aufstehen" when the ship is at rest or on autopilot and nothing is shooting
  updateSeated() {
    const g = this.game;
    const ship = g.ship;
    let state = null;
    if (!this.active && !this.blockedReason() && !g.ui.pauseOpen && !g.ui.difficultyOpen && !(g.journal && g.journal.isOpen)) {
      const danger = ship.incomingMissiles > 0 || g.hostilesNear(ship.sensorRange * 0.6) || !!g.encounters.hail;
      state = danger ? 'danger' : ship.autopilotActive || (Math.abs(ship.throttle) < 0.01 && !ship.boosting) ? 'ready' : 'moving';
    }
    controls.seatPrompt = state === 'ready';
    if (state === this.standState) return;
    this.standState = state;
    this.standEl.classList.toggle('hidden', !state);
    this.standEl.classList.toggle('danger', state === 'danger');
    // E only gets you up at rest (in flight it strafes); U always does
    this.standEl.innerHTML = state === 'ready'
      ? '<span class="key">E</span>Aufstehen'
      : state === 'moving' ? '<span class="key">U</span>Aufstehen <small>· E bei Schub 0</small>'
        : state === 'danger' ? '<span class="key">U</span>Aufstehen <small>· Feinde in der Nähe!</small>' : '';
  }

  // ----- getting up and sitting down -------------------------------------------------------------

  blockedReason() {
    const g = this.game;
    const ship = g.ship;
    if (!g.simRunning || g.paused || ship.isDestroyed || g.photo.active || g.ui.navMap.isOpen) return 'busy';
    if (ship.isDocked) return 'Angedockt: Die Station erreichst du über die Schleuse im Hangar.';
    if (g.warpState || ship.isWarping) return 'Nicht während des Sprungs: Der Sitz hält dich fest.';
    if (g.surface.active) return 'Im Atmosphärenflug bleibst du besser am Steuer.';
    return null;
  }

  toggle() {
    if (!this.active) this.standUp();
    else if (this.phase === 'walking') {
      if (this.focus && this.focus.id === 'seat') this.sit();
      else {
        sfx.denied();
        this.game.hud.toast('Erst zum Pilotensitz gehen: vorne auf der Brücke', 'info');
      }
    }
  }

  standUp() {
    const g = this.game;
    const ship = g.ship;
    const reason = this.blockedReason();
    if (reason) {
      if (reason !== 'busy') {
        sfx.denied();
        g.hud.toast(reason, 'warn');
      }
      return;
    }
    this.active = true;
    this.phase = 'standing';
    controls.seatPrompt = false;
    this.standState = null;
    this.standEl.classList.add('hidden');
    this.t = 0;
    this.savedCameraMode = ship.cameraMode;
    ship.cameraMode = 'cockpit';
    ship.headLook.yaw = ship.headLook.pitch = 0;
    controls.setWalkMode(true);
    this.pos.copy(STAND_SPOT);
    this.vel.set(0, 0, 0);
    this.jumpY = this.vy = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.felt.set(0, 0, 0);
    this.lastVel = null;
    this.from.eye.copy(SEATED_EYE);
    this.from.yaw = 0;
    this.from.pitch = 0;
    this.to.eye.set(STAND_SPOT.x, FLOOR_Y + EYE_HEIGHT, STAND_SPOT.z);
    this.to.yaw = 0.65;
    this.to.pitch = -0.12;
    this.eye.copy(SEATED_EYE);
    this.alertKind = '';
    this.alertTimer = 0;

    this.interior.group.visible = true;
    ship.mesh.visible = false;
    g.fx.dust.visible = false;
    this.savedNear = g.camera.near;
    g.camera.near = 0.004;
    g.camera.updateProjectionMatrix();
    document.body.classList.add('on-foot');
    this.hintTimer = this.firstTime ? 10 : 4;
    this.hintEl.classList.remove('faded');
    sfx.harness(true);
    if (this.firstTime) {
      this.firstTime = false;
      const who = ship.autopilotActive ? 'Der Autopilot fliegt weiter.' : ship.throttle !== 0 ? 'Das Schiff fliegt mit seinem Schub weiter.' : 'Das Schiff treibt weiter.';
      g.hud.toast(`Du schnallst dich ab. ${who}`, 'info');
    }
  }

  sit() {
    if (!this.active || this.phase !== 'walking') return;
    this.phase = 'sitting';
    this.t = 0;
    this.from.eye.copy(this.eye);
    this.from.yaw = wrapAngle(this.yaw);
    this.from.pitch = this.pitch;
    this.to.eye.copy(SEATED_EYE);
    this.to.yaw = 0;
    this.to.pitch = 0;
    this.vel.set(0, 0, 0);
    this.promptEl.classList.add('hidden');
  }

  // Back in the seat: the cockpit takes over again
  finishSit(silent = false) {
    if (!this.active) return;
    const g = this.game;
    this.active = false;
    this.phase = null;
    controls.setWalkMode(false);
    document.body.classList.remove('on-foot');
    this.interior.group.visible = false;
    g.fx.dust.visible = true;
    g.camera.near = this.savedNear || 0.05;
    g.camera.updateProjectionMatrix();
    g.ship.cameraMode = 'cockpit';
    g.ship.stick.x = g.ship.stick.y = 0;
    g.ship.headLook.yaw = g.ship.headLook.pitch = 0;
    if (!silent) sfx.harness(false);
  }

  // Something pulls the pilot back to the controls at once (entering an atmosphere, the ship blowing up)
  forceSit(message) {
    if (!this.active) return;
    this.finishSit(true);
    if (message) this.game.hud.toast(message, 'warn');
  }

  // ----- every frame -----------------------------------------------------------------------------

  update(dt) {
    const g = this.game;
    const ship = g.ship;
    if (!this.active) return;
    if (ship.isDestroyed || ship.isDocked) { this.forceSit(); return; }
    if (g.surface.active) { this.forceSit('Atmosphäreneintritt: Du hechtest zurück in den Pilotensitz!'); return; }

    this.updateFelt(dt);
    const look = controls.look;
    if (this.phase === 'walking') {
      const sens = LOOK_SENS * pilotSettings.sensitivity;
      this.yaw -= look.x * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch - look.y * sens * (pilotSettings.invertY ? -1 : 1), -1.45, 1.45);
      this.walk(dt);
    } else {
      this.animate(dt);
    }
    look.x = look.y = 0;
    controls.walk.jump = false;

    this.updateAlert(dt);
    this.placeCamera(dt);
    const it = this.interior;
    it.update(dt, ship, g.solarSystem, this.eye, {
      alert: !!this.alertKind && this.alertKind !== 'heat',
      shake: ship.shake,
      heat: g.heat.heat,
      throttle: ship.autopilotActive && !ship.isHolding() ? 0.95 : Math.min(1, Math.abs(ship.throttle) + (ship.boosting ? 0.4 : 0)),
      coffee: this.coffee,
      onDoor: () => { if (this.phase === 'walking') sfx.door(); },
    });
    it.updateScreens(dt, this.screenInfo());
    this.updateHud(dt);
    if (this.coffee > 0) this.coffee -= dt;
  }

  // The ship's own acceleration (not gravity: the whole ship falls with you), mostly swallowed by the dampers
  updateFelt(dt) {
    const ship = this.game.ship;
    _v.set(0, 0, 0);
    if (this.lastVel && !ship.isWarping && dt > 0) {
      _v.copy(ship.velocity).sub(this.lastVel).divideScalar(dt).sub(ship.gravityAccel || _w.set(0, 0, 0));
      _inv.copy(ship.quaternion).invert();
      _v.applyQuaternion(_inv).multiplyScalar(10 * DAMPER_LEAK);
      const len = _v.length();
      if (len > 1e-4) _v.multiplyScalar((MAX_FELT * Math.tanh(len / MAX_FELT)) / len);
    }
    if (!this.lastVel) this.lastVel = new THREE.Vector3();
    this.lastVel.copy(ship.velocity);
    this.felt.lerp(_v, 1 - Math.exp(-dt * 5));
  }

  animate(dt) {
    const dur = this.phase === 'standing' ? STAND_TIME : SIT_TIME;
    this.t = Math.min(1, this.t + dt / dur);
    const k = smooth(this.t);
    this.eye.lerpVectors(this.from.eye, this.to.eye, k);
    // A little arc: up out of the seat, or down into it
    this.eye.y += Math.sin(Math.PI * k) * 0.08;
    this.yaw = THREE.MathUtils.lerp(this.from.yaw, this.to.yaw, k);
    this.pitch = THREE.MathUtils.lerp(this.from.pitch, this.to.pitch, k);
    if (this.phase === 'sitting' && this.t > 0.45) document.body.classList.remove('on-foot');
    if (this.t >= 1) {
      if (this.phase === 'standing') {
        this.phase = 'walking';
        this.pos.copy(STAND_SPOT);
      } else {
        this.finishSit();
      }
    }
  }

  walk(dt) {
    const w = controls.walk;
    const onGround = this.jumpY <= 0.0001;
    const fwd = (w.fwd ? 1 : 0) - (w.back ? 1 : 0);
    const side = (w.right ? 1 : 0) - (w.left ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    _w.set(-sin * fwd + cos * side, 0, -cos * fwd - sin * side);
    if (_w.lengthSq() > 1) _w.normalize();
    const speed = w.run ? RUN_SPEED : WALK_SPEED;
    _w.multiplyScalar(speed);
    // On the deck you steer at once, in the air hardly at all
    const grip = onGround ? 1 - Math.exp(-dt * 11) : 1 - Math.exp(-dt * 0.8);
    this.vel.x += (_w.x - this.vel.x) * grip;
    this.vel.z += (_w.z - this.vel.z) * grip;
    // The ship accelerating forward pushes you aft, and so on
    this.vel.x -= this.felt.x * dt;
    this.vel.z -= this.felt.z * dt;

    // Jumping, under the plates' 1 g plus whatever the dampers let through vertically
    if (w.jump && onGround) this.vy = JUMP_SPEED;
    if (this.vy !== 0 || this.jumpY > 0) {
      this.vy -= (GRAVITY + this.felt.y) * dt;
      this.jumpY += this.vy * dt;
      if (this.jumpY <= 0) {
        this.jumpY = 0;
        if (this.vy < -1.5) sfx.footstep(true, this.onGlass());
        this.vy = 0;
      }
    }

    const ox = this.pos.x, oz = this.pos.z;
    this.tryMove(this.vel.x * dt, 0);
    this.tryMove(0, this.vel.z * dt);
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    if (Math.abs(this.pos.x - ox) < Math.abs(this.vel.x * dt) * 0.5) this.vel.x *= 0.5;
    if (Math.abs(this.pos.z - oz) < Math.abs(this.vel.z * dt) * 0.5) this.vel.z *= 0.5;

    // Footsteps and head bob
    if (onGround && moved > 0.0005) {
      this.stepDist += moved;
      this.stepPhase += moved / STEP_LENGTH * Math.PI;
      if (this.stepDist >= STEP_LENGTH) {
        this.stepDist -= STEP_LENGTH;
        sfx.footstep(w.run, this.onGlass());
      }
    } else {
      this.stepPhase += (Math.round(this.stepPhase / Math.PI) * Math.PI - this.stepPhase) * Math.min(1, dt * 6);
    }
    const bob = Math.abs(Math.sin(this.stepPhase)) * (w.run ? 0.055 : 0.03);
    this.eye.set(this.pos.x, FLOOR_Y + EYE_HEIGHT + this.jumpY - bob, this.pos.z);
    this.updateFocus();
  }

  onGlass() {
    return Math.abs(this.pos.x) < 0.6 && this.pos.z > 0.65 && this.pos.z < 2.15;
  }

  // A step is allowed if the centre stays on the floor (rooms, open doors) and off the furniture
  tryMove(dx, dz) {
    const x = this.pos.x + dx, z = this.pos.z + dz;
    if (this.canStand(x, z)) {
      this.pos.x = x;
      this.pos.z = z;
    }
  }

  canStand(x, z) {
    const it = this.interior;
    const R = 0.3;
    let onFloor = it.walkable.some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
    if (!onFloor) {
      onFloor = it.doors.some((d) => d.open > 0.8 && Math.abs(x) <= 0.42 && Math.abs(z - d.z) <= 0.5);
    }
    if (!onFloor) return false;
    // Closed or closing doors block the doorway
    for (const d of it.doors) {
      if (d.open < 0.8 && Math.abs(z - d.z) < 0.1 + R) return false;
    }
    const blocked = (list) => list.some(([x0, x1, z0, z1]) => x > x0 - R && x < x1 + R && z > z0 - R && z < z1 + R);
    return !blocked(it.obstacles) && !blocked(it.crateObstacles);
  }

  // What the walker looks at and can use
  updateFocus() {
    const it = this.interior;
    let best = null, bestScore = Infinity;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    it.interactables.forEach((o) => {
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > o.radius) return;
      const facing = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      if (facing < 0.35 && d > 0.7) return;
      const score = d * (1.6 - facing);
      if (score < bestScore) { bestScore = score; best = o; }
    });
    if (!best) {
      const crate = it.crateNear(this.pos.x + fx * 0.7, this.pos.z + fz * 0.7, 0.9);
      if (crate) {
        const name = crate.good === 'mission' ? 'Auftragsfracht' : GOODS[crate.good].name;
        best = { id: 'crate', good: crate.good, prompt: `Kiste: ${name}` };
      }
    }
    this.focus = best;
  }

  use() {
    if (!this.active || this.phase !== 'walking' || !this.focus) return;
    const g = this.game;
    const ship = g.ship;
    const id = this.focus.id;
    if (id === 'seat') { this.sit(); return; }
    if (id.startsWith('crew:')) { g.crew.talk(id.slice(5)); return; }
    if (id.startsWith('window:')) { g.hud.toast(this.describeView(id.slice(7)), 'info'); return; }
    if (id === 'coffee') {
      if (this.coffee > 0) return;
      this.coffee = 3;
      sfx.coffee();
      const lines = ['Kaffee: schwarz, heiß und aus dem Wasserrecycler.', 'Der Automat röchelt, dann riecht es nach Kaffee.', 'Ein Becher Kaffee. Das Schiff fliegt so lange ohne dich.'];
      g.hud.toast(lines[Math.floor(Math.random() * lines.length)], 'info');
      return;
    }
    if (id === 'bunk') {
      g.hud.toast(this.alertKind ? 'Jetzt schlafen? Draußen ist Alarm!' : 'Die Koje ist gemacht. Schlafen kannst du, wenn das Schiff angedockt ist.', 'info');
      return;
    }
    if (id === 'airlock') {
      sfx.denied();
      g.hud.toast('Schleuse verriegelt: Draußen ist Vakuum. Öffnen nur angedockt.', 'warn');
      return;
    }
    if (id === 'reactor') {
      if (g.heat.heat < 0.3) {
        sfx.denied();
        g.hud.toast('Reaktor kühl genug: keine Notkühlung nötig', 'info');
      } else {
        g.heat.vent();
      }
      return;
    }
    if (id === 'status' || id === 'manifest') return;
    if (id === 'crate') {
      const k = this.focus.good;
      const n = k === 'mission' ? ship.missionCargoWeight : ship.cargo[k] || 0;
      const name = k === 'mission' ? 'Auftragsfracht' : GOODS[k].name;
      const illegal = k !== 'mission' && GOODS[k].contraband ? ' Schmuggelware: bei Polizeikontrollen besser nicht vorzeigen.' : '';
      g.hud.toast(`${name}: ${n} t an Bord.${illegal}`, illegal ? 'warn' : 'info');
    }
  }

  // What can be seen through a window right now: the biggest thing in that direction
  describeView(name) {
    const g = this.game;
    const ship = g.ship;
    const w = WINDOWS.find((x) => x.name === name);
    if (!w) return '';
    const out = name === 'floor' ? _v.set(0, -1, 0) : name === 'canopy' ? _v.set(0, 0, -1) : name === 'aft' ? _v.set(0, 0, 1) : _v.set(Math.sign(w.c[0]), 0, 0);
    out.applyQuaternion(ship.quaternion);
    const label = name === 'floor' ? 'Unter dir' : name === 'aft' ? 'Hinter dem Schiff' : 'Draußen';
    let best = null, bestSize = 0;
    const cone = Math.cos(THREE.MathUtils.degToRad(55));
    g.solarSystem.planets.forEach((p) => {
      _w.copy(p.group.position).sub(ship.position);
      const d = _w.length();
      if (d < 1e-3) return;
      const along = _w.dot(out) / d;
      const size = Math.asin(Math.min(1, p.radius / d));
      if (along + Math.sin(size) < cone) return;
      if (size > bestSize) { bestSize = size; best = { p, d }; }
    });
    if (best && bestSize > 0.002) {
      const p = best.p;
      if (p.name === 'Sun') return `${label}: die Sonne. Nicht zu lange hineinsehen.`;
      _w.copy(ship.position).sub(p.group.position).normalize();
      const toSun = p.group.position.clone().negate().normalize();
      const lit = _w.dot(toSun);
      const side = lit > 0.15 ? 'Tagseite' : lit < -0.15 ? 'Nachtseite' : 'an der Tag-Nacht-Grenze';
      const dist = formatDist(Math.max(0, best.d - p.radius));
      const filling = bestSize > 0.5 ? ', füllt das ganze Fenster' : '';
      return `${label}: ${displayName(p.name)}, ${side}${filling} · ${dist}`;
    }
    const st = g.solarSystem.stations.find((s) => !s.hidden && s.mesh.position.distanceTo(ship.position) < 1500 && s.mesh.position.clone().sub(ship.position).normalize().dot(out) > cone);
    if (st) return `${label}: ${displayName(st.name)} · ${formatDist(st.mesh.position.distanceTo(ship.position))}`;
    return `${label}: nur Sterne. Sehr viele Sterne.`;
  }

  // ----- danger while nobody is at the stick -----------------------------------------------------

  updateAlert(dt) {
    const g = this.game;
    const ship = g.ship;
    let kind = '', text = '';
    if (ship.incomingMissiles > 0) { kind = 'missile'; text = 'RAKETE IM ANFLUG'; }
    else if (g.hostilesNear(ship.sensorRange * 0.6)) { kind = 'hostile'; text = 'FEINDKONTAKT'; }
    else {
      const c = this.collisionCourse();
      if (c) { kind = 'collision'; text = `KOLLISIONSKURS: ${displayName(c).toUpperCase()}`; }
      else if (ship.hull / ship.maxHull < 0.3) { kind = 'hull'; text = 'HÜLLE KRITISCH'; }
      else if (g.heat.overheated) { kind = 'heat'; text = 'REAKTOR ÜBERHITZT'; }
    }
    this.alertText = text;
    if (kind !== this.alertKind) {
      const was = this.alertKind;
      this.alertKind = kind;
      this.alertTimer = 0;
      if (kind && this.phase === 'walking') {
        const msg = {
          missile: 'ROTER ALARM: Rakete im Anflug! Zurück ans Steuer!',
          hostile: 'ROTER ALARM: Feindkontakt! Zurück an den Pilotensitz!',
          collision: `ALARM: Kollisionskurs auf ${displayName(this.collisionName || '')}! Ans Steuer!`,
          hull: 'ALARM: Hülle kritisch!',
          heat: 'Reaktor überhitzt: Notkühlung im Maschinenraum (E am Reaktor)',
        }[kind];
        g.hud.toast(msg, 'warn');
      } else if (!kind && was) {
        g.hud.toast('Alarm aufgehoben', 'info');
      }
    }
    if (kind && kind !== 'heat') {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) {
        this.alertTimer = ALERT_REPEAT;
        sfx.klaxon();
      }
    }
  }

  // Heading into a planet or moon within half a minute, with nobody steering
  collisionCourse() {
    const g = this.game;
    const ship = g.ship;
    this.collisionName = null;
    if (ship.autopilotActive) return null;
    for (const p of g.solarSystem.planets) {
      _v.copy(p.group.position).sub(ship.position);
      const d = _v.length();
      const top = (p.body && p.body.atmosphereTop) || p.radius;
      const gap = d - top;
      if (gap > 4000) continue;
      _w.copy(ship.velocity);
      if (p.velocity) _w.sub(p.velocity);
      const closing = _w.dot(_v) / Math.max(d, 1e-6);
      if (closing > 0.3 && gap / closing < 30) {
        // Will the straight path actually hit it?
        const tMin = _v.dot(_w) / Math.max(_w.lengthSq(), 1e-6);
        const miss = _v.clone().addScaledVector(_w, -tMin).length();
        if (miss < top * 1.02) {
          this.collisionName = p.name;
          return p.name;
        }
      }
    }
    return null;
  }

  // ----- camera, HUD, screens --------------------------------------------------------------------

  placeCamera() {
    const g = this.game;
    const ship = g.ship;
    const cam = g.camera;
    const S = INTERIOR_SCALE;
    // Leaning into what the dampers let through
    const lean = 0.03;
    _e.set(this.pitch + THREE.MathUtils.clamp(this.felt.z * lean, -0.08, 0.08), this.yaw, THREE.MathUtils.clamp(-this.felt.x * lean, -0.08, 0.08), 'YXZ');
    _q.setFromEuler(_e);
    cam.quaternion.copy(ship.quaternion).multiply(_q);
    _v.copy(this.eye).multiplyScalar(S).applyQuaternion(ship.quaternion);
    cam.position.copy(ship.position).add(_v);
    cam.up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    if (ship.shake > 0.001) {
      const s = ship.shake * ship.shake * 0.5;
      _v.set((Math.random() - 0.5), (Math.random() - 0.5), 0).multiplyScalar(s * 0.04 * S).applyQuaternion(cam.quaternion);
      cam.position.add(_v);
      cam.rotateX((Math.random() - 0.5) * s * 0.06);
      cam.rotateY((Math.random() - 0.5) * s * 0.06);
      cam.rotateZ((Math.random() - 0.5) * s * 0.09);
    }
    ship.mesh.visible = false;
  }

  updateHud(dt) {
    const it = this.interior;
    this.roomEl.textContent = `${it.roomName(this.eye.z)}${this.alertText ? ` · ${this.alertText}` : ''}`;
    this.roomEl.classList.toggle('alert', !!this.alertText);
    const f = this.phase === 'walking' ? this.focus : null;
    if (f && f.prompt) {
      const key = f.id === 'status' || f.id === 'manifest' ? '' : '[E] ';
      this.promptEl.textContent = `${key}${f.id === 'reactor' ? 'Reaktor: Notkühlung (1 t Eis)' : f.prompt}`;
      this.promptEl.classList.remove('hidden');
    } else {
      this.promptEl.classList.add('hidden');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.classList.add('faded');
    }
  }

  screenInfo() {
    const g = this.game;
    const ship = g.ship;
    const rel = _v.copy(ship.velocity).sub(ship.frameVelocity);
    const cruising = ship.autopilotActive && !ship.isHolding();
    const speed = cruising ? `WARP ${(rel.length() / 300).toFixed(1).replace('.', ',')} c` : `${Math.round(rel.length() * 1000).toLocaleString('de-DE')} km/s`;
    const target = ship.targetObject;
    const tpos = objectPos(target);
    const thr = Math.round(ship.throttle * 100);

    // Contacts on the bridge scope, seen from above, nose up
    _inv.copy(ship.quaternion).invert();
    const range = ship.sensorRange;
    const contacts = [];
    g.npcs.ships.forEach((n) => {
      if (!n.alive) return;
      _w.copy(n.pos).sub(ship.position);
      const d = _w.length();
      if (d > range) return;
      _w.applyQuaternion(_inv).divideScalar(range);
      contacts.push({ x: _w.x, z: _w.z, hostile: g.npcs.isHostile(n, ship), police: n.faction === 'police', target: n === target });
    });

    // The nearest thing to fly into
    let near = null, nearGap = Infinity;
    g.solarSystem.planets.forEach((p) => {
      const gap = p.group.position.distanceTo(ship.position) - p.radius;
      if (gap < nearGap) { nearGap = gap; near = p.name; }
    });
    g.solarSystem.stations.forEach((s) => {
      if (s.hidden) return;
      const gap = s.mesh.position.distanceTo(ship.position);
      if (gap < nearGap) { nearGap = gap; near = s.name; }
    });

    const cargo = GOOD_KEYS.filter((k) => ship.cargo[k] > 0).map((k) => [GOODS[k].name.toUpperCase(), `${ship.cargo[k]} t`]);
    if (ship.missionCargoWeight > 0) cargo.push(['AUFTRAGSFRACHT', `${ship.missionCargoWeight} t`]);

    return {
      alert: !!this.alertKind && this.alertKind !== 'heat',
      alertText: this.alertText,
      speed,
      throttleText: thr < 0 ? `R ${-thr}%` : `${thr}%`,
      throttle: cruising ? 0.95 : Math.min(1, Math.abs(ship.throttle)),
      target: target ? (target.name ? displayName(target.name).toUpperCase() : 'WEGPUNKT') : null,
      targetDist: tpos ? formatDist(tpos.distanceTo(ship.position)) : null,
      autopilot: ship.autopilotActive ? (ship.isHolding() ? 'HÄLT POSITION' : 'FLIEGT ZIEL AN') : 'AUS',
      autopilotOn: ship.autopilotActive,
      assist: ship.flightAssist,
      contacts,
      shield: ship.shield / ship.maxShield,
      hull: ship.hull / ship.maxHull,
      fuel: ship.fuel / ship.maxFuel,
      heat: Math.min(1, g.heat.heat),
      overheated: g.heat.overheated,
      energy: ship.weaponEnergy / 100,
      missiles: ship.missiles,
      flares: ship.flares,
      near: near ? displayName(near).toUpperCase() : null,
      nearDist: near ? formatDist(Math.max(0, nearGap)) : null,
      clock: new Date().toLocaleTimeString('de-DE'),
      cargo,
      cargoTotal: `${ship.getCurrentCargoWeight()} / ${ship.maxCargo} t`,
      sysEngine: ship.systems.engine,
      sysWeapons: ship.systems.weapons,
      sysSensors: ship.systems.sensors,
    };
  }
}
