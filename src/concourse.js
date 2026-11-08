import { rng } from './shipModel';

// The station interior as hand-pixelled scenes: a lobby with doors to the bar, the exchange, the workshop, the mission
// office, the authorities and the landing deck. Everything is drawn at 384x216 and scaled up with hard pixels.
// Backgrounds are painted once per room with smooth tools, then posterized with an ordered dither, which gives
// them the look of a 256-colour VGA painting. People, lights, smoke and screens are drawn live on top.

export const W = 384;
export const H = 216;

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ----- colour --------------------------------------------------------------------------------------

const hexRgb = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export function mix(a, b, k) {
  const A = hexRgb(a), B = hexRgb(b);
  return '#' + A.map((v, i) => Math.max(0, Math.min(255, Math.round(v + (B[i] - v) * k))).toString(16).padStart(2, '0')).join('');
}
const dk = (c, k) => mix(c, '#000000', k);
const lt = (c, k) => mix(c, '#ffffff', k);
const rgba = (c, a) => {
  const [r, g, b] = hexRgb(c);
  return `rgba(${r},${g},${b},${a})`;
};

// ----- painting helpers ----------------------------------------------------------------------------

const R = (ctx, c, x, y, w, h) => {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
};
function poly(ctx, fill, pts) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}
function vgrad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([k, c]) => g.addColorStop(k, c));
  return g;
}
function glow(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}
function line(ctx, c, x0, y0, x1, y1, w = 1) {
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}
function ellipse(ctx, c, x, y, rx, ry) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

// Quantize to a few levels per channel with a 4x4 ordered dither, plus a little grain
function posterize(canvas, levels = 14, grain = 5) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const step = 255 / (levels - 1);
  const r = rng(1234);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const th = BAYER[(y & 3) * 4 + (x & 3)] * step;
      const n = (r() - 0.5) * grain;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c] + th + n;
        d[i + c] = Math.max(0, Math.min(255, Math.round(v / step) * step));
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ----- a 3x5 pixel font for signs --------------------------------------------------------------------

const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '-': '000000111000000', '.': '000000000000010', ':': '000010000010000', '!': '010010010000010',
  '+': '000010111010000', '/': '001001010100100', "'": '010010000000000', ' ': '000000000000000', '>': '100010001010100',
  '<': '001010100010001', '%': '101001010100101', '*': '000101010101000',
};
const signText = (s) => s.toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS');
export function textWidth(s, scale = 1) {
  return signText(s).length * 4 * scale - scale;
}
export function pixText(ctx, str, x, y, color, scale = 1, align = 'left') {
  const s = signText(str);
  let cx = Math.round(align === 'center' ? x - textWidth(s, scale) / 2 : align === 'right' ? x - textWidth(s, scale) : x);
  ctx.fillStyle = color;
  for (const ch of s) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3) * scale, Math.round(y) + Math.floor(i / 3) * scale, scale, scale);
    cx += 4 * scale;
  }
}
function neonText(ctx, str, x, y, color, scale = 1, align = 'center') {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  pixText(ctx, str, x, y, color, scale, align);
  ctx.shadowBlur = 0;
  pixText(ctx, str, x, y, lt(color, 0.55), scale, align);
  ctx.restore();
}

// ----- icons for door signs --------------------------------------------------------------------------

const ICONS = {
  glass: ['#########', '.#######.', '..#####..', '...###...', '....#....', '....#....', '..#####..'],
  crate: ['#########', '##.....##', '#.#...#.#', '#..#.#..#', '#...#...#', '#..#.#..#', '#.#...#.#', '#########'],
  wrench: ['......##.', '.....#..#', '......#.#', '.....###.', '....###..', '...###...', '..###....', '.###.....', '.##......'],
  star: ['....#....', '...###...', '#########', '.#######.', '..#####..', '.###.###.', '##.....##'],
  skull: ['..#####..', '.#######.', '##..#..##', '##..#..##', '.###.###.', '..#.#.#..', '..#####..'],
  board: ['########', '#......#', '#.####.#', '#......#', '#.###..#', '#......#', '#.####.#', '########'],
  ship: ['....#....', '...###...', '...#.#...', '..#####..', '.#######.', '##.###.##', '#...#...#'],
};
function icon(ctx, name, x, y, color, scale = 1) {
  const rows = ICONS[name];
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  ctx.fillStyle = color;
  rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') ctx.fillRect(x + i * scale, y + j * scale, scale, scale); }));
  ctx.restore();
}

// ----- station themes --------------------------------------------------------------------------------

const THEMES = {
  'Erde Orbital-Station': { wall: '#7d8b99', wall2: '#465260', ceil: '#2a323c', floor: '#3d4855', floor2: '#5c6876', trim: '#d6e0ea', light: '#eaf6ff', neon: '#4fd8ff', accent: '#ffb000', wood: '#6a5a4a', planet: { a: '#2f6fd0', b: '#2d6b3a', c: '#f2f6ff', atmo: '#7ab8ff' }, decor: 'plant' },
  'Venus Wolkenstadt': { wall: '#8c6a80', wall2: '#4e3448', ceil: '#2e1e2a', floor: '#4a2e3c', floor2: '#7a5262', trim: '#ecc878', light: '#ffeac0', neon: '#ff6ad5', accent: '#ffd060', wood: '#7a3e2a', planet: { a: '#e6c37a', b: '#c8964a', c: '#fff0c8', atmo: '#ffe0a0' }, decor: 'plant' },
  'Mars Außenposten': { wall: '#8a5640', wall2: '#4c2c20', ceil: '#2a1a14', floor: '#3e2a20', floor2: '#5e3e2c', trim: '#d0a074', light: '#ffd6a8', neon: '#ff7a3a', accent: '#ffcc40', wood: '#5a3a26', planet: { a: '#c4522a', b: '#8a3018', c: '#eaa070', atmo: '#ff9a70' }, decor: 'crate' },
  'Ceres-Mine': { wall: '#6a6048', wall2: '#3a3426', ceil: '#1e1a12', floor: '#2e2a1e', floor2: '#4a4430', trim: '#b0a070', light: '#ffe298', neon: '#ffc020', accent: '#ff9020', wood: '#4a3a24', grime: true, hazard: true, planet: null, decor: 'crate' },
  'Europa-Station': { wall: '#7c9eac', wall2: '#40606e', ceil: '#1c2c34', floor: '#2c4048', floor2: '#4a6a76', trim: '#e2f6ff', light: '#e4fcff', neon: '#80f0ff', accent: '#fff4c0', wood: '#5a6a72', planet: { a: '#d8a272', b: '#a86c40', c: '#f2dcb4', atmo: '#ffe4c0', bands: true }, decor: 'plant' },
  'Titan-Raffinerie': { wall: '#6c6840', wall2: '#3a3822', ceil: '#1c1a10', floor: '#2a281a', floor2: '#444028', trim: '#b8a864', light: '#ffdc94', neon: '#c0ff40', accent: '#ff9030', wood: '#4a3c22', grime: true, hazard: true, planet: { a: '#dcb878', b: '#b08c50', c: '#f0e0b0', atmo: '#ffe8b0', rings: true, bands: true }, decor: 'barrel' },
  'Triton-Posten': { wall: '#3a4c56', wall2: '#1c262c', ceil: '#10161a', floor: '#182026', floor2: '#28343c', trim: '#7a9aa2', light: '#a8e8d8', neon: '#ff3aa0', accent: '#40ffd0', wood: '#3a2a2a', grime: true, planet: { a: '#4a7ad0', b: '#2a4a8a', c: '#a8ccff', atmo: '#80b0ff' }, decor: 'barrel' },
  'Hades-Nest': { wall: '#5a4036', wall2: '#2a1c18', ceil: '#140e0c', floor: '#221614', floor2: '#3a2620', trim: '#9a6444', light: '#ffb070', neon: '#ff3020', accent: '#ffb000', wood: '#3a2418', rock: true, grime: true, planet: null, decor: 'barrel' },
};
export function themeFor(def) {
  return THEMES[def.name] || THEMES['Erde Orbital-Station'];
}

export const BAR_NAMES = {
  'Erde Orbital-Station': 'Orbit-Lounge', 'Venus Wolkenstadt': 'Wolkenperle', 'Mars Außenposten': 'Roter Staub',
  'Ceres-Mine': 'Der Bohrkopf', 'Europa-Station': 'Eiskeller', 'Titan-Raffinerie': 'Zum Rostring',
  'Triton-Posten': 'Letzter Halt', 'Hades-Nest': 'Die Asche',
};

// ----- people ----------------------------------------------------------------------------------------

const SKINS = ['#f2cbaa', '#e3b08a', '#c98e66', '#a06a48', '#74492f', '#f6dac4', '#bb7d58', '#8a5a3c'];
const HAIRS = ['#1a1410', '#3a2618', '#6a4424', '#a8742e', '#dcc490', '#8c8c8c', '#e8e6de', '#a43418', '#30407a', '#5a1a5a'];
const PALETTES = {
  police: { tops: ['#24427e', '#1e3866', '#2c4c8c'], trim: '#c8d8ff', legs: ['#1a2236', '#222a40'] },
  pirate: { tops: ['#3e2c22', '#5a1c14', '#2c2a28', '#4a3a2a', '#3a1a2a'], trim: '#d04020', legs: ['#1e1a18', '#2a2420', '#30261c'] },
  civil: { tops: ['#6a5a3a', '#3a5a5a', '#7a3a3a', '#4a4a6a', '#8a7a5a', '#2e4a3a', '#5a4a6a', '#7a6a4a'], trim: '#d8c8a0', legs: ['#22222a', '#3a3428', '#2a3040', '#3a2a22'] },
};
const ROLE_LOOK = {
  bartender: { top: '#e2dacb', trim: '#2a1a14', vest: '#3a1e1a' },
  mechanic: { top: '#c46222', trim: '#3a3a3a', hat: 'goggles' },
  trader: { top: '#5a3a6e', trim: '#e8c070', vest: '#2a1a34' },
  clerk: { top: '#3e4e5e', trim: '#e0e8f0', hat: 'headset' },
  deckhand: { top: '#d0a020', trim: '#2a2a2a', hat: 'headset' },
};

export function makePerson(seed, { faction = 'civil', role = null } = {}) {
  const r = rng(seed * 7 + 13);
  r(); r();
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const pal = PALETTES[faction] || PALETTES.civil;
  const s = {
    seed,
    faction,
    skin: pick(SKINS),
    hair: pick(HAIRS),
    eyes: pick(['#3a6aa0', '#4a3020', '#2a5a3a', '#6a6a7a', '#2a1a10']),
    top: pick(pal.tops),
    trim: pal.trim,
    legs: pick(pal.legs),
    shoes: '#141210',
    vest: null,
    hairStyle: pick(['short', 'short', 'long', 'bun', 'bald', 'crop']),
    hat: 'none',
    beard: r() < 0.25,
    patch: false,
    scar: false,
    height: 0.92 + r() * 0.14,
    build: 0.86 + r() * 0.3,
    lips: '#8a3a32',
  };
  if (faction === 'police') {
    s.hat = r() < 0.7 ? 'cap' : 'none';
    s.hatColor = '#1a2e5a';
    s.hairStyle = pick(['short', 'crop', 'bun']);
  } else if (faction === 'pirate') {
    s.hat = pick(['bandana', 'mohawk', 'none', 'bandana', 'beanie']);
    s.hatColor = pick(['#a02018', '#2a2a2a', '#5a4a2a']);
    s.patch = r() < 0.35;
    s.scar = r() < 0.6;
    s.beard = r() < 0.5;
  } else {
    if (r() < 0.18) { s.hat = 'beanie'; s.hatColor = pick(['#7a2a2a', '#2a4a6a', '#5a5a2a']); }
  }
  const look = role && ROLE_LOOK[role];
  if (look) {
    s.top = look.top;
    s.trim = look.trim;
    if (look.vest) s.vest = look.vest;
    if (look.hat) { s.hat = look.hat; s.hatColor = '#2a2a2a'; }
  }
  if (s.hairStyle === 'bald' && s.hat === 'mohawk') s.hairStyle = 'crop';
  return s;
}

