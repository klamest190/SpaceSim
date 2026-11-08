import * as THREE from 'three';
import { controls } from './controls';
import { spaceAudio } from './audio';
import { atmosphereTop } from './solarSystem';
import { difficultyOf } from './difficulty';
import { ShipModel, GUN_MUZZLES } from './shipModel';
import { interceptPoint, BOLT_COLORS } from './combat';
import { emptyCargo, STARTING_DEBT, SUBSYSTEMS } from './world';
import { sfx } from './sfx';

const STANDOFF_GLIDE_SPEED = 2.5; // units/s the pilot closes or opens the gap to a held station with W / S
const DEPARTURE_SPEED = 10.0;  // units/s outward push when the autopilot lets go of a station
const DEPARTURE_TIME = 2.0;   // seconds of push before gravity and the stabilizer take over again
const HOLD_RELEASE_MOUSE = 10; // pixels of mouse movement in one frame that count as steering away from a hold
const BOLT_SPEED = 300;
const GUN_RANGE = 420;
const AIM_ASSIST = THREE.MathUtils.degToRad(2.6); // the guns gimbal this far onto the lead point
const SHIELD_DELAY = 3.0;      // seconds after a hit before shields recharge
const STICK_RESPONSE = 13;     // how quickly the nose follows the mouse
const STICK_LIMIT = 0.5;       // radians of steering the mouse can queue up
const BOOST_DRAIN = 26;
const BOOST_RECHARGE = 13;
const BOOST_SPEED = 1.7;

// Stations differ in size, so the distances around them follow: waiting point, docking range, closest approach
export const stationHoldStandoff = (st) => st.size + 24;
export const stationDockRange = (st) => st.size + 13;
const stationMinStandoff = (st) => st.size + 8;
const stationClearance = (st) => st.size + 7;
const departureRange = (st) => st.size + 26;

// Where the pilot's mouse settings live; the pause menu writes them
export const pilotSettings = { sensitivity: 1, invertY: false };

// Radius of a body's gravity field (also the range in which it is the stabilizer's reference frame)
export function gravityRadius(p) {
  return p.radius * (p.name === 'Sun' ? 1.8 : 4.0);
}

// The autopilot parks this far from a planet's centre: the planet fills much of the view, the atmosphere is a short flight away
export function planetHoldDistance(p) {
  return p.radius * 1.7 + 2.0;
}

// Closer than this to an object, flying there would get you nowhere: you have already arrived
export function arrivalRadius(obj) {
  if (obj.kind === 'station') return stationHoldStandoff(obj) + 1;
  const radius = obj.mesh ? obj.mesh.scale.x : 1;
  return obj.group ? Math.max(radius + 12, planetHoldDistance(obj) + 2) : radius + 12;
}

