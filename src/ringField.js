import * as THREE from 'three';
import { saturnRing } from './planets';

// Saturn's rings from inside. From afar they are a painted disc; close to the ring plane the disc dissolves into
// what it is made of: countless lumps of water ice, from dust to boulders, in a sheet only tens of metres thick.
// Grains and boulders exist only around the ship and are laid out by the same density profile that paints the
// disc, so the Cassini division really is empty and the B ring really is crowded. With the Sun behind them the
// grains light up (ice scatters forwards). Boulders are solid: hitting one hurts.

const BOX = 260;            // grains fill a box this far around the camera, in the ring plane
const THICKNESS = 14;       // half thickness of the sheet (drawn far thicker than the real 10 to 100 m)
const GRAINS = 9000;
const BOULDERS = 220;
const BOULDER_CELL = 520;   // boulders repeat in cells of this size
const NEAR_PLANE = 160;     // the field shows within this height of the ring plane

const REGIONS = [
  [1.11, 1.236, 'D-Ring'], [1.236, 1.527, 'C-Ring'], [1.527, 1.95, 'B-Ring'],
  [1.95, 2.025, 'Cassinische Teilung'], [2.025, 2.27, 'A-Ring'], [2.27, 2.36, 'F-Ring'],
];

const GRAIN_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aSeed;
uniform vec3 uCamRing;      // camera in the ring frame (planet-centred, y across the plane)
uniform mat3 uRingRot;      // ring frame -> world orientation
uniform vec3 uCentre;       // planet centre, world
uniform float uBox;
uniform float uThick;
uniform float uRadius;
uniform vec2 uRingRange;
uniform sampler2D uRingMap;
uniform vec3 uSunRing;
uniform float uPixelScale;
uniform float uLit;
varying float vBright;
void main() {
  // Wrap the grains around the camera so the field never ends
  vec2 xz = (fract(aSeed.xz - uCamRing.xz / uBox) - 0.5) * uBox + uCamRing.xz;
  float y = (aSeed.y - 0.5) * 2.0;
  y = y * abs(y) * uThick;
  vec3 p = vec3(xz.x, y, xz.y);
  float r = length(xz) / uRadius;
  float s = (r - uRingRange.x) / (uRingRange.y - uRingRange.x);
  float dens = (s < 0.0 || s > 1.0) ? 0.0 : texture2D(uRingMap, vec2(s, 0.5)).a;
  vec3 toCam = uCamRing - p;
  float d = length(toCam);
  float fade = (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, d)) * smoothstep(0.6, 3.0, d);
  // Fewer grains where the ring is thin: each grain shows only if the density beats its own threshold
  float show = step(aSeed.w * 0.9, dens);
  vec3 world = uCentre + uRingRot * p;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((0.04 + 0.16 * aSeed.w * aSeed.w) * uPixelScale / -mv.z, 1.0, 7.0);
  #include <logdepthbuf_vertex>
  float forward = pow(max(dot(normalize(-toCam), uSunRing), 0.0), 8.0);
  vBright = show * fade * uLit * (0.35 + 0.5 * aSeed.y + 4.0 * forward);
}
`;

const GRAIN_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
varying float vBright;
void main() {
  #include <logdepthbuf_fragment>
  if (vBright <= 0.003) discard;
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vec3(0.95, 0.9, 0.8) * vBright * (1.0 - r2), 1.0);
}
`;

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _cam = new THREE.Vector3();
const _ship = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _size = new THREE.Vector2();
const dummy = new THREE.Object3D();

