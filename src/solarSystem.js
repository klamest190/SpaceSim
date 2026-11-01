import * as THREE from 'three';
import { PlanetBody } from './planets';

// Orbits keep their true spacing (1 unit = 100.000 km); bodies are drawn far larger than true scale,
// so a ship of 2 units is tiny beside them and planets read as worlds from afar.
const DIST_SCALE = 10.0;
const STATION_ORBIT = 1.3;           // stations circle at this many planet radii, low over the clouds
const FLOOR_ATMOSPHERE_DEPTH = 0.45; // the ship may sink this far into an atmosphere's shell
const FLOOR_AIRLESS = 0.012;         // above airless ground it may come this close, in planet radii

// Planetary configurations
// radius: drawn radius in units; tilt: axial tilt in degrees; spin: rad/s; gravity: pull at the surface (units/s²)
// atmosphere: shell thickness and scale heights as fractions, vertical optical depths tauR (rgb) and tauM
export const PLANET_DATA = [
  {
    name: 'Sun',
    realRadius: 696340,
    realDist: 0,
    orbitPeriod: 0,
    radius: 180,
    spin: 0.004,
    gravity: 4.0,
    details: {
      mass: '1.989 × 10³⁰ kg (333,000 Erdmassen)',
      temp: '5,500 °C (Oberfläche), 15 Mio. °C (Kern)',
      atmosphere: 'Wasserstoff (73%), Helium (25%)',
      funFact: 'Die Sonne macht 99,86% der gesamten Masse des Sonnensystems aus.'
    }
  },
  {
    name: 'Mercury',
    realRadius: 2439.7,
    realDist: 57.9,
    orbitPeriod: 88,
    radius: 52,
    tilt: 0.03,
    spin: 0.003,
    gravity: 0.6,
    light: 1.2,
    bump: 6,
    texWidth: 2048,
    details: {
      mass: '3.285 × 10²³ kg (0.055 Erdmassen)',
      temp: '-180 °C bis 430 °C',
      atmosphere: 'Praktisch keine (Exosphäre aus Helium/Natrium)',
      funFact: 'Ein Tag auf dem Merkur dauert etwa 59 Erdtage, während ein Jahr nur 88 Tage dauert.'
    }
  },
  {
    name: 'Venus',
    realRadius: 6051.8,
    realDist: 108.2,
    orbitPeriod: 224.7,
    radius: 96,
    tilt: 2.6,
    spin: -0.006, // the cloud deck races round backwards
    gravity: 1.1,
    light: 1.05,
    texWidth: 2048,
    atmosphere: { thickness: 0.06, hR: 0.16, hM: 0.05, tauR: [0.30, 0.24, 0.13], tauM: 0.2, g: 0.7, sunE: 4 },
    details: {
      mass: '4.867 × 10²⁴ kg (0.815 Erdmassen)',
      temp: '462 °C (Heißester Planet)',
      atmosphere: 'Kohlendioxid (96%), Stickstoff (3.5%)',
      funFact: 'Venus rotiert im Uhrzeigersinn (retrograd) und extrem langsam – ihr Tag ist länger als ihr Jahr.'
    }
  },
  {
    name: 'Earth',
    realRadius: 6371.0,
    realDist: 149.6,
    orbitPeriod: 365.25,
    radius: 100,
    tilt: 23.4,
    spin: 0.008,
    gravity: 1.2,
    light: 1.0,
    bump: 3,
    texWidth: 4096,
    clouds: { altitude: 0.006 },
    atmosphere: { thickness: 0.04, hR: 0.11, hM: 0.022, tauR: [0.055, 0.13, 0.32], tauM: 0.012, g: 0.76, sunE: 4.5 },
    details: {
      mass: '5.972 × 10²⁴ kg',
      temp: '-88 °C bis 58 °C',
      atmosphere: 'Stickstoff (78%), Sauerstoff (21%), Argon (0.93%)',
      funFact: 'Der einzige bekannte Himmelskörper, der flüssiges Oberflächenwasser und Leben beherbergt.'
    }
  },
  {
    name: 'Mars',
    realRadius: 3389.5,
    realDist: 227.9,
    orbitPeriod: 687,
    radius: 65,
    tilt: 25.2,
    spin: 0.0078,
    gravity: 0.6,
    light: 0.95,
    bump: 3.5,
    texWidth: 2048,
    atmosphere: { thickness: 0.035, hR: 0.15, hM: 0.06, tauR: [0.07, 0.04, 0.02], tauM: 0.06, g: 0.65, sunE: 5 },
    details: {
      mass: '6.390 × 10²³ kg (0.107 Erdmassen)',
      temp: '-143 °C bis 35 °C',
      atmosphere: 'Kohlendioxid (95.3%), Stickstoff (2.7%)',
      funFact: 'Heimat des Olympus Mons, des höchsten bekannten Vulkans im Sonnensystem (22 km hoch).'
    }
  },
  {
    name: 'Jupiter',
    realRadius: 69911,
    realDist: 778.5,
    orbitPeriod: 4333,
    radius: 520,
    tilt: 3.1,
    spin: 0.012,
    gravity: 2.4,
    light: 1.0,
    texWidth: 4096,
    atmosphere: { thickness: 0.018, hR: 0.2, hM: 0.05, tauR: [0.06, 0.07, 0.09], tauM: 0.04, g: 0.7, sunE: 4.5 },
    details: {
      mass: '1.898 × 10²⁷ kg (318 Erdmassen)',
      temp: '-108 °C',
      atmosphere: 'Wasserstoff (89.8%), Helium (10.2%)',
      funFact: 'Der größte Planet. Sein Roter Fleck ist ein riesiger Sturm, der größer als die Erde ist und seit Jahrhunderten tobt.'
    }
  },
  {
    name: 'Saturn',
    realRadius: 58232,
    realDist: 1434,
    orbitPeriod: 10759,
    radius: 458,
    tilt: 26.7,
    spin: 0.011,
    gravity: 1.3,
    light: 1.0,
    texWidth: 2048,
    rings: { inner: 1.11, outer: 2.35 },
    atmosphere: { thickness: 0.02, hR: 0.2, hM: 0.05, tauR: [0.08, 0.075, 0.06], tauM: 0.04, g: 0.7, sunE: 4.5 },
    details: {
      mass: '5.683 × 10²⁶ kg (95 Erdmassen)',
      temp: '-139 °C',
      atmosphere: 'Wasserstoff (96.3%), Helium (3.2%)',
      funFact: 'Hat das ausgeprägteste Ringsystem aus Eis- und Gesteinspartikeln. Saturn hat die geringste Dichte – er würde im Wasser schwimmen.'
    }
  },
  {
    name: 'Uranus',
    realRadius: 25362,
    realDist: 2871,
    orbitPeriod: 30687,
    radius: 259,
    tilt: 97.8,
    spin: -0.007,
    gravity: 1.1,
    light: 0.95,
    texWidth: 1024,
    rings: { inner: 1.6, outer: 2.05 },
    atmosphere: { thickness: 0.025, hR: 0.2, hM: 0.05, tauR: [0.03, 0.12, 0.16], tauM: 0.03, g: 0.7, sunE: 4.5 },
    details: {
      mass: '8.681 × 10²⁵ kg (14 Erdmassen)',
      temp: '-197 °C',
      atmosphere: 'Wasserstoff (82.5%), Helium (15.2%), Methan (2.3%)',
      funFact: 'Uranus rotiert auf der Seite liegend (seine Achse ist um 98 Grad gekippt), vermutlich durch eine uralte Kollision.'
    }
  },
  {
    name: 'Neptune',
    realRadius: 24622,
    realDist: 4495,
    orbitPeriod: 60190,
    radius: 253,
    tilt: 28.3,
    spin: 0.0075,
    gravity: 1.3,
    light: 0.95,
    texWidth: 2048,
    atmosphere: { thickness: 0.025, hR: 0.2, hM: 0.05, tauR: [0.03, 0.09, 0.28], tauM: 0.03, g: 0.7, sunE: 4.5 },
    details: {
      mass: '1.024 × 10²⁶ kg (17 Erdmassen)',
      temp: '-201 °C',
      atmosphere: 'Wasserstoff (80%), Helium (19%), Methan (1.5%)',
      funFact: 'Der windigste Planet im Sonnensystem mit Überschallwinden von bis zu 2.100 km/h.'
    }
  }
];

