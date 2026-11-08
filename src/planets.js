import * as THREE from 'three';
import {
  BAKE_VERTEX, BAKE_FRAGMENT, BODY_VERTEX, SURFACE_FRAGMENT, CLOUD_FRAGMENT,
  ATMOSPHERE_FRAGMENT, RING_FRAGMENT, SUN_FRAGMENT
} from './planetShaders';

// Testing aid: ?bake=0.25 bakes the surface maps at a quarter of the resolution (software renderers)
const BAKE_SCALE = THREE.MathUtils.clamp(Number(new URLSearchParams(window.location.search).get('bake')) || 1, 0.03125, 1);
const BAKE_STRIPS = 8; // maps are baked strip by strip, so a slow GPU never stalls on one huge draw
const SUN_RADIUS = 180; // drawn radius of the Sun, for the size of its disc in eclipses

const SURFACE_DEFINES = {
  Mercury: { MERCURY: '', HEIGHT_IN_ALPHA: '' },
  Venus: { VENUS: '' },
  Earth: { EARTH: '' },
  Mars: { MARS: '', HEIGHT_IN_ALPHA: '' },
  Jupiter: { GAS: '', JUPITER: '' },
  Saturn: { GAS: '', SATURN: '' },
  Uranus: { GAS: '', URANUS: '' },
  Neptune: { GAS: '', NEPTUNE: '' },
  Moon: { LUNA: '', HEIGHT_IN_ALPHA: '' },
  Io: { IO: '', HEIGHT_IN_ALPHA: '' },
  Europa: { EUROPA: '', HEIGHT_IN_ALPHA: '' },
  Titan: { TITAN: '' }
};

// Height range packed into the ground data of the bodies one can fly over (bake pass 2)
const GROUND_RANGE = {
  Mercury: [-0.6, 0.6],
  Venus: [-0.4, 1.0],
  Earth: [0, 1.0],
  Mars: [-0.8, 1.8]
};

const _q = new THREE.Quaternion();

// Bake pass 2 and read it back: heights, open water and cloud cover for the CPU (terrain and collisions)
function bakeGroundData(renderer, defines, seed, width, range) {
  const height = width / 2;
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter
  });
  const material = new THREE.ShaderMaterial({
    defines,
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    uniforms: {
      uPass: { value: 2 },
      uSeed: { value: seed },
      uTile: { value: new THREE.Vector4() },
      uGroundRange: { value: new THREE.Vector2(range[0], range[1]) }
    },
    depthTest: false,
    depthWrite: false
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previousTarget = renderer.getRenderTarget();
  const previousAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(target);
  for (let i = 0; i < BAKE_STRIPS; i++) {
    material.uniforms.uTile.value.set(0, i / BAKE_STRIPS, 1, 1 / BAKE_STRIPS);
    renderer.render(scene, camera);
  }
  const raw = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, raw);
  renderer.setRenderTarget(previousTarget);
  renderer.autoClear = previousAutoClear;
  quad.geometry.dispose();
  material.dispose();
  target.dispose();

  // Rows run from the south pole (v = 0) to the north pole, as in the shaders' sphereUV
  const heights = new Float32Array(width * height);
  const water = new Uint8Array(width * height); // 0..255
  const cloud = new Uint8Array(width * height);
  const span = range[1] - range[0];
  for (let i = 0; i < width * height; i++) {
    heights[i] = range[0] + ((raw[i * 4] * 256 + raw[i * 4 + 1]) / 65535) * span;
    water[i] = raw[i * 4 + 2];
    cloud[i] = raw[i * 4 + 3];
  }
  return { width, height, heights, water, cloud };
}

function bakeMap(renderer, defines, pass, width, type, seed) {
  const height = width / 2;
  const target = new THREE.WebGLRenderTarget(width, height, {
    type,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    anisotropy: renderer.capabilities.getMaxAnisotropy()
  });
  const material = new THREE.ShaderMaterial({
    defines,
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    uniforms: {
      uPass: { value: pass },
      uSeed: { value: seed },
      uTile: { value: new THREE.Vector4() }
    },
    depthTest: false,
    depthWrite: false
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const previousTarget = renderer.getRenderTarget();
  const previousAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(target);
  for (let i = 0; i < BAKE_STRIPS; i++) {
    material.uniforms.uTile.value.set(0, i / BAKE_STRIPS, 1, 1 / BAKE_STRIPS);
    renderer.render(scene, camera);
  }
  renderer.setRenderTarget(previousTarget);
  renderer.autoClear = previousAutoClear;
  quad.geometry.dispose();
  material.dispose();
  return target.texture;
}

// Smooth 1D value noise for ringlets
function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f);
  return hash1(i) * (1 - t) + hash1(i + 1) * t;
}
function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function band(r, from, to, soft) {
  return smoothstep(from - soft, from + soft, r) * (1 - smoothstep(to - soft, to + soft, r));
}

