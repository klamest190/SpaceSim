import * as THREE from 'three';
import { PlanetBody } from './planets';
import { StationVisual } from './stationModels';
import { STATION_DEFS, FIELD_DEFS } from './world';
import { rng } from './shipModel';
import { buildRockShapes, makeRockMaterials, makeRock, dressField } from './asteroids';
import { createSkySphere, galacticDir, equatorialToGame } from './sky';
import { BSC_COUNT, BSC_DATA } from './starCatalog';
import { IoPlumes } from './moons';
import { Aurorae } from './aurora';

// Orbits keep their true spacing (1 unit = 100.000 km); bodies are drawn far larger than true scale,
// so a ship of 2 units is tiny beside them and planets read as worlds from afar.
const DIST_SCALE = 10.0;
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

// Moons, after the planets in the same list. Drawn far larger and closer than true scale like the planets, but
// in their real order and with the 1:2 rhythm of Io and Europa. orbit: distance from the planet's centre (units);
// period: seconds per orbit; plane: the planet's equator (most moons) or the ecliptic (Earth's Moon), tipped by
// incl degrees. All are tidally locked: the same face always looks at their planet.
export const MOON_DATA = [
  {
    name: 'Moon',
    parent: 'Earth',
    realRadius: 1737.4,
    radius: 46,
    orbit: 520,
    period: 1600,
    plane: 'ecliptic',
    incl: 5.1,
    node: 0.6,
    gravity: 0.35,
    light: 1.0,
    bump: 5,
    texWidth: 2048,
    umbraTint: [0.1, 0.028, 0.01], // sunsets all round the Earth light the eclipsed Moon copper-red
    details: {
      mass: '7,342 × 10²² kg (0,012 Erdmassen)',
      temp: '-173 °C bis 127 °C',
      atmosphere: 'Praktisch keine',
      funFact: 'Zeigt der Erde immer dieselbe Seite. Die dunklen Maria sind erstarrte Lavaseen, die hellen Hochländer über 4 Milliarden Jahre alt.'
    }
  },
  {
    name: 'Io',
    parent: 'Jupiter',
    realRadius: 1821.6,
    radius: 50,
    orbit: 1400,
    period: 2900,
    plane: 'equator',
    incl: 0.05,
    gravity: 0.4,
    light: 1.0,
    bump: 4,
    texWidth: 2048,
    auxMap: 2048,
    umbraTint: [0.008, 0.003, 0.002],
    details: {
      mass: '8,93 × 10²² kg (0,015 Erdmassen)',
      temp: '-143 °C, Lavaseen bis 1.600 °C',
      atmosphere: 'Hauchdünn, Schwefeldioxid',
      funFact: 'Der vulkanisch aktivste Körper im Sonnensystem: über 400 Vulkane, geknetet von Jupiters Gezeiten. Seine Fontänen steigen bis 400 km hoch.'
    }
  },
  {
    name: 'Europa',
    parent: 'Jupiter',
    realRadius: 1560.8,
    radius: 46,
    orbit: 1820,
    period: 5800,
    plane: 'equator',
    incl: 0.47,
    node: 2.1,
    gravity: 0.32,
    light: 1.0,
    bump: 3,
    texWidth: 2048,
    umbraTint: [0.008, 0.003, 0.002],
    details: {
      mass: '4,80 × 10²² kg (0,008 Erdmassen)',
      temp: '-160 °C (Äquator) bis -220 °C (Pole)',
      atmosphere: 'Hauchdünn, Sauerstoff',
      funFact: 'Unter dem Eispanzer liegt ein Salzwasser-Ozean mit mehr Wasser als alle Meere der Erde. Io, Europa und Ganymed umrunden Jupiter im Takt 1:2:4.'
    }
  },
  {
    name: 'Titan',
    parent: 'Saturn',
    realRadius: 2574.7,
    radius: 70,
    orbit: 2500,
    period: 9000,
    plane: 'equator',
    incl: 0.35,
    node: 4.0,
    gravity: 0.36,
    light: 1.0,
    texWidth: 1024,
    // Orange smog of tholins that swallows blue light, under a thin blue haze high above it
    atmosphere: {
      thickness: 0.2, hR: 0.6, hM: 0.32, tauR: [0.012, 0.03, 0.09], tauM: 2.5, g: 0.45, sunE: 30,
      mieCol: [1.0, 0.74, 0.34], mieExt: [1.1, 1.4, 2.3], steps: 40
    },
    details: {
      mass: '1,35 × 10²³ kg (0,023 Erdmassen)',
      temp: '-179 °C',
      atmosphere: 'Stickstoff (95 %), Methan (5 %), anderthalbfacher Erddruck',
      funFact: 'Der einzige Mond mit dichter Lufthülle. Oranger Smog verhüllt Seen aus flüssigem Methan und Ethan, und es regnet Methan.'
    }
  }
];

