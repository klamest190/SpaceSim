import * as THREE from 'three';

// Missile camera: while your missile flies, the target VDU shows what its seeker sees, in green phosphor,
// with the countdown to impact, until the picture tears and the signal is lost.
// The view is rendered into the part of the main canvas that the VDU itself covers, then copied into the
// VDU's own canvas in the same frame and tinted there, so nothing extra is ever visible on screen.

const LOST_TIME = 0.9;

export class MissileCam {
  constructor(game) {
    this.game = game;
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 150000);
    this.missile = null;
    this.lost = 0;
    this.active = false;
    this.lastPos = new THREE.Vector3();
    this.lastQuat = new THREE.Quaternion();
    this.container = document.querySelector('.target-screen-container');
    this.canvas = document.getElementById('target-wireframe-canvas');
  }

  follow(missile) {
    this.missile = missile;
    this.lost = 0;
  }

  // Only in the cockpit, while the VDU is on screen
  visible() {
    const { ship, ui, paused } = this.game;
    return ship.cameraMode === 'cockpit' && !ship.isDocked && !ship.isDestroyed && !ui.navMap.isOpen && !paused;
  }

  render(dt) {
    const m = this.missile;
    if (!m) {
      this.active = false;
      return;
    }
    if (!m.alive) {
      this.lost += dt;
      if (this.lost > LOST_TIME) {
        this.missile = null;
        this.active = false;
        return;
      }
    }
    this.active = true;
    if (!this.visible()) return;

    const rect = this.container.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20 || rect.right < 0 || rect.left > window.innerWidth) return;

    // Just behind and above the warhead, looking down its flight path
    if (m.alive) {
      const fwd = m.heading;
      const up = Math.abs(fwd.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      this.camera.position.copy(m.pos).addScaledVector(fwd, -2.4).addScaledVector(up, 0.55);
      const look = m.target && m.target.pos && m.phase !== 'drop' ? m.target.pos : m.pos.clone().addScaledVector(fwd, 40);
      this.camera.up.copy(up);
      this.camera.lookAt(look);
      this.lastPos.copy(this.camera.position);
      this.lastQuat.copy(this.camera.quaternion);
    } else {
      this.camera.position.copy(this.lastPos);
      this.camera.quaternion.copy(this.lastQuat);
    }

    const { renderer, scene, solarSystem } = this.game;
    const w = rect.width, h = rect.height;
    const x = rect.left, y = window.innerHeight - rect.bottom;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    solarSystem.updateView(this.camera);
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.render(scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);

    this.copyToVdu(rect, m);
  }

  copyToVdu(rect, m) {
    const pr = this.game.renderer.getPixelRatio();
    const cw = Math.round(rect.width * pr), ch = Math.round(rect.height * pr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const ctx = this.canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.game.renderer.domElement, rect.left * pr, rect.top * pr, rect.width * pr, rect.height * pr, 0, 0, cw, ch);
    // Phosphor: everything turns green, the darks stay deep
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = '#5cff7a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = 'source-over';

    const lost = !m.alive;
    if (lost) {
      // Torn signal, then snow
      const k = Math.min(1, this.lost / LOST_TIME);
      for (let i = 0; i < 40 + k * 400; i++) {
        ctx.fillStyle = `rgba(160, 255, 180, ${Math.random() * 0.8})`;
        ctx.fillRect(Math.random() * cw, Math.random() * ch, 2 * pr, 1.5 * pr);
      }
    }

    // Seeker reticle and readout
    ctx.strokeStyle = 'rgba(180, 255, 190, 0.85)';
    ctx.lineWidth = pr;
    const cx = cw / 2, cy = ch / 2, s = Math.min(cw, ch) * 0.12;
    ctx.beginPath();
    ctx.moveTo(cx - s * 2, cy); ctx.lineTo(cx - s, cy);
    ctx.moveTo(cx + s, cy); ctx.lineTo(cx + s * 2, cy);
    ctx.moveTo(cx, cy - s * 2); ctx.lineTo(cx, cy - s);
    ctx.moveTo(cx, cy + s); ctx.lineTo(cx, cy + s * 2);
    ctx.stroke();
    ctx.font = `${Math.round(13 * pr)}px VT323, monospace`;
    ctx.fillStyle = '#b9ffc6';
    ctx.textBaseline = 'top';
    ctx.fillText('RAKETENKAMERA', 6 * pr, 4 * pr);
    let status;
    if (lost) status = 'SIGNAL VERLOREN';
    else if (m.phase === 'drop') status = 'AUSWURF';
    else if (!m.target) status = 'SUCHKOPF SUCHT';
    else if (m.target.isFlare) status = 'TÄUSCHKÖRPER!';
    else {
      const tti = m.timeToImpact();
      status = tti !== null && tti < 30 ? `EINSCHLAG ${tti.toFixed(1).replace('.', ',')} s` : 'VERFOLGT';
    }
    ctx.textBaseline = 'bottom';
    ctx.fillText(status, 6 * pr, ch - 4 * pr);
    if (m.alive && m.phase === 'burn') ctx.fillText('MOTOR', cw - 44 * pr, ch - 4 * pr);
    ctx.restore();
  }
}
