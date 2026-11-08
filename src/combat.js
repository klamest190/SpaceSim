import * as THREE from 'three';
import { sfx } from './sfx';
import { Missile } from './missiles';

// Everything that flies and hurts: blaster bolts (one instanced draw call for all of them),
// homing missiles and decoy flares. Any entity with pos / vel / radius / alive / faction / applyHit() can be hit.

const MAX_BOLTS = 1400;
const ROCK_REFRESH = 0.25;

export const BOLT_COLORS = {
  player: new THREE.Color(4.2, 0.45, 0.3),
  pirate: new THREE.Color(0.55, 3.6, 0.55),
  police: new THREE.Color(0.55, 1.2, 4.4),
  civil: new THREE.Color(3, 2.4, 0.6),
};

const forwardAxis = new THREE.Vector3(0, 0, 1);
const dummy = new THREE.Object3D();
const segment = new THREE.Vector3();
const toCenter = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const tmp = new THREE.Vector3();

// Fraction along the segment (origin + t * seg, t in 0..1) where it first enters the sphere, or -1
export function segmentSphere(origin, seg, center, radius) {
  toCenter.subVectors(center, origin);
  const lenSq = seg.lengthSq();
  if (lenSq === 0) return toCenter.lengthSq() < radius * radius ? 0 : -1;
  const along = toCenter.dot(seg) / lenSq;
  const clamped = Math.max(0, Math.min(1, along));
  const dx = origin.x + seg.x * clamped - center.x;
  const dy = origin.y + seg.y * clamped - center.y;
  const dz = origin.z + seg.z * clamped - center.z;
  return dx * dx + dy * dy + dz * dz < radius * radius ? clamped : -1;
}