// A full figure standing on footY, h pixels tall. pose: walk (phase), seated, talk, wave, wipe, back
export function drawPerson(ctx, x, footY, h, s, t, pose = {}) {
  const u = (h / 16) * s.height;
  const bw = s.build;
  const legH = 6.8 * u, torsoH = 5.3 * u, neckH = 0.45 * u, headH = 2.9 * u;
  const hipY = pose.seated ? footY : footY - legH;
  const shY = hipY - torsoH;
  const headTop = shY - neckH - headH;
  const tw = 4.4 * u * bw;
  const lw = 1.55 * u * Math.min(1.1, bw);
  const walk = pose.walk;
  const breathe = Math.sin(t * 1.7 + s.seed) * 0.12 * u;

  // Shadow
  if (!pose.seated) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, footY, tw * 0.75, Math.max(1, u * 0.55), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legs
  if (!pose.seated) {
    const stride = walk !== undefined ? Math.sin(walk) * 1.4 * u : 0;
    const lift = walk !== undefined ? Math.max(0, Math.cos(walk)) * 0.5 * u : 0;
    const lift2 = walk !== undefined ? Math.max(0, -Math.cos(walk)) * 0.5 * u : 0;
    R(ctx, dk(s.legs, 0.15), x - lw - 0.15 * u - stride, hipY, lw, legH - 0.5 * u - lift);
    R(ctx, s.legs, x + 0.15 * u + stride, hipY, lw, legH - 0.5 * u - lift2);
    R(ctx, lt(s.legs, 0.12), x + 0.15 * u + stride, hipY, Math.max(1, lw * 0.35), legH - 0.6 * u - lift2);
    R(ctx, s.shoes, x - lw - 0.35 * u - stride, footY - 0.7 * u - lift, lw + 0.45 * u, 0.7 * u);
    R(ctx, s.shoes, x + 0.15 * u + stride, footY - 0.7 * u - lift2, lw + 0.45 * u, 0.7 * u);
  }

  // Arms behind the torso edges
  const swing = walk !== undefined ? Math.sin(walk) * 0.9 * u : 0;
  const armW = 1.15 * u;
  const armTop = shY + 0.35 * u + breathe;
  const armL = 4.6 * u;
  const armC = dk(s.top, 0.22);
  if (pose.wipe) {
    // One forearm moving across the counter
    const wx = Math.sin(t * 3) * 1.6 * u;
    R(ctx, armC, x - tw / 2 - armW + 0.3 * u, armTop, armW, armL);
    R(ctx, s.skin, x - tw / 2 - armW + 0.3 * u, armTop + armL, armW, 0.9 * u);
    R(ctx, armC, x + tw / 2 - 0.3 * u, armTop, armW, armL * 0.55);
    R(ctx, armC, x + tw / 2 - 2.5 * u + wx, armTop + armL * 0.5, 2.8 * u, armW);
    R(ctx, s.skin, x + tw / 2 - 3.2 * u + wx, armTop + armL * 0.5, 0.9 * u, armW);
    R(ctx, '#e8e4dc', x + tw / 2 - 3.4 * u + wx, armTop + armL * 0.5 + armW, 1.6 * u, 0.6 * u);
  } else if (pose.drink) {
    const up = (Math.sin(t * 0.7 + s.seed) > 0.75) ? 1 : 0;
    R(ctx, armC, x - tw / 2 - armW + 0.3 * u, armTop, armW, armL);
    R(ctx, armC, x + tw / 2 - 0.3 * u, armTop, armW, armL * 0.5);
    R(ctx, armC, x + tw / 2 - 1.6 * u, armTop + armL * 0.45 - up * 1.4 * u, 2 * u, armW);
    R(ctx, s.skin, x + tw / 2 - 2.2 * u, armTop + armL * 0.4 - up * 1.4 * u, 0.9 * u, armW * 1.2);
    R(ctx, '#d8a040', x + tw / 2 - 2.3 * u, armTop + armL * 0.1 - up * 1.4 * u, 0.9 * u, 1.3 * u);
  } else if (pose.wave) {
    const wv = Math.sin(t * 8) * 0.5 * u;
    R(ctx, armC, x - tw / 2 - armW + 0.3 * u, armTop, armW, armL);
    R(ctx, s.skin, x - tw / 2 - armW + 0.3 * u, armTop + armL, armW, 0.9 * u);
    R(ctx, armC, x + tw / 2 - 0.3 * u + wv, armTop - armL * 0.7, armW, armL * 0.75);
    R(ctx, s.skin, x + tw / 2 - 0.3 * u + wv, armTop - armL * 0.9, armW, 0.9 * u);
  } else {
    R(ctx, armC, x - tw / 2 - armW + 0.3 * u, armTop + swing * 0.3, armW, armL);
    R(ctx, armC, x + tw / 2 - 0.3 * u, armTop - swing * 0.3, armW, armL);
    R(ctx, s.skin, x - tw / 2 - armW + 0.3 * u, armTop + armL + swing * 0.3, armW, 0.9 * u);
    R(ctx, s.skin, x + tw / 2 - 0.3 * u, armTop + armL - swing * 0.3, armW, 0.9 * u);
  }

  // Torso with light from the left
  R(ctx, s.top, x - tw / 2, shY + breathe, tw, torsoH - breathe + 0.2 * u);
  R(ctx, lt(s.top, 0.16), x - tw / 2, shY + breathe, Math.max(1, tw * 0.22), torsoH - breathe);
  R(ctx, dk(s.top, 0.3), x + tw / 2 - Math.max(1, tw * 0.22), shY + breathe, Math.max(1, tw * 0.22), torsoH - breathe);
  if (s.vest) {
    R(ctx, s.vest, x - tw / 2, shY + breathe, tw * 0.36, torsoH - breathe);
    R(ctx, s.vest, x + tw / 2 - tw * 0.36, shY + breathe, tw * 0.36, torsoH - breathe);
    R(ctx, lt(s.vest, 0.15), x - tw / 2, shY + breathe, Math.max(1, tw * 0.1), torsoH - breathe);
  }
  R(ctx, s.trim, x - 0.7 * u, shY + breathe, 1.4 * u, 0.7 * u); // collar
  R(ctx, dk(s.legs, 0.3), x - tw / 2, hipY - 0.55 * u, tw, 0.55 * u); // belt
  if (u > 2.4) R(ctx, '#c8b070', x - 0.35 * u, hipY - 0.55 * u, 0.7 * u, 0.55 * u);
  if (s.faction === 'police' && u > 1.6) R(ctx, '#f0d070', x - tw / 2 + 0.6 * u, shY + 1.2 * u + breathe, 0.8 * u, 0.8 * u); // badge
  if (s.faction === 'pirate' && u > 1.6) R(ctx, s.trim, x - tw / 2, shY + breathe, tw * 0.15, torsoH * 0.6); // sash

  // Neck and head
  R(ctx, dk(s.skin, 0.25), x - 0.5 * u, shY - neckH - 0.1 * u + breathe, u, neckH + 0.3 * u);
  const hw = 2.5 * u;
  const hx = x - hw / 2;
  const hy = headTop + breathe;
  if (pose.back) {
    R(ctx, s.skin, hx, hy, hw, headH);
    R(ctx, s.hair, hx - 0.1 * u, hy - 0.3 * u, hw + 0.2 * u, s.hairStyle === 'bald' ? 0.6 * u : headH * 0.85);
  } else {
    R(ctx, s.skin, hx, hy, hw, headH);
    R(ctx, dk(s.skin, 0.25), hx + hw - Math.max(1, hw * 0.25), hy, Math.max(1, hw * 0.25), headH);
    R(ctx, dk(s.skin, 0.18), hx + 0.2 * u, hy + headH - 0.3 * u, hw - 0.4 * u, 0.3 * u);
    if (u >= 2.2) {
      const blink = ((t + s.seed * 0.37) % 4.1) < 0.13;
      const ey = hy + 1.15 * u;
      if (blink) {
        R(ctx, dk(s.skin, 0.5), hx + 0.45 * u, ey + 0.2 * u, 0.55 * u, 0.15 * u);
        R(ctx, dk(s.skin, 0.5), hx + hw - 1.0 * u, ey + 0.2 * u, 0.55 * u, 0.15 * u);
      } else {
        R(ctx, '#1a1410', hx + 0.5 * u, ey, 0.42 * u, 0.42 * u);
        R(ctx, '#1a1410', hx + hw - 0.95 * u, ey, 0.42 * u, 0.42 * u);
      }
      R(ctx, dk(s.hair, 0.1), hx + 0.4 * u, ey - 0.35 * u, 0.6 * u, 0.15 * u);
      R(ctx, dk(s.hair, 0.1), hx + hw - 1.0 * u, ey - 0.35 * u, 0.6 * u, 0.15 * u);
      const talk = pose.talk && Math.sin(t * 18) > 0 ? 0.3 * u : 0;
      R(ctx, s.lips, hx + hw / 2 - 0.45 * u, hy + 2.15 * u, 0.9 * u, 0.18 * u + talk);
      R(ctx, dk(s.skin, 0.3), hx + hw / 2 - 0.05 * u, hy + 1.5 * u, 0.25 * u, 0.4 * u);
    } else {
      R(ctx, dk(s.skin, 0.55), hx + 0.45 * u, hy + 1.15 * u, Math.max(1, 0.4 * u), Math.max(1, 0.4 * u));
      R(ctx, dk(s.skin, 0.55), hx + hw - 0.9 * u, hy + 1.15 * u, Math.max(1, 0.4 * u), Math.max(1, 0.4 * u));
    }
    if (s.beard) R(ctx, s.hair, hx + 0.15 * u, hy + 1.9 * u, hw - 0.3 * u, 1.1 * u);
    if (s.beard && u >= 2.2) R(ctx, s.lips, hx + hw / 2 - 0.45 * u, hy + 2.15 * u, 0.9 * u, 0.18 * u);
    if (s.patch) {
      R(ctx, '#0e0c0a', hx + 0.3 * u, hy + 0.95 * u, 0.85 * u, 0.75 * u);
      R(ctx, '#0e0c0a', hx, hy + 0.7 * u, hw, Math.max(1, 0.12 * u));
    }
    // Hair
    const hs = s.hairStyle;
    if (hs !== 'bald') {
      R(ctx, s.hair, hx - 0.15 * u, hy - 0.35 * u, hw + 0.3 * u, hs === 'crop' ? 0.6 * u : 0.95 * u);
      R(ctx, lt(s.hair, 0.2), hx + 0.2 * u, hy - 0.3 * u, hw * 0.4, Math.max(1, 0.2 * u));
      if (hs !== 'crop') {
        R(ctx, s.hair, hx - 0.15 * u, hy, 0.4 * u, 1.3 * u);
        R(ctx, s.hair, hx + hw - 0.25 * u, hy, 0.4 * u, 1.3 * u);
      }
      if (hs === 'long') {
        R(ctx, s.hair, hx - 0.3 * u, hy, 0.55 * u, headH + 1.6 * u);
        R(ctx, dk(s.hair, 0.2), hx + hw - 0.25 * u, hy, 0.55 * u, headH + 1.6 * u);
      }
      if (hs === 'bun') R(ctx, s.hair, hx + hw / 2 - 0.6 * u, hy - 1.0 * u, 1.2 * u, 0.8 * u);
    }
  }
  // Headgear
  switch (s.hat) {
    case 'cap':
      R(ctx, s.hatColor, hx - 0.2 * u, hy - 0.6 * u, hw + 0.4 * u, 1.0 * u);
      R(ctx, dk(s.hatColor, 0.4), hx - 0.4 * u, hy + 0.3 * u, hw + 0.8 * u, Math.max(1, 0.3 * u));
      R(ctx, '#f0d070', hx + hw / 2 - 0.25 * u, hy - 0.4 * u, 0.5 * u, 0.5 * u);
      break;
    case 'bandana':
      R(ctx, s.hatColor, hx - 0.2 * u, hy - 0.4 * u, hw + 0.4 * u, 0.9 * u);
      R(ctx, s.hatColor, hx + hw, hy + 0.2 * u, 0.6 * u, 1.0 * u);
      break;
    case 'mohawk':
      R(ctx, '#e04020', hx + hw / 2 - 0.3 * u, hy - 1.3 * u, 0.6 * u, 1.5 * u);
      break;
    case 'beanie':
      R(ctx, s.hatColor, hx - 0.15 * u, hy - 0.8 * u, hw + 0.3 * u, 1.4 * u);
      R(ctx, lt(s.hatColor, 0.2), hx - 0.15 * u, hy + 0.3 * u, hw + 0.3 * u, Math.max(1, 0.3 * u));
      break;
    case 'goggles':
      R(ctx, '#3a3a3a', hx - 0.1 * u, hy + 0.15 * u, hw + 0.2 * u, Math.max(1, 0.25 * u));
      R(ctx, '#60c0e0', hx + 0.3 * u, hy - 0.1 * u, 0.75 * u, 0.6 * u);
      R(ctx, '#60c0e0', hx + hw - 1.05 * u, hy - 0.1 * u, 0.75 * u, 0.6 * u);
      break;
    case 'headset':
      R(ctx, '#2a2a2a', hx + hw - 0.1 * u, hy + 0.9 * u, 0.45 * u, 0.9 * u);
      R(ctx, '#2a2a2a', hx + hw / 2 + 0.6 * u, hy + 2.1 * u, 0.9 * u, Math.max(1, 0.15 * u));
      break;
    default:
  }
}

