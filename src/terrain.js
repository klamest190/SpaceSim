import * as THREE from 'three';

// The ground under a ship in atmospheric flight. The world is a plane in local units (x east, y up, z south;
// one unit is about six metres); its large shapes come from the planet's own baked maps, laid onto the
// plane around the point where the ship came down (an azimuthal equidistant projection), its small shapes
// from noise. Heights are computed on the CPU, so the ship collides with exactly the ground that is drawn.

// ----- noise ---------------------------------------------------------------------------------------

const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const PERM = new Uint8Array(512);
(() => {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// 2D simplex noise (after Stefan Gustavson), about -1..1
export function simplex2(x, y) {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = 1 - i1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const g = GRAD[PERM[ii + PERM[jj]] & 7];
    t0 *= t0;
    n += t0 * t0 * (g[0] * x0 + g[1] * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const g = GRAD[PERM[ii + i1 + PERM[jj + j1]] & 7];
    t1 *= t1;
    n += t1 * t1 * (g[0] * x1 + g[1] * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const g = GRAD[PERM[ii + 1 + PERM[jj + 1]] & 7];
    t2 *= t2;
    n += t2 * t2 * (g[0] * x2 + g[1] * y2);
  }
  return 60 * n;
}

export function fbm2(x, y, octaves) {
  let sum = 0;
  let amp = 0.5;
  for (let i = 0; i < octaves; i++) {
    sum += amp * simplex2(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 4.3;
    amp *= 0.5;
  }
  return sum;
}

// Sharp crests: mountain chains
export function ridged2(x, y, octaves) {
  let sum = 0;
  let amp = 0.5;
  let prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(simplex2(x, y));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    x = x * 2.07 + 3.7;
    y = y * 2.07 + 11.3;
    amp *= 0.5;
  }
  return sum;
}

// Octaves of a noise whose first octave has wavelength `wl` that a mesh with sample spacing ~minWl / 2 resolves
function oct(wl, minWl, max) {
  return THREE.MathUtils.clamp(Math.floor(Math.log2(wl / minWl)) + 1, 1, max);
}

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(i, j, k) {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1440662683);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

// Impact craters in cells of the given size: bowl, raised rim, a skirt of ejecta
function craters2(x, z, cell, density, depth) {
  const cx = Math.floor(x / cell);
  const cz = Math.floor(z / cell);
  let h = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx;
      const iz = cz + dz;
      if (hash2(ix, iz, 1) > density) continue;
      const px = (ix + 0.2 + 0.6 * hash2(ix, iz, 2)) * cell;
      const pz = (iz + 0.2 + 0.6 * hash2(ix, iz, 3)) * cell;
      const rad = cell * (0.12 + 0.3 * hash2(ix, iz, 4));
      const d = Math.hypot(x - px, z - pz) / rad;
      if (d > 2.5) continue;
      const bowl = d < 1 ? (d * d - 1) * 0.9 : 0;
      const rim = Math.exp(-(((d - 1) * 4) ** 2)) * 0.35;
      const ejecta = d > 1 ? 0.08 * Math.exp(-(d - 1) * 3) : 0;
      h += (bowl + rim + ejecta) * rad * depth;
    }
  }
  return h;
}

// ----- the planet's maps on the plane ----------------------------------------------------------------

// Samples a body's baked ground data at local plane coordinates. c, east and south are unit vectors in the
// planet's own (spinning) frame: the touchdown point and the plane's x and z axes there.
export class MacroMap {
  constructor(data, rMap) {
    this.data = data;
    this.rMap = rMap;
    this.c = new THREE.Vector3(0, 1, 0);
    this.e = new THREE.Vector3(1, 0, 0);
    this.s = new THREE.Vector3(0, 0, 1);
    this.h = 0;
    this.water = 0;
    this.cloud = 0;
    this.dir = new THREE.Vector3();
  }

  setCenter(c) {
    this.c.copy(c).normalize();
    // East along the latitude circle; south completes the right-handed frame (x = east, y = up, z = south)
    this.e.set(-this.c.z, 0, this.c.x);
    if (this.e.lengthSq() < 1e-8) this.e.set(1, 0, 0);
    this.e.normalize();
    this.s.crossVectors(this.e, this.c).normalize();
  }

  // Direction from the planet centre (planet frame) of the plane point (x, z)
  direction(x, z, out = this.dir) {
    const r = Math.hypot(x, z);
    if (r < 1e-6) return out.copy(this.c);
    const th = r / this.rMap;
    const k = Math.sin(th) / r;
    const cth = Math.cos(th);
    out.set(
      this.c.x * cth + (this.e.x * x + this.s.x * z) * k,
      this.c.y * cth + (this.e.y * x + this.s.y * z) * k,
      this.c.z * cth + (this.e.z * x + this.s.z * z) * k
    );
    return out.normalize();
  }

  // The local x, y, z axes at plane point (x, z), in the planet frame
  frameAt(x, z, ex, ey, ez) {
    const r = Math.hypot(x, z);
    if (r < 1e-6) {
      ex.copy(this.e);
      ey.copy(this.c);
      ez.copy(this.s);
      return;
    }
    const th = r / this.rMap;
    const ux = x / r;
    const uz = z / r;
    const radial = new THREE.Vector3().copy(this.e).multiplyScalar(ux).addScaledVector(this.s, uz);
    const tr = radial.clone().multiplyScalar(Math.cos(th)).addScaledVector(this.c, -Math.sin(th));
    const tphi = new THREE.Vector3().copy(this.e).multiplyScalar(-uz).addScaledVector(this.s, ux);
    ey.copy(this.c).multiplyScalar(Math.cos(th)).addScaledVector(radial, Math.sin(th)).normalize();
    ex.copy(tr).multiplyScalar(ux).addScaledVector(tphi, -uz).normalize();
    ez.copy(tr).multiplyScalar(uz).addScaledVector(tphi, ux).normalize();
  }

  // Bilinear lookup of height, water and cloud at the plane point; results in this.h / .water / .cloud
  sample(x, z) {
    const d = this.direction(x, z);
    const { width, height, heights, water, cloud } = this.data;
    const u = Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5;
    const v = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI + 0.5;
    const fx = u * width - 0.5;
    const fy = THREE.MathUtils.clamp(v * height - 0.5, 0, height - 1.001);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const xa = ((x0 % width) + width) % width;
    const xb = (xa + 1) % width;
    const r0 = y0 * width;
    const r1 = (y0 + 1) * width;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    this.h = heights[r0 + xa] * w00 + heights[r0 + xb] * w10 + heights[r1 + xa] * w01 + heights[r1 + xb] * w11;
    this.water = (water[r0 + xa] * w00 + water[r0 + xb] * w10 + water[r1 + xa] * w01 + water[r1 + xb] * w11) / 255;
    this.cloud = (cloud[r0 + xa] * w00 + cloud[r0 + xb] * w10 + cloud[r1 + xa] * w01 + cloud[r1 + xb] * w11) / 255;
    return this;
  }
}

// ----- ground shapes per world -------------------------------------------------------------------------

// height(x, z, minWl): ground height in local units; minWl drops the noise finer than a mesh can show
// (pass 1 for the full detail a collision needs). Earth's ground may lie below sea level (y = 0).
export const GROUND_SHAPES = {
  Earth(m, x, z, minWl) {
    m.sample(x, z);
    const coast = fbm2(x / 2600 + 11.3, z / 2600, oct(2600, minWl, 4)) * 0.3 + fbm2(x / 420, z / 420 + 5.1, oct(420, minWl, 3)) * 0.12;
    const landness = 1 - m.water + coast;
    const land = smoothstep(0.42, 0.62, landness);
    if (land <= 0) return -40 - 260 * smoothstep(0.5, 0, landness);
    const e = m.h;
    const mtn = smoothstep(0.05, 0.3, e);
    const ridges = mtn > 0.001 ? ridged2(x / 2400 + 3.3, z / 2400, oct(2400, minWl, 7)) * 820 * mtn : 0;
    const hills = (fbm2(x / 1700, z / 1700 + 7.7, oct(1700, minWl, 6)) * 0.5 + 0.5) * 140;
    const fine = minWl < 140 ? fbm2(x / 140 + 1.9, z / 140, oct(140, minWl, 3)) * 7 : 0;
    const inland = smoothstep(0.5, 0.85, landness);
    const hLand = 2 + e * 700 + ridges + hills * inland * (1 - 0.5 * mtn) + fine;
    const seaFloor = -40 - 260 * smoothstep(0.5, 0, landness);
    return seaFloor + (hLand - seaFloor) * land;
  },

  Mars(m, x, z, minWl) {
    m.sample(x, z);
    const e = m.h;
    const hills = fbm2(x / 1500 + 4.4, z / 1500, oct(1500, minWl, 6)) * 120;
    const rugged = ridged2(x / 900, z / 900 + 2.2, oct(900, minWl, 5)) * 170 * smoothstep(0.05, 0.4, e);
    let h = e * 900 + hills + rugged;
    h += craters2(x, z, 1400, 0.45, 0.5) + craters2(x + 77, z, 380, 0.55, 0.45);
    if (minWl < 120) h += craters2(x, z - 31, 90, 0.6, 0.4);
    if (minWl < 40) {
      // Dunes in the lowlands
      const lowland = smoothstep(0.15, -0.2, e);
      if (lowland > 0) {
        const phase = (x * 0.8 + z * 0.6) / 38 + fbm2(x / 600, z / 600, 3) * 6;
        h += lowland * (Math.sin(phase) * 0.5 + 0.5) ** 2 * 9;
      }
    }
    if (minWl < 120) h += fbm2(x / 120, z / 120 + 9.1, oct(120, minWl, 3)) * 5;
    return h;
  },

  Mercury(m, x, z, minWl) {
    m.sample(x, z);
    let h = m.h * 1400 + fbm2(x / 2000, z / 2000, oct(2000, minWl, 6)) * 90;
    h += craters2(x, z, 2400, 0.45, 0.55) + craters2(x + 51, z, 900, 0.55, 0.5) + craters2(x, z + 13, 300, 0.6, 0.45);
    if (minWl < 180) h += craters2(x - 7, z, 90, 0.65, 0.42);
    if (minWl < 56) h += craters2(x, z - 3, 28, 0.7, 0.4);
    if (minWl < 100) h += fbm2(x / 100, z / 100, oct(100, minWl, 3)) * 4;
    return h;
  },

  Venus(m, x, z, minWl) {
    m.sample(x, z);
    const e = m.h;
    const hills = fbm2(x / 1300 + 2.1, z / 1300, oct(1300, minWl, 6)) * 100;
    const folds = ridged2(x / 700, z / 1100, oct(700, minWl, 5)) * 160 * smoothstep(0.15, 0.45, e);
    // Old lava flows: flat sheets with low lobed edges
    const flows = Math.max(0, fbm2(x / 900 + 5.5, z / 900, oct(900, minWl, 4))) * 45;
    let h = e * 800 + hills + folds + flows;
    if (minWl < 120) h += fbm2(x / 120, z / 120, oct(120, minWl, 3)) * 5;
    return h;
  }
};

// ----- chunks ------------------------------------------------------------------------------------------

const N = 16;                 // cells along a chunk's side
const ROOT = 16384;           // size of the coarsest chunks
const MAX_LEVEL = 9;          // ROOT / 2^9 = 32 units, two units between vertices
const LOD_K = 1.9;            // a chunk splits when the camera is closer than this many chunk sizes
const VIEW = 40000;           // ground drawn this far around the camera
const MAX_CHUNKS = 1400;
const VERTS = (N + 1) * (N + 1) + 4 * N; // grid plus one skirt vertex per border vertex

// Grid triangles, then a skirt hanging from the border so different detail levels never show a crack
function buildIndex() {
  const idx = [];
  const v = (i, j) => j * (N + 1) + i;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  const border = borderLoop();
  const base = (N + 1) * (N + 1);
  for (let k = 0; k < border.length; k++) {
    const a = border[k], b = border[(k + 1) % border.length];
    const sa = base + k, sb = base + ((k + 1) % border.length);
    idx.push(a, sa, b, b, sa, sb);
  }
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
}

function borderLoop() {
  const loop = [];
  const v = (i, j) => j * (N + 1) + i;
  for (let i = 0; i < N; i++) loop.push(v(i, 0));
  for (let j = 0; j < N; j++) loop.push(v(N, j));
  for (let i = N; i > 0; i--) loop.push(v(i, N));
  for (let j = N; j > 0; j--) loop.push(v(0, j));
  return loop;
}

const BORDER = borderLoop();
const INDEX = buildIndex();
const _cam = new THREE.Vector3();

export class Terrain {
  constructor(material) {
    this.group = new THREE.Group();
    this.material = material;
    this.chunks = new Map();
    this.queue = [];
    this.frame = 0;
    this.shape = null;
    this.macro = null;
    this.water = false;
    this.heights = new Float32Array((N + 3) * (N + 3));
  }

  // A new place to fly over: forget the old ground
  reset(shape, macro, water) {
    this.chunks.forEach((c) => this.dropChunk(c));
    this.chunks.clear();
    this.shape = shape;
    this.macro = macro;
    this.water = water;
  }

  dropChunk(chunk) {
    if (chunk.mesh) {
      this.group.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
    }
  }

  // Raw ground height with full detail (below zero is under water where there is a sea)
  rawHeight(x, z) {
    return this.shape(this.macro, x, z, 1);
  }

  // What the ship stands on: the ground, or the water surface
  floorHeight(x, z) {
    const h = this.rawHeight(x, z);
    return this.water ? Math.max(h, 0) : h;
  }

  key(level, ix, iz) {
    return `${level}:${ix}:${iz}`;
  }

  buildChunk(level, ix, iz) {
    const size = ROOT / 2 ** level;
    const x0 = ix * size;
    const z0 = iz * size;
    const s = size / N;
    const minWl = s * 2;
    const M = N + 3;
    const H = this.heights;
    const water = this.water;
    let minY = Infinity, maxY = -Infinity;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const h = this.shape(this.macro, x0 + (i - 1) * s, z0 + (j - 1) * s, minWl);
        H[j * M + i] = h;
      }
    }
    const pos = new Float32Array(VERTS * 3);
    const nrm = new Float32Array(VERTS * 3);
    const depth = new Float32Array(VERTS);
    const surf = (i, j) => {
      const h = H[(j + 1) * M + (i + 1)];
      return water ? Math.max(h, 0) : h;
    };
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const k = j * (N + 1) + i;
        const raw = H[(j + 1) * M + (i + 1)];
        const y = water ? Math.max(raw, 0) : raw;
        pos[k * 3] = i * s;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = j * s;
        depth[k] = water ? Math.max(0, -raw) : 0;
        const nx = (surf(i - 1, j) - surf(i + 1, j)) / (2 * s);
        const nz = (surf(i, j - 1) - surf(i, j + 1)) / (2 * s);
        const len = Math.hypot(nx, 1, nz);
        nrm[k * 3] = nx / len;
        nrm[k * 3 + 1] = 1 / len;
        nrm[k * 3 + 2] = nz / len;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const skirt = size * 0.03 + 6;
    const base = (N + 1) * (N + 1);
    for (let k = 0; k < BORDER.length; k++) {
      const b = BORDER[k];
      const t = base + k;
      pos[t * 3] = pos[b * 3];
      pos[t * 3 + 1] = pos[b * 3 + 1] - skirt;
      pos[t * 3 + 2] = pos[b * 3 + 2];
      nrm[t * 3] = nrm[b * 3];
      nrm[t * 3 + 1] = nrm[b * 3 + 1];
      nrm[t * 3 + 2] = nrm[b * 3 + 2];
      depth[t] = depth[b];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geometry.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
    geometry.setIndex(INDEX);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(x0, 0, z0);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.group.add(mesh);
    return { level, ix, iz, size, x0, z0, minY, maxY, mesh, used: this.frame };
  }

  // Distance from the camera to a chunk's box
  boxDistance(cam, x0, z0, size, minY, maxY) {
    const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + size));
    const dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + size));
    const dy = Math.max(minY - cam.y, 0, cam.y - maxY);
    return Math.hypot(dx, dy, dz);
  }

  // Pick the chunks to draw this frame, and build missing ones within the time budget (ms)
  update(camera, budget = 3) {
    this.frame++;
    _cam.copy(camera.position);
    this.queue.length = 0;
    this.group.children.forEach((m) => { m.visible = false; });

    const r0 = Math.floor((_cam.x - VIEW) / ROOT);
    const r1 = Math.floor((_cam.x + VIEW) / ROOT);
    const c0 = Math.floor((_cam.z - VIEW) / ROOT);
    const c1 = Math.floor((_cam.z + VIEW) / ROOT);
    const start = performance.now();
    for (let iz = c0; iz <= c1; iz++) {
      for (let ix = r0; ix <= r1; ix++) {
        let root = this.chunks.get(this.key(0, ix, iz));
        if (!root) {
          root = this.buildChunk(0, ix, iz);
          this.chunks.set(this.key(0, ix, iz), root);
        }
        this.select(root, 0);
      }
    }

    // Coarse first, then nearest: the ground fills in from the outline to the detail
    this.queue.sort((a, b) => a.level - b.level || a.dist - b.dist);
    for (const q of this.queue) {
      if (performance.now() - start > budget) break;
      const key = this.key(q.level, q.ix, q.iz);
      if (this.chunks.has(key)) continue;
      this.chunks.set(key, this.buildChunk(q.level, q.ix, q.iz));
    }
    this.evict();
  }

  select(chunk, level) {
    chunk.used = this.frame;
    const dist = this.boxDistance(_cam, chunk.x0, chunk.z0, chunk.size, chunk.minY, chunk.maxY);
    if (level < MAX_LEVEL && dist < chunk.size * LOD_K) {
      const kids = [];
      let ready = true;
      for (let k = 0; k < 4; k++) {
        const ix = chunk.ix * 2 + (k & 1);
        const iz = chunk.iz * 2 + (k >> 1);
        const kid = this.chunks.get(this.key(level + 1, ix, iz));
        if (!kid) {
          ready = false;
          this.queue.push({ level: level + 1, ix, iz, dist });
        } else {
          kid.used = this.frame;
        }
        kids.push(kid);
      }
      if (ready) {
        kids.forEach((kid) => this.select(kid, level + 1));
        return;
      }
    }
    chunk.mesh.visible = true;
  }

  evict() {
    if (this.chunks.size <= MAX_CHUNKS) return;
    const old = [...this.chunks.entries()]
      .filter(([, c]) => c.used < this.frame - 2 && c.level > 0)
      .sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < old.length && this.chunks.size > MAX_CHUNKS * 0.85; i++) {
      this.dropChunk(old[i][1]);
      this.chunks.delete(old[i][0]);
    }
  }

  // Build the ground around the camera with a generous budget, while the screen is hidden by the entry flash
  prime(camera, ms = 250) {
    const end = performance.now() + ms;
    let rounds = 0;
    while (performance.now() < end && rounds < 40) {
      const before = this.chunks.size;
      this.update(camera, Math.max(1, end - performance.now()));
      rounds++;
      if (this.chunks.size === before) break;
    }
  }
}
