import * as THREE from 'three';

// The player's freighter: a chunky, faceted working ship in the spirit of the 90s cockpit sims,
// rendered with today's materials. Flat-shaded hull lofted from chamfered sections, painted livery
// (bone-white upper hull, gunmetal belly, ochre trim), panel lines and grime from one procedural texture,
// glass canopy, twin ion nacelles with plumes, wingtip guns and blinking nav lights.
// Built in world units: about 2.5 long, 2.8 across the gun pods. -Z is forward.

// Muzzles of the two wingtip guns, in ship space; the lasers leave from here
export const GUN_MUZZLES = [new THREE.Vector3(-1.2, -0.1, -0.78), new THREE.Vector3(1.2, -0.1, -0.78)];

const NOZZLES = [new THREE.Vector3(-0.7, -0.02, 1.2), new THREE.Vector3(0.7, -0.02, 1.2)];

const PAINT = {
  bone: new THREE.Color(0xb8b09a),
  boneDark: new THREE.Color(0x8f8875),
  gunmetal: new THREE.Color(0x3d3e40),
  dark: new THREE.Color(0x232426),
  ochre: new THREE.Color(0xb8741f),
};

// --------------------------------------------------------------------------------------------
// Procedural hull texture: panel lines, panel tone patches, rivets, streaks. One tile per world unit.
// --------------------------------------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeHullTextures() {
  const size = 1024;
  const albedo = document.createElement('canvas');
  albedo.width = albedo.height = size;
  const a = albedo.getContext('2d');
  const bump = document.createElement('canvas');
  bump.width = bump.height = size;
  const b = bump.getContext('2d');
  const rough = document.createElement('canvas');
  rough.width = rough.height = size;
  const r = rough.getContext('2d');
  const rand = rng(7);

  a.fillStyle = '#ffffff';
  a.fillRect(0, 0, size, size);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, size, size);
  r.fillStyle = '#8c8c8c';
  r.fillRect(0, 0, size, size);

  // Panels: recursive splits of the tile, so seams form a believable plating layout
  const panels = [];
  const split = (x, y, w, h, depth) => {
    if (depth > 3 || (depth > 1 && rand() < 0.25) || w < 90 || h < 90) {
      panels.push([x, y, w, h]);
      return;
    }
    if (w > h ? rand() < 0.8 : rand() < 0.2) {
      const cut = Math.round(w * (0.3 + rand() * 0.4));
      split(x, y, cut, h, depth + 1);
      split(x + cut, y, w - cut, h, depth + 1);
    } else {
      const cut = Math.round(h * (0.3 + rand() * 0.4));
      split(x, y, w, cut, depth + 1);
      split(x, y + cut, w, h - cut, depth + 1);
    }
  };
  for (let gy = 0; gy < 2; gy++) {
    for (let gx = 0; gx < 2; gx++) split(gx * 512, gy * 512, 512, 512, 0);
  }

  panels.forEach(([x, y, w, h]) => {
    // Slight tone shift per panel: replaced plates, sun-bleached ones
    const tone = 0.86 + rand() * 0.14;
    const v = Math.round(255 * tone);
    a.fillStyle = `rgb(${v},${v},${Math.round(v * (0.97 + rand() * 0.03))})`;
    a.fillRect(x, y, w, h);
    const rv = Math.round(120 + rand() * 60);
    r.fillStyle = `rgb(${rv},${rv},${rv})`;
    r.fillRect(x, y, w, h);
    b.fillStyle = `rgb(${128 + Math.round(rand() * 8)},0,0)`;
    // Seams: a dark groove in albedo, a dip in the bump map
    a.strokeStyle = 'rgba(20,18,15,0.75)';
    a.lineWidth = 3;
    a.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    b.strokeStyle = '#303030';
    b.lineWidth = 4;
    b.strokeRect(x + 2, y + 2, w - 4, h - 4);
    // Rivet rows along some seams
    if (rand() < 0.6) {
      const step = 22;
      for (let i = x + 12; i < x + w - 8; i += step) {
        for (const yy of [y + 9, y + h - 9]) {
          a.fillStyle = 'rgba(40,36,30,0.55)';
          a.beginPath(); a.arc(i, yy, 2.2, 0, Math.PI * 2); a.fill();
          b.fillStyle = '#c8c8c8';
          b.beginPath(); b.arc(i, yy, 2.2, 0, Math.PI * 2); b.fill();
        }
      }
    }
    // Access hatches and vents on a few panels
    if (w > 140 && h > 120 && rand() < 0.3) {
      const hw = w * 0.45, hh = h * 0.35;
      const hx = x + (w - hw) / 2, hy = y + (h - hh) / 2;
      a.strokeStyle = 'rgba(25,22,18,0.6)';
      a.lineWidth = 2;
      a.strokeRect(hx, hy, hw, hh);
      b.strokeStyle = '#4a4a4a';
      b.lineWidth = 3;
      b.strokeRect(hx, hy, hw, hh);
      if (rand() < 0.5) {
        for (let i = hy + 8; i < hy + hh - 6; i += 9) {
          a.fillStyle = 'rgba(20,18,15,0.7)';
          a.fillRect(hx + 8, i, hw - 16, 3);
          b.fillStyle = '#3a3a3a';
          b.fillRect(hx + 8, i, hw - 16, 3);
        }
      }
    }
  });

  // Weathering: soot streaks running aft, scuffs, chipped paint
  for (let i = 0; i < 160; i++) {
    const x = rand() * size, y = rand() * size;
    const len = 30 + rand() * 160;
    const grad = a.createLinearGradient(x, y, x + len, y);
    const alpha = 0.04 + rand() * 0.1;
    grad.addColorStop(0, `rgba(30,25,20,${alpha})`);
    grad.addColorStop(1, 'rgba(30,25,20,0)');
    a.fillStyle = grad;
    a.fillRect(x, y, len, 2 + rand() * 6);
  }
  for (let i = 0; i < 900; i++) {
    const x = rand() * size, y = rand() * size, s = 0.6 + rand() * 2.2;
    a.fillStyle = rand() < 0.5 ? 'rgba(25,22,18,0.35)' : 'rgba(255,250,235,0.18)';
    a.fillRect(x, y, s, s);
    r.fillStyle = 'rgba(230,230,230,0.5)';
    r.fillRect(x, y, s, s);
  }

  const toTex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: toTex(albedo, true), bumpMap: toTex(bump, false), roughnessMap: toTex(rough, false) };
}