// Top of a body's atmosphere (its surface if it has none)
export function atmosphereTop(p) {
  return p.body.atmosphereTop;
}

// Closest a ship may come to a planet's centre: into the upper atmosphere, or just above airless ground
export function flightFloor(p) {
  const top = p.body.atmosphereTop;
  if (top > p.radius) return top - (top - p.radius) * FLOOR_ATMOSPHERE_DEPTH;
  return p.radius * (1 + FLOOR_AIRLESS);
}

export class SolarSystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 0;
    this.planets = [];
    this.orbitLines = [];
    
    // Space Stations, Asteroids & Trade Ships
    this.stations = [];
    this.asteroids = [];
    this.tradeShips = [];
    
    // Lock to arcade scaling mode
    this.scaleMode = 'arcade'; 
    
    this.setupSolarSystem();
    this.setupAsteroidBelt();
    this.setupSpaceStations();
    this.setupTradeShips();
  }

  setupSolarSystem() {
    this.skyGroup = new THREE.Group();
    this.scene.add(this.skyGroup);

    this.createStarfield();
    this.createNebulae();
    this.createGalaxies();

    const ambientLight = new THREE.AmbientLight(0x0f1422, 1.2);
    this.scene.add(ambientLight);

    // Sunlight for ships, stations and rocks (the planets light themselves in their shaders): parallel rays
    // from the Sun towards wherever the ship is, equally strong at Mercury and Neptune
    this.sunLight = new THREE.DirectionalLight(0xfff4e6, 2.6);
    this.sunLight.position.set(0, 0, 0);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    PLANET_DATA.forEach((data, index) => {
      const body = new PlanetBody(this.renderer, data, index * 17.0);
      this.scene.add(body.group);

      this.planets.push({
        name: data.name,
        group: body.group,
        mesh: body.mesh,
        rings: body.rings || null,
        atmosphere: body.atmosphere || null,
        clouds: body.clouds || null,
        body: body,
        radius: data.radius,
        data: data,
        angle: Math.random() * Math.PI * 2,
        orbitSpeed: data.orbitPeriod > 0 ? (2 * Math.PI) / (data.orbitPeriod * 2.5) : 0,
        currentPos: new THREE.Vector3()
      });

      // Orbits are fixed circles: draw each once
      let orbitLine = null;
      if (index > 0) {
        const r = data.realDist * DIST_SCALE;
        const points = [];
        for (let i = 0; i < 256; i++) {
          const theta = (i / 256) * Math.PI * 2;
          points.push(new THREE.Vector3(r * Math.cos(theta), 0, r * Math.sin(theta)));
        }
        orbitLine = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.05, depthWrite: false })
        );
        this.scene.add(orbitLine);
      }
      this.orbitLines.push(orbitLine);
    });

    this.update(0);
  }

  // Right before rendering: the planets' shaders work in planet-local space around the camera
  updateView(camera) {
    this.planets.forEach(p => p.body.updateView(camera));
  }

  setupAsteroidBelt() {
    const asteroidCount = 400; // Increased count for density
    
    this.asteroidGroup = new THREE.Group();
    this.scene.add(this.asteroidGroup);

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x42484f,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true
    });

    for (let i = 0; i < asteroidCount; i++) {
      // In physical units (million km), the Asteroid belt lies between 329 and 478 million km
      // (2.2 AE to 3.2 AE from Sun)
      const radiusReal = 329 + Math.random() * 149; // million km
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.003 + Math.random() * 0.005; // slower orbital velocities further out
      const heightReal = (Math.random() - 0.5) * 12.0; // vertical dispersion

      const sizeReal = 50 + Math.random() * 150; // physical size in km

      // Base geometry (re-scaled in update)
      const baseRockGeom = new THREE.DodecahedronGeometry(1.0, 1);
      const posAttr = baseRockGeom.getAttribute('position');
      for (let j = 0; j < posAttr.count; j++) {
        const vx = posAttr.getX(j) + (Math.random() - 0.5) * 0.35;
        const vy = posAttr.getY(j) + (Math.random() - 0.5) * 0.35;
        const vz = posAttr.getZ(j) + (Math.random() - 0.5) * 0.35;
        posAttr.setXYZ(j, vx, vy, vz);
      }
      baseRockGeom.computeVertexNormals();

      const mesh = new THREE.Mesh(baseRockGeom, rockMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      
      const spin = new THREE.Vector3(
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.8
      );

      this.asteroidGroup.add(mesh);

      this.asteroids.push({
        name: `ASTEROID-${i + 1}`,
        mesh: mesh,
        orbitRadiusReal: radiusReal,
        angle: angle,
        orbitSpeed: speed,
        heightReal: heightReal,
        spin: spin,
        sizeReal: sizeReal
      });
    }
  }

  setupSpaceStations() {
    const createStationMesh = (color) => {
      const station = new THREE.Group();

      const ringGeom = new THREE.TorusGeometry(0.7, 0.12, 8, 32);
      const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a939e, roughness: 0.45, metalness: 0.5 });
      const ring = new THREE.Mesh(ringGeom, metalMat);
      ring.rotateX(Math.PI / 2);
      station.add(ring);

      const hubGeom = new THREE.CylinderGeometry(0.2, 0.2, 1.2, 8);
      const hub = new THREE.Mesh(hubGeom, metalMat);
      station.add(hub);

      const strutGeom = new THREE.BoxGeometry(0.08, 0.08, 1.4);
      const strut = new THREE.Mesh(strutGeom, metalMat);
      station.add(strut);

      const panelGeom = new THREE.BoxGeometry(2.0, 0.03, 0.35);
      const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a3f9a, roughness: 0.25, metalness: 0.6 });
      const panels = new THREE.Mesh(panelGeom, panelMat);
      panels.position.set(0, 0.3, 0);
      station.add(panels);

      const lightGeom = new THREE.SphereGeometry(0.06, 6, 6);
      const lightMat = new THREE.MeshBasicMaterial({ color: color });
      const beacon1 = new THREE.Mesh(lightGeom, lightMat);
      beacon1.position.set(0, 0.7, 0);
      station.add(beacon1);

      const beacon2 = new THREE.Mesh(lightGeom, lightMat);
      beacon2.position.set(0, -0.7, 0);
      station.add(beacon2);

      station.scale.set(0.65, 0.65, 0.65);
      return station;
    };

    const earthStationMesh = createStationMesh(0x00ff66);
    this.scene.add(earthStationMesh);
    this.stations.push({
      name: 'Erde Orbital-Station',
      kind: 'station',
      planetIndex: 3,
      mesh: earthStationMesh,
      orbitAngle: 0.0,
      orbitVelocity: 4.0 // units/s along the orbit, slow enough to catch up with and dock
    });

    const marsStationMesh = createStationMesh(0xffaa00);
    this.scene.add(marsStationMesh);
    this.stations.push({
      name: 'Mars Außenposten',
      kind: 'station',
      planetIndex: 4,
      mesh: marsStationMesh,
      orbitAngle: Math.PI,
      orbitVelocity: 4.0
    });
  }

  createFreighterMesh() {
    const group = new THREE.Group();

    // Central cylindrical hull
    const hullGeom = new THREE.CylinderGeometry(0.2, 0.25, 2.2, 8);
    hullGeom.rotateX(Math.PI / 2);
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x4f545a,
      roughness: 0.4,
      metalness: 0.7
    });
    const hull = new THREE.Mesh(hullGeom, metalMat);
    group.add(hull);

    // Front Cockpit Cabin (small box facing Z = -1.1)
    const cabGeom = new THREE.BoxGeometry(0.35, 0.25, 0.45);
    const glassMat = new THREE.MeshPhongMaterial({
      color: 0xffbb00,
      emissive: 0x442200,
      shininess: 80
    });
    const cabin = new THREE.Mesh(cabGeom, glassMat);
    cabin.position.set(0, 0.08, -1.1);
    group.add(cabin);

    // Cargo Container crates stacked on the sides
    const cargoGeom = new THREE.BoxGeometry(0.36, 0.36, 0.55);
    const cargoMat1 = new THREE.MeshStandardMaterial({ color: 0x9c2424, roughness: 0.6 });
    const cargoMat2 = new THREE.MeshStandardMaterial({ color: 0x24619c, roughness: 0.6 });
    
    const c1 = new THREE.Mesh(cargoGeom, cargoMat1);
    c1.position.set(-0.28, 0, -0.35);
    group.add(c1);

    const c2 = new THREE.Mesh(cargoGeom, cargoMat2);
    c2.position.set(0.28, 0, -0.35);
    group.add(c2);

    const c3 = new THREE.Mesh(cargoGeom, cargoMat2);
    c3.position.set(-0.28, 0, 0.35);
    group.add(c3);

    const c4 = new THREE.Mesh(cargoGeom, cargoMat1);
    c4.position.set(0.28, 0, 0.35);
    group.add(c4);

    // Engine thrusters on back (Z = 1.1)
    const engGeom = new THREE.CylinderGeometry(0.12, 0.16, 0.4, 8);
    engGeom.rotateX(Math.PI / 2);
    const engMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, metalness: 0.8 });
    
    const e1 = new THREE.Mesh(engGeom, engMat);
    e1.position.set(-0.16, 0, 1.1);
    group.add(e1);

    const e2 = new THREE.Mesh(engGeom, engMat);
    e2.position.set(0.16, 0, 1.1);
    group.add(e2);

    // Engine glow cones
    const glowGeom = new THREE.CylinderGeometry(0.08, 0.01, 0.25, 8);
    glowGeom.rotateX(Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.8
    });
    
    const g1 = new THREE.Mesh(glowGeom, glowMat);
    g1.position.set(-0.16, 0, 1.3);
    group.add(g1);

    const g2 = new THREE.Mesh(glowGeom, glowMat);
    g2.position.set(0.16, 0, 1.3);
    group.add(g2);

    group.castShadow = true;
    group.receiveShadow = true;
    
    group.scale.set(0.65, 0.65, 0.65);
    return group;
  }

  setupTradeShips() {
    this.tradeShips = [];

    const specs = [
      { name: 'HÄNDLER-FRIGATTE MERC-01', planetIndex: 3, localAngle: 0.0, orbitRadiusFactor: 1.45, inclinationOffset: 0.1, orbitSpeed: 6.0 },
      { name: 'HÄNDLER-FRIGATTE MERC-02', planetIndex: 3, localAngle: Math.PI, orbitRadiusFactor: 1.75, inclinationOffset: -0.2, orbitSpeed: -5.0 },
      { name: 'HÄNDLER-FRIGATTE MERC-03', planetIndex: 4, localAngle: 0.5, orbitRadiusFactor: 1.5, inclinationOffset: 0.25, orbitSpeed: 6.5 },
      { name: 'HÄNDLER-FRIGATTE MERC-04', planetIndex: 4, localAngle: Math.PI * 1.5, orbitRadiusFactor: 1.8, inclinationOffset: -0.15, orbitSpeed: -5.0 }
    ];

    specs.forEach(spec => {
      const mesh = this.createFreighterMesh();
      this.scene.add(mesh);
      
      this.tradeShips.push({
        name: spec.name,
        mesh: mesh,
        planetIndex: spec.planetIndex,
        localAngle: spec.localAngle,
        orbitRadiusFactor: spec.orbitRadiusFactor,
        inclinationOffset: spec.inclinationOffset,
        orbitSpeed: spec.orbitSpeed,
        shield: 100
      });
    });
  }

  createStarfield() {
    // Layer 1: Background Dust Stars (dense, faint, cool colors)
    const bgCount = 7000;
    const bgGeom = new THREE.BufferGeometry();
    const bgPos = new Float32Array(bgCount * 3);
    const bgCols = new Float32Array(bgCount * 3);

    for (let i = 0; i < bgCount * 3; i += 3) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 120000 + Math.random() * 20000;

      bgPos[i] = r * Math.sin(phi) * Math.cos(theta);
      bgPos[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      bgPos[i + 2] = r * Math.cos(phi);

      const rc = Math.random();
      if (rc < 0.35) {
        // Faint blue-cyan dust
        bgCols[i] = 0.45; bgCols[i + 1] = 0.65; bgCols[i + 2] = 0.85;
      } else if (rc < 0.6) {
        // Faint pink-magenta dust
        bgCols[i] = 0.65; bgCols[i + 1] = 0.45; bgCols[i + 2] = 0.75;
      } else {
        // Dim white
        bgCols[i] = 0.7; bgCols[i + 1] = 0.7; bgCols[i + 2] = 0.7;
      }
    }
    bgGeom.setAttribute('position', new THREE.BufferAttribute(bgPos, 3));
    bgGeom.setAttribute('color', new THREE.BufferAttribute(bgCols, 3));

    const bgMat = new THREE.PointsMaterial({
      size: 1.0,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: false,
      depthWrite: false
    });
    const bgStars = new THREE.Points(bgGeom, bgMat);
    this.skyGroup.add(bgStars);

    // Layer 2: Foreground Bright Stars (fewer, larger, colorful)
    const fgCount = 1500;
    const fgGeom = new THREE.BufferGeometry();
    const fgPos = new Float32Array(fgCount * 3);
    const fgCols = new Float32Array(fgCount * 3);

    for (let i = 0; i < fgCount * 3; i += 3) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 110000 + Math.random() * 25000;

      fgPos[i] = r * Math.sin(phi) * Math.cos(theta);
      fgPos[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      fgPos[i + 2] = r * Math.cos(phi);

      const rc = Math.random();
      if (rc < 0.3) {
        // Vibrant bright blue stars
        fgCols[i] = 0.3; fgCols[i + 1] = 0.7; fgCols[i + 2] = 1.0;
      } else if (rc < 0.55) {
        // Vibrant orange-red stars
        fgCols[i] = 1.0; fgCols[i + 1] = 0.5; fgCols[i + 2] = 0.3;
      } else if (rc < 0.75) {
        // Warm gold-yellow stars
        fgCols[i] = 1.0; fgCols[i + 1] = 0.9; fgCols[i + 2] = 0.4;
      } else {
        // Brilliant white stars
        fgCols[i] = 1.0; fgCols[i + 1] = 1.0; fgCols[i + 2] = 1.0;
      }
    }
    fgGeom.setAttribute('position', new THREE.BufferAttribute(fgPos, 3));
    fgGeom.setAttribute('color', new THREE.BufferAttribute(fgCols, 3));

    const fgMat = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      sizeAttenuation: false,
      depthWrite: false
    });
    const fgStars = new THREE.Points(fgGeom, fgMat);
    this.skyGroup.add(fgStars);
  }

  createNebulaTexture(colorStr) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, 512, 512);

    // Draw 12 overlapping gaseous blobs of different sizes/positions
    const blobCount = 12;
    for (let i = 0; i < blobCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 120; // max offset from center
      const cx = 256 + Math.cos(angle) * dist;
      const cy = 256 + Math.sin(angle) * dist;
      
      const r = 50 + Math.random() * 110; // radius of this blob
      const opacityMultiplier = 0.08 + Math.random() * 0.16;
      
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
      const baseCol = colorStr.replace('1.0', opacityMultiplier.toFixed(2));
      const midCol = colorStr.replace('1.0', (opacityMultiplier * 0.45).toFixed(2));
      const edgeCol = 'rgba(0,0,0,0)';
      
      grad.addColorStop(0, baseCol);
      grad.addColorStop(0.4, midCol);
      grad.addColorStop(1, edgeCol);
      
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Add textured dust noise, only on top of existing gas (keeps the plane's edges invisible)
    const noise = this.generateNoiseCanvas(64, 64, 0, 255);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.06;
    ctx.drawImage(noise, 0, 0, 512, 512);
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  createNebulae() {
    const colors = [
      'rgba(90, 30, 140, 1.0)',   // Rich cosmic violet
      'rgba(20, 75, 160, 1.0)',   // Deep nebula blue
      'rgba(145, 30, 75, 1.0)',   // Vibrant dusty rose
      'rgba(15, 95, 80, 1.0)',    // Aurora emerald
      'rgba(160, 80, 20, 1.0)'    // Solar gold
    ];
    
    colors.forEach((col, i) => {
      const tex = this.createNebulaTexture(col);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      
      const size = 50000 + Math.random() * 30000;
      const geom = new THREE.PlaneGeometry(size, size);
      const mesh = new THREE.Mesh(geom, mat);
      
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 115000; 
      
      mesh.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
      
      mesh.lookAt(new THREE.Vector3(0, 0, 0));
      mesh.rotateZ(Math.random() * Math.PI * 2);
      this.skyGroup.add(mesh);
    });
  }

  createGalaxyTexture(type, coreColor, armColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 512);

    const centerX = 256;
    const centerY = 256;

    if (type === 'spiral') {
      // 1. Draw central core
      const coreRadius = 40;
      const coreGrad = ctx.createRadialGradient(centerX, centerY, 1, centerX, centerY, coreRadius);
      coreGrad.addColorStop(0, '#ffffff');
      coreGrad.addColorStop(0.25, '#fff0cc');
      coreGrad.addColorStop(0.6, coreColor);
      coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
      
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      // 2. Draw spiral arms
      const armCount = 2;
      const starsPerArm = 1100;
      
      for (let arm = 0; arm < armCount; arm++) {
        const angleOffset = arm * Math.PI;
        
        for (let s = 0; s < starsPerArm; s++) {
          const t = s / starsPerArm;
          const theta = t * Math.PI * 2.8; 
          const r = 35 + t * 180;
          
          // Dispersion increases as we go outwards
          const scatterX = (Math.random() - 0.5) * (15 + t * 50);
          const scatterY = (Math.random() - 0.5) * (15 + t * 50);
          
          const x = centerX + r * Math.cos(theta + angleOffset) + scatterX;
          const y = centerY + r * Math.sin(theta + angleOffset) + scatterY;
          
          let col = armColor;
          if (t < 0.25) {
            col = Math.random() < 0.4 ? '#ffffff' : coreColor;
          } else if (t < 0.6) {
            col = Math.random() < 0.5 ? coreColor : armColor;
          } else {
            col = Math.random() < 0.2 ? '#ffffff' : armColor;
          }
          
          const size = Math.max(0.45, (1.0 - t * 0.55) * (0.8 + Math.random() * 1.5));
          const opacity = (1.0 - t * 0.45) * (0.35 + Math.random() * 0.5);
          
          ctx.fillStyle = col;
          ctx.globalAlpha = opacity;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1.0;
    } 
    else {
      // Elliptical Galaxy
      const steps = 15;
      for (let i = steps; i > 0; i--) {
        const t = i / steps;
        const rx = t * 165;
        const ry = t * 95;
        
        const opacity = (1.0 - t * 0.82) * 0.16;
        ctx.fillStyle = coreColor;
        ctx.globalAlpha = opacity;
        
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, rx, ry, -Math.PI / 12, 0, Math.PI * 2);
        ctx.fill();
      }
      
      const coreGrad = ctx.createRadialGradient(centerX, centerY, 1, centerX, centerY, 24);
      coreGrad.addColorStop(0, '#ffffff');
      coreGrad.addColorStop(0.4, '#ffeecc');
      coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = coreGrad;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 24, 0, Math.PI * 2);
      ctx.fill();

      // Subtle dark dust lane
      ctx.strokeStyle = '#221100';
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.moveTo(centerX - 100, centerY - 15);
      ctx.bezierCurveTo(centerX - 30, centerY - 10, centerX + 30, centerY - 25, centerX + 100, centerY - 20);
      ctx.stroke();

      ctx.globalAlpha = 1.0;
    }

    return new THREE.CanvasTexture(canvas);
  }

  createGalaxies() {
    const galaxySpecs = [
      { type: 'spiral', core: '#ff9900', arm: '#00bfff', size: 28000 },
      { type: 'spiral', core: '#ff00aa', arm: '#00ffaa', size: 24000 },
      { type: 'elliptical', core: '#ff8800', arm: '', size: 20000 },
      { type: 'spiral', core: '#ffffff', arm: '#bb33ff', size: 22000 },
      { type: 'elliptical', core: '#ff4400', arm: '', size: 16000 }
    ];

    galaxySpecs.forEach(spec => {
      const tex = this.createGalaxyTexture(spec.type, spec.core, spec.arm);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      const geom = new THREE.PlaneGeometry(spec.size, spec.size);
      const mesh = new THREE.Mesh(geom, mat);

      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 110000;

      mesh.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );

      mesh.lookAt(new THREE.Vector3(0, 0, 0));
      mesh.rotateZ(Math.random() * Math.PI * 2);

      this.skyGroup.add(mesh);
    });
  }

  generateNoiseCanvas(width, height, minVal, maxVal) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const val = minVal + Math.floor(Math.random() * (maxVal - minVal + 1));
      imgData.data[i] = val;
      imgData.data[i + 1] = val;
      imgData.data[i + 2] = val;
      imgData.data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  setScaleMode(mode) {
    // Locked to arcade mode
    this.scaleMode = 'arcade';
    this.update(0);
  }

  // True physical scale ratios (1 unit = 100,000 km)
  getScaleParameters() {
    switch (this.scaleMode) {
      case 'realistic':
        return {
          sizeScale: 0.00001,  // Earth radius = 0.0637 units (6,371 km)
          distScale: 10.0,     // Earth distance = 1,496 units (149.6 million km)
          minSize: 0.00001
        };
      case 'arcade':
        return {
          sizeScale: 0.0003,   // intermediate size scale
          distScale: 10.0,     // same as realistic
          minSize: 2.5         // minimum size for visiblity
        };
      case 'orrery':
        return {
          sizeScale: 0.0005,
          distScale: 0.04,
          minSize: 0.5
        };
      case 'visual':
      default:
        return {
          sizeScale: 0.0015,
          distScale: 0.18,
          minSize: 1.0
        };
    }
  }

  update(delta, shipPos = null) {
    const scale = this.getScaleParameters();
    if (delta > 0) this.time += delta;

    if (shipPos && this.skyGroup) {
      this.skyGroup.position.copy(shipPos);
    }
    if (shipPos) this.sunLight.target.position.copy(shipPos);

    // 1. Planets: orbit, spin, and the orbital velocity the ship's stabilizer and station departures fly relative to
    this.planets.forEach((p, index) => {
      const isSun = index === 0;

      if (delta > 0 && !isSun) {
        // Slow down planetary orbits for smoother gameplay/docking
        const speedMultiplier = 0.08;
        p.angle += p.orbitSpeed * delta * speedMultiplier;
      }

      const r = isSun ? 0 : p.data.realDist * DIST_SCALE;
      const prevX = p.currentPos.x;
      const prevZ = p.currentPos.z;
      p.currentPos.set(
        r * Math.cos(p.angle),
        0,
        r * Math.sin(p.angle)
      );

      if (!p.velocity) p.velocity = new THREE.Vector3();
      if (delta > 0) p.velocity.set((p.currentPos.x - prevX) / delta, 0, (p.currentPos.z - prevZ) / delta);

      p.group.position.copy(p.currentPos);
      p.body.update(delta, this.time);
    });

    // 2. Update Space Stations orbits dynamically outside planet atmosphere
    this.stations.forEach(st => {
      const parentPlanet = this.planets[st.planetIndex];
      if (!parentPlanet) return;
      
      // Low orbit above the clouds, at a fixed speed along the track
      const orbitOffset = parentPlanet.radius * STATION_ORBIT;
      if (delta > 0) {
        st.orbitAngle += (st.orbitVelocity / orbitOffset) * delta;
      }

      const offsetPos = new THREE.Vector3(
        orbitOffset * Math.cos(st.orbitAngle),
        orbitOffset * 0.25 * Math.sin(st.orbitAngle),
        orbitOffset * Math.sin(st.orbitAngle)
      );

      st.mesh.position.copy(parentPlanet.group.position).add(offsetPos);
      st.mesh.rotation.y += 0.005;

      st.mesh.scale.setScalar(2.0);
    });

    // 2.5. Update Trade Ships orbits dynamically around their parent planets
    this.tradeShips.forEach(ts => {
      const parentPlanet = this.planets[ts.planetIndex];
      if (!parentPlanet) return;

      // Orbit radius in planet radii, speed in units/s along the track
      const orbitOffset = parentPlanet.radius * ts.orbitRadiusFactor;
      if (delta > 0) {
        ts.localAngle += (ts.orbitSpeed / orbitOffset) * delta;
      }

      const localPos = new THREE.Vector3(
        orbitOffset * Math.cos(ts.localAngle),
        orbitOffset * 0.15 * Math.sin(ts.localAngle * 2.0 + ts.inclinationOffset),
        orbitOffset * Math.sin(ts.localAngle)
      );

      ts.mesh.position.copy(parentPlanet.group.position).add(localPos);

      // Rotate ship so its nose points along the tangent of its orbit
      const tangent = new THREE.Vector3(
        -Math.sin(ts.localAngle),
        0.30 * Math.cos(ts.localAngle * 2.0 + ts.inclinationOffset),
        Math.cos(ts.localAngle)
      ).normalize();

      // Align ship forward Z-axis (0,0,-1) to tangent direction
      const targetRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), tangent);
      ts.mesh.quaternion.copy(targetRotation);
    });

    // 3. Update Asteroid orbits in the belt
    this.asteroids.forEach(ast => {
      if (delta > 0) {
        ast.angle += ast.orbitSpeed * delta;
      }
      
      // Scale asteroid orbit and size based on current scale mode
      const radius = ast.orbitRadiusReal * scale.distScale;
      const height = ast.heightReal * scale.distScale;
      
      // Give a minimum size of 0.08 units in realistic scale so they are targetable
      let size = ast.sizeReal * scale.sizeScale;
      if (this.scaleMode === 'realistic') {
        size = Math.max(0.08, size * 2.5); // enlarged slightly for gameplay fun
      } else if (this.scaleMode === 'arcade') {
        size = Math.max(0.15, size * 6.0); // visible asteroids for arcade flight
      } else if (this.scaleMode === 'orrery') {
        size = size * 1.5;
      } else {
        // visual
        size = size * 50.0;
      }

      ast.mesh.position.set(
        radius * Math.cos(ast.angle),
        height,
        radius * Math.sin(ast.angle)
      );
      ast.mesh.scale.setScalar(size);
      ast.size = size;

      if (delta > 0) {
        ast.mesh.rotation.x += ast.spin.x * delta;
        ast.mesh.rotation.y += ast.spin.y * delta;
        ast.mesh.rotation.z += ast.spin.z * delta;
      }
    });
  }

  cycleTarget(currentSelection, ship) {
    const majorTargets = [...this.planets, ...this.stations, ...this.tradeShips];
    if (majorTargets.length === 0) return null;

    if (ship) {
      // Calculate ship forward vector
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
      
      // Calculate dot alignment for all targets
      majorTargets.forEach(t => {
        const tPos = t.group ? t.group.position : t.mesh.position;
        const toTarget = tPos.clone().sub(ship.position).normalize();
        t.tempDot = forward.dot(toTarget);
      });
      
      // Sort: highest dot first (closest to crosshair / most focused)
      majorTargets.sort((a, b) => b.tempDot - a.tempDot);
    }

    if (!currentSelection) return majorTargets[0];

    const currentIndex = majorTargets.findIndex(t => t.name === currentSelection.name);
    if (currentIndex === -1) {
      return majorTargets[0];
    }
    const nextIndex = (currentIndex + 1) % majorTargets.length;
    return majorTargets[nextIndex];
  }

  findTargetUnderCrosshair(ship) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    
    let bestTarget = null;
    let bestDot = 0.985; // Must be within ~10 degrees of crosshair center
    
    // Check planets
    this.planets.forEach(p => {
      const pPos = p.group.position;
      const toTarget = pPos.clone().sub(ship.position);
      const dir = toTarget.clone().normalize();
      const dot = forward.dot(dir);
      
      if (dot > bestDot) {
        bestDot = dot;
        bestTarget = p;
      }
    });
    
    // Check stations
    this.stations.forEach(st => {
      const stPos = st.mesh.position;
      const toTarget = stPos.clone().sub(ship.position);
      const dir = toTarget.clone().normalize();
      const dot = forward.dot(dir);
      
      if (dot > bestDot) {
        bestDot = dot;
        bestTarget = st;
      }
    });

    // Check trade ships
    this.tradeShips.forEach(ts => {
      const tsPos = ts.mesh.position;
      const toTarget = tsPos.clone().sub(ship.position);
      const dist = toTarget.length();
      if (dist < 1200) {
        const dir = toTarget.clone().normalize();
        const dot = forward.dot(dir);
        
        if (dot > bestDot) {
          bestDot = dot;
          bestTarget = ts;
        }
      }
    });

    // Check asteroids (only within 600 units distance to avoid targeting invisible rocks light-years away)
    this.asteroids.forEach(ast => {
      const astPos = ast.mesh.position;
      const toTarget = astPos.clone().sub(ship.position);
      const dist = toTarget.length();
      if (dist < 600) {
        const dir = toTarget.clone().normalize();
        const dot = forward.dot(dir);
        
        if (dot > bestDot) {
          bestDot = dot;
          bestTarget = ast;
        }
      }
    });

    // Close to a planet its disc fills the view: aiming anywhere on it picks it (the nearest one in line)
    if (!bestTarget) {
      let nearest = Infinity;
      this.planets.forEach(p => {
        const toCenter = p.group.position.clone().sub(ship.position);
        const along = toCenter.dot(forward);
        if (along <= 0) return;
        const miss = toCenter.lengthSq() - along * along;
        if (miss < p.radius * p.radius && along < nearest) {
          nearest = along;
          bestTarget = p;
        }
      });
    }

    return bestTarget;
  }
}
