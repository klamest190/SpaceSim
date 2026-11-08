import * as THREE from 'three';
import { NOISE_GLSL, BAKE_VERTEX } from './planetShaders';

// The night sky behind everything: the Milky Way as a band of star clouds with dark dust lanes and a bright,
// warm bulge, a few glowing emission nebulae along it, a faint haze of unresolved stars, all baked once into an
// equirectangular HDR map on the GPU. Point stars on top are drawn separately (see SolarSystem.createStarfield).

const BAKE_SCALE = THREE.MathUtils.clamp(Number(new URLSearchParams(window.location.search).get('bake')) || 1, 0.03125, 1);
const STRIPS = 16;

// The game's axes are the ecliptic: the planets orbit in the x-z plane, +y is ecliptic north, +x points to
// the vernal equinox. A direction on the real sky (J2000 right ascension and declination, degrees) in game axes:
const OBLIQUITY = THREE.MathUtils.degToRad(23.4393);
export function equatorialToGame(raDeg, decDeg, out = new THREE.Vector3()) {
  const ra = THREE.MathUtils.degToRad(raDeg);
  const dec = THREE.MathUtils.degToRad(decDeg);
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  const yE = y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY);
  const zE = -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
  return out.set(x, zE, -yE);
}

// The galactic frame where it really is: north galactic pole, direction to the galactic centre in Sagittarius,
// and the third axis towards Cygnus (galactic longitude 90°)
export const GALAXY = (() => {
  const g = equatorialToGame(192.85948, 27.12825);
  const c = equatorialToGame(266.40510, -28.93617).projectOnPlane(g).normalize();
  const c2 = new THREE.Vector3().crossVectors(g, c).normalize();
  return { g, c, c2 };
})();

// A direction at galactic longitude l and latitude b (radians)
export function galacticDir(l, b, out = new THREE.Vector3()) {
  const { g, c, c2 } = GALAXY;
  return out.copy(c).multiplyScalar(Math.cos(l) * Math.cos(b)).addScaledVector(c2, Math.sin(l) * Math.cos(b)).addScaledVector(g, Math.sin(b));
}

const SKY_BAKE = NOISE_GLSL + /* glsl */ `
varying vec2 vUv;
uniform vec3 uG;
uniform vec3 uC;
uniform vec3 uC2;
uniform vec3 uNebDir[7];
uniform vec3 uNebCol[7];
uniform float uNebSize[7];

float skyHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 skyHash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}

// Faint stars too small to draw as points: one candidate per cell on the sphere
float bakedStars(vec3 dir, float density, float scale) {
  vec3 p = dir * scale;
  vec3 base = floor(p - 0.5);
  float sum = 0.0;
  for (int i = 0; i < 2; i++) {
    for (int j = 0; j < 2; j++) {
      for (int k = 0; k < 2; k++) {
        vec3 c = base + vec3(float(i), float(j), float(k));
        float h = skyHash13(c);
        if (h > density) continue;
        vec3 sp = c + skyHash33(c);
        float d = length(p - sp);
        float b = pow(skyHash13(c + 7.0), 6.0);
        sum += exp(-d * d * 9.0) * (0.15 + b * 1.6);
      }
    }
  }
  return sum;
}

void main() {
  float lon = (vUv.x - 0.5) * 2.0 * PI;
  float lat = (vUv.y - 0.5) * PI;
  vec3 dir = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));

  float b = dot(dir, uG);
  float l = atan(dot(dir, uC2), dot(dir, uC));
  float core = exp(-l * l * 1.4);

  // The band: irregular in width and height, clumpy, with a bright bulge around the core
  float warp = fbm(dir * 2.1 + 3.0, 3) * 0.07;
  float bb = b + warp;
  float width = 0.075 + 0.11 * core;
  float band = exp(-bb * bb / (width * width));
  float clouds = clamp(fbm(dir * 4.5 + 1.0, 6) + 0.5, 0.0, 1.0);
  float fine = clamp(fbm(dir * 17.0 + 7.0, 4) + 0.5, 0.0, 1.0);
  // Brightest towards the crowded inner galaxy, faint towards the anticentre beyond Orion and Taurus
  float inner = smoothstep(-0.3, 1.0, cos(l));
  float glow = band * (0.25 + 1.1 * clouds * clouds) * (0.65 + 0.6 * fine) * (0.4 + 0.6 * inner);
  float bulge = core * exp(-bb * bb / (0.16 * 0.16));
  glow += bulge * (1.2 + 0.6 * clouds);
  glow += exp(-bb * bb / 0.09) * 0.12; // wide faint skirt

  // Dust: a dark rift along the middle and scattered dark clouds inside the band
  // The Great Rift runs from Cygnus through Aquila to Sagittarius, along the inner galaxy only
  float rift = exp(-pow((bb - 0.015 * sin(l * 2.7)) / (0.022 + 0.03 * core), 2.0)) * smoothstep(-0.1, 0.5, cos(l));
  float dustA = smoothstep(0.35, 0.8, fbm(dir * 6.5 + 11.0, 6) + 0.5);
  float dustB = smoothstep(0.5, 0.95, fbm(dir * 13.0 + 5.0, 5) + 0.5);
  float dust = clamp(rift * (0.3 + dustA) * 0.75 + band * dustB * 0.35, 0.0, 0.85);

  vec3 warm = vec3(1.0, 0.82, 0.62);
  vec3 cool = vec3(0.66, 0.76, 1.0);
  vec3 col = mix(cool, warm, clamp(core * 0.9 + 0.25 * clouds - 0.1, 0.0, 1.0)) * glow * 0.055;
  col *= (1.0 - dust) * mix(vec3(1.0), vec3(1.0, 0.75, 0.55), dust);

  // Emission nebulae: wispy, domain-warped, mostly along the band
  for (int i = 0; i < 7; i++) {
    float a = acos(clamp(dot(dir, uNebDir[i]), -1.0, 1.0)) / uNebSize[i];
    float m = exp(-a * a * 1.8);
    if (m < 0.002) continue;
    vec3 q = dir * 7.0 + float(i) * 13.7;
    vec3 w = vec3(fbm(q, 4), fbm(q + 5.2, 4), fbm(q + 9.1, 4));
    float wisps = fbm(q * 1.3 + w * 2.2, 6) + 0.5;
    float fil = smoothstep(0.45, 0.95, wisps);
    float knot = smoothstep(0.75, 1.0, wisps) * 1.5;
    col += uNebCol[i] * m * (fil + knot) * 0.05 * (1.0 - dust * 0.8);
  }

  // Unresolved stars, denser in the band, and a faint even haze
  float density = 0.06 + 0.5 * band + 0.3 * bulge;
  col += vec3(0.95, 0.95, 1.0) * bakedStars(dir, density * (1.0 - dust * 0.85), 520.0) * 0.05;
  col += vec3(0.006, 0.007, 0.011) * (0.6 + fbm(dir * 3.0, 3));

  gl_FragColor = vec4(col, 1.0);
}
`;

