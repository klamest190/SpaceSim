import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { controls } from './controls';
import { spaceAudio } from './audio';
import { sfx } from './sfx';
import { music } from './music';
import { Spaceship, planetHoldDistance, arrivalRadius, stationHoldStandoff, stationDockRange, pilotSettings } from './spaceship';
import { SolarSystem, atmosphereTop, flightFloor, surfaceEntryRadius } from './solarSystem';
import { SurfaceFlight } from './surface';
import { UI } from './ui';
import { displayName } from './names';
import { loadGame, saveGame, clearGame, loadSettings, saveSettings } from './save';
import { FX } from './fx';
import { Combat } from './combat';
import { NPCManager } from './npc';
import { Law } from './law';
import { Economy } from './economy';
import { Missions } from './missions';
import { Encounters } from './encounters';
import { Comm } from './comm';
import { CombatHUD } from './combatHud';
import { MissileCam } from './missileCam';
import { GOODS, emptyCargo, STARTING_DEBT } from './world';
import { DIFFICULTIES, difficultyOf } from './difficulty';
import { EyeAdaptation } from './exposure';
import { SolarStorm } from './solarStorm';
import './style.css';

const AUTOSAVE_INTERVAL = 15; // seconds
const WARP_BRAKE_TIME = 1.0; // seconds from leaving the jump to standing still
const WARP_CLEARANCE = 2.5;  // a planet jump's braking path keeps this far from other bodies' surfaces
const AIM_TURN = THREE.MathUtils.degToRad(3);   // the nose must turn this far before aiming picks a new target
const AIM_CONE = THREE.MathUtils.degToRad(10);  // the crosshair's reach, as in findTargetUnderCrosshair
const PLANET_PREFERENCE_RADII = 3;             // farther out (in planet radii), aiming at a planet's station picks the planet
const HEAT_SPEED = 25;                         // hitting the atmosphere floor faster than this (units/s) scorches the shield
const RAM_SPEED = 8;                           // bumping into things slower than this does no damage
const ICE_FUEL = 4;                            // fuel units from one ton of ice
const TOW_PRICE = 600;
const TRACTOR_RANGE = 170;
const ZERO = new THREE.Vector3();

// Shortest distance from `point` to the segment that starts at `start` and moves by `travel`
function distanceToSegment(point, start, travel) {
  const lengthSq = travel.lengthSq();
  const t = lengthSq > 0 ? THREE.MathUtils.clamp(point.clone().sub(start).dot(travel) / lengthSq, 0, 1) : 0;
  return start.clone().addScaledVector(travel, t).distanceTo(point);
}

const LOOT_COLORS = { ore: 0x9a6038, ice: 0x9fd0ff, food: 0x6fbf50, med: 0xf0f0f0, tech: 0x40c0ff, lux: 0xd0a0ff, stims: 0xff4060, arms: 0xff3020 };

