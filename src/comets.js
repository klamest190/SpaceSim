import * as THREE from 'three';
import { makeRock } from './asteroids';
import { rng } from './shipModel';

// Comets: dark lumps of ice and dust on long ellipses. Near the Sun the ice boils off and the comet grows a
// coma, glowing green from carbon molecules, and two tails. The ion tail is gas swept straight away from the Sun
// by the solar wind, thin, straight and blue (carbon monoxide ions). The dust tail is pushed out more gently
// by sunlight, lags behind along the orbit in a broad yellow-white curve, and shines brightest with the Sun
// behind it. Far from the Sun both fade and only the dark nucleus is left. Chunks of ice drift beside the
// nucleus: worth mining, and good as emergency coolant.
//
// The orbits have their real shape close in (perihelion, tilt, Halley running backwards); the far ends are
// pulled in and the periods shortened so both comets come round within an evening's flying.

const COMET_DEFS = [
  { name: 'Halley', q: 880, Q: 7200, period: 3900, incl: 162, node: 1.0, peri: 1.94, phase: -0.045, size: 11, seed: 1 },
  { name: 'Encke', q: 510, Q: 6100, period: 3000, incl: 11.8, node: 5.83, peri: 3.25, phase: 0.06, size: 7, seed: 2 },
];

const TAIL_POINTS = 7000;
const ION_LENGTH = 2400;
const DUST_LENGTH = 1300;
const CHUNKS = 9;
const CHUNK_REGROW = 150; // seconds

const TAIL_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aSeed;     // x: phase along the tail, y and z: where across it, w: size and brightness
uniform float uTime;
uniform float uLength;
uniform float uWidth;     // spread at the far end, as a share of the length
uniform float uCurve;     // how far the tail bends back along the orbit
uniform float uRate;
uniform float uKinks;
uniform vec3 uAway;       // away from the Sun
uniform vec3 uBack;       // back along the orbit
uniform vec3 uSide;
uniform float uPixelScale;
uniform float uForward;
varying float vBright;
void main() {
  float t = fract(aSeed.x + uTime * uRate);
  float along = pow(t, 1.4);
  vec3 up = normalize(cross(uAway, uSide));
  float a = aSeed.y * 6.2831853;
  float rad = sqrt(aSeed.z) * uWidth * uLength * (0.04 + along);
  // The ion tail carries knots and kinks that drift down it with the solar wind
  float kink = uKinks * uLength * 0.02 * sin(along * 30.0 - uTime * 0.3 + aSeed.y * 0.6) * along;
  vec3 pos = uAway * (uLength * along) + uBack * (uCurve * uLength * along * along)
           + uSide * (cos(a) * rad + kink) + up * (sin(a) * rad * 0.5);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (0.5 + aSeed.w) * uLength * (0.004 + 0.012 * along);
  float px = size * uPixelScale / -mv.z;
  gl_PointSize = clamp(px, 1.5, 12.0);
  #include <logdepthbuf_vertex>
  vec3 view = normalize((modelMatrix * vec4(pos, 1.0)).xyz - cameraPosition);
  float forward = pow(max(dot(view, -uAway), 0.0), 5.0);
  // From far away a grain covers less than a pixel: it dims instead of shrinking further
  float sub = min(1.0, px / 1.5);
  vBright = (1.0 - along) * (1.0 - along) * smoothstep(0.0, 0.03, t) * (0.5 + aSeed.w) * (1.0 + uForward * forward) * sub * sub;
}
`;

const TAIL_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uActivity;
varying float vBright;
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float a = (1.0 - r2) * (1.0 - r2);
  gl_FragColor = vec4(uColor * (vBright * a * uActivity), 1.0);
}
`;

function comaTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.06, 'rgba(235,255,240,0.75)');
  grad.addColorStop(0.2, 'rgba(120,255,170,0.3)');
  grad.addColorStop(0.5, 'rgba(60,220,150,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

const _away = new THREE.Vector3();
const _back = new THREE.Vector3();
const _side = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _size = new THREE.Vector2();
const UP = new THREE.Vector3(0, 1, 0);

export class Comets {
  constructor(solarSystem, shapes, materials) {
    this.solarSystem = solarSystem;
    this.list = [];
    const coma = comaTexture();
    this.shared = { uTime: { value: 0 }, uPixelScale: { value: 500 } };

    COMET_DEFS.forEach((def, ci) => {
      const rand = rng(8800 + def.seed * 97);
      const a = (def.q + def.Q) / 2;
      const e = (def.Q - def.q) / (def.Q + def.q);
      // Orbit plane: argument of perihelion, inclination, ascending node
      const orient = new THREE.Quaternion()
        .setFromAxisAngle(UP, def.node)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(def.incl)))
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, def.peri));

      // The nucleus: one of the darkest things in the Solar System
      const mesh = makeRock(shapes[(ci * 3 + 1) % shapes.length], materials.rock, def.size);
      mesh.scale.set(def.size * 1.25, def.size * 0.8, def.size);
      solarSystem.scene.add(mesh);

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: coma, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.renderOrder = 4;
      solarSystem.scene.add(glow);

      const tail = (count, uniforms) => {
        const seeds = new Float32Array(count * 4);
        for (let i = 0; i < count * 4; i++) seeds[i] = rand();
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
        const mat = new THREE.ShaderMaterial({
          uniforms: {
            ...this.shared,
            uAway: { value: new THREE.Vector3(1, 0, 0) }, uBack: { value: new THREE.Vector3(0, 0, 1) }, uSide: { value: new THREE.Vector3(0, 0, 1) },
            uActivity: { value: 0 }, uLength: { value: 1 },
            ...uniforms,
          },
          vertexShader: TAIL_VERTEX,
          fragmentShader: TAIL_FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        pts.renderOrder = 4;
        solarSystem.scene.add(pts);
        return pts;
      };
      const ion = tail(TAIL_POINTS, {
        uColor: { value: new THREE.Vector3(0.008, 0.024, 0.075) }, uWidth: { value: 0.035 }, uCurve: { value: 0.0 },
        uRate: { value: 0.02 }, uKinks: { value: 1 }, uForward: { value: 0.5 },
      });
      const dust = tail(TAIL_POINTS, {
        uColor: { value: new THREE.Vector3(0.05, 0.042, 0.027) }, uWidth: { value: 0.2 }, uCurve: { value: 0.55 },
        uRate: { value: 0.008 }, uKinks: { value: 0 }, uForward: { value: 5 },
      });

      const comet = {
        name: def.name, kind: 'comet', def, a, e, b: a * Math.sqrt(1 - e * e), orient,
        mesh, glow, ion, dust, size: def.size, radius: def.size,
        velocity: new THREE.Vector3(), activity: 0, chunks: [], regrow: 0, rand,
        spin: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.12),
      };
      this.place(comet, 0);
      for (let i = 0; i < CHUNKS; i++) this.addChunk(comet, shapes, materials);
      comet.shapes = shapes;
      comet.materials = materials;
      this.list.push(comet);
    });
  }

  // A chunk of ice drifting beside the nucleus: an ordinary minable rock that rides along with the comet
  addChunk(comet, shapes, materials) {
    const rand = comet.rand;
    const size = 2 + rand() * 3.5;
    const mesh = makeRock(shapes[Math.floor(rand() * shapes.length)], materials.ice, size);
    const dir = new THREE.Vector3(rand() - 0.5, (rand() - 0.5) * 0.6, rand() - 0.5).normalize();
    const offset = dir.multiplyScalar(comet.size * 2.2 + 25 + rand() * 110);
    mesh.position.copy(comet.mesh.position).add(offset);
    mesh.rotation.set(rand() * 6, rand() * 6, rand() * 6);
    const ss = this.solarSystem;
    ss.asteroidGroup.add(mesh);
    const chunk = {
      name: `${comet.name}-Eis ${++this.chunkId}`, kind: 'asteroid', mesh, size, rockKind: 'ice', hp: size * 9, maxHp: size * 9,
      spin: new THREE.Vector3((rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3), field: comet.name, offset,
    };
    ss.asteroids.push(chunk);
    comet.chunks.push(chunk);
  }

  chunkId = 0;

  // Position on the ellipse at a time, from Kepler's equation
  place(comet, time) {
    const { def, a, b, e } = comet;
    let M = ((time / def.period + def.phase) % 1) * Math.PI * 2;
    let E = M;
    for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    comet.mesh.position.set(a * (Math.cos(E) - e), 0, -b * Math.sin(E)).applyQuaternion(comet.orient);
  }

  nearest(pos, range) {
    let best = null;
    let bestD = range;
    for (const c of this.list) {
      const d = c.mesh.position.distanceTo(pos);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  update(delta, time) {
    for (const c of this.list) {
      _prev.copy(c.mesh.position);
      this.place(c, time);
      if (delta > 0) {
        c.velocity.copy(c.mesh.position).sub(_prev).divideScalar(delta);
        c.mesh.rotation.x += c.spin.x * delta;
        c.mesh.rotation.y += c.spin.y * delta;
        c.chunks = c.chunks.filter((k) => k.mesh.parent);
        if (c.chunks.length < CHUNKS) {
          c.regrow += delta;
          if (c.regrow > CHUNK_REGROW) {
            c.regrow = 0;
            this.addChunk(c, c.shapes, c.materials);
          }
        }
      }
      c.chunks.forEach((k) => k.mesh.position.copy(c.mesh.position).add(k.offset));

      // The ice wakes up inside about Mars's orbit and boils hardest at perihelion
      const r = c.mesh.position.length();
      c.activity = THREE.MathUtils.clamp((2300 / r) ** 2 - 0.12, 0, 1.6);
      const act = c.activity;
      _away.copy(c.mesh.position).normalize();
      _back.copy(c.velocity);
      if (_back.lengthSq() < 1e-8) _back.set(0, 0, 1);
      _back.normalize().negate();
      _side.crossVectors(_away, UP);
      if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
      _side.normalize();
      [[c.ion, ION_LENGTH], [c.dust, DUST_LENGTH]].forEach(([tail, length]) => {
        tail.visible = act > 0.01;
        tail.position.copy(c.mesh.position);
        const u = tail.material.uniforms;
        u.uAway.value.copy(_away);
        u.uBack.value.copy(_back);
        u.uSide.value.copy(_side);
        u.uActivity.value = Math.min(1.3, act);
        u.uLength.value = length * (0.25 + 0.75 * Math.min(1.2, act));
      });
      c.glow.visible = act > 0.01;
      c.glow.position.copy(c.mesh.position);
      c.glowSize = c.size * (7 + 18 * act);
      c.glow.scale.setScalar(c.glowSize);
    }
  }

  // Right before rendering
  updateView(camera, time, renderer) {
    this.shared.uTime.value = time;
    const height = renderer ? renderer.getDrawingBufferSize(_size).y : window.innerHeight;
    this.shared.uPixelScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    // The coma is a thin haze: seen from inside it all but vanishes, and the dark nucleus shows
    for (const c of this.list) {
      const near = THREE.MathUtils.smoothstep(camera.position.distanceTo(c.mesh.position), c.glowSize * 0.15, c.glowSize * 2.5);
      const k = c.activity * (0.06 + 0.3 * near);
      c.glow.material.color.setRGB(0.5 * k, 0.9 * k, 0.6 * k);
    }
  }
}