// A close-up for the dialog box: 48x48 painted portrait with the same colouring as the figure
export function drawFace(canvas, s, t, { talking = false, bg = '#1a1a22', light = '#fff0d0' } = {}) {
  const N = 48;
  if (canvas.width !== N) { canvas.width = N; canvas.height = N; }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = vgrad(ctx, 0, 0, 0, N, [[0, lt(bg, 0.12)], [1, dk(bg, 0.4)]]);
  ctx.fillRect(0, 0, N, N);
  glow(ctx, 10, 10, 30, light, 0.12);
  const P = (c, x, y, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const cx = 24, top = 9, hh = 25, hwBase = 19 + Math.round((s.build - 1) * 6);
  const skinL = lt(s.skin, 0.12), skinD = dk(s.skin, 0.22), skinDD = dk(s.skin, 0.4);

  // Shoulders and clothes
  for (let y = 38; y < N; y++) {
    const w = Math.min(46, 26 + (y - 38) * 3);
    P(s.top, cx - w / 2, y, w, 1);
    P(lt(s.top, 0.15), cx - w / 2, y, 4, 1);
    P(dk(s.top, 0.3), cx + w / 2 - 5, y, 5, 1);
  }
  if (s.vest) { for (let y = 41; y < N; y++) { P(s.vest, cx - 15, y, 8, 1); P(s.vest, cx + 7, y, 8, 1); } }
  P(s.trim, cx - 5, 38, 10, 2);
  P(dk(s.trim, 0.2), cx - 3, 40, 6, 2);
  if (s.faction === 'police') { P('#f0d070', cx - 14, 42, 3, 3); P('#fff8c0', cx - 13, 42, 1, 1); }
  // Neck
  P(skinD, cx - 4, 32, 8, 7);
  P(skinDD, cx - 4, 36, 8, 2);

  // Head rows with a rounded skull and a tapered jaw
  const rowW = (r) => {
    const f = r / hh;
    if (f < 0.12) return hwBase * (0.62 + (f / 0.12) * 0.33);
    if (f < 0.68) return hwBase;
    return hwBase * (1 - ((f - 0.68) / 0.32) * 0.42);
  };
  for (let r = 0; r < hh; r++) {
    const w = Math.round(rowW(r));
    const x0 = cx - Math.floor(w / 2);
    P(s.skin, x0, top + r, w, 1);
    P(skinL, x0 + 1, top + r, Math.max(1, Math.round(w * 0.28)), 1);
    P(skinD, x0 + w - Math.round(w * 0.26), top + r, Math.round(w * 0.26), 1);
  }
  // Ears
  P(skinD, cx - hwBase / 2 - 1, top + 10, 2, 5);
  P(skinDD, cx + hwBase / 2 - 1, top + 10, 2, 5);
  // Eyes, brows, nose, mouth
  const ey = top + 11;
  const blink = ((t + s.seed * 0.37) % 3.7) < 0.12;
  [[cx - 7, 0], [cx + 2, 1]].forEach(([ex, side]) => {
    if (blink) { P(skinDD, ex, ey + 1, 5, 1); return; }
    P('#f0ece4', ex, ey, 5, 2);
    P(s.eyes, ex + 1 + side, ey, 2, 2);
    P('#0a0a0a', ex + 2 + side, ey, 1, 1);
    P(skinDD, ex, ey - 1, 5, 1);
  });
  P(dk(s.hair, 0.1), cx - 8, ey - 3, 6, 1);
  P(dk(s.hair, 0.1), cx + 2, ey - 3, 6, 1);
  P(skinD, cx, ey + 3, 2, 4);
  P(skinDD, cx - 1, ey + 7, 4, 1);
  P(skinL, cx - 1, ey + 3, 1, 3);
  const my = top + 20;
  const open = talking && Math.sin(t * 17) > -0.2 ? 1 + (Math.sin(t * 9) > 0.5 ? 1 : 0) : 0;
  P(s.lips, cx - 3, my, 7, 1);
  if (open) { P('#2a0e0c', cx - 2, my + 1, 5, open); P(s.lips, cx - 2, my + 1 + open, 5, 1); }
  else P(dk(s.lips, 0.2), cx - 2, my + 1, 5, 1);
  // Cheek shading
  P(skinD, cx + 5, top + 15, 3, 3);
  if (s.beard) {
    for (let r = 17; r < hh; r++) {
      const w = Math.round(rowW(r));
      const x0 = cx - Math.floor(w / 2);
      P(s.hair, x0, top + r, w, 1);
    }
    P(dk(s.hair, 0.25), cx - 4, my - 1, 9, 1);
    P(s.lips, cx - 3, my, 7, 1);
    if (open) P('#2a0e0c', cx - 2, my + 1, 5, open);
  }
  if (s.scar) { P(lt(s.skin, 0.35), cx + 5, top + 8, 1, 1); P(lt(s.skin, 0.35), cx + 6, top + 9, 1, 2); P(lt(s.skin, 0.35), cx + 7, top + 11, 1, 3); }
  if (s.patch) {
    P('#0c0a08', cx - 8, ey - 1, 7, 5);
    for (let i = 0; i < 20; i++) P('#0c0a08', cx - 12 + i, top + 6 + Math.round(i * 0.25), 1, 1);
  }
  // Hair
  const hs = s.hairStyle;
  const hair = s.hair, hairL = lt(s.hair, 0.22), hairD = dk(s.hair, 0.25);
  if (hs !== 'bald') {
    const depth = hs === 'crop' ? 3 : 6;
    for (let r = -2; r < depth; r++) {
      const w = Math.round(rowW(Math.max(0, r)) + 2);
      P(hair, cx - Math.floor(w / 2), top + r, w, 1);
    }
    P(hairL, cx - 6, top - 1, 6, 1);
    P(hairL, cx - 7, top, 3, 1);
    if (hs !== 'crop') { P(hair, cx - hwBase / 2 - 1, top + 3, 3, 8); P(hairD, cx + hwBase / 2 - 2, top + 3, 3, 8); }
    if (hs === 'long') { P(hair, cx - hwBase / 2 - 2, top + 8, 4, 26); P(hairD, cx + hwBase / 2 - 2, top + 8, 4, 26); }
    if (hs === 'bun') { P(hair, cx - 4, top - 6, 8, 5); P(hairL, cx - 3, top - 6, 3, 1); }
  } else {
    P(lt(s.skin, 0.35), cx - 5, top + 2, 3, 1);
  }
  switch (s.hat) {
    case 'cap':
      P(s.hatColor, cx - 12, top - 3, 24, 6);
      P(lt(s.hatColor, 0.15), cx - 12, top - 3, 24, 1);
      P(dk(s.hatColor, 0.45), cx - 13, top + 3, 26, 2);
      P('#f0d070', cx - 2, top - 2, 4, 3);
      break;
    case 'bandana':
      P(s.hatColor, cx - 11, top - 2, 22, 6);
      P(lt(s.hatColor, 0.2), cx - 10, top - 1, 7, 1);
      P(s.hatColor, cx + 10, top + 2, 4, 3);
      P(s.hatColor, cx + 12, top + 5, 3, 5);
      break;
    case 'mohawk':
      for (let r = 0; r < 9; r++) P(r % 2 ? '#ff5a30' : '#d03818', cx - 2, top - 8 + r, 4, 1);
      break;
    case 'beanie':
      P(s.hatColor, cx - 11, top - 4, 22, 8);
      P(lt(s.hatColor, 0.2), cx - 11, top + 2, 22, 2);
      break;
    case 'goggles':
      P('#2a2a2a', cx - 11, top + 2, 22, 2);
      P('#3a3a3a', cx - 8, top, 6, 4); P('#3a3a3a', cx + 2, top, 6, 4);
      P('#60c0e0', cx - 7, top + 1, 4, 2); P('#60c0e0', cx + 3, top + 1, 4, 2);
      P('#c0f0ff', cx - 7, top + 1, 1, 1); P('#c0f0ff', cx + 3, top + 1, 1, 1);
      break;
    case 'headset':
      P('#2a2a2a', cx + hwBase / 2 - 1, top + 8, 3, 7);
      P('#3a3a3a', cx + 3, my, 7, 1);
      P('#ff4030', cx + 3, my, 1, 1);
      break;
    default:
  }
  // A bit of rim light and grain
  ctx.globalCompositeOperation = 'lighter';
  for (let r = 0; r < hh; r++) P(rgba(light, 0.12), cx - Math.floor(rowW(r) / 2), top + r, 1, 1);
  ctx.globalCompositeOperation = 'source-over';
}

// ----- the pilot's own ship, side view ---------------------------------------------------------------

export function drawShipSide(ctx, cx, cy, L, t, { hull = '#8a8c90', stripe = '#ffb000', glowOn = true } = {}) {
  const p = (x, y) => [cx + x * L, cy + y * L];
  const path = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  const fillPath = (pts, style) => { ctx.fillStyle = style; path(pts); ctx.fill(); };
  // Shadow on the deck
  ellipse(ctx, 'rgba(0,0,0,0.35)', cx - 0.02 * L, cy + 0.205 * L, 0.5 * L, 0.03 * L);
  // Landing struts with hydraulics
  [[-0.3, 0.1], [0.16, 0.07]].forEach(([x, y]) => {
    R(ctx, '#3a3a3a', cx + x * L, cy + y * L, 0.028 * L, 0.11 * L);
    R(ctx, '#9a9a9a', cx + x * L + 1, cy + y * L, Math.max(1, 0.008 * L), 0.06 * L);
    R(ctx, '#1a1a1a', cx + (x - 0.03) * L, cy + 0.19 * L, 0.09 * L, 0.02 * L);
  });
  // Far wing and far fin, in shadow
  fillPath([p(-0.05, -0.02), p(-0.38, -0.05), p(-0.47, -0.21), p(-0.3, -0.19)], dk(hull, 0.5));
  fillPath([p(-0.32, -0.12), p(-0.46, -0.12), p(-0.52, -0.3), p(-0.43, -0.3)], dk(hull, 0.35));
  R(ctx, stripe, cx - 0.52 * L, cy - 0.3 * L, 0.09 * L, Math.max(1, 0.015 * L));
  // Hull: lit from above, dark belly
  const body = [p(0.54, 0.025), p(0.42, -0.02), p(0.3, -0.06), p(0.12, -0.105), p(-0.08, -0.135), p(-0.36, -0.125), p(-0.5, -0.09), p(-0.5, 0.085), p(-0.3, 0.115), p(0.22, 0.085), p(0.42, 0.05)];
  fillPath(body, vgrad(ctx, 0, cy - 0.16 * L, 0, cy + 0.12 * L, [[0, lt(hull, 0.45)], [0.3, lt(hull, 0.1)], [0.55, hull], [0.8, dk(hull, 0.35)], [1, dk(hull, 0.6)]]));
  // Nose cone
  fillPath([p(0.54, 0.025), p(0.42, -0.02), p(0.4, 0.05), p(0.42, 0.05)], dk(hull, 0.25));
  fillPath([p(0.54, 0.025), p(0.46, 0.0), p(0.45, 0.02)], '#e8e8e8');
  // Panel lines and rivets
  ctx.save();
  path(body);
  ctx.clip();
  [-0.4, -0.27, -0.14, 0.0, 0.14, 0.28].forEach((x) => {
    line(ctx, rgba('#000000', 0.35), cx + x * L, cy - 0.15 * L, cx + x * L - 0.01 * L, cy + 0.12 * L);
    line(ctx, rgba('#ffffff', 0.12), cx + x * L + 1, cy - 0.15 * L, cx + x * L + 1 - 0.01 * L, cy + 0.12 * L);
    for (let y = -0.1; y < 0.09; y += 0.035) R(ctx, rgba('#000000', 0.3), cx + (x + 0.012) * L, cy + y * L, 1, 1);
  });
  line(ctx, rgba('#000000', 0.3), cx - 0.5 * L, cy + 0.045 * L, cx + 0.4 * L, cy + 0.045 * L);
  // Stripe with a thin second line, and the registration
  fillPath([p(0.38, -0.012), p(-0.5, -0.035), p(-0.5, -0.005), p(0.32, 0.016)], stripe);
  fillPath([p(0.3, 0.024), p(-0.5, 0.004), p(-0.5, 0.012), p(0.28, 0.03)], dk(stripe, 0.25));
  // Intake under the canopy
  fillPath([p(0.1, 0.0), p(-0.06, -0.01), p(-0.06, 0.04), p(0.06, 0.045)], '#1a1a1c');
  for (let i = 0; i < 4; i++) line(ctx, '#3a3a3e', cx + (0.08 - i * 0.035) * L, cy - 0.004 * L, cx + (0.08 - i * 0.035) * L, cy + 0.04 * L);
  ctx.restore();
  pixText(ctx, 'SOL 4471', cx - 0.27 * L, cy - 0.085 * L, rgba('#1a1a1a', 0.75), 1, 'center');
  // Canopy with frame and glare
  const canopy = [p(0.22, -0.085), p(0.07, -0.19), p(-0.1, -0.2), p(-0.15, -0.13)];
  fillPath(canopy, vgrad(ctx, 0, cy - 0.2 * L, 0, cy - 0.08 * L, [[0, '#d0f8ff'], [0.35, '#3aa0c8'], [1, '#08202e']]));
  ctx.strokeStyle = dk(hull, 0.45);
  ctx.lineWidth = Math.max(1, L * 0.008);
  path(canopy);
  ctx.stroke();
  line(ctx, dk(hull, 0.45), cx + 0.02 * L, cy - 0.195 * L, cx + 0.06 * L, cy - 0.1 * L, Math.max(1, L * 0.008));
  line(ctx, 'rgba(255,255,255,0.75)', cx - 0.06 * L, cy - 0.185 * L, cx + 0.06 * L, cy - 0.16 * L);
  line(ctx, 'rgba(255,255,255,0.35)', cx + 0.1 * L, cy - 0.14 * L, cx + 0.16 * L, cy - 0.1 * L);
  // Antenna
  line(ctx, '#3a3a3a', cx - 0.22 * L, cy - 0.13 * L, cx - 0.26 * L, cy - 0.2 * L);
  // Near wing with leading edge highlight and markings
  const wing = [p(0.08, 0.05), p(-0.36, 0.05), p(-0.48, 0.25), p(-0.2, 0.23)];
  fillPath(wing, vgrad(ctx, 0, cy, 0, cy + 0.25 * L, [[0, lt(hull, 0.15)], [1, dk(hull, 0.45)]]));
  line(ctx, lt(hull, 0.5), cx + 0.08 * L, cy + 0.05 * L, cx - 0.2 * L, cy + 0.23 * L);
  fillPath([p(-0.29, 0.205), p(-0.45, 0.215), p(-0.47, 0.24), p(-0.25, 0.232)], stripe);
  line(ctx, rgba('#000000', 0.3), cx - 0.12 * L, cy + 0.06 * L, cx - 0.3 * L, cy + 0.2 * L);
  // Wingtip gun and nose gun
  R(ctx, '#2a2a2a', cx - 0.44 * L, cy + 0.245 * L, 0.24 * L, Math.max(1, 0.012 * L));
  R(ctx, '#2a2a2a', cx + 0.26 * L, cy + 0.06 * L, 0.22 * L, Math.max(1, 0.018 * L));
  R(ctx, '#5a5a5a', cx + 0.26 * L, cy + 0.06 * L, 0.22 * L, 1);
  // Engine bell with a hot core
  fillPath([p(-0.5, -0.075), p(-0.56, -0.095), p(-0.56, 0.095), p(-0.5, 0.075)], '#2a2a2c');
  R(ctx, '#4a4a4e', cx - 0.56 * L, cy - 0.095 * L, Math.max(1, 0.01 * L), 0.19 * L);
  if (glowOn) {
    const pulse = 0.5 + Math.sin(t * 2) * 0.15;
    R(ctx, '#ffcf80', cx - 0.565 * L, cy - 0.05 * L, Math.max(1, 0.008 * L), 0.1 * L);
    glow(ctx, cx - 0.57 * L, cy, 0.14 * L, '#ff9a40', pulse * 0.55);
  }
  // Nav lights
  const blink = Math.sin(t * 3) > 0.6;
  R(ctx, blink ? '#ff3020' : '#5a1010', cx - 0.47 * L, cy + 0.24 * L, 2, 2);
  R(ctx, Math.sin(t * 3 + 2) > 0.6 ? '#40ff60' : '#105a20', cx - 0.5 * L, cy - 0.3 * L, 2, 2);
  if (blink) glow(ctx, cx - 0.46 * L, cy + 0.245 * L, 7, '#ff3020', 0.6);
}

// ----- room building blocks --------------------------------------------------------------------------

// A box room in one-point perspective: back wall from (bx0,by0) to (bx1,by1), side walls, ceiling and floor
function roomBox(ctx, th, box, { panels = 20, lights = 3 } = {}) {
  const { bx0, by0, bx1, by1 } = box;
  // Ceiling
  ctx.fillStyle = vgrad(ctx, 0, 0, 0, by0, [[0, dk(th.ceil, 0.4)], [1, th.ceil]]);
  ctx.fillRect(0, 0, W, by0 + 1);
  // Floor
  ctx.fillStyle = vgrad(ctx, 0, by1, 0, H, [[0, th.floor2], [1, th.floor]]);
  ctx.fillRect(0, by1, W, H - by1);
  // Side walls
  ctx.fillStyle = vgrad(ctx, 0, 0, bx0, 0, [[0, dk(th.wall, 0.35)], [1, dk(th.wall, 0.08)]]);
  poly(ctx, ctx.fillStyle, [[0, 0], [bx0, by0], [bx0, by1], [0, H]]);
  ctx.fillStyle = vgrad(ctx, bx1, 0, W, 0, [[0, dk(th.wall, 0.15)], [1, dk(th.wall, 0.5)]]);
  poly(ctx, ctx.fillStyle, [[W, 0], [bx1, by0], [bx1, by1], [W, H]]);
  // Back wall
  ctx.fillStyle = vgrad(ctx, 0, by0, 0, by1, [[0, lt(th.wall, 0.06)], [0.6, th.wall], [1, th.wall2]]);
  ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
  for (let x = bx0 + panels; x < bx1; x += panels) {
    R(ctx, rgba('#000000', 0.25), x, by0 + 6, 1, by1 - by0 - 10);
    R(ctx, rgba('#ffffff', 0.06), x + 1, by0 + 6, 1, by1 - by0 - 10);
  }
  R(ctx, th.trim, bx0, by0 + 3, bx1 - bx0, 2);
  R(ctx, dk(th.trim, 0.4), bx0, by0 + 5, bx1 - bx0, 1);
  R(ctx, dk(th.wall2, 0.3), bx0, by1 - 5, bx1 - bx0, 5);
  R(ctx, dk(th.trim, 0.2), bx0, by1 - 6, bx1 - bx0, 1);
  // Corners
  line(ctx, rgba('#000000', 0.4), bx0, by0, bx0, by1);
  line(ctx, rgba('#000000', 0.4), bx1, by0, bx1, by1);
  line(ctx, rgba('#000000', 0.5), 0, 0, bx0, by0);
  line(ctx, rgba('#000000', 0.5), W, 0, bx1, by0);
  line(ctx, rgba('#000000', 0.3), 0, H, bx0, by1);
  line(ctx, rgba('#000000', 0.3), W, H, bx1, by1);
  // Side wall panel seams in perspective
  for (let k = 1; k < 5; k++) {
    const u = k / 5;
    const xl = bx0 * u, xr = W - (W - bx1) * u;
    line(ctx, rgba('#000000', 0.22), xl, by0 * u, xl, H + (by1 - H) * u);
    line(ctx, rgba('#000000', 0.22), xr, by0 * u, xr, H + (by1 - H) * u);
  }
  // Floor tiles: rays from the vanishing point and rows getting denser toward the back
  const vx = (bx0 + bx1) / 2, vy = (by0 + by1) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, by1, W, H - by1);
  ctx.clip();
  for (let x = bx0 - 200; x <= bx1 + 200; x += 22) {
    const dx = x - vx, dy = by1 - vy;
    const k = (H - vy) / dy;
    line(ctx, rgba('#000000', 0.22), x, by1, vx + dx * k, H);
  }
  for (let i = 1; i < 9; i++) {
    const y = by1 + (H - by1) * Math.pow(i / 9, 1.6);
    line(ctx, rgba('#000000', 0.2), 0, y, W, y);
  }
  ctx.restore();
  // Ceiling light strips with their reflections on the floor
  for (let i = 0; i < lights; i++) {
    const k = (i + 1) / (lights + 1);
    const xb = bx0 + (bx1 - bx0) * k;
    const xf = W * (k * 1.3 - 0.15);
    poly(ctx, rgba(th.light, 0.6), [[xb - 2, by0 - 1], [xb + 2, by0 - 1], [xf + 6, 0], [xf - 6, 0]]);
    poly(ctx, rgba('#ffffff', 0.5), [[xb - 1, by0 - 1], [xb + 1, by0 - 1], [xf + 2, 0], [xf - 2, 0]]);
    glow(ctx, (xb + xf) / 2, by0 * 0.5, 40, th.light, 0.14);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = vgrad(ctx, 0, by1, 0, H, [[0, rgba(th.light, 0.0)], [0.5, rgba(th.light, 0.07)], [1, rgba(th.light, 0.0)]]);
    poly(ctx, ctx.fillStyle, [[xb - 4, by1], [xb + 4, by1], [xf + 18, H], [xf - 18, H]]);
    ctx.restore();
  }
  if (th.rock) rockify(ctx, box);
  if (th.grime) grime(ctx, box);
}

