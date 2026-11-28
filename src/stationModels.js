import * as THREE from 'three';
import { finish, merge, strut, nacelle, rng, hardSurface } from './shipModel';
import { modelKit } from './npcModels';

// Space stations you can feel the size of: 20 times the length of your ship. Four shapes, one per kind of place:
// 'ring' a turning habitat wheel, 'spindle' a stack of lit drums on a long axis, 'mine' a rusty rig bolted
// to a rock, 'nest' a pirate warren dug into an asteroid. All have lit windows and blinking beacons.
// Built around the origin; `size` is the bounding radius in world units. Parts in `spinning` turn slowly.

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Window lights: a dark texture with little warm rectangles, used as emissive map
function windowTexture(cols, rows, seed, lit = 0.42, tint = [255, 214, 150]) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const rand = rng(seed);
  const w = c.width / cols, h = c.height / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (rand() > lit) continue;
      const v = 0.55 + rand() * 0.45;
      g.fillStyle = `rgb(${tint[0] * v | 0},${tint[1] * v | 0},${tint[2] * v | 0})`;
      g.fillRect(x * w + w * 0.2, y * h + h * 0.28, w * 0.6, h * 0.44);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The ships' plating, tiled at a station's scale (a texture tile per few metres, not one across a whole drum)
function stationTextures(k) {
  if (!k.stationTex) {
    const tile = (t) => { const c = t.clone(); c.repeat.set(6, 3); return c; };
    k.stationTex = { map: tile(k.hullTex.map), normalMap: tile(k.hullTex.normalMap), orm: tile(k.hullTex.roughnessMap) };
  }
  return k.stationTex;
}

// Weathered metal plating; reflections from scene.environment (envProbe.js)
function hullMaterial(k, color, windows = null, roughness = 0.5) {
  const t = stationTextures(k);
  return hardSurface(new THREE.MeshStandardMaterial({
    color, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: t.orm, metalnessMap: t.orm,
    roughness, metalness: 0.6, envMapIntensity: 1.0,
    emissive: windows ? 0xffffff : 0x000000, emissiveMap: windows, emissiveIntensity: windows ? 1.4 : 0,
  }));
}

const paintFlat = (color) => {
  const col = new THREE.Color(color);
  return () => col;
};

function addStruts(list, material, parent) {
  const geo = finish(merge(list), paintFlat(0xffffff), 0.3);
  const mesh = new THREE.Mesh(geo, material);
  parent.add(mesh);
  return mesh;
}

function solarWing(parent, k, x, length, width) {
  const mat = hardSurface(new THREE.MeshStandardMaterial({ color: 0x14306a, roughness: 0.22, metalness: 0.75, envMapIntensity: 1.2, emissive: 0x050c22 }));
  const frame = new THREE.MeshStandardMaterial({ color: 0x5a5e62, roughness: 0.5, metalness: 0.7 });
  const n = 4;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(length / n - 0.3, 0.1, width), mat);
    m.position.set(x + Math.sign(x) * ((i + 0.5) * length) / n, 0, 0);
    parent.add(m);
  }
  const spar = new THREE.Mesh(new THREE.BoxGeometry(length, 0.22, 0.3), frame);
  spar.position.set(x + (Math.sign(x) * length) / 2, 0.05, 0);
  parent.add(spar);
}

function beacons(k, parent, points, color, size = 1.4) {
  const list = [];
  points.forEach((p, i) => {
    const s = new THREE.Sprite(k.lightMat(color, 3));
    s.position.set(p[0], p[1], p[2]);
    s.scale.setScalar(size);
    parent.add(s);
    list.push({ sprite: s, phase: i * 0.37 });
  });
  return list;
}

function ring(k, seed) {
  const group = new THREE.Group();
  const spinning = new THREE.Group();
  group.add(spinning);
  const metal = hullMaterial(k, 0xa2a59e);
  const dark = hullMaterial(k, 0x4d4f4f);

  const wheelTex = windowTexture(96, 6, seed);
  wheelTex.repeat.set(3, 1);
  const wheelMat = hullMaterial(k, 0xbdbdb2, wheelTex);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(19, 3, 8, 48), wheelMat);
  wheel.rotation.x = Math.PI / 2;
  spinning.add(wheel);

  const spokes = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    spokes.push(strut(V(Math.cos(a) * 4, 0, Math.sin(a) * 4), V(Math.cos(a) * 17, 0, Math.sin(a) * 17), 1.2, 1.5));
  }
  addStruts(spokes, dark, spinning);

  const hubTex = windowTexture(40, 10, seed + 1, 0.3, [190, 225, 255]);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 15, 12), hullMaterial(k, 0x9a9d96, hubTex));
  group.add(hub);
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 4.6, 3, 12), metal);
  capTop.position.y = 9;
  group.add(capTop);
  const capBot = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 2.4, 3, 12), metal);
  capBot.position.y = -9;
  group.add(capBot);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 11, 6), dark);
  mast.position.y = 15;
  group.add(mast);

  solarWing(group, k, 5.5, 18, 5);
  solarWing(group, k, -5.5, 18, 5);
  const list = beacons(k, group, [[0, 20.5, 0], [0, -11, 0], [24, 0, 0], [-24, 0, 0]], 0xff3020, 1.8);
  // Floodlights on the hub caps and a wing tip, thrown onto the wheel and the hub
  const floods = [[[0, 10.6, 0], [16, 0, 7]], [[0, -10.6, 0], [-16, 0, -7]], [[23.5, 0.4, 0], [4, 3, 0]]];
  return { group, spinning, spinRate: 0.06, beacons: list, floods };
}

