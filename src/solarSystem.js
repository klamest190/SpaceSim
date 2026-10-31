import * as THREE from 'three';

// Planetary configurations
export const PLANET_DATA = [
  {
    name: 'Sun',
    realRadius: 696340,
    realDist: 0,
    orbitPeriod: 0,
    color: 0xffaa00,
    emissive: 0xffaa00,
    rotationSpeed: 0.01,
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
    color: 0x8c8c8c,
    rotationSpeed: 0.02,
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
    color: 0xe3bb76,
    rotationSpeed: 0.005,
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
    color: 0x2b82c9,
    rotationSpeed: 0.03,
    hasAtmosphere: true,
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
    color: 0xc15c3d,
    rotationSpeed: 0.028,
    hasAtmosphere: true,
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
    color: 0xd8ca9d,
    rotationSpeed: 0.05,
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
    color: 0xe2bf7d,
    rotationSpeed: 0.045,
    hasRings: true,
    ringRadiusInner: 1.4,
    ringRadiusOuter: 2.3,
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
    color: 0x4b70dd,
    rotationSpeed: 0.035,
    hasRings: true,
    ringRadiusInner: 1.3,
    ringRadiusOuter: 1.8,
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
    color: 0x274687,
    rotationSpeed: 0.038,
    details: {
      mass: '1.024 × 10²⁶ kg (17 Erdmassen)',
      temp: '-201 °C',
      atmosphere: 'Wasserstoff (80%), Helium (19%), Methan (1.5%)',
      funFact: 'Der windigste Planet im Sonnensystem mit Überschallwinden von bis zu 2.100 km/h.'
    }
  }
];