function rockify(ctx, box) {
  const r = rng(77);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, box.by1);
  ctx.clip();
  for (let i = 0; i < 160; i++) {
    const x = r() * W, y = r() * box.by1, rad = 3 + r() * 12;
    ellipse(ctx, rgba(r() < 0.5 ? '#000000' : '#ffd0a0', 0.05 + r() * 0.08), x, y, rad * 1.4, rad);
  }
  ctx.restore();
}

function grime(ctx, box) {
  const r = rng(91);
  for (let i = 0; i < 40; i++) {
    const x = box.bx0 + r() * (box.bx1 - box.bx0);
    const y = box.by0 + 8 + r() * 20;
    ctx.fillStyle = vgrad(ctx, 0, y, 0, y + 30 + r() * 30, [[0, 'rgba(20,14,6,0.35)'], [1, 'rgba(20,14,6,0)']]);
    ctx.fillRect(x, y, 2 + r() * 5, 40 + r() * 30);
  }
  // Pipes along the ceiling
  for (let i = 0; i < 3; i++) {
    const y = 6 + i * 7;
    R(ctx, '#2a2620', 0, y, W, 3);
    R(ctx, '#4a443a', 0, y, W, 1);
    for (let x = 20 + i * 13; x < W; x += 60) R(ctx, '#5a5446', x, y - 1, 3, 5);
  }
}