const SUN_INTENSITY = 2.6;

// Average colour of each body's sunlit face, for the light it reflects onto nearby ships
const FILL_TINT = {
  Mercury: 0x9a948c, Venus: 0xe0c89a, Earth: 0x8fb0e0, Mars: 0xc07850,
  Jupiter: 0xd8c0a0, Saturn: 0xe0d0a8, Uranus: 0xa8e0e8, Neptune: 0x6f8fe8,
  Moon: 0x9c9a94, Io: 0xd8c070, Europa: 0xd8d0c0, Titan: 0xd09040,
};

// The stars: round soft points, sized and lit by magnitude; uGain is the eyes' adaptation. They never twinkle:
// there is no air out here to make them.
const STAR_DISTANCE = 120000;
const STAR_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aColor;
attribute float aSize;
uniform float uGain;
uniform float uPx;
varying vec3 vCol;
varying float vSize;
void main() {
  vCol = aColor * uGain;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Faint stars shrink as well as fade when the eyes are dazzled
  gl_PointSize = max(1.0, aSize * uPx * clamp(0.55 + 0.45 * uGain, 0.6, 1.2));
  vSize = gl_PointSize;
  #include <logdepthbuf_vertex>
}
`;
const STAR_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying vec3 vCol;
varying float vSize;
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  // A pixel or two: flat, so the light is not lost; bigger stars get a bright core and a soft halo
  float a = mix(1.0, exp(-r2 * 2.5), smoothstep(2.0, 4.5, vSize));
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

// Colour of a star's light from its surface temperature (a blackbody fit), in linear RGB with the brightest channel
// at 1. A little more colour than the naked eye sees, as on a photograph: red giants orange, hot stars blue.
function starColor(kelvin, out) {
  const t = kelvin / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708 * Math.log(t) - 161.1196;
    b = t <= 19 ? 0 : 138.5177 * Math.log(t - 10) - 305.0448;
  } else {
    r = 329.6987 * Math.pow(t - 60, -0.1332);
    g = 288.1222 * Math.pow(t - 60, -0.0755);
    b = 255;
  }
  const c01 = (v) => THREE.MathUtils.clamp(v / 255, 0, 1);
  out.setRGB(c01(r), c01(g), c01(b), THREE.SRGBColorSpace);
  const avg = (out.r + out.g + out.b) / 3;
  out.r = Math.max(0, avg + (out.r - avg) * 1.35);
  out.g = Math.max(0, avg + (out.g - avg) * 1.35);
  out.b = Math.max(0, avg + (out.b - avg) * 1.35);
  const max = Math.max(out.r, out.g, out.b, 1e-6);
  return out.multiplyScalar(1 / max);
}

const _off = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _tint = new THREE.Color();

export function atmosphereTop(p) {
  return p.body.atmosphereTop;
}

// Bodies with a ground to fly over (see surface.js), and how deep into the atmosphere the dive goes before
// the ship hands over to atmospheric flight: halfway through the shell, or this close over airless ground
const SURFACE_WORLDS = new Set(['Mercury', 'Venus', 'Earth', 'Mars']);
const SURFACE_ENTRY_DEPTH = 0.5;
const SURFACE_ENTRY_AIRLESS = 0.03;

// Distance from a planet's centre at which a dive turns into atmospheric flight; null for bodies without ground
export function surfaceEntryRadius(p) {
  if (!SURFACE_WORLDS.has(p.name) || !p.body) return null;
  const top = p.body.atmosphereTop;
  if (top > p.radius) return top - (top - p.radius) * SURFACE_ENTRY_DEPTH;
  return p.radius * (1 + SURFACE_ENTRY_AIRLESS);
}

// Closest a ship may come to a planet's centre: into the upper atmosphere, or just above airless ground.
// Over a ground the dive hands over to atmospheric flight before this is reached.
export function flightFloor(p) {
  const entry = surfaceEntryRadius(p);
  if (entry) return p.radius + (entry - p.radius) * 0.6;
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
    
    // Lock to arcade scaling mode
    this.scaleMode = 'arcade'; 
    
    this.setupSolarSystem();
    this.setupAsteroidBelt();
    this.setupSpaceStations();
  }

  // How much the law reaches a point: full next to a secure station, fading with distance
  securityAt(pos) {
    let best = 0.03;
    this.stations.forEach((st) => {
      const d = st.mesh.position.distanceTo(pos);
      const reach = 1 - THREE.MathUtils.smoothstep(d, 900, 3400);
      best = Math.max(best, st.security * reach);
    });
    return best;
  }

  nearestStation(pos, filter = null) {
    let best = null, bestD = Infinity;
    this.stations.forEach((st) => {
      if (filter && !filter(st)) return;
      const d = st.mesh.position.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = st; }
    });
    return best;
  }

  // Move a point out of any planet or station it would be inside
  pushClear(pos, margin = 30) {
    this.planets.forEach((p) => {
      const safe = (p.name === 'Sun' ? p.radius * 1.5 : p.body.atmosphereTop) + margin;
      const offset = pos.clone().sub(p.group.position);
      if (offset.length() < safe) pos.copy(p.group.position).add(offset.setLength(safe));
    });
    this.stations.forEach((st) => {
      const safe = st.size + margin;
      const offset = pos.clone().sub(st.mesh.position);
      if (offset.length() < safe) pos.copy(st.mesh.position).add(offset.setLength(safe));
    });
    return pos;
  }

  setupSolarSystem() {
    this.skyGroup = new THREE.Group();
    this.scene.add(this.skyGroup);

    // The Milky Way, nebulae and faint stars baked into one sky map; bright stars and far galaxies on top
    this.skyGroup.add(createSkySphere(this.renderer));
    this.createStarfield();
    this.createGalaxies();
    this.skyAdapt = 1;
    this.skyThrough = 1;

    const ambientLight = new THREE.AmbientLight(0x0f1422, 1.2);
    this.scene.add(ambientLight);

    // Sunlight for ships, stations and rocks (the planets light themselves in their shaders): parallel rays
    // from the Sun towards wherever the ship is, equally strong at Mercury and Neptune
    this.sunLight = new THREE.DirectionalLight(0xfff4e6, SUN_INTENSITY);
    this.sunVisibility = 1; // 0 in a planet's shadow, soft through the penumbra
    this.sunLight.position.set(0, 0, 0);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Light thrown back by the nearest planet's day side onto the ship's shadowed side
    this.fillLight = new THREE.DirectionalLight(0xffffff, 0);
    this.scene.add(this.fillLight);
    this.scene.add(this.fillLight.target);

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

    this.setupMoons();
    this.aurorae = new Aurorae(this);
    this.auroraStorm = {};
    this.update(0);
  }

  setupMoons() {
    MOON_DATA.forEach((data, k) => {
      const parent = this.planets.find((p) => p.name === data.parent);
      const body = new PlanetBody(this.renderer, data, 300 + k * 23.0);
      this.scene.add(body.group);
      // Orbit plane: the planet's equator, or the ecliptic for Earth's Moon, tipped by the inclination
      const plane = new THREE.Quaternion();
      if (data.plane === 'equator') plane.copy(parent.body.tilt.quaternion);
      const node = new THREE.Vector3(Math.cos(data.node || 0), 0, Math.sin(data.node || 0));
      plane.multiply(new THREE.Quaternion().setFromAxisAngle(node, THREE.MathUtils.degToRad(data.incl || 0)));
      // The moon spins about its orbit's axis, once per orbit
      body.tilt.quaternion.copy(plane);
      const moon = {
        name: data.name,
        group: body.group,
        mesh: body.mesh,
        rings: null,
        atmosphere: body.atmosphere || null,
        clouds: null,
        body,
        radius: data.radius,
        data,
        parent,
        plane,
        orbitRadius: data.orbit,
        rate: (2 * Math.PI) / data.period,
        angle: Math.random() * Math.PI * 2,
        currentPos: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
      };
      this.planets.push(moon);
      (parent.moons = parent.moons || []).push(moon);

      // A faint orbit ring, carried along with the planet
      const points = [];
      for (let i = 0; i < 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        points.push(new THREE.Vector3(data.orbit * Math.cos(a), 0, -data.orbit * Math.sin(a)));
      }
      moon.orbitLine = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.05, depthWrite: false })
      );
      moon.orbitLine.quaternion.copy(plane);
      this.scene.add(moon.orbitLine);

      if (data.name === 'Io') {
        this.ioPlumes = new IoPlumes(body);
        this.ioMoon = moon;
      }
    });

    // Who can eclipse whom: a planet's moons darken the planet, the planet and sibling moons darken a moon
    this.planets.forEach((p) => {
      if (p.name === 'Sun') return;
      p.casters = p.parent ? [p.parent, ...p.parent.moons.filter((m) => m !== p)] : (p.moons || []);
    });
  }

  // A moon on its circle around its planet, turning so the same face looks at the planet
  updateMoon(m, delta) {
    if (delta > 0) m.angle += m.rate * delta;
    const r = m.orbitRadius;
    _off.set(r * Math.cos(m.angle), 0, -r * Math.sin(m.angle)).applyQuaternion(m.plane);
    m.currentPos.copy(m.parent.group.position).add(_off);
    m.group.position.copy(m.currentPos);
    _vel.set(-Math.sin(m.angle), 0, -Math.cos(m.angle)).multiplyScalar(r * m.rate).applyQuaternion(m.plane);
    m.velocity.copy(m.parent.velocity).add(_vel);
    m.body.update(delta, this.time);
    m.body.mesh.rotation.y = m.angle + Math.PI;
    m.orbitLine.position.copy(m.parent.group.position);
  }

  // The body whose gravity field holds a point: the nearest one within reach (a moon before its planet)
  frameBodyAt(pos, reach = 4) {
    let best = null;
    let bestDist = Infinity;
    this.planets.forEach((p) => {
      const d = p.group.position.distanceTo(pos);
      if (p.velocity && d < p.radius * reach && d < bestDist) {
        best = p;
        bestDist = d;
      }
    });
    return best;
  }

  // The planet's day side as a lamp for its moon: brighter the closer it is and the more of its lit face the moon sees
  updatePlanetshine(m) {
    const u = m.body.uniforms;
    const toParent = _off.copy(m.parent.group.position).sub(m.group.position);
    const dist = toParent.length();
    u.uShineDir.value.copy(toParent).divideScalar(dist);
    const parentToSun = _vel.copy(m.parent.group.position).negate().normalize();
    const phase = 0.5 * (1 - u.uShineDir.value.dot(parentToSun));
    const k = 2.2 * (m.parent.radius / dist) ** 2 * phase;
    const tint = _tint.set(FILL_TINT[m.parent.name] || 0xb0b8c8);
    u.uShineCol.value.set(tint.r * k, tint.g * k, tint.b * k);
  }

  // Right before rendering: the planets' shaders work in planet-local space around the camera
  updateView(camera) {
    this.planets.forEach((p) => {
      if (!p.casters) return;
      if (p.parent) this.updatePlanetshine(p);
      const slots = p.body.uniforms.uCasters.value;
      for (let i = 0; i < slots.length; i++) {
        const c = p.casters[i];
        if (c) slots[i].set(c.group.position.x - p.group.position.x, c.group.position.y - p.group.position.y, c.group.position.z - p.group.position.z, c.radius);
        else slots[i].set(0, 0, 0, 0);
      }
    });
    this.planets.forEach(p => p.body.updateView(camera));
    this.aurorae.update(this.time, this.auroraStorm);
    if (this.ioPlumes) {
      this.ioPlumes.update(camera, this.time, this.renderer, this.sunVisibilityAt(this.ioMoon.group.position, this.ioMoon));
    }
  }

  // Asteroid fields: dense clusters of real rocks to fly through and mine, plus a faint dust band marking the belt
  setupAsteroidBelt() {
    this.asteroidGroup = new THREE.Group();
    this.scene.add(this.asteroidGroup);

    // Rock shapes with three levels of detail each, shared by all rocks; plain rock, ice-rich (worth ice) and
    // metal-rich (worth ore)
    const shapes = buildRockShapes(8);
    this.rockMaterials = makeRockMaterials();

    let id = 0;
    FIELD_DEFS.forEach((field, fi) => {
      const rand = rng(900 + fi * 31);
      const center = new THREE.Vector3(Math.cos(field.angle) * field.orbitRadius, 0, Math.sin(field.angle) * field.orbitRadius);
      field.center = center;
      for (let i = 0; i < field.count; i++) {
        // Clustered: most rocks near the middle, a flattened disc
        const r = field.spread * Math.sqrt(rand()) * (0.25 + rand() * 0.75);
        const a = rand() * Math.PI * 2;
        const offset = new THREE.Vector3(Math.cos(a) * r, (rand() - 0.5) * field.spread * 0.18, Math.sin(a) * r);
        const size = 1.2 + 26 * rand() ** 3.2;
        const roll = rand();
        const kind = roll < 0.55 ? 'rock' : roll < 0.78 ? 'ice' : 'ore';
        const mesh = makeRock(shapes[Math.floor(rand() * shapes.length)], this.rockMaterials[kind], size);
        mesh.position.copy(center).add(offset);
        mesh.rotation.set(rand() * 6, rand() * 6, rand() * 6);
        this.asteroidGroup.add(mesh);
        this.asteroids.push({
          name: `ASTEROID-${++id}`, kind: 'asteroid', mesh, size, rockKind: kind, hp: size * 9, maxHp: size * 9,
          spin: new THREE.Vector3((rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3).multiplyScalar(4 / (2 + size)),
          field: field.name,
        });
      }
      this.asteroidGroup.add(dressField(field, center, shapes, this.rockMaterials, 7000 + fi * 13));
    });

    // The belt from afar: a band of faint dust points around the Sun
    const count = 5000;
    const pts = new Float32Array(count * 3);
    const rand = rng(4242);
    for (let i = 0; i < count; i++) {
      const r = 3300 + rand() * 1500;
      const a = rand() * Math.PI * 2;
      pts[i * 3] = Math.cos(a) * r;
      pts[i * 3 + 1] = (rand() - 0.5) * (rand() - 0.5) * 900;
      pts[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.beltDust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x8a7e70, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.2, depthWrite: false }));
    this.scene.add(this.beltDust);
  }

  // A rock broken by mining: gone from the field (it grows back after a while somewhere out of sight)
  removeAsteroid(ast) {
    const i = this.asteroids.indexOf(ast);
    if (i === -1) return;
    this.asteroids.splice(i, 1);
    this.asteroidGroup.remove(ast.mesh);
  }

  setupSpaceStations() {
    STATION_DEFS.forEach((def, i) => {
      const visual = new StationVisual(def, this.renderer, i * 7 + 3);
      // Stations named after a moon circle that moon; planetIndex then points at the moon in the body list
      const bodyIndex = def.moon ? this.planets.findIndex((p) => p.name === def.moon) : def.planetIndex;
      const parent = this.planets[bodyIndex];
      const orbitRadius = def.planetIndex === 0 ? def.orbitRadius : parent.radius * def.orbit;
      const st = {
        name: def.name,
        kind: 'station',
        def,
        planetIndex: bodyIndex,
        systemIndex: def.planetIndex,
        mesh: visual.group,
        visual,
        size: def.size,
        security: def.security,
        orbitRadius,
        orbitAngle: def.planetIndex === 0 ? def.angle : (i * 1.7) % (Math.PI * 2),
        // Stations in the belt hold still; the others circle their planet slowly enough to catch up with and dock
        orbitVelocity: def.planetIndex === 0 ? 0 : 4.0,
        hidden: !!def.hidden,
      };
      visual.group.visible = !def.hidden;
      this.scene.add(visual.group);
      this.stations.push(st);
    });
  }

  createStarfield() {
    this.starMaterials = [];
    const px = this.renderer.getPixelRatio();
    const addPoints = (pos, col, size) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: { uGain: { value: 1 }, uPx: { value: px } },
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(geo, mat);
      pts.renderOrder = -5;
      pts.frustumCulled = false;
      this.skyGroup.add(pts);
      this.starMaterials.push(mat);
    };

    // The real night sky: every naked-eye star where it is, as bright and as coloured as it is
    const bytes = Uint8Array.from(atob(BSC_DATA), (ch) => ch.charCodeAt(0));
    const cat = new Uint16Array(bytes.buffer);
    const n = BSC_COUNT;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const dir = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const ra = cat[i * 4] / 100;
      const dec = cat[i * 4 + 1] / 100 - 90;
      const mag = cat[i * 4 + 2] / 100 - 2;
      const kelvin = cat[i * 4 + 3] * 10;
      equatorialToGame(ra, dec, dir).multiplyScalar(STAR_DISTANCE);
      pos.set([dir.x, dir.y, dir.z], i * 3);
      // Brightness from the magnitude (relative to a first-magnitude star), softened so faint stars still show
      const flux = Math.pow(10, -0.4 * (mag - 1));
      const lum = 0.9 * Math.pow(flux, 0.5);
      starColor(kelvin, c);
      col.set([c.r * lum, c.g * lum, c.b * lum], i * 3);
      size[i] = THREE.MathUtils.clamp(1.2 + 2.6 * Math.pow(flux, 0.35), 1.2, 8);
    }
    addPoints(pos, col, size);

    // Fainter than the eye resolves: a haze of small stars crowding towards the Milky Way, for long exposures
    const rand = rng(31337);
    const gauss = () => (rand() + rand() + rand() + rand() - 2) * 0.87;
    const faint = 12000;
    const fPos = new Float32Array(faint * 3);
    const fCol = new Float32Array(faint * 3);
    const fSize = new Float32Array(faint).fill(1);
    for (let i = 0; i < faint; i++) {
      if (rand() < 0.7) galacticDir(rand() * Math.PI * 2, gauss() * 0.13, dir);
      else {
        const u = rand() * 2 - 1, a = rand() * Math.PI * 2;
        dir.set(Math.sqrt(1 - u * u) * Math.cos(a), u, Math.sqrt(1 - u * u) * Math.sin(a));
      }
      dir.multiplyScalar(STAR_DISTANCE * (1.02 + rand() * 0.1));
      fPos.set([dir.x, dir.y, dir.z], i * 3);
      starColor(3500 + 9000 * rand() ** 2, c);
      const lum = 0.02 + 0.05 * rand() ** 2;
      fCol.set([c.r * lum, c.g * lum, c.b * lum], i * 3);
    }
    addPoints(fPos, fCol, fSize);
  }

  // How bright the night sky behind everything is drawn: the eyes' adaptation (see exposure.js) times how much a
  // planet's daylit sky lets through (see surface.js)
  setSkyGain(adapt = this.skyAdapt, through = this.skyThrough) {
    this.skyAdapt = adapt;
    this.skyThrough = through;
    const g = adapt * through;
    this.skyGroup.traverse((obj) => {
      const mat = obj.material;
      if (!mat) return;
      if (mat.uniforms && mat.uniforms.uGain) {
        mat.uniforms.uGain.value = g;
      } else if ('opacity' in mat) {
        if (obj.userData.baseOpacity === undefined) obj.userData.baseOpacity = mat.opacity;
        mat.opacity = Math.min(1, obj.userData.baseOpacity * g);
        obj.visible = g > 0.002;
      }
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

  // The galaxies one can see without a telescope, where they really are: Andromeda and Triangulum in the north,
  // the two Magellanic Clouds in the far south. size: drawn width at 110.000 units; squash: how flat they look;
  // tilt: position angle on the sky (degrees)
  createGalaxies() {
    const galaxySpecs = [
      { type: 'spiral', ra: 10.6847, dec: 41.269, core: '#ffe6c0', arm: '#a8c0ff', size: 7000, squash: 0.32, tilt: 35, opacity: 0.55 },
      { type: 'spiral', ra: 23.4621, dec: 30.66, core: '#fff0d8', arm: '#b8c8ff', size: 2200, squash: 0.62, tilt: 23, opacity: 0.35 },
      { type: 'elliptical', ra: 80.894, dec: -69.756, core: '#e4e8ff', arm: '', size: 16000, squash: 0.8, tilt: 170, opacity: 0.4 },
      { type: 'elliptical', ra: 13.187, dec: -72.828, core: '#e8ecff', arm: '', size: 8500, squash: 0.6, tilt: 45, opacity: 0.32 },
    ];
    const dir = new THREE.Vector3();
    galaxySpecs.forEach(spec => {
      const tex = this.createGalaxyTexture(spec.type, spec.core, spec.arm);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: spec.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.size, spec.size * spec.squash), mat);
      equatorialToGame(spec.ra, spec.dec, dir);
      mesh.position.copy(dir).multiplyScalar(110000);
      mesh.lookAt(0, 0, 0);
      mesh.rotateZ(THREE.MathUtils.degToRad(spec.tilt));
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

  // How much of the Sun's disc the ship sees: a planet in front of it covers part or all of it.
  // Discs compared by apparent size, so small Mercury in front of the Sun only dims, a near Earth eclipses it.
  updateSunVisibility(shipPos) {
    const vis = this.sunVisibilityAt(shipPos);
    this.sunVisibility = vis;
    this.sunLight.intensity = SUN_INTENSITY * vis;
  }

  // Share of the Sun's disc visible from a point (skipping the body the point belongs to)
  sunVisibilityAt(point, skip = null) {
    const toSun = point.clone().negate();
    const sunDist = toSun.length();
    toSun.divideScalar(sunDist);
    const sunAngle = Math.asin(Math.min(1, this.planets[0].radius / sunDist));
    let vis = 1;
    const rel = new THREE.Vector3();
    this.planets.forEach((p, i) => {
      if (i === 0 || !p.radius || p === skip) return;
      rel.copy(p.group.position).sub(point);
      const along = rel.dot(toSun);
      if (along <= 0 || along > sunDist) return;
      const dist = rel.length();
      // a thick atmosphere softens the edge of the shadow a little
      const planetAngle = Math.asin(Math.min(1, (p.radius * (p.data.atmosphere ? 1.02 : 1)) / dist));
      const apart = Math.acos(THREE.MathUtils.clamp(along / dist, -1, 1));
      let seen;
      if (apart >= sunAngle + planetAngle) seen = 1;
      else if (planetAngle >= sunAngle && apart <= planetAngle - sunAngle) seen = 0;
      else {
        const covered = Math.min(1, (planetAngle / sunAngle) ** 2); // most it can hide
        const inside = Math.abs(planetAngle - sunAngle);
        const t = THREE.MathUtils.smoothstep(apart, inside, sunAngle + planetAngle);
        seen = 1 - covered * (1 - t);
      }
      vis = Math.min(vis, seen);
    });
    return vis;
  }

  updateFillLight(shipPos) {
    let best = null;
    let bestStrength = 0;
    this.planets.forEach((p, i) => {
      if (i === 0 || !p.radius) return;
      const d = p.group.position.distanceTo(shipPos);
      const strength = Math.min(1, (p.radius / Math.max(d, p.radius)) ** 2);
      if (strength > bestStrength) { best = p; bestStrength = strength; }
    });
    if (!best || bestStrength < 0.02) {
      this.fillLight.intensity = 0;
      return;
    }
    const up = shipPos.clone().sub(best.group.position).normalize();
    const toSun = best.group.position.clone().negate().normalize();
    const dayside = THREE.MathUtils.clamp(0.5 + 0.5 * up.dot(toSun), 0, 1);
    this.fillLight.color.set(FILL_TINT[best.name] || 0xb0b8c8);
    this.fillLight.intensity = 0.9 * bestStrength * dayside;
    this.fillLight.position.copy(best.group.position).addScaledVector(up, best.radius);
    this.fillLight.target.position.copy(shipPos);
  }

  update(delta, shipPos = null) {
    const scale = this.getScaleParameters();
    if (delta > 0) this.time += delta;

    if (shipPos && this.skyGroup) {
      this.skyGroup.position.copy(shipPos);
    }
    if (shipPos) this.sunLight.target.position.copy(shipPos);
    if (shipPos) {
      this.updateSunVisibility(shipPos);
      this.updateFillLight(shipPos);
    }

    // 1. Planets: orbit, spin, and the orbital velocity the ship's stabilizer and station departures fly relative to
    this.planets.forEach((p, index) => {
      if (p.parent) {
        this.updateMoon(p, delta);
        return;
      }
      const isSun = index === 0;

      if (delta > 0 && !isSun) {
        // Slow down planetary orbits for smoother gameplay/docking
        const speedMultiplier = 0.08;
        p.angle += p.orbitSpeed * delta * speedMultiplier;
      }

      const r = isSun ? 0 : p.data.realDist * DIST_SCALE;
      const prevX = p.currentPos.x;
      const prevZ = p.currentPos.z;
      // Counterclockwise seen from ecliptic north (+y), as the real planets go
      p.currentPos.set(
        r * Math.cos(p.angle),
        0,
        -r * Math.sin(p.angle)
      );

      if (!p.velocity) p.velocity = new THREE.Vector3();
      if (delta > 0) p.velocity.set((p.currentPos.x - prevX) / delta, 0, (p.currentPos.z - prevZ) / delta);

      p.group.position.copy(p.currentPos);
      p.body.update(delta, this.time);
    });

    // 2. Stations: orbit their planet (or hold still in the belt), turn, blink
    this.stations.forEach(st => {
      const parentPlanet = this.planets[st.planetIndex];
      if (!parentPlanet) return;
      const r = st.orbitRadius;
      if (delta > 0 && st.orbitVelocity) st.orbitAngle += (st.orbitVelocity / r) * delta;
      const offsetPos = st.planetIndex === 0
        ? new THREE.Vector3(r * Math.cos(st.orbitAngle), 0, r * Math.sin(st.orbitAngle))
        : new THREE.Vector3(r * Math.cos(st.orbitAngle), r * 0.18 * Math.sin(st.orbitAngle), r * Math.sin(st.orbitAngle));
      st.mesh.position.copy(st.planetIndex === 0 ? offsetPos : parentPlanet.group.position.clone().add(offsetPos));
      if (delta > 0) st.visual.animate(delta);
    });

    // 3. Rocks hold their place in their field and tumble
    if (delta > 0) {
      this.asteroids.forEach(ast => {
        ast.mesh.rotation.x += ast.spin.x * delta;
        ast.mesh.rotation.y += ast.spin.y * delta;
        ast.mesh.rotation.z += ast.spin.z * delta;
      });
    }
  }

  // T: everything worth flying to or shooting at, ordered by how close it is to the crosshair
  cycleTarget(currentSelection, ship, extra = []) {
    const majorTargets = [...this.planets, ...this.stations.filter((s) => !s.hidden), ...extra];
    if (majorTargets.length === 0) return null;

    if (ship) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
      majorTargets.forEach(t => {
        const tPos = t.group ? t.group.position : t.mesh.position;
        const toTarget = tPos.clone().sub(ship.position).normalize();
        t.tempDot = forward.dot(toTarget);
      });
      majorTargets.sort((a, b) => b.tempDot - a.tempDot);
    }

    if (!currentSelection) return majorTargets[0];
    const currentIndex = majorTargets.indexOf(currentSelection);
    if (currentIndex === -1) return majorTargets[0];
    return majorTargets[(currentIndex + 1) % majorTargets.length];
  }

  // What sits under the crosshair: ships first (they matter most), then stations, rocks and planets
  findTargetUnderCrosshair(ship, ships = []) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    let bestTarget = null;
    let bestDot = 0.985; // within ~10 degrees of the crosshair
    const consider = (obj, pos, maxDist, bonus = 0) => {
      const toTarget = pos.clone().sub(ship.position);
      const dist = toTarget.length();
      if (maxDist && dist > maxDist) return;
      const dot = forward.dot(toTarget.divideScalar(dist || 1)) + bonus;
      if (dot > bestDot) {
        bestDot = dot;
        bestTarget = obj;
      }
    };

    this.planets.forEach(p => consider(p, p.group.position));
    this.stations.forEach(st => { if (!st.hidden) consider(st, st.mesh.position); });
    ships.forEach(n => consider(n, n.pos, ship.sensorRange || 2200, 0.004));
    this.asteroids.forEach(ast => consider(ast, ast.mesh.position, 600));

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