// Registration and warning markings, painted on the hull sides
function makeDecalTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  // Ochre warning band with black chevrons
  g.fillStyle = 'rgba(184,116,31,0.95)';
  g.fillRect(0, 8, 112, 112);
  g.fillStyle = 'rgba(20,18,14,0.9)';
  for (let i = -2; i < 6; i++) {
    g.beginPath();
    g.moveTo(i * 30, 120); g.lineTo(i * 30 + 14, 120); g.lineTo(i * 30 + 14 + 70, 8); g.lineTo(i * 30 + 70, 8);
    g.closePath(); g.fill();
  }
  g.clearRect(112, 0, 400, 128);
  g.fillStyle = 'rgba(26,24,20,0.88)';
  g.font = 'bold 78px "Saira Stencil One", "Arial Black", sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text, 132, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Dim studio-like surroundings for reflections, so the shadowed side of the hull still reads as metal
function makeEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 top = vec3(0.10, 0.11, 0.13);
          vec3 horizon = vec3(0.16, 0.15, 0.14);
          vec3 bottom = vec3(0.02, 0.025, 0.035);
          vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.6)) : mix(horizon, bottom, pow(-y, 0.4));
          // a few soft light panels so curved metal shows highlights from every side
          c += vec3(0.9, 0.85, 0.75) * smoothstep(0.93, 0.99, dot(vDir, normalize(vec3(0.4, 0.8, 0.3))));
          c += vec3(0.35, 0.45, 0.6) * smoothstep(0.9, 0.99, dot(vDir, normalize(vec3(-0.7, 0.2, -0.6))));
          c += vec3(0.3, 0.28, 0.25) * smoothstep(0.85, 0.99, dot(vDir, normalize(vec3(0.2, -0.3, 0.9))));
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  envScene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
  return env;
}