function hazardBand(ctx, x, y, w, h, a = '#e8b020', b = '#1a1a1a') {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = b;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = a;
  for (let i = -h; i < w + h; i += 8) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + 4, y + h);
    ctx.lineTo(x + i + 4 + h, y);
    ctx.lineTo(x + i + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Point on a side wall: u 0 at the screen edge .. 1 at the back wall, v 0 ceiling .. 1 floor
function wallPt(box, side, u, v) {
  const x = side < 0 ? box.bx0 * u : W - (W - box.bx1) * u;
  const yt = box.by0 * u;
  const yb = H + (box.by1 - H) * u;
  return [x, yt + (yb - yt) * v];
}
function wallQuad(box, side, u0, u1, v0, v1) {
  return [wallPt(box, side, u0, v0), wallPt(box, side, u1, v0), wallPt(box, side, u1, v1), wallPt(box, side, u0, v1)];
}

// A side wall doorway leading back to the lobby
function sideDoor(ctx, th, box, side, u0, u1, label = 'LOBBY') {
  const frame = wallQuad(box, side, u0 - 0.03, u1 + 0.03, 0.3, 1);
  poly(ctx, dk(th.trim, 0.3), frame);
  const q = wallQuad(box, side, u0, u1, 0.34, 1);
  ctx.fillStyle = vgrad(ctx, 0, q[0][1], 0, q[3][1], [[0, lt(th.light, 0.1)], [1, dk(th.wall, 0.2)]]);
  poly(ctx, ctx.fillStyle, q);
  glow(ctx, (q[0][0] + q[1][0]) / 2, (q[0][1] + q[3][1]) / 2, 30, th.light, 0.15);
  const s = wallPt(box, side, (u0 + u1) / 2, 0.24);
  neonText(ctx, label, s[0], s[1], th.neon, 1, 'center');
  return frame;
}

function backDoor(ctx, th, x, w, top, bottom, interior, iconName, label) {
  R(ctx, dk(th.trim, 0.35), x - 3, top - 3, w + 6, bottom - top + 3);
  R(ctx, th.trim, x - 3, top - 3, w + 6, 1);
  // The room beyond: a lit back wall, a floor and somebody standing around
  ctx.fillStyle = vgrad(ctx, 0, top, 0, bottom, [[0, dk(interior, 0.75)], [0.3, dk(interior, 0.4)], [0.75, dk(interior, 0.5)], [1, dk(interior, 0.7)]]);
  ctx.fillRect(x, top, w, bottom - top);
  R(ctx, lt(interior, 0.35), x + 3, top + 6, w - 6, 2);
  glow(ctx, x + w / 2, top + 8, w * 0.7, interior, 0.35);
  R(ctx, dk(interior, 0.5), x, bottom - 14, w, 14);
  R(ctx, dk(interior, 0.3), x, bottom - 15, w, 1);
  const sil = dk(interior, 0.82);
  const sx = x + w * (0.3 + (w % 7) * 0.06);
  R(ctx, sil, sx - 2, bottom - 30, 5, 16);
  R(ctx, sil, sx - 1.5, bottom - 35, 4, 5);
  R(ctx, sil, sx - 2, bottom - 14, 2, 8);
  R(ctx, sil, sx + 1, bottom - 14, 2, 8);
  // Door leaves slid aside
  R(ctx, dk(th.wall, 0.25), x, top, 3, bottom - top);
  R(ctx, dk(th.wall, 0.35), x + w - 3, top, 3, bottom - top);
  // Light spilling onto the floor
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = vgrad(ctx, 0, bottom, 0, bottom + 40, [[0, rgba(interior, 0.35)], [1, rgba(interior, 0)]]);
  poly(ctx, ctx.fillStyle, [[x, bottom], [x + w, bottom], [x + w + 18, bottom + 40], [x - 18, bottom + 40]]);
  ctx.restore();
  glow(ctx, x + w / 2, top + (bottom - top) * 0.4, w, interior, 0.22);
  // Sign
  const sy = top - 20;
  R(ctx, '#0c0c10', x - 2, sy, w + 4, 14);
  R(ctx, dk(th.trim, 0.2), x - 2, sy + 14, w + 4, 1);
  const iw = (ICONS[iconName][0].length);
  icon(ctx, iconName, Math.round(x + w / 2 - iw / 2), sy + 3, th.neon);
  neonText(ctx, label, x + w / 2, top - 4 - 9 - 13, th.accent, 1, 'center');
  return [x - 3, top - 24, w + 6, bottom - top + 24];
}

function stars(ctx, x, y, w, h, seed, n = 60) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const b = r();
    R(ctx, b > 0.92 ? '#ffffff' : b > 0.6 ? '#a8b8d0' : '#5a6478', x + r() * w, y + r() * h, 1, 1);
  }
}

function planetDisc(ctx, cx, cy, rad, p) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = vgrad(ctx, cx - rad, cy - rad, cx + rad, cy + rad, [[0, p.c], [0.35, p.a], [1, dk(p.b, 0.6)]]);
  ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  const r = rng(Math.round(rad * 13));
  if (p.bands) {
    for (let i = 0; i < 9; i++) {
      const y = cy - rad + (i + r()) * (rad * 2 / 9);
      R(ctx, rgba(i % 2 ? p.b : p.c, 0.35), cx - rad, y, rad * 2, 2 + r() * 4);
    }
  } else {
    for (let i = 0; i < 26; i++) ellipse(ctx, rgba(r() < 0.5 ? p.b : p.c, 0.4), cx - rad + r() * rad * 2, cy - rad + r() * rad * 2, 3 + r() * rad * 0.3, 2 + r() * rad * 0.15);
  }
  // Night side
  const g = ctx.createRadialGradient(cx - rad * 0.5, cy - rad * 0.5, rad * 0.3, cx, cy, rad * 1.5);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  ctx.restore();
  // Atmosphere rim
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(p.atmo, 0.5);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, Math.PI * 0.85, Math.PI * 1.75);
  ctx.stroke();
  ctx.restore();
  if (p.rings) {
    ctx.save();
    ctx.strokeStyle = rgba(p.c, 0.55);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rad * 1.9, rad * 0.35, -0.2, Math.PI * 0.05, Math.PI * 0.95);
    ctx.stroke();
    ctx.strokeStyle = rgba(p.b, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rad * 1.6, rad * 0.29, -0.2, Math.PI * 0.05, Math.PI * 0.95);
    ctx.stroke();
    ctx.restore();
  }
}

function asteroidsView(ctx, x, y, w, h, seed) {
  const r = rng(seed);
  for (let i = 0; i < 14; i++) {
    const ax = x + r() * w, ay = y + r() * h, rad = 1 + r() * (i < 3 ? 7 : 3);
    ellipse(ctx, '#3a3228', ax, ay, rad * 1.3, rad);
    ellipse(ctx, '#7a6a54', ax - rad * 0.3, ay - rad * 0.3, rad * 0.7, rad * 0.5);
  }
}

