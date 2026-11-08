import * as THREE from 'three';
import { displayName } from './names';

// The fighting half of the HUD, projected onto the canopy: brackets on every contact (red hostile, blue SOLPOL,
// amber civilian), the lead pip that shows where to shoot, the missile lock diamond, arrows to things off screen,
// where hits come from, hit confirmation, a crack in the glass when the hull suffers, kill and money notices.

const MAX_BRACKETS = 28;
const LABELS_NEAR = 5;
const v = new THREE.Vector3();
const camSpace = new THREE.Vector3();
const inv = new THREE.Matrix4();

const fmtDist = (d) => {
  const km = d * 100000;
  if (km >= 1e6) return `${(km / 1e6).toFixed(1).replace('.', ',')} Mio km`;
  return `${Math.round(km / 1000).toLocaleString('de-DE')}.000 km`;
};

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

export class CombatHUD {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud');
    const layer = el('div', 'combat-layer', this.root);
    this.layer = layer;

    this.brackets = [];
    for (let i = 0; i < MAX_BRACKETS; i++) {
      const b = el('div', 'contact hidden', layer);
      const label = el('div', 'contact-label', b);
      this.brackets.push({ el: b, label, shown: false, text: '' });
    }
    this.edgeArrows = [];
    for (let i = 0; i < 8; i++) this.edgeArrows.push({ el: el('div', 'edge-arrow hidden', layer), shown: false });

    this.pip = el('div', 'lead-pip hidden', layer);
    this.lock = el('div', 'lock-diamond hidden', layer);
    this.lockFill = el('div', 'lock-fill', this.lock);
    this.waypoint = el('div', 'waypoint-marker hidden', layer);
    this.waypointLabel = el('div', 'waypoint-label', this.waypoint);
    this.hitX = el('div', 'hit-marker', layer);
    this.damageRing = el('div', 'damage-ring', layer, `<svg viewBox="-50 -50 100 100">${['f', 'r', 'b', 'l'].map((s, i) => `<path data-side="${s}" d="M ${-28 * Math.sin(Math.PI / 5)} ${-28 * Math.cos(Math.PI / 5)} A 28 28 0 0 1 ${28 * Math.sin(Math.PI / 5)} ${-28 * Math.cos(Math.PI / 5)}" transform="rotate(${i * 90})"/>`).join('')}</svg>`);
    this.damageArcs = {};
    this.damageRing.querySelectorAll('path').forEach((p) => { this.damageArcs[p.dataset.side] = { el: p, level: 0 }; });
    this.missileWarn = el('div', 'missile-warning hidden', layer, 'RAKETE');
    this.hullFlash = el('div', 'hull-flash', this.root);
    this.crack = el('div', 'canopy-crack', document.getElementById('cockpit-layer'), `<svg viewBox="0 0 1000 600" preserveAspectRatio="none">
      <g class="crack c1"><path d="M 140 80 L 210 140 L 190 190 L 260 230 L 250 300 M 210 140 L 300 120 L 360 150 M 190 190 L 120 230 L 90 300 M 260 230 L 330 260"/></g>
      <g class="crack c2"><path d="M 860 110 L 800 170 L 820 230 L 760 280 M 800 170 L 720 160 L 680 120 M 820 230 L 900 270 L 930 340 M 760 280 L 700 330 L 690 400"/></g>
      <g class="crack c3"><path d="M 470 40 L 500 100 L 470 150 L 520 200 M 500 100 L 560 90 M 470 150 L 410 170"/></g></svg>`);
    this.toasts = el('div', 'toast-stack', this.root);
    this.tickerEl = el('div', 'news-ticker hidden', this.root);
    this.tracker = el('div', 'mission-tracker hidden', this.root);
    this.status = el('div', 'status-strip', this.root);