// --------------------------------------------------------------------------------------------
// Geometry helpers
// --------------------------------------------------------------------------------------------

// Chamfered section outline at depth z: half width w, top t, bottom b, chamfers ct (top) and cb (bottom)
function section(z, w, t, b, ct = 0.35, cb = 0.3, y0 = 0) {
  const ht = (t - b);
  const cT = Math.min(w, ht) * ct;
  const cB = Math.min(w, ht) * cb;
  return [
    [w - cT, t], [-(w - cT), t], [-w, t - cT], [-w, b + cB], [-(w - cB), b], [w - cB, b], [w, b + cB], [w, t - cT],
  ].map(([x, y]) => new THREE.Vector3(x, y + y0, z));
}

// Skin a list of equal-length rings into a closed, flat-shaded hull with end caps
function loft(rings, { capStart = true, capEnd = true } = {}) {
  const pos = [];
  const tri = (p, q, r) => pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  const n = rings[0].length;
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      // Front-facing when seen from outside: rings run forward (-z) to aft (+z), outlines counter-clockwise seen from aft
      tri(A[j], A[k], B[k]);
      tri(A[j], B[k], B[j]);
    }
  }
  const cap = (ring, flip) => {
    const c = ring.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / ring.length);
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      if (flip) tri(c, ring[j], ring[k]);
      else tri(c, ring[k], ring[j]);
    }
  };
  if (capStart) cap(rings[0], false);
  if (capEnd) cap(rings[rings.length - 1], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// Flat normals, box-projected UVs (one texture tile per world unit) and livery colors per face
function finish(geometry, paint, uvScale = 0.75) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), center = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    center.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const color = paint(center, n);
    for (let v = 0; v < 3; v++) {
      const q = v === 0 ? a : v === 1 ? b : c;
      let u, w;
      if (ax >= ay && ax >= az) { u = q.z; w = q.y; } else if (ay >= az) { u = q.x; w = q.z; } else { u = q.x; w = q.y; }
      uv[(i + v) * 2] = u * uvScale;
      uv[(i + v) * 2 + 1] = w * uvScale;
      col[(i + v) * 3] = color.r; col[(i + v) * 3 + 1] = color.g; col[(i + v) * 3 + 2] = color.b;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Turn every triangle of a closed convex-ish part so it faces away from the part's centre
function orientOutward(points) {
  const center = points.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const out = [];
  for (let i = 0; i < points.length; i += 3) {
    const [a, b, c] = [points[i], points[i + 1], points[i + 2]];
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const mid = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(mid.sub(center)) < 0) out.push(a, c, b);
    else out.push(a, b, c);
  }
  return new THREE.BufferGeometry().setFromPoints(out);
}

// A square-section bar between two points
function strut(from, to, thick, height = thick) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const geo = new THREE.BoxGeometry(thick, height, dir.length());
  const m = new THREE.Matrix4().lookAt(from, to, Math.abs(dir.clone().normalize().y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  m.setPosition(from.clone().add(to).multiplyScalar(0.5));
  geo.applyMatrix4(m);
  return geo;
}

function merge(geometries) {
  const parts = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  parts.forEach((g) => { count += g.attributes.position.count; });
  const out = new Float32Array(count * 3);
  let o = 0;
  parts.forEach((g) => { out.set(g.attributes.position.array, o); o += g.attributes.position.array.length; });
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return m;
}

// Faceted body of revolution around the z axis: profile is [z, radius] pairs from front to back
function nacelle(profile, segments = 8) {
  const rings = profile.map(([z, r]) => {
    const ring = [];
    for (let i = 0; i < segments; i++) {
      const ang = (i / segments) * Math.PI * 2 + Math.PI / segments;
      ring.push(new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r, z));
    }
    return ring;
  });
  return loft(rings, { capStart: true, capEnd: false });
}

// --------------------------------------------------------------------------------------------
// Engine plume: additive cone, hot near the nozzle, fading along its length
// --------------------------------------------------------------------------------------------