// Fresnel atmosphere shader code
const AtmosphereShader = {
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    uniform vec3 glowColor;
    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(vViewPosition);
      // Fresnel edge intensity curve
      float intensity = pow(1.0 - abs(dot(normal, viewDir)), 3.0);
      gl_FragColor = vec4(glowColor, intensity * 0.45);
    }
  `
};

export class SolarSystem {
  constructor(scene) {
    this.scene = scene;
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
    
    // Sun light radius must be huge for realistic scales
    const sunLight = new THREE.PointLight(0xffffff, 4.5, 120000, 0.4);
    sunLight.castShadow = true;
    sunLight.shadow.bias = -0.0005;
    this.scene.add(sunLight);

    PLANET_DATA.forEach((data, index) => {
      const isSun = index === 0;
      const planetGroup = new THREE.Group();
      
      const texture = this.generateProceduralTexture(data.name, data.color);
      
      let planetMat;
      if (isSun) {
        // HDR tint (>1.0) so the sun drives the bloom pass
        planetMat = new THREE.MeshBasicMaterial({
          map: texture,
          color: new THREE.Color(2.6, 2.2, 1.7)
        });
      } else {
        const roughnessMap = this.generateProceduralRoughnessMap(data.name);
        
        let metalness = 0.05;
        let roughness = 0.8;
        if (data.name === 'Earth') {
          metalness = 0.45; // Specular highlights on oceans!
          roughness = 0.85; // Land is matte, ocean is shiny via roughnessMap
        } else if (data.name === 'Jupiter' || data.name === 'Saturn' || data.name === 'Uranus' || data.name === 'Neptune') {
          roughness = 0.9;
          metalness = 0.0;
        }
        
        planetMat = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: roughness,
          metalness: metalness,
          bumpMap: texture,
          bumpScale: 0.05,
          roughnessMap: roughnessMap
        });
      }

      const geom = new THREE.SphereGeometry(1, 32, 32);
      const mesh = new THREE.Mesh(geom, planetMat);
      
      if (!isSun) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      
      planetGroup.add(mesh);
      
      let ringsMesh = null;
      if (data.hasRings) {
        ringsMesh = this.createPlanetRings(data);
        ringsMesh.castShadow = true;
        ringsMesh.receiveShadow = true;
        planetGroup.add(ringsMesh);
      }

      let atmosphereMesh = null;
      if (data.hasAtmosphere || data.name === 'Earth' || data.name === 'Venus' || data.name === 'Neptune' || data.name === 'Mars') {
        atmosphereMesh = this.createAtmosphereGlowShader(data);
        planetGroup.add(atmosphereMesh);
      }

      let cloudsMesh = null;
      if (data.name === 'Earth') {
        const cloudGeom = new THREE.SphereGeometry(1.015, 32, 32);
        const cloudTex = this.generateEarthCloudsTexture();
        const cloudMat = new THREE.MeshStandardMaterial({
          map: cloudTex,
          transparent: true,
          opacity: 0.65,
          depthWrite: false
        });
        cloudsMesh = new THREE.Mesh(cloudGeom, cloudMat);
        planetGroup.add(cloudsMesh);
      }

      this.scene.add(planetGroup);
      
      this.planets.push({
        name: data.name,
        group: planetGroup,
        mesh: mesh,
        rings: ringsMesh,
        atmosphere: atmosphereMesh,
        clouds: cloudsMesh,
        data: data,
        angle: Math.random() * Math.PI * 2,
        orbitSpeed: data.orbitPeriod > 0 ? (2 * Math.PI) / (data.orbitPeriod * 2.5) : 0,
        currentPos: new THREE.Vector3()
      });
      
      const orbitGeom = new THREE.BufferGeometry();
      const orbitMat = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.04
      });
      const orbitLine = new THREE.LineLoop(orbitGeom, orbitMat);
      this.scene.add(orbitLine);
      this.orbitLines.push(orbitLine);
    });

    this.update(0);
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
      const metalMat = new THREE.MeshStandardMaterial({ color: 0x5a636e, roughness: 0.3, metalness: 0.8 });
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
      const panelMat = new THREE.MeshStandardMaterial({ color: 0x0033aa, roughness: 0.1, metalness: 0.9 });
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
      orbitOffset: 0.12, // orbits close to surface in physical coords
      orbitAngle: 0.0,
      orbitSpeed: 0.58
    });

    const marsStationMesh = createStationMesh(0xffaa00);
    this.scene.add(marsStationMesh);
    this.stations.push({
      name: 'Mars Außenposten',
      kind: 'station',
      planetIndex: 4,
      mesh: marsStationMesh,
      orbitOffset: 0.08, // orbits Mars close
      orbitAngle: Math.PI,
      orbitSpeed: 0.75
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
      { name: 'HÄNDLER-FRIGATTE MERC-01', planetIndex: 3, localAngle: 0.0, orbitRadiusFactor: 2.3, inclinationOffset: 0.1, orbitSpeed: 0.14 },
      { name: 'HÄNDLER-FRIGATTE MERC-02', planetIndex: 3, localAngle: Math.PI, orbitRadiusFactor: 3.2, inclinationOffset: -0.2, orbitSpeed: -0.10 },
      { name: 'HÄNDLER-FRIGATTE MERC-03', planetIndex: 4, localAngle: 0.5, orbitRadiusFactor: 2.1, inclinationOffset: 0.25, orbitSpeed: 0.18 },
      { name: 'HÄNDLER-FRIGATTE MERC-04', planetIndex: 4, localAngle: Math.PI * 1.5, orbitRadiusFactor: 2.9, inclinationOffset: -0.15, orbitSpeed: -0.12 }
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

  createPlanetRings(data) {
    const inner = data.ringRadiusInner;
    const outer = data.ringRadiusOuter;
    
    const ringGeom = new THREE.RingGeometry(inner, outer, 64);
    ringGeom.rotateX(Math.PI / 2);
    
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    
    const grad = ctx.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.1, 'rgba(195, 175, 140, 0.4)');
    grad.addColorStop(0.3, 'rgba(165, 145, 110, 0.6)');
    grad.addColorStop(0.5, 'rgba(100, 90, 80, 0.2)');
    grad.addColorStop(0.7, 'rgba(165, 145, 110, 0.5)');
    grad.addColorStop(0.9, 'rgba(195, 175, 140, 0.2)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 1);
    
    const ringTex = new THREE.CanvasTexture(canvas);
    
    const ringMat = new THREE.MeshStandardMaterial({
      map: ringTex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      roughness: 0.6
    });
    
    const mesh = new THREE.Mesh(ringGeom, ringMat);
    return mesh;
  }

  createAtmosphereGlowShader(data) {
    const atmGeom = new THREE.SphereGeometry(1.08, 32, 32);
    
    let colorHex = 0x00f0ff;
    if (data.name === 'Mars') colorHex = 0xff5500;
    if (data.name === 'Venus') colorHex = 0xffd0a0;
    
    const colorVec = new THREE.Color(colorHex);
    
    const atmMat = new THREE.ShaderMaterial({
      vertexShader: AtmosphereShader.vertexShader,
      fragmentShader: AtmosphereShader.fragmentShader,
      uniforms: {
        glowColor: { value: new THREE.Vector3(colorVec.r, colorVec.g, colorVec.b) }
      },
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });
    
    const mesh = new THREE.Mesh(atmGeom, atmMat);
    return mesh;
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

  generateProceduralTexture(name, baseHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const colorStr = '#' + baseHex.toString(16).padStart(6, '0');
    
    ctx.fillStyle = colorStr;
    ctx.fillRect(0, 0, 512, 256);
    
    if (name === 'Sun') {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#ffcc00');
      grad.addColorStop(0.5, '#ff4400');
      grad.addColorStop(1, '#990000');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 256);

      const noiseLow = this.generateNoiseCanvas(16, 8, 100, 255);
      const noiseMid = this.generateNoiseCanvas(64, 32, 50, 200);
      
      ctx.save();
      ctx.globalCompositeOperation = 'color-dodge';
      ctx.globalAlpha = 0.35;
      ctx.drawImage(noiseLow, 0, 0, 512, 256);
      ctx.globalAlpha = 0.2;
      ctx.drawImage(noiseMid, 0, 0, 512, 256);
      ctx.restore();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.25;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(0, Math.random() * 256);
        ctx.bezierCurveTo(128, Math.random() * 256, 384, Math.random() * 256, 512, Math.random() * 256);
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
    } 
    else if (name === 'Mercury') {
      ctx.fillStyle = '#4c4c4c';
      ctx.fillRect(0, 0, 512, 256);

      const noiseLow = this.generateNoiseCanvas(32, 16, 0, 80);
      const noiseMid = this.generateNoiseCanvas(128, 64, 0, 40);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.4;
      ctx.drawImage(noiseLow, 0, 0, 512, 256);
      ctx.globalAlpha = 0.3;
      ctx.drawImage(noiseMid, 0, 0, 512, 256);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.45;
      for (let i = 0; i < 65; i++) {
        const cx = Math.random() * 512;
        const cy = Math.random() * 256;
        const cr = Math.random() * 7 + 1.5;

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx - 0.5, cy - 0.5, cr, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx + 0.5, cy + 0.5, cr, 0, Math.PI * 2);
        ctx.stroke();

        if (cr > 5.5) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.lineWidth = 0.5;
          const rayCount = 6 + Math.floor(Math.random() * 6);
          for (let r = 0; r < rayCount; r++) {
            const angle = (r / rayCount) * Math.PI * 2 + Math.random() * 0.3;
            const len = Math.random() * 45 + 15;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    } 
    else if (name === 'Venus') {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#e5be8a');
      grad.addColorStop(0.5, '#c59d64');
      grad.addColorStop(1, '#a17a42');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 256);

      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = '#ffeec2';
      ctx.lineWidth = 8;
      for (let i = 0; i < 12; i++) {
        ctx.beginPath();
        ctx.moveTo(0, Math.random() * 256);
        ctx.bezierCurveTo(170, Math.random() * 256, 340, Math.random() * 256, 512, Math.random() * 256);
        ctx.stroke();
      }
      
      const noise = this.generateNoiseCanvas(64, 32, 120, 230);
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.25;
      ctx.drawImage(noise, 0, 0, 512, 256);
      ctx.restore();
    } 
    else if (name === 'Earth') {
      const oceanGrad = ctx.createRadialGradient(256, 128, 50, 256, 128, 250);
      oceanGrad.addColorStop(0, '#124c8c');
      oceanGrad.addColorStop(1, '#08254b');
      ctx.fillStyle = oceanGrad;
      ctx.fillRect(0, 0, 512, 256);

      const drawContinents = (c) => {
        c.beginPath();
        c.moveTo(220, 40); c.lineTo(320, 35); c.lineTo(390, 50); c.lineTo(440, 80);
        c.lineTo(430, 140); c.lineTo(370, 160); c.lineTo(320, 130); c.lineTo(260, 170);
        c.lineTo(290, 220); c.lineTo(260, 240); c.lineTo(210, 200); c.lineTo(230, 130);
        c.lineTo(190, 110); c.lineTo(190, 60); c.closePath();

        c.moveTo(50, 45); c.lineTo(140, 50); c.lineTo(120, 95); c.lineTo(100, 110);
        c.lineTo(70, 125); c.lineTo(55, 90); c.closePath();

        c.moveTo(95, 135); c.lineTo(125, 145); c.lineTo(145, 175); c.lineTo(110, 235);
        c.lineTo(90, 245); c.lineTo(85, 205); c.closePath();

        c.moveTo(410, 185); c.lineTo(460, 190); c.lineTo(455, 225); c.lineTo(405, 215);
        c.closePath();
      };

      ctx.save();
      ctx.fillStyle = '#2d5e20';
      drawContinents(ctx);
      ctx.fill();

      ctx.clip();
      
      ctx.fillStyle = '#c9b078';
      ctx.beginPath();
      ctx.ellipse(245, 120, 45, 20, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(290, 95, 30, 15, 0.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#dddddd';
      ctx.fillRect(0, 0, 512, 50);
      
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 512, 20);
      ctx.fillRect(0, 238, 512, 18);

      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 15; i++) {
        const cx = Math.random() * 512;
        const cy = Math.random() * 160 + 40;
        const r = Math.random() * 25 + 10;
        
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 2.2, r * 0.55, -0.1, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineWidth = Math.random() * 3 + 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 0.85);
        ctx.stroke();
      }
      ctx.restore();
    } 
    else if (name === 'Mars') {
      ctx.fillStyle = '#b7563c';
      ctx.fillRect(0, 0, 512, 256);

      const desertNoise = this.generateNoiseCanvas(16, 8, 40, 100);
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(desertNoise, 0, 0, 512, 256);
      ctx.restore();

      ctx.fillStyle = '#7a3b2a';
      ctx.beginPath();
      ctx.ellipse(280, 130, 60, 45, 0.5, 0, Math.PI * 2);
      ctx.ellipse(120, 160, 70, 30, -0.2, 0, Math.PI * 2);
      ctx.fill();

      // Craters on Mars
      ctx.fillStyle = '#512217';
      ctx.globalAlpha = 0.35;
      for (let i = 0; i < 15; i++) {
        const cx = Math.random() * 512;
        const cy = 30 + Math.random() * 196;
        const cr = Math.random() * 8 + 3;
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.arc(cx + 0.5, cy + 0.5, cr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.35;
      }
      ctx.globalAlpha = 1.0;

      const midNoise = this.generateNoiseCanvas(64, 32, 150, 210);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.22;
      ctx.drawImage(midNoise, 0, 0, 512, 256);
      ctx.restore();

      // Polar Ice Caps
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.ellipse(256, 0, 150, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(256, 256, 110, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    } 
    else if (name === 'Jupiter') {
      for (let y = 0; y < 256; y += 4) {
        const sinVal = Math.sin(y / 12);
        if (y < 45 || y > 210) {
          ctx.fillStyle = y % 8 < 4 ? '#b09477' : '#997c5f';
        } else {
          ctx.fillStyle = sinVal > 0.4 ? '#d6b696' : sinVal < -0.3 ? '#8f6343' : '#c98e61';
        }
        ctx.fillRect(0, y, 512, 4);
      }

      // Add atmospheric storm noise turbulence
      const jupNoise = this.generateNoiseCanvas(128, 64, 80, 180);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.35;
      ctx.drawImage(jupNoise, 0, 0, 512, 256);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#6e4428';
      for (let i = 0; i < 6; i++) {
        const y = 80 + i * 20;
        ctx.beginPath();
        for (let x = 0; x <= 512; x += 16) {
          const dy = Math.sin(x / 16 + i) * 6;
          ctx.lineTo(x, y + dy);
        }
        ctx.lineTo(512, y + 15);
        ctx.lineTo(0, y + 15);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      ctx.fillStyle = '#a62419';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      
      const rx = 340;
      const ry = 160;
      ctx.save();
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.ellipse(rx, ry, 26, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.ellipse(rx, ry, 18, 9, 0.1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(rx, ry, 10, 5, -0.1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.ellipse(120 + i * 40, 195, 4.5, 3.0, 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
    } 
    else if (name === 'Saturn') {
      for (let y = 0; y < 256; y += 4) {
        ctx.fillStyle = y % 32 < 16 ? '#e8cfad' : '#dbbe95';
        ctx.fillRect(0, y, 512, 4);
      }
      // Add bands soft noise overlay
      const satNoise = this.generateNoiseCanvas(64, 32, 100, 160);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.18;
      ctx.drawImage(satNoise, 0, 0, 512, 256);
      ctx.restore();

      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(0, 115, 512, 12);
    } 
    else if (name === 'Uranus') {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#75adff');
      grad.addColorStop(0.5, '#5b98f2');
      grad.addColorStop(1, '#4484dd');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 256);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(0, 210, 512, 20);
    } 
    else if (name === 'Neptune') {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#1a3e8c');
      grad.addColorStop(0.5, '#153375');
      grad.addColorStop(1, '#0e2457');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 256);

      ctx.fillStyle = '#0a1d47';
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(180, 150, 20, 12, -0.15, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(150, 153);
      ctx.bezierCurveTo(180, 165, 210, 163, 230, 158);
      ctx.stroke();

      // Methane storm bands (white cirrus clouds) on Neptune
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const y = 50 + i * 60 + Math.random() * 20;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(128, y - 10, 384, y + 10, 512, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  generateProceduralRoughnessMap(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    // Default to relatively rough
    ctx.fillStyle = '#dddddd';
    ctx.fillRect(0, 0, 256, 128);

    if (name === 'Earth') {
      // Earth oceans are shiny/smooth (low roughness -> dark gray/black)
      ctx.fillStyle = '#222222';
      ctx.fillRect(0, 0, 256, 128);
      
      // Earth landmasses are rough (high roughness -> white/light gray)
      ctx.fillStyle = '#eeeeee';
      ctx.beginPath();
      ctx.moveTo(125, 20); ctx.lineTo(190, 25); ctx.lineTo(220, 50); ctx.lineTo(205, 75);
      ctx.lineTo(145, 80); ctx.lineTo(120, 50); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(30, 25); ctx.lineTo(65, 30); ctx.lineTo(50, 60); ctx.lineTo(60, 90);
      ctx.lineTo(80, 115); ctx.lineTo(45, 120); ctx.lineTo(30, 60); ctx.closePath(); ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  generateEarthCloudsTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Clear transparent
    ctx.clearRect(0, 0, 512, 256);
    
    // Generate organic cloud shapes using value noise overlay
    const cloudNoise = this.generateNoiseCanvas(64, 32, 0, 255);
    ctx.drawImage(cloudNoise, 0, 0, 512, 256);
    
    // Apply composite operations to make it look like wispy clouds (cut off dark values)
    const imgData = ctx.getImageData(0, 0, 512, 256);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const val = imgData.data[i];
      if (val < 115) {
        imgData.data[i + 3] = 0; // make transparent
      } else {
        imgData.data[i] = 255;
        imgData.data[i + 1] = 255;
        imgData.data[i + 2] = 255;
        imgData.data[i + 3] = Math.round((val - 115) * 1.6);
      }
    }
    ctx.putImageData(imgData, 0, 0);
    
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
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

    if (shipPos && this.skyGroup) {
      this.skyGroup.position.copy(shipPos);
    }

    // 1. Update Planets positions
    this.planets.forEach((p, index) => {
      const isSun = index === 0;

      if (delta > 0 && !isSun) {
        // Slow down planetary orbits for smoother gameplay/docking
        const speedMultiplier = 0.08;
        p.angle += p.orbitSpeed * delta * speedMultiplier;
      }

      let r = 0;
      if (!isSun) {
        r = p.data.realDist * scale.distScale;
        if (this.scaleMode === 'orrery') {
          r = 15 + index * 8;
        } else if (this.scaleMode === 'visual') {
          r = Math.max(12, r); // Keep minimum orbit spacing only in visual mode
        }
      }

      const prevX = p.currentPos.x;
      const prevZ = p.currentPos.z;
      p.currentPos.set(
        r * Math.cos(p.angle),
        0,
        r * Math.sin(p.angle)
      );

      // Orbital velocity: the ship's stabilizer and station departures fly relative to this
      if (!p.velocity) p.velocity = new THREE.Vector3();
      if (delta > 0) p.velocity.set((p.currentPos.x - prevX) / delta, 0, (p.currentPos.z - prevZ) / delta);

      p.group.position.copy(p.currentPos);

      let finalRadius = 1;
      if (isSun) {
        if (this.scaleMode === 'realistic') {
          finalRadius = 6.96340;
        } else if (this.scaleMode === 'arcade') {
          finalRadius = 45.0; // Big visible Sun in arcade
        } else if (this.scaleMode === 'orrery') {
          finalRadius = 6.0;
        } else {
          finalRadius = 10.0;
        }
      } else {
        if (this.scaleMode === 'visual') {
          finalRadius = Math.max(scale.minSize, Math.log10(p.data.realRadius) * scale.sizeScale * 450);
        } else if (this.scaleMode === 'orrery') {
          finalRadius = Math.max(scale.minSize, Math.log10(p.data.realRadius) * scale.sizeScale * 350);
        } else if (this.scaleMode === 'arcade') {
          // Power law sizing for satisfying arcade proportion (Jupiter is big, Earth is visible)
          finalRadius = Math.max(scale.minSize, Math.pow(p.data.realRadius, 0.4) * 0.15);
        } else {
          // Realistic scale: size in units (e.g. Earth = 6371 * 0.00001 = 0.0637)
          finalRadius = Math.max(scale.minSize, p.data.realRadius * scale.sizeScale);
        }
      }

      p.mesh.scale.setScalar(finalRadius);

      if (p.atmosphere) {
        p.atmosphere.scale.setScalar(1.08);
      }

      if (p.rings) {
        p.rings.scale.setScalar(finalRadius);
      }

      if (p.clouds) {
        p.clouds.scale.setScalar(finalRadius * 1.015);
        if (delta > 0) {
          p.clouds.rotation.y += p.data.rotationSpeed * 0.15 * delta;
        }
      }

      const orbitLine = this.orbitLines[index];
      if (isSun) {
        orbitLine.visible = false;
      } else {
        orbitLine.visible = true;
        const points = [];
        const segments = 128;
        for (let i = 0; i <= segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          points.push(new THREE.Vector3(r * Math.cos(theta), 0, r * Math.sin(theta)));
        }
        orbitLine.geometry.setFromPoints(points);
      }

      p.mesh.rotation.y += p.data.rotationSpeed * 0.15;
    });

    // 2. Update Space Stations orbits dynamically outside planet atmosphere
    this.stations.forEach(st => {
      const parentPlanet = this.planets[st.planetIndex];
      if (!parentPlanet) return;
      
      if (delta > 0) {
        st.orbitAngle += st.orbitSpeed * delta;
      }

      // Station orbits just outside parent planet radius
      const parentRadius = parentPlanet.mesh.scale.x;
      const orbitOffset = parentRadius * 1.5; // proportional to mesh size

      const offsetPos = new THREE.Vector3(
        orbitOffset * Math.cos(st.orbitAngle),
        orbitOffset * 0.25 * Math.sin(st.orbitAngle),
        orbitOffset * Math.sin(st.orbitAngle)
      );

      st.mesh.position.copy(parentPlanet.group.position).add(offsetPos);
      st.mesh.rotation.y += 0.005;

      // Dynamic station scaling based on scale mode
      if (this.scaleMode === 'realistic') {
        st.mesh.scale.setScalar(0.45);
      } else if (this.scaleMode === 'arcade') {
        st.mesh.scale.setScalar(2.0);
      } else if (this.scaleMode === 'orrery') {
        st.mesh.scale.setScalar(1.5);
      } else {
        st.mesh.scale.setScalar(3.0);
      }
    });

    // 2.5. Update Trade Ships orbits dynamically around their parent planets
    this.tradeShips.forEach(ts => {
      const parentPlanet = this.planets[ts.planetIndex];
      if (!parentPlanet) return;

      if (delta > 0) {
        ts.localAngle += ts.orbitSpeed * delta;
      }

      // Orbit radius proportional to planet mesh scale size
      const parentRadius = parentPlanet.mesh.scale.x;
      const orbitOffset = parentRadius * ts.orbitRadiusFactor;

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
    
    return bestTarget;
  }
}