const SKY_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const SKY_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform sampler2D uSky;
uniform float uGain;
varying vec3 vDir;
const float PI = 3.141592653589793;
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
  gl_FragColor = vec4(texture2D(uSky, uv).rgb * uGain, 1.0);
}
`;

// Nebulae where they really are (galactic longitude / latitude in degrees), a little larger and brighter
// than the eye would see them, as on a long exposure: glowing hydrogen red and pink, starlight on dust blue
const NEBULAE = [
  { l: 287.6, b: -0.6, size: 0.075, col: [1.0, 0.34, 0.42] },  // Carina, around Eta Carinae
  { l: 209.0, b: -19.4, size: 0.05, col: [1.0, 0.42, 0.58] },  // Orion, below the belt
  { l: 6.0, b: -1.2, size: 0.055, col: [1.0, 0.36, 0.5] },     // Lagoon and Trifid in Sagittarius
  { l: 85.6, b: -0.7, size: 0.06, col: [1.0, 0.3, 0.36] },     // North America and Pelican in Cygnus
  { l: 206.3, b: -2.1, size: 0.035, col: [1.0, 0.36, 0.44] },  // Rosette
  { l: 166.6, b: -23.5, size: 0.03, col: [0.45, 0.62, 1.0] },  // dust lit blue around the Pleiades
  { l: 353.0, b: 17.0, size: 0.07, col: [0.55, 0.62, 1.0] },   // Rho Ophiuchi's blue and gold clouds
].map((n) => ({ ...n, l: THREE.MathUtils.degToRad(n.l), b: THREE.MathUtils.degToRad(n.b) }));

function bakeSky(renderer) {
  const width = Math.max(1024, Math.round(4096 * BAKE_SCALE));
  const target = new THREE.WebGLRenderTarget(width, width / 2, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  const material = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERTEX,
    fragmentShader: SKY_BAKE,
    uniforms: {
      uTile: { value: new THREE.Vector4() },
      uG: { value: GALAXY.g },
      uC: { value: GALAXY.c },
      uC2: { value: GALAXY.c2 },
      uNebDir: { value: NEBULAE.map((n) => galacticDir(n.l, n.b)) },
      uNebCol: { value: NEBULAE.map((n) => new THREE.Vector3(...n.col)) },
      uNebSize: { value: NEBULAE.map((n) => n.size) },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(target);
  for (let i = 0; i < STRIPS; i++) {
    material.uniforms.uTile.value.set(0, i / STRIPS, 1, 1 / STRIPS);
    renderer.render(scene, camera);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevClear;
  quad.geometry.dispose();
  material.dispose();
  return target.texture;
}

export function createSkySphere(renderer) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(100000, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: { uSky: { value: bakeSky(renderer) }, uGain: { value: 1 } },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}