// A space window with its view
function spaceWindow(ctx, th, x, y, w, h, seed) {
  R(ctx, dk(th.trim, 0.3), x - 4, y - 4, w + 8, h + 8);
  R(ctx, th.trim, x - 4, y - 4, w + 8, 1);
  R(ctx, '#03040a', x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  stars(ctx, x, y, w, h, seed, Math.round(w * h / 40));
  if (th.planet) planetDisc(ctx, x + w * 0.72, y + h * 1.05, Math.max(w, h) * 0.55, th.planet);
  else asteroidsView(ctx, x, y, w, h, seed + 3);
  // Reflection on the glass
  ctx.fillStyle = vgrad(ctx, x, y, x + w, y + h, [[0, 'rgba(255,255,255,0.08)'], [0.4, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0.03)']]);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  // Mullions
  for (let i = 1; i < 3; i++) R(ctx, dk(th.trim, 0.3), x + (w * i) / 3 - 1, y, 2, h);
  R(ctx, dk(th.trim, 0.4), x, y + h * 0.55, w, 2);
}

function plant(ctx, x, y, s, seed) {
  R(ctx, '#4a3a2e', x - 6 * s, y - 8 * s, 12 * s, 8 * s);
  R(ctx, '#6a5444', x - 6 * s, y - 8 * s, 12 * s, 2 * s);
  const r = rng(seed);
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
    const l = (10 + r() * 14) * s;
    ctx.strokeStyle = r() < 0.5 ? '#2e6a30' : '#4a8a3a';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(x, y - 8 * s);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5, y - 8 * s + Math.sin(a) * l, x + Math.cos(a) * l, y - 8 * s + Math.sin(a) * l * 0.6);
    ctx.stroke();
  }
}

function crate(ctx, x, y, w, h, c, label) {
  R(ctx, c, x, y, w, h);
  R(ctx, lt(c, 0.2), x, y, w, 2);
  R(ctx, dk(c, 0.35), x + w - 2, y, 2, h);
  R(ctx, dk(c, 0.25), x, y + h - 2, w, 2);
  line(ctx, rgba('#000000', 0.25), x + 2, y + 2, x + w - 2, y + h - 2);
  line(ctx, rgba('#000000', 0.25), x + w - 2, y + 2, x + 2, y + h - 2);
  if (label) pixText(ctx, label, x + w / 2, y + h / 2 - 2, rgba('#f0e0a0', 0.8), 1, 'center');
}

function barrel(ctx, x, y, c) {
  R(ctx, c, x - 6, y - 16, 12, 16);
  R(ctx, lt(c, 0.25), x - 5, y - 16, 3, 16);
  R(ctx, dk(c, 0.4), x + 3, y - 16, 3, 16);
  R(ctx, dk(c, 0.5), x - 6, y - 12, 12, 1);
  R(ctx, dk(c, 0.5), x - 6, y - 5, 12, 1);
  ellipse(ctx, dk(c, 0.3), x, y - 16, 6, 2);
}

// ----- rooms -----------------------------------------------------------------------------------------

// Each room returns { bg, hotspots: [{ id, label, rect | poly }], slots: { name: { x, y, h, pose, front } }, fx(ctx, t, live) }
// fx draws the animated layer under the people; over(ctx, t, live) draws lights and haze on top of them.

export function buildRoom(room, def, live) {
  const th = themeFor(def);
  const bg = document.createElement('canvas');
  bg.width = W;
  bg.height = H;
  const ctx = bg.getContext('2d');
  const builder = { lobby: buildLobby, bar: buildBar, exchange: buildExchange, workshop: buildWorkshop, missions: buildMissions, office: buildOffice, hangar: buildHangar }[room];
  const out = builder(ctx, th, def, live);
  posterize(bg, 15, th.grime ? 9 : 5);
  out.bg = bg;
  out.theme = th;
  return out;
}

function buildLobby(ctx, th, def) {
  const box = { bx0: 70, by0: 36, bx1: 314, by1: 136 };
  roomBox(ctx, th, box, { panels: 18, lights: 3 });
  const pirate = def.faction === 'pirate' || def.blackMarket;
  const hotspots = [];

  // Hanging station sign under the ceiling (live marquee drawn in fx)
  R(ctx, '#202020', 150, 0, 1, 12);
  R(ctx, '#202020', 233, 0, 1, 12);
  R(ctx, '#0a0a0c', 140, 12, 104, 15);
  R(ctx, dk(th.trim, 0.2), 140, 26, 104, 1);

  // Back wall doors and window
  const top = 80, bottom = box.by1;
  hotspots.push({ id: 'bar', label: `Bar · ${BAR_NAMES[def.name] || 'Bar'}`, rect: backDoor(ctx, th, 82, 34, top, bottom, '#b0306a', 'glass', 'BAR') });
  hotspots.push({ id: 'exchange', label: 'Handelsbörse', rect: backDoor(ctx, th, 126, 30, top, bottom, '#c08020', 'crate', 'BOERSE') });
  spaceWindow(ctx, th, 168, 48, 50, 62, hashStr(def.name));
  hotspots.push({ id: 'missions', label: pirate ? 'Auftragsbrett' : 'Auftragsbüro', rect: backDoor(ctx, th, 230, 30, top, bottom, '#2a9a5a', 'board', 'JOBS') });
  hotspots.push({ id: 'office', label: pirate ? 'Mittelsmann' : 'SOLPOL-Revier', rect: backDoor(ctx, th, 272, 30, top, bottom, pirate ? '#8a1a10' : '#2a5ac0', pirate ? 'skull' : 'star', pirate ? 'KONTOR' : 'SOLPOL') });

  // Left wall: the hangar gate to the landing deck
  const gate = wallQuad(box, -1, 0.3, 0.86, 0.2, 1);
  poly(ctx, '#1a1a1a', wallQuad(box, -1, 0.26, 0.9, 0.16, 1));
  ctx.save();
  ctx.beginPath();
  gate.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = vgrad(ctx, 0, 30, 0, H, [[0, '#4a5058'], [0.45, '#3a4048'], [0.46, '#cfe6ff'], [1, '#6a8aa8']]);
  ctx.fillRect(0, 0, box.bx0 + 2, H);
  for (let k = 0; k < 9; k++) {
    const v = 0.2 + k * 0.035;
    const a = wallPt(box, -1, 0.3, v), b = wallPt(box, -1, 0.86, v);
    line(ctx, '#22262c', a[0], a[1], b[0], b[1]);
  }
  const hz0 = wallPt(box, -1, 0.3, 0.52), hz1 = wallPt(box, -1, 0.86, 0.52);
  for (let k = 0; k < 8; k++) {
    const u = 0.3 + k * 0.07;
    const p0 = wallPt(box, -1, u, 0.5), p1 = wallPt(box, -1, u + 0.035, 0.5), p2 = wallPt(box, -1, u + 0.035, 0.54), p3 = wallPt(box, -1, u, 0.54);
    poly(ctx, '#e8b020', [p0, p1, p2, p3]);
  }
  void hz0; void hz1;
  ctx.restore();
  glow(ctx, 32, 170, 60, '#bfe0ff', 0.25);
  const gs = wallPt(box, -1, 0.58, 0.1);
  icon(ctx, 'ship', gs[0] - 4, gs[1] - 6, th.neon);
  neonText(ctx, 'DECK', gs[0], gs[1] + 4, th.accent, 1, 'center');
  hotspots.push({ id: 'hangar', label: 'Landedeck · zum Schiff', poly: wallQuad(box, -1, 0.26, 0.9, 0.06, 1) });

  // Right wall: workshop bay
  const bay = wallQuad(box, 1, 0.28, 0.84, 0.22, 1);
  poly(ctx, '#161412', wallQuad(box, 1, 0.24, 0.88, 0.18, 1));
  ctx.save();
  ctx.beginPath();
  bay.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = vgrad(ctx, 0, 40, 0, H, [[0, '#3a2a1a'], [1, '#6a4020']]);
  ctx.fillRect(box.bx1 - 2, 0, W, H);
  // A hint of a ship's nose and a tool rack inside
  poly(ctx, '#6a6c70', [[W - 6, 120], [W - 30, 132], [W - 6, 140]]);
  for (let k = 0; k < 5; k++) R(ctx, '#2a2420', box.bx1 + 6 + k * 8, 70, 2, 30);
  ctx.restore();
  hazardBand(ctx, box.bx1 + 2, H - 14, W - box.bx1, 6);
  const ws = wallPt(box, 1, 0.56, 0.1);
  icon(ctx, 'wrench', ws[0] - 4, ws[1] - 7, th.neon);
  neonText(ctx, 'WERKSTATT', ws[0], ws[1] + 5, th.accent, 1, 'center');
  hotspots.push({ id: 'workshop', label: 'Werkstatt', poly: wallQuad(box, 1, 0.24, 0.88, 0.06, 1) });

  // Decor
  if (th.decor === 'plant') {
    plant(ctx, 76, 150, 1.0, 3);
    plant(ctx, 312, 150, 1.0, 5);
  } else if (th.decor === 'crate') {
    crate(ctx, 70, 128, 22, 18, '#6a5a3a', 'ORE');
    crate(ctx, 80, 112, 16, 16, '#5a4a2e');
    crate(ctx, 300, 130, 20, 16, '#4a5a3a');
  } else {
    barrel(ctx, 76, 152, '#5a3a2a');
    barrel(ctx, 88, 150, '#3a4a3a');
    barrel(ctx, 308, 150, '#6a2a1a');
  }
  if (th.hazard) hazardBand(ctx, box.bx0, box.by1 - 4, box.bx1 - box.bx0, 4);
  // Bench under the window
  R(ctx, dk(th.wood, 0.2), 168, 146, 50, 4);
  R(ctx, lt(th.wood, 0.15), 168, 146, 50, 1);
  R(ctx, '#1a1a1a', 172, 150, 2, 6);
  R(ctx, '#1a1a1a', 212, 150, 2, 6);
  // Wall lamps
  [120, 162, 224, 266, 306].forEach((x) => { R(ctx, th.trim, x, 66, 4, 3); glow(ctx, x + 2, 70, 16, th.light, 0.25); });

  // The street vendor's cart, front left
  const vx = 112, vy = 186;
  const slots = {
    vendor: { x: vx, y: vy - 2, h: 54, front: (c) => vendorCart(c, th, vx, vy) },
    guard: { x: 292, y: 152, h: 40 },
    lounger: { x: 196, y: 152, h: 40, pose: { drink: true } },
  };
  hotspots.push({ id: 'vendor', label: 'Fliegender Händler', rect: [vx - 30, vy - 72, 60, 76] });

  return {
    box,
    hotspots,
    slots,
    walk: { y0: 150, y1: 210, x0: -20, x1: W + 20 },
    fx(c, t, liveNow) {
      // Marquee
      c.save();
      c.beginPath();
      c.rect(142, 14, 100, 11);
      c.clip();
      const msg = liveNow.marquee || def.short;
      const wTxt = textWidth(msg, 1) + 40;
      const off = (t * 22) % wTxt;
      neonText(c, msg, 242 - off, 17, th.accent, 1, 'left');
      neonText(c, msg, 242 - off + wTxt, 17, th.accent, 1, 'left');
      c.restore();
      // Traffic past the window
      const p = (t * 0.06) % 1;
      R(c, '#e0e8ff', 168 + p * 60 - 5, 60 + Math.sin(p * 3) * 4, 2, 1);
      if (Math.sin(t * 9) > 0) R(c, '#ff4030', 168 + p * 60 - 6, 60 + Math.sin(p * 3) * 4, 1, 1);
      // Welding flicker in the workshop
      if (Math.sin(t * 13) + Math.sin(t * 7.3) > 1.2) glow(c, W - 30, 120, 26, '#a0d0ff', 0.5);
      // Neon buzz
      if (Math.sin(t * 31) > 0.97) R(c, 'rgba(0,0,0,0.25)', 82, 56, 34, 14);
    },
  };
}

function vendorCart(ctx, th, x, y) {
  // Awning
  for (let i = 0; i < 6; i++) R(ctx, i % 2 ? th.accent : '#e8e0d0', x - 30 + i * 10, y - 72, 10, 8);
  for (let i = 0; i < 6; i++) R(ctx, i % 2 ? dk(th.accent, 0.2) : '#c8c0b0', x - 30 + i * 10, y - 64, 10, 3);
  R(ctx, '#2a2a2a', x - 28, y - 61, 2, 35);
  R(ctx, '#2a2a2a', x + 26, y - 61, 2, 35);
  // Counter with goods
  R(ctx, dk(th.wood, 0.1), x - 30, y - 26, 60, 22);
  R(ctx, lt(th.wood, 0.2), x - 30, y - 26, 60, 2);
  R(ctx, dk(th.wood, 0.4), x - 30, y - 6, 60, 2);
  for (let i = 0; i < 5; i++) {
    const c = ['#c04030', '#40a0c0', '#d0c040', '#60c060', '#a060c0'][i];
    R(ctx, c, x - 26 + i * 11, y - 31, 7, 5);
    R(ctx, lt(c, 0.4), x - 26 + i * 11, y - 31, 7, 1);
  }
  ellipse(ctx, '#1a1a1a', x - 22, y - 3, 4, 4);
  ellipse(ctx, '#1a1a1a', x + 22, y - 3, 4, 4);
  ellipse(ctx, '#6a6a6a', x - 22, y - 3, 1.5, 1.5);
  ellipse(ctx, '#6a6a6a', x + 22, y - 3, 1.5, 1.5);
  pixText(ctx, 'RESTPOSTEN', x, y - 19, '#f0e0b0', 1, 'center');
}

function buildBar(ctx, th, def) {
  const box = { bx0: 34, by0: 26, bx1: 350, by1: 120 };
  const dim = { ...th, light: mix(th.light, '#ff9a50', 0.35), wall: dk(th.wall, 0.35), wall2: dk(th.wall2, 0.4), floor: dk(th.floor, 0.3), floor2: dk(th.floor2, 0.35), ceil: dk(th.ceil, 0.4) };
  roomBox(ctx, dim, box, { panels: 28, lights: 0 });
  const hotspots = [];
  // Bar name in big neon
  const name = BAR_NAMES[def.name] || 'Bar';
  R(ctx, '#08060a', 60, 32, 180, 22);
  neonText(ctx, name, 150, 37, th.neon, 2, 'center');
  // Shelves of bottles behind the counter
  const r = rng(hashStr(def.name) + 5);
  for (let row = 0; row < 3; row++) {
    const y = 64 + row * 16;
    R(ctx, dk(th.wood, 0.2), 52, y + 12, 196, 2);
    R(ctx, lt(th.wood, 0.1), 52, y + 12, 196, 1);
    for (let x = 56; x < 244; x += 5 + Math.floor(r() * 3)) {
      const c = ['#3a7a3a', '#8a3a1a', '#c0a040', '#4a3a8a', '#a0c0c0', '#6a1a1a', '#d0d0a0'][Math.floor(r() * 7)];
      const h = 7 + Math.floor(r() * 5);
      R(ctx, c, x, y + 12 - h, 3, h);
      R(ctx, dk(c, 0.3), x + 1, y + 12 - h - 2, 1, 2);
      R(ctx, lt(c, 0.6), x, y + 12 - h + 1, 1, 2);
    }
  }
  // Mirror strip glow behind bottles
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = vgrad(ctx, 0, 60, 0, 112, [[0, rgba(th.neon, 0.05)], [1, rgba(th.neon, 0.16)]]);
  ctx.fillRect(52, 60, 196, 52);
  ctx.restore();
  // News screen on the right wall area of the back wall
  R(ctx, '#1a1a1a', 262, 50, 64, 40);
  R(ctx, '#04140a', 265, 53, 58, 34);
  hotspots.push({ id: 'news', label: 'Nachrichten-Bildschirm', rect: [262, 50, 64, 40] });
  // Booth on the right
  R(ctx, dk('#6a1a2a', 0.2), 318, 110, 66, 50);
  R(ctx, '#7a2a3a', 318, 110, 66, 4);
  for (let i = 0; i < 4; i++) R(ctx, dk('#6a1a2a', 0.4), 322 + i * 16, 116, 1, 40);
  // Jukebox at the left
  R(ctx, '#3a2a1a', 6, 112, 26, 50);
  ellipse(ctx, '#3a2a1a', 19, 112, 13, 9);
  R(ctx, '#1a1008', 10, 128, 18, 12);
  // Exit door on the left wall
  const exit = sideDoor(ctx, dim, box, -1, 0.38, 0.8, 'LOBBY');
  hotspots.push({ id: 'lobby', label: 'Zurück in die Lobby', poly: exit });
  // Lamp cones (drawn live in over())
  const counter = (c) => {
    // Counter top and front, in front of the bartender
    c.fillStyle = vgrad(c, 0, 124, 0, 160, [[0, lt(th.wood, 0.1)], [1, dk(th.wood, 0.45)]]);
    c.fillRect(40, 126, 222, 34);
    R(c, lt(th.wood, 0.35), 36, 122, 230, 4);
    R(c, dk(th.wood, 0.5), 36, 126, 230, 1);
    for (let x = 52; x < 262; x += 24) R(c, dk(th.wood, 0.3), x, 130, 1, 28);
    c.save();
    c.globalCompositeOperation = 'lighter';
    R(c, rgba(th.neon, 0.5), 40, 158, 222, 1);
    c.restore();
    // Glasses
    [[96, 118], [166, 119], [210, 118]].forEach(([gx, gy]) => { R(c, 'rgba(200,230,255,0.5)', gx, gy, 3, 4); R(c, '#d8a040', gx, gy + 2, 3, 2); });
    // Stools
    [70, 120, 170, 220].forEach((sx) => { R(c, '#2a2a2a', sx - 1, 168, 2, 18); ellipse(c, '#8a2a2a', sx, 166, 8, 3); ellipse(c, '#1a1a1a', sx, 186, 6, 2); });
  };
  const table = (tx, ty) => (c) => {
    ellipse(c, dk(th.wood, 0.3), tx, ty, 22, 6);
    ellipse(c, lt(th.wood, 0.1), tx, ty - 1, 22, 5);
    R(c, '#1a1a1a', tx - 2, ty + 4, 4, 22);
    ellipse(c, '#121212', tx, ty + 26, 10, 3);
    R(c, 'rgba(200,230,255,0.55)', tx + 6, ty - 6, 3, 4);
    R(c, '#c08030', tx + 6, ty - 4, 3, 2);
  };
  const slots = {
    bartender: { x: 150, y: 168, h: 82, pose: { wipe: true }, front: counter },
    stand1: { x: 276, y: 176, h: 70, pose: { drink: true } },
    seat1: { x: 300, y: 164, h: 74, seated: true, pose: { seated: true }, front: table(300, 168) },
    seat2: { x: 352, y: 174, h: 76, seated: true, pose: { seated: true, drink: true }, front: table(346, 182) },
    stand2: { x: 62, y: 200, h: 78 },
  };
  return {
    box,
    hotspots,
    slots,
    fx(c, t, liveNow) {
      // News ticker on the screen
      c.save();
      c.beginPath();
      c.rect(265, 53, 58, 34);
      c.clip();
      const lines = liveNow.news || ['KEINE MELDUNGEN'];
      const msg = lines.join('  +++  ');
      const wTxt = textWidth(msg) + 30;
      const off = (t * 18) % wTxt;
      pixText(c, msg, 323 - off, 76, '#5cff7a');
      pixText(c, 'SOLNET', 268, 56, '#ffb000');
      pixText(c, 'LIVE', 320, 56, Math.sin(t * 3) > 0 ? '#ff4030' : '#5a1a10', 1, 'right');
      R(c, '#5cff7a', 268, 63, 52, 1);
      // A newsreader on the screen
      R(c, '#0a3a1a', 268, 64, 52, 9);
      R(c, '#3aaa5a', 290, 66, 6, 4);
      R(c, '#2a8a4a', 287, 70, 12, 3);
      if (Math.sin(t * 14) > 0) R(c, '#0a3a1a', 292, 69, 2, 1);
      c.restore();
      // Jukebox lights
      for (let i = 0; i < 5; i++) {
        const on = Math.sin(t * 4 + i * 1.3) > 0;
        R(c, on ? ['#ff4060', '#ffd040', '#40e0ff', '#60ff60', '#ff60ff'][i] : '#2a1a1a', 9 + i * 4, 116, 3, 3);
      }
      glow(c, 19, 125, 20, '#ff6040', 0.15 + Math.sin(t * 4) * 0.05);
      // Neon flicker on the sign
      if (Math.sin(t * 23) > 0.96) R(c, 'rgba(0,0,0,0.5)', 120, 34, 70, 18);
    },
    over(c, t) {
      // Lamp cones over the tables and the counter, and drifting smoke
      [[150, 26], [300, 26], [350, 26]].forEach(([x, y], i) => {
        R(c, '#1a1a1a', x, 0, 1, y);
        R(c, '#3a3028', x - 5, y, 11, 4);
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = vgrad(c, 0, y, 0, y + 150, [[0, rgba(dim.light, 0.22)], [1, rgba(dim.light, 0)]]);
        poly(c, c.fillStyle, [[x - 4, y + 4], [x + 4, y + 4], [x + 40, y + 150], [x - 40, y + 150]]);
        c.restore();
        void i;
      });
      for (let i = 0; i < 6; i++) {
        const sx = ((t * (4 + i) + i * 70) % (W + 80)) - 40;
        const sy = 70 + i * 14 + Math.sin(t * 0.3 + i) * 8;
        ellipse(c, 'rgba(200,190,180,0.035)', sx, sy, 40, 10);
      }
    },
  };
}

function buildExchange(ctx, th) {
  const box = { bx0: 56, by0: 30, bx1: 328, by1: 126 };
  roomBox(ctx, th, box, { panels: 24, lights: 3 });
  const hotspots = [];
  // Price board across the back wall
  R(ctx, '#121212', 70, 38, 244, 40);
  R(ctx, '#050505', 73, 41, 238, 34);
  hotspots.push({ id: 'panel', label: 'Kurstafel · Handel', rect: [70, 38, 244, 40] });
  // Containers stacked on the right
  crate(ctx, 250, 96, 40, 28, '#8a5a2a', 'TECH');
  crate(ctx, 292, 98, 34, 26, '#3a6a7a', 'MED');
  crate(ctx, 266, 76, 34, 20, '#6a6a3a', 'FOOD');
  crate(ctx, 330, 140, 50, 40, '#5a3a5a', 'LUX');
  crate(ctx, 300, 160, 30, 24, '#7a4a2a');
  // Loader crane
  R(ctx, '#e0a020', 236, 26, 4, 70);
  R(ctx, '#e0a020', 236, 26, 100, 4);
  R(ctx, '#2a2a2a', 320, 30, 1, 30);
  R(ctx, '#e0a020', 316, 60, 9, 4);
  hazardBand(ctx, 56, H - 10, 160, 6);
  const exit = sideDoor(ctx, th, box, -1, 0.42, 0.82, 'LOBBY');
  hotspots.push({ id: 'lobby', label: 'Zurück in die Lobby', poly: exit });
  const counter = (c) => {
    c.fillStyle = vgrad(c, 0, 140, 0, 176, [[0, lt(th.trim, 0.1)], [1, dk(th.trim, 0.55)]]);
    c.fillRect(46, 142, 140, 36);
    R(c, lt(th.trim, 0.4), 42, 138, 148, 4);
    R(c, '#1a1a1a', 42, 142, 148, 1);
    // Terminal on the counter
    R(c, '#1a1a1a', 132, 120, 30, 20);
    R(c, '#04140a', 134, 122, 26, 15);
    for (let i = 0; i < 4; i++) R(c, rgba('#5cff7a', 0.7), 136, 124 + i * 3, 10 + ((i * 7) % 12), 1);
    // Scales and a sample crate
    crate(c, 60, 124, 18, 14, '#7a5a2a');
  };
  return {
    box,
    hotspots,
    slots: { trader: { x: 100, y: 176, h: 92, pose: {}, front: counter } },
    fx(c, t, liveNow) {
      const rows = liveNow.ticker || [];
      for (let i = 0; i < Math.min(4, rows.length); i++) {
        const row = rows[(i + Math.floor(t / 4)) % rows.length];
        const flick = Math.sin(t * 40 + i) > 0.98 ? 0.4 : 1;
        pixText(c, row.name, 78, 45 + i * 8, rgba('#ffb000', flick));
        pixText(c, row.price, 230, 45 + i * 8, rgba(row.up ? '#5cff7a' : '#ff6040', flick), 1, 'right');
        pixText(c, row.up ? '+' : '-', 238, 45 + i * 8, rgba(row.up ? '#5cff7a' : '#ff6040', flick));
        pixText(c, row.stock, 306, 45 + i * 8, rgba('#a0a0a0', flick), 1, 'right');
      }
      // Crane hook sway
      const sx = 320 + Math.sin(t * 0.8) * 2;
      R(c, '#2a2a2a', sx, 64, 1, 8);
      R(c, '#8a8a8a', sx - 2, 72, 5, 2);
    },
  };
}

function buildWorkshop(ctx, th) {
  const box = { bx0: 44, by0: 18, bx1: 340, by1: 116 };
  const ind = { ...th, wall: mix(th.wall, '#5a5a5a', 0.4), wall2: mix(th.wall2, '#2a2a2a', 0.4) };
  roomBox(ctx, ind, box, { panels: 30, lights: 4 });
  const hotspots = [];
  // Gantry crane
  R(ctx, '#d09020', 0, 30, W, 6);
  R(ctx, '#8a5a10', 0, 36, W, 2);
  for (let x = 0; x < W; x += 12) line(ctx, '#8a5a10', x, 30, x + 6, 36);
  // Tool wall
  R(ctx, '#2a2a2a', 200, 50, 120, 50);
  for (let i = 0; i < 12; i++) {
    const x = 206 + i * 9;
    R(ctx, '#8a8a8a', x, 56 + (i % 3) * 2, 2, 12 + (i % 4) * 3);
    R(ctx, i % 2 ? '#c04020' : '#606060', x - 1, 54 + (i % 3) * 2, 4, 3);
  }
  R(ctx, '#3a3a3a', 200, 80, 120, 3);
  for (let i = 0; i < 6; i++) crate(ctx, 206 + i * 19, 84, 15, 12, ['#a03020', '#3a3a6a', '#6a6a2a'][i % 3]);
  // Lift platform under the ship
  R(ctx, '#2a2a2a', 10, 172, 190, 8);
  hazardBand(ctx, 10, 172, 190, 4);
  R(ctx, '#1a1a1a', 30, 180, 6, 30);
  R(ctx, '#1a1a1a', 170, 180, 6, 30);
  // Welding cart
  R(ctx, '#4a3a2a', 214, 170, 30, 18);
  ellipse(ctx, '#2a2a2a', 218, 190, 4, 4);
  ellipse(ctx, '#2a2a2a', 240, 190, 4, 4);
  R(ctx, '#80a040', 218, 156, 8, 14);
  R(ctx, '#a04040', 230, 158, 8, 12);
  const exit = sideDoor(ctx, ind, box, 1, 0.5, 0.86, 'LOBBY');
  hotspots.push({ id: 'lobby', label: 'Zurück in die Lobby', poly: exit });
  hotspots.push({ id: 'panel', label: 'Dein Schiff · Reparatur und Ausbau', rect: [10, 110, 190, 70] });
  return {
    box,
    hotspots,
    slots: { mechanic: { x: 150, y: 198, h: 86, pose: {} } },
    fx(c, t, liveNow) {
      drawShipSide(c, 104, 150, 170, t, { hull: liveNow.hull || '#8a8c90', glowOn: false });
      // Sparks where the mechanic welds
      const on = Math.sin(t * 5) > -0.2;
      if (on) {
        glow(c, 128, 156, 22, '#a0d0ff', 0.6);
        const r = rng(Math.floor(t * 20));
        for (let i = 0; i < 8; i++) {
          const a = r() * Math.PI, l = 3 + r() * 10;
          R(c, r() < 0.5 ? '#fff8c0' : '#ffb040', 128 + Math.cos(a) * l, 156 + Math.sin(a) * l * 0.8, 1, 1);
        }
      }
      // Crane trolley
      const tx = 120 + Math.sin(t * 0.2) * 60;
      R(c, '#3a3a3a', tx - 6, 36, 12, 6);
      R(c, '#1a1a1a', tx, 42, 1, 26);
      R(c, '#8a8a8a', tx - 3, 68, 7, 3);
    },
  };
}

function buildMissions(ctx, th, def) {
  const box = { bx0: 60, by0: 30, bx1: 324, by1: 122 };
  const pirate = def.faction === 'pirate' || def.blackMarket;
  roomBox(ctx, th, box, { panels: 22, lights: 2 });
  const hotspots = [];
  if (pirate) {
    // A cork board full of notes and wanted posters
    R(ctx, '#6a4a2a', 70, 42, 150, 64);
    const r = rng(7);
    for (let i = 0; i < 16; i++) {
      const x = 74 + r() * 130, y = 46 + r() * 46;
      R(ctx, r() < 0.3 ? '#e8d8b0' : '#d0c8a8', x, y, 12 + r() * 8, 10 + r() * 6);
      R(ctx, '#c02010', x + 5, y + 1, 2, 2);
    }
  } else {
    // A wall of job screens
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
      R(ctx, '#1a1a1a', 70 + i * 38, 40 + j * 24, 34, 20);
      R(ctx, '#03120a', 72 + i * 38, 42 + j * 24, 30, 16);
    }
  }
  hotspots.push({ id: 'panel', label: pirate ? 'Auftragsbrett' : 'Auftragsliste', rect: [70, 40, 150, 70] });
  // Star chart on the right
  R(ctx, '#0a0a12', 232, 40, 80, 70);
  ctx.strokeStyle = rgba(th.neon, 0.4);
  [10, 18, 26, 34].forEach((rad) => { ctx.beginPath(); ctx.arc(272, 75, rad, 0, Math.PI * 2); ctx.stroke(); });
  ellipse(ctx, '#ffd060', 272, 75, 3, 3);
  // Filing cabinets
  for (let i = 0; i < 3; i++) { R(ctx, '#4a4e52', 330 + i * 14, 120 + i * 6, 14, 60); for (let k = 0; k < 3; k++) R(ctx, '#2a2e32', 334 + i * 14, 128 + i * 6 + k * 18, 6, 2); }
  const exit = sideDoor(ctx, th, box, -1, 0.4, 0.82, 'LOBBY');
  hotspots.push({ id: 'lobby', label: 'Zurück in die Lobby', poly: exit });
  const desk = (c) => {
    c.fillStyle = vgrad(c, 0, 150, 0, 184, [[0, th.wood], [1, dk(th.wood, 0.5)]]);
    c.fillRect(40, 150, 150, 34);
    R(c, lt(th.wood, 0.3), 36, 146, 158, 4);
    R(c, '#1a1a1a', 120, 126, 34, 20);
    R(c, '#03120a', 122, 128, 30, 16);
    R(c, '#d8d0c0', 60, 140, 20, 6);
    R(c, '#c8c0b0', 62, 138, 20, 6);
    R(c, '#2a2a2a', 160, 140, 8, 6);
  };
  return {
    box,
    hotspots,
    slots: { clerk: { x: 92, y: 182, h: 90, pose: {}, front: desk }, visitor: { x: 214, y: 196, h: 84 } },
    fx(c, t) {
      if (!pirate) {
        for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
          const k = j * 4 + i;
          const on = Math.sin(t * 0.7 + k * 1.7) > -0.6;
          if (!on) continue;
          for (let l = 0; l < 3; l++) R(c, rgba(k % 3 ? '#5cff7a' : '#ffb000', 0.75), 74 + i * 38, 45 + j * 24 + l * 4, 8 + ((k * 5 + l * 9) % 18), 1);
        }
      }
      // Blips on the star chart
      for (let i = 0; i < 5; i++) {
        const a = t * (0.2 + i * 0.07) + i;
        const rad = 10 + i * 6;
        R(c, i === 2 ? '#ff4030' : '#5cff7a', 272 + Math.cos(a) * rad, 75 + Math.sin(a) * rad * 0.9, 1, 1);
      }
      // Screen on the desk
      for (let i = 0; i < 4; i++) R(c, rgba('#5cff7a', 0.6), 124, 130 + i * 3, 6 + ((i * 7 + Math.floor(t * 2)) % 20), 1);
    },
  };
}