// Where to aim from `pos` so a bolt of `speed` meets a target at tPos moving with relative velocity relVel; null if it can't
export function interceptPoint(pos, tPos, relVel, speed, out) {
  const dx = tPos.x - pos.x, dy = tPos.y - pos.y, dz = tPos.z - pos.z;
  const a = relVel.lengthSq() - speed * speed;
  const b = 2 * (dx * relVel.x + dy * relVel.y + dz * relVel.z);
  const c = dx * dx + dy * dy + dz * dz;
  let t;
  if (Math.abs(a) < 1e-6) {
    t = b !== 0 ? -c / b : -1;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const t1 = (-b - root) / (2 * a), t2 = (-b + root) / (2 * a);
    t = Math.min(t1, t2);
    if (t < 0) t = Math.max(t1, t2);
  }
  if (t < 0) return null;
  return out.set(tPos.x + relVel.x * t, tPos.y + relVel.y * t, tPos.z + relVel.z * t);
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.bolts = [];
    this.freeBolts = [];
    this.missiles = [];
    this.flares = [];
    this.nearRocks = [];
    this.nearStations = [];
    this.nearPlanets = [];
    this.rockTimer = 0;

    const geo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    geo.rotateX(Math.PI / 2);
    this.boltMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), MAX_BOLTS);
    this.boltMesh.frustumCulled = false;
    this.boltMesh.count = 0;
    this.boltMesh.setColorAt(0, BOLT_COLORS.player); // creates the colour buffer
    game.scene.add(this.boltMesh);

  }

  get ships() {
    return this.game.npcs.ships;
  }

  // dir: unit vector, world space. Bolts inherit the shooter's velocity.
  fireBolt(owner, pos, dir, { speed = 250, damage = 5, life = 1.5, color = null, width = 0.05, length = 2.6, inherit = true } = {}) {
    if (this.bolts.length >= MAX_BOLTS) return;
    const bolt = this.freeBolts.pop() || { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion() };
    bolt.pos.copy(pos);
    bolt.vel.copy(dir).multiplyScalar(speed);
    if (inherit && owner.vel) bolt.vel.add(owner.vel);
    bolt.quat.setFromUnitVectors(forwardAxis, dir);
    bolt.owner = owner;
    bolt.damage = damage;
    bolt.life = life;
    bolt.width = width;
    bolt.length = length;
    bolt.color = color || BOLT_COLORS[owner.faction] || BOLT_COLORS.civil;
    this.bolts.push(bolt);
    this.game.fx.puff(pos, { color: bolt.color.getHex(), hdr: 1.5, from: 0.5, to: 1.1, life: 0.06 });
  }

  // opts: damage, profile ('player' | 'npc'), eject (unit vector the pylon pushes it out along)
  fireMissile(owner, pos, dir, target, opts = {}) {
    const missile = new Missile(this.game, owner, pos, dir, target, opts);
    this.missiles.push(missile);
    return missile;
  }

  dropFlare(owner) {
    const dir = owner.vel.clone().normalize().multiplyScalar(-14);
    dir.x += (Math.random() - 0.5) * 16;
    dir.y += (Math.random() - 0.5) * 16;
    dir.z += (Math.random() - 0.5) * 16;
    this.flares.push({ pos: owner.pos.clone(), vel: dir.add(owner.vel), life: 4, owner, puffTimer: 0 });
    sfx.flare();
  }

  // Bodies bolts can strike are looked up a few times a second, near the player only
  refreshObstacles() {
    const { solarSystem, ship } = this.game;
    const p = ship.position;
    this.nearRocks = solarSystem.asteroids.filter((a) => a.mesh.position.distanceToSquared(p) < 1600 * 1600);
    this.nearStations = solarSystem.stations.filter((s) => s.mesh.position.distanceToSquared(p) < 2000 * 2000);
    this.nearPlanets = solarSystem.planets.filter((pl) => pl.group.position.distanceTo(p) < pl.radius + 1200);
  }

  update(dt) {
    this.rockTimer -= dt;
    if (this.rockTimer <= 0) {
      this.rockTimer = ROCK_REFRESH;
      this.refreshObstacles();
    }
    this.updateBolts(dt);
    this.updateMissiles(dt);
    this.updateFlares(dt);
  }

  updateBolts(dt) {
    const { ship } = this.game;
    const ships = this.ships;
    const mesh = this.boltMesh;
    let n = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      segment.copy(b.vel).multiplyScalar(dt);
      let hit = false;

      // The player's ship
      if (b.owner !== ship && ship.alive && segmentSphere(b.pos, segment, ship.position, ship.radius) >= 0) {
        hitPoint.copy(b.pos);
        ship.applyHit(b.damage, hitPoint, b.owner, b.vel);
        hit = true;
      }

      // Other ships: no friendly fire among NPCs of one faction, but the player can hit anyone
      if (!hit) {
        for (let s = 0; s < ships.length; s++) {
          const other = ships[s];
          if (other === b.owner || !other.alive) continue;
          if (b.owner !== ship && other.faction === b.owner.faction) continue;
          const t = segmentSphere(b.pos, segment, other.pos, other.radius);
          if (t >= 0) {
            hitPoint.copy(b.pos).addScaledVector(segment, t);
            other.applyHit(b.damage, hitPoint, b.owner, b.vel);
            hit = true;
            break;
          }
        }
      }

      if (!hit) {
        for (let r = 0; r < this.nearRocks.length; r++) {
          const rock = this.nearRocks[r];
          if (segmentSphere(b.pos, segment, rock.mesh.position, rock.size * 1.05) >= 0) {
            hitPoint.copy(b.pos);
            this.game.hitRock(rock, b.damage, hitPoint, b.owner);
            hit = true;
            break;
          }
        }
      }

      if (!hit) {
        for (let s = 0; s < this.nearStations.length; s++) {
          const st = this.nearStations[s];
          if (segmentSphere(b.pos, segment, st.mesh.position, st.size * 0.85) >= 0) {
            hitPoint.copy(b.pos);
            this.game.fx.sparks(hitPoint, 5, 14, { life: 0.4 });
            this.game.onStationHit(st, b.owner);
            hit = true;
            break;
          }
        }
      }

      if (!hit) {
        for (let p = 0; p < this.nearPlanets.length; p++) {
          const pl = this.nearPlanets[p];
          if (b.pos.distanceToSquared(pl.group.position) < pl.radius * pl.radius) {
            hit = true;
            break;
          }
        }
      }

      if (hit || b.life <= 0) {
        this.freeBolts.push(b);
        this.bolts[i] = this.bolts[this.bolts.length - 1];
        this.bolts.pop();
        continue;
      }

      b.pos.add(segment);
      dummy.position.copy(b.pos);
      dummy.quaternion.copy(b.quat);
      // Long and thin; a touch fatter far away so a bolt never shrinks to nothing on screen
      const w = b.width;
      dummy.scale.set(w, w, b.length);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      mesh.setColorAt(n, b.color);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  updateMissiles(dt) {
    const { ship } = this.game;
    let incoming = 0;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      if (!m.update(dt)) {
        this.missiles.splice(i, 1);
        continue;
      }
      if (m.target === ship && m.phase !== 'drop') incoming++;
    }
    ship.incomingMissiles = incoming;
  }

  removeMissile(i) {
    this.missiles[i].dispose();
    this.missiles.splice(i, 1);
  }

  updateFlares(dt) {
    const { fx } = this.game;
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.life -= dt;
      f.pos.addScaledVector(f.vel, dt);
      f.puffTimer -= dt;
      if (f.puffTimer <= 0) {
        f.puffTimer = 0.07;
        fx.puff(f.pos, { color: 0xffe0a0, hdr: 4, from: 1.6, to: 0.6, life: 0.16 });
        fx.sparks(f.pos, 2, 4, { color: 0xffe0a0, hdr: 2.5, life: 0.4 });
      }
      if (f.life <= 0) this.flares.splice(i, 1);
    }
  }

  clear() {
    this.bolts.forEach((b) => this.freeBolts.push(b));
    this.bolts = [];
    for (let i = this.missiles.length - 1; i >= 0; i--) this.removeMissile(i);
    this.flares = [];
    this.boltMesh.count = 0;
  }
}
