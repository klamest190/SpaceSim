import * as THREE from 'three';
import { segmentSphere } from './combat';
import { sfx } from './sfx';

// Guided missiles that fly like missiles: dropped from a wing pylon, a moment of free fall, motor ignition,
// a hard boost along the body axis, then guidance by proportional navigation: the seeker watches how fast the line
// of sight to the target turns and steers to stop it turning. Lateral acceleration is limited (a g-limit), so a sharp
// turn at the right moment can still make it overshoot. When the motor burns out it coasts and can barely steer.
// A smoke trail lingers where it went. Without a lock at launch the seeker looks for a target ahead after ignition.

const PROFILES = {
  player: { thrust: 125, maxSpeed: 180, burn: 3.6, aMax: 160, coastAMax: 30, life: 11, nav: 4, seekerCone: 0.5, seekerRange: 950, fuse: 3.2, drop: 0.38 },
  npc: { thrust: 95, maxSpeed: 140, burn: 3.2, aMax: 85, coastAMax: 18, life: 10, nav: 3.5, seekerCone: 0.45, seekerRange: 800, fuse: 2.6, drop: 0.3 },
};

const Z = new THREE.Vector3(0, 0, 1);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const qa = new THREE.Quaternion();

// One shared model: white body, red warhead band, dark nose, four tail fins, a nozzle. Nose points along +Z.
let parts = null;
function missileParts() {
  if (parts) return parts;
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.45, metalness: 0.35, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.5, metalness: 0.7, flatShading: true });
  const red = new THREE.MeshStandardMaterial({ color: 0xa8241a, roughness: 0.5, metalness: 0.3, flatShading: true });
  const body = new THREE.CylinderGeometry(0.085, 0.085, 1.25, 10);
  body.rotateX(Math.PI / 2);
  const nose = new THREE.ConeGeometry(0.085, 0.38, 10);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 0.81);
  const band = new THREE.CylinderGeometry(0.088, 0.088, 0.12, 10);
  band.rotateX(Math.PI / 2);
  band.translate(0, 0, 0.42);
  const nozzle = new THREE.CylinderGeometry(0.06, 0.08, 0.14, 10, 1, true);
  nozzle.rotateX(Math.PI / 2);
  nozzle.translate(0, 0, -0.68);
  const fin = new THREE.BoxGeometry(0.015, 0.2, 0.26);
  fin.translate(0, 0.16, -0.48);
  const fins = [0, 1, 2, 3].map((i) => fin.clone().rotateZ((i * Math.PI) / 2 + Math.PI / 4));
  const canard = new THREE.BoxGeometry(0.012, 0.09, 0.1);
  canard.translate(0, 0.12, 0.5);
  const canards = [0, 1, 2, 3].map((i) => canard.clone().rotateZ((i * Math.PI) / 2 + Math.PI / 4));
  parts = { white, dark, red, body, nose, band, nozzle, fins, canards };
  return parts;
}

function buildModel(fx) {
  const p = missileParts();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(p.body, p.white));
  group.add(new THREE.Mesh(p.nose, p.dark));
  group.add(new THREE.Mesh(p.band, p.red));
  group.add(new THREE.Mesh(p.nozzle, p.dark));
  p.fins.forEach((g) => group.add(new THREE.Mesh(g, p.white)));
  p.canards.forEach((g) => group.add(new THREE.Mesh(g, p.dark)));
  // Exhaust: a white-hot core inside an orange flame, both flickering
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.softTex, color: new THREE.Color(3.2, 1.3, 0.45), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flame.position.z = -0.95;
  flame.visible = false;
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.softTex, color: new THREE.Color(5, 4.2, 3.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  core.position.z = -0.78;
  core.visible = false;
  group.add(flame, core);
  return { group, flame, core };
}

export class Missile {
  constructor(game, owner, pos, dir, target, opts = {}) {
    this.game = game;
    this.owner = owner;
    this.target = target && target.alive !== false ? target : null;
    this.profile = PROFILES[opts.profile || (owner.isPlayer ? 'player' : 'npc')];
    this.damage = opts.damage || 70;
    const model = buildModel(game.fx);
    this.mesh = model.group;
    this.flame = model.flame;
    this.core = model.core;
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.mesh.quaternion.setFromUnitVectors(Z, dir);
    this.heading = dir.clone();
    // Released with the launcher's velocity plus a push away from the pylon
    const ejectDir = opts.eject ? opts.eject.clone() : new THREE.Vector3(0, -1, 0);
    this.vel = (owner.vel ? owner.vel.clone() : new THREE.Vector3()).addScaledVector(ejectDir, 5);
    this.spin = (Math.random() - 0.5) * 3;
    this.age = 0;
    this.burnLeft = this.profile.burn;
    this.phase = 'drop';
    this.smokeTimer = 0;
    this.seekTimer = 0;
    this.flareCheck = 0;
    this.prevPos = this.pos.clone();
    this.alive = true;
    this.radius = 0.5;
    game.scene.add(this.mesh);
  }