function buildOffice(ctx, th, def) {
  const pirate = def.faction === 'pirate' || def.blackMarket;
  const box = { bx0: 64, by0: 30, bx1: 320, by1: 124 };
  const room = pirate ? { ...th, wall: dk(th.wall, 0.5), wall2: dk(th.wall2, 0.5), floor: dk(th.floor, 0.4), floor2: dk(th.floor2, 0.45), ceil: '#060404', light: '#ffb060' } : { ...th, wall: mix(th.wall, '#6a7a90', 0.4) };
  roomBox(ctx, room, box, { panels: 26, lights: pirate ? 0 : 2 });
  const hotspots = [];
  if (pirate) {
    // Weapons on the wall, crates of contraband
    for (let i = 0; i < 4; i++) { R(ctx, '#2a2a2a', 90 + i * 30, 58 + (i % 2) * 6, 24, 4); R(ctx, '#5a3a20', 90 + i * 30, 62 + (i % 2) * 6, 6, 4); }
    crate(ctx, 230, 96, 40, 28, '#3a2a1a', 'ARMS');
    crate(ctx, 270, 100, 30, 24, '#2a3a1a', 'STIM');
    crate(ctx, 246, 74, 30, 22, '#3a2a1a');
    // Skull painted on the wall
    icon(ctx, 'skull', 180, 52, '#a02010', 3);
  } else {
    // SOLPOL emblem, flags, a window with blinds
    ellipse(ctx, '#0e1a3a', 104, 58, 21, 21);
    ellipse(ctx, '#1a2a5a', 104, 58, 19, 19);
    ellipse(ctx, '#2a4a9a', 104, 58, 16, 16);
    icon(ctx, 'star', 100, 47, '#f0d070', 1);
    pixText(ctx, 'SOLPOL', 104, 62, '#f0d070', 1, 'center');
    glow(ctx, 104, 58, 34, '#6aa0ff', 0.12);
    [[66, '#2a4a9a'], [140, '#2a4a9a']].forEach(([x, c]) => { R(ctx, '#8a8a8a', x, 40, 1, 76); ellipse(ctx, '#c8a040', x, 40, 1.5, 1.5); R(ctx, c, x + 1, 42, 14, 22); R(ctx, '#f0d070', x + 1, 50, 14, 2); R(ctx, dk(c, 0.3), x + 11, 42, 4, 22); });
    // Wanted posters
    [[176, 50], [196, 54]].forEach(([x, y], i) => { R(ctx, '#d8d0b8', x, y, 14, 18); R(ctx, '#3a3a3a', x + 4, y + 3, 6, 7); pixText(ctx, i ? '5K' : '3K', x + 7, y + 12, '#a02010', 1, 'center'); });
    R(ctx, dk(th.trim, 0.3), 262, 46, 48, 40);
    R(ctx, '#0a1020', 264, 48, 44, 36);
    for (let y = 50; y < 84; y += 3) R(ctx, '#6a7a8a', 264, y, 44, 1);
    // Holding cell bars on the right wall
    for (let k = 0; k < 7; k++) {
      const a = wallPt(box, 1, 0.3 + k * 0.08, 0.25), b = wallPt(box, 1, 0.3 + k * 0.08, 1);
      line(ctx, '#6a6a6a', a[0], a[1], b[0], b[1], 2);
    }
  }
  const exit = sideDoor(ctx, room, box, -1, 0.42, 0.82, 'LOBBY');
  hotspots.push({ id: 'lobby', label: 'Zurück in die Lobby', poly: exit });
  hotspots.push({ id: 'panel', label: pirate ? 'Geschäfte · Akte löschen' : 'Schalter · Bußgelder und Kredit', rect: [40, 120, 160, 60] });
  const desk = (c) => {
    if (pirate) {
      crate(c, 60, 150, 110, 34, '#3a2a1a');
      R(c, '#c8b060', 80, 144, 14, 6);
      R(c, '#c8b060', 82, 140, 14, 4);
      R(c, '#2a2a2a', 130, 146, 18, 4);
    } else {
      c.fillStyle = vgrad(c, 0, 148, 0, 184, [[0, '#4a4e58'], [1, '#22252c']]);
      c.fillRect(44, 150, 150, 34);
      R(c, '#6a707c', 40, 146, 158, 4);
      R(c, '#1a1a1a', 140, 124, 34, 22);
      R(c, '#04101e', 142, 126, 30, 18);
      R(c, '#d8d0c0', 70, 140, 18, 6);
    }
  };
  return {
    box,
    hotspots,
    slots: { officer: { x: 104, y: pirate ? 158 : 180, h: 92, pose: pirate ? { seated: true } : {}, seated: pirate, front: desk }, visitor: { x: 226, y: 198, h: 84 } },
    fx(c, t) {
      if (!pirate) for (let i = 0; i < 4; i++) R(c, rgba('#4fd8ff', 0.6), 144, 129 + i * 3, 6 + ((i * 7 + Math.floor(t * 2)) % 20), 1);
    },
    over(c, t) {
      if (pirate) {
        // One swinging lamp over the desk
        const sw = Math.sin(t * 0.9) * 6;
        line(c, '#1a1a1a', 110, 0, 110 + sw, 60);
        R(c, '#3a3028', 104 + sw, 60, 13, 5);
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = vgrad(c, 0, 64, 0, 200, [[0, 'rgba(255,170,90,0.3)'], [1, 'rgba(255,170,90,0)']]);
        poly(c, c.fillStyle, [[106 + sw, 64], [116 + sw, 64], [170 + sw * 2, 200], [50 + sw * 2, 200]]);
        c.restore();
        for (let i = 0; i < 4; i++) ellipse(c, 'rgba(200,190,180,0.04)', ((t * 3 + i * 90) % (W + 60)) - 30, 90 + i * 20, 40, 9);
      }
    },
  };
}

