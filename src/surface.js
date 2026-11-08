import * as THREE from 'three';
import { Terrain, MacroMap, GROUND_SHAPES } from './terrain';
import { PLANE_VERTEX, DOME_VERTEX, terrainFragment, domeFragment, cloudFragment } from './surfaceShaders';
import { atmosphereTop, surfaceEntryRadius } from './solarSystem';
import { FX } from './fx';
import { spaceAudio } from './audio';
import { sfx } from './sfx';
import { displayName } from './names';

// Atmospheric flight. Diving deep enough into the atmosphere of a planet with a ground (Mercury, Venus,
// Earth, Mars) hands over, behind the flash of re-entry, to a scene of its own: a plane of ground at the
// ship's own scale, shaped from the planet's maps, under the same sky. Climbing out above EXIT_Y hands
// back to space at the matching point over the planet.
//
// The ship keeps living in space for everything else in the game: while down here, ship.position,
// velocity and quaternion are swapped to local values only for the flight update and the camera
// (beforeShip / afterShip), then set back to the matching point in space, so the radar, the nav map and
// the targeting all keep working.

export const METERS_PER_UNIT = 6;
const START_Y = 2600;       // the ship comes out of re-entry this high (local units)
const EXIT_Y = 3400;        // climbing above this returns to space
const SPEED_SCALE = 2.5;    // in the air the engines push the ship faster than in open space
const CLEARANCE = 1.0;      // the ship's belly over its centre
const LAND_SPEED = 7;       // touching down slower than this (into the ground) is a landing
const LAND_DRIFT = 16;      // ... and with less sideways speed than this
const CRASH_SPEED = 16;     // hitting the ground faster than this hurts
const SETTLE_SPEED = 9;     // pull towards this sink rate with the throttle closed (settles near 3.5 units/s)
const DOME_RADIUS = 90000;
const CLOUD_EXTENT = 40000;
const SUN_INTENSITY = 2.6;  // as in space
const AIR_SCALE = 0.5;      // the air down here is drawn this much deeper than the plain altitude mapping, so the sky stays blue up high

const WORLDS = {
  Mercury: { rMap: 21000, gravity: 0.6, defines: { MERCURY: '' }, atmo: false },
  Venus: { rMap: 38000, gravity: 1.45, defines: { VENUS: '' }, atmo: true, deck: 2250 },
  Earth: { rMap: 40000, gravity: 1.6, defines: { EARTH: '' }, atmo: true, water: true, clouds: 1500 },
  Mars: { rMap: 26000, gravity: 0.6, defines: { MARS: '' }, atmo: true }
};

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const ex = new THREE.Vector3();
const ey = new THREE.Vector3();
const ez = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// The single-scattering atmosphere of planetShaders, on the CPU: sky colours for lights and reflections
function scatter(u, ro, rd, tMax, sunL, steps = 8) {
  const R = u.uRadius.value;
  const top = u.uAtmoTop.value;
  const HR = u.uHR.value;
  const HM = u.uHM.value;
  const bR = u.uBetaR.value;
  const bM = u.uBetaM.value;
  const ins = new THREE.Vector3();
  const tr = new THREE.Vector3(1, 1, 1);
  const b = ro.dot(rd);
  const c = ro.lengthSq() - top * top;
  const d = b * b - c;
  if (d < 0) return { ins, tr };
  const t0 = Math.max(-b - Math.sqrt(d), 0);
  const t1 = Math.min(-b + Math.sqrt(d), tMax);
  if (t1 <= t0) return { ins, tr };
  const ds = (t1 - t0) / steps;
  let odR = 0, odM = 0;
  const sumR = new THREE.Vector3();
  const sumM = new THREE.Vector3();
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    p.copy(rd).multiplyScalar(t0 + (i + 0.5) * ds).add(ro);
    const r = p.length();
    const h = Math.max(r - R, 0);
    const dR = Math.exp(-h / HR) * ds;
    const dM = Math.exp(-h / HM) * ds;
    odR += dR;
    odM += dM;
    const horizonCos = -Math.sqrt(Math.max(0, 1 - (R * R) / (r * r)));
    const sunVis = THREE.MathUtils.smoothstep(p.dot(sunL) / r, horizonCos - 0.01, horizonCos + 0.05);
    if (sunVis <= 0) continue;
    const bb = p.dot(sunL);
    const tl = -bb + Math.sqrt(Math.max(0, bb * bb - (p.lengthSq() - top * top)));
    const dsl = tl / 4;
    let lR = 0, lM = 0;
    for (let j = 0; j < 4; j++) {
      q.copy(sunL).multiplyScalar((j + 0.5) * dsl).add(p);
      const hq = Math.max(q.length() - R, 0);
      lR += Math.exp(-hq / HR) * dsl;
      lM += Math.exp(-hq / HM) * dsl;
    }
    const tauR = odR + lR;
    const tauM = (odM + lM) * 1.1;
    const ax = Math.exp(-(bR.x * tauR + bM * tauM)) * sunVis;
    const ay = Math.exp(-(bR.y * tauR + bM * tauM)) * sunVis;
    const az = Math.exp(-(bR.z * tauR + bM * tauM)) * sunVis;
    sumR.x += dR * ax; sumR.y += dR * ay; sumR.z += dR * az;
    sumM.x += dM * ax; sumM.y += dM * ay; sumM.z += dM * az;
  }
  const mu = rd.dot(sunL);
  const g = u.uMieG.value;
  const phaseR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const phaseM = (3 / (8 * Math.PI)) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
  const E = u.uSunE.value;
  ins.set(
    E * (sumR.x * bR.x * phaseR + sumM.x * bM * phaseM),
    E * (sumR.y * bR.y * phaseR + sumM.y * bM * phaseM),
    E * (sumR.z * bR.z * phaseR + sumM.z * bM * phaseM)
  );
  tr.set(Math.exp(-(bR.x * odR + bM * 1.1 * odM)), Math.exp(-(bR.y * odR + bM * 1.1 * odM)), Math.exp(-(bR.z * odR + bM * 1.1 * odM)));
  return { ins, tr };
}