    this.hitTimer = 0;
    this.flash = 0;
    this.tickerTimer = 0;
    this.lastToast = '';
    this.lastToastTime = 0;
  }

  // ----- notices -----------------------------------------------------------------------------------

  toast(text, kind = 'info') {
    if (!text) return;
    const now = performance.now();
    if (text === this.lastToast && now - this.lastToastTime < 1500) return;
    this.lastToast = text;
    this.lastToastTime = now;
    const t = el('div', `toast ${kind}`, this.toasts);
    t.textContent = text;
    setTimeout(() => t.classList.add('fade'), 3800);
    setTimeout(() => t.remove(), 4600);
    while (this.toasts.children.length > 5) this.toasts.firstChild.remove();
  }

  ticker(text) {
    this.tickerEl.textContent = `NACHRICHTEN · ${text}`;
    this.tickerEl.classList.remove('hidden');
    this.tickerTimer = 14;
  }

  hitMarker(hull) {
    this.hitX.classList.toggle('hull', hull);
    this.hitX.classList.remove('show');
    void this.hitX.offsetWidth;
    this.hitX.classList.add('show');
  }

  // Where a hit came from, in ship space; red if it got through to the hull
  damageFrom(local, hull) {
    const side = Math.abs(local.z) >= Math.abs(local.x) ? (local.z < 0 ? 'f' : 'b') : (local.x < 0 ? 'l' : 'r');
    const arc = this.damageArcs[side];
    arc.level = 1;
    arc.el.classList.toggle('hull', hull);
    if (hull) this.flash = Math.min(1, this.flash + 0.45);
  }

  // ----- projection helpers -------------------------------------------------------------------------

  project(pos, camera) {
    v.copy(pos).project(camera);
    camSpace.copy(pos).applyMatrix4(inv);
    const behind = camSpace.z > 0;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, behind, cx: camSpace.x, cy: camSpace.y };
  }

  onScreen(p, margin = 0) {
    return !p.behind && p.x > -margin && p.y > -margin && p.x < window.innerWidth + margin && p.y < window.innerHeight + margin;
  }

  // An arrow on a ring around the centre, pointing the way to turn
  placeArrow(arrow, p, color) {
    const angle = Math.abs(p.cx) + Math.abs(p.cy) < 1e-3 ? Math.PI / 2 : Math.atan2(-p.cy, p.cx);
    const w = window.innerWidth, h = window.innerHeight;
    const r = Math.min(w, h) * 0.3;
    const x = w / 2 + Math.cos(angle) * r;
    const y = h / 2 + Math.sin(angle) * r;
    arrow.el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) rotate(${angle}rad)`;
    arrow.el.style.setProperty('--c', color);
    if (!arrow.shown) {
      arrow.el.classList.remove('hidden');
      arrow.shown = true;
    }
  }

  relationColor(npc) {
    const { npcs, ship } = this.game;
    if (npcs.isHostile(npc, ship)) return 'hostile';
    if (npc.faction === 'police') return 'police';
    if (npc.faction === 'pirate') return 'pirate';
    return 'civil';
  }

  // ----- every frame -------------------------------------------------------------------------------

  update(dt) {
    const { ship, camera, npcs, missions, ui } = this.game;
    camera.updateMatrixWorld();
    inv.copy(camera.matrixWorld).invert();
    // Down in an atmosphere the camera films a local scene: no brackets on things in space
    const flying = !ship.isDocked && !ship.isDestroyed && !ui.navMap.isOpen && !(this.game.surface && this.game.surface.active);
    this.layer.classList.toggle('hidden', !flying);

    if (flying) {
      this.updateContacts(ship, camera, npcs);
      this.updatePip(ship, camera);
      this.updateWaypoint(ship, camera, missions);
    }

    // Fading things
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    Object.values(this.damageArcs).forEach((a) => {
      if (a.level <= 0) return;
      a.level = Math.max(0, a.level - dt * 1.4);
      a.el.style.opacity = a.level.toFixed(2);
    });
    this.flash = Math.max(0, this.flash - dt * 2);
    this.hullFlash.style.opacity = (this.flash * 0.55).toFixed(2);
    const damage = 1 - ship.hull / ship.maxHull;
    this.crack.dataset.level = damage > 0.75 ? 3 : damage > 0.5 ? 2 : damage > 0.25 ? 1 : 0;
    this.missileWarn.classList.toggle('hidden', !(ship.incomingMissiles > 0 && flying));
    if (this.tickerTimer > 0) {
      this.tickerTimer -= dt;
      if (this.tickerTimer <= 0) this.tickerEl.classList.add('hidden');
    }
    this.updateTracker(missions, ship);
    this.updateStatus();
  }

  updateContacts(ship, camera, npcs) {
    const range = ship.sensorRange * (0.55 + 0.45 * ship.systems.sensors);
    const list = [];
    for (const n of npcs.ships) {
      const d = n.pos.distanceTo(ship.position);
      if (d < range) list.push({ n, d });
    }
    list.sort((a, b) => a.d - b.d);

    let bi = 0, ai = 0;
    const fovScale = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    for (let i = 0; i < list.length && bi < MAX_BRACKETS; i++) {
      const { n, d } = list[i];
      const p = this.project(n.pos, camera);
      const rel = this.relationColor(n);
      if (!this.onScreen(p, 20)) {
        if (rel === 'hostile' && ai < this.edgeArrows.length && n !== ship.targetObject) this.placeArrow(this.edgeArrows[ai++], p, '#ff3b2f');
        continue;
      }
      const b = this.brackets[bi++];
      const size = Math.max(16, Math.min(160, (n.radius * 2.2 * fovScale) / Math.max(d, 1)));
      const targeted = n === ship.targetObject;
      b.el.style.transform = `translate(${(p.x - size / 2).toFixed(0)}px, ${(p.y - size / 2).toFixed(0)}px)`;
      b.el.style.width = b.el.style.height = `${size.toFixed(0)}px`;
      const cls = `contact ${rel}${targeted ? ' targeted' : ''}`;
      if (b.el.className !== cls) b.el.className = cls;
      const showLabel = i < LABELS_NEAR || targeted;
      const text = showLabel ? `${n.name}<br><span>${fmtDist(d)}</span>` : '';
      if (text !== b.text) {
        b.label.innerHTML = text;
        b.text = text;
      }
      b.shown = true;
    }
    for (; bi < MAX_BRACKETS; bi++) {
      const b = this.brackets[bi];
      if (b.shown) {
        b.el.className = 'contact hidden';
        b.shown = false;
      }
    }

    // The locked target off screen: an arrow in its colour
    const t = ship.targetObject;
    if (t && ai < this.edgeArrows.length) {
      const pos = t.group ? t.group.position : t.mesh.position;
      const p = this.project(pos, camera);
      if (!this.onScreen(p, 0)) this.placeArrow(this.edgeArrows[ai++], p, '#ffb000');
    }
    for (; ai < this.edgeArrows.length; ai++) {
      const a = this.edgeArrows[ai];
      if (a.shown) {
        a.el.classList.add('hidden');
        a.shown = false;
      }
    }
  }

  updatePip(ship, camera) {
    const lead = ship.leadPoint();
    const t = ship.targetObject;
    if (lead && t.pos.distanceTo(ship.position) < 900) {
      const p = this.project(lead, camera);
      if (this.onScreen(p)) {
        this.pip.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
        this.pip.classList.remove('hidden');
      } else {
        this.pip.classList.add('hidden');
      }
    } else {
      this.pip.classList.add('hidden');
    }

    if (t && t.kind === 'npc' && ship.lockProgress > 0.02) {
      const p = this.project(t.pos, camera);
      if (this.onScreen(p)) {
        const s = 70 - ship.lockProgress * 34;
        this.lock.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) rotate(45deg)`;
        this.lock.style.width = this.lock.style.height = `${s.toFixed(0)}px`;
        this.lock.classList.toggle('locked', ship.locked);
        this.lock.classList.remove('hidden');
        return;
      }
    }
    this.lock.classList.add('hidden');
  }

  updateWaypoint(ship, camera, missions) {
    const dest = missions.destination();
    if (!dest || dest.kind !== 'waypoint') {
      this.waypoint.classList.add('hidden');
      return;
    }
    const pos = dest.mesh.position;
    const p = this.project(pos, camera);
    if (!this.onScreen(p)) {
      this.waypoint.classList.add('hidden');
      return;
    }
    this.waypoint.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
    this.waypointLabel.innerHTML = `${dest.name}<br><span>${fmtDist(pos.distanceTo(ship.position))}</span>`;
    this.waypoint.classList.remove('hidden');
  }

  updateTracker(missions, ship) {
    const m = missions.tracked;
    if (!m || ship.isDestroyed) {
      this.tracker.classList.add('hidden');
      return;
    }
    const obj = missions.current(m);
    const dest = missions.destination(m);
    let dist = '';
    if (dest) {
      const pos = dest.group ? dest.group.position : dest.mesh.position;
      dist = ` · ${fmtDist(pos.distanceTo(ship.position))}`;
    }
    const html = `<b>${m.title}</b><span>▸ ${obj ? obj.label : 'Abgeschlossen'}${dist}</span><i>[J] Ziel · [I] Logbuch</i>`;
    if (html !== this.trackerHtml) {
      this.tracker.innerHTML = html;
      this.trackerHtml = html;
    }
    this.tracker.classList.remove('hidden');
  }

  // Top-left: rank, standing and wanted level at a glance
  updateStatus() {
    const { law, ship } = this.game;
    const wanted = law.wanted > 0 ? `<b class="wanted w${Math.min(law.wanted, 3)}">${law.wantedLabel().toUpperCase()}${law.fines ? ` · ${law.fines.toLocaleString('de-DE')} Cr` : ''}</b>` : '';
    const html = `<span>${law.rank().name.toUpperCase()}</span><span>${ship.debt > 0 ? `SCHULD ${ship.debt.toLocaleString('de-DE')} Cr` : 'SCHULDENFREI'}</span>${wanted}`;
    if (html !== this.statusHtml) {
      this.status.innerHTML = html;
      this.statusHtml = html;
    }
  }
}

export { fmtDist, displayName };
