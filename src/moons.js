import * as THREE from 'three';

// Volcanic plumes on Io: sulfur and sulfur dioxide thrown hundreds of km up, falling back in a wide umbrella
// that paints the rings of red and white around the vents. Faint over the bright day side, they stand out
// against black space at the limb, and shine brightest with the Sun behind them (dust scatters forwards).
// The particles live in the moon's own frame (a unit sphere that turns with it) and fly ballistic arcs.

const PLUME_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aSeed;      // x: phase offset, y: azimuth, z: launch speed, w: size and brightness
uniform float uTime;
uniform float uRate;
uniform vec3 uVent;        // the vent on the unit sphere
uniform float uHeight;     // peak height of the fastest particles, in radii
uniform float uReach;      // how far the fastest ones land, as an angle
uniform vec3 uSunObj;      // towards the Sun, in the moon's frame
uniform vec3 uCamObj;      // camera position in the moon's frame
uniform float uPixelScale;
uniform float uSize;
uniform float uLit;        // 0 while the moon is in its planet's shadow
varying float vBright;
void main() {
  float ph = fract(aSeed.x + uTime * uRate);
  float spd = aSeed.z;
  vec3 t1 = normalize(cross(uVent, abs(uVent.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(uVent, t1);
  float az = aSeed.y * 6.2831853;
  vec3 dir = t1 * cos(az) + t2 * sin(az);
  float ang = uReach * spd * ph;
  float h = uHeight * spd * spd * 4.0 * ph * (1.0 - ph);
  vec3 pos = normalize(uVent * cos(ang) + dir * sin(ang)) * (1.0 + h);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * aSeed.w) * uPixelScale / -mv.z, 1.0, 24.0);
  #include <logdepthbuf_vertex>
  // In the moon's shadow nothing lights the dust
  float b = dot(pos, uSunObj);
  float c = dot(pos, pos) - 1.0;
  float lit = (b < 0.0 && b * b - c > 0.0) ? 0.0 : 1.0;
  float forward = pow(max(dot(normalize(pos - uCamObj), uSunObj), 0.0), 6.0);
  float fade = smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.7, 1.0, ph));
  vBright = lit * uLit * fade * (0.3 + 3.0 * forward) * (0.5 + aSeed.w);
}
`;

const PLUME_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
varying float vBright;
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0 || vBright <= 0.0) discard;
  float a = (1.0 - r2) * (1.0 - r2);
  gl_FragColor = vec4(uColor * vBright * a, 1.0);
}
`;

// lat / west longitude of the vent, peak height and reach in moon radii; the real heights are 75 to 400 km
const IO_PLUMES = [
  { lat: -18.7, lonW: 255.3, height: 0.2, reach: 0.3, count: 5000, size: 0.009, color: [0.05, 0.07, 0.12] },  // Pele
  { lat: 63.0, lonW: 124.0, height: 0.19, reach: 0.25, count: 4000, size: 0.009, color: [0.05, 0.07, 0.12] }, // Tvashtar
  { lat: 13.0, lonW: 309.0, height: 0.08, reach: 0.1, count: 1500, size: 0.007, color: [0.06, 0.07, 0.1] },       // Loki
  { lat: -1.5, lonW: 153.0, height: 0.055, reach: 0.08, count: 1500, size: 0.006, color: [0.07, 0.075, 0.1] },      // Prometheus
  { lat: 24.0, lonW: 115.0, height: 0.05, reach: 0.07, count: 1000, size: 0.006, color: [0.07, 0.075, 0.09] },    // Amirani
];

// The vent's direction in the moon's frame (same mapping as the baked maps: west longitudes towards +z)
function ventDir(lat, lonW) {
  const la = THREE.MathUtils.degToRad(lat);
  const lo = THREE.MathUtils.degToRad(lonW);
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo));
}

export class IoPlumes {
  constructor(body) {
    this.body = body;
    this.shared = {
      uTime: { value: 0 },
      uSunObj: body.uniforms.uSunDirObj,
      uCamObj: { value: new THREE.Vector3() },
      uPixelScale: { value: 500 },
      uLit: { value: 1 },
    };
    let seed = 1;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    this.points = IO_PLUMES.map((pl) => {
      const seeds = new Float32Array(pl.count * 4);
      for (let i = 0; i < pl.count; i++) {
        // Most particles near full speed (the umbrella's edge), a few slower ones filling it in
        seeds.set([rand(), rand(), 1 - 0.55 * rand() ** 2, rand()], i * 4);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pl.count * 3), 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...this.shared,
          uRate: { value: 1 / (30 + pl.height * 60) },
          uVent: { value: ventDir(pl.lat, pl.lonW) },
          uHeight: { value: pl.height },
          uReach: { value: pl.reach },
          uSize: { value: pl.size * body.radius }, // world units: the view-space depth divides it
          uColor: { value: new THREE.Vector3(...pl.color) },
        },
        vertexShader: PLUME_VERTEX,
        fragmentShader: PLUME_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 4;
      body.mesh.add(pts);
      return pts;
    });
  }

  // Right before rendering, after the moon's own view update
  update(camera, time, renderer, sunlight = 1) {
    this.shared.uTime.value = time;
    this.shared.uLit.value = sunlight;
    const mesh = this.body.mesh;
    mesh.updateWorldMatrix(true, false);
    this.shared.uCamObj.value.copy(camera.position);
    mesh.worldToLocal(this.shared.uCamObj.value);
    const height = renderer ? renderer.getDrawingBufferSize(_size).y : window.innerHeight;
    this.shared.uPixelScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}

const _size = new THREE.Vector2();