const PLUME_VERTEX = `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const PLUME_FRAGMENT = `
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uPower;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    // vUv.y: 1 at the nozzle, 0 at the tip
    float along = vUv.y;
    float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
    float body = pow(facing, 1.6);
    float fade = pow(along, 1.8);
    // shock diamonds flicker faintly along the jet
    float diamonds = 0.85 + 0.15 * sin(along * 38.0 - uTime * 40.0);
    vec3 col = mix(uColor, uCore, pow(along, 4.0) * body);
    float a = body * fade * diamonds * uPower;
    gl_FragColor = vec4(col * a, a);
  }
`;

// Soft round glow sprite texture for lights and nozzle flares
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// --------------------------------------------------------------------------------------------
// The ship
// --------------------------------------------------------------------------------------------

export class ShipModel {
  constructor(renderer) {
    this.group = new THREE.Group();
    this.time = 0;
    const env = renderer ? makeEnvironment(renderer) : null;
    const tex = makeHullTextures();

    const hullMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: tex.map,
      bumpMap: tex.bumpMap,
      bumpScale: 1.2,
      roughnessMap: tex.roughnessMap,
      roughness: 0.75,
      metalness: 0.35,
      envMap: env,
      envMapIntensity: 0.9,
      flatShading: true,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x2a2b2d, map: tex.map, bumpMap: tex.bumpMap, bumpScale: 0.8, roughness: 0.55, metalness: 0.8,
      envMap: env, envMapIntensity: 1.0, flatShading: true,
    });
    const bellMat = darkMat.clone();
    bellMat.side = THREE.DoubleSide;
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0a1418, roughness: 0.06, metalness: 0.9, envMap: env, envMapIntensity: 1.6,
      emissive: 0x0d2a1a, emissiveIntensity: 0.6, flatShading: true,
    });

    // Livery: bone-white upper hull, gunmetal belly, ochre band on the nose cheeks
    const livery = (c, n) => {
      if (n.y < -0.45) return PAINT.gunmetal;
      if (c.y < -0.1 && Math.abs(n.x) > 0.5) return PAINT.gunmetal;
      if (c.z < -0.62 && c.z > -0.95 && Math.abs(n.x) > 0.35 && c.y < 0.1) return PAINT.ochre;
      if (n.z > 0.85) return PAINT.dark; // aft bulkhead
      return n.y > 0.3 ? PAINT.bone : PAINT.boneDark;
    };

    // ---- Main hull: wedge nose, broad cargo body, tapering stern
    const hullRings = [
      section(-1.28, 0.05, 0.02, -0.06, 0.3, 0.3),
      section(-1.12, 0.2, 0.09, -0.13),
      section(-0.92, 0.32, 0.15, -0.19),
      section(-0.62, 0.42, 0.21, -0.23),
      section(-0.3, 0.48, 0.26, -0.25),
      section(0.1, 0.5, 0.27, -0.27),
      section(0.55, 0.47, 0.25, -0.25),
      section(0.88, 0.38, 0.2, -0.2),
      section(1.02, 0.3, 0.16, -0.16),
    ];
    const hull = new THREE.Mesh(finish(loft(hullRings), livery), hullMat);
    this.group.add(hull);

    // Cargo spine on the back and a belly pod, so the silhouette reads as a hauler
    const spine = loft([
      section(-0.2, 0.2, 0.36, 0.2, 0.4, 0.1),
      section(-0.05, 0.24, 0.4, 0.2, 0.4, 0.1),
      section(0.62, 0.24, 0.38, 0.2, 0.4, 0.1),
      section(0.85, 0.17, 0.3, 0.16, 0.4, 0.1),
    ]);
    this.group.add(new THREE.Mesh(finish(spine, (c, n) => (n.z > 0.8 ? PAINT.dark : n.y > 0.3 ? PAINT.bone : PAINT.boneDark)), hullMat));
    const belly = loft([
      section(-0.45, 0.22, -0.2, -0.33, 0.2, 0.45),
      section(-0.25, 0.3, -0.2, -0.38, 0.2, 0.45),
      section(0.45, 0.3, -0.2, -0.38, 0.2, 0.45),
      section(0.65, 0.22, -0.2, -0.32, 0.2, 0.45),
    ]);
    this.group.add(new THREE.Mesh(finish(belly, () => PAINT.gunmetal), hullMat));

    // ---- Canopy: faceted glass bubble set into the nose, with a metal frame
    const canopyRings = [
      [[-0.14, 0.13], [0.14, 0.13], [0.1, 0.15], [0, 0.155], [-0.1, 0.15]],
      [[-0.24, 0.19], [0.24, 0.19], [0.19, 0.3], [0, 0.34], [-0.19, 0.3]],
      [[-0.28, 0.24], [0.28, 0.24], [0.22, 0.37], [0, 0.42], [-0.22, 0.37]],
      [[-0.24, 0.27], [0.24, 0.27], [0.2, 0.37], [0, 0.4], [-0.2, 0.37]],
    ];
    const canopyZ = [-0.98, -0.78, -0.5, -0.24];
    const cRings = canopyRings.map((ring, i) => ring.map(([x, y]) => new THREE.Vector3(x, y, canopyZ[i])));
    const canopyGeo = loft(cRings);
    canopyGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(canopyGeo, glassMat));
    const frameParts = [];
    // Bows across the glass at every section, sills and a spine running fore and aft
    cRings.forEach((ring) => {
      for (let j = 1; j < ring.length; j++) frameParts.push(strut(ring[j], ring[(j + 1) % ring.length], 0.024));
    });
    for (let j = 0; j < cRings[0].length; j++) {
      for (let i = 0; i < cRings.length - 1; i++) frameParts.push(strut(cRings[i][j], cRings[i + 1][j], j === 3 ? 0.03 : 0.022));
    }
    this.group.add(new THREE.Mesh(finish(merge(frameParts), () => PAINT.dark, 3), hullMat));

    // ---- Nacelles on stub pylons, ochre intake rings
    const nacelleProfile = [[-0.42, 0.06], [-0.36, 0.15], [-0.3, 0.18], [0.7, 0.19], [0.95, 0.17], [1.1, 0.16], [1.2, 0.18]];
    NOZZLES.forEach((nz) => {
      const geo = nacelle(nacelleProfile, 8);
      geo.translate(nz.x, nz.y, 0);
      const mesh = new THREE.Mesh(finish(geo, (c, n) => {
        if (c.z < -0.25) return PAINT.ochre;
        if (c.z > 0.9) return PAINT.dark;
        return n.y > 0.2 ? PAINT.bone : PAINT.gunmetal;
      }), hullMat);
      this.group.add(mesh);
      // Pylon from hull side to nacelle
      const side = Math.sign(nz.x);
      const pyl = strut(new THREE.Vector3(side * 0.55, -0.02, -0.05), new THREE.Vector3(side * 0.55, -0.02, 0.75), 0.36, 0.08);
      this.group.add(new THREE.Mesh(finish(pyl, () => PAINT.gunmetal), darkMat));
      // Nozzle bell: dark metal, hot rim inside
      const bell = nacelle([[1.12, 0.12], [1.2, 0.15], [1.26, 0.17]], 12);
      bell.translate(nz.x, nz.y, 0);
      this.group.add(new THREE.Mesh(finish(bell, () => PAINT.dark, 3), bellMat));
    });

    // ---- Wings: swept, thin, gun pods at the tips
    [-1, 1].forEach((side) => {
      const s = (x, y, z) => new THREE.Vector3(side * x, y, z);
      const wingTop = [s(0.45, -0.06, -0.25), s(1.12, -0.1, 0.12), s(1.12, -0.1, 0.45), s(0.45, -0.06, 0.62)];
      const wingBot = wingTop.map((v) => v.clone().add(new THREE.Vector3(0, -0.05, 0)));
      const positions = [];
      const quad = (a, b, c, d) => positions.push(a, b, c, a, c, d);
      const T = wingTop, B = wingBot;
      [[T[0], T[1], T[2], T[3]], [B[0], B[1], B[2], B[3]], [T[0], B[0], B[1], T[1]], [T[1], B[1], B[2], T[2]], [T[2], B[2], B[3], T[3]], [T[3], B[3], B[0], T[0]]]
        .forEach((f) => quad(...f));
      const geo = orientOutward(positions);
      this.group.add(new THREE.Mesh(finish(geo, (c, n) => (n.y > 0.3 ? (Math.abs(c.x) > 0.95 ? PAINT.ochre : PAINT.bone) : PAINT.gunmetal)), hullMat));

      // Gun pod and barrel
      const pod = nacelle([[-0.45, 0.03], [-0.38, 0.065], [0.3, 0.07], [0.42, 0.05]], 6);
      pod.translate(side * 1.2, -0.1, 0);
      this.group.add(new THREE.Mesh(finish(pod, () => PAINT.dark), darkMat));
      const barrel = strut(s(1.2, -0.1, -0.4), s(1.2, -0.1, -0.78), 0.028);
      this.group.add(new THREE.Mesh(finish(barrel, () => PAINT.dark, 3), darkMat));
    });

    // ---- Tail fin with a beacon, sensor mast, antenna and the RCS blocks
    const fin = orientOutward((() => {
      const a = new THREE.Vector3(0, 0.38, 0.3), b = new THREE.Vector3(0, 0.38, 0.85), c = new THREE.Vector3(0, 0.7, 0.95), d = new THREE.Vector3(0, 0.7, 0.75);
      const off = new THREE.Vector3(0.025, 0, 0);
      const L = [a, b, c, d].map((v) => v.clone().sub(off));
      const R = [a, b, c, d].map((v) => v.clone().add(off));
      return [R[0], R[1], R[2], R[0], R[2], R[3], L[0], L[2], L[1], L[0], L[3], L[2],
        L[3], R[3], R[2], L[3], R[2], L[2], L[0], R[0], R[3], L[0], R[3], L[3], L[1], L[2], R[2], L[1], R[2], R[1]];
    })());
    this.group.add(new THREE.Mesh(finish(fin, (c) => (c.y > 0.6 ? PAINT.ochre : PAINT.bone)), hullMat));
    const mast = merge([
      strut(new THREE.Vector3(0.12, 0.38, -0.05), new THREE.Vector3(0.12, 0.55, -0.02), 0.025),
      strut(new THREE.Vector3(0.12, 0.55, -0.02), new THREE.Vector3(0.12, 0.55, 0.14), 0.05, 0.02),
      strut(new THREE.Vector3(-0.15, 0.4, 0.2), new THREE.Vector3(-0.15, 0.62, 0.32), 0.012),
    ]);
    this.group.add(new THREE.Mesh(finish(mast, () => PAINT.dark, 3), darkMat));
    const rcs = [];
    [[-0.5, 0.05, -0.55], [0.5, 0.05, -0.55], [-0.47, 0.12, 0.7], [0.47, 0.12, 0.7]].forEach(([x, y, z]) => {
      rcs.push(strut(new THREE.Vector3(x, y, z - 0.06), new THREE.Vector3(x, y, z + 0.06), 0.07, 0.07));
    });
    this.group.add(new THREE.Mesh(finish(merge(rcs), () => PAINT.dark, 3), darkMat));

    // ---- Markings on both hull sides
    const decalMat = new THREE.MeshStandardMaterial({
      map: makeDecalTexture('SOL 4471'), transparent: true, roughness: 0.7, metalness: 0.2,
      polygonOffset: true, polygonOffsetFactor: -4, envMap: env, envMapIntensity: 0.5,
    });
    [-1, 1].forEach((side) => {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), decalMat);
      plane.rotation.y = side * Math.PI / 2;
      plane.position.set(side * 0.503, -0.01, 0.15);
      this.group.add(plane);
    });

    // ---- Lights: nozzle cores, plumes, nav lights
    const glow = glowTexture();
    this.plumes = [];
    this.nozzleFlares = [];
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1) });
    this.coreMat = coreMat;
    NOZZLES.forEach((nz) => {
      const core = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), coreMat);
      core.position.set(nz.x, nz.y, 1.14);
      this.group.add(core);

      const plumeGeo = new THREE.CylinderGeometry(0.15, 0.02, 1, 16, 1, true);
      plumeGeo.translate(0, -0.5, 0); // top at the nozzle, tip extending down the -y axis
      plumeGeo.rotateX(-Math.PI / 2); // -y -> +z (aft)
      const plumeMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() },
          uCore: { value: new THREE.Color() },
          uPower: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: PLUME_VERTEX,
        fragmentShader: PLUME_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const plume = new THREE.Mesh(plumeGeo, plumeMat);
      plume.position.set(nz.x, nz.y, 1.18);
      plume.renderOrder = 5;
      this.group.add(plume);
      this.plumes.push(plume);

      const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      flare.position.set(nz.x, nz.y, 1.2);
      this.group.add(flare);
      this.nozzleFlares.push(flare);
    });

    // Engine light washes the stern
    this.engineLight = new THREE.PointLight(0x66aaff, 0, 3.5, 2);
    this.engineLight.position.set(0, 0, 1.6);
    this.group.add(this.engineLight);

    const navLight = (pos, color, size) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sprite.position.copy(pos);
      sprite.scale.setScalar(size);
      this.group.add(sprite);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshBasicMaterial({ color }));
      bulb.position.copy(pos);
      this.group.add(bulb);
      return sprite;
    };
    navLight(new THREE.Vector3(-1.2, -0.1, 0.36), new THREE.Color(3, 0.15, 0.1), 0.14);
    navLight(new THREE.Vector3(1.2, -0.1, 0.36), new THREE.Color(0.15, 3, 0.4), 0.14);
    this.strobe = navLight(new THREE.Vector3(0, 0.72, 0.95), new THREE.Color(4, 4, 4), 0.3);
    this.beacon = navLight(new THREE.Vector3(0, -0.4, 0.1), new THREE.Color(4, 0.6, 0.1), 0.16);

    this.group.traverse((o) => {
      if (o.isMesh && !o.material.transparent) { o.castShadow = false; o.receiveShadow = false; }
    });
  }

  // Engine power 0..1, warp/autopilot cruise, and a slow blink for the nav lights
  update(delta, power, cruising) {
    this.time += delta;
    const p = THREE.MathUtils.clamp(power, 0, 1);
    // Ion blue idles dim and burns white-blue at full thrust; cruising under autopilot burns amber
    const hue = cruising ? new THREE.Color(1.0, 0.45, 0.12) : new THREE.Color(0.25, 0.55, 1.0);
    const core = cruising ? new THREE.Color(1.0, 0.85, 0.6) : new THREE.Color(0.8, 0.92, 1.0);
    const level = cruising ? 1.0 : 0.12 + p * 0.88;
    this.plumes.forEach((plume, i) => {
      const u = plume.material.uniforms;
      u.uColor.value.copy(hue).multiplyScalar(0.7 + level * 1.1);
      u.uCore.value.copy(core).multiplyScalar(1.4 + level * 1.6);
      u.uPower.value = 0.2 + level * 0.55;
      u.uTime.value = this.time + i * 0.37;
      const flicker = 1 + Math.sin(this.time * 47 + i * 2.1) * 0.04;
      plume.scale.set(0.8 + level * 0.35, 0.8 + level * 0.35, (0.3 + level * 1.5) * flicker);
    });
    this.coreMat.color.copy(hue).lerp(core, level).multiplyScalar(0.2 + level * 1.5);
    this.nozzleFlares.forEach((f) => {
      f.material.color.copy(hue).multiplyScalar(0.18 + level * 0.4);
      f.scale.setScalar(0.2 + level * 0.2);
    });
    this.engineLight.color.copy(hue);
    this.engineLight.intensity = 0.4 + level * 3;

    // Anti-collision strobe double-flashes every 1.6 s; the belly beacon pulses slowly
    const t = this.time % 1.6;
    const flash = (t < 0.06 || (t > 0.18 && t < 0.24)) ? 1 : 0;
    this.strobe.material.opacity = flash;
    this.strobe.scale.setScalar(flash ? 0.36 : 0.01);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3.2);
    this.beacon.material.opacity = Math.pow(pulse, 3);
  }
}