// Sunlight left after the way down to planet point p
function sunTransmitCPU(u, p, sunL) {
  const R = u.uRadius.value;
  const r = p.length();
  const horizonCos = -Math.sqrt(Math.max(0, 1 - (R * R) / (r * r)));
  const vis = THREE.MathUtils.smoothstep(p.dot(sunL) / r, horizonCos - 0.012, horizonCos + 0.03);
  if (vis <= 0) return new THREE.Vector3();
  const top = u.uAtmoTop.value;
  const bb = p.dot(sunL);
  const tl = -bb + Math.sqrt(Math.max(0, bb * bb - (p.lengthSq() - top * top)));
  const dsl = tl / 6;
  let lR = 0, lM = 0;
  const q = new THREE.Vector3();
  for (let j = 0; j < 6; j++) {
    q.copy(sunL).multiplyScalar((j + 0.5) * dsl).add(p);
    const hq = Math.max(q.length() - R, 0);
    lR += Math.exp(-hq / u.uHR.value) * dsl;
    lM += Math.exp(-hq / u.uHM.value) * dsl;
  }
  const bR = u.uBetaR.value;
  const bM = u.uBetaM.value;
  return new THREE.Vector3(
    Math.exp(-(bR.x * lR + bM * 1.1 * lM)),
    Math.exp(-(bR.y * lR + bM * 1.1 * lM)),
    Math.exp(-(bR.z * lR + bM * 1.1 * lM))
  ).multiplyScalar(vis);
}

export class SurfaceFlight {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.planet = null;
    this.world = null;
    this.wantExit = false;
    this.landed = false;
    this.altitude = 0;     // over the ground (or the water) below the ship, local units
    this.groundY = 0;
    this.warning = null;   // 'pull-up' when the ground comes up fast
    this.warnTimer = 0;
    this.lightTimer = 0;
    this.hinted = new Set();

    this.scene = new THREE.Scene();
    this.fx = new FX(this.scene);
    // Speed streaks are a pale hint in daylight air, not the bright dust of space
    if (this.fx.dust) {
      this.fx.dust.material.opacity = 0.3;
      this.fx.dust.material.transparent = true;
    }
    this.macros = {};
    this.materials = {};

    this.local = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.qLW = new THREE.Quaternion();     // local frame at the ship -> world
    this.sunL = new THREE.Vector3(0, 1, 0);

