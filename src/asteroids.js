import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from './shipModel';

// Asteroids that hold up from a metre away: potato-shaped bodies with craters, rims, ridges and boulders baked
// into dense geometry (three levels of detail), regolith colour baked into the vertices, and a shader that adds
// fine relief, grain, fresh ice and metal veins per pixel. Fields are dressed with gravel and drifting dust.

// ----- seeded 3D gradient noise ----------------------------------------------------------------------

function makeNoise(seed) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => { const g = G[h % 12]; return g[0] * x + g[1] * y + g[2] * z; };
  const lerp = (a, b, t) => a + (b - a) * t;
  return (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u), lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    );
  };
}

function fbm(noise, x, y, z, oct, lac = 2.03, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x * f, y * f, z * f);
    n += a;
    a *= gain;
    f *= lac;
  }
  return s / n;
}

function ridged(noise, x, y, z, oct) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(noise(x * f + 11.3, y * f, z * f));
    s += a * v * v;
    n += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / n;
}

// ----- shapes ----------------------------------------------------------------------------------------

// One rock's recipe: the same function displaces every level of detail, so they match
function rockRecipe(seed) {
  const r = rng(seed * 131 + 7);
  r(); r();
  const noise = makeNoise(seed * 977 + 3);
  const craters = [];
  const nCraters = 9 + Math.floor(r() * 14);
  for (let i = 0; i < nCraters; i++) {
    const c = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    const big = i < 2;
    craters.push({ c, ang: big ? 0.38 + r() * 0.35 : 0.07 + r() * 0.24, depth: big ? 0.14 + r() * 0.1 : 0.04 + r() * 0.07 });
  }
  const boulders = [];
  for (let i = 0; i < 6 + Math.floor(r() * 10); i++) {
    boulders.push({ c: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), ang: 0.03 + r() * 0.05, h: 0.012 + r() * 0.025 });
  }
  // Some rocks are two lumps stuck together (contact binaries)
  const lobe = r() < 0.3 ? { d: new THREE.Vector3(r() - 0.5, r() * 0.4 - 0.2, r() - 0.5).normalize(), k: 0.25 + r() * 0.2 } : null;
  const off = [r() * 50, r() * 50, r() * 50];
  const lumpy = 0.22 + r() * 0.18;
  const tmp = new THREE.Vector3();
  return (n) => {
    const x = n.x + off[0], y = n.y + off[1], z = n.z + off[2];
    let h = lumpy * fbm(noise, x * 1.1, y * 1.1, z * 1.1, 3);
    h += 0.06 * fbm(noise, x * 3.1, y * 3.1, z * 3.1, 4);
    h += 0.055 * (ridged(noise, x * 6.5, y * 6.5, z * 6.5, 4) - 0.5);
    let crater = 0, rim = 0;
    for (const k of craters) {
      const t = Math.acos(THREE.MathUtils.clamp(n.dot(k.c), -1, 1)) / k.ang;
      if (t < 1) crater = Math.min(crater, (t * t - 1) * k.depth);
      if (t > 0.7 && t < 1.8) rim = Math.max(rim, Math.exp(-((t - 1.05) ** 2) * 16) * k.depth * 0.55);
    }
    let boulder = 0;
    for (const b of boulders) {
      const t = Math.acos(THREE.MathUtils.clamp(n.dot(b.c), -1, 1)) / b.ang;
      if (t < 1) boulder = Math.max(boulder, Math.sqrt(1 - t * t) * b.h);
    }
    h += crater + rim + boulder;
    let lobeF = 1;
    if (lobe) {
      tmp.copy(n);
      const d = tmp.dot(lobe.d);
      lobeF = 1 + lobe.k * Math.max(0, d) ** 3 - lobe.k * 0.35 * Math.exp(-(d * d) * 30); // a neck between the lumps
    }
    // Albedo hints: crater floors dark, rims and boulders bright, broad patches of different regolith
    const patch = fbm(noise, x * 2.2 + 40, y * 2.2, z * 2.2, 3);
    // Low-frequency relief relative to the local average darkens hollows (cheap ambient occlusion)
    const hollow = h - lumpy * fbm(noise, x * 1.1, y * 1.1, z * 1.1, 2);
    const shade = 1 + crater * 4.5 + rim * 4 + boulder * 5 + patch * 0.45 + hollow * 1.6;
    return { r: (1 + h) * lobeF, shade, patch };
  };
}

