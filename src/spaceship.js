import * as THREE from 'three';
import { controls } from './controls';
import { spaceAudio } from './audio';
import { atmosphereTop } from './solarSystem';
import { ShipModel, GUN_MUZZLES } from './shipModel';

const DOCK_STANDOFF = 1.5;    // closest the pilot can glide in to a station, away from its planet
export const STATION_HOLD_STANDOFF = 4.0; // the autopilot waits here: outside docking range (2.5), the pilot glides in
const STATION_CLEARANCE = 3.0;   // the autopilot's approach stays this far from a station, clear of docking range
const STANDOFF_GLIDE_SPEED = 1.5; // units/s the pilot closes or opens the gap to a held station with W / S
const DEPARTURE_RANGE = 4.5;  // closer than this to the station, cancelling counts as undocking
const DEPARTURE_SPEED = 6.0;  // units/s outward push when the autopilot lets go of a station
const DEPARTURE_TIME = 2.0;   // seconds of push before gravity and the stabilizer take over again
const HOLD_RELEASE_MOUSE = 10; // pixels of mouse movement in one frame that count as steering away from a hold

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
  if (obj.kind === 'station') return 5;
  const radius = obj.mesh ? obj.mesh.scale.x : 1;
  return obj.group ? Math.max(radius + 12, planetHoldDistance(obj) + 2) : radius + 12;
}

export class Spaceship {
  constructor(scene, renderer = null) {
    this.renderer = renderer;
    this.scene = scene;
    
    // Warp state flag for cinematic autopilot bypass
    this.isWarping = false;
    
    // Destroyed state flag
    this.isDestroyed = false;
    
    // Campaign State & Upgrades
    this.credits = 1000;
    this.cargo = {
      ore: 0,
      ice: 0,
      tech: 0
    };
    
    this.upgrades = {
      engine: 1,  // Max Speed & Acceleration
      shield: 1,  // Max Shield & Shield Recharge Rate
      weapon: 1,  // Cooldown & Weapon Energy Cost
      cargo: 1    // Max Cargo Capacity
    };
    
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
    this.holdStandoff = STATION_HOLD_STANDOFF;

    // Docking State
    this.isDocked = false;
    
    // Weapons State
    this.weaponEnergy = 100;
    this.fireCooldown = 0;
    this.laserBolts = [];
    this.laserGroup = new THREE.Group();
    this.scene.add(this.laserGroup);
    
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
    
    // Start with full shield
    this.shield = this.maxShield;
    
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
      this.maxSpeed = 30;
      this.acceleration = 36;
    } else if (engineTier === 2) {
      this.maxSpeed = 44;
      this.acceleration = 50;
    } else if (engineTier === 3) {
      this.maxSpeed = 60;
      this.acceleration = 68;
    } else {
      this.maxSpeed = 80;
      this.acceleration = 92;
    }

    // 2. Shield
    const shieldTier = this.upgrades.shield;
    if (shieldTier === 1) {
      this.maxShield = 100;
      this.shieldRecharge = 2; // units/s
    } else if (shieldTier === 2) {
      this.maxShield = 150;
      this.shieldRecharge = 4.5;
    } else if (shieldTier === 3) {
      this.maxShield = 220;
      this.shieldRecharge = 8;
    } else {
      this.maxShield = 320;
      this.shieldRecharge = 14;
    }

    // 3. Weapon (Fire cooldown rate, energy cost)
    const weaponTier = this.upgrades.weapon;
    if (weaponTier === 1) {
      this.fireRate = 0.18;
      this.laserEnergyCost = 10;
    } else if (weaponTier === 2) {
      this.fireRate = 0.15;
      this.laserEnergyCost = 8.5;
    } else if (weaponTier === 3) {
      this.fireRate = 0.12;
      this.laserEnergyCost = 7;
    } else {
      this.fireRate = 0.09; // rapid fire!
      this.laserEnergyCost = 5.5;
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

    // Clamp shield to new max
    if (this.shield > this.maxShield) this.shield = this.maxShield;
  }