// Ring structure by distance from the planet centre (in planet radii): sRGB colour and optical density
function saturnRing(r) {
  const grain = 0.62 + 0.22 * noise1(r * 90) + 0.12 * noise1(r * 420) + 0.06 * noise1(r * 1700);
  let dens = 0;
  dens += band(r, 1.11, 1.236, 0.01) * 0.05;
  dens += band(r, 1.239, 1.527, 0.004) * (0.12 + 0.18 * noise1(r * 55));
  dens += band(r, 1.527, 1.95, 0.003) * (0.8 + 0.2 * noise1(r * 30));
  dens += band(r, 1.95, 2.025, 0.003) * 0.05;
  dens += band(r, 2.025, 2.27, 0.003) * 0.62 * (1 - band(r, 2.211, 2.217, 0.0015));
  dens *= grain;
  dens += Math.exp(-(((r - 2.326) / 0.004) ** 2)) * 0.55;
  let col;
  if (r < 1.527) col = [0.56, 0.51, 0.46];
  else if (r < 1.95) col = [0.88, 0.80, 0.66];
  else col = [0.80, 0.74, 0.64];
  const tint = 0.9 + 0.2 * noise1(r * 40 + 7);
  return { col: col.map((c) => Math.min(1, c * tint)), dens: Math.min(1, dens) };
}

function uranusRing(r) {
  const rings = [1.637, 1.652, 1.666, 1.75, 1.786, 1.834, 1.863, 1.9];
  let dens = 0;
  rings.forEach((c) => { dens += Math.exp(-(((r - c) / 0.0018) ** 2)) * 0.4; });
  dens += Math.exp(-(((r - 1.96) / 0.006) ** 2)) * 0.7; // the broad outermost ring
  dens += band(r, 1.6, 2.0, 0.01) * 0.015;
  return { col: [0.36, 0.37, 0.39], dens: Math.min(1, dens) };
}

