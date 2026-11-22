import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GOOD_KEYS } from './world';
import { glowColor } from './heat';
import { rng } from './shipModel';

// The inside of the freighter, walkable: bridge with the pilot seat and the canopy, crew deck with bunk, galley and
// a glass floor panel, cargo bay holding the actual cargo as crates, engine room with the reactor.
// Built in metres in ship space (-Z forward, the same axes as the hull), the group is scaled to world units.
// Lighting is its own: ceiling lamps per room and sunlight / planetshine that only gets in through the windows,
// traced per pixel against the window panes, so the sun patches wander across the floor as the ship turns.

export const INTERIOR_SCALE = 0.1;  // world units per metre: the hull is about 25 m long
export const FLOOR_Y = -0.75;
export const CEIL_Y = 1.75;
export const SEAT_POS = new THREE.Vector3(0, FLOOR_Y, -4.0);  // floor point under the pilot seat
export const SEATED_EYE = new THREE.Vector3(0, 0.5, -4.0);    // = the cockpit camera, (0, 0.05, -0.4) units

const MAX_LAMPS = 10;
const MAX_WINDOWS = 8;
export const ROOMS = { bridge: 0, crew: 1, cargo: 2, engine: 3, any: -1 };
const ROOM_NAMES = ['BRÜCKE', 'WOHNDECK', 'FRACHTRAUM', 'MASCHINENRAUM'];

// Room outlines (x and z ranges, metres)
const BRIDGE = { x: 2.3, z0: -7.0, z1: -2.2 };
const CREW = { x: 2.0, z0: -2.2, z1: 3.0 };
const CARGO = { x: 3.0, z0: 3.0, z1: 8.6 };
const ENGINE = { x: 2.0, z0: 8.6, z1: 11.6 };
const WALL = 0.12;
const DOOR_W = 0.7;   // half width
const DOOR_H = 2.1;

// Window panes: centre, half-extent vectors u and v, room, round. Cut into the walls and tested in the shader.
export const WINDOWS = [
  { name: 'canopy', c: [0, 0.75, -6.55], u: [2.1, 0, 0], v: [0, 0.9, 0.45], room: ROOMS.bridge },
  { name: 'bridgeL', c: [-BRIDGE.x, 0.7, -5.3], u: [0, 0, 1.05], v: [0, 0.62, 0], room: ROOMS.bridge },
  { name: 'bridgeR', c: [BRIDGE.x, 0.7, -5.3], u: [0, 0, 1.05], v: [0, 0.62, 0], room: ROOMS.bridge },
  { name: 'portL', c: [-CREW.x, 0.85, -0.9], u: [0, 0, 0.36], v: [0, 0.36, 0], room: ROOMS.crew, round: true },
  { name: 'portR', c: [CREW.x, 0.85, -0.9], u: [0, 0, 0.36], v: [0, 0.36, 0], room: ROOMS.crew, round: true },
  { name: 'floor', c: [0, FLOOR_Y, 1.4], u: [0.6, 0, 0], v: [0, 0, 0.75], room: ROOMS.crew },
  { name: 'lock', c: [-CARGO.x, 0.9, 5.8], u: [0, 0, 0.24], v: [0, 0.24, 0], room: ROOMS.cargo, round: true },
  { name: 'aft', c: [0, 0.95, ENGINE.z1], u: [0.75, 0, 0], v: [0, 0.32, 0], room: ROOMS.engine },
];

// Doors in the bulkheads: z position, rooms either side
export const DOORS = [
  { z: BRIDGE.z1, a: ROOMS.bridge, b: ROOMS.crew },
  { z: CREW.z1, a: ROOMS.crew, b: ROOMS.cargo },
  { z: CARGO.z1, a: ROOMS.cargo, b: ROOMS.engine },
];

// Lamps: position, base colour, room. The last two are the console glow and the reactor glow.
const LAMPS = [
  { p: [-1.3, 1.62, -5.2], c: 0xffe2b8, k: 0.75, room: ROOMS.bridge },
  { p: [1.3, 1.62, -5.2], c: 0xffe2b8, k: 0.75, room: ROOMS.bridge },
  { p: [0, 1.62, -3.0], c: 0xffe2b8, k: 0.8, room: ROOMS.bridge },
  { p: [0, 1.62, -0.9], c: 0xffd9a8, k: 0.9, room: ROOMS.crew },
  { p: [0, 1.62, 1.9], c: 0xffd9a8, k: 0.8, room: ROOMS.crew },
  { p: [0, 1.62, 4.4], c: 0xe8f0ff, k: 1.0, room: ROOMS.cargo },
  { p: [0, 1.62, 7.3], c: 0xe8f0ff, k: 1.0, room: ROOMS.cargo },
  { p: [0, 1.55, 9.3], c: 0xffe0c0, k: 0.6, room: ROOMS.engine },
  { p: [0, 0.15, -5.6], c: 0x60ffa0, k: 0.25, room: ROOMS.bridge, console: true },
  { p: [0, 0.6, 10.3], c: 0x6aa8ff, k: 1.2, room: ROOMS.engine, reactor: true },
];

// Crate slots in the cargo bay: two rows along each wall, stacked two high
const CRATE = 1.0;
const CRATE_SLOTS = [];
for (const side of [-1, 1]) {
  for (const col of [0, 1]) {
    for (let row = 0; row < 4; row++) {
      CRATE_SLOTS.push({ x: side * (CARGO.x - 0.6 - col * 1.05), z: 3.75 + row * 1.15 });
    }
  }
}
export const CRATE_COUNT = CRATE_SLOTS.length * 2;

export const CARGO_COLORS = { ice: 0x7fb4e0, ore: 0x8a5a36, food: 0x5f9a44, med: 0xd8d8d0, tech: 0x3a90c8, lux: 0x9a70c0, stims: 0xc03048, arms: 0x6a6e3a, mission: 0xb8741f };

