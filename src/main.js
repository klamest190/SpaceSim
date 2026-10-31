import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { controls } from './controls';
import { spaceAudio } from './audio';
import { Spaceship, STATION_HOLD_STANDOFF } from './spaceship';
import { SolarSystem } from './solarSystem';
import { UI } from './ui';
import { displayName } from './names';
import { loadGame, saveGame, clearGame } from './save';
import './style.css';

const AUTOSAVE_INTERVAL = 15; // seconds
const WARP_STATION_STANDOFF = STATION_HOLD_STANDOFF; // jump exit at the autopilot's waiting point, outside docking range

class Game {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = null;
    
    // Systems
    this.ship = null;
    this.solarSystem = null;
    this.ui = null;
    
    this.simRunning = false;
    
    // Cinematic Warp Jump state variables
    this.warpState = null; // 'charging', 'hyper', 'decelerating'
    this.warpTimer = 0;
    this.warpTarget = null;
    
    // Docking interaction variables
    this.dockableStation = null;
    
    // Explosions particles pool
    this.explosions = [];

    // Loot crates pool
    this.loots = [];
    
    // Initialize WebGL
    this.initWebGL();

    // Create tractor beam visual effect line
    const lineGeom = new THREE.BufferGeometry();
    const linePoints = [new THREE.Vector3(), new THREE.Vector3()];
    lineGeom.setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending
    });
    this.tractorBeamLine = new THREE.Line(lineGeom, lineMat);
    this.scene.add(this.tractorBeamLine);
    
    // Instantiate controllers
    this.solarSystem = new SolarSystem(this.scene);
    this.ship = new Spaceship(this.scene);
    
    // Restore the pilot career, then spawn near Earth with its station locked as first destination
    this.savedGame = loadGame();
    if (this.savedGame) this.applySave(this.savedGame);
    this.autosaveTimer = 0;
    this.placeShipAtEarth();

    this.ui = new UI(this);
    
    this.setupControlBinds();
    
    window.addEventListener('resize', this.onWindowResize.bind(this), false);
    
    this.clock = new THREE.Clock();
    this.tick();
  }

  initWebGL() {
    this.scene = new THREE.Scene();
    
    this.camera = new THREE.PerspectiveCamera(
      65, 
      window.innerWidth / window.innerHeight, 
      0.01, 
      150000 // Extended far clipping plane for true 1:1 planetary scale
    );
    
    const canvas = document.getElementById('space-canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // Post-processing: only HDR sources (sun, lasers, explosion cores) cross the bloom threshold
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.75, // strength
      0.5,  // radius
      0.9   // threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  applySave(save) {
    if (typeof save.credits === 'number') this.ship.credits = save.credits;
    if (save.cargo) Object.assign(this.ship.cargo, save.cargo);
    if (save.upgrades) Object.assign(this.ship.upgrades, save.upgrades);
    this.ship.applyUpgrades();
    this.ship.shield = this.ship.maxShield;
  }

  saveProgress(extra = {}) {
    saveGame(this.ship, extra);
  }

  startNewCareer() {
    clearGame();
    this.savedGame = null;
    this.ship.credits = 1000;
    this.ship.cargo = { ore: 0, ice: 0, tech: 0 };
    this.ship.upgrades = { engine: 1, shield: 1, weapon: 1, cargo: 1 };
    this.ship.applyUpgrades();
    this.ship.shield = this.ship.maxShield;
    this.saveProgress({ tutorialDone: false });
  }

  placeShipAtEarth() {
    const earth = this.solarSystem.planets[3];
    const earthStation = this.solarSystem.stations.find(st => st.planetIndex === 3);
    if (earth) {
      const earthRadius = earth.mesh.scale.x;
      const spawnOffset = new THREE.Vector3(0, 0.1, earthRadius * 1.5 + 2.0); // Safely outside Earth's collision boundary
      this.ship.position.copy(earth.currentPos).add(spawnOffset);
      this.ship.mesh.position.copy(this.ship.position);
      this.ship.targetObject = earthStation || earth;
    } else {
      this.ship.targetObject = this.solarSystem.planets[0];
    }
  }

  setupControlBinds() {
    // Target cycle
    controls.onPress('t', () => {
      if (!this.simRunning || this.ship.isDocked || this.ship.isDestroyed) return;
      const nextTarget = this.solarSystem.cycleTarget(this.ship.targetObject, this.ship);
      this.ship.targetObject = nextTarget;
      spaceAudio.playBeep();
    });

    // Target under crosshair [R]
    controls.onPress('r', () => {
      if (!this.simRunning || this.ship.isDocked || this.ship.isDestroyed) return;
      const aimedTarget = this.solarSystem.findTargetUnderCrosshair(this.ship);
      if (aimedTarget) {
        this.ship.targetObject = aimedTarget;
        spaceAudio.playBeep();
      } else {
        spaceAudio.playAutopilotAlert(false); // Play negative feedback beep
      }
    });

    // Flight Assist
    controls.onPress('f', () => {
      if (!this.simRunning || this.ship.isDocked || this.ship.isDestroyed) return;
      this.ship.flightAssist = !this.ship.flightAssist;
      spaceAudio.playBeep();
    });

    // Camera Mode
    controls.onPress('c', () => {
      if (!this.simRunning || this.ship.isDocked || this.ship.isDestroyed) return;
      this.ship.cameraMode = this.ship.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
      spaceAudio.playBeep();
    });

    // Scale Mode (Locked in Arcade)
    controls.onPress('v', () => {
      if (!this.simRunning || this.ship.isDocked || this.ship.isDestroyed) return;
      spaceAudio.playAutopilotAlert(false); // play warning beep since lock is active
    });

    // Audio Mute
    controls.onPress('m', () => {
      const isMuted = !spaceAudio.muted;
      spaceAudio.setMute(isMuted);
    });

    // Help Manual [H]
    controls.onPress('h', () => {
      if (!this.simRunning || this.ship.isDocked || this.ship.isDestroyed) return;
      this.ui.toggleHelpGuide();
    });

    // Autopilot: in the nav computer to the selected destination, in flight to the locked target
    controls.onPress('x', () => {
      if (!this.simRunning || this.ship.isDocked || this.ship.isDestroyed) return;
      if (this.ui.navMap.isOpen) this.ui.navMap.autopilot();
      else this.ship.toggleAutopilot();
    });

    // Docking Trigger [G]
    controls.onPress('g', () => {
      if (!this.simRunning || this.ship.isDestroyed || this.ui.navMap.isOpen) return;
      
      if (this.ship.isDocked) {
        this.undockShip();
      } else if (this.dockableStation) {
        this.dockShip();
      }
    });

    // Warp Jump [J]: from the nav map to the selected destination, in flight to the locked target
    controls.onPress('j', () => {
      if (!this.simRunning || this.ship.isDocked || this.ship.isDestroyed) return;
      if (this.ui.navMap.isOpen) this.ui.navMap.warp();
      else this.triggerWarpJump();
    });

    // Nav computer [N]
    controls.onPress('n', () => this.ui.navMap.toggle());
    controls.onPress('up', () => { if (this.ui.navMap.isOpen) this.ui.navMap.moveSelection(-1); });
    controls.onPress('down', () => { if (this.ui.navMap.isOpen) this.ui.navMap.moveSelection(1); });
    controls.onPress('enter', () => { if (this.ui.navMap.isOpen) this.ui.navMap.warp(); });
    controls.onPress('escape', () => this.ui.navMap.close(false));

    // Respawn Click Listener
    const respawnBtn = document.getElementById('respawn-btn');
    if (respawnBtn) {
      respawnBtn.addEventListener('click', () => {
        this.respawnShip();
      });
    }
  }

  dockShip() {
    if (!this.dockableStation) return;

    this.ship.isDocked = true;
    this.ship.autopilotActive = false; // Turn off autopilot on dock
    
    // Open full shop terminal UI
    this.ui.openSpaceport(this.dockableStation.name);
    this.ui.tutorial.onDocked();
    this.saveProgress();

    // Exit Pointer lock so cursor is visible to interact with shop buttons
    document.exitPointerLock();
    spaceAudio.playAutopilotAlert(true); // ascending beep
  }

  undockShip() {
    this.ship.isDocked = false;
    this.saveProgress();

    this.ui.closeSpaceport();
    
    // Re-lock mouse cursor
    controls.requestLock();
    spaceAudio.playAutopilotAlert(false); // descending warning beep
  }

  triggerWarpJump() {
    if (this.warpState) return; // Prevent double trigger during warp sequence

    const target = this.ship.targetObject;
    if (!target) {
      spaceAudio.playAutopilotAlert(false); // negative feedback beep
      return;
    }

    // Set state machine variables
    this.warpState = 'charging';
    this.warpTimer = 0;
    this.warpTarget = target;
    this.warpExitSpeed = 0; // Initialize warp exit speed
    this.ship.isWarping = true;
    this.ship.autopilotActive = false; // Turn off autopilot

    // Start warp hum sound
    spaceAudio.setWarp(true);

    // Prepare visual flash overlay (bypass CSS transitions for exact JS control)
    const flashDiv = document.getElementById('warp-flash');
    if (flashDiv) {
      flashDiv.style.transition = 'none';
      flashDiv.style.opacity = '0';
    }
  }

  updateWarpJump(delta) {
    if (!this.warpState || !this.warpTarget) return;

    this.warpTimer += delta;
    const target = this.warpTarget;
    const flashDiv = document.getElementById('warp-flash');

    if (this.warpState === 'charging') {
      const targetPos = (target.group ? target.group.position : target.mesh.position).clone();
      const shipPos = this.ship.position;

      // 1. Rotate ship to face target
      const dir = targetPos.clone().sub(shipPos).normalize();
      const shipForward = new THREE.Vector3(0, 0, -1);
      const qRotate = new THREE.Quaternion().setFromUnitVectors(shipForward, dir);
      this.ship.quaternion.slerp(qRotate, delta * 3.5);
      this.ship.mesh.quaternion.copy(this.ship.quaternion);

      // 2. visually flare engine glows
      this.ship.throttle = 1.0;

      // 3. Stretch camera FOV
      const t = Math.min(1.0, this.warpTimer / 1.2);
      this.camera.fov = 65 + t * 40; // 65 to 105
      this.camera.updateProjectionMatrix();

      // 4. Increase flash opacity
      if (flashDiv) {
        flashDiv.style.opacity = (t * 0.4).toString();
      }

      // Transition
      if (this.warpTimer >= 1.2) {
        this.warpState = 'hyper';
        this.warpTimer = 0;
        spaceAudio.playWarpJump(); // Play explosive warp fire & sweep sound
      }
    } 
    else if (this.warpState === 'hyper') {
      const targetPos = (target.group ? target.group.position : target.mesh.position).clone();
      const shipPos = this.ship.position;

      // 1. Move ship extremely fast towards target
      const dir = targetPos.clone().sub(shipPos).normalize();
      this.ship.velocity.copy(dir).multiplyScalar(2200);

      // 2. visually flare engine glows
      this.ship.throttle = 1.0;

      // 3. Stretch camera FOV to max
      const t = Math.min(1.0, this.warpTimer / 0.5);
      this.camera.fov = 105 + t * 20; // 105 to 125
      this.camera.updateProjectionMatrix();

      // 4. Full screen whiteout flash
      if (flashDiv) {
        flashDiv.style.opacity = (0.4 + t * 0.6).toString();
      }

      // Transition & Teleport
      if (this.warpTimer >= 0.5) {
        // Calculate offset and exit speed dynamically based on target type
        const targetRadius = target.mesh ? target.mesh.scale.x : 1.0;
        let offsetDist = 0;
        let exitSpeed = 0;

        if (target.kind === 'station') {
          // Station: exit on the far side from its planet (never inside it), just outside docking range, at rest
          exitSpeed = 0;
          dir.copy(this.ship.stationOutward(target, this.solarSystem)).negate();
          offsetDist = WARP_STATION_STANDOFF;
        } else if (target.name && target.name.startsWith('ASTEROID')) {
          // Asteroid: teleport close to mining distance with zero exit velocity
          offsetDist = 5.0;
          exitSpeed = 0;
        } else {
          // Planet / Sun: teleport with safety buffer for the deceleration flight phase
          const exitSpeedVal = this.ship.maxSpeed * 1.8;
          const targetSpeedVal = 0.0; // Decelerate to a complete stop
          const averageSpeed = (exitSpeedVal + targetSpeedVal) / 2;
          offsetDist = targetRadius + averageSpeed + 25.0; // Stop exactly 25.0 units in front of the planet surface
          exitSpeed = exitSpeedVal;
        }

        this.warpExitSpeed = exitSpeed;

        // Teleport
        this.ship.position.copy(targetPos).sub(dir.clone().multiplyScalar(offsetDist));
        this.ship.position.y += 0.1;
        this.ship.mesh.position.copy(this.ship.position);

        // Instant rotation facing target
        const qFinal = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
        this.ship.quaternion.copy(qFinal);
        this.ship.mesh.quaternion.copy(this.ship.quaternion);

        // Snap camera immediately to prevent chase lerp stuttering
        const cameraOffset = new THREE.Vector3(0, 1.2 * (this.ship.cameraDistance / 6.0), this.ship.cameraDistance);
        cameraOffset.applyQuaternion(this.ship.quaternion);
        this.camera.position.copy(this.ship.position).add(cameraOffset);
        
        const targetForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
        const lookTarget = this.ship.position.clone().add(targetForward.multiplyScalar(10));
        this.camera.lookAt(lookTarget);
        
        const targetUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.ship.quaternion);
        this.camera.up.copy(targetUp);

        // Set exit state
        this.warpState = 'decelerating';
        this.warpTimer = 0;
        spaceAudio.setWarp(false); // Play spin down drone sound
        
        // Start exit velocity pointing at target
        this.ship.velocity.copy(dir).multiplyScalar(exitSpeed);
        this.ship.throttle = 0.0; // Throttle to zero
      }
    } 
    else if (this.warpState === 'decelerating') {
      const targetPos = (target.group ? target.group.position : target.mesh.position).clone();
      const shipPos = this.ship.position;

      // Ride along with the orbiting station while the jump spins down
      if (target.kind === 'station') {
        shipPos.copy(this.ship.stationDockPoint(target, WARP_STATION_STANDOFF, this.solarSystem));
      }

      // 1. Decelerate ship from warp speed down to a complete stop
      const t = Math.min(1.0, this.warpTimer / 1.0);
      const targetSpeed = 0.0;
      const currentSpeed = this.warpExitSpeed * (1.0 - t) + targetSpeed * t;
      
      const dir = targetPos.clone().sub(shipPos).normalize();
      this.ship.velocity.copy(dir).multiplyScalar(currentSpeed);

      // 2. Contract camera FOV
      this.camera.fov = 125 - t * 60; // 125 to 65
      this.camera.updateProjectionMatrix();

      // 3. Fade out flash
      if (flashDiv) {
        flashDiv.style.opacity = (1.0 - t).toString();
      }

      // Complete
      if (this.warpTimer >= 1.0) {
        this.warpState = null;
        this.ship.isWarping = false;
        this.camera.fov = 65;
        this.camera.updateProjectionMatrix();
        if (flashDiv) {
          flashDiv.style.opacity = '0';
        }
        this.ship.velocity.set(0, 0, 0); // Complete stop
        this.ship.throttle = 0.0;

        // Stations keep orbiting: the autopilot holds the waiting point, the pilot glides in to dock
        if (target.kind === 'station') {
          this.ship.autopilotActive = true;
          if (!this.ui.tutorial.active) {
            this.ui.tutorial.say('Autopilot hält vor der Station. W gleitet heran, G dockt an, X übernimmt die Steuerung.', 8000);
          }
        }
      }
    }
  }

  startSimulation() {
    // Earth kept orbiting behind the start screen: re-place the ship now, or Earth may have swept into it
    this.placeShipAtEarth();
    this.simRunning = true;
    const canvas = document.getElementById('space-canvas');
    controls.start(canvas);
  }

  toggleScaleMode() {
    if (!this.simRunning || this.ship.isDocked) return;
    spaceAudio.playAutopilotAlert(false); // Locked to Arcade mode
  }

  toggleFlightAssist() {
    if (!this.simRunning || this.ship.isDocked) return;
    this.ship.flightAssist = !this.ship.flightAssist;
    spaceAudio.playBeep();
  }

  toggleAudio() {
    const isMuted = !spaceAudio.muted;
    spaceAudio.setMute(isMuted);
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  tick() {
    requestAnimationFrame(this.tick.bind(this));

    const delta = this.clock.getDelta();
    
    // 1. Slowly rotate orbits
    this.solarSystem.update(delta, this.ship ? this.ship.position : null);

    if (this.simRunning) {
      // 1.5. Update warp sequence if active
      if (this.warpState) {
        this.updateWarpJump(delta);
      }

      // 2. Update ship physics (slingshots calculations internally)
      this.ship.update(delta, this.solarSystem);
      this.ship.updateCamera(this.camera, delta);
      
      // 3. Collision checks: Lasers hitting Asteroids & Ship crashes
      if (!this.ship.isDocked) {
        this.checkCollisions();
      }

      // 4. Update dynamic UI indicators
      this.ui.update(this.ship, this.solarSystem, this.camera);
      
      // 5. Update explosions particles pool
      this.updateExplosions(delta);
      
      // 5.5. Update loot crates pool & check distance collection
      this.updateLootCrates(delta);

      // 5.6. Guided first flight & periodic autosave
      this.ui.tutorial.update(this.ship, this.dockableStation);
      this.autosaveTimer += delta;
      if (this.autosaveTimer >= AUTOSAVE_INTERVAL && !this.ship.isDestroyed) {
        this.autosaveTimer = 0;
        this.saveProgress();
      }

      controls.clearDeltas();
    } else {
      // Background menu rotation: slow orbit well outside the sun so it reads as a glowing disc
      const time = Date.now() * 0.00006;
      this.camera.position.set(Math.cos(time) * 210, 38, Math.sin(time) * 210);
      this.camera.lookAt(new THREE.Vector3(0, 0, 0));
    }

    // 6. WebGL frame render (bloom + ACES tone mapping)
    this.composer.render(delta);
  }

  checkCollisions() {
    const ship = this.ship;
    const solarSystem = this.solarSystem;

    // A. Check active laser bolts hitting asteroids or freighters
    for (let l = ship.laserBolts.length - 1; l >= 0; l--) {
      const bolt = ship.laserBolts[l];
      let boltConsumed = false;

      // 1. Check freighters first
      for (let s = 0; s < solarSystem.tradeShips.length; s++) {
        const ts = solarSystem.tradeShips[s];
        const dist = bolt.mesh.position.distanceTo(ts.mesh.position);
        
        if (dist < 1.6) {
          ship.laserGroup.remove(bolt.mesh);
          ship.laserBolts.splice(l, 1);
          boltConsumed = true;

          ts.shield -= 25;
          if (ts.shield <= 0) {
            this.spawnExplosion(ts.mesh.position, 0xffaa00);
            spaceAudio.playShipExplosion();
            this.spawnLootCargo(ts.mesh.position);

            // AI freighter respawn logic: reset shield & teleport to random orbit angle
            ts.shield = 100;
            ts.localAngle = Math.random() * Math.PI * 2;
          } else {
            this.spawnExplosion(bolt.mesh.position, 0x00f0ff);
            spaceAudio.playBeep();
          }
          break;
        }
      }

      if (boltConsumed) continue;

      // 2. Check asteroids
      for (let a = solarSystem.asteroids.length - 1; a >= 0; a--) {
        const ast = solarSystem.asteroids[a];
        const dist = bolt.mesh.position.distanceTo(ast.mesh.position);
        
        // Laser hits asteroid!
        if (dist < ast.size + 0.4) {
          // Remove asteroid from scene
          solarSystem.asteroidGroup.remove(ast.mesh);
          ast.mesh.geometry.dispose();
          ast.mesh.material.dispose();
          solarSystem.asteroids.splice(a, 1);

          // Remove laser bolt
          ship.laserGroup.remove(bolt.mesh);
          ship.laserBolts.splice(l, 1);
          boltConsumed = true;

          // Spawn particle explosion: Orange/Yellow fireballs
          this.spawnExplosion(ast.mesh.position, 0xff7700);
          
          // Play impact sound (quick double beep)
          spaceAudio.playBeep();

          // Yield cargo items (60% Ore, 40% Ice)
          const isOre = Math.random() < 0.6;
          const currentWeight = ship.getCurrentCargoWeight();

          if (currentWeight < ship.maxCargo) {
            if (isOre) {
              ship.cargo.ore++;
            } else {
              ship.cargo.ice++;
            }
            // Trigger HUD stats updates
            this.ui.updateHUDStats();
          }

          break; // break inner loop
        }
      }
      if (boltConsumed) continue;
    }

    // B. Check spaceship crashing into asteroids
    // Only crash if not in autopilot (safety sensors on autopilot)
    if (!ship.autopilotActive) {
      for (let a = 0; a < solarSystem.asteroids.length; a++) {
        const ast = solarSystem.asteroids[a];
        const dist = ship.position.distanceTo(ast.mesh.position);

        // Crash collision occurred!
        if (dist < ast.size + 0.8) {
          // Drain ship shields
          ship.shield = Math.max(0, ship.shield - 20); // Drains 20%
          
          // Sound buzzer alert warning
          spaceAudio.playAutopilotAlert(false);

          // Calculate bounce back vector
          const bounceDir = ship.position.clone().sub(ast.mesh.position).normalize();
          
          // Reflect velocity vector away from rock
          ship.velocity.copy(bounceDir.multiplyScalar(ship.maxSpeed * 0.6));
          
          // Spawn sparks particles explosion
          this.spawnExplosion(ship.position, 0x00f0ff);
          
          // Damage cockpit shake effect (implemented in updateCamera camera shake)
          ship.rotationSpeed.roll += (Math.random() - 0.5) * 4.0;
          ship.rotationSpeed.pitch += (Math.random() - 0.5) * 2.0;

          break; // only crash one asteroid per frame
        }
      }
    }

    // C. Check spaceship crashing into planets/Sun
    if (!ship.isWarping && !ship.isDestroyed) {
      for (let i = 0; i < solarSystem.planets.length; i++) {
        const p = solarSystem.planets[i];
        const dist = ship.position.distanceTo(p.group.position);
        const radius = p.mesh.scale.x;

        // Bounding check: if distance is less than planet scale radius + small ship buffer
        if (dist < radius + 0.45) {
          this.triggerShipExplosion(p.name);
          break;
        }
      }
    }
  }

  triggerShipExplosion(planetName) {
    if (this.ship.isDestroyed) return;

    this.ship.isDestroyed = true;
    this.ship.autopilotActive = false;
    this.ship.velocity.set(0, 0, 0);
    this.ship.throttle = 0.0;
    
    // Play explosion sound
    spaceAudio.playShipExplosion();
    
    // Spawn Privateer-style visual explosion!
    this.spawnPrivateerExplosion(this.ship.position);

    // Hide ship mesh
    this.ship.mesh.visible = false;

    // Show Game Over UI screen
    const deathScreen = document.getElementById('game-over-screen');
    const deathText = document.getElementById('death-reason-text');
    if (deathText) {
      const name = displayName(planetName);
      const feminine = ['Sonne', 'Erde', 'Venus'];
      const withArticle = feminine.includes(name) ? `der ${name}` : `dem ${name}`;
      deathText.innerText = `Dein Schiff ist mit ${withArticle} kollidiert und explodiert.`;
    }

    // The cargo hold is lost with the ship; credits and upgrades stay on the pilot's account
    this.ship.cargo = { ore: 0, ice: 0, tech: 0 };
    this.saveProgress();
    
    if (deathScreen) {
      deathScreen.classList.remove('hidden');
    }
    
    // Release pointer lock
    document.exitPointerLock();
  }

  respawnShip() {
    // 1. New clone hull: shields restored, cargo already lost in the explosion
    this.ship.applyUpgrades();
    this.ship.shield = this.ship.maxShield;

    // 2. Reset solar system orbital angles
    this.solarSystem.planets.forEach((p, idx) => {
      if (idx > 0) {
        p.angle = Math.random() * Math.PI * 2;
      } else {
        p.angle = 0; // Sun at center
      }
    });

    this.solarSystem.stations.forEach(st => {
      st.orbitAngle = st.planetIndex === 3 ? 0.0 : Math.PI;
    });

    this.solarSystem.asteroids.forEach(ast => {
      ast.angle = Math.random() * Math.PI * 2;
    });

    // 3. Sync positions immediately
    this.solarSystem.update(0);

    // 4. Position player safely near the newly repositioned Earth
    this.placeShipAtEarth();

    this.ship.velocity.set(0, 0, 0);
    this.ship.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0));
    this.ship.throttle = 0.0;
    
    this.ship.isDestroyed = false;
    this.ship.isWarping = false;
    this.warpState = null;
    
    this.ship.cameraMode = 'cockpit';
    this.ship.mesh.visible = true; // Make sure ship is visible if in chase camera later
    this.ship.mesh.position.copy(this.ship.position);
    this.ship.mesh.quaternion.copy(this.ship.quaternion);

    // 5. Clean up remaining active lasers
    this.ship.laserBolts.forEach(bolt => {
      this.ship.laserGroup.remove(bolt.mesh);
      bolt.mesh.geometry.dispose();
      bolt.mesh.material.dispose();
    });
    this.ship.laserBolts = [];

    // 6. Clean up remaining active explosions
    this.explosions.forEach(exp => {
      this.scene.remove(exp.group);
      exp.particles.forEach(p => {
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      });
      // Dispose debris
      if (exp.debris) {
        exp.debris.forEach(d => {
          d.mesh.geometry.dispose();
          d.mesh.material.dispose();
        });
      }
      // Dispose shockwaves / rings
      if (exp.shockwaves) {
        exp.shockwaves.forEach(s => {
          s.mesh.geometry.dispose();
          s.mesh.material.dispose();
        });
      }
      if (exp.rings) {
        exp.rings.forEach(r => {
          r.mesh.geometry.dispose();
          r.mesh.material.dispose();
        });
      }
    });
    this.explosions = [];

    // 6.5. Clean up remaining active loots
    this.loots.forEach(loot => {
      this.scene.remove(loot.group);
      loot.group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    });
    this.loots = [];

    spaceAudio.setThrottle(0);
    spaceAudio.setWarp(false);
    
    const deathScreen = document.getElementById('game-over-screen');
    if (deathScreen) {
      deathScreen.classList.add('hidden');
    }
    
    // Close terminal window and nav map if open
    this.ui.closeSpaceport();
    this.ui.navMap.close(false);
    
    controls.requestLock();
    this.ui.updateHUDStats();
  }

  spawnExplosion(position, colorHex) {
    const particleCount = 14;
    const expGroup = new THREE.Group();
    this.scene.add(expGroup);

    const particles = [];
    const size = 0.05 + Math.random() * 0.05;
    const geom = new THREE.SphereGeometry(size, 4, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 1.0
    });

    for (let i = 0; i < particleCount; i++) {
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(position);
      expGroup.add(mesh);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15
      );

      particles.push({
        mesh: mesh,
        velocity: vel
      });
    }

    this.explosions.push({
      group: expGroup,
      particles: particles,
      life: 0.45,
      maxLife: 0.45
    });
  }

  spawnPrivateerExplosion(position) {
    const expGroup = new THREE.Group();
    this.scene.add(expGroup);

    const particles = [];
    const debris = [];
    const shockwaves = [];
    const rings = [];
    
    // 1. Spawning expanding shockwave fireballs (expanding spheres)
    const fireballsData = [
      { color: 0xffffff, startSize: 0.1, expandSpeed: 20.0, maxOpacity: 1.0 }, // Bright core flash
      { color: 0xffaa00, startSize: 0.1, expandSpeed: 14.0, maxOpacity: 0.8 }, // Main orange fireball
      { color: 0xff3300, startSize: 0.1, expandSpeed: 9.0, maxOpacity: 0.6 }   // Outer red ring/sphere
    ];
    
    fireballsData.forEach(fd => {
      const geom = new THREE.SphereGeometry(1.0, 16, 16);
      const mat = new THREE.MeshBasicMaterial({
        color: fd.color,
        transparent: true,
        opacity: fd.maxOpacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(position);
      expGroup.add(mesh);
      
      shockwaves.push({
        mesh: mesh,
        startSize: fd.startSize,
        expandSpeed: fd.expandSpeed,
        maxOpacity: fd.maxOpacity
      });
    });

    // 1.5. Spawning expanding flat Praxis energy rings (expanding 2D rings)
    const ringsData = [
      { color: 0x00f0ff, startSize: 0.2, expandSpeed: 24.0, maxOpacity: 0.95 }, // Inner cyan energy shockwave
      { color: 0xff5500, startSize: 0.1, expandSpeed: 18.0, maxOpacity: 0.7 }   // Outer orange heat shockwave
    ];

    ringsData.forEach(rd => {
      const geom = new THREE.RingGeometry(0.7, 1.0, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: rd.color,
        transparent: true,
        opacity: rd.maxOpacity,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(position);
      // Align horizontally
      mesh.rotateX(Math.PI / 2);
      expGroup.add(mesh);

      rings.push({
        mesh: mesh,
        startSize: rd.startSize,
        expandSpeed: rd.expandSpeed,
        maxOpacity: rd.maxOpacity
      });
    });

    // Add temporary point light for dynamic illumination
    const explosionLight = new THREE.PointLight(0xffaa00, 16.0, 75.0, 1.3);
    explosionLight.position.copy(position);
    expGroup.add(explosionLight);

    // 2. Spawning ship fragments / debris
    const debrisCount = 12;
    for (let i = 0; i < debrisCount; i++) {
      const w = 0.1 + Math.random() * 0.3;
      const h = 0.05 + Math.random() * 0.15;
      const d = 0.1 + Math.random() * 0.4;
      
      const geom = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x3a424a,
        roughness: 0.6,
        metalness: 0.7,
        transparent: true,
        opacity: 1.0
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(position);
      expGroup.add(mesh);
      
      const speed = 3.0 + Math.random() * 10.0;
      const dir = new THREE.Vector3(
        (Math.random() - 0.5),
        (Math.random() - 0.5),
        (Math.random() - 0.5)
      ).normalize();
      const velocity = dir.multiplyScalar(speed);
      
      const spin = new THREE.Vector3(
        (Math.random() - 0.5) * 8.0,
        (Math.random() - 0.5) * 8.0,
        (Math.random() - 0.5) * 8.0
      );
      
      debris.push({
        mesh: mesh,
        velocity: velocity,
        spin: spin
      });
    }

    // 3. Spawning sparks/particles
    const particleCount = 40;
    const sparkGeom = new THREE.SphereGeometry(0.06, 4, 4);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffaa44,
      transparent: true,
      opacity: 1.0
    });
    
    for (let i = 0; i < particleCount; i++) {
      const mesh = new THREE.Mesh(sparkGeom, sparkMat);
      mesh.position.copy(position);
      expGroup.add(mesh);
      
      const speed = 5.0 + Math.random() * 22.0;
      const dir = new THREE.Vector3(
        (Math.random() - 0.5),
        (Math.random() - 0.5),
        (Math.random() - 0.5)
      ).normalize();
      const velocity = dir.multiplyScalar(speed);
      
      particles.push({
        mesh: mesh,
        velocity: velocity
      });
    }

    this.explosions.push({
      group: expGroup,
      particles: particles,
      debris: debris,
      shockwaves: shockwaves,
      rings: rings,
      light: explosionLight,
      lightMaxIntensity: 16.0,
      life: 0.8,
      maxLife: 0.8
    });
  }

  updateExplosions(delta) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const exp = this.explosions[i];
      exp.life -= delta;

      if (exp.life <= 0) {
        // Clean up from scene
        this.scene.remove(exp.group);
        exp.particles.forEach(p => {
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
        });
        if (exp.debris) {
          exp.debris.forEach(d => {
            d.mesh.geometry.dispose();
            d.mesh.material.dispose();
          });
        }
        if (exp.shockwaves) {
          exp.shockwaves.forEach(s => {
            s.mesh.geometry.dispose();
            s.mesh.material.dispose();
          });
        }
        if (exp.rings) {
          exp.rings.forEach(r => {
            r.mesh.geometry.dispose();
            r.mesh.material.dispose();
          });
        }
        this.explosions.splice(i, 1);
      } else {
        const ratio = exp.life / exp.maxLife;
        
        // 1. Animate sparks/particles
        exp.particles.forEach(p => {
          p.mesh.position.add(p.velocity.clone().multiplyScalar(delta));
          p.mesh.material.opacity = ratio;
          p.mesh.scale.setScalar(ratio);
        });

        // 2. Animate debris chunks
        if (exp.debris) {
          exp.debris.forEach(d => {
            d.mesh.position.add(d.velocity.clone().multiplyScalar(delta));
            d.mesh.rotation.x += d.spin.x * delta;
            d.mesh.rotation.y += d.spin.y * delta;
            d.mesh.rotation.z += d.spin.z * delta;
            if (ratio < 0.5) {
              d.mesh.material.opacity = ratio * 2.0; // Fade out in the second half
            }
          });
        }

        // 3. Animate shockwaves
        if (exp.shockwaves) {
          exp.shockwaves.forEach(s => {
            const elapsed = exp.maxLife - exp.life;
            const size = s.startSize + elapsed * s.expandSpeed;
            s.mesh.scale.setScalar(size);
            s.mesh.material.opacity = ratio * s.maxOpacity;
          });
        }

        // 4. Animate shockwave rings
        if (exp.rings) {
          exp.rings.forEach(r => {
            const elapsed = exp.maxLife - exp.life;
            const size = r.startSize + elapsed * r.expandSpeed;
            r.mesh.scale.set(size, size, 1.0);
            r.mesh.material.opacity = ratio * r.maxOpacity;
          });
        }

        // 5. Fade out point light
        if (exp.light) {
          exp.light.intensity = ratio * exp.lightMaxIntensity;
        }
      }
    }
  }

  spawnLootCargo(position) {
    const lootGroup = new THREE.Group();
    lootGroup.position.copy(position);
    this.scene.add(lootGroup);

    // Crate box mesh
    const crateGeom = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0xffaa00,
      roughness: 0.5,
      metalness: 0.8
    });
    const crateMesh = new THREE.Mesh(crateGeom, crateMat);
    lootGroup.add(crateMesh);

    // Blinking beacon point light
    const beaconLight = new THREE.PointLight(0xffdd00, 2.5, 9.0, 1.2);
    beaconLight.position.set(0, 0.35, 0);
    lootGroup.add(beaconLight);

    // Spark beacon mesh representing the light bulb
    const bulbGeom = new THREE.SphereGeometry(0.08, 6, 6);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const bulbMesh = new THREE.Mesh(bulbGeom, bulbMat);
    bulbMesh.position.set(0, 0.35, 0);
    lootGroup.add(bulbMesh);

    // Random tumble spin speed
    const spinSpeed = new THREE.Vector3(
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 1.5
    );

    this.loots.push({
      group: lootGroup,
      mesh: crateMesh,
      light: beaconLight,
      spin: spinSpeed,
      pulseTimer: 0
    });
  }

  updateLootCrates(delta) {
    if (delta <= 0) return;

    // Check if tractor beam is active (B key is held)
    const isTractorActive = controls.keys.tractorBeam && !this.ship.isDestroyed && !this.ship.isDocked;
    spaceAudio.setTractorBeam(isTractorActive);

    let nearestCrate = null;
    let minCrateDist = Infinity;

    for (let i = this.loots.length - 1; i >= 0; i--) {
      const loot = this.loots[i];
      
      // Rotate/Tumble
      loot.mesh.rotation.x += loot.spin.x * delta;
      loot.mesh.rotation.y += loot.spin.y * delta;
      loot.mesh.rotation.z += loot.spin.z * delta;

      // Pulse beacon light
      loot.pulseTimer += delta * 6;
      loot.light.intensity = 2.0 + Math.sin(loot.pulseTimer) * 1.8;

      // Check distance to player ship for collection or tractor beam pull
      const toShip = this.ship.position.clone().sub(loot.group.position);
      const dist = toShip.length();

      // Tractor beam pulls crates within 150 units towards the ship
      if (isTractorActive && dist < 150.0) {
        const pullDir = toShip.clone().normalize();
        // Crate accelerates as it gets closer to the ship
        const pullSpeed = 22.0 + (150.0 - dist) * 0.12; 
        loot.group.position.add(pullDir.multiplyScalar(pullSpeed * delta));

        if (dist < minCrateDist) {
          minCrateDist = dist;
          nearestCrate = loot;
        }
      }

      if (dist < 2.2) {
        // Collect beep
        spaceAudio.playBeep();
        
        // Award credits & cargo
        this.ship.credits += 200;
        
        const currentWeight = this.ship.getCurrentCargoWeight();
        if (currentWeight < this.ship.maxCargo) {
          const items = ['ore', 'ice', 'tech'];
          const randomItem = items[Math.floor(Math.random() * items.length)];
          this.ship.cargo[randomItem]++;
        }

        // Clean up from scene
        this.scene.remove(loot.group);
        loot.group.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });

        this.loots.splice(i, 1);
        this.ui.updateHUDStats();
      }
    }

    // Update tractor beam visual line geometry
    if (isTractorActive && nearestCrate) {
      // Tractor beam starts slightly forward of ship center (nose)
      const noseOffset = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion).multiplyScalar(0.8);
      const startPos = this.ship.position.clone().add(noseOffset);
      const endPos = nearestCrate.group.position;

      const points = [startPos, endPos];
      this.tractorBeamLine.geometry.setFromPoints(points);
      this.tractorBeamLine.geometry.verticesNeedUpdate = true;
      this.tractorBeamLine.material.opacity = 0.5 + Math.sin(Date.now() * 0.02) * 0.35; // pulsing glow
    } else {
      this.tractorBeamLine.material.opacity = 0; // invisible
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  if (import.meta.env.DEV) window.__game = game; // console access while developing
});
