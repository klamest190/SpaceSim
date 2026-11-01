import { spaceAudio } from './audio';
import * as THREE from 'three';
import { displayName } from './names';
import { Tutorial } from './tutorial';
import { NavMap } from './navMap';
import { arrivalRadius, gravityRadius } from './spaceship';

const PROMPT_KEYS = {
  travel: ['[X] Hinfliegen', '[T] Nächstes Ziel'],
  hold: ['[W] Heranfliegen', '[S] Zurück', '[X] Loslassen'],
  besideStation: ['[X] Andockposition', '[T] Nächstes Ziel'],
};

// Game units -> readable distance (arcade scale: 1 unit = 100.000 km)
// What kind of thing is locked, for the target VDU
function targetKind(target) {
  if (target.name === 'Sun') return 'STERN';
  if (target.group && target.radius) return 'PLANET';
  if (target.name.startsWith('ASTEROID')) return 'ASTEROID';
  if (target.name.includes('HÄNDLER')) return 'FRACHTER';
  return 'STATION';
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
    
    // Spaceport Terminal UI
    this.spaceportScreen = document.getElementById('spaceport-screen');
    this.stationTitle = document.getElementById('terminal-station-title');
    this.terminalCredits = document.getElementById('terminal-credits-val');
    
    this.tabMarket = document.getElementById('tab-btn-market');
    this.tabHangar = document.getElementById('tab-btn-hangar');
    this.exitTerminalBtn = document.getElementById('exit-terminal-btn');
    
    this.marketContent = document.getElementById('market-tab-content');
    this.hangarContent = document.getElementById('hangar-tab-content');
    this.marketCargoVal = document.getElementById('market-cargo-val');
    
    // Market commodities elements
    this.invIce = document.getElementById('inv-ice');
    this.invOre = document.getElementById('inv-ore');
    this.invTech = document.getElementById('inv-tech');
    this.buyIceBtn = document.getElementById('buy-ice-btn');
    this.sellIceBtn = document.getElementById('sell-ice-btn');
    this.buyOreBtn = document.getElementById('buy-ore-btn');
    this.sellOreBtn = document.getElementById('sell-ore-btn');
    this.buyTechBtn = document.getElementById('buy-tech-btn');
    this.sellTechBtn = document.getElementById('sell-tech-btn');

    this.priceIceBuy = document.getElementById('price-ice-buy');
    this.priceIceSell = document.getElementById('price-ice-sell');
    this.priceOreBuy = document.getElementById('price-ore-buy');
    this.priceOreSell = document.getElementById('price-ore-sell');
    this.priceTechBuy = document.getElementById('price-tech-buy');
    this.priceTechSell = document.getElementById('price-tech-sell');
    
    // Hangar Upgrades elements
    this.lvlEngine = document.getElementById('upgrade-lvl-engine');
    this.lvlShield = document.getElementById('upgrade-lvl-shield');
    this.lvlWeapon = document.getElementById('upgrade-lvl-weapon');
    this.lvlCargo = document.getElementById('upgrade-lvl-cargo');
    this.btnUpgradeEngine = document.getElementById('upgrade-engine-btn');
    this.btnUpgradeShield = document.getElementById('upgrade-shield-btn');
    this.btnUpgradeWeapon = document.getElementById('upgrade-weapon-btn');
    this.btnUpgradeCargo = document.getElementById('upgrade-cargo-btn');
    
    // Canvases
    this.targetCanvas = document.getElementById('target-wireframe-canvas');
    this.targetCtx = this.targetCanvas.getContext('2d');
    
    this.radarFrontCanvas = document.getElementById('radar-front-canvas');
    this.radarFrontCtx = this.radarFrontCanvas.getContext('2d');
    this.radarRearCanvas = document.getElementById('radar-rear-canvas');
    this.radarRearCtx = this.radarRearCanvas.getContext('2d');
    
    // Rotation details
    this.globeAngle = 0;

    // Target closing-speed tracking
    this.lastRelTarget = null;
    this.lastRelPos = new THREE.Vector3();
    this.lastRelTime = 0;
    this.relSpeed = 0;
    this.currentStationDocked = null;
    
    // Dynamic Station commodity prices
    this.stationPrices = {
      'Erde Orbital-Station': {
        ice: { buy: 15, sell: 10 },
        ore: { buy: 35, sell: 26 }, // Earth buys Ore for high prices
        tech: { buy: 110, sell: 90 } // sells Tech cheap
      },
      'Mars Außenposten': {
        ice: { buy: 35, sell: 28 }, // Mars needs Ice, buys high
        ore: { buy: 18, sell: 12 }, // sells Ore cheap
        tech: { buy: 180, sell: 150 } // Tech is expensive on Mars
      }
    };

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

  launch(newCareer) {
    if (newCareer) this.game.startNewCareer();
    const tutorialDone = !newCareer && !!(this.game.savedGame && this.game.savedGame.tutorialDone);
    this.startScreen.classList.add('hidden');
    this.hud.classList.remove('hidden');
    spaceAudio.init();
    this.game.startSimulation();
    this.updateHUDStats();
    this.tutorial.start(tutorialDone);
  }

  setupListeners() {
    // Launch mission
    this.launchBtn.addEventListener('click', () => this.launch(false));
    this.newCareerBtn.addEventListener('click', () => this.launch(true));

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

    // Spaceport tab toggles
    this.tabMarket.addEventListener('click', () => {
      this.tabMarket.classList.add('active');
      this.tabHangar.classList.remove('active');
      this.marketContent.classList.remove('hidden');
      this.hangarContent.classList.add('hidden');
      spaceAudio.playBeep();
    });

    this.tabHangar.addEventListener('click', () => {
      this.tabHangar.classList.add('active');
      this.tabMarket.classList.remove('active');
      this.hangarContent.classList.remove('hidden');
      this.marketContent.classList.add('hidden');
      spaceAudio.playBeep();
    });

    // Exit Station Docking
    this.exitTerminalBtn.addEventListener('click', () => {
      this.game.undockShip();
    });

    // Commodities actions listeners
    this.buyIceBtn.addEventListener('click', () => this.tradeCommodity('ice', 'buy'));
    this.sellIceBtn.addEventListener('click', () => this.tradeCommodity('ice', 'sell'));
    this.buyOreBtn.addEventListener('click', () => this.tradeCommodity('ore', 'buy'));
    this.sellOreBtn.addEventListener('click', () => this.tradeCommodity('ore', 'sell'));
    this.buyTechBtn.addEventListener('click', () => this.tradeCommodity('tech', 'buy'));
    this.sellTechBtn.addEventListener('click', () => this.tradeCommodity('tech', 'sell'));

    // Hangar upgrade triggers
    this.btnUpgradeEngine.addEventListener('click', () => this.purchaseUpgrade('engine'));
    this.btnUpgradeShield.addEventListener('click', () => this.purchaseUpgrade('shield'));
    this.btnUpgradeWeapon.addEventListener('click', () => this.purchaseUpgrade('weapon'));
    this.btnUpgradeCargo.addEventListener('click', () => this.purchaseUpgrade('cargo'));
  }

  createPassiveMarkers() {
    this.passiveMarkers = [];
    if (!this.passiveContainer) return;
    
    // Create for planets
    this.game.solarSystem.planets.forEach(p => {
      this.createMarkerElement(p, 'planet');
    });
    
    // Create for stations
    this.game.solarSystem.stations.forEach(st => {
      this.createMarkerElement(st, 'station');
    });

    // Create for trade ships
    this.game.solarSystem.tradeShips.forEach(ts => {
      this.createMarkerElement(ts, 'ship');
    });
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

  // Engage docking overlay
  openSpaceport(stationName) {
    this.currentStationDocked = stationName;
    this.stationTitle.innerText = stationName.toUpperCase();
    
    // Default to Market tab on open
    this.tabMarket.click();
    this.updateSpaceportUI();
    
    this.spaceportScreen.classList.remove('hidden');
  }

  closeSpaceport() {
    this.spaceportScreen.classList.add('hidden');
    this.currentStationDocked = null;
  }

  updateSpaceportUI() {
    const ship = this.game.ship;
    const prices = this.stationPrices[this.currentStationDocked];
    if (!prices) return;

    // Update credits and cargo capacity metrics
    this.terminalCredits.innerText = Math.round(ship.credits).toLocaleString('de-DE');
    const currentWeight = ship.getCurrentCargoWeight();
    this.marketCargoVal.innerText = `${currentWeight} / ${ship.maxCargo}`;

    // Fill prices in marketplace table
    this.priceIceBuy.innerText = prices.ice.buy;
    this.priceIceSell.innerText = prices.ice.sell;
    this.priceOreBuy.innerText = prices.ore.buy;
    this.priceOreSell.innerText = prices.ore.sell;
    this.priceTechBuy.innerText = prices.tech.buy;
    this.priceTechSell.innerText = prices.tech.sell;

    // Fill cargo item levels
    this.invIce.innerText = ship.cargo.ice;
    this.invOre.innerText = ship.cargo.ore;
    this.invTech.innerText = ship.cargo.tech;

    // Update upgrade hangar button texts and level tiers
    const updateHangarCard = (type, lvlSpan, btn, baseCost) => {
      const tier = ship.upgrades[type];
      lvlSpan.innerText = tier;
      if (tier >= 4) {
        btn.innerText = "HÖCHSTE STUFE";
        btn.disabled = true;
        btn.style.opacity = 0.5;
      } else {
        const cost = tier * baseCost;
        btn.innerText = `AUSBAUEN (${cost} Cr)`;
        btn.disabled = false;
        btn.style.opacity = 1.0;
      }
    };

    updateHangarCard('engine', this.lvlEngine, this.btnUpgradeEngine, 250);
    updateHangarCard('shield', this.lvlShield, this.btnUpgradeShield, 300);
    updateHangarCard('weapon', this.lvlWeapon, this.btnUpgradeWeapon, 350);
    updateHangarCard('cargo', this.lvlCargo, this.btnUpgradeCargo, 150);
  }

  // Handle cargo transaction
  tradeCommodity(commodity, type) {
    const ship = this.game.ship;
    const prices = this.stationPrices[this.currentStationDocked];
    if (!prices) return;

    const price = prices[commodity][type];
    const currentWeight = ship.getCurrentCargoWeight();

    if (type === 'buy') {
      // Check credits & cargo space
      if (ship.credits >= price && currentWeight < ship.maxCargo) {
        ship.credits -= price;
        ship.cargo[commodity]++;
        spaceAudio.playBeep();
      } else {
        spaceAudio.playAutopilotAlert(false); // error buzzer
      }
    } else {
      // sell
      if (ship.cargo[commodity] > 0) {
        ship.credits += price;
        ship.cargo[commodity]--;
        spaceAudio.playBeep();
      } else {
        spaceAudio.playAutopilotAlert(false);
      }
    }

    this.updateSpaceportUI();
    this.updateHUDStats();
    this.game.saveProgress();
  }

  // Purchase spaceship component upgrade
  purchaseUpgrade(type) {
    const ship = this.game.ship;
    const tier = ship.upgrades[type];
    if (tier >= 4) return;

    let baseCost = 200;
    if (type === 'engine') baseCost = 250;
    else if (type === 'shield') baseCost = 300;
    else if (type === 'weapon') baseCost = 350;
    else if (type === 'cargo') baseCost = 150;

    const cost = tier * baseCost;

    if (ship.credits >= cost) {
      ship.credits -= cost;
      ship.upgrades[type]++;
      
      // Re-initialize ship upgrade parameters
      ship.applyUpgrades();
      
      spaceAudio.playBeep();
    } else {
      spaceAudio.playAutopilotAlert(false); // error beep
    }

    this.updateSpaceportUI();
    this.updateHUDStats();
    this.game.saveProgress();
  }

  updateHUDStats() {
    const ship = this.game.ship;
    this.hudCredits.innerText = Math.round(ship.credits).toLocaleString('de-DE');
    this.hudCargo.innerText = `${ship.getCurrentCargoWeight()} / ${ship.maxCargo}`;
  }

  update(ship, solarSystem, camera) {
    const external = ship.cameraMode !== 'cockpit';
    this.hud.classList.toggle('view-external', external);
    if (!external) {
      this.swingCockpit(ship, camera);
      this.lightCockpit(ship, solarSystem);
    }

    // Update passive target indicators (Privateer Style)
    if (this.passiveMarkers) {
      this.passiveMarkers.forEach(pm => {
        // 1. Hide if active target
        if (ship.targetObject === pm.object) {
          pm.element.classList.add('hidden');
          return;
        }
        
        const targetPos = new THREE.Vector3();
        if (pm.type === 'station' || pm.type === 'ship') {
          targetPos.copy(pm.object.mesh.position);
        } else {
          targetPos.copy(pm.object.group.position);
        }
        
        targetPos.project(camera);
        
        // Hide if behind camera (z > 1) or way off screen
        if (targetPos.z > 1 || Math.abs(targetPos.x) > 1.1 || Math.abs(targetPos.y) > 1.1) {
          pm.element.classList.add('hidden');
        } else {
          const x = (targetPos.x * 0.5 + 0.5) * window.innerWidth;
          const y = (targetPos.y * -0.5 + 0.5) * window.innerHeight;
          
          pm.element.style.left = `${x}px`;
          pm.element.style.top = `${y}px`;
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

    // 2. Weapons Energy
    const wEnergy = Math.round(ship.weaponEnergy);
    this.weaponEnergyBar.style.width = `${wEnergy}%`;
    this.weaponEnergyVal.innerText = wEnergy;

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
    const currentSpeed = ship.velocity.length();
    const setSpeedPercent = Math.round(ship.throttle * 100);
    this.setSpeedBar.style.height = `${Math.abs(setSpeedPercent)}%`;
    this.setSpeedBar.classList.toggle('reverse', setSpeedPercent < 0); // red column for reverse thrust
    this.setSpeedVal.innerText = setSpeedPercent < 0 ? `R ${Math.abs(setSpeedPercent)}%` : `${setSpeedPercent}%`;

    let displaySpeed = "";
    let speedProgress = 0;
    if (ship.autopilotActive && !ship.isHolding()) {
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
      const relativeSpeedKmS = (this.relSpeed * 1000).toFixed(0);
      this.targetSpeed.innerText = `${Number(relativeSpeedKmS).toLocaleString('de-DE')} km/s`;

      this.targetKind.textContent = targetKind(target);
      this.drawTargetWireframe(target);
      this.updateTargetReticle(target, camera);
    } else {
      this.targetName.innerText = "KEINES";
      this.targetDist.innerText = "---";
      this.targetSpeed.innerText = "---";
      this.targetKind.textContent = '---';
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
    this.gravityAlertText.textContent = touchingAtmosphere ? 'MINDESTHÖHE' : 'SCHWEREFELD';
    this.gravityAlert.classList.toggle('hidden', !(touchingAtmosphere || (external && ship.gravityFieldActive)));
    this.updateAnnunciator(ship);
    this.updateAltimeter(ship, solarSystem);

    // 11. External view readout and aim point
    if (external) {
      this.extThrottle.textContent = this.setSpeedVal.textContent;
      this.extSpeed.textContent = displaySpeed;
      this.extShield.textContent = `${Math.round((ship.shield / ship.maxShield) * 100)}%`;
      this.extTarget.textContent = target
        ? `${displayName(target.name).toUpperCase()} · ${this.targetDist.textContent}`
        : 'KEINES';
      this.extAutopilot.textContent = this.autopilotStatus.textContent.replace('AUTOPILOT: ', '');
      this.updateExternalAim(ship, camera);
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

  // Shield arcs around the ship plan, coloured by charge
  updateShieldsGlow(ship) {
    const shieldPct = ship.shield / ship.maxShield;
    const color = shieldPct > 0.6 ? '#5cff7a' : shieldPct > 0.3 ? '#ffb000' : '#ff3b2f';
    [this.shieldF, this.shieldB, this.shieldL, this.shieldR].forEach((arc) => {
      arc.style.stroke = color;
      arc.style.filter = `drop-shadow(0 0 2px ${color})`;
      arc.style.opacity = 0.25 + shieldPct * 0.75;
    });
    this.shieldVal.textContent = `${Math.round(shieldPct * 100)}%`;
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
    set('stabil', ship.flightAssist ? 'on' : '');
    set('auto', ship.autopilotActive ? 'warn' : '');
    set('halten', ship.autopilotActive && ship.isHolding() ? 'on' : '');
    set('andock', this.game.dockableStation && !ship.isDocked ? 'on' : '');
    set('schwere', ship.gravityFieldActive ? 'warn' : '');
    set('hoehe', ship.atmosphereContact > 0 ? 'alarm' : '');
    set('schild', shieldPct < 0.3 ? 'alarm' : shieldPct < 0.6 ? 'warn' : '');
    set('fracht', ship.getCurrentCargoWeight() >= ship.maxCargo ? 'warn' : '');
  }

  // The keys that matter right now: fly to the target; held at a station, how to dock or get away;
  // right beside a station, how to take up the hold again
  updateTravelPrompt(ship, target) {
    let keys = null;
    if (target && !ship.isDocked && !ship.isDestroyed && !this.game.warpState && !this.navMap.isOpen) {
      const targetPos = target.group ? target.group.position : target.mesh.position;
      if (ship.stationHold) keys = PROMPT_KEYS.hold;
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
    let canDock = false;
    let closestStation = null;
    const dockRange = 2.5; // units distance

    solarSystem.stations.forEach(st => {
      const dist = ship.position.distanceTo(st.mesh.position);
      if (dist < dockRange) {
        canDock = true;
        closestStation = st;
      }
    });

    if (canDock && !ship.isDocked) {
      this.dockPrompt.classList.remove('hidden');
      this.dockPrompt.innerHTML = `<span>[G] ANDOCKEN: ${displayName(closestStation.name).toUpperCase()}</span>`;
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
    const color = wire.sun ? '255, 176, 0' : '92, 255, 122';
    [0.22, 0.5, 0.95].forEach((alpha, i) => {
      ctx.strokeStyle = `rgba(${color}, ${alpha})`;
      ctx.stroke(bands[i]);
    });
  }

  clearTargetWireframe() {
    this.targetCtx.clearRect(0, 0, this.targetCanvas.width, this.targetCanvas.height);
  }

  drawDualRadar(ship, solarSystem) {
    const fWidth = this.radarFrontCanvas.width;
    const fHeight = this.radarFrontCanvas.height;
    const fCtx = this.radarFrontCtx;
    const rCtx = this.radarRearCtx;

    fCtx.clearRect(0, 0, fWidth, fHeight);
    rCtx.clearRect(0, 0, fWidth, fHeight);

    const centerX = fWidth / 2;
    const centerY = fHeight / 2;
    const radarRadius = fWidth / 2 - 4;

    // Range rings and cross hair, the same on both scopes
    [fCtx, rCtx].forEach((ctx) => {
      ctx.strokeStyle = 'rgba(92, 255, 122, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      [0.33, 0.66].forEach((f) => { ctx.moveTo(centerX + radarRadius * f, centerY); ctx.arc(centerX, centerY, radarRadius * f, 0, Math.PI * 2); });
      ctx.moveTo(centerX - radarRadius, centerY); ctx.lineTo(centerX + radarRadius, centerY);
      ctx.moveTo(centerX, centerY - radarRadius); ctx.lineTo(centerX, centerY + radarRadius);
      ctx.stroke();
    });

    const shipDirForward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    const shipDirRight = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.quaternion);
    const shipDirUp = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quaternion);

    let maxDist = 1;
    solarSystem.planets.forEach(p => {
      const dist = p.group.position.distanceTo(ship.position);
      if (dist > maxDist) maxDist = dist;
    });

    solarSystem.planets.forEach(p => {
      const relPos = p.group.position.clone().sub(ship.position);
      const forwardComp = relPos.dot(shipDirForward);
      const rightComp = relPos.dot(shipDirRight);
      const upComp = relPos.dot(shipDirUp);

      const distance = relPos.length();
      if (distance === 0) return;

      const logScale = Math.log10(distance + 1) / Math.log10(maxDist + 1);
      const r = logScale * radarRadius;

      const angle = Math.atan2(rightComp, upComp);

      const px = centerX + r * Math.sin(angle);
      const py = centerY - r * Math.cos(angle);

      const isTargeted = ship.targetObject && ship.targetObject.name === p.name;
      const dotColor = p.name === 'Sun' || isTargeted ? '#ffb000' : '#5cff7a';

      if (forwardComp > 0) {
        fCtx.fillStyle = dotColor;
        fCtx.beginPath();
        fCtx.arc(px, py, isTargeted ? 4 : 2.5, 0, Math.PI * 2);
        fCtx.fill();

        if (isTargeted) {
          fCtx.strokeStyle = '#ffaa00';
          fCtx.lineWidth = 1;
          fCtx.beginPath();
          fCtx.arc(px, py, 6 + Math.sin(Date.now() / 150) * 2, 0, Math.PI * 2);
          fCtx.stroke();
        }
      } else {
        const mirroredPx = centerX - r * Math.sin(angle);

        rCtx.fillStyle = dotColor;
        rCtx.beginPath();
        rCtx.arc(mirroredPx, py, isTargeted ? 4 : 2.5, 0, Math.PI * 2);
        rCtx.fill();

        if (isTargeted) {
          rCtx.strokeStyle = '#ffaa00';
          rCtx.lineWidth = 1;
          rCtx.beginPath();
          rCtx.arc(mirroredPx, py, 6 + Math.sin(Date.now() / 150) * 2, 0, Math.PI * 2);
          rCtx.stroke();
        }
      }
    });

    // Also draw Space Stations on radar (as green blips)
    solarSystem.stations.forEach(st => {
      const relPos = st.mesh.position.clone().sub(ship.position);
      const forwardComp = relPos.dot(shipDirForward);
      const rightComp = relPos.dot(shipDirRight);
      const upComp = relPos.dot(shipDirUp);
      
      const distance = relPos.length();
      const logScale = Math.log10(distance + 1) / Math.log10(maxDist + 1);
      const r = logScale * radarRadius;

      const angle = Math.atan2(rightComp, upComp);
      const px = centerX + r * Math.sin(angle);
      const py = centerY - r * Math.cos(angle);

      // Hollow square: a station
      const isTargeted = ship.targetObject === st;
      const ctx = forwardComp > 0 ? fCtx : rCtx;
      const x = forwardComp > 0 ? px : centerX - r * Math.sin(angle);
      ctx.strokeStyle = isTargeted ? '#ffb000' : '#b9ffc6';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 3, py - 3, 6, 6);
    });
  }
}
