import * as THREE from 'three';

// What the hulls mirror: the real surroundings seen from the ship, as scene.environment for every PBR material
// (the player's ship, NPCs, stations, rocks). A small scene of its own holds the Milky Way and the one or two
// bodies that fill most of the sky, each a sphere of its true apparent size, lit by the Sun from where it really
// is: day side bright in its own colours, night side black but for city lights. It is rendered into a cube and
// prefiltered (PMREM) a few times a second, so hulls and canopy reflect Earth below, and its day side lights the
// shadowed side of the ship (planetshine) from the whole lit disc rather than from one point.
// The Sun itself is left out: the sunlight's sharp highlight is the directional light's job.

const CUBE_SIZE = 128;
const SKY_GAIN = 0.4;                       // the Milky Way, dimmed to what it adds to a lit hull
const SKY_FLOOR = [0.0035, 0.004, 0.0055];  // starlight and zodiacal glow: shadows stay black, but not a hole
const PLACE_DIST = 100;                     // bodies are drawn this far from the probe at their apparent size
const MIN_ANGLE = THREE.MathUtils.degToRad(0.4);
const REFRESH = 0.2;                        // seconds between updates while nothing jumps

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform sampler2D uSky;
uniform float uGain;
uniform vec3 uFloor;
varying vec3 vDir;
const float PI = 3.141592653589793;
void main() {
  vec3 d = normalize(vDir);
  vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
  gl_FragColor = vec4(texture2D(uSky, uv).rgb * uGain + uFloor, 1.0);
}
`;

const BODY_VERTEX = /* glsl */ `
varying vec3 vN;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Lambert-lit day side: radiance = albedo * E / pi, E the sunlight's irradiance (the same as the ships get)
const BODY_FRAGMENT = /* glsl */ `
uniform sampler2D uColorMap;
uniform sampler2D uAuxMap;
uniform float uHasMap;
uniform float uIsEarth;
uniform vec3 uTint;
uniform vec3 uSunDir;
uniform float uSunE;
uniform mat3 uToObj;
varying vec3 vN;
const float PI = 3.141592653589793;
void main() {
  vec3 n = normalize(vN);
  vec3 o = normalize(uToObj * n);
  vec2 uv = vec2(atan(o.z, o.x) / (2.0 * PI) + 0.5, asin(clamp(o.y, -1.0, 1.0)) / PI + 0.5);
  vec3 albedo = uTint;
  float cities = 0.0;
  if (uHasMap > 0.5) {
    albedo = pow(max(texture2D(uColorMap, uv).rgb, 0.0), vec3(2.2));
    if (uIsEarth > 0.5) {
      vec4 aux = texture2D(uAuxMap, uv);
      albedo = mix(albedo, vec3(0.75), aux.g * 0.85);
      cities = aux.r * (1.0 - aux.g);
    }
  }
  float day = dot(n, uSunDir);
  // a thin twilight band instead of a razor edge
  float lit = max(day, 0.0) + 0.04 * smoothstep(-0.08, 0.0, day);
  vec3 col = albedo * uSunE / PI * lit;
  col += vec3(1.0, 0.72, 0.4) * cities * 0.03 * smoothstep(0.05, -0.1, day);
  gl_FragColor = vec4(col, 1.0);
}
`;

const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();

export class EnvProbe {
  constructor(renderer, solarSystem, sunIntensity) {
    this.renderer = renderer;
    this.solar = solarSystem;
    this.scene = new THREE.Scene();
    this.timer = 0;
    this.lastPos = new THREE.Vector3(Infinity, 0, 0);

    const skyTex = solarSystem.skyTexture || null;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: {
          uSky: { value: skyTex },
          uGain: { value: skyTex ? SKY_GAIN : 0 },
          uFloor: { value: new THREE.Vector3(...SKY_FLOOR) },
        },
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.bodies = [0, 1].map(() => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 64, 32),
        new THREE.ShaderMaterial({
          uniforms: {
            uColorMap: { value: null },
            uAuxMap: { value: null },
            uHasMap: { value: 0 },
            uIsEarth: { value: 0 },
            uTint: { value: new THREE.Color() },
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
            uSunE: { value: sunIntensity },
            uToObj: { value: new THREE.Matrix3() },
          },
          vertexShader: BODY_VERTEX,
          fragmentShader: BODY_FRAGMENT,
        }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      return mesh;
    });

    this.cubeTarget = new THREE.WebGLCubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCamera = new THREE.CubeCamera(0.5, 1000, this.cubeTarget);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.cubeCamera.update(renderer, this.scene);
    this.target = this.pmrem.fromCubemap(this.cubeTarget.texture);
    this.texture = this.target.texture;
  }

  // The bodies that cover the most sky from `pos`, nearest moon and planet alike
  pickBodies(pos) {
    const list = [];
    this.solar.planets.forEach((p, i) => {
      if (i === 0 || !p.radius) return;
      const d = p.group.position.distanceTo(pos);
      const ang = Math.asin(Math.min(0.999, p.radius / Math.max(d, p.radius * 1.0005)));
      if (ang > MIN_ANGLE) list.push({ p, d, ang });
    });
    list.sort((a, b) => b.ang - a.ang);
    return list.slice(0, this.bodies.length);
  }

  // Re-render now and then, and at once after a jump
  update(dt, pos) {
    this.timer -= dt;
    const jumped = this.lastPos.distanceToSquared(pos) > 400 * 400;
    if (this.timer > 0 && !jumped) return;
    this.timer = REFRESH;
    this.lastPos.copy(pos);
    this.refresh(pos);
  }

  refresh(pos) {
    const picks = this.pickBodies(pos);
    this.bodies.forEach((mesh, k) => {
      const pick = picks[k];
      mesh.visible = !!pick;
      if (!pick) return;
      const { p } = pick;
      const u = mesh.material.uniforms;
      _dir.copy(p.group.position).sub(pos).divideScalar(pick.d);
      mesh.position.copy(_dir).multiplyScalar(PLACE_DIST);
      mesh.scale.setScalar(PLACE_DIST * Math.sin(pick.ang));
      u.uSunDir.value.copy(p.group.position).negate().normalize();
      const bu = p.body.uniforms;
      u.uColorMap.value = bu.uColorMap.value;
      u.uHasMap.value = bu.uColorMap.value ? 1 : 0;
      u.uIsEarth.value = p.name === 'Earth' && bu.uAuxMap.value ? 1 : 0;
      u.uAuxMap.value = bu.uAuxMap.value || bu.uColorMap.value;
      u.uTint.value.set(0x808080);
      // World direction -> the spinning surface's own frame, where the maps are laid out
      p.body.mesh.getWorldQuaternion(_q).invert();
      u.uToObj.value.setFromMatrix4(_m4.makeRotationFromQuaternion(_q));
    });
    this.cubeCamera.update(this.renderer, this.scene);
    this.pmrem.fromCubemap(this.cubeTarget.texture, this.target);
  }
}
