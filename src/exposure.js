import * as THREE from 'three';

// The pilot's eyes adapting to what is in view, as they (and every camera) really do out here: with the Sun or a
// sunlit planet in sight the faint stars drown and only the brightest few remain; in a planet's shadow, with
// nothing lit in view, the Milky Way and its nebulae come out. Dazzle is quick, dark adaptation slow.
// Drives the gain of the night sky (stars, Milky Way, galaxies) and nudges the overall exposure a little.

const BASE_EXPOSURE = 1.15;
const DARK_GAIN = 1.7;     // sky gain with nothing bright in view
const DAZZLED_GAIN = 0.16; // with the Sun or a big sunlit disc filling the view
const BRIGHTEN_RATE = 2.5; // per second, towards a smaller gain
const DARKEN_RATE = 0.45;  // per second, towards a larger gain

const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();
const _sun = new THREE.Vector3();

export class EyeAdaptation {
  constructor(game) {
    this.game = game;
    this.gain = 1;
    this.brightness = 0;
  }

  // Rough brightness of the view: the Sun's disc if it is in sight, plus every lit planet and moon by the share of
  // the view it covers and how much of its day side faces us
  sceneBrightness(camera, solarSystem) {
    camera.getWorldDirection(_fwd);
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    const edge = Math.hypot(halfV, halfH);
    const inView = (dir, radius) => {
      const off = Math.acos(THREE.MathUtils.clamp(_fwd.dot(dir), -1, 1));
      return 1 - THREE.MathUtils.smoothstep(off, edge * 0.7 + radius, edge + radius);
    };

    let light = 0;
    const sun = solarSystem.planets[0];
    _to.copy(sun.group.position).sub(camera.position);
    const sunDist = _to.length();
    _to.divideScalar(sunDist);
    light += 3 * inView(_to, Math.asin(Math.min(1, sun.radius / sunDist))) * solarSystem.sunVisibility;

    for (const p of solarSystem.planets) {
      if (p === sun) continue;
      _to.copy(p.group.position).sub(camera.position);
      const d = _to.length();
      if (d <= p.radius) continue;
      _to.divideScalar(d);
      const angle = Math.asin(Math.min(1, p.radius / d));
      if (angle < 0.004) continue;
      const share = Math.min(1, (angle / halfV) ** 2);
      _sun.copy(p.group.position).negate().normalize();
      const dayside = 0.5 * (1 - _to.dot(_sun));
      light += share * dayside * inView(_to, angle) * 1.3;
    }
    return light;
  }

  update(delta) {
    const game = this.game;
    const solarSystem = game.solarSystem;
    // Down in an atmosphere the planet's own sky decides what shows (surface.js): stay neutral there
    const low = game.surface && game.surface.active;
    const brightness = low ? 0 : this.sceneBrightness(game.camera, solarSystem);
    this.brightness = brightness;
    const dazzle = THREE.MathUtils.smoothstep(brightness, 0.03, 0.75);
    const target = low ? 1 : THREE.MathUtils.lerp(DARK_GAIN, DAZZLED_GAIN, dazzle);
    const rate = target < this.gain ? BRIGHTEN_RATE : DARKEN_RATE;
    this.gain += (target - this.gain) * (1 - Math.exp(-rate * Math.min(delta, 0.1)));
    solarSystem.setSkyGain(this.gain);
    // A touch more exposure with dark-adapted eyes, a touch less when dazzled
    const adapted = (this.gain - DAZZLED_GAIN) / (DARK_GAIN - DAZZLED_GAIN);
    game.renderer.toneMappingExposure = BASE_EXPOSURE * THREE.MathUtils.lerp(0.94, 1.1, adapted);
  }
}