  get burning() {
    return this.phase === 'burn';
  }

  // Seconds to impact at the current closing speed, or null
  timeToImpact() {
    if (!this.target || !this.target.pos) return null;
    v1.subVectors(this.target.pos, this.pos);
    const dist = v1.length();
    v2.subVectors(this.vel, this.target.vel || v3.set(0, 0, 0));
    const closing = v2.dot(v1) / Math.max(dist, 1e-3);
    return closing > 1 ? dist / closing : null;
  }

  ignite() {
    this.phase = 'burn';
    this.flame.visible = this.core.visible = true;
    const { fx } = this.game;
    const tail = this.tailPoint(new THREE.Vector3());
    fx.puff(tail, { color: 0xffc080, hdr: 4, from: 0.6, to: 3.2, life: 0.22 });
    fx.sparks(tail, 14, 18, { color: 0xffb060, hdr: 3, dir: this.heading.clone().negate(), spread: 0.6, life: 0.5 });
    for (let i = 0; i < 4; i++) fx.smoke(tail, { vel: v1.copy(this.vel).multiplyScalar(0.6).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4)), from: 0.6, to: 3.2, life: 2.2 });
    sfx.missileIgnite(this.pos);
  }

  tailPoint(out) {
    return out.copy(this.heading).multiplyScalar(-0.9).add(this.pos);
  }

  // Pick something ahead in the seeker's cone (lock-on after launch)
  seek() {
    const { npcs, ship } = this.game;
    const p = this.profile;
    let best = null, bestScore = Infinity;
    const consider = (e) => {
      if (!e || !e.alive || e === this.owner) return;
      v1.subVectors(e.pos, this.pos);
      const d = v1.length();
      if (d > p.seekerRange) return;
      const angle = this.heading.angleTo(v1);
      if (angle > p.seekerCone) return;
      const score = angle * 400 + d;
      if (score < bestScore) { bestScore = score; best = e; }
    };
    if (this.owner === ship) {
      npcs.ships.forEach((n) => { if (n === ship.targetObject || npcs.isHostile(n, ship)) consider(n); });
    } else {
      consider(ship);
      npcs.ships.forEach((n) => { if (npcs.isHostile(this.owner, n)) consider(n); });
    }
    if (best) this.target = best;
  }

  // A flare in front of the seeker may look hotter than the target
  checkFlares() {
    const { combat } = this.game;
    for (const f of combat.flares) {
      if (!this.target || f.owner !== this.target || (f.tested && f.tested.has(this))) continue;
      v1.subVectors(f.pos, this.pos);
      if (v1.length() > 260 || this.heading.angleTo(v1) > this.profile.seekerCone * 1.4) continue;
      (f.tested || (f.tested = new Set())).add(this);
      if (Math.random() < 0.7) {
        if (this.target === this.game.ship || this.owner === this.game.ship) sfx.lockLost();
        this.target = { pos: f.pos, vel: f.vel, radius: 1.5, alive: true, isFlare: true, flare: f };
        return;
      }
    }
  }

  // Proportional navigation, plus a pure pursuit term while the target is far off the nose
  guidance(out) {
    out.set(0, 0, 0);
    const t = this.target;
    if (!t) return out;
    const p = this.profile;
    const r = v1.subVectors(t.pos, this.pos);
    const dist = r.length();
    if (dist < 1e-3) return out;
    const vRel = v2.subVectors(t.vel || v3.set(0, 0, 0), this.vel);
    const rHat = r.clone().divideScalar(dist);
    const closing = -rHat.dot(vRel);
    const omega = r.clone().cross(vRel).divideScalar(dist * dist);
    out.copy(omega).cross(rHat).multiplyScalar(p.nav * Math.max(closing, 20));
    const speed = Math.max(this.vel.length(), 1);
    const vHat = v3.copy(this.vel).divideScalar(speed);
    const off = vHat.angleTo(rHat);
    if (off > 0.35) out.addScaledVector(rHat.sub(vHat.clone().multiplyScalar(vHat.dot(rHat))).normalize(), p.aMax * Math.min(1, off));
    // Only sideways acceleration steers; clamp to what the airframe and thrusters can do
    out.addScaledVector(vHat, -out.dot(vHat));
    const limit = this.burning ? p.aMax : p.coastAMax;
    if (out.lengthSq() > limit * limit) out.setLength(limit);
    return out;
  }

  // Returns false once it is gone
  update(dt) {
    const { fx } = this.game;
    const p = this.profile;
    this.age += dt;
    this.prevPos.copy(this.pos);
    if (this.target && this.target.alive === false) this.target = null;
    if (this.target && this.target.isFlare && this.target.flare.life <= 0) this.target = null;

    if (this.phase === 'drop') {
      this.pos.addScaledVector(this.vel, dt);
      this.mesh.rotateZ(this.spin * dt);
      if (this.age >= p.drop) this.ignite();
      return true;
    }

    this.seekTimer -= dt;
    if (!this.target && this.seekTimer <= 0) {
      this.seekTimer = 0.2;
      this.seek();
    }
    this.flareCheck -= dt;
    if (this.flareCheck <= 0 && this.target && !this.target.isFlare) {
      this.flareCheck = 0.15;
      this.checkFlares();
    }

    const lateral = this.guidance(new THREE.Vector3());
    if (this.burning) {
      this.burnLeft -= dt;
      // The motor pushes along the body; early in the burn it swings the missile onto its course
      this.vel.addScaledVector(this.heading, p.thrust * dt);
      if (this.burnLeft <= 0) {
        this.phase = 'coast';
        this.flame.visible = this.core.visible = false;
        fx.puff(this.tailPoint(v1), { color: 0xffa060, hdr: 2, from: 0.8, to: 2, life: 0.2 });
      }
    }
    this.vel.addScaledVector(lateral, dt);
    // A little pseudo-drag keeps the speed in check during the burn
    const ownerSpeed = this.owner.vel ? this.owner.vel.length() : 0;
    const cap = p.maxSpeed + ownerSpeed * 0.5;
    if (this.vel.lengthSq() > cap * cap) this.vel.setLength(cap);
    this.pos.addScaledVector(this.vel, dt);

    // The body follows the velocity vector, a fraction behind, and rolls slowly
    const speed = this.vel.length();
    if (speed > 1) {
      v1.copy(this.vel).divideScalar(speed);
      this.heading.lerp(v1, Math.min(1, dt * (this.burning ? 7 : 4))).normalize();
    }
    qa.setFromUnitVectors(Z, this.heading);
    this.mesh.quaternion.copy(qa);
    this.spin *= 1 - Math.min(1, dt);
    this.mesh.rotateZ(this.age * 2.2);

    // Flame flicker and smoke
    if (this.burning) {
      const k = 0.85 + Math.random() * 0.3;
      this.flame.scale.set(0.7 * k, 0.7 * k, 1);
      this.core.scale.setScalar(0.32 * k);
      this.smokeTimer -= dt;
      while (this.smokeTimer <= 0) {
        this.smokeTimer += 0.022;
        const tail = this.tailPoint(v2);
        const drift = v3.copy(this.vel).multiplyScalar(0.04).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.6));
        fx.smoke(tail, { vel: drift, from: 0.35, to: 2.8 + Math.random() * 1.4, life: 2.4 + Math.random() * 1.6 });
        fx.puff(tail, { color: 0xff9a40, hdr: 2.2, from: 0.5, to: 0.9, life: 0.08 });
      }
    }

    return this.checkImpact();
  }

  checkImpact() {
    const { ship, npcs } = this.game;
    const p = this.profile;
    const step = v1.subVectors(this.pos, this.prevPos);
    const t = this.target;
    // Proximity fuse, tested along the whole step so a fast missile can't skip through
    if (t && segmentSphere(this.prevPos, step, t.pos, (t.radius || 1) + p.fuse) >= 0) {
      if (!t.isFlare && t.applyHit) t.applyHit(this.damage, this.pos.clone(), this.owner, this.vel, 'missile');
      this.detonate(true);
      return false;
    }
    if (this.age > 0.9) {
      const victims = [ship, ...npcs.ships];
      for (const e of victims) {
        if (e === this.owner || !e.alive) continue;
        if (this.owner !== ship && e.faction === this.owner.faction) continue;
        if (segmentSphere(this.prevPos, step, e.pos, e.radius + 0.3) >= 0) {
          e.applyHit(this.damage, this.pos.clone(), this.owner, this.vel, 'missile');
          this.detonate(true);
          return false;
        }
      }
    }
    if (this.age > p.life) {
      this.detonate(false);
      return false;
    }
    return true;
  }

  // Warhead: a fireball, a fragment ring and a puff of smoke; self-destruct is smaller
  detonate(hit) {
    const { fx } = this.game;
    this.alive = false;
    fx.explosion(this.pos, hit ? 2.2 : 1.1, this.vel.clone().multiplyScalar(0.2));
    fx.sparks(this.pos, hit ? 60 : 20, hit ? 55 : 25, { color: 0xffd090, hdr: 3.5, life: 0.7 });
    for (let i = 0; i < 6; i++) fx.smoke(this.pos.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3)), { vel: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6), from: 2, to: 7, life: 3 + Math.random() * 2, shade: 0.35 });
    sfx.explosionAt(this.pos, hit ? 0.8 : 0.4);
    this.dispose();
  }

  dispose() {
    this.alive = false;
    this.game.scene.remove(this.mesh);
    this.flame.material.dispose();
    this.core.material.dispose();
  }
}
