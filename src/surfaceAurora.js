import * as THREE from 'three';

// The aurora seen from below, flying through Earth's night in high latitudes: curtains hanging in the sky towards
// the pole, far above the highest the ship can climb down here. Green where oxygen glows at 100 to 200 km, red
// at their tops, a violet hem of nitrogen. After a solar storm they brighten and reach far towards the equator.

const CURTAINS = 4;
const WIDTH = 150000;
const NEAR = 30000;      // the nearest curtain stands this far towards the pole
const SPACING = 13000;
const FOOT = 9000;
const TOP = 30000;
const SEGMENTS = 220;

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 aUV;
uniform float uTime;
uniform float uIndex;
uniform float uPoleward;   // -1: the pole lies towards -z (north), +1: towards +z
uniform vec3 uCam;
varying vec2 vUV;
void main() {
  float s = aUV.x;
  float x = (s - 0.5) * ${WIDTH.toFixed(1)};
  // Folds that drift slowly along the curtain
  float fold = 5200.0 * sin(s * 11.0 + uIndex * 2.4 + uTime * 0.045)
             + 2400.0 * sin(s * 27.0 - uIndex * 1.3 - uTime * 0.09)
             + 900.0 * sin(s * 61.0 + uTime * 0.21);
  // The band bows away towards the horizon at both ends, like the oval it is a piece of
  float bow = (s - 0.5) * (s - 0.5) * 60000.0;
  float z = uPoleward * (${NEAR.toFixed(1)} + uIndex * ${SPACING.toFixed(1)} + fold - bow);
  float y = ${FOOT.toFixed(1)} + aUV.y * ${(TOP - FOOT).toFixed(1)} * (0.75 + 0.25 * sin(s * 17.0 + uIndex));
  vUV = aUV;
  vec4 mv = viewMatrix * vec4(uCam.x + x, y, uCam.z + z, 1.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform float uIntensity;
uniform float uIndex;
varying vec2 vUV;
float hash1(float n) { return fract(sin(n) * 43758.5453); }
float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash1(i), hash1(i + 1.0), f);
}
void main() {
  #include <logdepthbuf_fragment>
  float s = vUV.x + uIndex * 0.37;
  float rays = vnoise(s * 900.0 + uTime * 0.8) * 0.6 + vnoise(s * 260.0 - uTime * 0.35) * 0.6;
  rays *= rays;
  float patches = 0.25 + 0.75 * smoothstep(0.3, 0.9, vnoise(s * 14.0 + uTime * 0.04) * 0.75 + vnoise(s * 37.0 - uTime * 0.1) * 0.4);
  float v = vUV.y;
  float profile = smoothstep(0.0, 0.03, v) * (0.2 + 0.8 * exp(-v * 3.2)) * (1.0 - smoothstep(0.55, 1.0, v));
  vec3 col = mix(vec3(0.55, 0.2, 1.0), vec3(0.12, 1.0, 0.32), smoothstep(0.0, 0.1, v));
  col = mix(col, vec3(1.0, 0.12, 0.22), smoothstep(0.3, 0.85, v));
  float ends = smoothstep(0.0, 0.12, vUV.x) * smoothstep(1.0, 0.88, vUV.x);
  gl_FragColor = vec4(col * profile * (0.3 + rays) * patches * ends * uIntensity, 1.0);
}
`;

export class SurfaceAurora {
  constructor(scene) {
    const uv = new Float32Array((SEGMENTS + 1) * 4);
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
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 6), 3));
    geo.setIndex(index);
    this.shared = { uTime: { value: 0 }, uIntensity: { value: 0 }, uPoleward: { value: -1 }, uCam: { value: new THREE.Vector3() } };
    this.group = new THREE.Group();
    this.group.visible = false;
    for (let i = 0; i < CURTAINS; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: { ...this.shared, uIndex: { value: i } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }));
      mesh.frustumCulled = false;
      mesh.renderOrder = -4; // over the sky, under the ground and the clouds
      this.group.add(mesh);
    }
    scene.add(this.group);
    this.level = 0;
  }

  hide() {
    this.group.visible = false;
    this.level = 0;
  }

  // latitude in degrees, storm 0..1, dark 0..1 (how much of the night sky shows)
  update(camera, delta, latitude, storm, dark) {
    const reach = THREE.MathUtils.lerp(54, 26, storm); // how far from the pole the curtains come
    const lat = Math.abs(latitude);
    const want = THREE.MathUtils.smoothstep(lat, reach - 9, reach + 4) * dark * THREE.MathUtils.lerp(0.5, 1.9, storm);
    this.level += (want - this.level) * Math.min(1, delta * 0.8 + (this.group.visible ? 0 : 1));
    this.group.visible = this.level > 0.004;
    if (!this.group.visible) return;
    const u = this.shared;
    u.uTime.value += delta;
    u.uIntensity.value = this.level * 0.13; // four sheets seen face-on add up quickly
    u.uPoleward.value = latitude >= 0 ? -1 : 1;
    u.uCam.value.copy(camera.position);
  }
}