class Game {
  constructor() {
    this.simRunning = false;
    this.paused = false;
    this.warpState = null; // 'charging', 'hyper', 'decelerating'
    this.warpTimer = 0;
    this.warpTarget = null;
    this.dockableStation = null;
    this.loots = [];
    this.discovered = new Set();
    this.home = 'Erde Orbital-Station';
    this.displayName = displayName;

    this.initWebGL();

    // Tractor beam visual
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.tractorBeamLine = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: new THREE.Color(0.4, 2.2, 2.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
    this.tractorBeamLine.frustumCulled = false;
    this.scene.add(this.tractorBeamLine);

    // World and its systems
    this.solarSystem = new SolarSystem(this.scene, this.renderer);
    this.ship = new Spaceship(this.scene, this.renderer);
    this.ship.game = this;
    this.fx = new FX(this.scene);
    this.combat = new Combat(this);
    this.npcs = new NPCManager(this);
    this.law = new Law(this);
    this.economy = new Economy(this);
    this.missions = new Missions(this);
    this.encounters = new Encounters(this);
    this.comm = new Comm(this);
    this.hud = new CombatHUD(this);
    this.missileCam = new MissileCam(this);
    this.surface = new SurfaceFlight(this);
    this.eyes = new EyeAdaptation(this);
    this.storm = new SolarStorm(this);
    sfx.listener = this.camera;

    this.settings = { sensitivity: 1, invertY: false, music: true, musicVolume: 0.7, sound: true, ...loadSettings() };
    this.applySettings();

    // Restore the pilot career, then spawn at the home station with it locked as first destination
    this.difficulty = 'normal';
    this.savedGame = loadGame();
    if (this.savedGame) this.applySave(this.savedGame);
    this.autosaveTimer = 0;
    this.placeShipAtHome();

    this.ui = new UI(this);
    this.setupControlBinds();

    window.addEventListener('resize', this.onWindowResize.bind(this), false);
    this.clock = new THREE.Clock();
    this.tick();
  }

  initWebGL() {
    this.scene = new THREE.Scene();
    // Logarithmic depth: the cockpit at 0.05 units and Neptune 45.000 units away share one depth buffer
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 150000);
    const canvas = document.getElementById('space-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // Post-processing: only HDR sources (sun, lasers, explosion cores) cross the bloom threshold
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.5, 0.9);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  // ----- career --------------------------------------------------------------------------------

  applySave(save) {
    const ship = this.ship;
    this.difficulty = DIFFICULTIES[save.difficulty] ? save.difficulty : 'normal';
    if (typeof save.credits === 'number') ship.credits = save.credits;
    ship.cargo = { ...emptyCargo(), ...(save.cargo || {}) };
    if (save.upgrades) Object.assign(ship.upgrades, save.upgrades);
    ship.applyUpgrades();
    ship.shield = ship.maxShield;
    ship.hull = typeof save.hull === 'number' ? Math.min(save.hull, ship.maxHull) : ship.maxHull;
    if (save.systems) Object.assign(ship.systems, save.systems);
    if (typeof save.fuel === 'number') ship.fuel = save.fuel;
    if (typeof save.missiles === 'number') ship.missiles = save.missiles;
    if (typeof save.flares === 'number') ship.flares = save.flares;
    ship.debt = typeof save.debt === 'number' ? save.debt : STARTING_DEBT;
    this.law.load(save.law);
    this.economy.load(save.economy);
    this.missions.load(save.missions);
    (save.discovered || []).forEach((n) => this.discover(n, true));
    if (save.home && this.solarSystem.stations.some((s) => s.name === save.home)) this.home = save.home;
  }

  saveProgress(extra = {}) {
    const ship = this.ship;
    saveGame(ship, {
      ...extra,
      hull: ship.hull, systems: ship.systems, fuel: ship.fuel, missiles: ship.missiles, flares: ship.flares, debt: ship.debt,
      law: this.law.toSave(), economy: this.economy.toSave(), missions: this.missions.toSave(),
      discovered: [...this.discovered], home: this.home, difficulty: this.difficulty,
    });
  }

  startNewCareer(difficulty = 'normal') {
    clearGame();
    this.savedGame = null;
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : 'normal';
    const d = difficultyOf(this);
    const ship = this.ship;
    ship.credits = d.credits;
    ship.debt = d.debt;
    ship.cargo = emptyCargo();
    const t = d.upgradeTier;
    ship.upgrades = { engine: t, shield: t, weapon: t, cargo: t, armor: t, sensor: t };
    ship.applyUpgrades();
    ship.fullRepair();
    ship.fuel = ship.maxFuel;
    ship.missiles = d.fullAmmo ? ship.maxMissiles : d.noMissiles ? 0 : 2;
    ship.flares = d.fullAmmo ? ship.maxFlares : 4;
    this.law.reset();
    this.economy.reset();
    this.missions.reset();
    this.encounters.reset();
    this.npcs.clearAll();
    this.discovered.clear();
    this.solarSystem.stations.forEach((s) => { if (s.def.hidden) { s.hidden = true; s.mesh.visible = false; } });
    this.home = 'Erde Orbital-Station';
    this.saveProgress({ tutorialDone: false });
  }

  // A hidden place becomes known: on the nav map, targetable, visible
  discover(name, silent = false) {
    if (this.discovered.has(name)) return;
    this.discovered.add(name);
    const st = this.solarSystem.stations.find((s) => s.name === name);
    if (st) {
      st.hidden = false;
      st.mesh.visible = true;
    }
    if (!silent) {
      this.hud.toast(`Neuer Navpunkt: ${displayName(name)}`, 'info');
      this.navRefresh();
    }
  }

  navRefresh() {
    if (this.ui && this.ui.navMap) this.ui.navMap.buildEntries();
  }

  applySettings() {
    const s = this.settings;
    pilotSettings.sensitivity = s.sensitivity;
    pilotSettings.invertY = s.invertY;
    music.setEnabled(s.music);
    music.setVolume(s.musicVolume);
    saveSettings(s);
  }

  // ----- placing the ship ------------------------------------------------------------------------

  placeShipAtHome() {
    const st = this.solarSystem.stations.find((s) => s.name === this.home);
    if (!st || st.name === 'Erde Orbital-Station') this.placeShipAtEarth();
    else this.placeShipAtStation(st);
  }

  placeShipAtEarth() {
    const earth = this.solarSystem.planets[3];
    const earthStation = this.solarSystem.stations.find(st => st.name === 'Erde Orbital-Station');
    // Over Earth's day side, turned off the line to the Sun so the terminator shows, the station just ahead
    const up = new THREE.Vector3(0, 1, 0);
    const out = earth.currentPos.clone().negate().setY(0).normalize()
      .applyAxisAngle(up, THREE.MathUtils.degToRad(55))
      .addScaledVector(up, 0.12)
      .normalize();
    this.ship.position.copy(earth.currentPos).addScaledVector(out, earth.radius * 1.75);
    if (earthStation) {
      earthStation.orbitAngle = Math.atan2(out.z, out.x) + 0.32;
      this.solarSystem.update(0);
    }
    const lookAt = earthStation ? earthStation.mesh.position.clone().lerp(earth.currentPos, 0.35) : earth.currentPos;
    this.orientShip(lookAt);
    this.ship.velocity.copy(earth.velocity || ZERO);
    this.ship.targetObject = earthStation || earth;
  }

  // Just outside a station, facing it, at rest relative to it
  placeShipAtStation(st) {
    const out = this.ship.stationOutward(st, this.solarSystem);
    const side = new THREE.Vector3(0, 1, 0).cross(out).normalize();
    this.ship.position.copy(st.mesh.position).addScaledVector(out, st.size + 90).addScaledVector(side, 40);
    this.orientShip(st.mesh.position);
    const planet = this.solarSystem.planets[st.planetIndex];
    this.ship.velocity.copy(planet.velocity || ZERO);
    this.ship.targetObject = st;
  }

  orientShip(lookAt) {
    const look = new THREE.Matrix4().lookAt(this.ship.position, lookAt, new THREE.Vector3(0, 1, 0));
    this.ship.quaternion.setFromRotationMatrix(look);
    this.ship.mesh.position.copy(this.ship.position);
    this.ship.mesh.quaternion.copy(this.ship.quaternion);
    this.ship.stick.x = this.ship.stick.y = 0;
  }

  // ----- input -----------------------------------------------------------------------------------

  flying() {
    return this.simRunning && !this.paused && !this.ship.isDocked && !this.ship.isDestroyed;
  }

  setupControlBinds() {
    controls.onPress('t', () => {
      if (!this.flying()) return;
      const extra = this.npcs.ships.filter((n) => n.pos.distanceTo(this.ship.position) < this.ship.sensorRange);
      const dest = this.missions.destination();
      if (dest && dest.kind === 'waypoint') extra.push(dest);
      this.setTarget(this.solarSystem.cycleTarget(this.ship.targetObject, this.ship, extra));
      spaceAudio.playBeep();
    });

    // R: the nearest ship that is shooting at us, or whatever is under the crosshair
    controls.onPress('r', () => {
      if (!this.flying()) return;
      const hostile = this.nearestHostile();
      const aimed = hostile || this.solarSystem.findTargetUnderCrosshair(this.ship, this.npcs.ships);
      if (aimed) {
        this.setTarget(aimed);
        spaceAudio.playBeep();
      } else {
        sfx.denied();
      }
    });

    // J: the current mission's destination
    controls.onPress('j', () => {
      if (!this.flying()) return;
      const dest = this.missions.destination();
      if (dest) {
        this.setTarget(dest);
        spaceAudio.playBeep();
      } else {
        sfx.denied();
      }
    });

    controls.onPress('f', () => {
      if (!this.flying()) return;
      this.ship.flightAssist = !this.ship.flightAssist;
      spaceAudio.playBeep();
    });

    controls.onPress('c', () => {
      if (!this.flying()) return;
      this.ship.cameraMode = this.ship.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
      spaceAudio.playBeep();
    });

    controls.onPress('v', () => { if (this.flying()) this.ship.launchMissile(); });
    controls.onPress('rmb', () => { if (this.flying()) this.ship.launchMissile(); });
    controls.onPress('k', () => { if (this.flying()) this.ship.dropFlare(); });
    controls.onPress('m', () => this.toggleAudio());
    controls.onPress('o', () => {
      this.settings.music = !this.settings.music;
      this.applySettings();
      this.hud.toast(`Musik ${this.settings.music ? 'an' : 'aus'}`, 'info');
    });

    controls.onPress('h', () => {
      if (!this.flying()) return;
      this.ui.toggleHelpGuide();
    });

    controls.onPress('x', () => this.flyToTarget());

    controls.onPress('g', () => {
      if (!this.simRunning || this.ship.isDestroyed || this.ui.navMap.isOpen || this.paused) return;
      if (this.ship.isDocked) this.undockShip();
      else if (this.dockableStation) this.dockShip();
    });

    controls.onPress('n', () => { if (!this.paused) this.ui.navMap.toggle(); });
    controls.onPress('i', () => { if (this.flying() && !this.ui.navMap.isOpen) this.ui.openPause('log'); });
    controls.onPress('up', () => { if (this.ui.navMap.isOpen) this.ui.navMap.moveSelection(-1); });
    controls.onPress('down', () => { if (this.ui.navMap.isOpen) this.ui.navMap.moveSelection(1); });
    controls.onPress('enter', () => { if (this.ui.navMap.isOpen) this.ui.navMap.warp(); });
    controls.onPress('escape', () => {
      if (this.ui.difficultyOpen) this.ui.closeDifficulty();
      else if (this.ship.isDocked && this.ui.stationUI.isOpen) this.ui.stationUI.back();
      else this.ui.navMap.close(false);
    });
    ['1', '2', '3', '4'].forEach((key, i) => controls.onPress(key, () => {
      if (this.ui.difficultyOpen) { if (i < 3) this.ui.chooseDifficulty(['easy', 'normal', 'hard'][i]); return; }
      if (!this.simRunning || this.paused) return;
      if (this.ship.isDocked && this.ui.stationUI.isOpen) this.ui.stationUI.answer(i);
      else this.comm.answer(i);
    }));

    // Losing the mouse in flight (Esc, alt-tab) pauses the game
    controls.onLockChange = (locked) => {
      if (!locked && this.flying() && !this.ui.navMap.isOpen && !this.ui.pauseOpen) this.ui.openPause('log');
    };

    document.getElementById('respawn-btn').addEventListener('click', () => this.respawnShip());
  }

  nearestHostile() {
    let best = null, bestD = Infinity;
    this.npcs.ships.forEach((n) => {
      if (!n.alive || !this.npcs.isHostile(n, this.ship)) return;
      const d = n.pos.distanceTo(this.ship.position);
      if (d < this.ship.sensorRange && d < bestD) { bestD = d; best = n; }
    });
    return best;
  }

  hostilesNear(range) {
    return this.npcs.ships.some((n) => n.guns && n.alive && this.npcs.isHostile(n, this.ship) && n.pos.distanceTo(this.ship.position) < range);
  }

  // ----- docking ---------------------------------------------------------------------------------

  // Why this station won't take us right now, or null
  dockRefusal(st) {
    const { law } = this;
    if (st.def.faction === 'pirate' && law.piratesHostile() && this.missions.storyStep < 5) return 'Der Aschebund lässt dich nicht an Bord. Erst muss man dir dort vertrauen.';
    if (!st.def.blackMarket && st.def.faction !== 'pirate' && law.wanted >= 2) return `Andocken verweigert: Sie werden gesucht. Bußgelder: ${law.fines.toLocaleString('de-DE')} Cr. Ein Mittelsmann auf dem Triton-Posten kann das regeln.`;
    if (this.npcs.ships.some((n) => n.guns && n.target === this.ship && n.mode === 'attack' && n.pos.distanceTo(this.ship.position) < 350)) return 'Andockklammern gesperrt: Feindkontakt in unmittelbarer Nähe.';
    return null;
  }

  dockShip() {
    const st = this.dockableStation;
    if (!st) return;
    const refusal = this.dockRefusal(st);
    if (refusal) {
      sfx.denied();
      this.comm.say(refusal, { speaker: `Flugleitung ${displayName(st.name)}`, faction: st.def.faction === 'pirate' ? 'pirate' : 'control', urgent: true, duration: 6000 });
      return;
    }
    this.ship.isDocked = true;
    this.ship.dockedAt = st;
    this.ship.autopilotActive = false;
    this.ship.velocity.set(0, 0, 0);
    this.home = st.def.blackMarket || st.def.faction === 'pirate' ? this.home : st.name;
    this.combat.clear();
    this.comm.clear();
    this.ui.openSpaceport(st.name);
    this.ui.tutorial.onDocked();
    this.saveProgress();
    document.exitPointerLock();
    sfx.dockClamp();
  }

  undockShip() {
    const st = this.ship.dockedAt;
    this.ship.isDocked = false;
    this.ship.dockedAt = null;
    this.ui.closeSpaceport();
    if (st) {
      // Out through the bay doors, drifting clear, at rest relative to the station's planet
      const out = this.ship.stationOutward(st, this.solarSystem);
      this.ship.position.copy(st.mesh.position).addScaledVector(out, stationHoldStandoff(st) + 4);
      this.orientShip(this.ship.position.clone().add(out));
      const planet = this.solarSystem.planets[st.planetIndex];
      this.ship.velocity.copy(planet.velocity || ZERO).addScaledVector(out, 8);
      this.ship.throttle = 0;
      this.ship.targetObject = null;
    }
    this.saveProgress();
    controls.requestLock();
    sfx.dockClamp();
  }

  // ----- travel ----------------------------------------------------------------------------------

  // One key for travel: a warp jump to the target, stopping at a safe distance.
  // Held at a station it lets go instead; right beside a station it takes up the hold again for docking.
  flyToTarget() {
    if (!this.flying()) return;
    if (this.ui.navMap.isOpen) this.ui.navMap.warp();
    else if (this.ship.autopilotActive || this.isBesideTargetStation()) this.ship.toggleAutopilot();
    else this.triggerWarpJump();
  }

  isBesideTargetStation() {
    const target = this.ship.targetObject;
    return !!target && target.kind === 'station' && target.mesh.position.distanceTo(this.ship.position) < arrivalRadius(target);
  }

  // Aiming at an object makes it the target, but only when the pilot turns the nose to it
  updateAimedTarget() {
    const ship = this.ship;
    if (ship.isDocked || ship.isWarping || ship.isDestroyed || ship.autopilotActive || this.ui.navMap.isOpen) return;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    if (!this.aimReference) this.aimReference = forward.clone();
    if (forward.angleTo(this.aimReference) < AIM_TURN) return;

    let aimed = this.solarSystem.findTargetUnderCrosshair(ship, this.npcs.ships);
    const parent = aimed && aimed.kind === 'station' ? this.solarSystem.planets[aimed.planetIndex] : null;
    if (parent && aimed.planetIndex !== 0 && this.isInSight(parent, forward) && parent.group.position.distanceTo(ship.position) > parent.radius * PLANET_PREFERENCE_RADII) {
      aimed = parent;
    }
    if (!aimed || aimed === ship.targetObject) return;
    // In a fight, a ship target is not stolen by the scenery behind it
    if (ship.targetObject && ship.targetObject.kind === 'npc' && ship.targetObject.alive && aimed.kind !== 'npc') return;
    if (ship.targetObject && this.isInSight(ship.targetObject, forward)) return;
    this.setTarget(aimed);
  }

  setTarget(target) {
    this.ship.targetObject = target;
    this.ship.lockProgress = 0;
    this.ship.locked = false;
    this.aimReference = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
  }

  isInSight(obj, forward) {
    const pos = obj.group ? obj.group.position : obj.mesh.position;
    return forward.angleTo(pos.clone().sub(this.ship.position)) < AIM_CONE;
  }

  warpCost(dist) {
    const d = difficultyOf(this);
    if (d.freeWarp) return 0;
    return Math.ceil((1.5 + dist / 1600) * (d.warpCostMult || 1));
  }

  // A fresh career from the pause menu: everything back to the start, at the chosen difficulty
  newGame(difficulty) {
    const ship = this.ship;
    this.surface.abort();
    if (ship.isDocked) {
      ship.isDocked = false;
      ship.dockedAt = null;
      this.ui.closeSpaceport();
    }
    ship.isDestroyed = false;
    ship.isWarping = false;
    ship.autopilotActive = false;
    ship.targetObject = null;
    ship.throttle = 0;
    this.warpState = null;
    spaceAudio.setWarp(false);
    spaceAudio.setThrottle(0);
    document.getElementById('game-over-screen').classList.add('hidden');
    this.combat.clear();
    this.comm.clear();
    this.loots.forEach((loot) => this.scene.remove(loot.group));
    this.loots = [];
    this.startNewCareer(difficulty);
    this.placeShipAtHome();
    ship.cameraMode = 'cockpit';
    ship.mesh.visible = true;
    this.ui.navMap.close(false);
    this.navRefresh();
    this.ui.updateHUDStats();
    this.ui.tutorial.start(false);
    this.hud.toast(`Neues Spiel · ${DIFFICULTIES[this.difficulty].label}`, 'info');
  }

  triggerWarpJump() {
    if (this.warpState) return;
    const ship = this.ship;
    if (this.surface.active) {
      sfx.denied();
      this.hud.toast('Kein Sprung in der Atmosphäre: erst in den Orbit steigen', 'bad');
      return;
    }
    const target = ship.targetObject;
    const targetPos = target && (target.group ? target.group.position : target.mesh.position);
    if (!target || targetPos.distanceTo(ship.position) < arrivalRadius(target)) {
      sfx.denied();
      return;
    }
    if (ship.systems.warp < 0.25) {
      sfx.denied();
      this.hud.toast('Sprungantrieb ausgefallen: Reparatur in einer Werft nötig', 'bad');
      return;
    }
    if (this.encounters.massLocked()) {
      sfx.denied();
      this.hud.toast('MASSENSPERRE: Bewaffnete Schiffe stören das Sprungfeld', 'bad');
      return;
    }
    const dist = targetPos.distanceTo(ship.position);
    const cost = this.warpCost(dist);
    if (ship.fuel < cost && !this.burnIce(cost)) {
      this.offerTow();
      return;
    }
    ship.fuel -= cost;

    this.warpState = 'charging';
    this.warpTimer = 0;
    this.warpTarget = target;
    this.warpExitSpeed = 0;
    this.warpChargeTime = 1.2 / Math.max(0.4, ship.systems.warp);
    this.warpInterdicted = this.encounters.rollInterdiction(ship.position.clone(), targetPos.clone(), dist);
    this.warpStart = ship.position.clone();
    ship.isWarping = true;
    ship.autopilotActive = false;
    spaceAudio.setWarp(true);
    const flashDiv = document.getElementById('warp-flash');
    flashDiv.style.transition = 'none';
    flashDiv.style.opacity = '0';
  }

  // Ice in the hold is reaction mass in a pinch
  burnIce(cost) {
    const ship = this.ship;
    const need = Math.ceil((cost - ship.fuel) / ICE_FUEL);
    if (ship.cargo.ice < need) return false;
    ship.cargo.ice -= need;
    ship.fuel += need * ICE_FUEL;
    this.hud.toast(`${need} t Eis als Reaktionsmasse verdampft`, 'warn');
    return true;
  }

  offerTow() {
    sfx.denied();
    const price = Math.min(this.ship.credits, TOW_PRICE);
    this.comm.ask(`Kein Treibstoff für den Sprung. Der Abschleppdienst bringt Sie für ${price.toLocaleString('de-DE')} Cr zur nächsten Station.`, [
      { label: 'Abschleppen lassen', run: () => this.tow(price) },
      { label: 'Nein danke', run: () => {} },
    ], { speaker: 'Pannendienst Sol', faction: 'civil', seed: 77, timeout: 15000 });
  }

  tow(price) {
    const st = this.solarSystem.nearestStation(this.ship.position, (s) => !s.hidden && !s.def.faction);
    this.ship.credits -= price;
    this.ship.fuel = Math.max(this.ship.fuel, 10);
    this.npcs.clearAll();
    this.combat.clear();
    this.placeShipAtStation(st);
    this.fx.warpFlash(this.ship.position, null);
    this.hud.toast(`Abgeschleppt zu ${displayName(st.name)}`, 'info');
  }

  updateWarpJump(delta) {
    if (!this.warpState || !this.warpTarget) return;
    this.warpTimer += delta;
    const target = this.warpTarget;
    const flashDiv = document.getElementById('warp-flash');

    if (this.warpState === 'charging') {
      const targetPos = (target.group ? target.group.position : target.mesh.position).clone();
      const dir = targetPos.clone().sub(this.ship.position).normalize();
      const qRotate = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      this.ship.quaternion.slerp(qRotate, delta * 3.5);
      this.ship.mesh.quaternion.copy(this.ship.quaternion);
      this.ship.throttle = 1.0;
      const t = Math.min(1.0, this.warpTimer / this.warpChargeTime);
      this.camera.fov = 65 + t * 40;
      this.camera.updateProjectionMatrix();
      flashDiv.style.opacity = (t * 0.4).toString();
      // Getting shot at disturbs the charge: a hostile closing in aborts it
      if (this.encounters.massLocked()) {
        this.abortWarp('MASSENSPERRE: Sprung abgebrochen');
        return;
      }
      if (this.warpTimer >= this.warpChargeTime) {
        this.warpState = 'hyper';
        this.warpTimer = 0;
        spaceAudio.playWarpJump();
      }
    } else if (this.warpState === 'hyper') {
      const targetPos = (target.group ? target.group.position : target.mesh.position).clone();
      const shipPos = this.ship.position;

      // Move extremely fast towards the target, but never into or through a body
      const dir = targetPos.clone().sub(shipPos).normalize();
      const gap = targetPos.distanceTo(shipPos) - arrivalRadius(target);
      const speed = Math.min(2200, Math.max(0, gap) * 4);
      const travel = dir.clone().multiplyScalar(speed * delta);
      const blocked = this.solarSystem.planets.some((p) => distanceToSegment(p.group.position, shipPos, travel) < atmosphereTop(p) + WARP_CLEARANCE);
      this.ship.velocity.copy(dir).multiplyScalar(blocked ? 0 : speed);
      this.ship.throttle = 1.0;
      const t = Math.min(1.0, this.warpTimer / 0.5);
      this.camera.fov = 105 + t * 20;
      this.camera.updateProjectionMatrix();
      flashDiv.style.opacity = (0.4 + t * 0.6).toString();

      if (this.warpTimer >= 0.5) {
        let offsetDist = 0;
        let exitSpeed = 0;
        let exitPos = null;

        if (this.warpInterdicted) {
          // Dragged out halfway, still moving
          exitPos = this.solarSystem.pushClear(this.warpStart.clone().lerp(targetPos, 0.35 + Math.random() * 0.3).add(new THREE.Vector3(0, 30, 0)), 80);
          dir.copy(targetPos).sub(exitPos).normalize();
          exitSpeed = this.ship.maxSpeed * 1.2;
        } else if (target.kind === 'station') {
          // Station: exit on the far side from its planet, outside docking range, at rest
          exitSpeed = 0;
          dir.copy(this.ship.stationOutward(target, this.solarSystem)).negate();
          offsetDist = stationHoldStandoff(target);
        } else if (target.kind === 'asteroid') {
          offsetDist = target.size + 12;
          exitSpeed = 0;
        } else if (this.solarSystem.planets.includes(target)) {
          // Planet / Sun: brake in alongside it and stop at a safe distance, at rest relative to the planet
          exitSpeed = this.ship.maxSpeed * 1.8;
          this.warpHoldDist = planetHoldDistance(target);
          this.warpBrakeDist = (exitSpeed * WARP_BRAKE_TIME) / 2;
          dir.copy(this.clearWarpApproach(target, dir, this.warpHoldDist + this.warpBrakeDist));
          offsetDist = this.warpHoldDist + this.warpBrakeDist;
        } else {
          // Ships and nav points: a short glide in, stopping well short
          exitSpeed = this.ship.maxSpeed * 1.2;
          offsetDist = (target.radius || 1) + exitSpeed * 0.5 + 60;
        }

        this.warpExitSpeed = exitSpeed;
        this.warpDir = dir.clone();
        if (exitPos) this.ship.position.copy(exitPos);
        else this.ship.position.copy(targetPos).sub(dir.clone().multiplyScalar(offsetDist));
        this.ship.position.y += 0.1;
        this.ship.mesh.position.copy(this.ship.position);
        this.ship.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
        this.ship.mesh.quaternion.copy(this.ship.quaternion);

        const cameraOffset = new THREE.Vector3(0, 1.2 * (this.ship.cameraDistance / 6.0), this.ship.cameraDistance).applyQuaternion(this.ship.quaternion);
        this.camera.position.copy(this.ship.position).add(cameraOffset);
        this.camera.lookAt(this.ship.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion).multiplyScalar(10)));
        this.camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(this.ship.quaternion));

        // Ships left behind stay behind
        this.npcs.ships.filter((n) => !n.mission && n.pos.distanceTo(this.ship.position) > 6000).forEach((n) => this.npcs.remove(n));
        this.warpState = 'decelerating';
        this.warpTimer = 0;
        spaceAudio.setWarp(false);
        this.ship.velocity.copy(dir).multiplyScalar(exitSpeed);
        this.ship.throttle = 0.0;
      }
    } else if (this.warpState === 'decelerating') {
      const targetPos = (target.group ? target.group.position : target.mesh.position).clone();
      const shipPos = this.ship.position;
      const t = Math.min(1.0, this.warpTimer / WARP_BRAKE_TIME);
      const isPlanet = this.solarSystem.planets.includes(target) && !this.warpInterdicted;

      if (this.warpInterdicted) {
        this.ship.velocity.copy(this.warpDir).multiplyScalar(this.warpExitSpeed * (1 - t * 0.7));
      } else if (target.kind === 'station') {
        shipPos.copy(this.ship.stationDockPoint(target, stationHoldStandoff(target), this.solarSystem));
      } else if (isPlanet) {
        const remaining = this.warpBrakeDist * (1.0 - t) * (1.0 - t);
        shipPos.copy(targetPos).sub(this.warpDir.clone().multiplyScalar(this.warpHoldDist + remaining));
        this.ship.velocity.set(0, 0, 0);
      } else {
        const dir = targetPos.clone().sub(shipPos).normalize();
        this.ship.velocity.copy(dir).multiplyScalar(this.warpExitSpeed * (1.0 - t));
      }

      this.camera.fov = 125 - t * 60;
      this.camera.updateProjectionMatrix();
      flashDiv.style.opacity = (1.0 - t).toString();

      if (this.warpTimer >= WARP_BRAKE_TIME) {
        this.warpState = null;
        this.ship.isWarping = false;
        this.camera.fov = 65;
        this.camera.updateProjectionMatrix();
        flashDiv.style.opacity = '0';
        this.ship.throttle = 0.0;
        const frame = this.solarSystem.frameBodyAt(shipPos);
        this.ship.velocity.copy(frame ? frame.velocity : ZERO);

        if (this.warpInterdicted) {
          this.warpInterdicted = false;
          this.ship.velocity.addScaledVector(this.warpDir, this.ship.maxSpeed * 0.4);
          this.encounters.sprungInterdiction();
          return;
        }
        if (target.kind === 'station') {
          this.ship.autopilotActive = true;
          if (!this.ui.tutorial.active) this.ui.tutorial.say('Du hältst vor der Station. W gleitet heran, G dockt an. Mit X, S oder der Maus fliegst du wieder weg.', 8000);
        }
        if (isPlanet) {
          if (target.velocity) this.ship.velocity.copy(target.velocity);
          if (!this.ui.tutorial.active) this.ui.tutorial.say(`${displayName(target.name)} erreicht. Du hast die Steuerung.`, 5000);
        }
      }
    }
  }

  abortWarp(message) {
    this.warpState = null;
    this.ship.isWarping = false;
    this.camera.fov = 65;
    this.camera.updateProjectionMatrix();
    document.getElementById('warp-flash').style.opacity = '0';
    spaceAudio.setWarp(false);
    this.ship.throttle = 0;
    this.hud.toast(message, 'bad');
    sfx.denied();
  }

  // Direction from which the jump approaches `target`: the requested one if the stretch from the exit point
  // to the parking point is clear of other bodies, else the nearest clear one, turned around the target
  clearWarpApproach(target, dir, exitDist) {
    const center = target.group.position;
    const obstacles = this.solarSystem.planets
      .filter((p) => p !== target)
      .map((p) => ({ center: p.group.position, safeRadius: atmosphereTop(p) + WARP_CLEARANCE }));
    const holdDist = planetHoldDistance(target);
    const isClear = (candidate) => {
      for (let i = 0; i <= 4; i++) {
        const point = center.clone().sub(candidate.clone().multiplyScalar(holdDist + ((exitDist - holdDist) * i) / 4));
        if (obstacles.some((o) => point.distanceTo(o.center) < o.safeRadius)) return false;
      }
      return true;
    };
    if (isClear(dir)) return dir;
    const up = new THREE.Vector3(0, 1, 0);
    for (let step = 1; step <= 12; step++) {
      for (const side of [1, -1]) {
        const candidate = dir.clone().applyAxisAngle(up, side * step * THREE.MathUtils.degToRad(15));
        if (isClear(candidate)) return candidate;
      }
    }
    return dir;
  }

  startSimulation() {
    // The world kept turning behind the start screen: re-place the ship now
    this.placeShipAtHome();
    this.aimReference = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
    this.simRunning = true;
    controls.start(document.getElementById('space-canvas'));
    music.start();
  }

  toggleFlightAssist() {
    if (!this.flying()) return;
    this.ship.flightAssist = !this.ship.flightAssist;
    spaceAudio.playBeep();
  }

  toggleAudio() {
    spaceAudio.setMute(!spaceAudio.muted);
    this.settings.sound = !spaceAudio.muted;
    saveSettings(this.settings);
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  // ----- the frame -------------------------------------------------------------------------------

  tick() {
    requestAnimationFrame(this.tick.bind(this));
    let delta = Math.min(this.clock.getDelta(), 0.1);
    if (this.paused) delta = 0;

    this.solarSystem.update(delta, this.ship ? this.ship.position : null);

    if (this.simRunning && delta > 0) {
      const low = this.surface.active;
      if (this.warpState) this.updateWarpJump(delta);
      if (!low) this.updateAimedTarget();
      if (low) {
        // Atmospheric flight: the ship flies and is filmed in local terms, then goes back to its point in space
        this.surface.beforeShip();
        this.ship.update(delta, null);
        this.surface.update(delta);
        this.ship.updateCamera(this.camera, delta);
        this.surface.afterShip();
        if (this.surface.wantExit) {
          this.surface.exit();
          this.ship.updateCamera(this.camera, 1);
        }
      } else {
        this.ship.update(delta, this.solarSystem);
        this.ship.updateCamera(this.camera, delta);
      }
      if (!this.warpState) {
        const wantFov = 65 + (this.ship.boosting ? 7 : 0);
        if (Math.abs(this.camera.fov - wantFov) > 0.05) {
          this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, delta * 4);
          this.camera.updateProjectionMatrix();
        }
      }

      if (this.ship.atmosphereContact > 0) this.ship.atmosphereContact -= delta;
      if (!this.surface.active) {
        this.npcs.update(delta);
        this.combat.update(delta);
        if (!this.ship.isDocked) this.checkCollisions();
        this.encounters.update(delta);
        this.surface.updateApproach(delta);
      }
      this.missions.update(delta);
      this.law.update(delta);
      this.storm.update(delta);
      this.economy.update(delta);
      if (this.surface.active) {
        this.fx.update(delta, this.camera, { velocity: this.surface.local.vel, frameVelocity: ZERO, isWarping: false });
      } else {
        this.fx.update(delta, this.camera, this.ship);
        this.updateLootCrates(delta);
      }
      this.comm.update();
      this.ui.update(this.ship, this.solarSystem, this.camera);
      this.hud.update(delta);
      this.ui.tutorial.update(this.ship, this.dockableStation);
      music.update(delta, this.dangerLevel());

      this.autosaveTimer += delta;
      if (this.autosaveTimer >= AUTOSAVE_INTERVAL && !this.ship.isDestroyed) {
        this.autosaveTimer = 0;
        this.saveProgress();
      }
      controls.clearDeltas();
    } else if (!this.simRunning) {
      // Behind the start screen: a slow pass over Earth, swinging between the day side and the terminator
      const earth = this.solarSystem.planets[3];
      const up = new THREE.Vector3(0, 1, 0);
      const swing = Math.sin(Date.now() * 0.00005);
      const dir = earth.group.position.clone().negate().setY(0).normalize().applyAxisAngle(up, 1.05 + swing * 0.35);
      this.camera.up.copy(up);
      this.camera.position.copy(earth.group.position).addScaledVector(dir, earth.radius * 2.3).addScaledVector(up, earth.radius * 0.45);
      const side = new THREE.Vector3().crossVectors(up, dir).normalize();
      this.camera.lookAt(earth.group.position.clone().addScaledVector(side, earth.radius * 0.55));
    } else {
      controls.clearDeltas();
    }

    if (this.surface.active) this.surface.prepareRender(this.camera, delta);
    else this.solarSystem.updateView(this.camera);
    this.eyes.update(delta);
    // Inside a station the painted interior covers the screen: no need to render space behind it
    if (!(this.ship.isDocked && this.ui.stationUI.isOpen)) this.composer.render(delta);
    if (this.simRunning && !this.surface.active) this.missileCam.render(delta);
  }

  // 0 calm, ~0.4 hostiles around, 1 in a fight
  dangerLevel() {
    const ship = this.ship;
    if (ship.isDocked || ship.isDestroyed) return 0;
    let level = 0;
    for (const n of this.npcs.ships) {
      if (!n.guns || !this.npcs.isHostile(n, ship)) continue;
      const d = n.pos.distanceTo(ship.position);
      if (d < 700 && n.mode === 'attack') return 1;
      if (d < 2200) level = Math.max(level, 0.45);
    }
    if (ship.incomingMissiles > 0 || performance.now() - ship.lastHullHit < 4000) return 1;
    return level;
  }

  // ----- collisions ------------------------------------------------------------------------------

  // Two things bumped: push apart, bounce, and hurt in proportion to the closing speed
  bump(normal, otherVel, otherSize) {
    const ship = this.ship;
    const rel = ship.velocity.clone().sub(otherVel);
    const closing = -rel.dot(normal);
    if (closing <= 0) return 0;
    rel.addScaledVector(normal, closing * 1.6);
    ship.velocity.copy(rel).add(otherVel);
    ship.rotationSpeed.roll += (Math.random() - 0.5) * 3;
    ship.shake = Math.max(ship.shake, Math.min(1, closing / 30));
    if (closing > RAM_SPEED) {
      const damage = (closing - RAM_SPEED) * 1.4 * Math.min(1, otherSize / 2);
      ship.applyHit(damage, ship.position.clone().addScaledVector(normal, -ship.radius), null, null, 'ram');
      sfx.crash();
    } else {
      sfx.hitConfirm(false);
    }
    return closing;
  }

  checkCollisions() {
    const ship = this.ship;
    const solarSystem = this.solarSystem;
    if (ship.isWarping || ship.isDestroyed) return;

    if (!ship.autopilotActive) {
      for (const ast of this.combat.nearRocks) {
        const offset = ship.position.clone().sub(ast.mesh.position);
        const dist = offset.length();
        const reach = ast.size + ship.radius;
        if (dist < reach) {
          const n = offset.divideScalar(dist || 1);
          ship.position.copy(ast.mesh.position).addScaledVector(n, reach);
          this.bump(n, ZERO, ast.size);
          this.fx.rockHit(ship.position.clone().addScaledVector(n, -ship.radius), n);
          break;
        }
      }
      for (const st of this.combat.nearStations) {
        const offset = ship.position.clone().sub(st.mesh.position);
        const dist = offset.length();
        const reach = st.size * 0.82 + ship.radius;
        if (dist < reach) {
          const n = offset.divideScalar(dist || 1);
          ship.position.copy(st.mesh.position).addScaledVector(n, reach);
          const planet = solarSystem.planets[st.planetIndex];
          this.bump(n, planet.velocity || ZERO, 20);
        }
      }
    }

    for (const npc of this.npcs.ships) {
      const offset = ship.position.clone().sub(npc.pos);
      const dist = offset.length();
      const reach = npc.radius * 0.8 + ship.radius;
      if (dist < reach) {
        const n = offset.divideScalar(dist || 1);
        ship.position.copy(npc.pos).addScaledVector(n, reach);
        const closing = this.bump(n, npc.vel, npc.radius);
        if (closing > RAM_SPEED) npc.applyHit((closing - RAM_SPEED) * 1.2, npc.pos.clone().addScaledVector(n, npc.radius), ship);
      }
    }

    // Planets: the ship flies down into the upper atmosphere and no deeper; only the Sun destroys it
    for (let i = 0; i < solarSystem.planets.length; i++) {
      const p = solarSystem.planets[i];
      const offset = ship.position.clone().sub(p.group.position);
      const dist = offset.length();
      if (p.name === 'Sun') {
        if (dist < p.radius * 1.02 + 0.45) {
          this.triggerShipExplosion(p.name);
          break;
        }
        continue;
      }
      // Deep enough over a planet with a ground: atmospheric flight takes over
      const entry = surfaceEntryRadius(p);
      if (entry && dist < entry && !ship.autopilotActive && this.surface.enter(p)) return;
      const floor = flightFloor(p);
      if (dist >= floor) continue;
      const up = offset.divideScalar(dist || 1);
      ship.position.copy(p.group.position).addScaledVector(up, floor);
      ship.mesh.position.copy(ship.position);
      const planetVelocity = p.velocity || ZERO;
      const rel = ship.velocity.clone().sub(planetVelocity);
      const sink = -rel.dot(up);
      if (sink > 0) {
        if (ship.atmosphereContact <= 0) {
          spaceAudio.playAutopilotAlert(false);
          if (sink > HEAT_SPEED) {
            ship.shield = Math.max(0, ship.shield - (sink - HEAT_SPEED) * 0.5);
            ship.rotationSpeed.pitch += (Math.random() - 0.5) * 0.6;
          }
        }
        rel.addScaledVector(up, sink * 1.25);
        ship.velocity.copy(rel).add(planetVelocity);
      }
      ship.atmosphereContact = 0.6;
      break;
    }
  }

  // ----- what happens when things are shot ----------------------------------------------------------

  hitRock(rock, damage, point, owner) {
    const normal = point.clone().sub(rock.mesh.position).normalize();
    this.fx.rockHit(point, normal);
    // Rocks only crack under sustained fire; the player's guns are what mining is for
    rock.hp -= owner === this.ship ? damage : damage * 0.3;
    if (rock.hp > 0) return;
    this.fx.rockBreak(rock.mesh.position, rock.size);
    sfx.explosionAt(rock.mesh.position, 0.35 + rock.size / 30);
    this.solarSystem.removeAsteroid(rock);
    this.combat.nearRocks = this.combat.nearRocks.filter((r) => r !== rock);
    if (this.ship.targetObject === rock) this.ship.targetObject = null;
    if (owner !== this.ship) return;
    const chunks = THREE.MathUtils.clamp(Math.round(rock.size / 5), 1, 5);
    for (let i = 0; i < chunks; i++) {
      const good = rock.rockKind === 'ice' ? 'ice' : rock.rockKind === 'ore' ? 'ore' : Math.random() < 0.6 ? 'ore' : 'ice';
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const pos = rock.mesh.position.clone().addScaledVector(dir, rock.size * 0.5);
      this.spawnLoot(pos, good, rock.rockKind === 'rock' ? 1 : 1 + Math.floor(Math.random() * 2), 0, { velocity: dir.multiplyScalar(3 + Math.random() * 4) });
    }
  }

  onStationHit(st, owner) {
    if (owner !== this.ship) return;
    st.hits = (st.hits || 0) + 1;
    if (st.hits === 3) this.comm.say('Hier Stationssicherheit: Feuer sofort einstellen!', { speaker: `Sicherheit ${displayName(st.name)}`, faction: st.def.faction === 'pirate' ? 'pirate' : 'police', urgent: true, duration: 4000 });
    if (st.hits >= 8) {
      st.hits = 0;
      if (st.def.faction === 'pirate') {
        this.law.changeRep('pirate', -10);
        this.npcs.ships.forEach((n) => { if (n.faction === 'pirate' && n.home.station === st) { n.aggro = true; n.attack(this.ship); } });
      } else {
        this.law.raise(2, 2500);
      }
    }
  }

  onNpcKilled(npc, killer) {
    const byPlayer = killer === this.ship;
    if (byPlayer) {
      this.law.reportKill(npc);
      this.hud.toast(`Abschuss: ${npc.name}`, npc.faction === 'pirate' ? 'gain' : 'bad');
    } else {
      this.missions.onKill(npc);
    }
    // Some of what it carried survives
    if (byPlayer || Math.random() < 0.5) {
      npc.lootGoods().forEach((good) => {
        if (Math.random() < 0.65) {
          const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
          this.spawnLoot(npc.pos.clone().addScaledVector(dir, npc.radius * 0.5), good, 1 + Math.floor(Math.random() * 2), 0, { velocity: dir.multiplyScalar(4).add(npc.vel.clone().multiplyScalar(0.4)) });
        }
      });
    }
    this.comm.cancelFrom(npc);
  }

  // ----- death -----------------------------------------------------------------------------------

  triggerShipExplosion(cause) {
    if (this.ship.isDestroyed) return;
    const ship = this.ship;
    ship.isDestroyed = true;
    ship.autopilotActive = false;
    ship.velocity.set(0, 0, 0);
    ship.throttle = 0.0;
    if (this.warpState) this.abortWarp('');
    sfx.explosionAt(ship.position, 2);
    spaceAudio.playShipExplosion();
    this.fx.explosion(ship.position, 4);
    ship.mesh.visible = false;
    this.ship.cameraMode = 'chase';
    this.ship.cameraDistance = 22;

    const deathText = document.getElementById('death-reason-text');
    const planet = this.solarSystem.planets.find((p) => p.name === cause);
    if (planet) {
      const name = displayName(cause);
      const withArticle = ['Sonne', 'Erde', 'Venus'].includes(name) ? `der ${name}` : `dem ${name}`;
      deathText.innerText = `Dein Schiff ist mit ${withArticle} kollidiert und explodiert.`;
    } else if (cause === 'Sonnensturm') {
      deathText.innerText = 'Die Strahlung des Sonnensturms hat Schilde, Hülle und Bordelektronik zerfressen.';
    } else {
      deathText.innerText = `Abgeschossen von ${cause}.`;
    }
    // The hold is lost with the ship; the insurance takes its deductible; the account, upgrades and missions stay
    const fee = Math.round(Math.min(ship.credits, 400 + ship.credits * 0.08));
    ship.credits -= fee;
    ship.cargo = emptyCargo();
    document.getElementById('death-penalty-text').innerText = `Die Fracht ist verloren. Die Versicherung behält ${fee.toLocaleString('de-DE')} Cr Selbstbeteiligung. Konto, Ausbauten und Aufträge bleiben.`;
    if (this.law.wanted > 0) this.law.onDeath();
    this.comm.clear();
    this.saveProgress();
    setTimeout(() => {
      document.getElementById('game-over-screen').classList.remove('hidden');
      document.exitPointerLock();
    }, 1600);
  }

  respawnShip() {
    const ship = this.ship;
    this.surface.abort();
    ship.applyUpgrades();
    ship.fullRepair();
    ship.fuel = Math.max(ship.fuel, 30);
    ship.throttle = 0.0;
    ship.isDestroyed = false;
    ship.isWarping = false;
    this.warpState = null;
    this.npcs.clearAll();
    this.combat.clear();
    this.encounters.reset();
    this.missions.onRespawn();
    this.loots.forEach((loot) => this.scene.remove(loot.group));
    this.loots = [];
    this.placeShipAtHome();
    ship.cameraMode = 'cockpit';
    ship.mesh.visible = true;
    spaceAudio.setThrottle(0);
    spaceAudio.setWarp(false);
    document.getElementById('game-over-screen').classList.add('hidden');
    this.ui.closeSpaceport();
    this.ui.navMap.close(false);
    controls.requestLock();
    this.ui.updateHUDStats();
    this.saveProgress();
  }

  // ----- cargo pods ------------------------------------------------------------------------------

  // A floating crate: fly through it or pull it in with the tractor beam (B). good may be null for a special item.
  spawnLoot(position, good, qty = 1, credits = 0, opts = {}) {
    const group = new THREE.Group();
    group.position.copy(position);
    this.scene.add(group);
    const color = opts.special ? 0x40f0ff : LOOT_COLORS[good] || 0xffaa00;
    const crate = new THREE.Mesh(this.lootGeometry || (this.lootGeometry = new THREE.BoxGeometry(0.9, 0.9, 1.3)), new THREE.MeshStandardMaterial({ color: 0x55524c, roughness: 0.55, metalness: 0.7, emissive: color, emissiveIntensity: 0.18 }));
    group.add(crate);
    const beacon = new THREE.Sprite(this.lootBeaconMat(color));
    beacon.scale.setScalar(1.6);
    beacon.position.y = 0.7;
    group.add(beacon);
    const loot = {
      group, crate, beacon, good, qty, credits, special: opts.special || null, onCollect: opts.onCollect || null,
      velocity: opts.velocity ? opts.velocity.clone() : new THREE.Vector3(), spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2),
      pulse: Math.random() * 6, life: 240,
    };
    this.loots.push(loot);
    return loot;
  }

  lootBeaconMat(color) {
    this.lootMats = this.lootMats || {};
    if (!this.lootMats[color]) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.3, 'rgba(255,255,255,0.4)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      this.lootMats[color] = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: new THREE.Color(color).multiplyScalar(2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    }
    return this.lootMats[color];
  }

  collectLoot(loot) {
    const ship = this.ship;
    if (loot.special) {
      this.hud.toast(`Geborgen: ${loot.special}`, 'gain');
      sfx.pickup();
      if (loot.onCollect) loot.onCollect();
      return true;
    }
    if (loot.good) {
      const free = ship.maxCargo - ship.getCurrentCargoWeight();
      if (free <= 0) {
        if (!this.cargoFullWarned) this.hud.toast('Frachtraum voll', 'warn');
        this.cargoFullWarned = true;
        return false;
      }
      const n = Math.min(free, loot.qty);
      ship.cargo[loot.good] += n;
      loot.qty -= n;
      this.hud.toast(`+${n} t ${GOODS[loot.good].name}${GOODS[loot.good].contraband ? ' (Schmuggelware!)' : ''}`, GOODS[loot.good].contraband ? 'warn' : 'gain');
      if (loot.qty > 0) return false;
    }
    if (loot.credits) ship.credits += loot.credits;
    sfx.pickup();
    this.ui.updateHUDStats();
    return true;
  }

  updateLootCrates(delta) {
    const ship = this.ship;
    const isTractorActive = controls.keys.tractorBeam && !ship.isDestroyed && !ship.isDocked;
    spaceAudio.setTractorBeam(isTractorActive);
    let nearestCrate = null;
    let minCrateDist = Infinity;
    this.cargoFullWarned = this.cargoFullWarned && this.loots.some((l) => l.group.position.distanceTo(ship.position) < 4);

    for (let i = this.loots.length - 1; i >= 0; i--) {
      const loot = this.loots[i];
      loot.life -= delta;
      loot.crate.rotation.x += loot.spin.x * delta;
      loot.crate.rotation.y += loot.spin.y * delta;
      loot.crate.rotation.z += loot.spin.z * delta;
      loot.pulse += delta * 5;
      loot.beacon.scale.setScalar(1.2 + Math.sin(loot.pulse) * 0.5);
      loot.group.position.addScaledVector(loot.velocity, delta);
      loot.velocity.multiplyScalar(1 - Math.min(1, delta * 0.4));

      const toShip = ship.position.clone().sub(loot.group.position);
      const dist = toShip.length();
      if (isTractorActive && dist < TRACTOR_RANGE) {
        const pullSpeed = 26.0 + (TRACTOR_RANGE - dist) * 0.14;
        loot.group.position.addScaledVector(toShip.normalize(), Math.min(dist, pullSpeed * delta));
        loot.velocity.copy(ship.velocity);
        if (dist < minCrateDist) {
          minCrateDist = dist;
          nearestCrate = loot;
        }
      }

      const gone = loot.life <= 0;
      if (gone || (dist < 3.2 && this.collectLoot(loot))) {
        this.scene.remove(loot.group);
        loot.crate.material.dispose();
        if (ship.targetObject && ship.targetObject.mesh === loot.group) ship.targetObject = null;
        this.loots.splice(i, 1);
      }
    }

    if (isTractorActive && nearestCrate) {
      const startPos = ship.position.clone().add(new THREE.Vector3(0, -0.4, -1.2).applyQuaternion(ship.quaternion));
      this.tractorBeamLine.geometry.setFromPoints([startPos, nearestCrate.group.position]);
      this.tractorBeamLine.material.opacity = 0.55 + Math.sin(Date.now() * 0.02) * 0.35;
    } else {
      this.tractorBeamLine.material.opacity = 0;
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  if (import.meta.env.DEV) window.__game = game; // console access while developing
});
