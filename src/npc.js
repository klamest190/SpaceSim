import * as THREE from 'three';
import { SHIP_TYPES, GOOD_KEYS } from './world';
import { ShipVisual } from './npcModels';
import { flightFloor } from './solarSystem';
import { interceptPoint, BOLT_COLORS } from './combat';
import { sfx } from './sfx';

// AI pilots. Every ship flies with limited turn rate and thrust and drifts a little, the same way the player does.
// Each one is a small state machine:
//   patrol / goto / formation / idle ... going about its business, watching its sensors
//   attack ... attack runs: line up on the lead point, shoot, break away at close range, come round again
//   flee ... run for it, then jump out
//   hail ... hold near the player for a talk (pirate demands, police scans)

const FORWARD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const identity = new THREE.Quaternion();

const PIRATE_NAMES = ['Rotauge', 'Knochen', 'Mutter Asche', 'Schiefer', 'Rabenaas', 'Kupfer', 'Stummer Jon', 'Die Zecke', 'Halbmond', 'Glut', 'Sense', 'Vipernzahn', 'Lumpen-Kai', 'Krätze'];
const FREIGHTER_NAMES = ['Morgenrot', 'Lastesel', 'Treue Berta', 'Ceres-Express', 'Gute Hoffnung', 'Schwarzbrot', 'Alte Dame', 'Marsbote', 'Hanse IV', 'Sturmvogel', 'Ida', 'Blaues Band'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function makeName(typeKey, spec, faction) {
  if (faction === 'pirate') return `${spec.label.toUpperCase()} ${pick(PIRATE_NAMES).toUpperCase()}`;
  if (faction === 'police') return `${spec.label.toUpperCase()} ${10 + Math.floor(Math.random() * 89)}-${1 + Math.floor(Math.random() * 9)}`;
  return `${spec.label.toUpperCase()} ${pick(FREIGHTER_NAMES).toUpperCase()}`;
}

export class NPC {
  constructor(game, typeKey, pos, opts = {}) {
    const spec = SHIP_TYPES[typeKey];
    this.game = game;
    this.kind = 'npc';
    this.typeKey = typeKey;
    this.spec = spec;
    this.faction = opts.faction || spec.faction;
    this.level = opts.level || 1;
    this.name = opts.name || makeName(typeKey, spec, this.faction);
    this.radius = spec.radius;
    this.maxHull = this.hull = spec.hull * this.level;
    this.maxShield = this.shield = spec.shield * this.level;
    this.guns = spec.guns;
    this.turn = spec.turn;
    this.maxSpeed = spec.speed * (1 + (this.level - 1) * 0.15);
    this.accel = spec.accel;
    this.skill = Math.min(0.95, spec.skill + (this.level - 1) * 0.12);
    this.missiles = opts.missiles !== undefined ? opts.missiles : spec.missiles || 0;
    this.bounty = opts.bounty !== undefined ? opts.bounty : Math.round(spec.bounty * this.level);
    this.loot = spec.loot;
    this.points = spec.points;

    this.visual = new ShipVisual(typeKey, this.faction, game.renderer);
    this.mesh = this.visual.group;
    this.pos = this.mesh.position;
    this.quat = this.mesh.quaternion;
    this.pos.copy(pos);
    this.vel = new THREE.Vector3();
    this.alive = true;

    if (opts.lookAt) this.lookAt(opts.lookAt);
    const speed = opts.speed !== undefined ? opts.speed : this.maxSpeed * 0.6;
    this.vel.copy(FORWARD).applyQuaternion(this.quat).multiplyScalar(speed);

    this.wing = opts.group || null;
    if (this.wing) this.wing.members.push(this);
    this.leader = opts.leader || null;
    this.slot = opts.slot ? opts.slot.clone() : null;
    this.parent = opts.parent || null;
    this.parentOffset = opts.parentOffset ? opts.parentOffset.clone() : null;
    this.mission = opts.mission || null;
    this.raider = !!opts.raider;
    this.fearless = !!opts.fearless || !!spec.fearless;
    this.protectedName = opts.protectedName || null;

    this.home = { mode: opts.mode || 'patrol', anchor: opts.anchor || pos.clone(), radius: opts.patrolRadius || 500, dest: opts.dest || null, arriveRange: opts.arriveRange || 40, onArrive: opts.onArrive || null, slowArrival: opts.slowArrival !== false };
    this.mode = this.home.mode;
    this.target = null;
    this.phase = 'run';
    this.phaseTime = 0;
    this.breakDir = new THREE.Vector3();
    this.waypoint = null;
    this.thinkTimer = Math.random() * 0.5;
    this.fireCool = Math.random() * 0.5;
    this.missileCool = 6 + Math.random() * 8;
    this.muzzleIndex = 0;
    this.aimError = new THREE.Vector3();
    this.jink = Math.random() * 10;
    this.lastHitTime = -100;
    this.lastAttacker = null;
    this.avoid = new THREE.Vector3();
    this.thrust = 0.5;
    this.aggro = !!opts.aggro;
    this.crimeHits = 0;
    this.distressSent = false;
    this.leaving = 0;
    this.holdRange = 170;
    this.shieldDelay = 0;
    this.timeAlive = 0;

    this.trail = game.fx.addTrail(this.faction === 'police' ? 0x3a6ec0 : this.faction === 'pirate' ? 0xb04a20 : 0x8a7038, spec.radius > 5 ? 0.9 : 0.55);
    game.scene.add(this.mesh);
  }

  get position() { return this.pos; }

  lookAt(point) {
    const m = new THREE.Matrix4().lookAt(this.pos, point, UP);
    this.quat.setFromRotationMatrix(m);
  }

  forward(out = v1) {
    return out.copy(FORWARD).applyQuaternion(this.quat);
  }

  // Back to what it was doing before the fight
  resume() {
    this.target = null;
    this.mode = this.home.mode;
    this.phase = 'run';
  }

  attack(target) {
    if (!this.guns || !target || !target.alive) return;
    this.target = target;
    if (this.mode !== 'flee') this.mode = 'attack';
    this.phase = 'run';
  }

  // --- awareness --------------------------------------------------------------------------

  sensorRange() {
    return this.radius > 5 ? 1500 : 1100;
  }

  findHostile() {
    const npcs = this.game.npcs;
    const range = this.sensorRange();
    let best = null;
    let bestScore = Infinity;
    const consider = (other) => {
      if (!other.alive || other === this || !npcs.isHostile(this, other)) return;
      let d = other.pos.distanceTo(this.pos);
      if (d > range) return;
      if (other === this.lastAttacker) d *= 0.4;
      if (other === this.target) d *= 0.7;
      if (d < bestScore) { bestScore = d; best = other; }
    };
    consider(this.game.ship);
    npcs.ships.forEach(consider);
    return best;
  }

  think() {
    this.thinkTimer = 0.35 + Math.random() * 0.25;
    this.computeAvoidance();

    if (this.mode === 'attack') {
      if (!this.target || !this.target.alive || !this.game.npcs.isHostile(this, this.target) || this.target.pos.distanceTo(this.pos) > this.sensorRange() * 1.6) {
        const next = this.findHostile();
        if (next) this.attack(next);
        else this.resume();
      } else if (Math.random() < 0.1) {
        const next = this.findHostile();
        if (next && next !== this.target) this.target = next;
      }
      // Aim wanders a bit between shots; worse pilots wander further
      const wander = (1 - this.skill) * 0.028;
      this.aimError.set((Math.random() - 0.5) * wander, (Math.random() - 0.5) * wander, (Math.random() - 0.5) * wander);
    } else if (this.guns && this.mode !== 'flee' && this.mode !== 'hail' && this.mode !== 'jumping') {
      const hostile = this.findHostile();
      if (hostile) this.attack(hostile);
    }

    if (this.mode !== 'flee' && !this.fearless && this.guns && this.hull / this.maxHull < 0.3 && Math.random() < 0.3) {
      this.flee(this.lastAttacker || this.target);
    }
  }

  flee(from) {
    this.mode = 'flee';
    this.fleeFrom = from;
    this.leaving = 7 + Math.random() * 7;
    this.game.encounters.onFlee(this);
  }

  // Steer clear of planets, stations and rocks; recomputed a few times a second
  computeAvoidance() {
    const { solarSystem, combat } = this.game;
    const avoid = this.avoid.set(0, 0, 0);
    const look = 12 + this.vel.length() * 1.2;
    for (const p of solarSystem.planets) {
      const d = p.group.position.distanceTo(this.pos);
      const floor = p.name === 'Sun' ? p.radius * 1.3 : flightFloor(p) + 18;
      if (d < floor + look * 2) {
        v2.subVectors(this.pos, p.group.position).normalize();
        avoid.addScaledVector(v2, 2.5 * (1 - (d - floor) / (look * 2)));
      }
    }
    for (const st of combat.nearStations) {
      const d = st.mesh.position.distanceTo(this.pos);
      const safe = st.size + this.radius + 8;
      if (d < safe + look) {
        v2.subVectors(this.pos, st.mesh.position).normalize();
        avoid.addScaledVector(v2, 2 * (1 - (d - safe) / look));
      }
    }
    for (const rock of combat.nearRocks) {
      const d = rock.mesh.position.distanceTo(this.pos);
      const safe = rock.size + this.radius + 4;
      if (d < safe + look) {
        v2.subVectors(this.pos, rock.mesh.position).normalize();
        avoid.addScaledVector(v2, 2 * (1 - (d - safe) / look));
      }
    }
  }

  // --- flying -------------------------------------------------------------------------------

  fly(dt, desired, speedFrac) {
    const fwd = v1.copy(FORWARD).applyQuaternion(this.quat);
    const dir = v2.copy(desired);
    if (this.avoid.lengthSq() > 0) dir.addScaledVector(this.avoid, 1.6);
    if (dir.lengthSq() < 1e-8) dir.copy(fwd);
    dir.normalize();

    const angle = fwd.angleTo(dir);
    if (angle > 1e-3 && this.turn > 0) {
      q1.setFromUnitVectors(fwd, dir);
      const t = Math.min(1, (this.turn * dt) / angle);
      this.quat.premultiply(identity.clone().slerp(q1, t)).normalize();
    }

    // Bank into the turn, level out afterwards
    if (this.turn > 0 && !this.parent) {
      const f = v1.copy(FORWARD).applyQuaternion(this.quat);
      const right = v3.crossVectors(f, UP);
      if (right.lengthSq() > 0.01) {
        right.normalize();
        const lateral = THREE.MathUtils.clamp(dir.dot(right), -1, 1);
        const wantRoll = lateral * 0.9;
        const curUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
        const curRoll = Math.atan2(curUp.dot(right), curUp.dot(new THREE.Vector3().crossVectors(right, f)));
        const delta = THREE.MathUtils.clamp(wantRoll - curRoll, -2 * dt, 2 * dt);
        this.quat.premultiply(q1.setFromAxisAngle(f, -delta)).normalize();
      }
    }

    // Velocity chases where the nose points, with limited thrust: heavy ships carry their momentum
    const want = v3.copy(FORWARD).applyQuaternion(this.quat).multiplyScalar(this.maxSpeed * speedFrac);
    const diff = want.sub(this.vel);
    const maxDelta = this.accel * dt;
    if (diff.lengthSq() > maxDelta * maxDelta) diff.setLength(maxDelta);
    this.vel.add(diff);
    this.pos.addScaledVector(this.vel, dt);
    this.thrust += (Math.min(1, Math.abs(speedFrac)) - this.thrust) * Math.min(1, dt * 3);
  }

  update(dt) {
    this.timeAlive += dt;
    this.fireCool -= dt;
    this.missileCool -= dt;
    this.thinkTimer -= dt;
    this.jink += dt;
    if (this.thinkTimer <= 0) this.think();

    if (this.shieldDelay > 0) this.shieldDelay -= dt;
    else if (this.shield < this.maxShield) this.shield = Math.min(this.maxShield, this.shield + dt * this.maxShield * 0.035);

    if (this.parent) {
      if (!this.parent.alive) {
        this.die(null);
        return;
      }
      this.pos.copy(this.parentOffset).applyQuaternion(this.parent.quat).add(this.parent.pos);
      this.vel.copy(this.parent.vel);
    }

    switch (this.mode) {
      case 'attack': this.doAttack(dt); break;
      case 'flee': this.doFlee(dt); break;
      case 'goto': this.doGoto(dt); break;
      case 'patrol': this.doPatrol(dt); break;
      case 'formation': this.doFormation(dt); break;
      case 'hail': this.doHail(dt); break;
      case 'jumping': this.doJumping(dt); break;
      default:
        this.fly(dt, this.forward(v3).clone(), this.spec.immobile ? 0 : 0.15);
    }

    if (this.spec.immobile) this.vel.set(0, 0, 0);

    // Hard floor: an AI never goes into a planet, whatever its steering wanted
    for (const p of this.game.combat.nearPlanets) {
      if (p.name === 'Sun') continue;
      const floor = flightFloor(p) + 4;
      if (p.group.position.distanceToSquared(this.pos) < floor * floor) {
        v1.subVectors(this.pos, p.group.position).setLength(floor);
        this.pos.copy(p.group.position).add(v1);
      }
    }

    this.visual.update(dt, this.thrust);
    const trailFrom = v1.copy(this.visual.tail).applyQuaternion(this.quat).add(this.pos);
    this.game.fx.feedTrail(this.trail, trailFrom, dt);
  }

  doAttack(dt) {
    const target = this.target;
    if (!target || !target.alive) {
      this.thinkTimer = 0;
      this.fly(dt, this.forward(v3).clone(), 0.5);
      return;
    }
    const toTarget = new THREE.Vector3().subVectors(target.pos, this.pos);
    const dist = toTarget.length();
    const guns = this.guns;

    // Lead the target, in the shooter's frame because bolts inherit velocity
    const rel = new THREE.Vector3().subVectors(target.vel || v3.set(0, 0, 0), this.vel);
    const aimPoint = new THREE.Vector3();
    if (!interceptPoint(this.pos, target.pos, rel, guns.speed, aimPoint)) aimPoint.copy(target.pos);
    const aimDir = aimPoint.sub(this.pos).normalize();
    aimDir.add(this.aimError).normalize();

    const breakRange = 26 + this.radius * 2.5 + (1 - this.skill) * 18;
    let desired = aimDir;
    let speed = dist > 220 ? 1 : 0.82;

    if (!this.spec.immobile) {
      if (this.phase === 'run' && dist < breakRange && this.radius < 5) {
        // Too close: break away sideways, past the target
        this.phase = 'break';
        this.phaseTime = 1.4 + Math.random() * 1.8;
        const side = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(toTarget).normalize();
        this.breakDir.copy(side).multiplyScalar(1.2).addScaledVector(toTarget, -0.25 / Math.max(dist, 1)).normalize();
      }
      if (this.phase === 'break') {
        this.phaseTime -= dt;
        desired = this.breakDir;
        speed = 1;
        if (this.phaseTime <= 0) this.phase = 'run';
      } else if (this.radius >= 5 && dist < 180) {
        // Big ships keep moving broadside rather than ramming, and let their turrets work
        const side = new THREE.Vector3().crossVectors(toTarget, UP).normalize();
        desired = side;
        speed = 0.7;
      } else if (performance.now() - this.lastHitTime * 1000 < 2500) {
        // Under fire: jink so the pilot behind has to work for it
        const s = Math.sin(this.jink * 3.1) * 0.5;
        const c = Math.cos(this.jink * 2.3) * 0.5;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
        desired = aimDir.clone().addScaledVector(right, s).addScaledVector(up, c).normalize();
      }
    }

    this.fly(dt, desired, speed);

    const fwd = this.forward(v1);
    const offAxis = fwd.angleTo(aimDir);
    const cone = guns.allRound ? Math.PI : 0.09 + (1 - this.skill) * 0.08;
    if (dist < guns.range && offAxis < cone && this.fireCool <= 0) this.shoot(aimDir, target);
    if (this.missiles > 0 && this.missileCool <= 0 && dist > 120 && dist < 650 && offAxis < 0.7) this.launchMissile(target, fwd);
  }

  shoot(aimDir) {
    const guns = this.guns;
    this.fireCool = guns.cool * (0.85 + Math.random() * 0.35);
    const muzzles = this.visual.muzzles;
    const local = muzzles[this.muzzleIndex % Math.max(muzzles.length, 1)] || v2.set(0, 0, -this.radius);
    this.muzzleIndex++;
    const from = v3.copy(local).applyQuaternion(this.quat).add(this.pos);
    const spread = (1 - this.skill) * 0.018;
    const dir = aimDir.clone();
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    this.game.combat.fireBolt(this, from, dir, {
      speed: guns.speed, damage: guns.damage * this.level, life: guns.range / guns.speed, color: BOLT_COLORS[this.faction],
      width: this.radius > 5 ? 0.09 : 0.055, length: 2.8,
    });
    sfx.npcLaser(from, this.faction);
  }

  launchMissile(target, fwd) {
    this.missiles--;
    this.missileCool = 14 + Math.random() * 12;
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(this.quaternion);
    const from = v3.copy(fwd).multiplyScalar(this.radius * 0.3).addScaledVector(down, this.radius * 0.5 + 0.4).add(this.pos);
    this.game.combat.fireMissile(this, from.clone(), fwd.clone(), target, { damage: 26 * this.level, profile: 'npc', eject: down });
    sfx.missileRelease(0, from);
  }

  doFlee(dt) {
    this.leaving -= dt;
    const from = this.fleeFrom && this.fleeFrom.alive ? this.fleeFrom.pos : null;
    const dir = from ? v3.subVectors(this.pos, from).normalize() : this.forward(v3);
    this.fly(dt, dir.clone(), 1.1);
    if (this.leaving <= 0) this.jumpOut();
  }

  doGoto(dt) {
    const { dest, arriveRange, onArrive, slowArrival } = this.home;
    const destPos = dest && dest.mesh ? dest.mesh.position : dest;
    if (!destPos) {
      this.fly(dt, this.forward(v3).clone(), 0.5);
      return;
    }
    const to = new THREE.Vector3().subVectors(destPos, this.pos);
    const dist = to.length();
    if (dist < arriveRange) {
      if (onArrive) onArrive(this);
      else this.jumpOut();
      return;
    }
    const speed = slowArrival ? THREE.MathUtils.clamp(dist / 80, 0.25, 1) : 1;
    this.fly(dt, to.normalize(), speed);
  }

  doPatrol(dt) {
    const anchor = this.home.anchor && this.home.anchor.mesh ? this.home.anchor.mesh.position : this.home.anchor;
    if (!this.waypoint || this.waypoint.distanceTo(this.pos) < 30 || this.waypointTimer <= 0) {
      const a = Math.random() * Math.PI * 2;
      const r = this.home.radius * (0.5 + Math.random() * 0.5);
      this.waypointOffset = new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * r * 0.25, Math.sin(a) * r);
      this.waypoint = new THREE.Vector3();
      this.waypointTimer = 30;
    }
    this.waypointTimer -= dt;
    this.waypoint.copy(anchor).add(this.waypointOffset);
    this.fly(dt, new THREE.Vector3().subVectors(this.waypoint, this.pos).normalize(), this.radius > 5 ? 0.6 : 0.55);
  }

  doFormation(dt) {
    const leader = this.leader;
    if (!leader || !leader.alive) {
      this.leader = null;
      this.home.mode = 'patrol';
      this.home.anchor = this.pos.clone();
      this.mode = 'patrol';
      return;
    }
    const spot = new THREE.Vector3().copy(this.slot || v2.set(12, 0, 12)).applyQuaternion(leader.quat || identity).add(leader.pos);
    const to = spot.sub(this.pos);
    const dist = to.length();
    const leaderSpeed = leader.vel ? leader.vel.length() : 0;
    const speed = THREE.MathUtils.clamp((leaderSpeed + dist * 0.5) / this.maxSpeed, 0, 1.15);
    if (dist < 4 && leader.vel && leaderSpeed > 1) {
      this.fly(dt, leader.vel.clone().normalize(), speed);
    } else {
      this.fly(dt, to.lengthSq() > 0.01 ? to.normalize() : this.forward(v3).clone(), speed);
    }
  }

  // Hold station by the player while they talk
  doHail(dt) {
    const ship = this.game.ship;
    const to = new THREE.Vector3().subVectors(ship.position, this.pos);
    const dist = to.length();
    if (!ship.alive) {
      this.resume();
      return;
    }
    const gap = dist - this.holdRange;
    const dir = to.normalize();
    if (Math.abs(gap) < 25) {
      // Parked: nose on the player, match speed
      const wantSpeed = ship.velocity.length() / this.maxSpeed;
      this.fly(dt, dir, Math.min(1, wantSpeed));
    } else if (gap > 0) {
      this.fly(dt, dir, 1);
    } else {
      this.fly(dt, dir.clone().negate(), 0.5);
    }
  }

  jumpOut() {
    if (!this.alive || this.mode === 'jumping') return;
    this.mode = 'jumping';
    this.leaving = 1.1;
  }

  doJumping(dt) {
    this.leaving -= dt;
    this.fly(dt, this.forward(v3).clone(), 1.4);
    this.vel.multiplyScalar(1 + dt * 1.2);
    if (this.leaving <= 0) {
      this.game.fx.warpFlash(this.pos, this.forward(v3).clone());
      sfx.warpBy(this.pos);
      this.game.npcs.remove(this);
    }
  }

  // --- taking damage --------------------------------------------------------------------------

  applyHit(damage, point, attacker, boltVel, kind) {
    if (!this.alive) return;
    const { fx, law, ship } = this.game;
    this.lastHitTime = performance.now() / 1000;
    this.lastAttacker = attacker && attacker.alive !== false ? attacker : this.lastAttacker;
    this.shieldDelay = 3.5;

    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, damage);
      this.shield -= absorbed;
      damage -= absorbed;
      fx.shieldFlash(this, this.radius, point, this.faction === 'pirate' ? 0x70ff90 : 0x60a0ff);
    }
    if (damage > 0) {
      this.hull -= damage;
      fx.hullHit(point, this.vel);
    }

    if (attacker === ship) {
      this.aggro = this.faction !== 'civil';
      law.reportHit(this);
      this.game.hud.hitMarker(this.shield <= 0);
      sfx.hitConfirm(this.shield <= 0);
      if (this.wing) {
        // One shot at them is a shot at all of them
        this.wing.truce = false;
        this.wing.aggro = true;
      }
    }

    // Shoot back, or run if there is nothing to shoot with
    if (this.hull > 0 && attacker && attacker !== this && attacker.alive !== false) {
      if (!this.guns) {
        if (this.mode !== 'flee' && this.mode !== 'jumping' && !this.fearless) {
          this.flee(attacker);
          this.game.encounters.distress(this, attacker);
        }
      } else if (this.mode !== 'attack' && this.mode !== 'flee' && this.mode !== 'jumping') {
        this.attack(attacker);
      }
      this.game.npcs.callForHelp(this, attacker);
    }

    if (this.hull <= 0) this.die(attacker);
  }

  die(killer) {
    if (!this.alive) return;
    const { fx, npcs } = this.game;
    fx.explosion(this.pos, this.radius, this.vel);
    sfx.explosionAt(this.pos, Math.min(2.5, this.radius / 3));
    this.game.onNpcKilled(this, killer);
    npcs.remove(this);
  }

  // What is left behind when it blows up
  lootGoods() {
    const list = [];
    if (!this.loot) return list;
    const table = this.faction === 'pirate' ? ['arms', 'stims', 'tech', 'lux', 'med'] : GOOD_KEYS.filter((g) => g !== 'arms' && g !== 'stims');
    const n = Math.ceil(this.loot * (0.5 + Math.random() * 0.5));
    for (let i = 0; i < n; i++) list.push(pick(table));
    return list;
  }
}