function buildHangar(ctx, th, def) {
  const box = { bx0: 40, by0: 14, bx1: 344, by1: 118 };
  const ind = { ...th, wall: mix(th.wall, '#4a4e54', 0.5), wall2: mix(th.wall2, '#22252a', 0.5) };
  roomBox(ctx, ind, box, { panels: 38, lights: 4 });
  const hotspots = [];
  // Open bay door in the back wall with space beyond
  R(ctx, '#2a2a2a', 90, 24, 204, 88);
  R(ctx, '#03040a', 96, 28, 192, 80);
  ctx.save();
  ctx.beginPath();
  ctx.rect(96, 28, 192, 80);
  ctx.clip();
  stars(ctx, 96, 28, 192, 80, hashStr(def.name) + 9, 140);
  if (th.planet) planetDisc(ctx, 250, 140, 90, th.planet);
  else asteroidsView(ctx, 96, 28, 192, 80, 31);
  ctx.restore();
  hazardBand(ctx, 90, 18, 204, 6);
  hazardBand(ctx, 90, 112, 204, 4);
  // Landing pad markings
  ctx.save();
  ctx.strokeStyle = 'rgba(232,176,32,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(192, 182, 120, 22, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  pixText(ctx, 'PAD 3', 192, 200, 'rgba(232,176,32,0.7)', 2, 'center');
  // Fuel line and gantry
  R(ctx, '#3a3a3a', 330, 60, 8, 140);
  R(ctx, '#5a5a5a', 330, 60, 2, 140);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(330, 150);
  ctx.quadraticCurveTo(300, 200, 270, 170);
  ctx.stroke();
  const exit = sideDoor(ctx, ind, box, -1, 0.42, 0.82, 'LOBBY');
  hotspots.push({ id: 'lobby', label: 'Zurück in die Lobby', poly: exit });
  hotspots.push({ id: 'launch', label: 'Einsteigen und starten', rect: [96, 116, 200, 76] });
  return {
    box,
    hotspots,
    slots: { deckhand: { x: 316, y: 204, h: 80, pose: { wave: true } } },
    fx(c, t, liveNow) {
      // Force field shimmer across the bay
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let y = 28; y < 108; y += 3) R(c, rgba('#60b0ff', 0.03 + 0.03 * Math.sin(t * 2 + y * 0.3)), 96, y, 192, 1);
      c.restore();
      drawShipSide(c, 192, 160, 190, t, { hull: liveNow.hull || '#8a8c90' });
      // Gantry warning lights
      const on = Math.sin(t * 4) > 0;
      [[96, 22], [288, 22]].forEach(([x, y]) => {
        R(c, on ? '#ff8020' : '#4a2a10', x - 1, y - 1, 3, 3);
        if (on) glow(c, x, y, 12, '#ff8020', 0.5);
      });
    },
  };
}