function shapeGeometry(recipe, detail, stretch) {
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    const s = recipe(n);
    n.multiplyScalar(s.r).multiply(stretch);
    pos.setXYZ(i, n.x, n.y, n.z);
    const v = THREE.MathUtils.clamp(s.shade, 0.4, 1.4);
    // A slight warm/cold shift between regolith patches
    colors[i * 3] = v * (1 + s.patch * 0.08);
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v * (1 - s.patch * 0.08);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// Normalise so the rock's bulk sits inside the unit sphere the game uses for collisions and targeting
function fitToUnit(geos) {
  let max = 0;
  const v = new THREE.Vector3();
  const pos = geos[0].attributes.position;
  for (let i = 0; i < pos.count; i++) max = Math.max(max, v.fromBufferAttribute(pos, i).length());
  const k = 1.18 / max;
  geos.forEach((g) => { g.scale(k, k, k); g.computeBoundingSphere(); });
}

export function buildRockShapes(count = 8) {
  const shapes = [];
  for (let s = 0; s < count; s++) {
    const recipe = rockRecipe(100 + s * 17);
    const r = rng(500 + s * 13);
    const stretch = new THREE.Vector3(0.75 + r() * 0.55, 0.6 + r() * 0.4, 0.8 + r() * 0.5);
    const levels = [shapeGeometry(recipe, 5, stretch), shapeGeometry(recipe, 3, stretch), shapeGeometry(recipe, 1, stretch)];
    fitToUnit(levels);
    shapes.push(levels);
  }
  return shapes;
}

// ----- materials -------------------------------------------------------------------------------------

const ROCK_GLSL = /* glsl */ `
varying vec3 vRockPos;
uniform float uKind;
uniform float uBump;

vec3 rk_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 rk_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 rk_perm(vec4 x) { return rk_mod289(((x * 34.0) + 1.0) * x); }
vec4 rk_taylor(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float rk_snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = rk_mod289(i);
  vec4 p = rk_perm(rk_perm(rk_perm(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = rk_taylor(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Fine relief that fades out before it would shimmer
float rk_height(vec3 p, float fade) {
  float h = 0.0;
  float a = 0.5;
  float f = 9.0;
  for (int i = 0; i < 5; i++) {
    float w = 1.0 - smoothstep(0.35, 1.0, fade * f / 9.0);
    h += a * w * rk_snoise(p * f);
    a *= 0.55;
    f *= 2.1;
  }
  // Pits and pebbles
  float pits = smoothstep(0.55, 0.85, rk_snoise(p * 26.0 + 3.0));
  h -= pits * 0.35 * (1.0 - smoothstep(0.2, 0.8, fade * 3.0));
  return h;
}

vec3 rk_perturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

function rockMaterial(kind, base) {
  const m = new THREE.MeshStandardMaterial({
    color: base.color,
    roughness: base.roughness,
    metalness: base.metalness,
    vertexColors: true,
    emissive: base.emissive || 0x000000,
  });
  const uniforms = { uKind: { value: kind }, uBump: { value: base.bump } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROCK_GLSL}\nfloat rkVein = 0.0;\nfloat rkFade = 0.0;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        rkFade = length(fwidth(vRockPos)) * 6.0;
        float rkGrain = rk_snoise(vRockPos * 7.0) * 0.5 + rk_snoise(vRockPos * 19.0) * 0.25 * (1.0 - smoothstep(0.3, 1.0, rkFade * 2.0));
        diffuseColor.rgb *= 0.86 + 0.28 * rkGrain;
        if (uKind > 1.5) {
          // Metal veins in dark rock
          // Veins only where a slow mask lets them through, plus scattered metal specks
          float mask = smoothstep(0.05, 0.45, rk_snoise(vRockPos * 1.3 + 31.0));
          float v = 1.0 - abs(rk_snoise(vRockPos * vec3(2.2, 2.9, 2.5) + 5.0));
          float specks = smoothstep(0.72, 0.85, rk_snoise(vRockPos * 30.0 + 2.0)) * (1.0 - smoothstep(0.3, 1.0, rkFade * 4.0));
          rkVein = smoothstep(0.955, 0.99, v) * mask + specks * 0.5;
          rkVein = clamp(rkVein, 0.0, 1.0);
          vec3 metal = mix(vec3(0.42, 0.26, 0.14), vec3(0.62, 0.48, 0.26), rk_snoise(vRockPos * 11.0) * 0.5 + 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, metal, rkVein);
        } else if (uKind > 0.5) {
          // Dirty ice: cracks and darker dust in the hollows
          float crack = 1.0 - abs(rk_snoise(vRockPos * 5.0 + 9.0));
          diffuseColor.rgb *= 1.0 - 0.35 * smoothstep(0.93, 0.99, crack);
          float dust = smoothstep(0.1, 0.6, rk_snoise(vRockPos * 2.0 + 21.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.58, 0.55), dust * 0.6);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.5, rkVein);
        if (uKind > 0.5 && uKind < 1.5) roughnessFactor = clamp(roughnessFactor + rk_snoise(vRockPos * 8.0) * 0.2, 0.15, 0.8);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.7, rkVein);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float hgt = rk_height(vRockPos, rkFade);
          vec2 dHdxy = vec2(dFdx(hgt), dFdy(hgt)) * uBump * (1.0 - rkVein * 0.7);
          normal = rk_perturb(-vViewPosition, normal, dHdxy, faceDirection);
        }`);
  };
  m.customProgramCacheKey = () => `rock-${kind}`;
  return m;
}