export class NPCManager {
  constructor(game) {
    this.game = game;
    this.ships = [];
    this.nextGroupId = 1;
  }

  newGroup(extra = {}) {
    return { id: this.nextGroupId++, members: [], truce: false, aggro: false, ...extra };
  }

  spawn(type, pos, opts = {}) {
    const npc = new NPC(this.game, type, pos, opts);
    this.ships.push(npc);
    return npc;
  }

  // Drops out of a jump in a flash
  arrive(type, pos, opts = {}) {
    const npc = this.spawn(type, pos, opts);
    this.game.fx.warpFlash(pos, npc.forward(new THREE.Vector3()).negate());
    sfx.warpBy(pos);
    return npc;
  }

  remove(npc) {
    if (!npc.alive) return;
    npc.alive = false;
    const { scene, fx, ship, encounters } = this.game;
    scene.remove(npc.mesh);
    fx.endTrail(npc.trail);
    const i = this.ships.indexOf(npc);
    if (i !== -1) this.ships.splice(i, 1);
    if (ship.targetObject === npc) ship.targetObject = null;
    encounters.onRemoved(npc);
  }

  clearAll() {
    [...this.ships].forEach((n) => this.remove(n));
  }

  isHostile(a, b) {
    if (a === b) return false;
    const { ship, law } = this.game;
    if (b === ship || a === ship) {
      const npc = a === ship ? b : a;
      if (npc.wing && npc.wing.aggro && npc.faction !== 'civil') return true;
      if (npc.aggro && npc.faction !== 'police') return true;
      if (npc.wing && npc.wing.truce) return false;
      if (npc.faction === 'pirate') return law.piratesHostile();
      if (npc.faction === 'police') return law.wanted >= 2;
      return false;
    }
    if (a.faction === b.faction) return false;
    if ((a.faction === 'pirate' && b.faction === 'police') || (a.faction === 'police' && b.faction === 'pirate')) return true;
    if (a.faction === 'pirate' && b.faction === 'civil') return a.raider;
    if (b.faction === 'pirate' && a.faction === 'civil') return b.raider;
    return false;
  }

  // Wingmen and nearby friends turn on whoever just fired
  callForHelp(victim, attacker) {
    this.ships.forEach((other) => {
      if (other === victim || !other.guns || other.mode === 'attack' || other.mode === 'flee' || other.mode === 'jumping') return;
      const sameGroup = victim.wing && other.wing === victim.wing;
      const lawful = victim.faction !== 'pirate' && other.faction === 'police';
      if (!sameGroup && !lawful) return;
      if (!sameGroup && other.pos.distanceTo(victim.pos) > 1200) return;
      if (attacker === this.game.ship && lawful && this.game.law.wanted < 2) return; // not until it counts as a crime
      if (attacker.faction === other.faction) return;
      other.attack(attacker);
    });
  }

  count(predicate) {
    return this.ships.reduce((n, s) => n + (predicate(s) ? 1 : 0), 0);
  }

  update(dt) {
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const npc = this.ships[i];
      if (npc && npc.alive) npc.update(dt);
    }
  }
}