function createRingTexture(name, range) {
  const width = 2048;
  const data = new Uint8Array(width * 4);
  const profile = name === 'Saturn' ? saturnRing : uranusRing;
  for (let i = 0; i < width; i++) {
    const r = range[0] + ((i + 0.5) / width) * (range[1] - range[0]);
    const { col, dens } = profile(r);
    data[i * 4] = Math.round(col[0] * 255);
    data[i * 4 + 1] = Math.round(col[1] * 255);
    data[i * 4 + 2] = Math.round(col[2] * 255);
    data[i * 4 + 3] = Math.round(dens * 255);
  }
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// The Sun's corona: soft glow with faint streamers
function createCoronaTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  // The disc covers the inner 44 % of the sprite; the glow starts at its rim and falls off fast
  const disc = 0.44;
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,240,215,1)');
  glow.addColorStop(disc, 'rgba(255,225,180,0.9)');
  glow.addColorStop(disc + 0.04, 'rgba(255,190,120,0.35)');
  glow.addColorStop(0.62, 'rgba(255,150,70,0.09)');
  glow.addColorStop(0.82, 'rgba(255,120,50,0.02)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  // Faint streamers reaching out from the rim
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + hash1(i) * 0.25;
    const r0 = c * disc;
    const len = c * (0.15 + 0.4 * hash1(i + 50));
    const x0 = c + Math.cos(a) * r0;
    const y0 = c + Math.sin(a) * r0;
    const x1 = c + Math.cos(a) * (r0 + len);
    const y1 = c + Math.sin(a) * (r0 + len);
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, 'rgba(255,200,150,0.12)');
    grad.addColorStop(1, 'rgba(255,160,90,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3 + hash1(i + 9) * 8;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

// One body of the solar system: surface, and where it has them clouds, atmosphere and rings.
// group sits on the orbit; tilt carries the axial tilt; mesh spins and its scale is the radius.
export class PlanetBody {
  constructor(renderer, data, seed) {
    this.data = data;
    this.renderer = renderer;
    this.seed = seed;
    this.ground = undefined; // baked on the first flight over this body (see groundData)
    this.radius = data.radius;
    this.isSun = data.name === 'Sun';
    this.group = new THREE.Group();
    this.tilt = new THREE.Group();
    this.tilt.rotation.z = THREE.MathUtils.degToRad(data.tilt || 0);
    this.group.add(this.tilt);

    const R = this.radius;
    const atmo = data.atmosphere;
    this.atmosphereTop = atmo ? R * (1 + atmo.thickness) : R;

    const texWidth = Math.max(256, Math.round((data.texWidth || 2048) * BAKE_SCALE));
    const texel = (2 * Math.PI * R) / texWidth;

    const u = (this.uniforms = {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunDirObj: { value: new THREE.Vector3(1, 0, 0) },
      uCamLocal: { value: new THREE.Vector3(0, 0, R * 4) },
      uRadius: { value: R },
      uLight: { value: data.light || 1.0 },
      uTime: { value: 0 },
      uDetailFreq: { value: 1 / (texel * 1.5) },
      uColorMap: { value: null },
      uAuxMap: { value: null },
      uRingMap: { value: null },
      uBump: { value: data.bump || 0 },
      uCloudShift: { value: 0 },
      uCloudAlt: { value: data.clouds ? R * data.clouds.altitude : 0 },
      uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
      uRingRange: { value: new THREE.Vector2(1, 2) },
      uAtmoTop: { value: this.atmosphereTop },
      uHR: { value: 1 },
      uHM: { value: 1 },
      uBetaR: { value: new THREE.Vector3() },
      uBetaM: { value: 0 },
      uMieG: { value: 0.76 },
      uSunE: { value: 8 },
      uMieCol: { value: new THREE.Vector3(1, 1, 1) },
      uMieExt: { value: new THREE.Vector3(1.1, 1.1, 1.1) },
      // Eclipses: bodies that can stand between this one and the Sun (set each frame by the solar system)
      uCasters: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uSunAng: { value: 0.05 },
      uUmbraTint: { value: new THREE.Vector3().fromArray(data.umbraTint || [0, 0, 0]) },
      // Planetshine: light the parent planet's day side throws onto a moon's night side
      uShineDir: { value: new THREE.Vector3(0, 1, 0) },
      uShineCol: { value: new THREE.Vector3() }
    });

    if (atmo) {
      // Scale heights as fractions of the shell, scattering from the vertical optical depth
      const thickness = R * atmo.thickness;
      u.uHR.value = thickness * atmo.hR;
      u.uHM.value = thickness * atmo.hM;
      u.uBetaR.value.fromArray(atmo.tauR).divideScalar(u.uHR.value);
      u.uBetaM.value = atmo.tauM / u.uHM.value;
      u.uMieG.value = atmo.g;
      u.uSunE.value = atmo.sunE;
      if (atmo.mieCol) u.uMieCol.value.fromArray(atmo.mieCol);
      if (atmo.mieExt) u.uMieExt.value.fromArray(atmo.mieExt);
    }

    if (this.isSun) {
      this.mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 128, 64),
        new THREE.ShaderMaterial({ uniforms: u, vertexShader: BODY_VERTEX, fragmentShader: SUN_FRAGMENT })
      );
      this.mesh.scale.setScalar(R);
      this.tilt.add(this.mesh);
      const corona = new THREE.Sprite(new THREE.SpriteMaterial({
        map: createCoronaTexture(),
        color: new THREE.Color(0.7, 0.5, 0.3),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
      }));
      corona.scale.setScalar(R * 4.5);
      corona.renderOrder = 2;
      this.corona = corona;
      this.group.add(corona);
      return;
    }

    const defines = { ...SURFACE_DEFINES[data.name] };
    const heightMap = 'HEIGHT_IN_ALPHA' in defines;
    u.uColorMap.value = bakeMap(renderer, defines, 0, texWidth, heightMap ? THREE.HalfFloatType : THREE.UnsignedByteType, seed);
    if (data.name === 'Earth' || data.auxMap) {
      u.uAuxMap.value = bakeMap(renderer, defines, 1, Math.max(256, Math.round((data.auxMap || 2048) * BAKE_SCALE)), THREE.HalfFloatType, seed);
    }

    if (atmo) defines.HAS_ATMO = '';
    // Coloured haze, and more steps through a deep one
    const atmoDefines = {};
    if (atmo && atmo.mieCol) atmoDefines.MIE_TINT = '';
    if (atmo && atmo.steps) {
      atmoDefines.ATMO_STEPS = String(atmo.steps);
      atmoDefines.ATMO_FIXED_STEP = '';
    }
    Object.assign(defines, atmoDefines);
    if (data.rings && data.name === 'Saturn') defines.RING_SHADOW = '';

    if (data.rings) {
      const range = [data.rings.inner, data.rings.outer];
      u.uRingMap.value = createRingTexture(data.name, range);
      u.uRingRange.value.set(range[0], range[1]);
    }

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 256, 128),
      new THREE.ShaderMaterial({ defines, uniforms: u, vertexShader: BODY_VERTEX, fragmentShader: SURFACE_FRAGMENT })
    );
    this.mesh.scale.setScalar(R);
    this.tilt.add(this.mesh);

    if (data.clouds) {
      this.clouds = new THREE.Mesh(
        new THREE.SphereGeometry(1, 256, 128),
        new THREE.ShaderMaterial({
          uniforms: u,
          vertexShader: BODY_VERTEX,
          fragmentShader: CLOUD_FRAGMENT,
          transparent: true,
          depthWrite: false
        })
      );
      this.clouds.scale.setScalar(R * (1 + data.clouds.altitude));
      this.clouds.renderOrder = 1;
      this.tilt.add(this.clouds);
    }

    if (atmo) {
      this.atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(1, 160, 80),
        new THREE.ShaderMaterial({
          defines: atmoDefines,
          uniforms: u,
          vertexShader: BODY_VERTEX,
          fragmentShader: ATMOSPHERE_FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneMinusSrcAlphaFactor,
          blendSrcAlpha: THREE.ZeroFactor,
          blendDstAlpha: THREE.OneFactor
        })
      );
      // A little larger than the analytic shell, so the polygon silhouette never clips the glow
      this.atmosphere.scale.setScalar(this.atmosphereTop * 1.01);
      this.atmosphere.renderOrder = 2;
      this.group.add(this.atmosphere);
    }

    if (data.rings) {
      const geom = new THREE.RingGeometry(data.rings.inner, data.rings.outer, 512, 1);
      geom.rotateX(-Math.PI / 2);
      this.rings = new THREE.Mesh(geom, new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: BODY_VERTEX,
        fragmentShader: RING_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      this.rings.scale.setScalar(R);
      this.rings.renderOrder = 3;
      this.tilt.add(this.rings);
    }
  }

  // Heights, water and clouds on the CPU, for flying low over the body; null for bodies without a ground
  groundData() {
    if (this.ground !== undefined) return this.ground;
    const range = GROUND_RANGE[this.data.name];
    if (!range || !this.renderer) {
      this.ground = null;
      return null;
    }
    const width = Math.max(256, Math.round(2048 * BAKE_SCALE));
    this.ground = bakeGroundData(this.renderer, { ...SURFACE_DEFINES[this.data.name] }, this.seed, width, range);
    return this.ground;
  }

  // Spin and animation, frame-rate independent
  update(delta, time) {
    this.uniforms.uTime.value = time;
    if (delta <= 0) return;
    this.mesh.rotation.y += (this.data.spin || 0) * delta;
    if (this.clouds) {
      this.clouds.rotation.y += (this.data.spin || 0) * 1.12 * delta;
      this.uniforms.uCloudShift.value = this.mesh.rotation.y - this.clouds.rotation.y;
    }
  }

  // Right before rendering: everything the shaders need from the camera and the Sun, in planet-local terms
  updateView(camera) {
    const u = this.uniforms;
    const center = this.group.position;
    u.uCamLocal.value.copy(camera.position).sub(center);
    if (this.isSun) return;
    u.uSunDir.value.copy(center).negate().normalize();
    u.uSunAng.value = Math.asin(Math.min(1, SUN_RADIUS / Math.max(center.length(), SUN_RADIUS)));
    this.mesh.getWorldQuaternion(_q).invert();
    u.uSunDirObj.value.copy(u.uSunDir.value).applyQuaternion(_q);
    this.tilt.getWorldQuaternion(_q);
    u.uRingNormal.value.set(0, 1, 0).applyQuaternion(_q);
    if (this.atmosphere) {
      // From inside the shell only its far side is left to draw the sky on
      this.atmosphere.material.side = u.uCamLocal.value.length() < this.atmosphere.scale.x ? THREE.BackSide : THREE.FrontSide;
    }
  }
}
