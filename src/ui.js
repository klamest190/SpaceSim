import { spaceAudio } from './audio';
import * as THREE from 'three';
import { displayName } from './names';
import { Tutorial } from './tutorial';
import { NavMap } from './navMap';
import { arrivalRadius, gravityRadius, stationDockRange } from './spaceship';
import { StationUI } from './stationUI';
import { controls } from './controls';
import { music } from './music';
import { SUBSYSTEMS } from './world';
import { DIFFICULTIES, DIFFICULTY_KEYS, difficultyOf } from './difficulty';

const PROMPT_KEYS = {
  travel: ['[X] Hinfliegen', '[T] Nächstes Ziel'],
  hold: ['[W] Heranfliegen', '[S] Zurück', '[X] Loslassen'],
  besideStation: ['[X] Andockposition', '[T] Nächstes Ziel'],
  combat: ['[R] Nächster Feind', '[Rechtsklick] Rakete', '[K] Täuschkörper'],
};

const FACTION_LABEL = { pirate: 'ASCHEBUND', police: 'SOLPOL', civil: 'ZIVIL' };

// Game units -> readable distance (arcade scale: 1 unit = 100.000 km)
// What kind of thing is locked, for the target VDU
function targetKind(target, game) {
  if (target.kind === 'npc') {
    const hostile = game.npcs.isHostile(target, game.ship);
    const bounty = target.faction === 'pirate' && target.bounty ? ` · ${target.bounty.toLocaleString('de-DE')} Cr` : '';
    return `${FACTION_LABEL[target.faction] || ''} ${target.spec.label.toUpperCase()}${hostile ? ' · FEIND' : ''}${bounty}`;
  }
  if (target.kind === 'waypoint') return 'NAVPUNKT';
  if (target.kind === 'asteroid') return `ASTEROID · ${target.rockKind === 'ice' ? 'EIS' : target.rockKind === 'ore' ? 'ERZ' : 'GESTEIN'}`;
  if (target.name === 'Sun') return 'STERN';
  if (target.group && target.radius) return target.parent ? `MOND · ${displayName(target.parent.name).toUpperCase()}` : 'PLANET';
  if (target.kind === 'station') return target.def.faction === 'pirate' ? 'PIRATENBASIS' : target.def.blackMarket ? 'STATION · SCHWARZMARKT' : 'STATION';
  return '---';
}

const WIRE_SEGMENT_LIMIT = 2400;

// Line segments (x1,y1,z1,x2,y2,z2...) of a target's shape inside a unit sphere; built once per target
function wireframeFor(target) {
  if (target.__wire) return target.__wire;
  const out = [];
  let planet = false;
  if (target.group && target.radius) {
    planet = true;
    // latitude circle at height y, or a meridian at longitude lon
    const circle = (steps, point) => {
      for (let i = 0; i < steps; i++) {
        const a = point((i / steps) * Math.PI * 2);
        const b = point(((i + 1) / steps) * Math.PI * 2);
        out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
    };
    for (let lat = -60; lat <= 60; lat += 30) {
      const phi = THREE.MathUtils.degToRad(lat);
      circle(36, (t) => [Math.cos(t) * Math.cos(phi), Math.sin(phi), Math.sin(t) * Math.cos(phi)]);
    }
    for (let lon = 0; lon < 180; lon += 30) {
      const l = THREE.MathUtils.degToRad(lon);
      circle(36, (t) => [Math.cos(t) * Math.cos(l), Math.sin(t), Math.cos(t) * Math.sin(l)]);
    }
    const rings = target.data && target.data.rings;
    if (rings) {
      [rings.inner, (rings.inner + rings.outer) / 2, rings.outer].forEach((r) => circle(64, (t) => [Math.cos(t) * r, 0, Math.sin(t) * r]));
      for (let i = 0; i < out.length; i++) out[i] /= rings.outer;
    }
  } else if (target.mesh) {
    const root = target.mesh;
    root.updateMatrixWorld(true);
    const inv = root.matrixWorld.clone().invert();
    const p = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const edges = new THREE.EdgesGeometry(o.geometry, 25);
      const m = inv.clone().multiply(o.matrixWorld);
      const pos = edges.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(m);
        out.push(p.x, p.y, p.z);
      }
      edges.dispose();
    });
    // Centre and fit into the unit sphere
    const box = new THREE.Box3();
    for (let i = 0; i < out.length; i += 3) box.expandByPoint(p.set(out[i], out[i + 1], out[i + 2]));
    const center = box.getCenter(new THREE.Vector3());
    let maxR = 1e-6;
    for (let i = 0; i < out.length; i += 3) maxR = Math.max(maxR, p.set(out[i], out[i + 1], out[i + 2]).distanceTo(center));
    for (let i = 0; i < out.length; i += 3) {
      out[i] = (out[i] - center.x) / maxR;
      out[i + 1] = (out[i + 1] - center.y) / maxR;
      out[i + 2] = (out[i + 2] - center.z) / maxR;
    }
  }
  let segments = Float32Array.from(out);
  const count = segments.length / 6;
  if (count > WIRE_SEGMENT_LIMIT) {
    const step = Math.ceil(count / WIRE_SEGMENT_LIMIT);
    const kept = [];
    for (let i = 0; i < count; i += step) kept.push(...segments.subarray(i * 6, i * 6 + 6));
    segments = Float32Array.from(kept);
  }
  target.__wire = { segments, planet, sun: target.name === 'Sun' };
  return target.__wire;
}

function formatDist(gameDistance) {
  const km = gameDistance * 100000;
  if (km > 149600000) return `${(km / 149597870.7).toFixed(2).replace('.', ',')} AE`;
  return `${Math.round(km).toLocaleString('de-DE')} km`;
}

