import { spaceAudio } from './audio';
import * as THREE from 'three';
import { displayName } from './names';
import { Tutorial } from './tutorial';
import { NavMap } from './navMap';
import { arrivalRadius } from './spaceship';

// Game units -> readable distance (arcade scale: 1 unit = 100.000 km)
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
    this.btnAutopilot = document.getElementById('btn-autopilot');
    this.autopilotStatus = document.getElementById('autopilot-status-indicator');
    this.weaponEnergyBar = document.getElementById('weapon-energy-bar');
    this.weaponEnergyVal = document.getElementById('weapon-energy-val');
    
    // Shields & Armor
    this.shieldF = document.getElementById('shield-f');
    this.shieldB = document.getElementById('shield-b');
    this.shieldL = document.getElementById('shield-l');
    this.shieldR = document.getElementById('shield-r');
    this.armorF = document.getElementById('armor-f');
    this.armorB = document.getElementById('armor-b');
    
    // Speeds
    this.setSpeedBar = document.getElementById('set-speed-bar');
    this.setSpeedVal = document.getElementById('set-speed-val');
    this.actSpeedBar = document.getElementById('act-speed-bar');
    this.actSpeedVal = document.getElementById('act-speed-val');
    
    // Prompts and alerts
    this.dockPrompt = document.getElementById('hud-dock-prompt');
    this.gravityAlert = document.getElementById('hud-gravity-alert');
    
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
    if (!external) this.swingCockpit(ship, camera);

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
    if (setSpeedPercent < 0) {
      this.setSpeedBar.style.width = `${Math.abs(setSpeedPercent)}%`;
      this.setSpeedBar.style.background = '#ff3b2f'; // Red for reverse flight
      this.setSpeedVal.innerText = `R ${Math.abs(setSpeedPercent)}%`;
    } else {
      this.setSpeedBar.style.width = `${setSpeedPercent}%`;
      this.setSpeedBar.style.background = ''; // default theme color
      this.setSpeedVal.innerText = `${setSpeedPercent}%`;
    }

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
    
    this.actSpeedBar.style.width = `${speedProgress}%`;
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

      this.drawTargetWireframe(target);
      this.updateTargetReticle(target, camera);
    } else {
      this.targetName.innerText = "KEINES";
      this.targetDist.innerText = "---";
      this.targetSpeed.innerText = "---";
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

    // 10. Update gravity warnings alert
    if (ship.gravityFieldActive) {
      this.gravityAlert.classList.remove('hidden');
    } else {
      this.gravityAlert.classList.add('hidden');
    }

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

  // Head-look turns the pilot's head, so the whole cockpit slides the other way across the view
  swingCockpit(ship, camera) {
    const focal = (window.innerHeight / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const yaw = THREE.MathUtils.clamp(ship.headLook.yaw, -1.25, 1.25);
    const pitch = THREE.MathUtils.clamp(ship.headLook.pitch, -1.0, 1.0);
    const x = -Math.tan(yaw) * focal;
    const y = -Math.tan(pitch) * focal;
    this.cockpitLayer.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
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

  // Update shields rings borders colored by health percentage
  updateShieldsGlow(ship) {
    const shieldPct = ship.shield / ship.maxShield;
    
    // Determine colors
    const color = shieldPct > 0.6 ? '#5cff7a' : shieldPct > 0.3 ? '#ffb000' : '#ff3b2f';
    const glowShadow = `0 0 10px ${color}`;

    const indicators = [this.shieldF, this.shieldB, this.shieldL, this.shieldR];
    indicators.forEach(ind => {
      ind.style.borderColor = color;
      ind.style.boxShadow = glowShadow;
      ind.style.opacity = 0.3 + shieldPct * 0.7;
    });

    // Armor bars reflect overall structural health
    const armorPct = 1.0; // static for now
    this.armorF.style.width = `${armorPct * 100}%`;
    this.armorB.style.width = `${armorPct * 100}%`;
  }

  updateTravelPrompt(ship, target) {
    let show = !!target && !ship.isDocked && !ship.isDestroyed && !ship.autopilotActive &&
      !this.game.warpState && !this.game.dockableStation && !this.navMap.isOpen;
    if (show) {
      const targetPos = target.group ? target.group.position : target.mesh.position;
      show = targetPos.distanceTo(ship.position) >= arrivalRadius(target);
    }
    this.travelPrompt.classList.toggle('hidden', !show);
    if (show) this.travelName.textContent = displayName(target.name).toUpperCase();
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

  drawTargetWireframe(target) {
    const width = this.targetCanvas.width;
    const height = this.targetCanvas.height;
    const ctx = this.targetCtx;

    ctx.clearRect(0, 0, width, height);

    this.globeAngle += 0.02;

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = width * 0.32;

    const isStation = target.name.includes("Station") || target.name.includes("Außenposten");
    const isTradeShip = target.name.includes("HÄNDLER-FRIGATTE");
    const isAsteroid = target.name.includes("ASTEROID");
    const isSun = target.name === "Sun";
    const isEarth = target.name === "Earth";
    const isSaturn = target.name === "Saturn";
    const isUranus = target.name === "Uranus";

    if (isSun) {
      // Draw Sun: burning star with solar flares
      ctx.strokeStyle = '#ff9900';
      ctx.fillStyle = 'rgba(255, 170, 0, 0.1)';
      ctx.lineWidth = 1.5;

      const flareCount = 10;
      ctx.beginPath();
      for (let i = 0; i < flareCount; i++) {
        const angle = (i / flareCount) * Math.PI * 2 + this.globeAngle * 0.5;
        const outerR = radius * (1.15 + 0.18 * Math.sin(this.globeAngle * 4 + i));
        const midAngle = ((i + 0.5) / flareCount) * Math.PI * 2 + this.globeAngle * 0.5;
        const innerR = radius * 0.9;
        
        ctx.lineTo(centerX + outerR * Math.cos(angle), centerY + outerR * Math.sin(angle));
        ctx.lineTo(centerX + innerR * Math.cos(midAngle), centerY + innerR * Math.sin(midAngle));
      }
      ctx.closePath();
      ctx.stroke();

      ctx.strokeStyle = '#ffcc00';
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } 
    else if (isAsteroid) {
      // Draw Asteroid: amber faceted irregular rock
      ctx.strokeStyle = '#ffaa00';
      ctx.fillStyle = 'rgba(255, 170, 0, 0.08)';
      ctx.lineWidth = 1.2;

      const id = parseInt(target.name.split("-")[1]) || 1;
      const seedPoints = 8;
      const points = [];
      for (let i = 0; i < seedPoints; i++) {
        const angle = (i / seedPoints) * Math.PI * 2 + this.globeAngle * 0.8;
        const radiusOffset = 0.7 + 0.25 * Math.sin(angle * 3 + id) * Math.cos(angle * 2 - id);
        const r = radius * radiusOffset;
        points.push({
          x: centerX + r * Math.cos(angle),
          y: centerY + r * Math.sin(angle * 0.85)
        });
      }

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < seedPoints; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 170, 0, 0.4)';
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y); ctx.lineTo(points[3].x, points[3].y);
      ctx.moveTo(points[1].x, points[1].y); ctx.lineTo(points[5].x, points[5].y);
      ctx.moveTo(points[2].x, points[2].y); ctx.lineTo(points[6].x, points[6].y);
      ctx.moveTo(points[4].x, points[4].y); ctx.lineTo(points[7].x, points[7].y);
      ctx.stroke();
    }
    else if (isStation) {
      // Draw Space Station: cyan high-tech structure
      ctx.strokeStyle = '#00ffcc';
      ctx.fillStyle = 'rgba(0, 255, 204, 0.05)';
      ctx.lineWidth = 1.2;

      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radius * 0.95, radius * 0.35, this.globeAngle * 0.3, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radius * 0.75, radius * 0.27, this.globeAngle * 0.3, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.rect(centerX - radius * 0.12, centerY - radius * 0.5, radius * 0.24, radius * 1.0);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      const angle = this.globeAngle * 0.3;
      for (let i = 0; i < 4; i++) {
        const spokeAngle = angle + (i / 4) * Math.PI * 2;
        const outerX = centerX + radius * 0.95 * Math.cos(spokeAngle);
        const outerY = centerY + radius * 0.35 * Math.sin(spokeAngle);
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(outerX, outerY);
      }
      ctx.stroke();

      ctx.fillStyle = 'rgba(0, 150, 255, 0.15)';
      ctx.strokeStyle = '#00aaff';
      ctx.beginPath();
      ctx.rect(centerX - radius * 1.2, centerY - radius * 0.15, radius * 0.35, radius * 0.3);
      ctx.rect(centerX + radius * 0.85, centerY - radius * 0.15, radius * 0.35, radius * 0.3);
      ctx.fill();
      ctx.stroke();
    }
    else if (isTradeShip) {
      // Draw Trade Freighter: yellow/gold cargo freighter shape
      ctx.strokeStyle = '#ffaa00';
      ctx.fillStyle = 'rgba(255, 170, 0, 0.06)';
      ctx.lineWidth = 1.2;

      ctx.beginPath();
      // Center hull
      ctx.rect(centerX - radius * 0.15, centerY - radius * 0.6, radius * 0.3, radius * 1.2);
      // Side cargo pods
      ctx.rect(centerX - radius * 0.45, centerY - radius * 0.25, radius * 0.25, radius * 0.65);
      ctx.rect(centerX + radius * 0.2, centerY - radius * 0.25, radius * 0.25, radius * 0.65);
      ctx.fill();
      ctx.stroke();

      // Connecting struts
      ctx.beginPath();
      ctx.moveTo(centerX - radius * 0.45, centerY); ctx.lineTo(centerX + radius * 0.45, centerY);
      ctx.moveTo(centerX - radius * 0.15, centerY - radius * 0.3); ctx.lineTo(centerX - radius * 0.45, centerY - radius * 0.25);
      ctx.moveTo(centerX + radius * 0.15, centerY - radius * 0.3); ctx.lineTo(centerX + radius * 0.45, centerY - radius * 0.25);
      ctx.stroke();

      // Cockpit nose (Z = front)
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.moveTo(centerX - radius * 0.15, centerY - radius * 0.6);
      ctx.lineTo(centerX + radius * 0.15, centerY - radius * 0.6);
      ctx.lineTo(centerX, centerY - radius * 0.78);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    else {
      // Planets
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();

      if (isEarth) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.clip();

        ctx.fillStyle = 'rgba(0, 240, 255, 0.12)';
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
        ctx.lineWidth = 1.2;

        const scrollOffset = (this.globeAngle * radius * 0.4) % (radius * 4);

        ctx.beginPath();
        ctx.arc(centerX - radius * 1.5 + scrollOffset, centerY - radius * 0.1, radius * 0.45, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(centerX - radius * 0.5 + scrollOffset, centerY + radius * 0.2, radius * 0.32, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        ctx.beginPath();
        ctx.arc(centerX - radius * 2.8 + scrollOffset, centerY + radius * 0.15, radius * 0.4, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        ctx.restore();
      }

      const latitudeCount = 5;
      for (let i = 1; i < latitudeCount; i++) {
        const latFraction = i / latitudeCount;
        const yOffset = radius * (2 * latFraction - 1);
        const w = Math.sqrt(radius * radius - yOffset * yOffset);
        ctx.beginPath();
        ctx.ellipse(centerX, centerY + yOffset, w, w * 0.15, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      const longitudeCount = 5;
      for (let i = 0; i < longitudeCount; i++) {
        const angleOffset = (i / longitudeCount) * Math.PI + this.globeAngle * 0.6;
        const rx = radius * Math.sin(angleOffset);
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, Math.abs(rx), radius, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (isSaturn) {
        ctx.strokeStyle = '#dfc28d';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radius * 1.35, radius * 0.35, Math.PI / 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radius * 1.6, radius * 0.42, Math.PI / 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      else if (isUranus) {
        ctx.strokeStyle = '#8bb4ff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radius * 1.3, radius * 0.2, Math.PI * 0.45, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = 'rgba(255, 170, 0, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(centerX - 8, centerY);
    ctx.lineTo(centerX - 3, centerY);
    ctx.moveTo(centerX + 3, centerY);
    ctx.lineTo(centerX + 8, centerY);
    ctx.moveTo(centerX, centerY - 8);
    ctx.lineTo(centerX, centerY - 3);
    ctx.moveTo(centerX, centerY + 3);
    ctx.lineTo(centerX, centerY + 8);
    ctx.stroke();
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
      const dotColor = p.name === 'Sun' ? '#ffcc00' : isTargeted ? '#ff5500' : '#4cd472';

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

      // Station blips are cyan stars or square blips
      const dotColor = '#00f0ff'; 
      if (forwardComp > 0) {
        fCtx.fillStyle = dotColor;
        fCtx.fillRect(px - 2, py - 2, 4, 4); // square dot
      } else {
        const mirroredPx = centerX - r * Math.sin(angle);
        rCtx.fillStyle = dotColor;
        rCtx.fillRect(mirroredPx - 2, py - 2, 4, 4);
      }
    });
  }
}