    // Lights for the ship's hull
    this.sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x6080a0, 0x302820, 0.4);
    this.scene.add(this.hemi);

    this.terrain = new Terrain(null);
    this.scene.add(this.terrain.group);

    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), null);
    this.dome.scale.setScalar(DOME_RADIUS);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -5;
    this.scene.add(this.dome);

    const cloudGeo = new THREE.PlaneGeometry(CLOUD_EXTENT * 2, CLOUD_EXTENT * 2, 128, 128);
    cloudGeo.rotateX(-Math.PI / 2);
    this.cloudPlane = new THREE.Mesh(cloudGeo, null);
    this.cloudPlane.frustumCulled = false;
    this.cloudPlane.renderOrder = 2;
    this.cloudPlane.visible = false;
    this.scene.add(this.cloudPlane);

    this.glowEl = document.getElementById('reentry-glow');
    this.flashEl = document.getElementById('atmo-flash');
    this.fogEl = document.getElementById('cloud-fog');
    this.wind = null;
  }

  // ----- per-planet resources ------------------------------------------------------------------------

  canFly(p) {
    return !!WORLDS[p.name] && !!surfaceEntryRadius(p);
  }

  setupPlanet(p) {
    const world = WORLDS[p.name];
    if (!this.macros[p.name]) {
      const data = p.body.groundData();
      if (!data) return null;
      this.macros[p.name] = new MacroMap(data, world.rMap);
    }
    if (!this.materials[p.name]) {
      const bu = p.body.uniforms;
      const entryAlt = surfaceEntryRadius(p) - p.radius;
      const k = (entryAlt / START_Y) * AIR_SCALE;
      const uniforms = {
        // Shared with the planet as seen from space: maps, light, atmosphere
        uColorMap: bu.uColorMap, uAuxMap: bu.uAuxMap, uCloudShift: bu.uCloudShift, uLight: bu.uLight,
        uRadius: bu.uRadius, uAtmoTop: bu.uAtmoTop, uHR: bu.uHR, uHM: bu.uHM, uBetaR: bu.uBetaR,
        uBetaM: bu.uBetaM, uMieG: bu.uMieG, uSunE: bu.uSunE,
        // The plane
        uCenter: { value: new THREE.Vector3() }, uEast: { value: new THREE.Vector3() }, uSouth: { value: new THREE.Vector3() },
        uRmap: { value: world.rMap }, uK: { value: k }, uCurvR: { value: p.radius / k },
        uSunL: { value: this.sunL }, uTime: { value: 0 }, uShipPos: { value: new THREE.Vector3() },
        uHeadDir: { value: new THREE.Vector3(0, 0, -1) }, uHeadOn: { value: 0 },
        uAmbient: { value: new THREE.Vector3(0.05, 0.06, 0.08) }, uFogColor: { value: new THREE.Vector3(0.3, 0.18, 0.07) },
        uSkyZenith: { value: new THREE.Vector3(0.1, 0.2, 0.5) }, uSkyHorizon: { value: new THREE.Vector3(0.4, 0.5, 0.6) },
        uCloudY: { value: world.clouds || world.deck || 1e6 }, uDeckY: { value: world.deck || -1e6 },
        uSunCos: { value: Math.cos(THREE.MathUtils.degToRad(0.45)) }, uExtent: { value: CLOUD_EXTENT }
      };
      const atmo = world.atmo;
      const groundDefines = { ...world.defines };
      if (atmo && !world.deck) groundDefines.HAS_ATMO = '';
      const skyDefines = { ...world.defines };
      if (atmo) skyDefines.HAS_ATMO = '';
      this.materials[p.name] = {
        uniforms,
        terrain: new THREE.ShaderMaterial({
          defines: groundDefines, uniforms, vertexShader: PLANE_VERTEX, fragmentShader: terrainFragment(atmo), side: THREE.DoubleSide
        }),
        dome: new THREE.ShaderMaterial({
          defines: skyDefines, uniforms, vertexShader: DOME_VERTEX, fragmentShader: domeFragment(atmo),
          // Opaque pass (before the ground), but blended over the stars drawn first
          side: THREE.BackSide, depthTest: false, depthWrite: false,
          blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
          blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor
        }),
        cloud: (world.clouds || world.deck) ? new THREE.ShaderMaterial({
          defines: { ...world.defines }, uniforms, vertexShader: PLANE_VERTEX, fragmentShader: cloudFragment(true),
          side: THREE.DoubleSide, transparent: true, depthWrite: !!world.deck
        }) : null
      };
    }
    return { world, macro: this.macros[p.name], mats: this.materials[p.name] };
  }

  // ----- in and out ----------------------------------------------------------------------------------

  // Down through the entry altitude: hand over to atmospheric flight. False if this body has no ground.
  enter(p) {
    const game = this.game;
    const ship = game.ship;
    if (this.active || !this.canFly(p) || ship.isWarping || ship.isDocked || ship.isDestroyed) return false;
    const setup = this.setupPlanet(p);
    if (!setup) return false;
    const { world, macro, mats } = setup;
    this.planet = p;
    this.world = world;
    this.mats = mats;

    // The touchdown point, in the planet's own spinning frame
    const body = p.body;
    body.mesh.updateMatrixWorld(true);
    body.mesh.getWorldQuaternion(_q);
    const up = ship.position.clone().sub(p.group.position).normalize();
    const c = up.clone().applyQuaternion(_q.clone().invert());
    macro.setCenter(c);
    const u = mats.uniforms;
    u.uCenter.value.copy(macro.c);
    u.uEast.value.copy(macro.e);
    u.uSouth.value.copy(macro.s);

    this.terrain.material = mats.terrain;
    this.terrain.reset(GROUND_SHAPES[p.name], macro, !!world.water);
    this.dome.material = mats.dome;
    this.cloudPlane.material = mats.cloud || mats.dome;
    this.cloudPlane.visible = !!mats.cloud;
    this.cloudPlane.position.y = world.clouds || world.deck || 0;

    // Orientation and velocity carry over into the local frame
    this.frameWorld(0, 0, this.qLW);
    _q2.copy(this.qLW).invert();
    this.local.quat.copy(_q2).multiply(ship.quaternion);
    const rel = ship.velocity.clone().sub(p.velocity || _v.set(0, 0, 0));
    this.local.vel.copy(rel.applyQuaternion(_q2));
    const ground0 = this.terrain.floorHeight(0, 0);
    this.local.pos.set(0, Math.max(START_Y, ground0 + 700), 0);

    this.active = true;
    this.wantExit = false;
    this.landed = false;
    this.warning = null;
    ship.speedScale = SPEED_SCALE;
    ship.autopilotActive = false;
    ship.clearHold();

    // Move the ship, the stars and the effects over into this scene
    this.scene.add(ship.mesh);
    game.solarSystem.skyGroup.removeFromParent();
    this.scene.add(game.solarSystem.skyGroup);
    this.spaceFx = game.fx;
    game.fx = this.fx;
    game.renderPass.scene = this.scene;
    game.combat.clear();

    if (this.glowEl) this.glowEl.style.opacity = '0';
    // Ground under the ship ready before the flash clears
    this.updateLighting(0, true);
    this.terrain.prime({ position: this.local.pos }, 300);
    this.flash('#ffd2a0');
    sfx.warpBy(ship.position);
    game.hud.toast(`Atmosphärenflug: ${displayName(p.name)}`, 'info');
    if (!this.hinted.has('enter')) {
      this.hinted.add('enter');
      game.ui.tutorial.say(`Unter dir liegt ${displayName(p.name)}. Flieg tief über das Land. Zum Landen Schub auf null: das Schiff sinkt sanft und setzt auf. Mit Schub hebst du wieder ab. Steig über ${(EXIT_Y * METERS_PER_UNIT / 1000).toLocaleString('de-DE')} km, um in den Orbit zurückzukehren.`, 10000);
    }
    return true;
  }

  // Up through the ceiling: back to space, just above the entry altitude, moving outward
  exit() {
    const game = this.game;
    const ship = game.ship;
    const p = this.planet;
    this.restoreScenes();
    // ship.* hold the matching space values (afterShip ran this frame)
    const center = p.group.position;
    const up = ship.position.clone().sub(center).normalize();
    const entry = surfaceEntryRadius(p);
    ship.position.copy(center).addScaledVector(up, entry + (entry - p.radius) * 0.35);
    ship.mesh.position.copy(ship.position);
    ship.mesh.quaternion.copy(ship.quaternion);
    const planetVel = p.velocity || _v.set(0, 0, 0);
    const rel = ship.velocity.clone().sub(planetVel);
    const out = rel.dot(up);
    if (out < 6) rel.addScaledVector(up, 6 - out);
    if (rel.length() > ship.maxSpeed) rel.setLength(ship.maxSpeed);
    ship.velocity.copy(rel).add(planetVel);
    ship.frameVelocity.copy(planetVel);
    this.flash('#cfe6ff');
    game.hud.toast(`Orbit über ${displayName(p.name)} erreicht`, 'info');
  }

  // Back to space without placing the ship (death, respawn, a new game)
  abort() {
    if (!this.active) return;
    this.restoreScenes();
  }

  restoreScenes() {
    const game = this.game;
    const ship = game.ship;
    this.active = false;
    this.wantExit = false;
    this.landed = false;
    this.warning = null;
    ship.speedScale = 1;
    game.scene.add(ship.mesh);
    const sky = game.solarSystem.skyGroup;
    sky.removeFromParent();
    sky.quaternion.identity();
    game.scene.add(sky);
    this.setStarVisibility(1);
    if (this.spaceFx) game.fx = this.spaceFx;
    game.renderPass.scene = game.scene;
    this.setWind(0, 0);
    if (this.fogEl) this.fogEl.style.opacity = '0';
  }

  // Fade the stars, galaxies and the baked Milky Way (1 = as in space)
  setStarVisibility(v) {
    if (this.starVis === v) return;
    this.starVis = v;
    this.game.solarSystem.setSkyGain(undefined, v);
  }

  flash(color) {
    const el = this.flashEl;
    if (!el) return;
    el.style.background = `radial-gradient(circle, #ffffff 0%, ${color} 60%, #301808 100%)`;
    el.style.transition = 'none';
    el.style.opacity = '1';
    // Next frame: fade out
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'opacity 1.1s ease-out';
      el.style.opacity = '0';
    }));
  }

  // ----- the frame -------------------------------------------------------------------------------------

  // The local x, y, z axes at plane point (x, z) as a rotation into world space
  frameWorld(x, z, out) {
    const macro = this.macros[this.planet.name];
    macro.frameAt(x, z, ex, ey, ez);
    this.planet.body.mesh.getWorldQuaternion(_q);
    ex.applyQuaternion(_q);
    ey.applyQuaternion(_q);
    ez.applyQuaternion(_q);
    _m.makeBasis(ex, ey, ez);
    return out.setFromRotationMatrix(_m);
  }

  // Local values into the ship for its own flight update and the camera
  beforeShip() {
    const ship = this.game.ship;
    ship.position.copy(this.local.pos);
    ship.velocity.copy(this.local.vel);
    ship.quaternion.copy(this.local.quat);
  }

  // What the air and the ground add to the ship's own flight (ship holds local values)
  update(delta) {
    const ship = this.game.ship;
    const world = this.world;
    const t = this.terrain;
    if (ship.isDestroyed) return;

    if (!this.landed) ship.velocity.y -= world.gravity * delta;
    // With the stabilizer on and the throttle closed the ship settles gently towards the ground, so cutting
    // the throttle over a flat spot is all it takes to land
    if (!this.landed && ship.flightAssist && Math.abs(ship.throttle) < 0.03 && !ship.boosting) {
      ship.velocity.y += (-SETTLE_SPEED - ship.velocity.y) * Math.min(1, delta * 2);
    }
    if (!ship.flightAssist && world.atmo) ship.velocity.multiplyScalar(1 - Math.min(1, 0.1 * delta));

    const x = ship.position.x;
    const z = ship.position.z;
    const floor = t.floorHeight(x, z);
    this.groundY = floor;
    const overWater = world.water && t.rawHeight(x, z) < 0;

    if (this.landed) {
      ship.position.y = floor + CLEARANCE * 0.9;
      // Stand level on the ground, keep the heading
      const fwd = _v.set(0, 0, -1).applyQuaternion(ship.quaternion).setY(0);
      if (fwd.lengthSq() > 1e-6) {
        _m.lookAt(new THREE.Vector3(), fwd.normalize(), UP);
        _q.setFromRotationMatrix(_m);
        ship.quaternion.slerp(_q, Math.min(1, delta * 4));
        ship.mesh.quaternion.copy(ship.quaternion);
      }
      if (ship.throttle > 0.05 || ship.boosting) {
        this.landed = false;
        ship.velocity.y = 6;
        sfx.dockClamp();
      } else {
        ship.velocity.set(0, 0, 0);
      }
    } else if (ship.position.y < floor + CLEARANCE) {
      const n = this.groundNormal(x, z, overWater);
      ship.position.y = floor + CLEARANCE;
      const closing = -ship.velocity.dot(n);
      if (closing > 0) {
        const shipUp = _v2.set(0, 1, 0).applyQuaternion(ship.quaternion);
        const drift = ship.velocity.clone().addScaledVector(n, closing).length();
        if (!overWater && closing < LAND_SPEED && drift < LAND_DRIFT && shipUp.dot(n) > 0.8) {
          this.land();
        } else {
          if (closing > CRASH_SPEED) {
            const point = ship.position.clone().addScaledVector(n, -CLEARANCE);
            sfx.crash();
            if (overWater) this.splash(point, closing);
            else this.fx.rockHit(point, n);
            ship.applyHit((closing - CRASH_SPEED) * 2.2, point, { name: this.planet.name }, null, 'ram');
          } else if (closing > 3) {
            sfx.hitConfirm(false);
            if (overWater) this.splash(ship.position.clone().addScaledVector(n, -CLEARANCE), closing);
          }
          ship.velocity.addScaledVector(n, closing * 1.3);
          ship.velocity.multiplyScalar(overWater ? 0.97 : 0.9);
          ship.shake = Math.max(ship.shake, Math.min(1, closing / 30));
          ship.rotationSpeed.roll += (Math.random() - 0.5) * Math.min(2, closing * 0.1);
        }
      }
    }
    this.altitude = ship.position.y - floor;

    // Ground coming up fast: warn
    // Ground coming up fast: warn when the clearance a few seconds ahead runs out
    let warn = null;
    if (!this.landed && !ship.isDestroyed && ship.velocity.length() > CRASH_SPEED) {
      const clearNow = ship.position.y - floor;
      for (const ahead of [1.2, 2.5]) {
        const fx = x + ship.velocity.x * ahead;
        const fz = z + ship.velocity.z * ahead;
        const futureY = ship.position.y + ship.velocity.y * ahead;
        const clearAhead = futureY - t.floorHeight(fx, fz);
        if (clearAhead < 3 && clearAhead < clearNow - 4) warn = 'pull-up';
      }
    }
    this.warning = warn;
    ship.atmosphereContact = warn ? 0.3 : 0; // lights the altitude lamp
    ship.gravityFieldActive = false;
    this.warnTimer -= delta;
    if (warn && this.warnTimer <= 0) {
      this.warnTimer = 0.45;
      sfx.lockTick();
    }

    // Air rushing past, heavier low down; a light buffeting at speed
    const speed = ship.velocity.length();
    const density = world.atmo ? Math.exp(-Math.max(0, ship.position.y) / 1400) : 0;
    const limit = ship.maxSpeed * SPEED_SCALE;
    this.setWind(density * THREE.MathUtils.clamp(speed / limit, 0, 1.6) * 0.5, speed / limit);
    if (world.atmo && !this.landed) ship.shake = Math.max(ship.shake, density * Math.max(0, speed / limit - 0.6) * 0.15);

    if (ship.position.y > EXIT_Y && !ship.isDestroyed) this.wantExit = true;
  }

  groundNormal(x, z, flat) {
    if (flat) return new THREE.Vector3(0, 1, 0);
    const t = this.terrain;
    const e = 2;
    const nx = t.floorHeight(x - e, z) - t.floorHeight(x + e, z);
    const nz = t.floorHeight(x, z - e) - t.floorHeight(x, z + e);
    return new THREE.Vector3(nx, 2 * e, nz).normalize();
  }

  land() {
    const ship = this.game.ship;
    this.landed = true;
    ship.velocity.set(0, 0, 0);
    ship.throttle = 0;
    sfx.dockClamp();
    this.fx.puff(ship.position.clone().add(new THREE.Vector3(0, -CLEARANCE, 0)), { color: 0xb8a890, hdr: 0.6, from: 2, to: 9, life: 1.6 });
    const h = Math.round(Math.max(0, this.groundY) * METERS_PER_UNIT);
    this.game.hud.toast(`Gelandet auf ${displayName(this.planet.name)} · ${h.toLocaleString('de-DE')} m über Null`, 'gain');
  }

  splash(point, strength) {
    const n = Math.min(4, 1 + Math.floor(strength / 10));
    for (let i = 0; i < n; i++) {
      this.fx.puff(point.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.5, (Math.random() - 0.5) * 3)), {
        color: 0xe8f4ff, hdr: 0.9, from: 1.5, to: 6 + strength * 0.2, life: 1.2, vel: new THREE.Vector3(0, 4 + Math.random() * 4, 0)
      });
    }
  }

  // Back to space values for the rest of the game; the ship's mesh stays down here
  afterShip() {
    const ship = this.game.ship;
    const p = this.planet;
    this.local.pos.copy(ship.position);
    this.local.vel.copy(ship.velocity);
    this.local.quat.copy(ship.quaternion);
    ship.mesh.position.copy(this.local.pos);
    ship.mesh.quaternion.copy(this.local.quat);

    this.frameWorld(this.local.pos.x, this.local.pos.z, this.qLW);
    const entryAlt = surfaceEntryRadius(p) - p.radius;
    const k = entryAlt / START_Y;
    const up = ey; // set by frameWorld, world space
    ship.position.copy(p.group.position).addScaledVector(up, p.radius + Math.max(0, this.local.pos.y) * k);
    ship.quaternion.copy(this.qLW).multiply(this.local.quat);
    const planetVel = p.velocity || _v.set(0, 0, 0);
    ship.velocity.copy(this.local.vel).divideScalar(SPEED_SCALE).applyQuaternion(this.qLW).add(planetVel);
    ship.frameVelocity.copy(planetVel);
  }

  // Sun, sky colours and lights, from where the ship is now
  updateLighting(delta, force = false) {
    const p = this.planet;
    const u = this.mats.uniforms;
    _q.copy(this.qLW).invert();
    this.sunL.copy(p.group.position).negate().normalize().applyQuaternion(_q);

    this.lightTimer -= delta;
    if (!force && this.lightTimer > 0) return;
    this.lightTimer = 0.2;
    const world = this.world;
    const light = p.body.uniforms.uLight.value;
    const y = this.local.pos.y;
    const k = u.uK.value;
    const ro = new THREE.Vector3(0, p.radius + Math.max(0, y) * k, 0);
    let sunT;
    if (world.deck && y < world.deck) {
      // Under Venus's clouds: only the diffuse glow of a sky lit from far above
      const day = THREE.MathUtils.smoothstep(this.sunL.y, -0.2, 0.35);
      u.uFogColor.value.set(0.36, 0.2, 0.075).multiplyScalar(light * (0.06 + day));
      u.uAmbient.value.copy(u.uFogColor.value).multiplyScalar(1.3);
      sunT = new THREE.Vector3(0, 0, 0);
      u.uSkyZenith.value.copy(u.uFogColor.value);
      u.uSkyHorizon.value.copy(u.uFogColor.value);
    } else if (world.atmo) {
      const zen = scatter(p.body.uniforms, ro, UP, 1e9, this.sunL);
      const horizDir = new THREE.Vector3(this.sunL.x, 0, this.sunL.z);
      if (horizDir.lengthSq() < 1e-6) horizDir.set(1, 0, 0);
      horizDir.normalize();
      horizDir.y = 0.06;
      horizDir.normalize();
      const h1 = scatter(p.body.uniforms, ro, horizDir, 1e9, this.sunL);
      horizDir.x *= -1;
      horizDir.z *= -1;
      const h2 = scatter(p.body.uniforms, ro, horizDir, 1e9, this.sunL);
      const horizon = h1.ins.clone().add(h2.ins).multiplyScalar(0.5);
      u.uSkyZenith.value.copy(zen.ins);
      u.uSkyHorizon.value.copy(horizon);
      // Plus a little starlight, so the ground never goes fully black
      u.uAmbient.value.copy(zen.ins).multiplyScalar(1.6).addScaledVector(horizon, 0.9).add(_v.set(0.006, 0.007, 0.01));
      sunT = sunTransmitCPU(p.body.uniforms, ro, this.sunL);
      if (world.deck) {
        const day = THREE.MathUtils.smoothstep(this.sunL.y, -0.2, 0.35);
        u.uFogColor.value.set(0.36, 0.2, 0.075).multiplyScalar(light * (0.06 + day));
      }
    } else {
      sunT = new THREE.Vector3(1, 1, 1).multiplyScalar(THREE.MathUtils.smoothstep(this.sunL.y, -0.02, 0.03));
      u.uAmbient.value.set(0.012, 0.012, 0.013);
      u.uSkyZenith.value.set(0, 0, 0);
      u.uSkyHorizon.value.set(0, 0, 0);
    }
    this.sunT = sunT;
    // Stars and the Milky Way fade out behind a bright sky
    const zen = u.uSkyZenith.value;
    const skyLum = 0.2126 * zen.x + 0.7152 * zen.y + 0.0722 * zen.z;
    const overcast = world.deck && y < world.deck;
    this.setStarVisibility(overcast ? 0 : 1 - THREE.MathUtils.smoothstep(skyLum, 0.002, 0.04));
    this.sun.color.setRGB(sunT.x, sunT.y, sunT.z);
    this.sun.intensity = SUN_INTENSITY * light;
    const amb = u.uAmbient.value;
    const ambMax = Math.max(amb.x, amb.y, amb.z, 1e-4);
    this.hemi.color.setRGB(amb.x / ambMax, amb.y / ambMax, amb.z / ambMax);
    this.hemi.groundColor.setRGB(0.35, 0.3, 0.25);
    this.hemi.intensity = Math.min(1.5, ambMax * 6) + 0.05;
  }

  // Right before rendering: everything that follows the camera, and the ground to draw
  prepareRender(camera, delta) {
    const ship = this.game.ship;
    const u = this.mats.uniforms;
    this.updateLighting(delta);
    u.uTime.value += delta;
    u.uShipPos.value.copy(this.local.pos);
    // Headlights come on as the light fades (slightly down from the nose)
    const dark = 1 - THREE.MathUtils.smoothstep(Math.max(u.uAmbient.value.x, u.uAmbient.value.y, u.uAmbient.value.z) + (this.sunT ? this.sunT.y * 0.2 : 0), 0.01, 0.05);
    u.uHeadOn.value = ship.isDestroyed ? 0 : dark;
    u.uHeadDir.value.set(0, -0.2, -1).normalize().applyQuaternion(this.local.quat);
    this.dome.position.copy(camera.position);
    const step = (CLOUD_EXTENT * 2) / 128;
    this.cloudPlane.position.x = Math.round(camera.position.x / step) * step;
    this.cloudPlane.position.z = Math.round(camera.position.z / step) * step;
    const sky = this.game.solarSystem.skyGroup;
    sky.position.copy(camera.position);
    sky.quaternion.copy(this.qLW).invert();
    this.sun.position.copy(this.local.pos).addScaledVector(this.sunL, 50);
    this.sun.target.position.copy(this.local.pos);
    this.terrain.update(camera, 3);
    this.updateCloudFog(camera);
    if (ship.isDestroyed) this.setWind(0, 0);
  }

  // Inside the cloud layer the view goes white
  updateCloudFog(camera) {
    if (!this.fogEl) return;
    const world = this.world;
    let fog = 0;
    if (world.clouds) {
      const dy = Math.abs(camera.position.y - world.clouds);
      if (dy < 90) {
        const m = this.macros[this.planet.name];
        m.sample(camera.position.x, camera.position.z);
        fog = THREE.MathUtils.smoothstep(m.cloud, 0.3, 0.7) * (1 - dy / 90) * 0.9;
      }
    } else if (world.deck) {
      const dy = Math.abs(camera.position.y - world.deck);
      if (dy < 140) fog = (1 - dy / 140) * 0.95;
    }
    const color = world.deck ? '#c89048' : '#e8ecf0';
    if (this.fogColor !== color) {
      this.fogColor = color;
      this.fogEl.style.background = color;
    }
    this.fogEl.style.opacity = fog.toFixed(3);
  }

  // ----- in space, on the way down --------------------------------------------------------------------

  // The glow of re-entry and the rising roar while the ship sinks into an atmosphere
  updateApproach(delta) {
    const game = this.game;
    const ship = game.ship;
    let heat = 0;
    let wind = 0;
    if (!ship.isDocked && !ship.isDestroyed && !ship.isWarping) {
      for (const p of game.solarSystem.planets) {
        if (p.name === 'Sun') continue;
        const top = atmosphereTop(p);
        if (top <= p.radius) continue;
        const dist = ship.position.distanceTo(p.group.position);
        if (dist >= top) continue;
        const entry = surfaceEntryRadius(p) || p.radius;
        const depth = THREE.MathUtils.clamp((top - dist) / (top - entry), 0, 1);
        const speed = ship.velocity.clone().sub(p.velocity || _v.set(0, 0, 0)).length();
        heat = depth * depth * THREE.MathUtils.clamp((speed - 6) / 30, 0, 1);
        wind = depth * THREE.MathUtils.clamp(speed / 40, 0, 1) * 0.6;
        if (this.canFly(p) && depth > 0.15 && !this.hinted.has(`dive-${p.name}`)) {
          this.hinted.add(`dive-${p.name}`);
          game.hud.toast(`Tiefer sinken: Atmosphärenflug über ${displayName(p.name)}`, 'info');
        }
        break;
      }
    }
    ship.shake = Math.max(ship.shake, heat * 0.22);
    if (this.glowEl) this.glowEl.style.opacity = heat.toFixed(3);
    this.setWind(wind, 0.6 + heat);
  }

  // Wind noise: level 0..1, pitch roughly with speed
  setWind(level, pitch) {
    if (!spaceAudio.initialized || !spaceAudio.ctx) return;
    if (!this.wind) {
      if (level <= 0.001) return;
      const src = spaceAudio.noiseSource('pink', true);
      const filter = spaceAudio.filter('bandpass', 500, 0.8);
      const gain = spaceAudio.gain(0);
      src.connect(filter).connect(gain);
      spaceAudio.out(gain, { reverb: 0 });
      src.start();
      this.wind = { src, filter, gain };
    }
    const now = spaceAudio.now;
    this.wind.gain.gain.setTargetAtTime(Math.min(0.5, level * 0.45), now, 0.15);
    this.wind.filter.frequency.setTargetAtTime(300 + Math.min(2, pitch) * 900, now, 0.2);
  }

  // ----- readouts ------------------------------------------------------------------------------------------

  speedText() {
    const kmh = this.local.vel.length() * METERS_PER_UNIT * 3.6;
    return `${Math.round(kmh).toLocaleString('de-DE')} km/h`;
  }

  speedFraction() {
    const ship = this.game.ship;
    return this.local.vel.length() / (ship.maxSpeed * SPEED_SCALE);
  }

  altitudeText() {
    const name = displayName(this.planet.name);
    if (this.landed) return `GELANDET · ${name}`;
    const agl = Math.max(0, Math.round(this.altitude * METERS_PER_UNIT));
    const msl = Math.round(this.local.pos.y * METERS_PER_UNIT);
    return `${agl.toLocaleString('de-DE')} m über Grund · ${msl.toLocaleString('de-DE')} m · ${name}`;
  }
}