export class UI {
  constructor(game) {
    this.game = game;
    
    // Cache DOM Elements
    this.startScreen = document.getElementById('start-screen');
    this.hud = document.getElementById('hud');
    this.launchBtn = document.getElementById('launch-btn');
    this.newCareerBtn = document.getElementById('new-career-btn');
    this.saveSummary = document.getElementById('save-summary');
    
    this.targetName = document.getElementById('target-name');
    this.targetDist = document.getElementById('target-dist');
    this.targetSpeed = document.getElementById('target-speed');
    this.targetReticle = document.getElementById('target-reticle');
    this.targetReticleLabel = document.getElementById('target-reticle-label');
    
    this.btnFa = document.getElementById('btn-fa');
    this.btnMute = document.getElementById('btn-mute');
    
    // Help manual
    this.btnHelp = document.getElementById('btn-help');
    this.helpGuide = document.getElementById('controls-hud-guide');
    this.helpGuideActive = false;
    
    // Travel, autopilot and weapons
    this.travelPrompt = document.getElementById('hud-travel-prompt');
    this.travelName = document.getElementById('hud-travel-name');
    this.travelKeys = document.getElementById('hud-travel-keys');
    this.travelKeysShown = null;
    this.btnAutopilot = document.getElementById('btn-autopilot');
    this.autopilotStatus = document.getElementById('autopilot-status-indicator');
    this.weaponEnergyBar = document.getElementById('weapon-energy-bar');
    this.weaponEnergyVal = document.getElementById('weapon-energy-val');
    
    // Shields & Armor
    this.shieldF = document.getElementById('shield-f');
    this.shieldB = document.getElementById('shield-b');
    this.shieldL = document.getElementById('shield-l');
    this.shieldR = document.getElementById('shield-r');
    this.shieldVal = document.getElementById('shield-val');
    this.targetKind = document.getElementById('target-kind');
    this.lamps = {};
    document.querySelectorAll('#annunciator .lamp').forEach((el) => { this.lamps[el.dataset.lamp] = el; });
    
    // Speeds
    this.setSpeedBar = document.getElementById('set-speed-bar');
    this.setSpeedVal = document.getElementById('set-speed-val');
    this.actSpeedBar = document.getElementById('act-speed-bar');
    this.actSpeedVal = document.getElementById('act-speed-val');
    
    // Prompts and alerts
    this.dockPrompt = document.getElementById('hud-dock-prompt');
    this.gravityAlert = document.getElementById('hud-gravity-alert');
    this.gravityAlertText = this.gravityAlert.querySelector('span');
    this.altimeter = document.getElementById('hud-altitude');
    this.altimeterValue = document.getElementById('hud-altitude-value');
    
    // Campaign HUD Stats
    this.hudCredits = document.getElementById('hud-credits');
    this.hudCargo = document.getElementById('hud-cargo');
    
    this.hullVal = document.getElementById('hull-val');
    this.fuelVal = document.getElementById('fuel-val');
    this.missileVal = document.getElementById('missile-val');
    this.flareVal = document.getElementById('flare-val');
    this.boostBar = document.getElementById('boost-bar');
    this.sysLamps = {};
    document.querySelectorAll('#sys-lamps [data-sys]').forEach((el) => { this.sysLamps[el.dataset.sys] = el; });
    this.targetBars = document.getElementById('target-bars');
    this.targetShieldBar = document.getElementById('target-shield-bar');
    this.targetHullBar = document.getElementById('target-hull-bar');
    this.extHull = document.getElementById('ext-hull');

    // Canvases
    this.targetCanvas = document.getElementById('target-wireframe-canvas');
    this.targetCtx = this.targetCanvas.getContext('2d');
    this.radarFrontCanvas = document.getElementById('radar-front-canvas');
    this.radarFrontCtx = this.radarFrontCanvas.getContext('2d');
    this.radarRearCanvas = document.getElementById('radar-rear-canvas');
    this.radarRearCtx = this.radarRearCanvas.getContext('2d');

    this.stationUI = new StationUI(game);
    this.pauseScreen = document.getElementById('pause-screen');
    this.pauseOpen = false;

    // Target closing-speed tracking
    this.lastRelTarget = null;
    this.lastRelPos = new THREE.Vector3();
    this.lastRelTime = 0;
    this.relSpeed = 0;
    this.currentStationDocked = null;
    this.globeAngle = 0;

    this.passiveContainer = document.getElementById('passive-markers-container');
    this.createPassiveMarkers();

    // Cockpit vs. external view
    this.cockpitLayer = document.getElementById('cockpit-layer');
    this.frameLight = {};
    this.extAim = document.getElementById('ext-aim');
    this.extThrottle = document.getElementById('ext-throttle');
    this.extSpeed = document.getElementById('ext-speed');
    this.extShield = document.getElementById('ext-shield');
    this.extTarget = document.getElementById('ext-target');
    this.extAutopilot = document.getElementById('ext-autopilot');

    this.tutorial = new Tutorial(game);
    this.navMap = new NavMap(game, formatDist);
    this.renderStartScreen();

    this.setupListeners();
  }

  renderStartScreen() {
    const save = this.game.savedGame;
    if (save) {
      const credits = Math.round(save.credits).toLocaleString('de-DE');
      const cargo = Object.values(save.cargo || {}).reduce((a, b) => a + b, 0);
      this.saveSummary.innerHTML = `<span>Konto</span><b>${credits} Cr</b><span>Fracht an Bord</span><b>${cargo} t</b>`;
      this.saveSummary.classList.remove('hidden');
      this.launchBtn.innerText = 'Weiterfliegen';
      this.newCareerBtn.classList.remove('hidden');
    } else {
      this.saveSummary.classList.add('hidden');
      this.launchBtn.innerText = 'Starten';
      this.newCareerBtn.classList.add('hidden');
    }
  }

  launch(newCareer, difficulty = 'normal') {
    if (newCareer) this.game.startNewCareer(difficulty);
    const tutorialDone = !newCareer && !!(this.game.savedGame && this.game.savedGame.tutorialDone);
    this.startScreen.classList.add('hidden');
    this.hud.classList.remove('hidden');
    spaceAudio.init();
    spaceAudio.setMute(this.game.settings.sound === false);
    this.game.startSimulation();
    this.updateHUDStats();
    this.tutorial.start(tutorialDone);
  }