  getCurrentCargoWeight() {
    return this.cargo.ore + this.cargo.ice + this.cargo.tech;
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

    // 1. If docked, freeze physics entirely
    if (this.isDocked) {
      this.velocity.set(0, 0, 0);
      this.rotationSpeed.pitch = 0;
      this.rotationSpeed.yaw = 0;
      this.rotationSpeed.roll = 0;
      this.updateWeapons(delta);
      return;
    }

    // 2. Shield auto recharge
    this.shield = Math.min(this.maxShield, this.shield + delta * this.shieldRecharge);

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
      if (this.stationHold && controls.keys.throttleDown && this.holdStandoff >= STATION_HOLD_STANDOFF) {
        this.toggleAutopilot();
      } else if (this.stationHold) {
        const glide = (controls.keys.throttleDown ? 1 : -1) * STANDOFF_GLIDE_SPEED * delta;
        this.holdStandoff = THREE.MathUtils.clamp(this.holdStandoff + glide, DOCK_STANDOFF, STATION_HOLD_STANDOFF);
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
    
    this.weaponEnergy = Math.min(100, this.weaponEnergy + delta * 22);

    // Cannot shoot if docked, warping, or destroyed
    if (controls.keys.shoot && this.fireCooldown <= 0 && this.weaponEnergy >= this.laserEnergyCost && !this.autopilotActive && !this.isDocked && !this.isWarping && !this.isDestroyed) {
      this.fireLasers();
    }

    for (let i = this.laserBolts.length - 1; i >= 0; i--) {
      const bolt = this.laserBolts[i];
      bolt.life -= delta;
      
      if (bolt.life <= 0) {
        this.laserGroup.remove(bolt.mesh);
        bolt.mesh.geometry.dispose();
        bolt.mesh.material.dispose();
        this.laserBolts.splice(i, 1);
      } else {
        bolt.mesh.position.add(bolt.velocity.clone().multiplyScalar(delta));
      }
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

  fireLasers() {
    this.fireCooldown = this.fireRate; // scales with upgrades
    this.weaponEnergy -= this.laserEnergyCost;
    spaceAudio.playLaserFire();

    this.shootFlashActive = true;
    this.shootFlashTimer = 0.06;
    document.getElementById('laser-flash-l').style.opacity = 0.95;
    document.getElementById('laser-flash-r').style.opacity = 0.95;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    const positions = GUN_MUZZLES.map((m) => m.clone().applyQuaternion(this.quaternion).add(this.position));

    const boltSpeed = 250;
    const velocityVec = forward.clone().multiplyScalar(boltSpeed);

    positions.forEach(pos => {
      const boltGeom = new THREE.CylinderGeometry(0.035, 0.035, 2.2, 4);
      boltGeom.rotateX(Math.PI / 2);
      // HDR red (>1.0) so the bloom pass makes the bolts glow
      const boltMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(4.0, 0.35, 0.25),
      });

      const mesh = new THREE.Mesh(boltGeom, boltMat);
      mesh.position.copy(pos);
      mesh.quaternion.copy(this.quaternion);
      
      this.laserGroup.add(mesh);
      this.laserBolts.push({
        mesh: mesh,
        velocity: velocityVec,
        life: 1.5
      });
    });
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
    this.holdStandoff = STATION_HOLD_STANDOFF;
    this.lastDockPoint = null; // stale samples would turn into a huge dock-point velocity
  }

  isStationApproach() {
    if (!this.targetObject || this.targetObject.kind !== 'station') return false;
    return !!this.stationHold || this.position.distanceTo(this.targetObject.mesh.position) < DEPARTURE_RANGE;
  }

  // Unit vector from the station's planet out through the station: the safe side to wait on
  stationOutward(station, solarSystem = this.solarSystem) {
    const planet = solarSystem.planets[station.planetIndex];
    return station.mesh.position.clone().sub(planet.group.position).normalize();
  }

  // Docking point sits on the far side of the station from its planet, so it can never swing into the planet
  stationDockPoint(station, standoff = DOCK_STANDOFF, solarSystem = this.solarSystem) {
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
      obstacles.push({ center: this.targetObject.mesh.position, safeRadius: STATION_CLEARANCE });
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
      this.rotationSpeed.yaw = -controls.mouseDelta.x * this.mouseSensitivity;
      this.rotationSpeed.pitch = -controls.mouseDelta.y * this.mouseSensitivity;
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

      const targetSpeed = this.throttle * this.maxSpeed;

      if (this.flightAssist) {
        const idealVelocity = forward.clone().multiplyScalar(targetSpeed);
        
        let strafeDir = 0;
        if (controls.keys.strafeLeft) strafeDir = -1;
        if (controls.keys.strafeRight) strafeDir = 1;
        
        const strafeSpeed = this.maxSpeed * 0.4;
        const strafeVelocity = right.clone().multiplyScalar(strafeDir * strafeSpeed);
        
        // Relative to the local planet, plus the fading push of a station departure
        const combinedIdeal = idealVelocity.add(strafeVelocity).add(this.frameVelocity);
        if (this.departureTime > 0) {
          combinedIdeal.addScaledVector(this.departureVelocity, this.departureTime / DEPARTURE_TIME);
        }
        
        this.velocity.lerp(combinedIdeal, delta * 3.5);
      } else {
        // Flight Assist OFF
        if (Math.abs(this.throttle) > 0.01) {
          const force = forward.clone().multiplyScalar(this.throttle * this.acceleration * delta);
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
        const limitSpeed = this.gravityFieldActive ? this.maxSpeed * 2.5 : this.maxSpeed;
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
    const soundThrottle = this.autopilotActive ? 0.95 : Math.abs(this.throttle);
    
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
