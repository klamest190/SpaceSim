import * as THREE from 'three';

// Aurorae: curtains of light round the magnetic poles of planets with a magnetic field and air, where particles
// from the Sun rain down along the field lines. Earth's glow green (oxygen at 100-200 km) with red tops (oxygen
// higher up) and a violet hem (nitrogen); the giants' glow pink and violet from hydrogen. Plain to see on the night
// side only; after a solar storm they flare up and spread towards the equator. Jupiter's carry a bright spot where
// the field lines from Io come down, wandering round the pole with the moon.
//
// Each oval is drawn twice: as upright curtains (seen from the side, at the limb) and as a flat glowing band
// at their foot (seen from above). Both live in the planet's tilt frame, which does not spin with the day.

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 aUV;          // x: round the oval 0..1, y: up the curtain or across the band 0..1
uniform float uTime;
uniform float uColat;        // radius of the oval: angle from the magnetic pole
uniform float uH0;           // foot of the curtain, in planet radii above the ground
uniform float uH1;           // top of the curtain
uniform float uBandWidth;    // band: width across the oval, radians
uniform float uSouth;
uniform float uBand;         // 0 curtain, 1 band
uniform mat3 uPoleFrame;     // columns: first axis, magnetic axis, second axis
uniform vec3 uSunLocal;
varying vec2 vUV;
varying float vNight;
void main() {
  float phi = aUV.x * 6.2831853;
  // The oval folds and slowly drifts
  float wob = 0.07 * sin(3.0 * phi + uTime * 0.05) + 0.04 * sin(7.0 * phi - uTime * 0.11) + 0.02 * sin(17.0 * phi + uTime * 0.3);
  float theta = uColat * (1.0 + wob);
  float h = uH0;
  if (uBand > 0.5) theta += (aUV.y - 0.5) * uBandWidth;
  else h = uH0 + aUV.y * (uH1 - uH0);
  vec3 local = vec3(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));
  if (uSouth > 0.5) local.y = -local.y;
  vec3 dir = uPoleFrame * local;
  vNight = 1.0 - smoothstep(-0.25, 0.2, dot(dir, uSunLocal));
  vUV = aUV;
  vec4 mv = modelViewMatrix * vec4(dir * (1.0 + h), 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform float uIntensity;
uniform float uBand;
uniform vec3 uColLow;
uniform vec3 uColMid;
uniform vec3 uColHigh;
uniform float uFootLon;     // longitude of a moon's footprint on the oval
uniform float uFoot;        // its brightness (0 = none)
varying vec2 vUV;
varying float vNight;
float hash1(float n) { return fract(sin(n) * 43758.5453); }
float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash1(i), hash1(i + 1.0), f);
}
void main() {
  #include <logdepthbuf_fragment>
  // Rays: fine upright striations that shimmer and run along the curtain
  float rays = vnoise(vUV.x * 1100.0 + uTime * 0.9) * 0.6 + vnoise(vUV.x * 330.0 - uTime * 0.4) * 0.6;
  rays *= rays;
  // Bright and faint stretches crawling round the oval
  float patches = 0.3 + 0.7 * smoothstep(0.3, 0.9, vnoise(vUV.x * 16.0 + uTime * 0.05) * 0.75 + vnoise(vUV.x * 45.0 - uTime * 0.12) * 0.4);
  float phi = vUV.x * 6.2831853;
  float dl = mod(phi - uFootLon + 3.14159265, 6.2831853) - 3.14159265;
  float foot = uFoot * exp(-dl * dl / 0.003);
  vec3 col;
  float a;
  if (uBand < 0.5) {
    float v = vUV.y;
    float profile = smoothstep(0.0, 0.04, v) * (0.25 + 0.75 * exp(-v * 3.0));
    col = mix(uColLow, uColMid, smoothstep(0.0, 0.12, v));
    col = mix(col, uColHigh, smoothstep(0.3, 0.85, v));
    a = profile * ((0.3 + rays) * patches + foot * 2.0);
  } else {
    float across = 1.0 - abs(vUV.y - 0.5) * 2.0;
    col = uColMid;
    a = across * ((0.5 + 0.5 * rays) * patches * 0.4 + foot * 2.5);
  }
  gl_FragColor = vec4(col * a * uIntensity * (0.08 + 0.92 * vNight), 1.0);
}
`;

// colat: oval radius at rest and at the height of a storm (radians); tilt / tiltLon: the magnetic axis against the
// spin axis (degrees); h0 / h1: curtain foot and top in planet radii (Earth: about 100 and 400 km, a little taller)
const AURORA_DEFS = {
  Earth: {
    colat: [0.36, 0.55], tilt: 10, tiltLon: 290, h0: 0.014, h1: 0.095, rest: 0.35, storm: 1.7,
    low: [0.55, 0.2, 1.0], mid: [0.12, 1.0, 0.32], high: [1.0, 0.12, 0.22],
  },
  Jupiter: {
    colat: [0.27, 0.32], tilt: 9.6, tiltLon: 200, h0: 0.004, h1: 0.026, rest: 0.6, storm: 1.8, footprint: 'Io',
    low: [0.45, 0.32, 1.0], mid: [1.0, 0.3, 0.72], high: [0.68, 0.28, 1.0],
  },
  Saturn: {
    colat: [0.26, 0.31], tilt: 0, tiltLon: 0, h0: 0.004, h1: 0.03, rest: 0.45, storm: 1.6,
    low: [0.45, 0.35, 1.0], mid: [1.0, 0.36, 0.62], high: [0.78, 0.3, 1.0],
  },
};

const SEGMENTS = 512;

function ovalGeometry() {
  const uv = new Float32Array((SEGMENTS + 1) * 2 * 2);
  const index = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    uv.set([i / SEGMENTS, 0, i / SEGMENTS, 1], i * 4);
    if (i < SEGMENTS) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('aUV', new THREE.BufferAttribute(uv, 2));
  // three.js wants a position attribute; the shader builds the real one
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 3), 3));
  geo.setIndex(index);
  return geo;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class Aurorae {
  constructor(solarSystem) {
    this.solarSystem = solarSystem;
    this.sets = [];
    const geo = ovalGeometry();
    Object.entries(AURORA_DEFS).forEach(([name, def]) => {
      const planet = solarSystem.planets.find((p) => p.name === name);
      if (!planet) return;
      // Magnetic axis and two axes across it, in the planet's tilt frame
      const t = THREE.MathUtils.degToRad(def.tilt);
      const l = THREE.MathUtils.degToRad(def.tiltLon);
      const axis = new THREE.Vector3(Math.sin(t) * Math.cos(l), Math.cos(t), Math.sin(t) * Math.sin(l)).normalize();
      const e1 = new THREE.Vector3(0, 0, 1).cross(axis).normalize();
      const e2 = new THREE.Vector3().crossVectors(e1, axis).normalize();
      const frame = new THREE.Matrix3().set(e1.x, axis.x, e2.x, e1.y, axis.y, e2.y, e1.z, axis.z, e2.z);
      const shared = {
        uTime: { value: 0 },
        uColat: { value: def.colat[0] },
        uH0: { value: def.h0 },
        uH1: { value: def.h1 },
        uBandWidth: { value: 0.09 },
        uPoleFrame: { value: frame },
        uSunLocal: { value: new THREE.Vector3(1, 0, 0) },
        uIntensity: { value: def.rest },
        uColLow: { value: new THREE.Vector3(...def.low) },
        uColMid: { value: new THREE.Vector3(...def.mid) },
        uColHigh: { value: new THREE.Vector3(...def.high) },
        uFootLon: { value: 0 },
        uFoot: { value: 0 },
      };
      const meshes = [];
      [0, 1].forEach((south) => {
        [0, 1].forEach((band) => {
          const mat = new THREE.ShaderMaterial({
            uniforms: { ...shared, uSouth: { value: south }, uBand: { value: band } },
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.scale.setScalar(planet.radius);
          mesh.frustumCulled = false;
          mesh.renderOrder = 3;
          planet.body.tilt.add(mesh);
          meshes.push(mesh);
        });
      });
      const moon = def.footprint ? solarSystem.planets.find((p) => p.name === def.footprint) : null;
      this.sets.push({ name, planet, def, shared, meshes, axis, e1, e2, moon, level: 0 });
    });
  }

  // storm: 0..1 per planet name, how hard the last solar storm still shakes its magnetic field
  update(time, storm = {}) {
    for (const s of this.sets) {
      const u = s.shared;
      const level = THREE.MathUtils.clamp(storm[s.name] || 0, 0, 1);
      u.uTime.value = time;
      u.uIntensity.value = THREE.MathUtils.lerp(s.def.rest, s.def.storm, level);
      u.uColat.value = THREE.MathUtils.lerp(s.def.colat[0], s.def.colat[1], level);
      s.planet.body.tilt.getWorldQuaternion(_q).invert();
      u.uSunLocal.value.copy(s.planet.group.position).negate().normalize().applyQuaternion(_q);
      if (s.moon) {
        // Where the moon stands round the magnetic pole
        _v.copy(s.moon.group.position).sub(s.planet.group.position).applyQuaternion(_q).normalize();
        u.uFootLon.value = Math.atan2(_v.dot(s.e2), _v.dot(s.e1));
        if (u.uFootLon.value < 0) u.uFootLon.value += Math.PI * 2;
        u.uFoot.value = 0.8;
      }
    }
  }
}