  setupListeners() {
    // Launch mission
    // Without a career to continue, the first start asks for a difficulty too
    this.launchBtn.addEventListener('click', () => (this.game.savedGame ? this.launch(false) : this.openDifficulty('start')));
    this.newCareerBtn.addEventListener('click', () => this.openDifficulty('start'));

    // Difficulty picker
    this.difficultyScreen = document.getElementById('difficulty-screen');
    this.difficultyOpen = false;
    document.getElementById('difficulty-cancel').addEventListener('click', () => this.closeDifficulty());
    document.getElementById('difficulty-cards').addEventListener('click', (e) => {
      const b = e.target.closest('[data-diff]');
      if (b) this.chooseDifficulty(b.dataset.diff);
    });
    document.getElementById('new-game-btn').addEventListener('click', () => this.openDifficulty('pause'));

    // Flight Assist
    this.btnFa.addEventListener('click', () => {
      this.game.toggleFlightAssist();
    });

    // Audio
    this.btnMute.addEventListener('click', () => {
      this.game.toggleAudio();
    });

    // Fly to the target, same as X
    this.btnAutopilot.addEventListener('click', () => {
      this.game.flyToTarget();
    });

    // Help Manual
    this.btnHelp.addEventListener('click', () => {
      this.toggleHelpGuide();
    });

    // Pause / logbook
    document.getElementById('resume-btn').addEventListener('click', () => this.closePause());
    const s = this.game.settings;
    const sens = document.getElementById('set-sens');
    const sensVal = document.getElementById('set-sens-val');
    const invert = document.getElementById('set-invert');
    const sound = document.getElementById('set-sound');
    const musicBox = document.getElementById('set-music');
    const musicVol = document.getElementById('set-music-vol');
    sens.value = s.sensitivity;
    sensVal.textContent = Number(s.sensitivity).toFixed(2);
    invert.checked = s.invertY;
    sound.checked = s.sound !== false;
    musicBox.checked = s.music;
    musicVol.value = s.musicVolume;
    sens.addEventListener('input', () => { s.sensitivity = Number(sens.value); sensVal.textContent = s.sensitivity.toFixed(2); this.game.applySettings(); });
    invert.addEventListener('change', () => { s.invertY = invert.checked; this.game.applySettings(); });
    sound.addEventListener('change', () => { s.sound = sound.checked; spaceAudio.setMute(!s.sound); this.game.applySettings(); });
    musicBox.addEventListener('change', () => { s.music = musicBox.checked; this.game.applySettings(); });
    musicVol.addEventListener('input', () => { s.musicVolume = Number(musicVol.value); this.game.applySettings(); });
    this.pauseScreen.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pact]');
      if (!b) return;
      const [act, id] = b.dataset.pact.split(':');
      const m = this.game.missions.active.find((x) => String(x.id) === id);
      if (!m) return;
      if (act === 'track') {
        this.game.missions.tracked = m;
        const dest = this.game.missions.destination(m);
        if (dest) this.game.setTarget(dest);
      }
      if (act === 'abort') this.game.missions.abort(m);
      spaceAudio.playBeep();
      this.renderPause();
    });
  }

  // from: 'start' (start screen) or 'pause' (a running game, which will be replaced)
  openDifficulty(from) {
    this.difficultyFrom = from;
    const current = this.game.difficulty;
    document.getElementById('difficulty-warning').classList.toggle('hidden', !(from === 'pause' || this.game.savedGame));
    document.getElementById('difficulty-cards').innerHTML = DIFFICULTY_KEYS.map((key, i) => {
      const d = DIFFICULTIES[key];
      return `<div class="difficulty-card ${key}">
        <h3>${d.label}${from === 'pause' && key === current ? ' <small>aktuell</small>' : ''}</h3>
        <p class="tagline">${d.tagline}</p>
        <ul>${d.perks.map((p) => `<li>${p}</li>`).join('')}</ul>
        <button class="metal-btn ${key === 'normal' ? 'primary' : ''}" data-diff="${key}">${d.label} wählen [${i + 1}]</button>
      </div>`;
    }).join('');
    this.difficultyScreen.classList.remove('hidden');
    this.difficultyOpen = true;
    spaceAudio.playBeep();
  }

  closeDifficulty() {
    this.difficultyScreen.classList.add('hidden');
    this.difficultyOpen = false;
  }

  chooseDifficulty(key) {
    if (!DIFFICULTIES[key]) return;
    this.closeDifficulty();
    spaceAudio.playBeep();
    if (this.difficultyFrom === 'pause') {
      this.game.newGame(key);
      this.closePause();
    } else {
      this.launch(true, key);
    }
  }

  openPause() {
    if (this.pauseOpen) return;
    this.pauseOpen = true;
    this.game.paused = true;
    this.renderPause();
    this.pauseScreen.classList.remove('hidden');
    document.exitPointerLock();
    spaceAudio.playBeep();
  }

  closePause() {
    if (!this.pauseOpen) return;
    this.pauseOpen = false;
    this.game.paused = false;
    this.game.clock.getDelta();
    this.pauseScreen.classList.add('hidden');
    controls.requestLock();
  }

  renderPause() {
    const { law, ship, missions } = this.game;
    const fmt = (n) => Math.round(n).toLocaleString('de-DE');
    const rank = law.rank();
    const next = law.nextRank();
    const bar = (v) => `<span class="rep-bar"><i style="left:${50 + v / 2}%"></i></span>`;
    document.getElementById('pause-record').innerHTML = `<h3 class="section">Pilot</h3>
      <p>Rang <b>${rank.name}</b>${next ? ` <span class="dim">(${law.points} / ${next.points} bis ${next.name})</span>` : ''}</p>
      <p>Schwierigkeit <b>${difficultyOf(this.game).label}</b></p>
      <p>Konto <b>${fmt(ship.credits)} Cr</b> · Schulden <b>${fmt(ship.debt)} Cr</b></p>
      <p>Status <b class="${law.wanted >= 2 ? 'alarm' : ''}">${law.wantedLabel()}</b>${law.fines ? ` · Bußgeld ${fmt(law.fines)} Cr` : ''}</p>
      <p>SOLPOL ${bar(law.rep.police)} ${law.repText(law.rep.police)}</p>
      <p>Aschebund ${bar(law.rep.pirate)} ${law.repText(law.rep.pirate)}</p>
      <p class="dim">Abschüsse: ${law.kills.pirate} Piraten · ${law.kills.police} Polizei · ${law.kills.civil} Zivil</p>
      <p class="dim">Hülle ${Math.round((ship.hull / ship.maxHull) * 100)}% · ${Object.entries(ship.systems).map(([k, c]) => `${SUBSYSTEMS[k]} ${Math.round(c * 100)}%`).join(' · ')}</p>`;
    const list = missions.active.map((m) => {
      const obj = missions.current(m);
      return `<div class="mission-active ${missions.tracked === m ? 'tracked' : ''}"><span><b>${m.title}</b><br>${obj ? obj.label : ''} · ${fmt(m.reward)} Cr</span>
        <span><button class="shop-action-btn" data-pact="track:${m.id}">Verfolgen</button><button class="shop-action-btn sell" data-pact="abort:${m.id}">Abbrechen</button></span></div>`;
    }).join('') || '<p class="dim">Keine Aufträge. Angebote gibt es im Auftragsbüro jeder Station, manchmal auch in der Bar.</p>';
    document.getElementById('pause-missions').innerHTML = `<h3 class="section">Aufträge</h3>${list}`;
  }

  createPassiveMarkers() {
    this.passiveMarkers = [];
    if (!this.passiveContainer) return;
    this.game.solarSystem.planets.forEach(p => this.createMarkerElement(p, 'planet'));
    this.game.solarSystem.stations.forEach(st => this.createMarkerElement(st, 'station'));
  }

  createMarkerElement(obj, type) {
    const div = document.createElement('div');
    div.className = 'passive-hud-marker hidden'; // hide initially
    
    const icon = document.createElement('div');
    icon.className = `marker-icon ${type}-icon`;
    
    const label = document.createElement('div');
    label.className = 'marker-label';
    
    label.innerText = displayName(obj.name).toUpperCase();
    
    div.appendChild(icon);
    div.appendChild(label);
    
    this.passiveContainer.appendChild(div);
    
    this.passiveMarkers.push({
      element: div,
      object: obj,
      type: type
    });
  }

  toggleHelpGuide() {
    this.helpGuideActive = !this.helpGuideActive;
    if (this.helpGuideActive) {
      this.helpGuide.classList.remove('hidden');
      this.btnHelp.classList.add('active');
      this.btnHelp.innerText = "HANDBUCH [H]: AN";
    } else {
      this.helpGuide.classList.add('hidden');
      this.btnHelp.classList.remove('active');
      this.btnHelp.innerText = "HANDBUCH [H]: AUS";
    }
    spaceAudio.playBeep();
  }

  // Docked: walking through the station
  openSpaceport(stationName) {
    this.currentStationDocked = stationName;
    this.stationUI.open(stationName);
  }

  closeSpaceport() {
    this.stationUI.close();
    this.currentStationDocked = null;
  }

  updateHUDStats() {
    const ship = this.game.ship;
    this.hudCredits.innerText = Math.round(ship.credits).toLocaleString('de-DE');
    this.hudCargo.innerText = `${ship.getCurrentCargoWeight()} / ${ship.maxCargo}`;
  }

  update(ship, solarSystem, camera) {
    const external = ship.cameraMode !== 'cockpit';
    // In atmospheric flight the camera films a local scene: nothing in space can be marked on screen
    const surface = this.game.surface && this.game.surface.active ? this.game.surface : null;
    this.hud.classList.toggle('view-external', external);
    if (!external) {
      this.swingCockpit(ship, camera);
      this.lightCockpit(ship, solarSystem);
    }

    // Passive destination markers (planets, stations)
    if (this.passiveMarkers) {
      this.passiveMarkers.forEach(pm => {
        const far = pm.type === 'station' && pm.object.mesh.position.distanceTo(ship.position) > 6000;
        if (ship.targetObject === pm.object || pm.object.hidden || far || surface) {
          pm.element.classList.add('hidden');
          return;
        }
        const targetPos = (pm.type === 'station' ? pm.object.mesh.position : pm.object.group.position).clone();
        targetPos.project(camera);
        if (targetPos.z > 1 || Math.abs(targetPos.x) > 1.1 || Math.abs(targetPos.y) > 1.1) {
          pm.element.classList.add('hidden');
        } else {
          pm.element.style.left = `${(targetPos.x * 0.5 + 0.5) * window.innerWidth}px`;
          pm.element.style.top = `${(targetPos.y * -0.5 + 0.5) * window.innerHeight}px`;
          pm.element.classList.remove('hidden');
        }
      });
    }

    // 1. Autopilot button updates
    if (ship.autopilotActive) {
      this.autopilotStatus.innerText = ship.isHolding() ? "AUTOPILOT: HALTEN" : "AUTOPILOT: REISE";
      this.autopilotStatus.className = "autopilot-status engaged";
      this.btnAutopilot.className = "metal-btn autopilot-btn active";
    } else {
      this.autopilotStatus.innerText = "AUTOPILOT: BEREIT";
      this.autopilotStatus.className = "autopilot-status";
      this.btnAutopilot.className = "metal-btn autopilot-btn";
    }

    // 2. Weapons, afterburner, fuel, ordnance, hull, subsystems
    const wEnergy = Math.round(ship.weaponEnergy);
    this.weaponEnergyBar.style.width = `${wEnergy}%`;
    this.weaponEnergyVal.innerText = wEnergy;
    this.boostBar.style.width = `${Math.round(ship.boost)}%`;
    this.boostBar.classList.toggle('burning', ship.boosting);
    this.fuelVal.textContent = Math.round(ship.fuel);
    this.missileVal.textContent = ship.missiles;
    this.flareVal.textContent = ship.flares;
    const hullPct = Math.max(0, Math.round((ship.hull / ship.maxHull) * 100));
    this.hullVal.textContent = `${hullPct}%`;
    this.hullVal.classList.toggle('alarm-text', hullPct < 35);
    Object.entries(this.sysLamps).forEach(([k, el]) => {
      const c = ship.systems[k];
      const state = c < 0.35 ? 'bad' : c < 0.75 ? 'warn' : '';
      if (el.dataset.state !== state) {
        el.dataset.state = state;
        el.className = state;
      }
    });

    // 3. Status controls styling
    this.btnFa.innerText = `STABILISATOR [F]: ${ship.flightAssist ? 'AN' : 'AUS'}`;
    if (ship.flightAssist) {
      this.btnFa.classList.add('active');
    } else {
      this.btnFa.classList.remove('active');
    }

    
    this.btnMute.innerText = `AUDIO [M]: ${spaceAudio.muted ? 'AUS' : 'AN'}`;
    if (!spaceAudio.muted) {
      this.btnMute.classList.add('active');
    } else {
      this.btnMute.classList.remove('active');
    }

    // 4. Set Speed & Actual Speed meters
    const currentSpeed = ship.isWarping ? ship.velocity.length() : ship.isHolding() ? 0 : ship.velocity.clone().sub(ship.frameVelocity).length();
    const setSpeedPercent = Math.round(ship.throttle * 100);
    this.setSpeedBar.style.height = `${Math.abs(setSpeedPercent)}%`;
    this.setSpeedBar.classList.toggle('reverse', setSpeedPercent < 0); // red column for reverse thrust
    this.setSpeedVal.innerText = setSpeedPercent < 0 ? `R ${Math.abs(setSpeedPercent)}%` : `${setSpeedPercent}%`;

    let displaySpeed = "";
    let speedProgress = 0;
    if (surface) {
      displaySpeed = surface.speedText();
      speedProgress = Math.min(100, surface.speedFraction() * 100);
    } else if (ship.autopilotActive && !ship.isHolding()) {
      const speedOfLight = 300;
      const cFactor = (currentSpeed / speedOfLight).toFixed(1);
      displaySpeed = `WARP ${cFactor} c`;
      speedProgress = Math.min(100, (currentSpeed / ship.autopilotCruiseSpeed) * 100);
    } else {
      const kmS = (currentSpeed * 1000).toFixed(0);
      displaySpeed = `${Number(kmS).toLocaleString('de-DE')} km/s`;
      speedProgress = Math.min(100, (currentSpeed / ship.maxSpeed) * 100);
    }
    
    this.actSpeedBar.style.height = `${speedProgress}%`;
    this.actSpeedVal.innerText = displaySpeed;

    // 5. Update HUD stats profiles
    this.updateHUDStats();

    // 6. Target details
    const target = ship.targetObject;
    if (target) {
      this.targetName.innerText = displayName(target.name).toUpperCase();
      const targetPos = target.group ? target.group.position : target.mesh.position;
      this.targetDist.innerText = formatDist(targetPos.distanceTo(ship.position));

      // Closing speed from the change in relative position (covers orbiting targets and station hold)
      const now = performance.now();
      const relPos = targetPos.clone().sub(ship.position);
      if (this.lastRelTarget === target && !this.game.warpState) {
        const dt = (now - this.lastRelTime) / 1000;
        if (dt > 0) {
          const instSpeed = relPos.clone().sub(this.lastRelPos).length() / dt;
          this.relSpeed += (instSpeed - this.relSpeed) * 0.15;
        }
      } else {
        this.relSpeed = 0;
      }
      this.lastRelTarget = target;
      this.lastRelPos.copy(relPos);
      this.lastRelTime = now;
      this.targetSpeed.innerText = `${Number((this.relSpeed * 1000).toFixed(0)).toLocaleString('de-DE')} km/s`;

      this.targetKind.textContent = targetKind(target, this.game);
      if (target.kind === 'npc') {
        this.targetBars.classList.remove('hidden');
        this.targetShieldBar.style.width = `${Math.max(0, (target.shield / Math.max(target.maxShield, 1)) * 100).toFixed(0)}%`;
        this.targetHullBar.style.width = `${Math.max(0, (target.hull / target.maxHull) * 100).toFixed(0)}%`;
      } else {
        this.targetBars.classList.add('hidden');
      }
      this.drawTargetWireframe(target);
      if (surface) this.targetReticle.classList.add('hidden');
      else this.updateTargetReticle(target, camera);
    } else {
      this.targetName.innerText = "KEINES";
      this.targetDist.innerText = "---";
      this.targetSpeed.innerText = "---";
      this.targetKind.textContent = '---';
      this.targetBars.classList.add('hidden');
      this.targetReticle.classList.add('hidden');
      this.clearTargetWireframe();
    }

    // 7. Update Shields dynamic HUD colors
    this.updateShieldsGlow(ship);

    // 8. Render Radars
    this.drawDualRadar(ship, solarSystem);

    // 9. Check if docking is possible with orbital stations
    this.checkDockingPrompts(ship, solarSystem);

    // 9.5. What X flies to, under the crosshair; hidden where X does something else or there is nowhere to go
    this.updateTravelPrompt(ship, target);

    // 10. Gravity and atmosphere warnings, and the altimeter near a planet
    const touchingAtmosphere = ship.atmosphereContact > 0;
    if (surface) {
      this.gravityAlertText.textContent = 'BODEN · HOCHZIEHEN';
      this.gravityAlert.classList.toggle('hidden', surface.warning !== 'pull-up');
    } else {
      this.gravityAlertText.textContent = touchingAtmosphere ? 'MINDESTHÖHE' : 'SCHWEREFELD';
      this.gravityAlert.classList.toggle('hidden', !(touchingAtmosphere || (external && ship.gravityFieldActive)));
    }
    this.updateAnnunciator(ship);
    this.updateAltimeter(ship, solarSystem);

    // 11. External view readout and aim point
    if (external) {
      this.extThrottle.textContent = this.setSpeedVal.textContent;
      this.extSpeed.textContent = displaySpeed;
      this.extShield.textContent = `${Math.round((ship.shield / ship.maxShield) * 100)}%`;
      this.extHull.textContent = `${hullPct}%`;
      this.extTarget.textContent = target
        ? `${displayName(target.name).toUpperCase()} · ${this.targetDist.textContent}`
        : 'KEINES';
      this.extAutopilot.textContent = this.autopilotStatus.textContent.replace('AUTOPILOT: ', '');
      if (surface) this.extAim.classList.add('hidden');
      else this.updateExternalAim(ship, camera);
    } else {
      this.extAim.classList.add('hidden');
    }

    // 12. Nav computer
    this.navMap.update(ship, solarSystem);
  }

  // Light inside the cockpit from the same sources that light the ship outside: the Sun (gone in a planet's
  // shadow) and the nearest planet's day side. Surfaces that face the pilot catch the Sun from behind, the
  // console catches it through the canopy from ahead, planet light comes in tinted from wherever the planet is.
  lightCockpit(ship, solarSystem) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quaternion);
    const toSun = ship.position.clone().negate().normalize();
    const f = toSun.dot(fwd), r = toSun.dot(right), u = toSun.dot(up);
    const vis = solarSystem.sunVisibility ?? 1;
    const q = (v) => Math.round(THREE.MathUtils.clamp(v, 0, 1) * 40) / 40;

    // Planet light: direction to the lit surface below the ship, strength as outside
    const fill = solarSystem.fillLight;
    const fillK = fill ? THREE.MathUtils.clamp(fill.intensity / 0.9, 0, 1) : 0;
    let fillFront = 0, fillBelow = 0;
    if (fillK > 0) {
      const toPlanet = fill.position.clone().sub(ship.position).normalize();
      fillFront = fillK * THREE.MathUtils.clamp(0.75 * toPlanet.dot(fwd) + 0.4 * toPlanet.dot(up) + 0.35, 0, 1);
      fillBelow = fillK * THREE.MathUtils.clamp(-0.8 * toPlanet.dot(up) + 0.3 * toPlanet.dot(fwd) + 0.2, 0, 1);
    }
    const c = fill ? fill.color : null;
    const hex = c ? c.getHex() : 0x96aac8; // sRGB, as CSS wants it
    const fillRgb = `${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}`;

    const consoleSun = vis * THREE.MathUtils.clamp(0.7 * f + 0.45 * u + 0.25, 0, 1);
    const faceSun = vis * (-f * 0.9 + 0.05);
    const lightLevel = Math.max(consoleSun, faceSun) * 0.85 + fillK * 0.5 + 0.12;
    this.setFrameLight(this.cockpitLayer, 'cockpit', {
      '--face': q(faceSun),
      '--edge-l': q(vis * (0.8 * r - 0.5 * f + 0.2)),
      '--edge-r': q(vis * (-0.8 * r - 0.5 * f + 0.2)),
      '--glint': q(vis * f),
      '--lip': q(vis * (-0.7 * u - 0.5 * f + 0.2)),
      '--console': q(consoleSun),
      '--fill-rgb': fillRgb,
      '--fill-front': q(fillFront),
      '--fill-below': q(fillBelow),
      '--shade': q(1 - lightLevel),
    });
  }

  // Write a frame piece's light only when it changed, to keep style work off most frames
  setFrameLight(el, key, values) {
    const signature = Object.values(values).join();
    if (this.frameLight[key] === signature) return;
    this.frameLight[key] = signature;
    Object.entries(values).forEach(([name, value]) => el.style.setProperty(name, value));
  }

  // Head-look turns the pilot's head, so the whole cockpit slides the other way across the view
  swingCockpit(ship, camera) {
    const focal = (window.innerHeight / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const yaw = THREE.MathUtils.clamp(ship.headLook.yaw, -1.25, 1.25);
    const pitch = THREE.MathUtils.clamp(ship.headLook.pitch, -1.0, 1.0);
    const x = -Math.tan(yaw) * focal;
    const y = -Math.tan(pitch) * focal;
    this.cockpitLayer.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }

  // Height over the nearest planet's surface, in that planet's own kilometres (Earth's floor is about 100 km)
  updateAltimeter(ship, solarSystem) {
    const surface = this.game.surface;
    if (surface && surface.active) {
      this.altimeter.classList.toggle('hidden', ship.isDestroyed);
      this.altimeterValue.textContent = surface.altitudeText();
      this.altimeter.classList.toggle('alarm-text', surface.warning === 'pull-up');
      return;
    }
    this.altimeter.classList.remove('alarm-text');
    let nearest = null;
    let nearestAltitude = Infinity;
    solarSystem.planets.forEach(p => {
      const dist = p.group.position.distanceTo(ship.position);
      const altitude = dist - p.radius;
      if (dist < gravityRadius(p) && altitude < nearestAltitude) {
        nearest = p;
        nearestAltitude = altitude;
      }
    });
    const show = !!nearest && !ship.isDocked && !ship.isDestroyed;
    this.altimeter.classList.toggle('hidden', !show);
    if (!show) return;
    const km = Math.max(0, nearestAltitude) * (nearest.data.realRadius / nearest.radius);
    this.altimeterValue.textContent = `${Math.round(km).toLocaleString('de-DE')} km über ${displayName(nearest.name)}`;
  }

  // Projected point far ahead of the nose, so you can still aim from outside
  updateExternalAim(ship, camera) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    const aim = ship.position.clone().add(forward.multiplyScalar(80)).project(camera);
    if (aim.z > 1 || ship.isDestroyed) {
      this.extAim.classList.add('hidden');
      return;
    }
    this.extAim.style.left = `${(aim.x * 0.5 + 0.5) * window.innerWidth}px`;
    this.extAim.style.top = `${(aim.y * -0.5 + 0.5) * window.innerHeight}px`;
    this.extAim.classList.remove('hidden');
  }

  // Shield arcs around the ship plan, one per side, coloured by that side's charge
  updateShieldsGlow(ship) {
    const quarter = ship.maxShield / 4;
    const arcs = { f: this.shieldF, b: this.shieldB, l: this.shieldL, r: this.shieldR };
    Object.entries(arcs).forEach(([side, arc]) => {
      const pct = ship.shields[side] / quarter;
      const color = pct > 0.6 ? '#5cff7a' : pct > 0.3 ? '#ffb000' : '#ff3b2f';
      arc.style.stroke = color;
      arc.style.filter = `drop-shadow(0 0 2px ${color})`;
      arc.style.opacity = pct < 0.02 ? 0.08 : 0.25 + pct * 0.75;
    });
    this.shieldVal.textContent = `${Math.round((ship.shield / ship.maxShield) * 100)}%`;
  }

  // Backlit lamps on the binnacle: each one is a condition the pilot should know about
  updateAnnunciator(ship) {
    const set = (lamp, state) => {
      const el = this.lamps[lamp];
      if (!el || el.dataset.state === state) return;
      el.dataset.state = state;
      el.className = state ? `lamp ${state}` : 'lamp';
    };
    const shieldPct = ship.shield / ship.maxShield;
    const hullPct = ship.hull / ship.maxHull;
    const { law, encounters } = this.game;
    set('stabil', ship.flightAssist ? 'on' : '');
    set('auto', ship.autopilotActive ? 'warn' : '');
    set('halten', ship.autopilotActive && ship.isHolding() ? 'on' : '');
    set('andock', this.game.dockableStation && !ship.isDocked ? 'on' : '');
    set('schwere', ship.gravityFieldActive ? 'warn' : ship.atmosphereContact > 0 ? 'alarm' : '');
    set('hoehe', ship.atmosphereContact > 0 ? 'alarm' : '');
    set('schild', shieldPct < 0.3 ? 'alarm' : shieldPct < 0.6 ? 'warn' : '');
    set('huelle', hullPct < 0.35 ? 'alarm' : hullPct < 0.75 ? 'warn' : '');
    set('rakete', ship.incomingMissiles > 0 ? 'alarm' : ship.locked ? 'on' : '');
    this.lockedOut = this.lockedOut === undefined ? false : this.lockedOut;
    if ((this.annunciatorTick = (this.annunciatorTick || 0) + 1) % 10 === 0) this.lockedOut = encounters.massLocked();
    set('sperre', this.lockedOut ? 'warn' : '');
    set('fahndung', law.wanted >= 2 ? 'alarm' : law.wanted === 1 ? 'warn' : '');
    set('fracht', ship.getCurrentCargoWeight() >= ship.maxCargo ? 'warn' : '');
  }

  // The keys that matter right now: fly to the target; held at a station, how to dock or get away;
  // right beside a station, how to take up the hold again
  updateTravelPrompt(ship, target) {
    let keys = null;
    if (!ship.isDocked && !ship.isDestroyed && !this.game.warpState && !this.navMap.isOpen && !(this.game.surface && this.game.surface.active)) {
      const fighting = target && target.kind === 'npc' && this.game.npcs.isHostile(target, ship);
      const targetPos = target ? (target.group ? target.group.position : target.mesh.position) : null;
      if (fighting) keys = PROMPT_KEYS.combat;
      else if (!target) keys = null;
      else if (ship.stationHold) keys = PROMPT_KEYS.hold;
      else if (ship.autopilotActive) keys = null; // still closing in on the hold point
      else if (this.game.isBesideTargetStation()) keys = PROMPT_KEYS.besideStation;
      else if (targetPos.distanceTo(ship.position) >= arrivalRadius(target)) keys = PROMPT_KEYS.travel;
    }
    this.travelPrompt.classList.toggle('hidden', !keys);
    if (!keys) return;
    this.travelName.textContent = displayName(target.name).toUpperCase();
    if (keys !== this.travelKeysShown) {
      this.travelKeys.replaceChildren(...keys.map((text) => Object.assign(document.createElement('span'), { textContent: text })));
      this.travelKeysShown = keys;
    }
  }

  checkDockingPrompts(ship, solarSystem) {
    let closestStation = null;
    solarSystem.stations.forEach(st => {
      if (st.hidden) return;
      if (ship.position.distanceTo(st.mesh.position) < stationDockRange(st)) closestStation = st;
    });
    if (closestStation && !ship.isDocked && !ship.isWarping) {
      this.dockPrompt.classList.remove('hidden');
      const refusal = this.game.dockRefusal(closestStation);
      const text = `[G] ANDOCKEN: ${displayName(closestStation.name).toUpperCase()}${refusal ? ' · VERWEIGERT' : ''}`;
      if (this.dockPrompt.dataset.text !== text) {
        this.dockPrompt.dataset.text = text;
        this.dockPrompt.innerHTML = `<span>${text}</span>`;
      }
      this.game.dockableStation = closestStation;
    } else {
      this.dockPrompt.classList.add('hidden');
      this.game.dockableStation = null;
    }
  }

  updateTargetReticle(target, camera) {
    const targetPos = (target.group ? target.group.position : target.mesh.position).clone();
    targetPos.project(camera);
    
    if (targetPos.z > 1) {
      this.targetReticle.classList.add('hidden');
      return;
    }

    const x = (targetPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (targetPos.y * -0.5 + 0.5) * window.innerHeight;

    this.targetReticle.style.left = `${x}px`;
    this.targetReticle.style.top = `${y}px`;
    
    const distStr = formatDist((target.group ? target.group.position : target.mesh.position).distanceTo(this.game.ship.position));

    this.targetReticleLabel.innerHTML = `${displayName(target.name).toUpperCase()}<br><span class="reticle-dist">${distStr}</span>`;
    this.targetReticle.classList.remove('hidden');
  }

  // Rotating phosphor wireframe of the locked target, drawn from its real model
  drawTargetWireframe(target) {
    const canvas = this.targetCanvas;
    const size = Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2));
    if (size > 0 && canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const ctx = this.targetCtx;
    const w = canvas.width;
    ctx.clearRect(0, 0, w, w);
    this.globeAngle += 0.012;

    const wire = wireframeFor(target);
    const rot = new THREE.Matrix4();
    if (wire.planet) {
      // The planet turns as it really does, axis tilted; seen from slightly above
      const spin = target.body ? target.body.mesh.rotation.y : this.globeAngle;
      rot.makeRotationX(0.32)
        .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(target.data.tilt || 0)))
        .multiply(new THREE.Matrix4().makeRotationY(spin));
    } else {
      rot.makeRotationX(0.42).multiply(new THREE.Matrix4().makeRotationY(this.globeAngle));
    }

    const R = w * 0.43;
    const c = w / 2;
    const v = new THREE.Vector3();
    const u = new THREE.Vector3();
    // Three brightness bands by depth: far edges dim, near edges bright
    const bands = [new Path2D(), new Path2D(), new Path2D()];
    const seg = wire.segments;
    for (let i = 0; i < seg.length; i += 6) {
      v.set(seg[i], seg[i + 1], seg[i + 2]).applyMatrix4(rot);
      u.set(seg[i + 3], seg[i + 4], seg[i + 5]).applyMatrix4(rot);
      const z = (v.z + u.z) * 0.5;
      const band = z > 0.25 ? 2 : z > -0.25 ? 1 : 0;
      bands[band].moveTo(c + v.x * R, c - v.y * R);
      bands[band].lineTo(c + u.x * R, c - u.y * R);
    }
    ctx.lineWidth = Math.max(1, w / 150);
    ctx.lineCap = 'round';
    const hostile = target.kind === 'npc' && this.game.npcs.isHostile(target, this.game.ship);
    const color = hostile ? '255, 80, 60' : target.kind === 'npc' && target.faction === 'police' ? '120, 180, 255' : wire.sun ? '255, 176, 0' : '92, 255, 122';
    // Damaged sensors: the picture jumps and tears
    if (this.game.ship.systems.sensors < 0.5 && Math.random() > this.game.ship.systems.sensors * 1.6) {
      ctx.translate((Math.random() - 0.5) * w * 0.08, 0);
    }
    [0.22, 0.5, 0.95].forEach((alpha, i) => {
      ctx.strokeStyle = `rgba(${color}, ${alpha})`;
      ctx.stroke(bands[i]);
    });
  }

  clearTargetWireframe() {
    this.targetCtx.clearRect(0, 0, this.targetCanvas.width, this.targetCanvas.height);
  }

  // Two scopes, front and rear hemisphere. A blip's distance from the centre is how far it is off the nose
  // (or the tail), its direction which way to turn: steer onto a blip and it moves to the middle.
  drawDualRadar(ship, solarSystem) {
    const fWidth = this.radarFrontCanvas.width;
    const fHeight = this.radarFrontCanvas.height;
    const fCtx = this.radarFrontCtx;
    const rCtx = this.radarRearCtx;
    fCtx.setTransform(1, 0, 0, 1, 0, 0);
    rCtx.setTransform(1, 0, 0, 1, 0, 0);
    fCtx.clearRect(0, 0, fWidth, fHeight);
    rCtx.clearRect(0, 0, fWidth, fHeight);

    const cx = fWidth / 2;
    const cy = fHeight / 2;
    const R = fWidth / 2 - 4;
    const sensors = ship.systems.sensors;

    [fCtx, rCtx].forEach((ctx) => {
      ctx.strokeStyle = 'rgba(92, 255, 122, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      [0.33, 0.66].forEach((f) => { ctx.moveTo(cx + R * f, cy); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); });
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
      ctx.stroke();
      // Static on a damaged scope
      if (sensors < 0.75) {
        ctx.fillStyle = 'rgba(92, 255, 122, 0.35)';
        const n = Math.round((1 - sensors) * 60);
        for (let i = 0; i < n; i++) ctx.fillRect(Math.random() * fWidth, Math.random() * fHeight, 1.5, 1.5);
      }
    });

    const inv = ship.quaternion.clone().invert();
    const local = new THREE.Vector3();
    const blink = Math.sin(Date.now() / 120) > 0;
    const plot = (pos, draw) => {
      local.copy(pos).sub(ship.position).applyQuaternion(inv);
      const d = local.length();
      if (d < 1e-6) return;
      const front = local.z <= 0;
      const off = Math.acos(THREE.MathUtils.clamp((front ? -local.z : local.z) / d, -1, 1)); // 0 .. pi/2
      const r = (off / (Math.PI / 2)) * R;
      const a = Math.atan2(local.y, front ? local.x : -local.x);
      let x = cx + Math.cos(a) * r;
      let y = cy - Math.sin(a) * r;
      if (sensors < 0.5) { x += (Math.random() - 0.5) * (1 - sensors) * 10; y += (Math.random() - 0.5) * (1 - sensors) * 10; }
      draw(front ? fCtx : rCtx, x, y, d);
    };
    const dot = (color, size) => (ctx, x, y) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    };
    const ring = (ctx, x, y) => {
      ctx.strokeStyle = '#ffb000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 6 + Math.sin(Date.now() / 150) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    };

    solarSystem.planets.forEach(p => {
      const targeted = ship.targetObject === p;
      plot(p.group.position, (ctx, x, y) => {
        dot(p.name === 'Sun' ? '#ffb000' : 'rgba(92, 255, 122, 0.55)', p.radius > 300 ? 3 : 2)(ctx, x, y);
        if (targeted) ring(ctx, x, y);
      });
    });
    solarSystem.stations.forEach(st => {
      if (st.hidden) return;
      const targeted = ship.targetObject === st;
      plot(st.mesh.position, (ctx, x, y) => {
        ctx.strokeStyle = targeted ? '#ffb000' : '#b9ffc6';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 3, y - 3, 6, 6);
      });
    });

    const range = ship.sensorRange * (0.55 + 0.45 * sensors);
    const npcs = this.game.npcs;
    npcs.ships.forEach((n) => {
      const d = n.pos.distanceTo(ship.position);
      if (d > range) return;
      const hostile = npcs.isHostile(n, ship);
      const color = hostile ? '#ff3b2f' : n.faction === 'police' ? '#6ab0ff' : n.faction === 'pirate' ? '#ff9a3c' : '#ffd36a';
      const size = n.radius > 5 ? 3.4 : 2.4;
      plot(n.pos, (ctx, x, y) => {
        if (n.radius > 5) {
          ctx.fillStyle = color;
          ctx.fillRect(x - size, y - size, size * 2, size * 2);
        } else {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(x, y - size - 1);
          ctx.lineTo(x + size, y + size);
          ctx.lineTo(x - size, y + size);
          ctx.closePath();
          ctx.fill();
        }
        if (ship.targetObject === n) ring(ctx, x, y);
      });
    });
    // Missiles in flight: white, blinking if they are after us
    this.game.combat.missiles.forEach((m) => {
      if (m.pos.distanceTo(ship.position) > range) return;
      if (m.target === ship && !blink) return;
      plot(m.pos, dot(m.target === ship ? '#ffffff' : 'rgba(255,255,255,0.6)', 1.6));
    });
    this.game.loots.forEach((l) => {
      if (l.group.position.distanceTo(ship.position) > 600) return;
      plot(l.group.position, dot('#40f0ff', 1.4));
    });
  }
}
