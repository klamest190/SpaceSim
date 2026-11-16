import * as THREE from 'three';
import { controls } from './controls';
import { sfx } from './sfx';

// Photo mode (P): the world stops, the cockpit and every readout disappear, and the camera circles the ship freely.
// Mouse: orbit · wheel: distance · A / D: tilt the horizon · W / S: zoom lens · Q / E: slide sideways ·
// Enter or left click: save the picture as a PNG · P or Esc: back to the flight.

const _offset = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _look = new THREE.Vector3();

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.yaw = 0.6;
    this.pitch = 0.25;
    this.dist = 9;
    this.roll = 0;
    this.fov = 55;
    this.pan = 0;
    this.hint = document.getElementById('photo-hint');
    this.clickArmed = false;
  }

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  enter() {
    const g = this.game;
    if (this.active || !g.simRunning || g.paused || g.ship.isDocked || g.ui.navMap.isOpen || g.warpState) return;
    this.active = true;
    g.paused = true;
    this.savedFov = g.camera.fov;
    this.wasCockpit = g.ship.cameraMode === 'cockpit';
    // Start where the pilot was looking from: behind and a little above the ship
    this.yaw = Math.PI * 0.85;
    this.pitch = 0.2;
    this.dist = 9;
    this.roll = 0;
    this.pan = 0;
    this.fov = 55;
    document.body.classList.add('photo-mode');
    if (!g.ship.isDestroyed) g.ship.mesh.visible = true;
    controls.keys.shoot = false;
    this.clickArmed = false;
    sfx.lockOn();
  }

  exit() {
    if (!this.active) return;
    const g = this.game;
    this.active = false;
    g.paused = false;
    g.clock.getDelta();
    g.camera.fov = this.savedFov;
    g.camera.updateProjectionMatrix();
    document.body.classList.remove('photo-mode');
    if (this.wasCockpit) g.ship.mesh.visible = false;
    controls.keys.shoot = false;
  }

  // The ship as the camera's scene sees it (down in an atmosphere that is the local scene)
  subject() {
    const g = this.game;
    if (g.surface.active) return { pos: g.surface.local.pos, quat: g.surface.local.quat };
    return { pos: g.ship.position, quat: g.ship.quaternion };
  }

  // Each frame while active, in place of the flight camera
  update(dt) {
    const g = this.game;
    const cam = g.camera;
    const k = controls.keys;
    this.yaw -= controls.mouseDelta.x * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch + controls.mouseDelta.y * 0.004, -1.5, 1.5);
    this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(controls.zoomDelta * 0.0012), 2.6, 400);
    if (k.rollLeft) this.roll += dt * 0.8;
    if (k.rollRight) this.roll -= dt * 0.8;
    if (k.throttleUp) this.fov = Math.max(12, this.fov - dt * 30);
    if (k.throttleDown) this.fov = Math.min(100, this.fov + dt * 30);
    if (k.strafeLeft) this.pan -= dt * this.dist * 0.5;
    if (k.strafeRight) this.pan += dt * this.dist * 0.5;
    this.pan = THREE.MathUtils.clamp(this.pan, -this.dist, this.dist);

    const { pos, quat } = this.subject();
    _offset.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).applyQuaternion(quat);
    _up.set(0, 1, 0).applyQuaternion(quat);
    _right.crossVectors(_up, _offset).normalize();
    _look.copy(pos).addScaledVector(_right, this.pan);
    cam.position.copy(_look).addScaledVector(_offset, this.dist);
    cam.up.copy(_up);
    cam.lookAt(_look);
    cam.rotateZ(this.roll);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    // Left click saves, but not the click that is still held from the flight
    if (!k.shoot) this.clickArmed = true;
    else if (this.clickArmed) {
      this.clickArmed = false;
      this.wantShot = true;
    }
    controls.clearDeltas();
  }

  // Right after the frame was rendered: the drawing buffer still holds it
  afterRender() {
    if (!this.wantShot) return;
    this.wantShot = false;
    const canvas = this.game.renderer.domElement;
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `solaris-${stamp}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
    sfx.pickup();
    if (this.hint) {
      this.hint.classList.add('saved');
      setTimeout(() => this.hint.classList.remove('saved'), 900);
    }
  }
}