function spindle(k, seed) {
  const group = new THREE.Group();
  const spinning = new THREE.Group();
  group.add(spinning);
  const dark = hullMaterial(k, 0x585a58);
  const metal = hullMaterial(k, 0xb0ada0);

  const axis = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 44, 10), dark);
  group.add(axis);
  [[-13, 6.5, 6], [-3, 9.5, 9], [8, 7.5, 7], [17, 4.5, 4]].forEach(([y, r, h], i) => {
    const tex = windowTexture(64, 8, seed + i, 0.5, i % 2 ? [190, 225, 255] : [255, 205, 140]);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 14), hullMaterial(k, 0xaaa89c, tex));
    drum.position.y = y;
    spinning.add(drum);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r, 1.6, 14), metal);
    lid.position.y = y + h / 2 + 0.8;
    spinning.add(lid);
    const under = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 0.5, 1.6, 14), metal);
    under.position.y = y - h / 2 - 0.8;
    spinning.add(under);
  });
  const arms = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    arms.push(strut(V(Math.cos(a) * 2, -8, Math.sin(a) * 2), V(Math.cos(a) * 15, -8, Math.sin(a) * 15), 0.9, 0.9));
  }
  addStruts(arms, dark, group);
  [0.4, 0.4 + Math.PI / 2, 0.4 + Math.PI, 0.4 + Math.PI * 1.5].forEach((a) => {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 2.6), metal);
    pod.position.set(Math.cos(a) * 16, -8, Math.sin(a) * 16);
    pod.rotation.y = -a;
    group.add(pod);
  });
  const list = beacons(k, group, [[0, 22.5, 0], [0, -22.5, 0], [16, -6, 7], [-16, -6, -7]], 0x30ff70, 1.8);
  const floods = [[[15.5, -6.5, 6.3], [6, -2, 1]], [[-15.5, -6.5, -6.3], [-8, 8, 0]], [[0, 22.2, 0], [4, 16, 2]]];
  return { group, spinning, spinRate: -0.08, beacons: list, floods };
}

// A knobbly rock (shared by the 'mine' and 'nest' stations)
function rock(radius, seed, color) {
  const geo = new THREE.IcosahedronGeometry(radius, 3);
  const pos = geo.attributes.position;
  const rand = rng(seed);
  const bumps = Array.from({ length: 12 }, () => ({ d: V(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), a: (rand() - 0.5) * 0.4 }));
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    let f = 1;
    bumps.forEach((b) => { f += b.a * Math.max(0, n.dot(b.d)) ** 3; });
    v.multiplyScalar(f);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.05, flatShading: true }));
}

