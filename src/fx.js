import * as THREE from 'three';

// Visual effects with pooled resources, so a big dogfight allocates nothing per shot:
// fireball sprites, debris chunks, sparks, wireframe shield flashes, engine trails and the dust that makes speed visible.

const SPRITES = 140;
const DEBRIS = 180;
const SPARKS = 900;
const FLASHES = 14;
const TRAIL_POINTS = 16;
const TRAILS = 48;
const DUST = 280;
const DUST_BOX = 90;
const SMOKE = 460;

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const dummy = new THREE.Object3D();

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return new THREE.CanvasTexture(c);
}

// Billowing fireball: many soft blobs, brighter in the middle
function fireballTexture(seed) {
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return canvasTexture(128, (g, n) => {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 46; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() ** 1.4 * n * 0.3;
      const r = n * (0.06 + rand() * 0.13) * (1 - (d / n) * 0.6);
      const x = n / 2 + Math.cos(a) * d, y = n / 2 + Math.sin(a) * d;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const v = 0.1 + rand() * 0.22;
      grad.addColorStop(0, `rgba(255,255,255,${v})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, n, n);
    }
  });
}

const softTexture = () => canvasTexture(64, (g, n) => {
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
});

const ringTexture = () => canvasTexture(128, (g, n) => {
  const grad = g.createRadialGradient(n / 2, n / 2, n * 0.3, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.72, 'rgba(255,255,255,0.12)');
  grad.addColorStop(0.9, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
});

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.fireTextures = [fireballTexture(11), fireballTexture(4242), fireballTexture(77777)];
    this.softTex = softTexture();
    this.ringTex = ringTexture();

    this.buildSprites();
    this.buildDebris();
    this.buildSparks();
    this.buildFlashes();
    this.buildTrails();
    this.buildDust();
    this.buildBeams();
    this.buildSmoke();

    this.lights = [0, 1].map(() => {
      const light = new THREE.PointLight(0xffa040, 0, 400, 1.4);
      this.root.add(light);
      return { light, life: 0, max: 1, peak: 0 };
    });
    this.nextLight = 0;
  }

  // --- fireball / glow / ring sprites ------------------------------------------------------

  buildSprites() {
    this.sprites = [];
    for (let i = 0; i < SPRITES; i++) {
      const material = new THREE.SpriteMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, map: this.softTex });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.root.add(sprite);
      this.sprites.push({ sprite, life: 0, max: 1, vel: new THREE.Vector3(), from: 1, to: 1, color: new THREE.Color(), spin: 0, fadeIn: 0 });
    }
    this.spriteCursor = 0;
  }

  puff(pos, { tex = this.softTex, color = 0xffffff, hdr = 1, from = 1, to = 2, life = 0.5, vel = null, spin = 0, fadeIn = 0 } = {}) {
    const p = this.sprites[this.spriteCursor];
    this.spriteCursor = (this.spriteCursor + 1) % SPRITES;
    p.sprite.material.map = tex;
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.sprite.position.copy(pos);
    p.sprite.visible = true;
    p.life = p.max = life;
    p.from = from;
    p.to = to;
    p.spin = spin;
    p.fadeIn = fadeIn;
    p.color.set(color).multiplyScalar(hdr);
    if (vel) p.vel.copy(vel);
    else p.vel.set(0, 0, 0);
    return p;
  }

  updateSprites(dt) {
    for (const p of this.sprites) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      const t = 1 - p.life / p.max;
      const eased = 1 - (1 - t) ** 3;
      p.sprite.scale.setScalar(p.from + (p.to - p.from) * eased);
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.material.rotation += p.spin * dt;
      const fade = (1 - t) ** 1.6 * (p.fadeIn > 0 ? Math.min(1, t / p.fadeIn) : 1);
      p.sprite.material.color.copy(p.color).multiplyScalar(fade);
    }
  }

  // --- debris ------------------------------------------------------------------------------

  buildDebris() {
    const geo = new THREE.TetrahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.8, metalness: 0.5, flatShading: true });
    this.debrisMesh = new THREE.InstancedMesh(geo, mat, DEBRIS);
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = DEBRIS;
    this.debris = [];
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < DEBRIS; i++) {
      this.debrisMesh.setMatrixAt(i, dummy.matrix);
      this.debris.push({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), size: 1, max: 1 });
    }
    this.root.add(this.debrisMesh);
    this.debrisCursor = 0;
  }

  chunk(pos, vel, size, life) {
    const d = this.debris[this.debrisCursor];
    this.debrisCursor = (this.debrisCursor + 1) % DEBRIS;
    d.pos.copy(pos);
    d.vel.copy(vel);
    d.size = size;
    d.life = d.max = life;
    d.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    d.spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
  }

  updateDebris(dt) {
    let dirty = false;
    this.debris.forEach((d, i) => {
      if (d.life <= 0) return;
      dirty = true;
      d.life -= dt;
      d.pos.addScaledVector(d.vel, dt);
      d.rot.x += d.spin.x * dt;
      d.rot.y += d.spin.y * dt;
      d.rot.z += d.spin.z * dt;
      dummy.position.copy(d.pos);
      dummy.rotation.copy(d.rot);
      dummy.scale.setScalar(d.life > 0 ? d.size * Math.min(1, (d.life / d.max) * 3) : 0);
      dummy.updateMatrix();
      this.debrisMesh.setMatrixAt(i, dummy.matrix);
    });
    if (dirty) this.debrisMesh.instanceMatrix.needsUpdate = true;
  }

  // --- sparks ------------------------------------------------------------------------------

  buildSparks() {
    this.sparkPos = new Float32Array(SPARKS * 3);
    this.sparkCol = new Float32Array(SPARKS * 3);
    this.sparkVel = new Float32Array(SPARKS * 3);
    this.sparkLife = new Float32Array(SPARKS);
    this.sparkMax = new Float32Array(SPARKS);
    this.sparkTint = new Float32Array(SPARKS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size: 0.5, map: this.softTex, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: true,
    });
    this.sparkPoints = new THREE.Points(geo, mat);
    this.sparkPoints.frustumCulled = false;
    this.root.add(this.sparkPoints);
    this.sparkCursor = 0;
  }

  sparks(pos, count, speed, { color = 0xffb060, hdr = 3, life = 0.6, vel = null, dir = null, spread = 1 } = {}) {
    const c = tmp2.set(0, 0, 0);
    const col = new THREE.Color(color).multiplyScalar(hdr);
    for (let n = 0; n < count; n++) {
      const i = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % SPARKS;
      c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      if (dir) c.multiplyScalar(spread).add(dir).normalize();
      const s = speed * (0.3 + Math.random() * 0.7);
      this.sparkPos[i * 3] = pos.x; this.sparkPos[i * 3 + 1] = pos.y; this.sparkPos[i * 3 + 2] = pos.z;
      this.sparkVel[i * 3] = c.x * s + (vel ? vel.x : 0);
      this.sparkVel[i * 3 + 1] = c.y * s + (vel ? vel.y : 0);
      this.sparkVel[i * 3 + 2] = c.z * s + (vel ? vel.z : 0);
      this.sparkLife[i] = this.sparkMax[i] = life * (0.4 + Math.random() * 0.6);
      this.sparkTint[i * 3] = col.r; this.sparkTint[i * 3 + 1] = col.g; this.sparkTint[i * 3 + 2] = col.b;
    }
  }

  updateSparks(dt) {
    for (let i = 0; i < SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      this.sparkLife[i] -= dt;
      const k = Math.max(0, this.sparkLife[i] / this.sparkMax[i]);
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      this.sparkCol[i * 3] = this.sparkTint[i * 3] * k;
      this.sparkCol[i * 3 + 1] = this.sparkTint[i * 3 + 1] * k;
      this.sparkCol[i * 3 + 2] = this.sparkTint[i * 3 + 2] * k;
    }
    this.sparkPoints.geometry.attributes.position.needsUpdate = true;
    this.sparkPoints.geometry.attributes.color.needsUpdate = true;
  }

  // --- shield flash: a wireframe bubble around the ship, in keeping with the cockpit's vector look -------

  buildFlashes() {
    const geo = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1, 2));
    this.flashes = [];
    for (let i = 0; i < FLASHES; i++) {
      const mat = new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.LineSegments(geo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.flashes.push({ mesh, life: 0, max: 0.3, follow: null, color: new THREE.Color() });
    }
    this.flashCursor = 0;
  }

  shieldFlash(entity, radius, hitPoint, color = 0x60b0ff) {
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % FLASHES;
    f.mesh.visible = true;
    f.mesh.scale.setScalar(radius * 1.15);
    f.mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    f.follow = entity;
    f.life = f.max = 0.32;
    f.color.set(color).multiplyScalar(2.2);
    this.puff(hitPoint, { color, hdr: 2.5, from: radius * 0.5, to: radius * 1.2, life: 0.22 });
  }

  updateFlashes(dt) {
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.mesh.visible = false;
        f.follow = null;
        continue;
      }
      if (f.follow) f.mesh.position.copy(f.follow.pos);
      f.mesh.material.color.copy(f.color).multiplyScalar((f.life / f.max) ** 2);
    }
  }

  // --- trails ------------------------------------------------------------------------------

  buildTrails() {
    const verts = TRAILS * (TRAIL_POINTS - 1) * 2;
    this.trailPos = new Float32Array(verts * 3);
    this.trailCol = new Float32Array(verts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.trailLines.frustumCulled = false;
    this.root.add(this.trailLines);
    this.trails = Array.from({ length: TRAILS }, () => ({
      used: false, points: Array.from({ length: TRAIL_POINTS }, () => new THREE.Vector3()), count: 0, head: 0, timer: 0, color: new THREE.Color(), fading: 0, strength: 1,
    }));
  }

  // Sample rate is fixed, so a trail's length shows speed
  addTrail(color, strength = 1) {
    const t = this.trails.find((x) => !x.used);
    if (!t) return null;
    t.used = true;
    t.count = 0;
    t.head = 0;
    t.timer = 0;
    t.fading = 0;
    t.strength = strength;
    t.color.set(color);
    return t;
  }

  // Keep it there until the last sample dies away
  endTrail(t) {
    if (t) t.fading = 1;
  }

  feedTrail(t, pos, dt) {
    if (!t) return;
    t.timer -= dt;
    if (t.timer <= 0) {
      t.timer = 0.05;
      t.head = (t.head + 1) % TRAIL_POINTS;
      t.points[t.head].copy(pos);
      t.count = Math.min(TRAIL_POINTS, t.count + 1);
    } else if (t.count > 0) {
      t.points[t.head].copy(pos);
    }
  }

  updateTrails(dt) {
    let v = 0;
    const pos = this.trailPos, col = this.trailCol;
    for (const t of this.trails) {
      if (!t.used) continue;
      if (t.fading) {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.timer = 0.05;
          t.count -= 1;
          if (t.count <= 1) {
            t.used = false;
            continue;
          }
        }
      }
      for (let i = 0; i < t.count - 1; i++) {
        const a = t.points[(t.head - i + TRAIL_POINTS) % TRAIL_POINTS];
        const b = t.points[(t.head - i - 1 + TRAIL_POINTS) % TRAIL_POINTS];
        const k0 = (1 - i / TRAIL_POINTS) ** 2 * t.strength;
        const k1 = (1 - (i + 1) / TRAIL_POINTS) ** 2 * t.strength;
        pos[v * 3] = a.x; pos[v * 3 + 1] = a.y; pos[v * 3 + 2] = a.z;
        col[v * 3] = t.color.r * k0; col[v * 3 + 1] = t.color.g * k0; col[v * 3 + 2] = t.color.b * k0;
        v++;
        pos[v * 3] = b.x; pos[v * 3 + 1] = b.y; pos[v * 3 + 2] = b.z;
        col[v * 3] = t.color.r * k1; col[v * 3 + 1] = t.color.g * k1; col[v * 3 + 2] = t.color.b * k1;
        v++;
      }
    }
    const geo = this.trailLines.geometry;
    geo.setDrawRange(0, v);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  // --- space dust: tiny streaks that only exist near the camera ------------------------------

  buildDust() {
    this.dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST * 3; i++) this.dustPos[i] = (Math.random() - 0.5) * DUST_BOX * 2;
    this.dustLine = new Float32Array(DUST * 6);
    this.dustCol = new Float32Array(DUST * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dustLine, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.dustCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.dust.frustumCulled = false;
    this.root.add(this.dust);
  }

  updateDust(camera, relVelocity) {
    const box = DUST_BOX;
    const c = camera.position;
    const speed = relVelocity.length();
    const lengthScale = Math.min(0.045, 22 / Math.max(speed, 1));
    const bright = Math.min(0.62, 0.05 + speed * 0.01);
    for (let i = 0; i < DUST; i++) {
      for (let a = 0; a < 3; a++) {
        const axis = a === 0 ? c.x : a === 1 ? c.y : c.z;
        let d = this.dustPos[i * 3 + a] - axis;
        if (d > box) { d -= box * 2; this.dustPos[i * 3 + a] = axis + d; }
        else if (d < -box) { d += box * 2; this.dustPos[i * 3 + a] = axis + d; }
      }
      const x = this.dustPos[i * 3], y = this.dustPos[i * 3 + 1], z = this.dustPos[i * 3 + 2];
      this.dustLine[i * 6] = x; this.dustLine[i * 6 + 1] = y; this.dustLine[i * 6 + 2] = z;
      this.dustLine[i * 6 + 3] = x - relVelocity.x * lengthScale;
      this.dustLine[i * 6 + 4] = y - relVelocity.y * lengthScale;
      this.dustLine[i * 6 + 5] = z - relVelocity.z * lengthScale;
      this.dustCol[i * 6] = bright * 0.8; this.dustCol[i * 6 + 1] = bright * 0.85; this.dustCol[i * 6 + 2] = bright;
      this.dustCol[i * 6 + 3] = 0; this.dustCol[i * 6 + 4] = 0; this.dustCol[i * 6 + 5] = 0;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dust.geometry.attributes.color.needsUpdate = true;
  }

  // --- smoke: soft grey puffs that linger, grow and fade (normal blending, so they hide what is behind) ----

  buildSmoke() {
    this.smokes = [];
    for (let i = 0; i < SMOKE; i++) {
      const material = new THREE.SpriteMaterial({ map: this.fireTextures[i % 3], transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.root.add(sprite);
      this.smokes.push({ sprite, life: 0, max: 1, vel: new THREE.Vector3(), from: 1, to: 1, spin: 0, alpha: 0.5 });
    }
    this.smokeCursor = 0;
  }

  smoke(pos, { vel = null, from = 0.5, to = 3, life = 3, shade = 0.62, alpha = 0.42 } = {}) {
    const s = this.smokes[this.smokeCursor];
    this.smokeCursor = (this.smokeCursor + 1) % SMOKE;
    s.sprite.position.copy(pos);
    s.sprite.visible = true;
    s.sprite.material.color.setScalar(shade * (0.85 + Math.random() * 0.3));
    s.sprite.material.rotation = Math.random() * Math.PI * 2;
    s.life = s.max = life;
    s.from = from;
    s.to = to;
    s.alpha = alpha;
    s.spin = (Math.random() - 0.5) * 0.6;
    if (vel) s.vel.copy(vel);
    else s.vel.set(0, 0, 0);
  }

  updateSmoke(dt) {
    for (const s of this.smokes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.sprite.visible = false;
        continue;
      }
      const t = 1 - s.life / s.max;
      s.sprite.scale.setScalar(s.from + (s.to - s.from) * (1 - (1 - t) ** 2.5));
      s.sprite.position.addScaledVector(s.vel, dt);
      s.vel.multiplyScalar(1 - Math.min(1, dt * 0.6));
      s.sprite.material.rotation += s.spin * dt;
      s.sprite.material.opacity = s.alpha * Math.min(1, t * 12) * (1 - t) ** 1.4;
    }
  }

  // --- scanner beams -------------------------------------------------------------------------

  buildBeams() {
    this.beams = [0, 1, 2].map(() => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(0.5, 1.4, 3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      line.frustumCulled = false;
      line.visible = false;
      this.root.add(line);
      return { line, on: false };
    });
  }

  // Draw beam `i` this frame from a to b
  beam(i, a, b) {
    const beam = this.beams[i % this.beams.length];
    const p = beam.line.geometry.attributes.position;
    p.setXYZ(0, a.x, a.y, a.z);
    p.setXYZ(1, b.x, b.y, b.z);
    p.needsUpdate = true;
    beam.on = true;
  }

  // --- composite effects ----------------------------------------------------------------------

  flashLight(pos, peak, life) {
    const entry = this.lights[this.nextLight];
    this.nextLight = (this.nextLight + 1) % this.lights.length;
    entry.light.position.copy(pos);
    entry.light.intensity = peak;
    entry.life = entry.max = life;
    entry.peak = peak;
  }

  // A ship dying: white core flash, rolling fire, shock ring, flying pieces. size is about the ship's radius.
  explosion(pos, size = 3, vel = null) {
    const v = vel ? tmp.copy(vel).multiplyScalar(0.5).clone() : new THREE.Vector3();
    this.puff(pos, { color: 0xffffff, hdr: 5, from: size * 1.2, to: size * 5, life: 0.28, vel: v });
    this.puff(pos, { tex: this.ringTex, color: 0xffb070, hdr: 2.2, from: size * 0.8, to: size * 11, life: 0.7, vel: v });
    if (size > 5) this.puff(pos, { tex: this.ringTex, color: 0x70b0ff, hdr: 1.6, from: size, to: size * 7, life: 0.5, vel: v });
    const blobs = Math.min(16, 5 + Math.round(size * 1.3));
    for (let i = 0; i < blobs; i++) {
      const offset = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(size * 1.6);
      const outward = offset.clone().multiplyScalar(1.4).add(v);
      const p = pos.clone().add(offset);
      const hot = Math.random() < 0.5;
      this.puff(p, {
        tex: this.fireTextures[i % 3], color: hot ? 0xffa040 : 0xff5a18, hdr: hot ? 3.2 : 2,
        from: size * 0.7, to: size * (2 + Math.random() * 1.8), life: 0.55 + Math.random() * 0.6, vel: outward, spin: (Math.random() - 0.5) * 1.5,
      });
    }
    const pieces = Math.min(22, 5 + Math.round(size * 2.2));
    for (let i = 0; i < pieces; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.chunk(pos, dir.multiplyScalar((6 + Math.random() * 22) * Math.sqrt(size / 3)).add(v), size * (0.05 + Math.random() * 0.14), 1.6 + Math.random() * 2.2);
    }
    this.sparks(pos, Math.min(70, 16 + Math.round(size * 7)), 30 + size * 5, { life: 1.1, hdr: 4, vel: v });
    this.flashLight(pos, 40 + size * 18, 0.6);
  }

  hullHit(pos, vel) {
    this.sparks(pos, 8, 16, { vel, life: 0.5 });
    this.puff(pos, { tex: this.fireTextures[0], color: 0xff8030, hdr: 2.2, from: 0.4, to: 1.5, life: 0.22, vel });
  }

  rockHit(pos, normal) {
    this.sparks(pos, 6, 14, { color: 0xc8a070, hdr: 1.8, dir: normal, spread: 0.7, life: 0.5 });
    this.puff(pos, { color: 0xa89078, hdr: 0.5, from: 0.5, to: 2.2, life: 0.4 });
  }

  rockBreak(pos, size) {
    this.puff(pos, { color: 0xffc090, hdr: 2.2, from: size, to: size * 2.6, life: 0.3 });
    for (let i = 0; i < 6; i++) {
      this.puff(pos.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(size)), {
        tex: this.fireTextures[i % 3], color: 0x8a7a68, hdr: 0.6, from: size * 0.6, to: size * 2.2, life: 0.9 + Math.random() * 0.6,
      });
    }
    for (let i = 0; i < 10; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.chunk(pos, dir.multiplyScalar(5 + Math.random() * 12), size * (0.08 + Math.random() * 0.14), 1.4 + Math.random() * 1.6);
    }
    this.sparks(pos, 16, 18, { color: 0xc8a070, hdr: 2, life: 0.7 });
  }

  // A ship dropping out of its jump, or leaving
  warpFlash(pos, dir) {
    this.puff(pos, { color: 0xbfe0ff, hdr: 5, from: 1, to: 16, life: 0.35 });
    this.puff(pos, { tex: this.ringTex, color: 0x8cc4ff, hdr: 2.4, from: 1, to: 28, life: 0.55 });
    if (dir) this.sparks(pos, 24, 90, { color: 0xbfe0ff, hdr: 3, dir, spread: 0.15, life: 0.45 });
  }

  update(dt, camera, ship) {
    this.updateSprites(dt);
    this.updateDebris(dt);
    this.updateSparks(dt);
    this.updateFlashes(dt);
    this.updateTrails(dt);
    this.updateSmoke(dt);
    if (ship) {
      tmp.copy(ship.velocity);
      if (!ship.isWarping) tmp.sub(ship.frameVelocity);
      this.updateDust(camera, tmp);
    }
    for (const entry of this.lights) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      entry.light.intensity = entry.life > 0 ? entry.peak * (entry.life / entry.max) ** 2 : 0;
    }
    this.beams.forEach((b) => {
      b.line.visible = b.on;
      b.on = false;
    });
  }
}