export function makeRockMaterials() {
  return {
    rock: rockMaterial(0, { color: 0x6e665c, roughness: 0.94, metalness: 0.02, bump: 1.5 }),
    ice: rockMaterial(1, { color: 0xb8cad6, roughness: 0.42, metalness: 0.05, bump: 0.9, emissive: 0x081016 }),
    ore: rockMaterial(2, { color: 0x5a4436, roughness: 0.85, metalness: 0.1, bump: 1.3 }),
  };
}

// A rock with three levels of detail; distances scale with its size
export function makeRock(levels, material, size) {
  const lod = new THREE.LOD();
  lod.addLevel(new THREE.Mesh(levels[0], material), 0);
  lod.addLevel(new THREE.Mesh(levels[1], material), 40 + size * 14);
  lod.addLevel(new THREE.Mesh(levels[2], material), 220 + size * 45);
  lod.scale.setScalar(size);
  return lod;
}

// ----- field dressing: gravel and dust -----------------------------------------------------------------

export function dressField(field, center, shapes, materials, seed) {
  const group = new THREE.Group();
  const rand = rng(seed);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  // Gravel: thousands of small stones, three kinds, drawn in one go per kind
  ['rock', 'ore', 'ice'].forEach((kind, ki) => {
    const count = Math.round(field.count * (kind === 'rock' ? 5 : 2));
    const mesh = new THREE.InstancedMesh(shapes[ki % shapes.length][2], materials[kind], count);
    for (let i = 0; i < count; i++) {
      const r = field.spread * 1.1 * Math.sqrt(rand()) * (0.2 + rand() * 0.8);
      const a = rand() * Math.PI * 2;
      dummy.position.set(center.x + Math.cos(a) * r, (rand() - 0.5) * field.spread * 0.22, center.z + Math.sin(a) * r);
      dummy.rotation.set(rand() * 6, rand() * 6, rand() * 6);
      dummy.scale.setScalar(0.15 + 0.9 * rand() ** 2.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const k = 0.75 + rand() * 0.4;
      mesh.setColorAt(i, color.setRGB(k, k * (0.95 + rand() * 0.08), k * (0.9 + rand() * 0.12)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  // Dust: fine sunlit grains that make speed visible when flying through
  const n = field.count * 30;
  const pts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = field.spread * 1.2 * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    pts[i * 3] = center.x + Math.cos(a) * r;
    pts[i * 3 + 1] = (rand() - 0.5) * field.spread * 0.3;
    pts[i * 3 + 2] = center.z + Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  // Only visible around the camera, so the field doesn't turn into a sheet of speckles from afar
  const dust = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xc8b8a0) }, uNear: { value: 380 } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float uNear;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = -mv.z;
        vA = 1.0 - smoothstep(uNear * 0.35, uNear, d);
        gl_PointSize = clamp(110.0 / max(d, 1.0), 1.0, 4.0);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      varying float vA;
      void main() {
        #include <logdepthbuf_fragment>
        float a = smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5)) * vA * 0.7;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
  }));
  dust.frustumCulled = false;
  group.add(dust);
  return group;
}