function hash(i, k) {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class RingField {
  constructor(game, shapes, materials) {
    this.game = game;
    const ss = game.solarSystem;
    this.planet = ss.planets.find((p) => p.name === 'Saturn');
    this.region = null;
    this.inside = false;
    const bu = this.planet.body.uniforms;

    const seeds = new Float32Array(GRAINS * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GRAINS * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.uniforms = {
      uCamRing: { value: new THREE.Vector3() }, uRingRot: { value: new THREE.Matrix3() }, uCentre: { value: new THREE.Vector3() },
      uBox: { value: BOX }, uThick: { value: THICKNESS }, uRadius: { value: this.planet.radius },
      uRingRange: bu.uRingRange, uRingMap: bu.uRingMap, uSunRing: { value: new THREE.Vector3(1, 0, 0) },
      uPixelScale: { value: 500 }, uLit: { value: 1 },
    };
    this.grains = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: GRAIN_VERTEX, fragmentShader: GRAIN_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.grains.frustumCulled = false;
    this.grains.renderOrder = 4;
    this.grains.visible = false;
    game.scene.add(this.grains);

    // Boulders: one fixed pattern per cell, repeated; each cell position decides by the ring's density whether its
    // boulders exist there
    this.boulders = new THREE.InstancedMesh(shapes[2][1], materials.ice, BOULDERS);
    this.boulders.frustumCulled = false;
    this.boulders.visible = false;
    game.scene.add(this.boulders);
    this.pattern = [];
    for (let i = 0; i < BOULDERS; i++) {
      this.pattern.push({
        x: hash(i, 1) * BOULDER_CELL, z: hash(i, 2) * BOULDER_CELL, y: (hash(i, 3) - 0.5) * THICKNESS * 1.2,
        size: 0.5 + 5.5 * hash(i, 4) ** 3, need: hash(i, 5) * 0.85,
        rot: new THREE.Euler(hash(i, 6) * 6, hash(i, 7) * 6, hash(i, 8) * 6), spin: (hash(i, 9) - 0.5) * 0.4,
      });
    }
    this.live = [];
  }

  // Ring-frame coordinates of a world point
  toRing(world, out) {
    return out.copy(world).sub(this.planet.group.position).applyQuaternion(_qi);
  }

  regionAt(r) {
    const hit = REGIONS.find(([a, b]) => r >= a && r < b);
    return hit ? hit[2] : null;
  }

  // Each frame in space: where the ship is against the rings, the boulders around it, and bumping into them
  update(delta, time) {
    const g = this.game;
    const ship = g.ship;
    const p = this.planet;
    p.body.tilt.getWorldQuaternion(_q);
    _qi.copy(_q).invert();
    this.toRing(ship.position, _ship);
    const R = p.radius;
    const r = Math.hypot(_ship.x, _ship.z) / R;
    const near = Math.abs(_ship.y) < NEAR_PLANE && r > 1.05 && r < 2.45 && !g.surface.active;
    this.inside = near;
    this.grains.visible = near;
    this.boulders.visible = near;
    if (!near) {
      this.region = null;
      return;
    }

    // Crossing into a ring or a gap
    const region = Math.abs(_ship.y) < THICKNESS * 2 ? this.regionAt(r) : null;
    if (region !== this.region) {
      this.region = region;
      if (region && !ship.isDocked) g.hud.toast(`Saturnringe · ${region}`, 'info');
    }

    // Boulders in the cells around the ship
    const cx = Math.floor(_ship.x / BOULDER_CELL);
    const cz = Math.floor(_ship.z / BOULDER_CELL);
    let n = 0;
    this.live.length = 0;
    const range = BOULDER_CELL * 0.75;
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        for (let i = (Math.abs(ix * 7 + iz * 13) % 3); i < BOULDERS && n < BOULDERS; i += 3) {
          const b = this.pattern[i];
          const x = ix * BOULDER_CELL + b.x;
          const z = iz * BOULDER_CELL + b.z;
          if (Math.abs(x - _ship.x) > range || Math.abs(z - _ship.z) > range) continue;
          if (saturnRing(Math.hypot(x, z) / R).dens < b.need) continue;
          _p.set(x, b.y, z).applyQuaternion(_q).add(p.group.position);
          dummy.position.copy(_p);
          dummy.rotation.set(b.rot.x + time * b.spin, b.rot.y, b.rot.z + time * b.spin * 0.7);
          dummy.scale.setScalar(b.size);
          dummy.updateMatrix();
          this.boulders.setMatrixAt(n++, dummy.matrix);
          this.live.push(_p.x, _p.y, _p.z, b.size);
        }
      }
    }
    this.boulders.count = n;
    this.boulders.instanceMatrix.needsUpdate = true;

    if (delta > 0 && !ship.isDocked && !ship.isDestroyed && !ship.isWarping && !ship.autopilotActive) {
      for (let i = 0; i < this.live.length; i += 4) {
        _p.set(this.live[i], this.live[i + 1], this.live[i + 2]);
        const size = this.live[i + 3];
        const reach = size + ship.radius;
        _n.copy(ship.position).sub(_p);
        const d = _n.length();
        if (d < reach) {
          _n.divideScalar(d || 1);
          ship.position.copy(_p).addScaledVector(_n, reach);
          g.bump(_n.clone(), p.velocity, size);
          g.fx.rockHit(ship.position.clone().addScaledVector(_n, -ship.radius), _n.clone());
          break;
        }
      }
    }
  }

  // Right before rendering
  updateView(camera, renderer) {
    if (!this.inside) return;
    const p = this.planet;
    const u = this.uniforms;
    this.toRing(camera.position, _cam);
    u.uCamRing.value.copy(_cam);
    u.uRingRot.value.setFromMatrix4(_m.makeRotationFromQuaternion(_q));
    u.uCentre.value.copy(p.group.position);
    u.uSunRing.value.copy(p.group.position).negate().normalize().applyQuaternion(_qi);
    u.uLit.value = 0.15 + 0.85 * this.game.solarSystem.sunVisibility;
    const height = renderer.getDrawingBufferSize(_size).y;
    u.uPixelScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}