// ------------------------------------------------------------------------------------------------
// Textures
// ------------------------------------------------------------------------------------------------

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function finishTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Wall plating: big panels with seams, rivets and a little grime. One tile = 2 m.
function panelTexture() {
  const [c, g] = canvas(512);
  const rand = rng(41);
  g.fillStyle = '#d8d4ca';
  g.fillRect(0, 0, 512, 512);
  const rows = [0, 150, 330, 512];
  for (let r = 0; r < rows.length - 1; r++) {
    let x = 0;
    while (x < 512) {
      const w = Math.min(512 - x, 120 + Math.floor(rand() * 140));
      const y0 = rows[r], h = rows[r + 1] - rows[r];
      const v = 200 + Math.floor(rand() * 30);
      g.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
      g.fillRect(x, y0, w, h);
      g.strokeStyle = 'rgba(40,36,30,0.7)';
      g.lineWidth = 3;
      g.strokeRect(x + 1.5, y0 + 1.5, w - 3, h - 3);
      g.fillStyle = 'rgba(60,54,46,0.5)';
      for (let i = x + 10; i < x + w - 6; i += 24) {
        g.beginPath(); g.arc(i, y0 + 9, 2, 0, 7); g.fill();
        g.beginPath(); g.arc(i, y0 + h - 9, 2, 0, 7); g.fill();
      }
      if (rand() < 0.25 && w > 150) {
        g.fillStyle = 'rgba(30,28,24,0.55)';
        for (let i = 0; i < 6; i++) g.fillRect(x + 24, y0 + 30 + i * 10, w - 48, 4);
      }
      x += w;
    }
  }
  for (let i = 0; i < 400; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(40,34,28,0.12)' : 'rgba(255,255,250,0.1)';
    const s = 1 + rand() * 3;
    g.fillRect(rand() * 512, rand() * 512, s, s);
  }
  for (let i = 0; i < 40; i++) {
    const x = rand() * 512, y = rand() * 512;
    const grad = g.createLinearGradient(x, y, x, y + 60);
    grad.addColorStop(0, 'rgba(50,42,32,0.12)');
    grad.addColorStop(1, 'rgba(50,42,32,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 3 + rand() * 6, 60);
  }
  return finishTexture(c);
}

// Deck plates: diamond tread. One tile = 1 m.
function treadTexture() {
  const [c, g] = canvas(256);
  g.fillStyle = '#8c8c88';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    for (let x = 0; x < 256; x += 16) {
      const o = (y / 16) % 2 ? 8 : 0;
      g.save();
      g.translate(x + o + 4, y + 8);
      g.rotate((y / 16) % 2 ? 0.8 : -0.8);
      g.fillStyle = '#b4b4ae';
      g.fillRect(-5, -1.6, 10, 3.2);
      g.fillStyle = '#5a5a56';
      g.fillRect(-5, 1.6, 10, 1);
      g.restore();
    }
  }
  g.strokeStyle = '#3a3a36';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 253, 253);
  const rand = rng(9);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(30,26,20,${0.05 + rand() * 0.12})`;
    g.fillRect(rand() * 256, rand() * 256, 2 + rand() * 6, 2 + rand() * 6);
  }
  return finishTexture(c);
}

// Painted metal for furniture, consoles and machinery: almost flat, a little wear
function plainTexture() {
  const [c, g] = canvas(256);
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, 256, 256);
  const rand = rng(77);
  for (let i = 0; i < 900; i++) {
    const v = rand() < 0.5 ? 200 : 250;
    g.fillStyle = `rgba(${v},${v},${v},0.25)`;
    g.fillRect(rand() * 256, rand() * 256, 1 + rand() * 3, 1 + rand() * 3);
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = 'rgba(120,110,100,0.18)';
    g.fillRect(rand() * 256, rand() * 256, 1, 4 + rand() * 18);
  }
  return finishTexture(c);
}

// Cargo crate: ribbed sides, a dark frame, stencil marks. Per face UVs.
function crateTexture() {
  const [c, g] = canvas(256);
  g.fillStyle = '#e8e8e8';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 30; x < 230; x += 22) g.fillRect(x, 24, 8, 208);
  g.strokeStyle = '#2a2a2a';
  g.lineWidth = 22;
  g.strokeRect(11, 11, 234, 234);
  g.fillStyle = '#3a3a3a';
  [[18, 18], [238, 18], [18, 238], [238, 238]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); });
  g.fillStyle = 'rgba(20,20,20,0.75)';
  g.font = 'bold 26px monospace';
  g.textAlign = 'center';
  g.fillText('SOL 4471', 128, 120);
  g.font = 'bold 18px monospace';
  g.fillText('▲ OBEN ▲', 128, 150);
  return finishTexture(c);
}

// Reactor plasma: bright vertical streaks over a softer glow, wraps around the core
function plasmaTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(90,90,90)';
  g.fillRect(0, 0, 128, 256);
  const rand = rng(5);
  for (let i = 0; i < 70; i++) {
    const x = rand() * 128, w = 1 + rand() * 5, y = rand() * 256, h = 40 + rand() * 200;
    const v = 150 + Math.floor(rand() * 105);
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, `rgba(${v},${v},${v},0)`);
    grad.addColorStop(0.5, `rgba(${v},${v},${v},0.9)`);
    grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    g.fillRect(x, y - 256, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Stencilled sign on the wall
function signTexture(text, sub = '') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = '#b8741f';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#231f1a';
  for (let x = -128; x < 512; x += 48) {
    g.beginPath();
    g.moveTo(x, 128); g.lineTo(x + 24, 128); g.lineTo(x + 24 + 20, 104); g.lineTo(x + 20, 104);
    g.fill();
  }
  g.fillStyle = '#231f1a';
  g.font = 'bold 54px "Saira Stencil One", Impact, sans-serif';
  g.textAlign = 'center';
  g.fillText(text, 256, 70);
  if (sub) {
    g.font = 'bold 20px monospace';
    g.fillText(sub, 256, 96);
  }
  return finishTexture(c);
}

// ------------------------------------------------------------------------------------------------
// The interior shader
// ------------------------------------------------------------------------------------------------

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aRoom;
  attribute vec3 aTint;
  uniform mat4 uLocal;
  varying vec3 vPos;
  varying vec3 vNrm;
  varying vec3 vTint;
  varying vec2 vUv;
  varying float vRoom;
  void main() {
    vec4 lp = uLocal * vec4(position, 1.0);
    vPos = lp.xyz;
    vNrm = mat3(uLocal) * normal;
    vTint = aTint;
    vUv = uv;
    vRoom = aRoom;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  #define MAX_LAMPS ${MAX_LAMPS}
  #define MAX_WINDOWS ${MAX_WINDOWS}
  uniform sampler2D uMap;
  uniform float uTexScale;
  uniform float uUseUv;
  uniform float uSpec;
  uniform float uAlphaTest;
  uniform vec3 uLampPos[MAX_LAMPS];
  uniform vec3 uLampCol[MAX_LAMPS];
  uniform float uLampRoom[MAX_LAMPS];
  uniform vec4 uWinC[MAX_WINDOWS];   // centre, room
  uniform vec4 uWinU[MAX_WINDOWS];   // half extent, round flag
  uniform vec3 uWinV[MAX_WINDOWS];
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uFillDir;
  uniform vec3 uFillCol;
  uniform vec3 uAmbient;
  uniform vec3 uEye;
  uniform float uFloorY;
  uniform float uCeilY;
  varying vec3 vPos;
  varying vec3 vNrm;
  varying vec3 vTint;
  varying vec2 vUv;
  varying float vRoom;

  // 1 if a ray from p along dir leaves through one of this room's windows
  float throughWindow(vec3 p, vec3 dir) {
    float lit = 0.0;
    for (int i = 0; i < MAX_WINDOWS; i++) {
      vec3 c = uWinC[i].xyz;
      vec3 u = uWinU[i].xyz;
      vec3 v = uWinV[i];
      float uu = dot(u, u);
      if (uu < 1e-6) continue;
      if (vRoom >= 0.0 && abs(uWinC[i].w - vRoom) > 0.5) continue;
      vec3 n = normalize(cross(u, v));
      float dn = dot(dir, n);
      if (abs(dn) < 1e-4) continue;
      float t = dot(c - p, n) / dn;
      if (t <= 0.01) continue;
      vec3 h = p + dir * t - c;
      float a = dot(h, u) / uu;
      float b = dot(h, v) / dot(v, v);
      float edge = uWinU[i].w > 0.5 ? length(vec2(a, b)) : max(abs(a), abs(b));
      // A soft edge: the penumbra of the Sun's disc and the frame
      lit = max(lit, 1.0 - smoothstep(0.93, 1.0, edge));
    }
    return lit;
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vNrm);
    if (!gl_FrontFacing) N = -N;
    vec2 uv;
    if (uUseUv > 0.5) uv = vUv;
    else {
      vec3 an = abs(N);
      if (an.y > an.x && an.y > an.z) uv = vPos.xz;
      else if (an.x > an.z) uv = vPos.zy;
      else uv = vPos.xy;
      uv *= uTexScale;
    }
    vec4 tex = texture2D(uMap, uv);
    if (tex.a < uAlphaTest) discard;
    vec3 albedo = tex.rgb * vTint;

    vec3 V = normalize(uEye - vPos);
    vec3 light = uAmbient;
    vec3 spec = vec3(0.0);
    for (int i = 0; i < MAX_LAMPS; i++) {
      if (uLampRoom[i] >= 0.0 && vRoom >= 0.0 && abs(uLampRoom[i] - vRoom) > 0.5) continue;
      vec3 d = uLampPos[i] - vPos;
      float dist = length(d);
      vec3 L = d / max(dist, 1e-3);
      float att = 1.0 / (1.0 + 0.55 * dist * dist);
      float ndl = dot(N, L);
      light += uLampCol[i] * att * max(ndl * 0.8 + 0.2, 0.0);
      vec3 H = normalize(L + V);
      spec += uLampCol[i] * att * pow(max(dot(N, H), 0.0), 40.0) * step(0.0, ndl);
    }
    float sunN = dot(N, uSunDir);
    if (sunN > 0.0 && dot(uSunCol, uSunCol) > 1e-6) {
      float lit = throughWindow(vPos, uSunDir);
      light += uSunCol * sunN * lit;
      spec += uSunCol * lit * pow(max(dot(N, normalize(uSunDir + V)), 0.0), 60.0);
    }
    float fillN = dot(N, uFillDir);
    if (fillN > 0.0 && dot(uFillCol, uFillCol) > 1e-6) {
      light += uFillCol * fillN * throughWindow(vPos, uFillDir);
    }
    // Corners darken: the floor and ceiling edges, the bottom of the walls
    float ao = mix(0.62, 1.0, smoothstep(0.0, 0.45, vPos.y - uFloorY)) * mix(0.75, 1.0, smoothstep(0.0, 0.35, uCeilY - vPos.y));
    if (N.y > 0.5) ao = mix(0.8, 1.0, ao);
    vec3 col = albedo * light * ao + spec * uSpec;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ------------------------------------------------------------------------------------------------
// Live screens: green phosphor CRTs drawn on canvases
// ------------------------------------------------------------------------------------------------

const PHOSPHOR = '#7dffb0';
const PHOSPHOR_DIM = '#2f8f5a';
const AMBER = '#ffb347';
const RED = '#ff5a4a';

class Screen {
  constructor(kind, w = 320, h = 200) {
    this.kind = kind;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, color: new THREE.Color(1.25, 1.25, 1.25) });
  }

  begin(title, alert) {
    const { g, canvas: c } = this;
    g.fillStyle = '#04100a';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = alert ? RED : PHOSPHOR;
    g.font = '22px VT323, monospace';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText(title, 10, 6);
    g.fillStyle = alert ? RED : PHOSPHOR_DIM;
    g.fillRect(10, 30, c.width - 20, 2);
  }

  row(y, label, value, color = PHOSPHOR) {
    const g = this.g;
    g.font = '20px VT323, monospace';
    g.textAlign = 'left';
    g.fillStyle = PHOSPHOR_DIM;
    g.fillText(label, 10, y);
    g.textAlign = 'right';
    g.fillStyle = color;
    g.fillText(value, this.canvas.width - 10, y);
  }

  bar(y, label, frac, color = PHOSPHOR) {
    const g = this.g, w = this.canvas.width;
    g.font = '20px VT323, monospace';
    g.textAlign = 'left';
    g.fillStyle = PHOSPHOR_DIM;
    g.fillText(label, 10, y);
    const x0 = 92, bw = w - x0 - 56;
    g.strokeStyle = PHOSPHOR_DIM;
    g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, y + 4.5, bw, 11);
    g.fillStyle = color;
    g.fillRect(x0 + 2, y + 6, Math.max(0, Math.min(1, frac)) * (bw - 3), 8);
    g.textAlign = 'right';
    g.fillText(`${Math.round(frac * 100)}%`, w - 10, y);
  }

  end() {
    const { g, canvas: c } = this;
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < c.height; y += 3) g.fillRect(0, y, c.width, 1);
    const vig = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.3, c.width / 2, c.height / 2, c.width * 0.7);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vig;
    g.fillRect(0, 0, c.width, c.height);
    this.texture.needsUpdate = true;
  }
}

// ------------------------------------------------------------------------------------------------
// Builder
// ------------------------------------------------------------------------------------------------

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
export class ShipInterior {
  constructor() {
    this.group = new THREE.Group();
    this.group.scale.setScalar(INTERIOR_SCALE);
    this.group.visible = false;
    this.group.name = 'ship-interior';

    this.shared = this.makeSharedUniforms();
    this.textures = { panel: panelTexture(), tread: treadTexture(), plain: plainTexture(), crate: crateTexture() };
    this.materials = {
      panel: this.litMaterial(this.textures.panel, { texScale: 0.5, spec: 0.12 }),
      tread: this.litMaterial(this.textures.tread, { texScale: 1.0, spec: 0.45 }),
      plain: this.litMaterial(this.textures.plain, { texScale: 0.8, spec: 0.3 }),
      crate: this.litMaterial(this.textures.crate, { uv: true, spec: 0.15 }),
    };
    this.parts = {};
    this.lampPanels = [];
    this.doors = [];
    this.screens = [];
    this.interactables = [];
    this.obstacles = [];   // walls of furniture as xz boxes: [x0, x1, z0, z1]
    this.walkable = [];    // floor areas the walker's centre may be in: [x0, x1, z0, z1]

    this.buildShell();
    this.buildBridge();
    this.buildCrewDeck();
    this.buildCargoBay();
    this.buildEngineRoom();
    this.buildDoors();
    this.buildWindows();
    this.flush();

    this.crateMesh = null;
    this.cargoSignature = '';
    this.crateObstacles = [];
    this.alert = 0;
    this.flicker = 1;
    this.screenTimer = 0;
  }

  makeSharedUniforms() {
    const lampPos = [], lampCol = [], lampRoom = [];
    for (let i = 0; i < MAX_LAMPS; i++) {
      const l = LAMPS[i];
      lampPos.push(l ? new THREE.Vector3(...l.p) : new THREE.Vector3(0, -100, 0));
      lampCol.push(new THREE.Color(0, 0, 0));
      lampRoom.push(l ? l.room : -1);
    }
    const winC = [], winU = [], winV = [];
    for (let i = 0; i < MAX_WINDOWS; i++) {
      const w = WINDOWS[i];
      winC.push(w ? new THREE.Vector4(...w.c, w.room) : new THREE.Vector4());
      winU.push(w ? new THREE.Vector4(...w.u, w.round ? 1 : 0) : new THREE.Vector4());
      winV.push(w ? new THREE.Vector3(...w.v) : new THREE.Vector3());
    }
    return {
      uLampPos: { value: lampPos },
      uLampCol: { value: lampCol },
      uLampRoom: { value: lampRoom },
      uWinC: { value: winC },
      uWinU: { value: winU },
      uWinV: { value: winV },
      uSunDir: { value: new THREE.Vector3(0, 0, -1) },
      uSunCol: { value: new THREE.Color(0, 0, 0) },
      uFillDir: { value: new THREE.Vector3(0, 1, 0) },
      uFillCol: { value: new THREE.Color(0, 0, 0) },
      uAmbient: { value: new THREE.Color(0.018, 0.02, 0.026) },
      uEye: { value: new THREE.Vector3() },
      uFloorY: { value: FLOOR_Y },
      uCeilY: { value: CEIL_Y },
    };
  }

  litMaterial(map, { texScale = 1, spec = 0.2, uv = false, alphaTest = 0 } = {}) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.shared,
        uMap: { value: map },
        uTexScale: { value: texScale },
        uUseUv: { value: uv ? 1 : 0 },
        uSpec: { value: spec },
        uAlphaTest: { value: alphaTest },
        uLocal: { value: new THREE.Matrix4() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.FrontSide,
    });
    return mat;
  }

  // Every lit mesh tells the shared material where it sits in the ship before it is drawn
  attachLit(mesh) {
    mesh.matrixAutoUpdate = true;
    mesh.onBeforeRender = (renderer, scene, camera, geometry, material) => {
      if (!material.uniforms || !material.uniforms.uLocal) return;
      material.uniforms.uLocal.value.copy(mesh.matrix);
      material.uniformsNeedUpdate = true;
    };
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  // ----- geometry helpers ----------------------------------------------------------------------

  tag(geo, room, color) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.attributes.position.count;
    const rooms = new Float32Array(n).fill(room);
    const tint = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) { tint[i * 3] = _c.r; tint[i * 3 + 1] = _c.g; tint[i * 3 + 2] = _c.b; }
    g.setAttribute('aRoom', new THREE.BufferAttribute(rooms, 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    return g;
  }

  add(mat, room, color, geo) {
    (this.parts[mat] ||= []).push(this.tag(geo, room, color));
  }

  box(mat, room, color, x0, x1, y0, y1, z0, z1) {
    const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(mat, room, color, g);
  }

  // A transformed geometry (cylinder, shape) into the merge
  shape(mat, room, color, geo, pos, rot = null) {
    if (rot) geo.applyQuaternion(_q.setFromEuler(new THREE.Euler(...rot)));
    geo.translate(...pos);
    this.add(mat, room, color, geo);
  }

  // A flat slab with rectangular holes. axis 'x': at x in [lo, hi], spanning a = z, b = y.
  // axis 'z': z in [lo, hi], a = x, b = y. axis 'y': y in [lo, hi], a = x, b = z.
  slab(mat, room, color, axis, lo, hi, a0, a1, b0, b1, holes = []) {
    const cuts = new Set([a0, a1]);
    holes.forEach((h) => { cuts.add(Math.max(a0, Math.min(a1, h.a0))); cuts.add(Math.max(a0, Math.min(a1, h.a1))); });
    const xs = [...cuts].sort((p, q) => p - q);
    for (let i = 0; i < xs.length - 1; i++) {
      const s = xs[i], e = xs[i + 1];
      if (e - s < 1e-4) continue;
      const mid = (s + e) / 2;
      const covering = holes.filter((h) => h.a0 < mid && h.a1 > mid).sort((p, q) => p.b0 - q.b0);
      let cur = b0;
      const emit = (from, to) => {
        if (to - from < 1e-4) return;
        if (axis === 'x') this.box(mat, room, color, lo, hi, from, to, s, e);
        else if (axis === 'z') this.box(mat, room, color, s, e, from, to, lo, hi);
        else this.box(mat, room, color, s, e, lo, hi, from, to);
      };
      covering.forEach((h) => {
        if (h.b0 > cur) emit(cur, h.b0);
        cur = Math.max(cur, h.b1);
      });
      if (cur < b1) emit(cur, b1);
    }
  }

  lampPanel(x, y, z, w, d, room) {
    const geo = new THREE.BoxGeometry(w, 0.04, d);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 1.07, 0.95) });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.userData.base = mat.color.clone();
    m.userData.room = room;
    this.group.add(m);
    this.lampPanels.push(m);
    // housing
    this.box('plain', room, 0x55585c, x - w / 2 - 0.05, x + w / 2 + 0.05, y + 0.02, CEIL_Y, z - d / 2 - 0.05, z + d / 2 + 0.05);
  }

  sign(text, sub, pos, rotY, room, w = 1.0) {
    const mat = this.litMaterial(signTexture(text, sub), { uv: true, spec: 0.05 });
    const geo = this.tag(new THREE.PlaneGeometry(w, w / 4), room, 0xffffff);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.y = rotY;
    this.attachLit(m);
  }

  screen(kind, pos, rotY, w, h, tilt = 0, room = 0) {
    const s = new Screen(kind);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), s.material);
    m.position.set(...pos);
    m.rotation.order = 'YXZ';
    m.rotation.y = rotY;
    m.rotation.x = tilt;
    this.group.add(m);
    // bezel
    const bz = new THREE.Mesh(this.tag(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05), room, 0x2c2e30), this.materials.plain);
    bz.position.copy(m.position);
    bz.rotation.copy(m.rotation);
    bz.translateZ(-0.03);
    this.attachLit(bz);
    s.mesh = m;
    this.screens.push(s);
    return s;
  }

  interact(id, x, z, radius, prompt, y = 0.9) {
    this.interactables.push({ id, pos: new THREE.Vector3(x, y, z), radius, prompt });
  }

  // ----- rooms ---------------------------------------------------------------------------------

  holesFor(axis, value) {
    // Window holes in a wall, in the slab's (a, b) coordinates
    const out = [];
    WINDOWS.forEach((w) => {
      const c = w.c;
      if (axis === 'x' && Math.abs(c[0] - value) < 0.01 && w.name !== 'floor') {
        const hz = Math.abs(w.u[2]) || Math.abs(w.v[2]), hy = Math.abs(w.v[1]) || Math.abs(w.u[1]);
        out.push({ a0: c[2] - hz, a1: c[2] + hz, b0: c[1] - hy, b1: c[1] + hy });
      } else if (axis === 'z' && Math.abs(c[2] - value) < 0.01) {
        const hx = Math.abs(w.u[0]), hy = Math.abs(w.v[1]);
        out.push({ a0: c[0] - hx, a1: c[0] + hx, b0: c[1] - hy, b1: c[1] + hy });
      }
    });
    return out;
  }

  buildShell() {
    const BONE = 0xe4ddd0, GREY = 0xb8bcc0, DECK = 0x9a9890;
    const rooms = [
      [ROOMS.bridge, BRIDGE], [ROOMS.crew, CREW], [ROOMS.cargo, CARGO], [ROOMS.engine, ENGINE],
    ];
    rooms.forEach(([room, r]) => {
      // Floor (the crew deck has its glass panel), ceiling
      const floorHoles = room === ROOMS.crew ? [{ a0: -0.6, a1: 0.6, b0: 0.65, b1: 2.15 }] : [];
      this.slab('tread', room, DECK, 'y', FLOOR_Y - 0.1, FLOOR_Y, -r.x, r.x, r.z0, r.z1, floorHoles);
      // Over the bridge the roof ends at the top of the slanted canopy
      const cz0 = room === ROOMS.bridge ? -6.1 : r.z0;
      this.slab('panel', room, GREY, 'y', CEIL_Y, CEIL_Y + 0.1, -r.x, r.x, cz0, r.z1);
      // Side walls with their windows
      this.slab('panel', room, BONE, 'x', -r.x - WALL, -r.x, r.z0, r.z1, FLOOR_Y, CEIL_Y, this.holesFor('x', -r.x));
      this.slab('panel', room, BONE, 'x', r.x, r.x + WALL, r.z0, r.z1, FLOOR_Y, CEIL_Y, this.holesFor('x', r.x));
      // Ochre stripe at hip height, dark kick plate
      [-1, 1].forEach((s) => {
        const xi = s * (r.x - 0.005);
        this.box('plain', room, 0xc07a24, Math.min(xi, xi - s * 0.02), Math.max(xi, xi - s * 0.02), 0.05, 0.17, r.z0 + 0.05, r.z1 - 0.05);
        this.box('plain', room, 0x3a3c3e, Math.min(xi, xi - s * 0.03), Math.max(xi, xi - s * 0.03), FLOOR_Y, FLOOR_Y + 0.22, r.z0, r.z1);
      });
      // Ceiling ribs
      for (let z = cz0 + 0.6; z < r.z1 - 0.3; z += 1.2) {
        this.box('plain', room, 0x8a8e92, -r.x, r.x, CEIL_Y - 0.08, CEIL_Y, z - 0.06, z + 0.06);
      }
    });

    // Bulkheads with door openings; where rooms differ in width the wider side is closed by the bulkhead too
    const door = { a0: -DOOR_W, a1: DOOR_W, b0: FLOOR_Y, b1: FLOOR_Y + DOOR_H };
    DOORS.forEach((d) => {
      const w = Math.max([BRIDGE, CREW, CARGO, ENGINE][d.a].x, [BRIDGE, CREW, CARGO, ENGINE][d.b].x) + WALL;
      this.slab('panel', ROOMS.any, 0xcfc8ba, 'z', d.z - 0.1, d.z + 0.1, -w, w, FLOOR_Y, CEIL_Y, [door]);
      // Door frame: hazard trim
      this.box('plain', ROOMS.any, 0x2e3032, -DOOR_W - 0.12, -DOOR_W, FLOOR_Y, FLOOR_Y + DOOR_H + 0.12, d.z - 0.16, d.z + 0.16);
      this.box('plain', ROOMS.any, 0x2e3032, DOOR_W, DOOR_W + 0.12, FLOOR_Y, FLOOR_Y + DOOR_H + 0.12, d.z - 0.16, d.z + 0.16);
      this.box('plain', ROOMS.any, 0xc07a24, -DOOR_W - 0.12, DOOR_W + 0.12, FLOOR_Y + DOOR_H, FLOOR_Y + DOOR_H + 0.12, d.z - 0.16, d.z + 0.16);
    });
    // Rear wall of the engine room (with the aft window); the bridge front is the canopy, built in buildBridge
    this.slab('panel', ROOMS.engine, 0xcfc8ba, 'z', ENGINE.z1, ENGINE.z1 + WALL, -ENGINE.x, ENGINE.x, FLOOR_Y, CEIL_Y, this.holesFor('z', ENGINE.z1));

    // Walkable floor areas (for the walker's centre, already shrunk by its radius)
    const R = 0.3;
    this.walkable.push(
      [-BRIDGE.x + R, BRIDGE.x - R, -5.05, BRIDGE.z1 - R],
      [-CREW.x + R, CREW.x - R, CREW.z0 + R, CREW.z1 - R],
      [-CARGO.x + R, CARGO.x - R, CARGO.z0 + R, CARGO.z1 - R],
      [-ENGINE.x + R, ENGINE.x - R, ENGINE.z0 + R, ENGINE.z1 - R],
    );
  }

  buildBridge() {
    const room = ROOMS.bridge;
    const z0 = BRIDGE.z0;
    // Canopy: below the glass a sloping nose plate, struts on the glass, the roof meets the glass top
    this.box('panel', room, 0x9ea2a6, -BRIDGE.x, BRIDGE.x, FLOOR_Y, -0.15, z0 - 0.15, z0);
    const top = new THREE.Vector3(0, 1.65, -6.1), bottom = new THREE.Vector3(0, -0.15, -7.0);
    const along = top.clone().sub(bottom);
    const len = along.length();
    const tiltX = Math.atan2(along.z, along.y); // lean back
    const strut = (x, w = 0.12) => {
      const g = new THREE.BoxGeometry(w, len + 0.1, 0.12);
      g.applyQuaternion(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), tiltX));
      g.translate(x, (top.y + bottom.y) / 2, (top.z + bottom.z) / 2);
      this.add('plain', room, 0x34363a, g);
    };
    [-2.18, -1.05, 1.05, 2.18].forEach((x) => strut(x, x === -2.18 || x === 2.18 ? 0.3 : 0.12));
    // Horizontal bars along the glass bottom and top
    this.box('plain', room, 0x34363a, -BRIDGE.x, BRIDGE.x, -0.22, -0.08, -7.08, -6.92);
    this.box('plain', room, 0x34363a, -BRIDGE.x, BRIDGE.x, 1.6, 1.75, -6.2, -6.0);
    // Main console in front of the seat: a low desk below the line of sight
    const cz0 = -6.85, cz1 = -5.3;
    this.box('plain', room, 0x4a4d50, -2.0, 2.0, FLOOR_Y, -0.1, cz0, cz1);
    // sloped top
    const slope = new THREE.BoxGeometry(3.9, 0.08, 1.0);
    slope.applyQuaternion(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.32));
    slope.translate(0, -0.02, -5.85);
    this.add('plain', room, 0x3a3c3f, slope);
    this.box('plain', room, 0xc07a24, -2.0, 2.0, -0.12, -0.06, cz1 - 0.04, cz1 + 0.04);
    // Three CRTs on the console, angled at the pilot
    this.screens.nav = this.screen('nav', [0, 0.22, -5.95], 0, 0.78, 0.5, -0.32, room);
    this.screens.radar = this.screen('radar', [-1.0, 0.2, -5.85], 0.35, 0.64, 0.46, -0.32, room);
    this.screens.ship = this.screen('ship', [1.0, 0.2, -5.85], -0.35, 0.64, 0.46, -0.32, room);
    // Rows of buttons
    const buttons = new THREE.Group();
    const btnGeo = new THREE.BoxGeometry(0.05, 0.02, 0.05);
    const colors = [0xff4030, 0x40ff80, 0xffb030, 0x40a0ff];
    this.buttonMats = colors.map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.6) }));
    for (let i = 0; i < 26; i++) {
      const b = new THREE.Mesh(btnGeo, this.buttonMats[i % 4]);
      const side = i < 13 ? -1 : 1;
      const k = i % 13;
      const bz = -5.55 - Math.floor(k / 3) * 0.12;
      b.position.set(side * (1.55 + (k % 3) * 0.1), 0.03 + (-5.85 - bz) * Math.tan(0.32), bz);
      b.userData.phase = i * 1.7;
      buttons.add(b);
    }
    this.group.add(buttons);
    this.buttons = buttons;

    // Pilot seat: base, cushion, backrest, headrest, armrests with the stick and the throttle
    const s = SEAT_POS;
    const SEAT_RED = 0x7a3a2c;
    this.box('plain', room, 0x2a2c2e, s.x - 0.18, s.x + 0.18, FLOOR_Y, FLOOR_Y + 0.38, s.z - 0.18, s.z + 0.18);
    this.box('plain', room, SEAT_RED, s.x - 0.32, s.x + 0.32, FLOOR_Y + 0.38, FLOOR_Y + 0.52, s.z - 0.3, s.z + 0.28);
    const back = new THREE.BoxGeometry(0.62, 0.95, 0.14);
    back.applyQuaternion(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.18));
    back.translate(s.x, FLOOR_Y + 1.0, s.z + 0.32);
    this.add('plain', room, SEAT_RED, back);
    this.box('plain', room, SEAT_RED, s.x - 0.17, s.x + 0.17, FLOOR_Y + 1.5, FLOOR_Y + 1.74, s.z + 0.38, s.z + 0.5);
    [-1, 1].forEach((side) => {
      this.box('plain', room, 0x2a2c2e, s.x + side * 0.36 - 0.06, s.x + side * 0.36 + 0.06, FLOOR_Y + 0.52, FLOOR_Y + 0.72, s.z - 0.3, s.z + 0.25);
      // stick / throttle
      const g = new THREE.CylinderGeometry(0.025, 0.03, 0.22, 8);
      this.shape('plain', room, 0x1c1c1e, g, [s.x + side * 0.36, FLOOR_Y + 0.83, s.z - 0.22]);
    });
    this.obstacles.push([s.x - 0.42, s.x + 0.42, s.z - 0.38, s.z + 0.58]);
    this.interact('seat', s.x, s.z, 1.45, 'Hinsetzen und fliegen');

    // Side consoles under the side windows
    [-1, 1].forEach((side) => {
      const x0 = side * BRIDGE.x, x1 = side * (BRIDGE.x - 0.5);
      this.box('plain', room, 0x4a4d50, Math.min(x0, x1), Math.max(x0, x1), FLOOR_Y, -0.05, -6.6, -4.2);
      this.box('plain', room, 0xc07a24, Math.min(x0, x1), Math.max(x0, x1), -0.07, -0.03, -6.6, -4.2);
    });
    this.obstacles.push([-BRIDGE.x, -BRIDGE.x + 0.5, -6.6, -4.2], [BRIDGE.x - 0.5, BRIDGE.x, -6.6, -4.2]);
    this.interact('window:canopy', 0, -5.6, 1.0, 'Durch die Kanzel schauen');
    this.interact('window:bridgeL', -1.75, -5.0, 1.0, 'Aus dem Seitenfenster schauen');
    this.interact('window:bridgeR', 1.75, -5.0, 1.0, 'Aus dem Seitenfenster schauen');

    this.lampPanel(-1.3, CEIL_Y - 0.06, -5.2, 0.9, 0.3, room);
    this.lampPanel(1.3, CEIL_Y - 0.06, -5.2, 0.9, 0.3, room);
    this.lampPanel(0, CEIL_Y - 0.06, -3.0, 1.2, 0.3, room);
    this.sign('BRÜCKE', 'SOL 4471 · DECK 1', [0, 1.6, BRIDGE.z1 - 0.105], Math.PI, room, 0.9);
  }

  buildCrewDeck() {
    const room = ROOMS.crew;
    // Table with a bench against the left wall, under the porthole
    const tx = -CREW.x;
    this.box('plain', room, 0x6a5a48, tx + 0.05, tx + 0.95, FLOOR_Y + 0.72, FLOOR_Y + 0.78, -1.55, -0.25);
    this.box('plain', room, 0x2e3032, tx + 0.45, tx + 0.55, FLOOR_Y, FLOOR_Y + 0.72, -0.95, -0.85);
    this.box('plain', room, 0x7a3a2c, tx + 0.05, tx + 0.55, FLOOR_Y + 0.4, FLOOR_Y + 0.48, -2.05, -1.65);
    this.box('plain', room, 0x2e3032, tx + 0.05, tx + 0.55, FLOOR_Y, FLOOR_Y + 0.4, -2.05, -1.65);
    // mug on the table
    this.shape('plain', room, 0xd8d0c0, new THREE.CylinderGeometry(0.045, 0.04, 0.1, 12), [tx + 0.6, FLOOR_Y + 0.83, -0.7]);
    this.obstacles.push([tx, tx + 1.0, -2.1, -0.2]);
    this.interact('window:portL', tx + 0.3, -0.9, 1.5, 'Aus dem Bullauge schauen', 0.85);

    // Bunk aft on the left with a locker above
    this.box('plain', room, 0x3a3c3e, tx, tx + 0.95, FLOOR_Y, FLOOR_Y + 0.45, 0.6, 2.9);
    this.box('plain', room, 0x5a6a7a, tx + 0.02, tx + 0.92, FLOOR_Y + 0.45, FLOOR_Y + 0.6, 0.65, 2.85);
    this.box('plain', room, 0xe8e2d8, tx + 0.1, tx + 0.6, FLOOR_Y + 0.6, FLOOR_Y + 0.7, 2.35, 2.8);
    this.box('panel', room, 0xb8b2a6, tx, tx + 0.55, 1.15, CEIL_Y, 0.6, 2.9);
    this.obstacles.push([tx, tx + 1.0, 0.55, 2.95]);
    this.interact('bunk', tx + 0.8, 1.7, 1.2, 'Koje: hier ist nur Zeit zum Ausruhen, wenn niemand schießt');

    // Galley on the right: counter, cupboards, the coffee machine
    const gx = CREW.x;
    this.box('plain', room, 0x5a5d60, gx - 0.6, gx, FLOOR_Y, FLOOR_Y + 0.9, -2.05, 0.5);
    this.box('plain', room, 0xc8c2b4, gx - 0.62, gx, FLOOR_Y + 0.9, FLOOR_Y + 0.95, -2.05, 0.5);
    this.box('panel', room, 0xb8b2a6, gx - 0.4, gx, 1.25, CEIL_Y, -2.05, -1.25);
    this.box('panel', room, 0xb8b2a6, gx - 0.4, gx, 1.25, CEIL_Y, -0.55, 0.5);
    // coffee machine
    this.box('plain', room, 0x2a2c2e, gx - 0.45, gx - 0.05, FLOOR_Y + 0.95, FLOOR_Y + 1.45, 0.05, 0.42);
    this.box('plain', room, 0xb8741f, gx - 0.46, gx - 0.3, FLOOR_Y + 1.3, FLOOR_Y + 1.38, 0.08, 0.39);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.6, 0.2) }));
    lamp.position.set(gx - 0.46, FLOOR_Y + 1.2, 0.3);
    this.group.add(lamp);
    this.coffeeLamp = lamp;
    this.obstacles.push([gx - 0.65, gx, -2.1, 0.55]);
    this.interact('coffee', gx - 0.5, 0.25, 1.1, 'Kaffee ziehen');
    this.interact('window:portR', gx - 0.6, -0.9, 1.0, 'Aus dem Bullauge schauen', 0.85);

    // Ship status wall screen aft on the right
    this.screens.status = this.screen('status', [gx - 0.03, 0.75, 1.75], -Math.PI / 2, 1.5, 0.94, 0, room);
    this.interact('status', gx - 0.6, 1.75, 1.6, 'Schiffsstatus');

    // Glass floor panel: a frame around the hole
    const fy = FLOOR_Y;
    this.box('plain', room, 0x2e3032, -0.72, 0.72, fy - 0.12, fy + 0.01, 0.55, 0.65);
    this.box('plain', room, 0x2e3032, -0.72, 0.72, fy - 0.12, fy + 0.01, 2.15, 2.25);
    this.box('plain', room, 0x2e3032, -0.72, -0.6, fy - 0.12, fy + 0.01, 0.55, 2.25);
    this.box('plain', room, 0x2e3032, 0.6, 0.72, fy - 0.12, fy + 0.01, 0.55, 2.25);
    this.box('plain', room, 0x2e3032, -0.6, 0.6, fy - 0.12, fy + 0.01, 1.38, 1.42);
    this.interact('window:floor', 0, 1.4, 0.9, 'Durch das Bodenfenster schauen');

    this.lampPanel(0, CEIL_Y - 0.06, -0.9, 1.0, 0.3, room);
    this.lampPanel(0, CEIL_Y - 0.06, 1.9, 1.0, 0.3, room);
    this.sign('WOHNDECK', 'BRÜCKE ▲', [0, 1.6, CREW.z0 + 0.105], 0, room, 0.9);
    this.sign('WOHNDECK', 'FRACHT ▼', [0, 1.6, CREW.z1 - 0.105], Math.PI, room, 0.9);
  }

  buildCargoBay() {
    const room = ROOMS.cargo;
    // Floor rails and tie-down rings along the slots
    [-1.25, 1.25].forEach((x) => this.box('plain', room, 0xc07a24, x - 0.04, x + 0.04, FLOOR_Y, FLOOR_Y + 0.015, CARGO.z0 + 0.2, CARGO.z1 - 0.2));
    // Wall ribs
    for (let z = CARGO.z0 + 0.6; z < CARGO.z1; z += 1.15) {
      [-1, 1].forEach((s) => this.box('plain', room, 0x6a6e72, s * CARGO.x - 0.08, s * CARGO.x + 0.08, FLOOR_Y, CEIL_Y, z - 0.07, z + 0.07));
    }
    // Airlock hatch on the left wall around the porthole
    const lx = -CARGO.x + 0.02;
    this.box('plain', room, 0x3a3c3e, lx, lx + 0.04, FLOOR_Y + 0.05, FLOOR_Y + 2.05, 5.2, 6.4);
    this.box('plain', room, 0xc07a24, lx + 0.03, lx + 0.06, FLOOR_Y + 1.9, FLOOR_Y + 2.0, 5.25, 6.35);
    this.sign('SCHLEUSE', 'NUR IM DOCK ÖFFNEN', [lx + 0.07, 1.62, 5.8], Math.PI / 2, room, 0.9);
    this.interact('airlock', lx + 0.5, 5.8, 1.1, 'Luftschleuse');

    // Manifest screen on the forward bulkhead, beside the door
    this.screens.cargo = this.screen('cargo', [1.65, 0.95, CARGO.z0 + 0.115], 0, 0.8, 0.5, 0, room);
    this.interact('manifest', 1.65, CARGO.z0 + 0.6, 1.0, 'Frachtliste');

    this.lampPanel(0, CEIL_Y - 0.06, 4.4, 1.4, 0.35, room);
    this.lampPanel(0, CEIL_Y - 0.06, 7.3, 1.4, 0.35, room);
    this.sign('FRACHTRAUM', 'MAX. LAST SIEHE LISTE', [-1.7, 1.45, CARGO.z0 + 0.105], 0, room, 1.2);
    this.sign('MASCHINEN', 'HEISSE OBERFLÄCHEN', [0, 1.6, CARGO.z1 - 0.105], Math.PI, room, 0.9);
  }

  buildEngineRoom() {
    const room = ROOMS.engine;
    const rz = 10.3;
    // Reactor column: dark housing rings around a glowing core
    this.shape('plain', room, 0x3a3c3e, new THREE.CylinderGeometry(0.8, 0.9, 0.35, 20), [0, FLOOR_Y + 0.175, rz]);
    this.shape('plain', room, 0x3a3c3e, new THREE.CylinderGeometry(0.8, 0.8, 0.3, 20), [0, CEIL_Y - 0.15, rz]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.shape('plain', room, 0x55585c, new THREE.BoxGeometry(0.08, CEIL_Y - FLOOR_Y - 0.6, 0.08), [Math.cos(a) * 0.62, (FLOOR_Y + CEIL_Y) / 2, rz + Math.sin(a) * 0.62]);
    }
    // The core: plasma streaks running up a glass column, scrolled every frame
    this.coreTex = plasmaTexture();
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 3.0), map: this.coreTex });
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 3.0) });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, CEIL_Y - FLOOR_Y - 0.6, 24, 1, true), this.coreMat);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, CEIL_Y - FLOOR_Y - 0.6, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.45, 0.7), transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending }));
    glass.position.set(0, (FLOOR_Y + CEIL_Y) / 2, rz);
    glass.renderOrder = 2;
    this.group.add(glass);
    core.position.set(0, (FLOOR_Y + CEIL_Y) / 2, rz);
    this.group.add(core);
    this.core = core;
    this.coreRings = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.025, 6, 32), this.ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, FLOOR_Y + 0.6 + i * 0.5, rz);
      this.group.add(ring);
      this.coreRings.push(ring);
    }
    // Feed pipes out to the two nacelles
    [-1, 1].forEach((s) => {
      const g = new THREE.CylinderGeometry(0.12, 0.12, ENGINE.x - 0.7, 10);
      this.shape('plain', room, 0x8a6a40, g, [s * (0.7 + (ENGINE.x - 0.7) / 2), 1.2, rz], [0, 0, Math.PI / 2]);
      this.shape('plain', room, 0x8a6a40, new THREE.CylinderGeometry(0.09, 0.09, ENGINE.x - 0.7, 10), [s * (0.7 + (ENGINE.x - 0.7) / 2), 1.5, rz + 0.5], [0, 0, Math.PI / 2]);
    });
    this.obstacles.push([-0.95, 0.95, rz - 0.95, rz + 0.95]);
    this.interact('reactor', 0, rz - 1.1, 1.0, 'Reaktor');
    this.interact('window:aft', 0, ENGINE.z1 - 0.4, 1.6, 'Aus dem Heckfenster schauen');

    // Engineering panel on the right wall
    this.screens.reactor = this.screen('reactor', [ENGINE.x - 0.03, 0.8, 9.4], -Math.PI / 2, 0.8, 0.5, 0, room);
    this.lampPanel(0, CEIL_Y - 0.06, 9.3, 0.8, 0.3, room);
    this.sign('REAKTOR', 'ZUTRITT NUR MIT DOSIMETER', [0, 1.5, ENGINE.z1 - 0.005], Math.PI, room, 1.0);
  }

  buildDoors() {
    DOORS.forEach((d) => {
      const panels = [-1, 1].map((side) => {
        const geo = this.tag(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.08), ROOMS.any, 0x6e7276);
        const m = new THREE.Mesh(geo, this.materials.plain);
        m.position.set(side * DOOR_W / 2, FLOOR_Y + DOOR_H / 2, d.z);
        m.userData.side = side;
        this.attachLit(m);
        // warning stripe on each panel
        const stripe = new THREE.Mesh(this.tag(new THREE.BoxGeometry(DOOR_W * 0.98, 0.12, 0.09), ROOMS.any, 0xc07a24), this.materials.plain);
        stripe.position.y = 0.0;
        m.add(stripe);
        stripe.onBeforeRender = (r, s, c, g, mat) => {
          mat.uniforms.uLocal.value.multiplyMatrices(m.matrix, stripe.matrix);
          mat.uniformsNeedUpdate = true;
        };
        stripe.frustumCulled = false;
        return m;
      });
      this.doors.push({ ...d, panels, open: 0, wasOpen: false });
    });
  }

  buildWindows() {
    // Glass: a faint tint and sheen; the frames of the round portholes
    this.glassMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.45, 0.55), transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
    WINDOWS.forEach((w) => {
      const u = new THREE.Vector3(...w.u), v = new THREE.Vector3(...w.v), c = new THREE.Vector3(...w.c);
      const geo = new THREE.BufferGeometry();
      const corners = [
        c.clone().sub(u).sub(v), c.clone().add(u).sub(v), c.clone().add(u).add(v), c.clone().sub(u).add(v),
      ];
      geo.setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]);
      let glass;
      if (w.round) {
        // A round pane set into the middle of the wall
        const disc = new THREE.CircleGeometry(u.length() * 0.97, 32);
        disc.applyQuaternion(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
        disc.translate(c.x + Math.sign(c.x) * WALL * 0.5, c.y, c.z);
        glass = new THREE.Mesh(disc, this.glassMat);
      } else {
        glass = new THREE.Mesh(geo, this.glassMat);
      }
      glass.renderOrder = 2;
      this.group.add(glass);
      if (w.round) {
        // A plate with a round hole fills the square cut, and a ring frames it
        const r = u.length();
        const shape = new THREE.Shape();
        shape.moveTo(-r, -r); shape.lineTo(r, -r); shape.lineTo(r, r); shape.lineTo(-r, r); shape.closePath();
        const hole = new THREE.Path();
        hole.absarc(0, 0, r * 0.97, 0, Math.PI * 2, true);
        shape.holes.push(hole);
        const plate = new THREE.ExtrudeGeometry(shape, { depth: WALL, bevelEnabled: false, curveSegments: 24 });
        const ring = new THREE.TorusGeometry(r, 0.045, 8, 32);
        const inward = Math.sign(c.x) || 1;
        const rotY = Math.PI / 2;
        plate.applyQuaternion(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY));
        ring.applyQuaternion(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY));
        plate.translate(c.x + (inward > 0 ? 0 : -WALL), c.y, c.z);
        ring.translate(c.x - inward * 0.02, c.y, c.z);
        this.add('panel', w.room, 0xe4ddd0, plate);
        this.add('plain', w.room, 0x34363a, ring);
      } else if (w.name !== 'canopy' && w.name !== 'floor') {
        // Frame around a rectangular window
        const hu = u.length(), hv = v.length();
        const inward = w.name === 'aft' ? -1 : -Math.sign(c.x);
        const t = 0.07;
        if (w.name === 'aft') {
          this.box('plain', w.room, 0x34363a, c.x - hu - t, c.x + hu + t, c.y - hv - t, c.y - hv, c.z - 0.06, c.z);
          this.box('plain', w.room, 0x34363a, c.x - hu - t, c.x + hu + t, c.y + hv, c.y + hv + t, c.z - 0.06, c.z);
          this.box('plain', w.room, 0x34363a, c.x - hu - t, c.x - hu, c.y - hv, c.y + hv, c.z - 0.06, c.z);
          this.box('plain', w.room, 0x34363a, c.x + hu, c.x + hu + t, c.y - hv, c.y + hv, c.z - 0.06, c.z);
        } else {
          const x0 = c.x, x1 = c.x + inward * 0.06;
          const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
          this.box('plain', w.room, 0x34363a, xa, xb, c.y - hv - t, c.y - hv, c.z - hu - t, c.z + hu + t);
          this.box('plain', w.room, 0x34363a, xa, xb, c.y + hv, c.y + hv + t, c.z - hu - t, c.z + hu + t);
          this.box('plain', w.room, 0x34363a, xa, xb, c.y - hv, c.y + hv, c.z - hu - t, c.z - hu);
          this.box('plain', w.room, 0x34363a, xa, xb, c.y - hv, c.y + hv, c.z + hu, c.z + hu + t);
          // mullion
          this.box('plain', w.room, 0x34363a, xa, xb, c.y - hv, c.y + hv, c.z - 0.03, c.z + 0.03);
        }
      }
    });
  }

  // Merge every static part per material into one mesh
  flush() {
    Object.entries(this.parts).forEach(([key, geos]) => {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, this.materials[key]);
      this.attachLit(mesh);
    });
    this.parts = {};
  }

  // ----- cargo -----------------------------------------------------------------------------------

  // One crate per share of the hold, coloured by what is in it; rebuilt when the cargo changes
  updateCargo(ship) {
    const goods = GOOD_KEYS.map((k) => [k, ship.cargo[k] || 0]).filter(([, n]) => n > 0);
    if (ship.missionCargoWeight > 0) goods.push(['mission', ship.missionCargoWeight]);
    const signature = `${ship.maxCargo}|${goods.map(([k, n]) => `${k}${n}`).join(',')}`;
    if (signature === this.cargoSignature) return;
    this.cargoSignature = signature;

    if (this.crateMesh) {
      this.group.remove(this.crateMesh);
      this.crateMesh.geometry.dispose();
      this.crateMesh = null;
    }
    const perCrate = Math.max(1, ship.maxCargo / CRATE_COUNT);
    const crates = [];
    goods.forEach(([k, n]) => {
      const count = Math.max(1, Math.round(n / perCrate));
      for (let i = 0; i < count && crates.length < CRATE_COUNT; i++) crates.push(k);
    });
    this.crateObstacles = [];
    this.crateLabels = [];
    if (!crates.length) return;

    const rand = rng(crates.length * 31 + 7);
    const geos = [];
    const filled = new Set();
    crates.forEach((k, i) => {
      // Fill the bottom layer first, front to back, then stack
      const layer = i < CRATE_SLOTS.length ? 0 : 1;
      const slot = CRATE_SLOTS[i % CRATE_SLOTS.length];
      const size = CRATE * (0.9 + rand() * 0.08);
      const g = new THREE.BoxGeometry(size, size * 0.85, size);
      g.applyQuaternion(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * 0.12));
      g.translate(slot.x, FLOOR_Y + size * 0.425 + layer * CRATE * 0.86, slot.z);
      _c.set(CARGO_COLORS[k] || 0xaaaaaa);
      geos.push(this.tag(g, ROOMS.cargo, _c.getHex()));
      const key = `${slot.x},${slot.z}`;
      if (!filled.has(key)) {
        filled.add(key);
        this.crateObstacles.push([slot.x - 0.55, slot.x + 0.55, slot.z - 0.55, slot.z + 0.55]);
      }
      this.crateLabels.push({ good: k, x: slot.x, z: slot.z });
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    this.crateMesh = new THREE.Mesh(merged, this.materials.crate);
    this.attachLit(this.crateMesh);
  }

  // What crate is nearest to a point (for the prompt)
  crateNear(x, z, range = 1.3) {
    let best = null, bestD = range;
    (this.crateLabels || []).forEach((c) => {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bestD) { bestD = d; best = c; }
    });
    return best;
  }

  // ----- every frame ---------------------------------------------------------------------------

  // Place the interior with the ship, set its light from where the Sun and the nearest planet are
  update(dt, ship, solarSystem, eyeLocal, state) {
    this.group.position.copy(ship.position);
    this.group.quaternion.copy(ship.quaternion);
    this.group.updateMatrixWorld(true);
    const inv = _q.copy(ship.quaternion).invert();
    const S = this.shared;

    // Sunlight: parallel rays from the Sun, dimmed in a planet's shadow
    S.uSunDir.value.copy(ship.position).negate().normalize().applyQuaternion(inv);
    const vis = solarSystem.sunVisibility ?? 1;
    S.uSunCol.value.setRGB(1.0, 0.96, 0.9).multiplyScalar(3.2 * vis);
    // Planetshine from the fill light
    const fill = solarSystem.fillLight;
    if (fill && fill.intensity > 0.001) {
      S.uFillDir.value.copy(fill.position).sub(fill.target.position).normalize().applyQuaternion(inv);
      S.uFillCol.value.copy(fill.color).multiplyScalar(fill.intensity * 0.9);
    } else {
      S.uFillCol.value.setRGB(0, 0, 0);
    }
    S.uEye.value.copy(eyeLocal);

    // Lamps: warm white, red and pulsing on alert, flickering when the hull takes hits
    this.alert += ((state.alert ? 1 : 0) - this.alert) * Math.min(1, dt * 4);
    const t = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 1.6);
    if (state.shake > 0.05 && Math.random() < state.shake * 0.6) this.flicker = 0.15 + Math.random() * 0.4;
    else this.flicker += (1 - this.flicker) * Math.min(1, dt * 10);
    const power = state.power ?? 1;
    LAMPS.forEach((l, i) => {
      const col = S.uLampCol.value[i];
      if (l.reactor) {
        glowColor(Math.max(0.3, state.heat), col);
        col.multiplyScalar(0.18).add(_c.setRGB(0.18, 0.4, 0.85).multiplyScalar(0.3 + 0.55 * state.throttle));
        return;
      }
      if (l.console) {
        col.set(l.c).multiplyScalar(l.k);
        return;
      }
      col.set(l.c).multiplyScalar(l.k * this.flicker * power);
      if (this.alert > 0.01) {
        _c.setRGB(1.0, 0.12, 0.06).multiplyScalar(l.k * (0.25 + 1.1 * pulse) * this.flicker);
        col.lerp(_c, this.alert * 0.85);
      }
    });
    this.lampPanels.forEach((p) => {
      p.material.color.copy(p.userData.base).multiplyScalar(this.flicker * power);
      if (this.alert > 0.01) p.material.color.lerp(_c.setRGB(3.0, 0.25, 0.12).multiplyScalar(0.3 + 0.7 * pulse), this.alert * 0.85);
    });

    // Doors slide open when someone is close
    this.doors.forEach((d) => {
      const near = Math.abs(eyeLocal.z - d.z) < 1.9 && Math.abs(eyeLocal.x) < 1.6;
      const want = near ? 1 : 0;
      d.open += Math.sign(want - d.open) * Math.min(Math.abs(want - d.open), dt * 2.6);
      d.panels.forEach((p) => { p.position.x = p.userData.side * (DOOR_W / 2 + d.open * (DOOR_W + 0.04)); });
      if (near !== d.wasOpen) {
        d.wasOpen = near;
        if (state.onDoor) state.onDoor(d, near);
      }
    });

    // Reactor: brighter and faster with the throttle, glowing from blue to orange with the heat
    const thr = state.throttle;
    glowColor(Math.max(0.3, state.heat), this.coreMat.color);
    this.coreMat.color.multiplyScalar(0.45).add(_c.setRGB(0.3, 0.75, 1.7).multiplyScalar(0.4 + 0.7 * thr * (0.85 + 0.15 * Math.sin(t * 30))));
    this.ringMat.color.copy(this.coreMat.color).multiplyScalar(0.6);
    this.coreTex.offset.y -= dt * (0.2 + thr * 1.6);
    this.coreTex.offset.x += dt * 0.05;
    this.coreRings.forEach((r, i) => {
      r.position.y = FLOOR_Y + 0.4 + ((t * (0.25 + thr * 1.2) + i / 3) % 1) * (CEIL_Y - FLOOR_Y - 0.8);
    });
    // Console buttons blink
    this.buttons.children.forEach((b) => { b.visible = Math.sin(t * 1.3 + b.userData.phase) > -0.6; });
    this.coffeeLamp.material.color.setRGB(state.coffee > 0 ? 0.3 : 3, state.coffee > 0 ? 3 : 0.6, 0.2);

    this.updateCargo(ship);
  }

  // Redraw the CRTs a few times a second
  updateScreens(dt, info) {
    this.screenTimer -= dt;
    if (this.screenTimer > 0) return;
    this.screenTimer = 0.2;
    const s = this.screens;
    this.drawNav(s.nav, info);
    this.drawRadar(s.radar, info);
    this.drawShip(s.ship, info);
    this.drawStatus(s.status, info);
    this.drawCargo(s.cargo, info);
    this.drawReactor(s.reactor, info);
  }

  drawNav(sc, i) {
    sc.begin('NAVIGATION', i.alert);
    sc.row(40, 'TEMPO', i.speed);
    sc.row(64, 'SCHUB', i.throttleText);
    sc.row(88, 'ZIEL', i.target || '---');
    sc.row(112, 'ENTF.', i.targetDist || '---');
    sc.row(136, 'AUTOPILOT', i.autopilot, i.autopilotOn ? AMBER : PHOSPHOR);
    sc.row(160, 'STABILISATOR', i.assist ? 'AN' : 'AUS', i.assist ? PHOSPHOR : AMBER);
    sc.end();
  }

  drawRadar(sc, i) {
    const g = sc.g, w = sc.canvas.width, h = sc.canvas.height;
    sc.begin('KONTAKTE', i.alert);
    const cx = w / 2, cy = 115, R = 78;
    g.strokeStyle = PHOSPHOR_DIM;
    g.lineWidth = 1;
    [1, 0.5].forEach((k) => { g.beginPath(); g.arc(cx, cy, R * k, 0, 7); g.stroke(); });
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    // Sweep
    const a = (performance.now() / 1000) * 2;
    g.strokeStyle = 'rgba(125,255,176,0.5)';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
    (i.contacts || []).forEach((c) => {
      g.fillStyle = c.hostile ? RED : c.police ? '#6ab0ff' : AMBER;
      const x = cx + c.x * R, y = cy + c.z * R;
      g.fillRect(x - 3, y - 3, 6, 6);
      if (c.target) { g.strokeStyle = PHOSPHOR; g.strokeRect(x - 6, y - 6, 12, 12); }
    });
    g.fillStyle = PHOSPHOR;
    g.beginPath(); g.moveTo(cx, cy - 6); g.lineTo(cx - 4, cy + 4); g.lineTo(cx + 4, cy + 4); g.fill();
    g.font = '18px VT323, monospace';
    g.textAlign = 'right';
    g.fillStyle = PHOSPHOR_DIM;
    g.fillText(`${(i.contacts || []).length} IN REICHWEITE`, w - 10, 8);
    sc.end();
  }

  drawShip(sc, i) {
    sc.begin('SCHIFF', i.alert);
    sc.bar(40, 'SCHILD', i.shield, i.shield < 0.3 ? RED : PHOSPHOR);
    sc.bar(64, 'HÜLLE', i.hull, i.hull < 0.3 ? RED : PHOSPHOR);
    sc.bar(88, 'TREIBST.', i.fuel, i.fuel < 0.15 ? AMBER : PHOSPHOR);
    sc.bar(112, 'TEMP', i.heat, i.heat > 0.8 ? RED : i.heat > 0.6 ? AMBER : PHOSPHOR);
    sc.bar(136, 'ENERGIE', i.energy);
    sc.row(164, 'RAKETEN', `${i.missiles}   TÄUSCHK. ${i.flares}`);
    sc.end();
  }

  drawStatus(sc, i) {
    const g = sc.g, w = sc.canvas.width;
    sc.begin('SCHIFFSSTATUS · SOL 4471', i.alert);
    if (i.alertText) {
      const on = Math.floor(performance.now() / 400) % 2 === 0;
      g.fillStyle = on ? RED : '#601a14';
      g.fillRect(10, 36, w - 20, 22);
      g.fillStyle = on ? '#100404' : RED;
      g.font = '20px VT323, monospace';
      g.textAlign = 'center';
      g.fillText(i.alertText, w / 2, 37);
    } else {
      sc.row(38, 'LAGE', 'NORMAL');
    }
    sc.row(62, 'IN DER NÄHE', i.near || '---');
    sc.row(84, 'ABSTAND', i.nearDist || '---');
    sc.row(106, 'TEMPO', i.speed);
    sc.row(128, 'AUTOPILOT', i.autopilot, i.autopilotOn ? AMBER : PHOSPHOR);
    sc.row(150, 'SCHILD / HÜLLE', `${Math.round(i.shield * 100)}% / ${Math.round(i.hull * 100)}%`, i.hull < 0.3 ? RED : PHOSPHOR);
    sc.row(172, 'BORDZEIT', i.clock);
    sc.end();
  }

  drawCargo(sc, i) {
    const g = sc.g;
    sc.begin('FRACHTLISTE', i.alert);
    const lines = i.cargo.length ? i.cargo : [['LEER', '']];
    lines.slice(0, 6).forEach(([name, t], n) => sc.row(38 + n * 22, name, t));
    g.fillStyle = PHOSPHOR_DIM;
    g.fillRect(10, 172, sc.canvas.width - 20, 1);
    sc.row(176, 'BELEGT', i.cargoTotal);
    sc.end();
  }

  drawReactor(sc, i) {
    sc.begin('REAKTOR', i.alert || i.overheated);
    sc.bar(40, 'LEISTUNG', i.throttle);
    sc.bar(64, 'TEMP', i.heat, i.heat > 0.8 ? RED : i.heat > 0.6 ? AMBER : PHOSPHOR);
    sc.bar(88, 'TRIEBWERK', i.sysEngine, i.sysEngine < 0.5 ? AMBER : PHOSPHOR);
    sc.bar(112, 'WAFFEN', i.sysWeapons, i.sysWeapons < 0.5 ? AMBER : PHOSPHOR);
    sc.bar(136, 'SENSOREN', i.sysSensors, i.sysSensors < 0.5 ? AMBER : PHOSPHOR);
    sc.row(164, 'STATUS', i.overheated ? 'ÜBERHITZT' : i.heat > 0.6 ? 'HEISS' : 'NOMINAL', i.overheated ? RED : i.heat > 0.6 ? AMBER : PHOSPHOR);
    sc.end();
  }

  roomAt(z) {
    if (z < BRIDGE.z1) return 0;
    if (z < CREW.z1) return 1;
    if (z < CARGO.z1) return 2;
    return 3;
  }

  roomName(z) {
    return ROOM_NAMES[this.roomAt(z)];
  }
}