function mine(k, seed) {
  const group = new THREE.Group();
  const spinning = new THREE.Group();
  group.add(spinning);
  group.add(rock(13, seed, 0x54483c));
  const rust = hullMaterial(k, 0x8a6a48);
  const dark = hullMaterial(k, 0x4f4d48);

  const scaffold = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    scaffold.push(strut(V(c * 11, 7, s * 11), V(c * 22, 7, s * 22), 0.7, 0.7));
    scaffold.push(strut(V(c * 22, 7, s * 22), V(Math.cos(a + Math.PI / 4) * 22, 7, Math.sin(a + Math.PI / 4) * 22), 0.5, 0.5));
    scaffold.push(strut(V(c * 22, 7, s * 22), V(c * 15, -5, s * 15), 0.5, 0.5));
  }
  addStruts(scaffold, dark, group);

  [[21, 7, 0], [-16, 7, 15], [3, 7, -21]].forEach(([x, y, z], i) => {
    const tex = windowTexture(24, 6, seed + i + 3, 0.45);
    const block = new THREE.Mesh(new THREE.BoxGeometry(9, 6, 8), hullMaterial(k, 0xa0855f, tex));
    block.position.set(x, y + 1.5, z);
    block.rotation.y = Math.atan2(x, z);
    group.add(block);
  });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 16, 8), rust);
  tower.position.set(0, 17, 0);
  group.add(tower);
  const head = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 5), hullMaterial(k, 0x9a9488, windowTexture(16, 4, seed + 9, 0.7, [190, 225, 255])));
  head.position.set(0, 26, 0);
  group.add(head);
  // Conveyor gantry turns over the rock
  const arm = new THREE.Mesh(new THREE.BoxGeometry(30, 0.8, 1.2), dark);
  arm.position.y = -7;
  spinning.add(arm);
  const list = beacons(k, group, [[0, 29, 0], [22, 7, 0], [-22, 7, 0], [0, 7, 22], [0, 7, -22]], 0xffa020, 1.8);
  // Work lights on the blocks and the tower head, raking across the rock and the scaffold
  const floods = [[[0, 27.6, 2.6], [10, 8, 4]], [[21, 11, 0], [4, 2, 2]], [[-16, 11, 15], [-4, 14, 2]]];
  return { group, spinning, spinRate: 0.14, beacons: list, floods };
}

function nest(k, seed) {
  const group = new THREE.Group();
  const spinning = new THREE.Group();
  group.add(spinning);
  group.add(rock(24, seed, 0x2f2a27));
  const rust = hullMaterial(k, 0x5a2a18);
  const dark = hullMaterial(k, 0x2b2826);
  const rand = rng(seed + 5);

  // Hangar mouths: lit red slits bored into the rock
  const redTex = windowTexture(12, 2, seed + 2, 0.9, [255, 70, 40]);
  [[0, 0, 26], [24, 4, -8], [-22, -3, -12]].forEach(([x, y, z]) => {
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 3), hullMaterial(k, 0x352320, redTex));
    mouth.position.set(x, y, z);
    mouth.lookAt(0, 0, 0);
    group.add(mouth);
  });
  // Spikes and gantries jutting out at all angles
  const spikes = [];
  for (let i = 0; i < 18; i++) {
    const d = V(rand() - 0.5, (rand() - 0.5) * 0.8, rand() - 0.5).normalize();
    spikes.push(strut(d.clone().multiplyScalar(20), d.clone().multiplyScalar(32 + rand() * 10), 1 + rand(), 1 + rand()));
  }
  addStruts(spikes, dark, group);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(30, 1.2, 5, 18), rust);
  collar.rotation.x = Math.PI / 2 + 0.25;
  spinning.add(collar);
  const list = beacons(k, group, [[0, 30, 0], [33, 0, 0], [-33, 0, 0], [0, -28, 0], [0, 0, 34], [0, 0, -34]], 0xff2010, 2.4);
  // Dim red work lights in the hangar mouths, washing the rock round them
  const floods = [[[0, 4, 29], [0, 0, 0], 0xff5030], [[27, 7, -9], [0, 0, 0], 0xff5030], [[-25, 0, -14], [0, 0, 0], 0xff5030]];
  return { group, spinning, spinRate: -0.05, beacons: list, floods };
}

// A pirate outpost: a smaller rock with a bolted-on habitat block, a hangar slit lit red, a landing pad, a
// turning radar dish and gun mounts (the turrets themselves are NPCs, see pirateBases.js)
function outpost(k, seed) {
  const group = new THREE.Group();
  const spinning = new THREE.Group();
  group.add(spinning);
  group.add(rock(11, seed, 0x3a332d));
  const rust = hullMaterial(k, 0x6a3a22);
  const dark = hullMaterial(k, 0x34302c);
  const hab = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 12, 10), hullMaterial(k, 0x6e665a, windowTexture(32, 6, seed + 4, 0.5, [255, 150, 80])));
  hab.rotation.z = Math.PI / 2;
  hab.position.set(0, 9.5, 2);
  group.add(hab);
  const capL = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 4.2, 2, 10), rust);
  capL.rotation.z = Math.PI / 2;
  capL.position.set(-7, 9.5, 2);
  group.add(capL);
  const capR = capL.clone();
  capR.rotation.z = -Math.PI / 2;
  capR.position.x = 7;
  group.add(capR);
  // Hangar mouth on the side facing out, a landing pad below it
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(9, 3.4, 2.4), hullMaterial(k, 0x2a1c18, windowTexture(10, 2, seed + 6, 0.9, [255, 70, 40])));
  mouth.position.set(0, 1, 11.2);
  group.add(mouth);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.6, 12), dark);
  pad.position.set(0, -2.5, 15);
  group.add(pad);
  // Gun mounts round the rock, where the turrets sit
  const mounts = [];
  PIRATE_MOUNTS.forEach(([x, y, z]) => {
    const d = V(x, y, z).normalize();
    mounts.push(strut(d.clone().multiplyScalar(8), d.clone().multiplyScalar(13.5), 1.4, 1.4));
  });
  addStruts(mounts, dark, group);
  // Radar mast with a turning dish
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 9, 6), dark);
  mast.position.set(3, 18, 2);
  group.add(mast);
  spinning.position.set(3, 22.5, 2);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3), rust);
  dish.material = dish.material.clone();
  dish.material.side = THREE.DoubleSide;
  dish.rotation.x = Math.PI / 2.4;
  spinning.add(dish);
  const list = beacons(k, group, [[3, 25, 2], [0, -2.2, 20], [-8.5, 9.5, 2], [8.5, 9.5, 2]], 0xff2010, 1.6);
  const floods = [[[0, 5.5, 13.5], [0, -2.5, 15], 0xff7a40], [[-7.5, 13, 4], [-3, 3, 4]], [[7.5, 13, 4], [4, 4, 6]]];
  return { group, spinning, spinRate: 0.9, beacons: list, floods };
}