export class Spaceship {
  constructor(scene, renderer = null) {
    this.renderer = renderer;
    this.scene = scene;
    this.game = null; // set by the game right after construction
    this.isPlayer = true;
    this.faction = 'player';
    this.name = 'SOL 4471';
    this.radius = 1.8;

    // Warp state flag for cinematic autopilot bypass
    this.isWarping = false;
    
    // Destroyed state flag
    this.isDestroyed = false;
    
    // Campaign State & Upgrades
    this.credits = 1000;
    this.debt = STARTING_DEBT;
    this.cargo = emptyCargo();
    this.missionCargoWeight = 0;

    this.upgrades = {
      engine: 1,  // Max Speed, Acceleration & Turn Rate
      shield: 1,  // Max Shield & Shield Recharge Rate
      weapon: 1,  // Damage, Cooldown & Weapon Energy Cost
      cargo: 1,   // Max Cargo Capacity
      armor: 1,   // Max Hull, resistance of the subsystems
      sensor: 1   // Radar range, lock speed
    };

    // Shield quadrants (read and written as one total through the shield property), hull and subsystems
    this.shields = { f: 0, b: 0, l: 0, r: 0 };
    this.shieldDelay = 0;
    this.hull = 100;
    this.systems = { engine: 1, weapons: 1, sensors: 1, warp: 1 };
    this.fuel = 100;
    this.maxFuel = 100;
    this.missiles = 2;
    this.maxMissiles = 6;
    this.flares = 4;
    this.maxFlares = 10;
    this.boost = 100;
    this.boosting = false;
    this.lockProgress = 0;
    this.lockTick = 0;
    this.locked = false;
    this.incomingMissiles = 0;
    this.missileAlarm = 0;
    this.shake = 0;
    this.lastHullHit = 0;
    this.dockedAt = null;
    this.stick = { x: 0, y: 0 };
    
    // Physical state
    this.position = new THREE.Vector3(0, 0, 80); // Start near Earth (Z=80)
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)); // Face Sun
    
    // Rotational velocities
    this.rotationSpeed = {
      pitch: 0,
      yaw: 0,
      roll: 0
    };
    
    this.mouseSensitivity = 0.0018; 
    this.throttle = 0;            // Throttle: 0.0 to 1.0
    this.flightAssist = true;
    this.cameraMode = 'cockpit';   // 'cockpit' or 'chase'
    
    // Scroll Zoom parameters
    this.cameraDistance = 6.0;
    this.minCameraDistance = 3.5;
    this.maxCameraDistance = 30.0;
    
    // Head Look angles
    this.headLook = {
      yaw: 0,
      pitch: 0
    };
    
    // Autopilot Cruise
    this.autopilotActive = false;
    this.autopilotCruiseSpeed = 12000; // units/s
    // Parked at the destination: stationHold rides along with a station, planetHold is the offset from a planet
    this.stationHold = null;
    this.planetHold = null;
    this.holdTarget = null;
    this.holdStandoff = null;

    // Docking State
    this.isDocked = false;
    
    // Weapons State
    this.weaponEnergy = 100;
    this.fireCooldown = 0;
    
    // Targets
    this.targetObject = null;
    
    // Local reference frame (orbital velocity of the nearby planet) and station departure push
    this.frameVelocity = new THREE.Vector3();
    this.departureVelocity = new THREE.Vector3();
    this.departureTime = 0;

    // Gravity physics status
    this.gravityFieldActive = false;
    this.atmosphereContact = 0; // seconds left on the warning after touching an atmosphere floor
    this.gravityPullDir = new THREE.Vector3();
    
    // Apply stats from current upgrades
    this.applyUpgrades();

    // Start with full shield and hull
    this.shield = this.maxShield;
    this.hull = this.maxHull;
    
    // Ship model setup
    this.mesh = this.createSpaceshipMesh();
    this.scene.add(this.mesh);
    
    // Thrusters particles
    this.particles = [];
    this.particleGroup = new THREE.Group();
    this.scene.add(this.particleGroup);
    
    // Flash HUD triggers
    this.shootFlashActive = false;
    this.shootFlashTimer = 0;
    
    this.lastThrottle = 0;
    this.lastAutopilotState = false;
  }

  // Set spaceship stats based on upgrade tier levels
  applyUpgrades() {
    // 1. Engine
    const engineTier = this.upgrades.engine;
    if (engineTier === 1) {
      this.maxSpeed = 32;
      this.acceleration = 36;
      this.turnRate = 1.5;
    } else if (engineTier === 2) {
      this.maxSpeed = 40;
      this.acceleration = 48;
      this.turnRate = 1.8;
    } else if (engineTier === 3) {
      this.maxSpeed = 50;
      this.acceleration = 62;
      this.turnRate = 2.1;
    } else {
      this.maxSpeed = 62;
      this.acceleration = 80;
      this.turnRate = 2.5;
    }

    // 2. Shield
    const shieldTier = this.upgrades.shield;
    if (shieldTier === 1) {
      this.maxShield = 100;
      this.shieldRecharge = 5; // units/s
    } else if (shieldTier === 2) {
      this.maxShield = 150;
      this.shieldRecharge = 7.5;
    } else if (shieldTier === 3) {
      this.maxShield = 220;
      this.shieldRecharge = 11;
    } else {
      this.maxShield = 320;
      this.shieldRecharge = 16;
    }

    // 3. Weapon (Fire cooldown rate, energy cost)
    const weaponTier = this.upgrades.weapon;
    if (weaponTier === 1) {
      this.fireRate = 0.18;
      this.laserEnergyCost = 10;
      this.laserDamage = 6;
    } else if (weaponTier === 2) {
      this.fireRate = 0.15;
      this.laserEnergyCost = 8.5;
      this.laserDamage = 7.5;
    } else if (weaponTier === 3) {
      this.fireRate = 0.12;
      this.laserEnergyCost = 7;
      this.laserDamage = 9;
    } else {
      this.fireRate = 0.09; // rapid fire!
      this.laserEnergyCost = 5.5;
      this.laserDamage = 11;
    }

    // 4. Cargo
    const cargoTier = this.upgrades.cargo;
    if (cargoTier === 1) {
      this.maxCargo = 20;
    } else if (cargoTier === 2) {
      this.maxCargo = 40;
    } else if (cargoTier === 3) {
      this.maxCargo = 70;
    } else {
      this.maxCargo = 120;
    }

    // 5. Armor and sensors
    this.maxHull = [100, 150, 215, 300][this.upgrades.armor - 1];
    this.hull = Math.min(this.hull, this.maxHull);
    this.sensorRange = [2200, 3000, 4000, 5500][this.upgrades.sensor - 1];
    this.lockTime = [1.9, 1.55, 1.25, 0.95][this.upgrades.sensor - 1];

    // Clamp shield to new max
    if (this.shield > this.maxShield) this.shield = this.maxShield;
  }

  get shield() {
    const s = this.shields;
    return s.f + s.b + s.l + s.r;
  }

  set shield(value) {
    const s = this.shields;
    const q = Math.max(0, value) / 4;
    const before = this.shield;
    if (value < before && before > 0) {
      // Taken off all sides in proportion
      const k = Math.max(0, value) / before;
      s.f *= k; s.b *= k; s.l *= k; s.r *= k;
    } else {
      s.f = s.b = s.l = s.r = q;
    }
  }

  // Common entity interface, shared with AI ships: the combat code doesn't care who is who
  get pos() { return this.position; }
  get vel() { return this.velocity; }
  get alive() { return !this.isDestroyed && !this.isDocked && !this.isWarping; }

  // Down in a planet's atmosphere (see surface.js): the guns and the autopilot stay safed
  get inAtmosphere() { return !!(this.game && this.game.surface && this.game.surface.active); }

  getCurrentCargoWeight() {
    return Object.values(this.cargo).reduce((a, b) => a + b, 0) + this.missionCargoWeight;
  }

  // 0 for a stock ship, 1 for a fully upgraded one: the world's dangers scale with this
  powerLevel() {
    const u = this.upgrades;
    return (u.engine + u.shield + u.weapon + u.armor - 4) / 12;
  }

  // Top speed with a damaged engine and any afterburner
  speedLimit() {
    return this.maxSpeed * (0.45 + 0.55 * this.systems.engine) * (this.speedScale || 1);
  }

  // A hit, from whoever. Shields first, on the side that was struck; what gets through hits the hull and maybe a subsystem.
  applyHit(damage, point, attacker, boltVel, kind) {
    if (!this.alive) return;
    const { fx, hud } = this.game;
    damage *= difficultyOf(this.game).damageTaken;
    const local = point.clone().sub(this.position).applyQuaternion(this.quaternion.clone().invert());
    const absX = Math.abs(local.x), absZ = Math.abs(local.z);
    const quad = absZ >= absX ? (local.z < 0 ? 'f' : 'b') : (local.x < 0 ? 'l' : 'r');
    const pan = THREE.MathUtils.clamp(local.x / Math.max(local.length(), 0.01), -0.8, 0.8);

    let rest = damage;
    const absorbed = Math.min(this.shields[quad], rest);
    this.shields[quad] -= absorbed;
    rest -= absorbed;
    this.shieldDelay = SHIELD_DELAY;
    hud.damageFrom(local, rest > 0);

    if (absorbed > 0) {
      fx.shieldFlash(this, this.radius * 1.6, point, 0x70c0ff);
      this.shake = Math.max(this.shake, 0.18);
      sfx.shieldHit(pan);
    }
    if (rest > 0) {
      this.hull -= rest;
      this.lastHullHit = performance.now();
      fx.hullHit(point, this.velocity);
      this.shake = Math.max(this.shake, Math.min(1, 0.4 + rest * 0.03));
      sfx.hullHit(pan);
      this.damageSystems(rest);
    }
    if (kind === 'missile') this.shake = 1;
    if (this.hull <= 0) this.game.triggerShipExplosion(attacker && attacker.name ? attacker.name : 'Feindfeuer');
  }

  damageSystems(amount) {
    const resist = 1.15 - this.upgrades.armor * 0.15;
    if (Math.random() > Math.min(0.7, amount * 0.03) * resist) return;
    const keys = Object.keys(this.systems);
    const key = keys[Math.floor(Math.random() * keys.length)];
    const before = this.systems[key];
    this.systems[key] = Math.max(0, before - (0.12 + Math.random() * 0.22));
    if (before >= 0.35 && this.systems[key] < 0.35) this.game.hud.toast(`${SUBSYSTEMS[key]} schwer beschädigt!`, 'bad');
  }

  // Everything in working order again
  fullRepair() {
    this.hull = this.maxHull;
    Object.keys(this.systems).forEach((k) => { this.systems[k] = 1; });
    this.shield = this.maxShield;
  }

  createSpaceshipMesh() {
    this.model = new ShipModel(this.renderer);
    return this.model.group;
  }

  update(delta, solarSystem) {
    if (delta <= 0) return;
    if (delta > 0.1) delta = 0.1;
    this.lastDelta = delta;

    // 0. If destroyed, freeze physics and sounds
    if (this.isDestroyed) {
      this.velocity.set(0, 0, 0);
      this.rotationSpeed.pitch = 0;
      this.rotationSpeed.yaw = 0;
      this.rotationSpeed.roll = 0;
      this.throttle = 0.0;
      // Stop engine sounds
      spaceAudio.setThrottle(0);
      this.lastThrottle = 0;
      return;
    }

    // 1. If docked, freeze physics entirely and ride along with the station
    if (this.isDocked) {
      this.velocity.set(0, 0, 0);
      this.rotationSpeed.pitch = 0;
      this.rotationSpeed.yaw = 0;
      this.rotationSpeed.roll = 0;
      if (this.dockedAt) {
        this.position.copy(this.stationDockPoint(this.dockedAt, stationHoldStandoff(this.dockedAt), solarSystem));
        this.mesh.position.copy(this.position);
      }
      this.updateWeapons(delta);
      return;
    }

    // 2. Shield recharge: each quadrant fills on its own, after a short pause since the last hit
    if (this.shieldDelay > 0) {
      this.shieldDelay -= delta;
    } else {
      const quarter = this.maxShield / 4;
      const fill = (delta * this.shieldRecharge) / 4;
      Object.keys(this.shields).forEach((q) => { this.shields[q] = Math.min(quarter, this.shields[q] + fill); });
    }
    this.shake = Math.max(0, this.shake - delta * 2.2);
    this.updateBoost(delta);
    this.updateLock(delta);
    this.updateMissileAlarm(delta);

    // 3. Update weapons
    this.updateWeapons(delta);

    // 4. Handle zoom camera
    this.handleScrollZoom();

    // 5. Update steering/autopilot
    this.solarSystem = solarSystem;
    this.updateReferenceFrame(solarSystem);
    if (this.departureTime > 0) this.departureTime = Math.max(0, this.departureTime - delta);

    // Manual throttle while parked or close to a station: the pilot takes over, the autopilot lets go safely.
    // Parked at a station, W / S instead glide the ship in and out, so docking stays a deliberate pilot move;
    // backing out past the waiting point with S lets go, so the hold is never a trap.
    const throttleInput = controls.keys.throttleUp || controls.keys.throttleDown;
    if (this.autopilotActive && throttleInput && this.holdTarget === this.targetObject) {
      const station = this.targetObject;
      if (this.stationHold && controls.keys.throttleDown && this.holdStandoff >= stationHoldStandoff(station)) {
        this.toggleAutopilot();
      } else if (this.stationHold) {
        const glide = (controls.keys.throttleDown ? 1 : -1) * STANDOFF_GLIDE_SPEED * delta;
        this.holdStandoff = THREE.MathUtils.clamp(this.holdStandoff + glide, stationMinStandoff(station), stationHoldStandoff(station));
      } else if (this.planetHold || this.isStationApproach()) {
        this.toggleAutopilot();
      }
    }

    // Steering with the mouse means the pilot wants the stick back: any hold lets go
    const steering = Math.abs(controls.mouseDelta.x) + Math.abs(controls.mouseDelta.y) > HOLD_RELEASE_MOUSE;
    if (this.autopilotActive && steering && !controls.keys.freeLook && this.isHolding()) {
      this.toggleAutopilot();
    }

    if (!this.autopilotActive) {
      this.clearHold();
    }
    if (this.isWarping) {
      // Warp handles steering and physics manually
    } else if (this.autopilotActive) {
      this.handleAutopilot(delta, solarSystem);
    } else {
      this.handleControls(delta);
    }

    // 6. Apply gravity slingshot pulls
    if (solarSystem) {
      this.applyGravityPull(delta, solarSystem);
    }

    // 7. Apply translation and particles
    this.applyPhysics(delta);
    this.emitParticles();
    this.updateParticles(delta);
    this.updateSound();
  }

  updateWeapons(delta) {
    if (this.fireCooldown > 0) {
      this.fireCooldown -= delta;
    }
    
    this.weaponEnergy = Math.min(100, this.weaponEnergy + delta * 22 * (0.4 + 0.6 * this.systems.weapons));

    // Cannot shoot if docked, warping, or destroyed
    if (controls.keys.shoot && this.fireCooldown <= 0 && this.weaponEnergy >= this.laserEnergyCost && !this.autopilotActive && !this.isDocked && !this.isWarping && !this.isDestroyed) {
      if (this.inAtmosphere) this.weaponsSafed();
      else this.fireLasers();
    }

    if (this.shootFlashActive) {
      this.shootFlashTimer -= delta;
      if (this.shootFlashTimer <= 0) {
        this.shootFlashActive = false;
        document.getElementById('laser-flash-l').style.opacity = 0;
        document.getElementById('laser-flash-r').style.opacity = 0;
      }
    }
  }

  weaponsSafed() {
    const now = performance.now();
    if (now - (this.lastSafedNote || 0) < 2500) return;
    this.lastSafedNote = now;
    sfx.denied();
    this.game.hud.toast('Waffen gesichert: kein Feuer in der Atmosphäre', 'warn');
  }

  fireLasers() {
    this.fireCooldown = this.fireRate / (0.4 + 0.6 * this.systems.weapons); // scales with upgrades, slows when damaged
    this.weaponEnergy -= this.laserEnergyCost;
    spaceAudio.playLaserFire();

    this.shootFlashActive = true;
    this.shootFlashTimer = 0.06;
    document.getElementById('laser-flash-l').style.opacity = 0.95;
    document.getElementById('laser-flash-r').style.opacity = 0.95;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    // Guns converge on the lead point when it is close enough to the crosshair, otherwise far ahead
    const lead = this.leadPoint();
    const assisted = lead && forward.angleTo(lead.clone().sub(this.position)) < AIM_ASSIST;
    const aim = assisted ? lead : this.position.clone().addScaledVector(forward, GUN_RANGE * 0.6);
    GUN_MUZZLES.forEach((m) => {
      const pos = m.clone().applyQuaternion(this.quaternion).add(this.position);
      const dir = aim.clone().sub(pos).normalize();
      this.game.combat.fireBolt(this, pos, dir, { speed: BOLT_SPEED, damage: this.laserDamage, life: GUN_RANGE / BOLT_SPEED, color: BOLT_COLORS.player, width: 0.055, length: 3 });
    });
  }

  // Where to shoot to hit the current target, for the gunsight's lead pip; null without a ship targeted
  leadPoint() {
    const t = this.targetObject;
    if (!t || t.kind !== 'npc' || !t.alive) return null;
    const rel = new THREE.Vector3().subVectors(t.vel, this.velocity);
    return interceptPoint(this.position, t.pos, rel, BOLT_SPEED, new THREE.Vector3());
  }

  updateBoost(delta) {
    const wants = controls.keys.boost && !this.autopilotActive && !this.isWarping && this.boost > 1;
    this.boosting = wants && (this.boost > 12 || this.boosting);
    if (this.boosting) this.boost = Math.max(0, this.boost - BOOST_DRAIN * delta);
    else this.boost = Math.min(100, this.boost + BOOST_RECHARGE * delta);
  }

  // Keep the target inside the seeker's cone and the missile locks on
  updateLock(delta) {
    const t = this.targetObject;
    let tracking = false;
    if (t && t.kind === 'npc' && t.alive && this.missiles > 0 && !this.autopilotActive && !this.inAtmosphere) {
      const to = t.pos.clone().sub(this.position);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
      tracking = to.length() < this.sensorRange * 0.45 && forward.angleTo(to) < 0.45;
    }
    if (tracking) {
      const before = this.lockProgress;
      this.lockProgress = Math.min(1, this.lockProgress + (delta / this.lockTime) * (0.4 + 0.6 * this.systems.sensors));
      this.lockTick -= delta;
      if (this.lockProgress < 1 && this.lockTick <= 0) {
        this.lockTick = 0.28 - this.lockProgress * 0.2;
        sfx.lockTick();
      }
      if (before < 1 && this.lockProgress >= 1) {
        this.locked = true;
        sfx.lockOn();
      }
    } else {
      if (this.locked) sfx.lockLost();
      this.locked = false;
      this.lockProgress = Math.max(0, this.lockProgress - delta * 1.5);
    }
  }

  updateMissileAlarm(delta) {
    if (this.incomingMissiles > 0) {
      this.missileAlarm -= delta;
      if (this.missileAlarm <= 0) {
        this.missileAlarm = 0.55;
        sfx.missileAlarmTick();
      }
    } else {
      this.missileAlarm = 0;
    }
  }

  // Right mouse button (or V): a missile drops off the next wing pylon. Locked on, it goes for the target;
  // without a lock its seeker picks up whatever hostile is ahead once the motor lights.
  launchMissile() {
    if (this.inAtmosphere) return this.weaponsSafed();
    const now = performance.now();
    if (this.missiles <= 0 || this.autopilotActive || this.isWarping || !this.alive || now - (this.lastLaunch || 0) < 450) {
      sfx.denied();
      return;
    }
    this.lastLaunch = now;
    this.missiles--;
    this.pylon = this.pylon === 1 ? -1 : 1;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(this.quaternion);
    const side = new THREE.Vector3(this.pylon, 0, 0).applyQuaternion(this.quaternion);
    const from = this.position.clone().addScaledVector(side, 0.95).addScaledVector(down, 0.45).addScaledVector(forward, 0.1);
    const eject = down.clone().multiplyScalar(0.9).addScaledVector(side, 0.25).normalize();
    const target = this.locked ? this.targetObject : null;
    const missile = this.game.combat.fireMissile(this, from, forward, target, { damage: 75, profile: 'player', eject });
    this.game.missileCam.follow(missile);
    sfx.missileRelease(this.pylon * 0.5);
    this.lockProgress = 0;
    this.locked = false;
    this.shake = Math.max(this.shake, 0.12);
  }

  dropFlare() {
    if (this.inAtmosphere) return this.weaponsSafed();
    if (this.flares <= 0 || !this.alive) {
      sfx.denied();
      return;
    }
    this.flares--;
    this.game.combat.dropFlare(this);
  }

  handleScrollZoom() {
    if (controls.zoomDelta === 0) return;

    if (this.cameraMode === 'cockpit') {
      if (controls.zoomDelta > 0) {
        this.cameraMode = 'chase';
        this.cameraDistance = this.minCameraDistance;
      }
    } else if (this.cameraMode === 'chase') {
      const zoomStep = controls.zoomDelta * 0.008;
      this.cameraDistance += zoomStep;

      if (this.cameraDistance < this.minCameraDistance) {
        this.cameraMode = 'cockpit';
        this.cameraDistance = this.minCameraDistance;
      } else if (this.cameraDistance > this.maxCameraDistance) {
        this.cameraDistance = this.maxCameraDistance;
      }
    }
  }

  toggleAutopilot() {
    if (this.isDocked || this.isWarping || this.isDestroyed) return;
    if (this.inAtmosphere) {
      spaceAudio.playAutopilotAlert(false);
      this.game.hud.toast('Autopilot nur im Orbit: steig aus der Atmosphäre', 'warn');
      return;
    }
    if (!this.autopilotActive && !this.targetObject) {
      spaceAudio.playAutopilotAlert(false);
      return;
    }
    const wasStationApproach = this.autopilotActive && this.isStationApproach();
    const wasPlanetHold = this.autopilotActive && !!this.planetHold;
    this.autopilotActive = !this.autopilotActive;
    this.clearHold();
    if (wasStationApproach) this.departFromStation();
    // Parked at a planet: hand over at rest relative to it, so nothing carries the ship into the surface
    if (wasPlanetHold) {
      this.velocity.copy(this.frameVelocity);
      this.throttle = 0;
    }
    spaceAudio.playAutopilotAlert(this.autopilotActive);
  }

  isHolding() {
    return !!(this.stationHold || this.planetHold);
  }

  clearHold() {
    this.stationHold = null;
    this.planetHold = null;
    this.holdTarget = null;
    this.holdStandoff = null;
    this.lastDockPoint = null; // stale samples would turn into a huge dock-point velocity
  }

  isStationApproach() {
    if (!this.targetObject || this.targetObject.kind !== 'station') return false;
    return !!this.stationHold || this.position.distanceTo(this.targetObject.mesh.position) < departureRange(this.targetObject);
  }

  // Unit vector from the station's planet out through the station: the safe side to wait on
  stationOutward(station, solarSystem = this.solarSystem) {
    const planet = solarSystem.planets[station.planetIndex];
    return station.mesh.position.clone().sub(planet.group.position).normalize();
  }

  // Docking point sits on the far side of the station from its planet, so it can never swing into the planet
  stationDockPoint(station, standoff = stationHoldStandoff(station), solarSystem = this.solarSystem) {
    return station.mesh.position.clone().add(this.stationOutward(station, solarSystem).multiplyScalar(standoff));
  }

  // Letting go of a station: keep moving with the planet and drift clear before gravity and the stabilizer take over
  departFromStation() {
    const out = this.position.clone().sub(this.solarSystem.planets[this.targetObject.planetIndex].group.position).normalize();
    this.departureVelocity.copy(out).multiplyScalar(DEPARTURE_SPEED);
    this.departureTime = DEPARTURE_TIME;
    this.velocity.copy(this.frameVelocity).add(this.departureVelocity);
    this.throttle = 0;
  }

  // The planet whose gravity field we are in; the stabilizer holds speed relative to it, not to the Sun
  updateReferenceFrame(solarSystem) {
    this.frameVelocity.set(0, 0, 0);
    if (!solarSystem) return;
    let best = Infinity;
    solarSystem.planets.forEach(p => {
      const dist = this.position.distanceTo(p.group.position);
      if (p.velocity && dist < gravityRadius(p) && dist < best) {
        best = dist;
        this.frameVelocity.copy(p.velocity);
      }
    });
  }

  handleAutopilot(delta, solarSystem) {
    if (!this.targetObject) {
      this.autopilotActive = false;
      spaceAudio.playAutopilotAlert(false);
      return;
    }

    // A new destination (T, R or the nav computer) starts a fresh approach
    if (this.holdTarget !== this.targetObject) {
      this.clearHold();
      this.holdTarget = this.targetObject;
    }

    // Stations orbit fast: close in on the waiting point outside docking range, then ride along with the station
    if (this.targetObject.kind === 'station') {
      if (this.holdStandoff === null) this.holdStandoff = stationHoldStandoff(this.targetObject);
      const dockPoint = this.stationDockPoint(this.targetObject, this.holdStandoff, solarSystem);
      const dockDist = dockPoint.distanceTo(this.position);
      if (this.stationHold || dockDist <= 0.3) {
        this.stationHold = true;
        this.position.copy(dockPoint);
        this.alignTowards(this.stationOutward(this.targetObject, solarSystem).negate(), delta);
        this.velocity.set(0, 0, 0);
        this.throttle = 0;
        return;
      }
      // The dock point circles with the station; match its motion, then close the remaining gap
      const dockVelocity = new THREE.Vector3();
      if (this.lastDockPoint && this.lastDockStation === this.targetObject) {
        dockVelocity.subVectors(dockPoint, this.lastDockPoint).divideScalar(delta);
      }
      this.lastDockPoint = dockPoint.clone();
      this.lastDockStation = this.targetObject;

      const approachDir = this.avoidPlanets(dockPoint, solarSystem);
      if (dockDist < 3.0) {
        this.velocity.copy(dockVelocity).addScaledVector(approachDir, Math.min(6.0, 1.0 + dockDist * 4.0));
      } else {
        const approachSpeed = Math.min(this.autopilotCruiseSpeed, 4.0 + dockDist * 3.0);
        this.velocity.copy(approachDir).multiplyScalar(approachSpeed);
      }
      this.alignTowards(approachDir, delta);
      return;
    }

    // Planets and the Sun: park on the near side at a safe distance and stay there, moving with the planet
    if (solarSystem && solarSystem.planets.includes(this.targetObject)) {
      const planet = this.targetObject;
      const center = planet.group.position;
      if (this.planetHold) {
        this.position.copy(center).add(this.planetHold);
        this.alignTowards(this.planetHold.clone().negate().normalize(), delta);
        this.velocity.set(0, 0, 0);
        this.throttle = 0;
        return;
      }

      const outward = this.position.clone().sub(center);
      if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
      const holdPoint = center.clone().add(outward.normalize().multiplyScalar(planetHoldDistance(planet)));
      const gap = holdPoint.distanceTo(this.position);
      if (gap <= 0.5) {
        this.planetHold = holdPoint.sub(center);
        return;
      }

      // Brake smoothly into the parking point; the planet's own orbital motion is matched on top
      const approachDir = this.avoidPlanets(holdPoint, solarSystem);
      this.alignTowards(approachDir, delta);
      this.velocity.copy(approachDir).multiplyScalar(Math.min(this.autopilotCruiseSpeed, 2.0 + gap * 3.0));
      if (planet.velocity) this.velocity.add(planet.velocity);
      return;
    }

    const targetPos = (this.targetObject.group ? this.targetObject.group.position : this.targetObject.mesh.position).clone();
    const targetDir = this.avoidPlanets(targetPos, solarSystem);
    const distance = targetPos.distanceTo(this.position);

    const targetScale = this.targetObject.mesh ? this.targetObject.mesh.scale.x : 1.0;
    const arrivalThreshold = targetScale + 6.0;

    // Freighters and asteroids: stop in front of them and hand back the stick at rest
    if (distance <= arrivalThreshold) {
      this.autopilotActive = false;
      this.clearHold();
      this.velocity.copy(this.frameVelocity);
      this.throttle = 0;
      spaceAudio.playAutopilotAlert(false);
      return;
    }

    this.alignTowards(targetDir, delta);

    const cruiseMaxSpeed = Math.min(this.autopilotCruiseSpeed, distance * 8.0);
    this.velocity.copy(targetDir.multiplyScalar(cruiseMaxSpeed));
  }

  // Direction towards targetPos, detouring around any planet that blocks the straight line
  avoidPlanets(targetPos, solarSystem) {
    const toTarget = targetPos.clone().sub(this.position);
    const direct = toTarget.clone().normalize();
    if (!solarSystem) return direct;

    // Obstacles: every other planet, and a target station itself, so the approach swings around it to the waiting point
    const obstacles = solarSystem.planets
      .filter(p => p !== this.targetObject)
      .map(p => ({ center: p.group.position, safeRadius: atmosphereTop(p) + 1.8 }));
    if (this.targetObject && this.targetObject.kind === 'station') {
      obstacles.push({ center: this.targetObject.mesh.position, safeRadius: stationClearance(this.targetObject) });
    }

    const lenSq = toTarget.lengthSq();
    for (const { center, safeRadius } of obstacles) {
      const t =THREE.MathUtils.clamp(center.clone().sub(this.position).dot(toTarget) / lenSq, 0, 1);
      const closest = this.position.clone().add(toTarget.clone().multiplyScalar(t));
      const miss = closest.clone().sub(center);
      if (t > 0 && t < 1 && miss.length() < safeRadius) {
        // Push the waypoint out sideways; pick 'up' if the line runs straight through the centre
        if (miss.lengthSq() < 1e-6) miss.set(0, 1, 0).cross(direct);
        if (miss.lengthSq() < 1e-6) miss.set(1, 0, 0);
        const waypoint = center.clone().add(miss.normalize().multiplyScalar(safeRadius + 1.5));
        return waypoint.sub(this.position).normalize();
      }
    }
    return direct;
  }

  alignTowards(targetDir, delta) {
    const shipForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    if (shipForward.dot(targetDir) < 0.9999) {
      const qRotate = new THREE.Quaternion().setFromUnitVectors(shipForward, targetDir);
      const alignSpeed = 3.0;
      // qRotate turns in world space, so it applies after the current orientation
      this.quaternion.slerp(qRotate.multiply(this.quaternion), delta * alignSpeed);
      this.mesh.quaternion.copy(this.quaternion);
    }
  }

  handleControls(delta) {
    if (controls.keys.throttleUp) {
      this.throttle = Math.min(1.0, this.throttle + delta * 0.9);
    }
    if (controls.keys.throttleDown) {
      // Allow reverse flight down to -0.35
      this.throttle = Math.max(-0.35, this.throttle - delta * 0.9);
    }

    if (!controls.keys.freeLook) {
      // The mouse queues up steering, the ship works it off at the rate its thrusters allow, so the nose has
      // weight: quick flicks feel immediate, big sweeps take the time they take
      const sens = this.mouseSensitivity * pilotSettings.sensitivity;
      const stick = this.stick;
      stick.x = THREE.MathUtils.clamp(stick.x + controls.mouseDelta.x * sens, -STICK_LIMIT, STICK_LIMIT);
      stick.y = THREE.MathUtils.clamp(stick.y + controls.mouseDelta.y * sens * (pilotSettings.invertY ? -1 : 1), -STICK_LIMIT, STICK_LIMIT);
      const rate = this.turnRate * (0.5 + 0.5 * this.systems.engine);
      const yaw = THREE.MathUtils.clamp(stick.x * STICK_RESPONSE, -rate, rate) * delta;
      const pitch = THREE.MathUtils.clamp(stick.y * STICK_RESPONSE, -rate, rate) * delta;
      stick.x -= yaw;
      stick.y -= pitch;
      this.rotationSpeed.yaw = -yaw;
      this.rotationSpeed.pitch = -pitch;
    } else {
      this.rotationSpeed.yaw = 0;
      this.rotationSpeed.pitch = 0;
      
      this.headLook.yaw += controls.mouseDelta.x * 0.0035;
      this.headLook.pitch += controls.mouseDelta.y * 0.0035;
      
      this.headLook.yaw = Math.max(-2.0, Math.min(2.0, this.headLook.yaw));
      this.headLook.pitch = Math.max(-0.8, Math.min(0.8, this.headLook.pitch));
    }

    if (!controls.keys.freeLook) {
      this.headLook.yaw += (0 - this.headLook.yaw) * 12.0 * delta;
      this.headLook.pitch += (0 - this.headLook.pitch) * 12.0 * delta;
    }

    const rollSpeed = 1.8;
    if (controls.keys.rollLeft) {
      this.rotationSpeed.roll = rollSpeed;
    } else if (controls.keys.rollRight) {
      this.rotationSpeed.roll = -rollSpeed;
    } else {
      this.rotationSpeed.roll += (0 - this.rotationSpeed.roll) * 5.0 * delta;
    }
  }

  // Newtonian Gravity fields math
  applyGravityPull(delta, solarSystem) {
    this.gravityFieldActive = false;
    
    // Autopilot and warp computers steer around gravity loops automatically; departure thrusters outpull it
    if (this.autopilotActive || this.isWarping || this.departureTime > 0) return;

    solarSystem.planets.forEach(p => {
      const pPos = p.group.position.clone();
      const dist = this.position.distanceTo(pPos);

      if (dist < gravityRadius(p) && dist > p.radius * 0.5) {
        this.gravityFieldActive = true;
        
        const pullDir = pPos.sub(this.position).normalize();
        this.gravityPullDir.copy(pullDir);

        // Surface gravity, falling off with the square of the distance
        const forceMag = p.data.gravity * (p.radius / dist) ** 2;
        const gravityForce = pullDir.multiplyScalar(forceMag * delta);
        
        // Accumulate velocity pulling towards the planet!
        this.velocity.add(gravityForce);
      }
    });
  }

  applyPhysics(delta) {
    if (this.isWarping) {
      // Apply translation during warp
      this.position.add(this.velocity.clone().multiplyScalar(delta));
      this.mesh.position.copy(this.position);
      this.mesh.quaternion.copy(this.quaternion);
      return;
    }

    const localPitch = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
    const localYaw = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
    const localRoll = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);

    const qPitch = new THREE.Quaternion().setFromAxisAngle(localPitch, this.rotationSpeed.pitch);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(localYaw, this.rotationSpeed.yaw);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(localRoll, this.rotationSpeed.roll * delta);

    this.quaternion.premultiply(qPitch).premultiply(qYaw).premultiply(qRoll);
    this.mesh.quaternion.copy(this.quaternion);

    if (!this.autopilotActive) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);

      const limit = this.speedLimit();
      const targetSpeed = this.boosting ? limit * BOOST_SPEED : this.throttle * limit;

      if (this.flightAssist) {
        const idealVelocity = forward.clone().multiplyScalar(targetSpeed);
        
        let strafeDir = 0;
        if (controls.keys.strafeLeft) strafeDir = -1;
        if (controls.keys.strafeRight) strafeDir = 1;
        
        const strafeSpeed = limit * 0.4;
        const strafeVelocity = right.clone().multiplyScalar(strafeDir * strafeSpeed);
        
        // Relative to the local planet, plus the fading push of a station departure
        const combinedIdeal = idealVelocity.add(strafeVelocity).add(this.frameVelocity);
        if (this.departureTime > 0) {
          combinedIdeal.addScaledVector(this.departureVelocity, this.departureTime / DEPARTURE_TIME);
        }
        
        this.velocity.lerp(combinedIdeal, delta * 3.5);
      } else {
        // Flight Assist OFF
        if (Math.abs(this.throttle) > 0.01 || this.boosting) {
          const push = this.boosting ? 2 : this.throttle;
          const force = forward.clone().multiplyScalar(push * this.acceleration * (0.45 + 0.55 * this.systems.engine) * delta);
          this.velocity.add(force);
        }
        
        let strafeDir = 0;
        if (controls.keys.strafeLeft) strafeDir = -1;
        if (controls.keys.strafeRight) strafeDir = 1;
        if (strafeDir !== 0) {
          const force = right.clone().multiplyScalar(strafeDir * this.acceleration * 0.4 * delta);
          this.velocity.add(force);
        }

        // Under Newtonian, gravity slingshots can exceed normal speed limits!
        const currentSpeed = this.velocity.length();
        const limitSpeed = (this.gravityFieldActive ? limit * 2.5 : limit) * (this.boosting ? BOOST_SPEED : 1);
        if (currentSpeed > limitSpeed) {
          this.velocity.setLength(limitSpeed);
        }
      }
    }

    this.position.add(this.velocity.clone().multiplyScalar(delta));
    this.mesh.position.copy(this.position);
  }

  emitParticles() {
    // Disable exhaust particle stream as requested to avoid cluttering the screen
    return;

    const leftLocal = new THREE.Vector3(-0.2, 0, 1.3).applyQuaternion(this.quaternion).add(this.position);
    const rightLocal = new THREE.Vector3(0.2, 0, 1.3).applyQuaternion(this.quaternion).add(this.position);
    const enginePositions = [leftLocal, rightLocal];

    const particleCount = this.autopilotActive ? 5 : Math.ceil(Math.abs(this.throttle) * 3);
    for (let i = 0; i < particleCount; i++) {
      enginePositions.forEach(pos => {
        const drift = new THREE.Vector3(
          (Math.random() - 0.5) * 0.25,
          (Math.random() - 0.5) * 0.25,
          Math.random() * 0.5 + 1.0
        ).applyQuaternion(this.quaternion);

        const pSize = 0.04 + Math.random() * 0.12;
        const pGeom = new THREE.SphereGeometry(pSize, 4, 4);
        
        const pColor = this.autopilotActive ? 0xff6a00 : 0x00f0ff;
        const pMat = new THREE.MeshBasicMaterial({
          color: pColor,
          transparent: true,
          opacity: 0.9
        });
        
        const mesh = new THREE.Mesh(pGeom, pMat);
        mesh.position.copy(pos);
        
        this.particleGroup.add(mesh);
        
        this.particles.push({
          mesh: mesh,
          velocity: drift.multiplyScalar(-1.8 * (Math.abs(this.throttle) + 0.5)),
          life: 0.3 + Math.random() * 0.3,
          maxLife: 0.6
        });
      });
    }
  }

  updateParticles(delta) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta;
      
      if (p.life <= 0) {
        this.particleGroup.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
      } else {
        p.mesh.position.add(p.velocity.clone().multiplyScalar(delta));
        p.mesh.material.opacity = p.life / p.maxLife;
        p.mesh.scale.setScalar(p.life / p.maxLife);
      }
    }
  }

  updateSound() {
    const soundThrottle = this.autopilotActive || this.boosting ? 0.95 : Math.abs(this.throttle);
    
    if (soundThrottle !== this.lastThrottle) {
      spaceAudio.setThrottle(soundThrottle);
      this.lastThrottle = soundThrottle;
    }

    if (this.autopilotActive !== this.lastAutopilotState) {
      spaceAudio.setWarp(this.autopilotActive);
      this.lastAutopilotState = this.autopilotActive;
    }

    // Plumes, nozzle glow and nav lights
    this.model.update(this.lastDelta || 0.016, soundThrottle, this.autopilotActive && !this.isHolding());
  }

  updateCamera(camera, delta) {
    this.placeCamera(camera, delta);
    // Hits shake the view
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.5;
      camera.position.x += (Math.random() - 0.5) * s * 0.3;
      camera.position.y += (Math.random() - 0.5) * s * 0.3;
      camera.rotateX((Math.random() - 0.5) * s * 0.07);
      camera.rotateY((Math.random() - 0.5) * s * 0.07);
      camera.rotateZ((Math.random() - 0.5) * s * 0.1);
    }
  }

  placeCamera(camera, delta) {
    if (this.cameraMode === 'cockpit') {
      const cockpitOffset = new THREE.Vector3(0, 0.05, -0.4);
      cockpitOffset.applyQuaternion(this.quaternion);
      
      const targetCamPos = this.position.clone().add(cockpitOffset);
      camera.position.copy(targetCamPos);

      const targetForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
      const targetUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
      
      const lookAheadDistance = 50;
      
      if (Math.abs(this.headLook.yaw) > 0.001 || Math.abs(this.headLook.pitch) > 0.001) {
        const localRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
        const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
        
        const headQ = new THREE.Quaternion()
          .setFromAxisAngle(localRight, -this.headLook.pitch)
          .premultiply(new THREE.Quaternion().setFromAxisAngle(localUp, -this.headLook.yaw));
          
        targetForward.applyQuaternion(headQ);
        targetUp.applyQuaternion(headQ);
      }
      
      const lookTarget = this.position.clone().add(targetForward.multiplyScalar(lookAheadDistance));
      camera.lookAt(lookTarget);
      camera.up.copy(targetUp);
      
      this.mesh.visible = false;
    } else {
      const cameraOffset = new THREE.Vector3(0, 1.2 * (this.cameraDistance / 6.0), this.cameraDistance);
      cameraOffset.applyQuaternion(this.quaternion);
      
      const targetCamPos = this.position.clone().add(cameraOffset);
      // Frame-rate independent follow; a plain delta * k factor overshoots on a frame hitch
      camera.position.lerp(targetCamPos, 1 - Math.exp(-8.5 * delta));
      
      const targetForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
      const lookTarget = this.position.clone().add(targetForward.multiplyScalar(10));
      camera.lookAt(lookTarget);
      
      const targetUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
      camera.up.copy(targetUp);
      
      this.mesh.visible = !this.isDestroyed; // Hide ship when destroyed
    }
  }
}
