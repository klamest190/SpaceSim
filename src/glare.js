import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SUN_HDR_FAR } from './planets';

// Glare from the Sun, as a pilot's eye sees it through a canopy: no lens flare (an eye has no lens barrel to
// bounce light around in), but light scattered in the eye itself, a bright veil that falls off roughly as
// 1 / angle² (Stiles-Holladay), a halo of fine radial streaks (the ciliary corona) and a faint loss of contrast
// over the whole view. And the canopy: dust specks and wiper scratches on the glass light up when the Sun is near
// them, the scratches as arcs around it, the way scratched glass always does.
//
// Whether the Sun is really in sight is read off the image itself: a few taps over its disc, which is far brighter
// than anything else, so a planet, a moon, a station or a cockpit strut in front of it put the glare out.

const GLARE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
    uSunRad: { value: 0.002 },     // disc radius, in screen heights
    uAspect: { value: 1 },
    uFront: { value: 0 },          // 1 with the Sun ahead of the camera, 0 behind
    uSunVis: { value: 1 },         // share of the disc not covered by a body, for a Sun just off screen
    uRef: { value: SUN_HDR_FAR },  // what the disc's brightness counts as "full Sun"
    uStrength: { value: 1 },
    uDirt: { value: 0 },           // 1 behind the canopy
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSunUv;
    uniform float uSunRad;
    uniform float uAspect;
    uniform float uFront;
    uniform float uSunVis;
    uniform float uRef;
    uniform float uStrength;
    uniform float uDirt;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    // Noise around a circle, seamless in the angle a (radians): n cells per turn
    float ringNoise(float a, float n, float seed) {
      float x = a / 6.2831853 * n;
      float i = floor(x);
      float f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(hash12(vec2(mod(i, n), seed)), hash12(vec2(mod(i + 1.0, n), seed)), f);
    }
    float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    // How much of the Sun shows: taps over the disc, each counting how bright it is against a full Sun
    float sunSeen() {
      float r = max(uSunRad * 0.7, 0.0015);
      float seen = 0.0;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 2.3999632; // golden angle: an even spread over the disc
        float k = sqrt((float(i) + 0.5) / 12.0);
        vec2 p = uSunUv + vec2(cos(a) / uAspect, sin(a)) * r * k;
        if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) seen += uSunVis;
        else seen += smoothstep(0.55, 0.85, lum(texture2D(tDiffuse, p).rgb) / uRef);
      }
      return seen / 12.0;
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uFront <= 0.0 || uStrength <= 0.0) { gl_FragColor = base; return; }
      float S = sunSeen() * uFront * uStrength;
      if (S <= 0.001) { gl_FragColor = base; return; }

      vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0);
      float r = length(d);
      float e = max(r - uSunRad, 0.0); // from the disc's edge: the Sun is large in this game's sky
      float a = atan(d.y, d.x);
      vec3 sunCol = vec3(1.0, 0.96, 0.9);

      // Veiling glare: a tight bright core round the disc, a wide faint skirt
      float core = 1.0 / (1.0 + pow(e / 0.012, 2.0));
      float skirt = 1.0 / (1.0 + pow(e / 0.16, 2.0));
      vec3 glare = sunCol * (core * 0.35 + skirt * 0.025);

      // Ciliary corona: many fine radial streaks of uneven length, fading out with distance
      float streaks = ringNoise(a, 360.0, 1.0) * 0.6 + ringNoise(a, 90.0, 2.0) * 0.4;
      streaks = pow(streaks, 3.0);
      float reach = 0.05 + 0.13 * ringNoise(a, 45.0, 3.0);
      glare += sunCol * streaks * exp(-e / reach) * smoothstep(0.0, 0.01, e) * 0.18;

      // A slight loss of contrast everywhere: blacks lift a little with the Sun in view
      glare += sunCol * 0.0015;

      vec3 col = base.rgb + glare * S;

      if (uDirt > 0.0) {
        vec2 q = vUv * vec2(uAspect, 1.0);
        // Dust specks and smears, fixed to the glass
        float specks = smoothstep(0.86, 0.97, vnoise(q * 90.0)) * (0.4 + 0.6 * vnoise(q * 7.0));
        float smear = smoothstep(0.55, 0.85, vnoise(q * 5.0 + 3.1) * 0.7 + vnoise(q * 17.0) * 0.3) * 0.35;
        // Scratches: a fixed set of fine lines on the glass that only catch the light where they run across the
        // line to the Sun, so they show as arcs around it
        vec2 around = vec2(cos(a), sin(a));
        float arcs = smoothstep(0.78, 0.97, vnoise(vec2(r * 650.0, 0.5)) * 0.7 + vnoise(vec2(r * 1700.0, 9.5)) * 0.3);
        arcs *= smoothstep(0.45, 0.8, vnoise(around * 3.5 + r * 6.0 + 2.0)) * smoothstep(0.35, 0.75, vnoise(q * 3.0 + 7.7));
        float light = exp(-e / 0.18) + 0.08 * exp(-e / 0.5);
        col += sunCol * (specks * 0.5 + smear + arcs * 0.8) * light * uDirt * S * 0.22;
      }
      gl_FragColor = vec4(col, base.a);
    }
  `,
};

const _sun = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();
const _cam = new THREE.Vector3();

export class SunGlare {
  constructor() {
    this.pass = new ShaderPass(GLARE_SHADER);
  }

  // Where the Sun is on screen and whether we look through the canopy; game: the main game object
  update(game) {
    const u = this.pass.uniforms;
    const camera = game.camera;
    const surface = game.surface;
    const sun = game.solarSystem.planets[0];
    let sunAng;
    let ref;
    if (surface && surface.active) {
      // Down in an atmosphere the sky draws its own Sun disc, as bright as it gets through the air
      _to.copy(surface.sunL);
      sunAng = THREE.MathUtils.degToRad(0.45);
      ref = 30;
      u.uSunVis.value = 1;
    } else {
      _to.copy(sun.group.position).sub(camera.getWorldPosition(_cam));
      const dist = _to.length();
      _to.divideScalar(dist);
      sunAng = Math.asin(Math.min(1, sun.radius / dist));
      ref = sun.body.uniforms.uSunHDR.value;
      u.uSunVis.value = game.solarSystem.sunVisibility;
    }
    camera.getWorldDirection(_fwd);
    const ahead = _fwd.dot(_to);
    u.uFront.value = THREE.MathUtils.smoothstep(ahead, 0.0, 0.2);
    if (ahead > 0) {
      _sun.copy(camera.getWorldPosition(_cam)).addScaledVector(_to, 100).project(camera);
      u.uSunUv.value.set(_sun.x * 0.5 + 0.5, _sun.y * 0.5 + 0.5);
    }
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    u.uSunRad.value = Math.tan(sunAng) / Math.tan(halfV) * 0.5;
    u.uAspect.value = camera.aspect;
    u.uRef.value = ref;
    // With the disc filling the view there is no point source left to glare
    u.uStrength.value = 1 - THREE.MathUtils.smoothstep(sunAng / halfV, 0.05, 0.4);
    const ship = game.ship;
    const seated = game.simRunning && ship.cameraMode === 'cockpit' && !game.onFoot.active && !(game.photo && game.photo.active);
    u.uDirt.value = seated ? 1 : 0;
  }
}
