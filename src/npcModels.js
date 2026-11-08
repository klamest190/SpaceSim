import * as THREE from 'three';
import { section, loft, finish, strut, merge, nacelle, glowTexture, makeHullTextures, makeEnvironment, rng } from './shipModel';

// Everyone else in the system, built from the same faceted kit as the player's freighter so they share its
// painted, worn look. One glance tells who is who: pirates are jagged and soot-black with rust and red,
// SOLPOL is clean white with a blue flash and police strobes, civilians are bulky and sun-bleached.
// Geometry is built once per class and shared. -Z is forward.

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A flat plate: polygon in the XZ plane (x, z pairs), from y0 up to y1
function plate(points, y0, y1) {
  const shape = points.map(([x, z]) => new THREE.Vector2(x, z));
  if (THREE.ShapeUtils.isClockWise(shape)) shape.reverse();
  const faces = THREE.ShapeUtils.triangulateShape(shape, []);
  const pos = [];
  const push = (v) => pos.push(v.x, v.y, v.z);
  const at = (p, y) => V(p.x, y, p.y);
  faces.forEach(([a, b, c]) => {
    push(at(shape[a], y1)); push(at(shape[c], y1)); push(at(shape[b], y1));
    push(at(shape[a], y0)); push(at(shape[b], y0)); push(at(shape[c], y0));
  });
  for (let i = 0; i < shape.length; i++) {
    const p = shape[i], q = shape[(i + 1) % shape.length];
    push(at(p, y0)); push(at(q, y0)); push(at(q, y1));
    push(at(p, y0)); push(at(q, y1)); push(at(p, y1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

const mirrorX = (points) => points.map(([x, z]) => [-x, z]);

// A plate on both sides of the hull
function wings(points, y0, y1) {
  return [plate(points, y0, y1), plate(mirrorX(points), y0, y1)];
}

// A vertical fin: polygon given as (y, z) pairs at side offset x
function fin(points, x, thick) {
  const g = plate(points, -thick / 2, thick / 2);
  g.rotateZ(Math.PI / 2);
  g.translate(x, 0, 0);
  return g;
}

function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function barrel(x, y, z0, z1, thick = 0.14) {
  return strut(V(x, y, z0), V(x, y, z1), thick);
}

function body(rings) {
  return loft(rings.map((r) => section(...r)));
}

function tube(profile, x, y, segments = 8) {
  const g = nacelle(profile, segments);
  g.translate(x, y, 0);
  return g;
}

const C = {
  soot: new THREE.Color(0x24211f), sootHi: new THREE.Color(0x3b3530), rust: new THREE.Color(0x6e3418), blood: new THREE.Color(0x8c1a12),
  white: new THREE.Color(0xc8ccd0), whiteDim: new THREE.Color(0x8d939a), navy: new THREE.Color(0x1d3a70), steel: new THREE.Color(0x4b5157),
  sand: new THREE.Color(0x9c9078), rustCiv: new THREE.Color(0x7a5a3c), red: new THREE.Color(0x8a2c20), blue: new THREE.Color(0x2a5a8c), ochre: new THREE.Color(0xa8761f), dark: new THREE.Color(0x26272a),
};

const piratePaint = (c, n) => {
  if (n.y > 0.6 && Math.abs(c.x) > 1.4) return C.blood;
  if (c.z < -1.6) return C.blood;
  if (Math.abs(n.x) > 0.7) return C.rust;
  return n.y > 0.2 ? C.sootHi : C.soot;
};

const policePaint = (c, n) => {
  if (n.y < -0.4) return C.steel;
  if (Math.abs(c.z) < 0.7 && n.y > -0.2) return C.navy; // the blue band round the waist
  if (c.z < -2.2) return C.navy;
  return n.y > 0.3 ? C.white : C.whiteDim;
};

// Each class: parts, paint, nozzles (x, y, z, size), nav lights
const BUILDERS = {
  crow() {
    return {
      paint: piratePaint,
      parts: [
        body([[-3.2, 0.1, 0.08, -0.06], [-1.8, 0.42, 0.3, -0.2], [-0.2, 0.68, 0.5, -0.32], [1.5, 0.55, 0.36, -0.3], [2.1, 0.34, 0.24, -0.2]]),
        ...wings([[0.5, 0.5], [3.3, -2.0], [3.6, -1.1], [2.2, 0.5], [0.5, 1.8]], -0.08, 0.04),
        fin([[0.3, 0.4], [1.5, 1.5], [1.5, 2.0], [0.3, 1.7]], 0, 0.08),
        fin([[-0.2, 0.9], [-1.0, 1.9], [-0.2, 1.9]], 0, 0.08),
        barrel(3.4, -0.02, -1.4, -2.9, 0.1), barrel(-3.4, -0.02, -1.4, -2.9, 0.1),
        tube([[1.3, 0.2], [2.25, 0.3], [2.45, 0.26]], 0.3, 0),
        tube([[1.3, 0.2], [2.25, 0.3], [2.45, 0.26]], -0.3, 0),
      ],
      nozzles: [[0.3, 0, 2.5, 0.6], [-0.3, 0, 2.5, 0.6]],
      muzzles: [[3.4, 0, -3], [-3.4, 0, -3]],
      lights: [[3.5, 0.05, -0.6, 0xff2a1a], [-3.5, 0.05, -0.6, 0xff2a1a]],
    };
  },
  jackal() {
    const boom = (x) => tube([[-2.6, 0.14], [-1.8, 0.42], [1.6, 0.5], [2.6, 0.36], [2.9, 0.4]], x, -0.1);
    return {
      paint: piratePaint,
      parts: [
        body([[-3.3, 0.16, 0.12, -0.1], [-2.0, 0.6, 0.5, -0.3], [-0.3, 0.9, 0.72, -0.44], [1.4, 0.72, 0.52, -0.4], [2.0, 0.42, 0.3, -0.22]]),
        boom(2.1), boom(-2.1),
        ...wings([[0.7, -0.6], [2.0, -0.9], [4.0, 0.8], [4.0, 1.5], [0.7, 1.2]], -0.12, 0.05),
        fin([[0.5, 0.2], [2.0, 1.6], [2.0, 2.4], [0.5, 1.6]], 0, 0.1),
        barrel(2.1, -0.32, -2.4, -3.8, 0.14), barrel(-2.1, -0.32, -2.4, -3.8, 0.14),
        barrel(0, -0.42, -1.2, -3.2, 0.12),
      ],
      nozzles: [[2.1, -0.1, 3, 0.8], [-2.1, -0.1, 3, 0.8]],
      muzzles: [[2.1, -0.3, -3.9], [-2.1, -0.3, -3.9]],
      lights: [[4, 0.05, 1.2, 0xff2a1a], [-4, 0.05, 1.2, 0xff2a1a]],
    };
  },
  brute() {
    return {
      paint: piratePaint,
      parts: [
        body([[-6.6, 0.8, 0.5, -0.6], [-4.6, 1.8, 1.1, -1.1], [-1, 2.5, 1.7, -1.5], [3, 2.6, 1.6, -1.6], [5.4, 2.0, 1.3, -1.2]]),
        box(1.6, 1, 4.4, 3.1, 1.1, -1), box(1.6, 1, 4.4, -3.1, 1.1, -1),
        box(2.2, 0.9, 3, 0, 1.9, 1.4),
        ...wings([[2.3, -1], [5.4, 0.8], [5.4, 3], [2.3, 3.6]], -0.3, 0.15),
        fin([[1.5, 1], [3.6, 3.8], [3.6, 5], [1.5, 4.4]], 0, 0.2),
        barrel(1.6, 1.6, -2.4, -5.4, 0.22), barrel(-1.6, 1.6, -2.4, -5.4, 0.22),
        barrel(3.1, 1.2, -2.8, -5.0, 0.2), barrel(-3.1, 1.2, -2.8, -5.0, 0.2),
        tube([[4.8, 0.7], [6, 0.9], [6.5, 0.8]], 1.3, -0.1),
        tube([[4.8, 0.7], [6, 0.9], [6.5, 0.8]], -1.3, -0.1),
      ],
      nozzles: [[1.3, -0.1, 6.6, 1.5], [-1.3, -0.1, 6.6, 1.5]],
      muzzles: [[1.6, 1.6, -5.5], [-1.6, 1.6, -5.5], [3.1, 1.2, -5.1], [-3.1, 1.2, -5.1]],
      lights: [[5.4, 0.2, 2.5, 0xff2a1a], [-5.4, 0.2, 2.5, 0xff2a1a], [0, 3.8, 4.6, 0xff4010]],
    };
  },
  queen() {
    const parts = [
      body([[-46, 2, 2, -2], [-36, 10, 4, -5], [-14, 14, 7, -8], [14, 15, 8, -9], [36, 13, 8, -8], [44, 10, 6, -6]]),
      box(10, 5, 26, 0, 9, 8), box(6, 7, 8, 0, 14, 14), box(3, 7, 3, 0, 20, 14),
      box(5, 4, 44, 15, -1, 2), box(5, 4, 44, -15, -1, 2),
      ...wings([[12, -24], [30, -6], [30, 22], [12, 30]], -1.2, 0.6),
      fin([[8, 18], [22, 34], [22, 42], [8, 38]], 0, 1),
      fin([[-8, 14], [-20, 34], [-20, 42], [-8, 38]], 0, 1),
      barrel(6, 4, -30, -50, 1), barrel(-6, 4, -30, -50, 1),
    ];
    for (let i = 0; i < 3; i++) parts.push(tube([[42, 3], [47, 4.2], [50, 3.6]], -9 + i * 9, 0));
    return {
      paint: (c, n) => {
        if (Math.abs(c.x) > 22) return C.blood;
        if (c.z < -30) return C.blood;
        if (n.y > 0.5 && Math.floor(c.z / 12) % 2 === 0) return C.sootHi;
        return Math.abs(n.x) > 0.7 ? C.rust : C.soot;
      },
      parts,
      nozzles: [[-9, 0, 50, 7], [0, 0, 50, 7], [9, 0, 50, 7]],
      muzzles: [[6, 4, -50], [-6, 4, -50], [15, 3, -18], [-15, 3, -18], [15, 3, 20], [-15, 3, 20], [0, 16, 12]],
      lights: [[30, 1, 6, 0xff2a1a], [-30, 1, 6, 0xff2a1a], [0, 23, 14, 0xff4010], [0, 22, 38, 0xff2a1a], [0, -20, 38, 0xff2a1a]],
    };
  },
  turret() {
    return {
      paint: (c, n) => (c.y < -0.6 ? C.soot : Math.abs(n.x) > 0.6 ? C.rust : C.sootHi),
      parts: [
        box(3.4, 0.8, 3.4, 0, -1.4, 0),
        tube([[-1.5, 0.8], [-0.6, 1.5], [0.8, 1.5], [1.5, 0.8]], 0, 0, 10),
        barrel(0.6, 0, -1, -4.6, 0.24), barrel(-0.6, 0, -1, -4.6, 0.24),
      ],
      nozzles: [],
      muzzles: [[0.6, 0, -4.7], [-0.6, 0, -4.7]],
      lights: [[0, 1.5, 0, 0xff2a1a]],
    };
  },
  patrol() {
    return {
      paint: policePaint,
      parts: [
        body([[-3.5, 0.14, 0.08, -0.08], [-2.2, 0.5, 0.3, -0.22], [-0.4, 0.76, 0.52, -0.34], [1.6, 0.72, 0.44, -0.34], [2.3, 0.46, 0.3, -0.24]]),
        ...wings([[0.6, -0.5], [3.1, 1.1], [3.1, 2.0], [0.6, 1.8]], -0.06, 0.06),
        fin([[0.4, 0.6], [1.5, 1.8], [1.5, 2.3], [0.4, 2.0]], 0, 0.08),
        barrel(3.1, 0, -0.5, -2.2, 0.1), barrel(-3.1, 0, -0.5, -2.2, 0.1),
        tube([[1.6, 0.24], [2.4, 0.34], [2.7, 0.3]], 0.4, 0),
        tube([[1.6, 0.24], [2.4, 0.34], [2.7, 0.3]], -0.4, 0),
      ],
      nozzles: [[0.4, 0, 2.8, 0.7], [-0.4, 0, 2.8, 0.7]],
      muzzles: [[3.1, 0, -2.3], [-3.1, 0, -2.3]],
      strobes: [[3.1, 0.15, 1.6, 0x2060ff], [-3.1, 0.15, 1.6, 0xff2020]],
    };
  },
  cutter() {
    return {
      paint: policePaint,
      parts: [
        body([[-7, 0.5, 0.4, -0.4], [-4.8, 1.7, 1, -0.9], [-1.2, 2.5, 1.6, -1.4], [3.4, 2.6, 1.6, -1.6], [6, 2.0, 1.2, -1.2]]),
        box(2.4, 1.1, 4, 0, 2.0, 0.6), box(1.2, 0.8, 1.2, 0, 2.9, 1),
        ...wings([[2.4, 0], [5, 1.6], [5, 4.4], [2.4, 5]], -0.2, 0.15),
        barrel(1.4, 1.2, -2, -5.8, 0.22), barrel(-1.4, 1.2, -2, -5.8, 0.22),
        tube([[5.4, 0.8], [6.6, 1], [7.2, 0.9]], 1.4, 0), tube([[5.4, 0.8], [6.6, 1], [7.2, 0.9]], -1.4, 0),
      ],
      nozzles: [[1.4, 0, 7.3, 1.6], [-1.4, 0, 7.3, 1.6]],
      muzzles: [[1.4, 1.2, -5.9], [-1.4, 1.2, -5.9]],
      strobes: [[5, 0.3, 3, 0x2060ff], [-5, 0.3, 3, 0xff2020], [0, 3.4, 1, 0x2060ff]],
    };
  },
  freighter() {
    const rand = rng(11);
    const crates = [];
    for (let z = -5.5; z <= 4; z += 2.5) {
      [[-1.5, 0.8], [1.5, 0.8], [-1.5, -0.9], [1.5, -0.9], [0, 1.65]].forEach(([x, y]) => {
        if (rand() < 0.86) crates.push(box(1.42, 1.42, 2.25, x, y, z));
      });
    }
    return {
      paint: (c, n) => {
        if (Math.abs(c.x) < 0.5 && Math.abs(c.y) < 0.75) return C.dark;
        if (c.z < -7.2) return C.sand;
        if (c.z > 5.4) return C.rustCiv;
        const key = Math.abs(Math.floor(c.z / 2.5) * 7 + Math.round(c.x) * 3 + Math.round(c.y) * 5) % 4;
        const tone = [C.red, C.blue, C.ochre, C.sand][key];
        return n.y > 0.5 ? tone : tone.clone().multiplyScalar(0.72);
      },
      parts: [
        ...crates,
        box(0.9, 1.1, 15, 0, 0, -0.5),
        body([[-10, 0.6, 0.5, -0.5], [-8.8, 1.3, 1.1, -0.9], [-7.2, 1.5, 1.3, -1.1]]),
        body([[5.6, 1.5, 1.1, -1.1], [7.2, 1.9, 1.3, -1.3], [8.2, 1.6, 1.1, -1.1]]),
        tube([[7.8, 0.6], [8.9, 0.8], [9.4, 0.72]], 1, 0), tube([[7.8, 0.6], [8.9, 0.8], [9.4, 0.72]], -1, 0),
      ],
      nozzles: [[1, 0, 9.5, 1.4], [-1, 0, 9.5, 1.4]],
      muzzles: [],
      lights: [[1.9, 1, 7, 0x40ff60], [-1.9, 1, 7, 0xff3020]],
    };
  },
  courier() {
    return {
      paint: (c, n) => (c.z < -1.2 ? C.ochre : n.y > 0.2 ? C.sand : C.dark),
      parts: [
        body([[-3.4, 0.12, 0.08, -0.08], [-1.8, 0.42, 0.3, -0.2], [0.8, 0.56, 0.38, -0.28], [2.2, 0.42, 0.28, -0.22]]),
        ...wings([[0.4, 0.6], [1.8, 1.8], [1.8, 2.4], [0.4, 2.1]], -0.05, 0.05),
        tube([[1.8, 0.3], [2.4, 0.36], [2.7, 0.32]], 0, 0),
      ],
      nozzles: [[0, 0, 2.8, 0.8]],
      muzzles: [],
      lights: [[1.8, 0.1, 2.1, 0x40ff60], [-1.8, 0.1, 2.1, 0xff3020]],
    };
  },
};

const ENGINE_COLOR = { pirate: new THREE.Color(2.4, 0.7, 0.22), police: new THREE.Color(0.5, 1.1, 2.8), civil: new THREE.Color(2.2, 1.5, 0.6) };

class Kit {
  constructor(renderer) {
    const tex = makeHullTextures();
    const env = renderer ? makeEnvironment(renderer) : null;
    this.hullMat = new THREE.MeshStandardMaterial({
      vertexColors: true, map: tex.map, bumpMap: tex.bumpMap, bumpScale: 1.1, roughnessMap: tex.roughnessMap,
      roughness: 0.72, metalness: 0.4, envMap: env, envMapIntensity: 0.85, flatShading: true, side: THREE.DoubleSide,
    });
    this.hullTex = tex;
    this.env = env;
    this.glow = glowTexture();
    this.cache = {};
    this.lightMats = {};
  }

  lightMat(color, hdr = 2.4) {
    const key = `${color}:${hdr}`;
    if (!this.lightMats[key]) {
      this.lightMats[key] = new THREE.SpriteMaterial({
        map: this.glow, color: new THREE.Color(color).multiplyScalar(hdr),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      });
    }
    return this.lightMats[key];
  }

  blueprint(type) {
    if (!this.cache[type]) {
      const spec = BUILDERS[type]();
      const geometry = finish(merge(spec.parts), spec.paint, type === 'queen' ? 0.18 : 0.42);
      this.cache[type] = { ...spec, geometry };
    }
    return this.cache[type];
  }
}

let kit = null;

export function modelKit(renderer) {
  if (!kit) kit = new Kit(renderer);
  return kit;
}

// A new visual for ship class `type`; update() runs the engines and lights
export class ShipVisual {
  constructor(type, faction, renderer) {
    const k = modelKit(renderer);
    const spec = k.blueprint(type);
    this.group = new THREE.Group();
    const mesh = new THREE.Mesh(spec.geometry, k.hullMat);
    this.group.add(mesh);

    this.muzzles = spec.muzzles.map(([x, y, z]) => V(x, y, z));
    this.nozzles = spec.nozzles.map(([x, y, z, size]) => {
      const sprite = new THREE.Sprite(this.engineMat(k, faction));
      sprite.position.set(x, y, z);
      sprite.scale.setScalar(size);
      this.group.add(sprite);
      return { sprite, size };
    });
    this.tail = spec.nozzles.length ? V(0, spec.nozzles[0][1], spec.nozzles[0][2]) : V(0, 0, 0);
    (spec.lights || []).forEach(([x, y, z, color]) => {
      const s = new THREE.Sprite(k.lightMat(color));
      s.position.set(x, y, z);
      s.scale.setScalar(type === 'queen' ? 3.5 : 0.7);
      this.group.add(s);
    });
    this.strobes = (spec.strobes || []).map(([x, y, z, color], i) => {
      const s = new THREE.Sprite(k.lightMat(color, 4));
      s.position.set(x, y, z);
      s.scale.setScalar(type === 'cutter' ? 2.6 : 1.6);
      this.group.add(s);
      return { sprite: s, phase: i % 2 };
    });
    this.time = Math.random() * 3;
    this.nozzleLevel = -1;
  }

  engineMat(k, faction) {
    const key = `engine:${faction}`;
    if (!k.lightMats[key]) {
      k.lightMats[key] = new THREE.SpriteMaterial({
        map: k.glow, color: ENGINE_COLOR[faction] || ENGINE_COLOR.civil,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      });
    }
    return k.lightMats[key];
  }

  update(dt, thrust) {
    this.time += dt;
    const flicker = 0.9 + Math.sin(this.time * 41) * 0.1;
    this.nozzles.forEach((n) => n.sprite.scale.setScalar(n.size * (0.55 + thrust * 1.1) * flicker));
    // Police lights flash alternately, fast
    if (this.strobes.length) {
      const beat = Math.floor(this.time * 7) % 4;
      this.strobes.forEach((s) => { s.sprite.visible = beat === s.phase * 2; });
    }
  }
}