// Where an outpost's gun turrets sit (directions from its centre; see pirateBases.js)
export const PIRATE_MOUNTS = [[1, 0.35, 0.6], [-1, 0.3, 0.5], [0.4, 0.5, -1], [-0.3, -0.6, -0.8]];

const STYLES = { ring, spindle, mine, nest, outpost };

// A new station for `def`; animate() spins it and blinks its beacons
export class StationVisual {
  constructor(def, renderer, seed) {
    const k = modelKit(renderer);
    const built = STYLES[def.style](k, seed);
    this.group = built.group;
    this.spinning = built.spinning;
    this.spinRate = built.spinRate;
    this.beacons = built.beacons;
    this.floods = (built.floods || []).map(([from, to, color]) => ({ from: V(...from), to: V(...to), color: color ?? FLOOD_COLOR }));
    // The lamp heads glow where they sit, lit or not by the pooled spotlights (see StationLights)
    this.floods.forEach((fl) => {
      const lamp = new THREE.Sprite(k.lightMat(fl.color, 1.5));
      lamp.position.copy(fl.from);
      lamp.scale.setScalar(1.3);
      this.group.add(lamp);
    });
    this.time = seed;
    // Tilted a little so stations don't all sit flat on the ecliptic
    this.group.rotation.set(0.14 + (seed % 3) * 0.08, seed * 0.7, 0.1 - (seed % 2) * 0.2);
  }

  animate(dt) {
    this.time += dt;
    this.spinning.rotation.y += this.spinRate * dt;
    this.beacons.forEach((b) => {
      const t = (this.time + b.phase) % 1.8;
      b.sprite.visible = t < 0.25;
    });
  }
}

// Floodlights: three real spotlights that move to whichever station the ship is near, so the hull there gets pools
// of warm light on its shadowed side while the light count (and the shaders) stay the same everywhere
const FLOOD_COLOR = 0xffe2b8;
const FLOOD_INTENSITY = 320;   // candela-like: about a third of the sunlight on the hull 15 units away
const FLOOD_RANGE = 12;        // station sizes within which the lights are on

export class StationLights {
  constructor(scene) {
    this.lights = [0, 1, 2].map(() => {
      const l = new THREE.SpotLight(FLOOD_COLOR, 0, 90, 0.6, 0.75, 2);
      l.castShadow = false;
      scene.add(l);
      scene.add(l.target);
      return l;
    });
    this.scene = scene;
    this.current = null;
  }

  update(stations, shipPos) {
    let best = null;
    let bestD = Infinity;
    stations.forEach((st) => {
      if (st.hidden || !st.visual.floods.length) return;
      const d = st.mesh.position.distanceTo(shipPos);
      if (d < st.size * FLOOD_RANGE && d < bestD) { best = st; bestD = d; }
    });
    if (best !== this.current) {
      this.current = best;
      this.lights.forEach((l, i) => {
        const fl = best && best.visual.floods[i];
        if (!fl) {
          l.intensity = 0;
          this.scene.add(l);
          this.scene.add(l.target);
          return;
        }
        best.mesh.add(l);
        best.mesh.add(l.target);
        l.position.copy(fl.from);
        l.target.position.copy(fl.to);
        l.color.set(fl.color);
        l.intensity = fl.color === FLOOD_COLOR ? FLOOD_INTENSITY : FLOOD_INTENSITY * 0.45;
      });
    }
  }
}
