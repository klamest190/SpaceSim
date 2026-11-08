import { sfx } from './sfx';
import { rng } from './shipModel';

// The comm VDU: who is talking (a little phosphor portrait, as if on a bad video link), what they say, and when
// a choice is due, what you can answer with the number keys. Urgent lines cut in, everything else queues.

const CHARS_PER_SECOND = 48;

const TINT = {
  police: ['#a8dcff', '#4a9ae0', '#183c66', '#071726'],
  pirate: ['#ffb9a0', '#e0502c', '#6a1c10', '#1c0604'],
  civil: ['#ffe7a8', '#d8a23c', '#664512', '#1a1104'],
  control: ['#c0ffcc', '#5cff7a', '#1d6a30', '#051a0c'],
};

// A face on a 32x32 grid: head, eyes, mouth, then headgear that shows the faction at a glance
export function drawPortrait(canvas, faction, seed) {
  const ctx = canvas.getContext('2d');
  const r = rng(Math.abs(seed | 0) + 1);
  for (let i = 0; i < 4; i++) r();
  const [hi, mid, lo, bg] = TINT[faction] || TINT.control;
  const N = 32;
  canvas.width = canvas.height = N;
  const rect = (c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  rect(bg, 0, 0, N, N);

  // Shoulders
  rect(lo, 3, 27, 26, 5);
  rect(lo, 6, 25, 20, 2);
  // Neck
  rect(mid, 13, 22, 6, 4);
  // Head
  const headW = 12 + Math.floor(r() * 3);
  const x0 = Math.floor((N - headW) / 2);
  rect(mid, x0, 9, headW, 14);
  rect(mid, x0 + 1, 8, headW - 2, 1);
  rect(mid, x0 + 1, 23, headW - 2, 1);
  rect(hi, x0 + 2, 10, headW - 4, 3); // lit forehead
  rect(lo, x0, 18, 1, 5);
  rect(lo, x0 + headW - 1, 18, 1, 5);
  // Eyes
  const eyeY = 14 + Math.floor(r() * 2);
  const eyeL = x0 + 2, eyeR = x0 + headW - 5;
  rect(bg, eyeL, eyeY, 3, 2);
  rect(bg, eyeR, eyeY, 3, 2);
  rect(hi, eyeL + 1, eyeY, 1, 1);
  rect(hi, eyeR + 1, eyeY, 1, 1);
  rect(lo, eyeL, eyeY - 2, 3, 1);
  rect(lo, eyeR, eyeY - 2, 3, 1);
  // Nose and mouth
  rect(lo, 15, eyeY + 2, 2, 3);
  const mouth = 4 + Math.floor(r() * 4);
  rect(lo, 16 - Math.floor(mouth / 2), eyeY + 6, mouth, 1);

  if (faction === 'police') {
    // Peaked cap with badge, headset
    rect(lo, x0 - 1, 6, headW + 2, 4);
    rect(mid, x0 - 2, 9, headW + 4, 1);
    rect(hi, 15, 6, 2, 2);
    rect(lo, x0 - 1, 15, 1, 5);
    rect(hi, x0 + 1, eyeY + 6, 2, 1);
    rect(hi, 14, 27, 4, 1); // collar badge
  } else if (faction === 'pirate') {
    // A mohawk or a bandana, an eyepatch or a scar, or all three
    const style = r();
    if (style < 0.5) {
      for (let i = 0; i < 7; i++) rect(hi, 13 + (i % 2), 2 + i, 4, 1);
    } else {
      rect(lo, x0 - 1, 6, headW + 2, 4);
      rect(hi, x0 + headW, 7, 3, 2);
    }
    if (r() < 0.6) {
      rect(bg, eyeL - 1, eyeY - 1, 5, 4);
      rect(bg, x0, eyeY - 3, headW, 1);
    }
    for (let i = 0; i < 5; i++) rect(lo, eyeR + 1 + (i % 2), eyeY + 2 + i, 1, 1); // scar
    if (r() < 0.5) rect(lo, x0 + 1, eyeY + 7, headW - 2, 3); // beard
  } else {
    // Hair, headset
    rect(lo, x0, 6, headW, 4);
    if (r() < 0.5) rect(lo, x0 - 1, 8, 2, 6);
    rect(hi, x0 - 1, 14, 1, 4);
    rect(hi, x0 - 1, eyeY + 6, 5, 1);
  }

  // Bad signal: scanlines and the odd torn row
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  for (let y = 0; y < N; y += 2) ctx.fillRect(0, y, N, 1);
  const tear = Math.floor(r() * N);
  const img = ctx.getImageData(0, tear, N, 1);
  ctx.putImageData(img, 2, tear);
}

export class Comm {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('comm-vdu');
    this.textEl = document.getElementById('comm-text');
    this.speakerEl = document.getElementById('comm-speaker');
    this.optionsEl = document.getElementById('comm-options');
    this.portrait = document.getElementById('comm-portrait');
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.current = null;
    this.queue = [];
    this.fullText = '';
    this.revealed = 0;
    this.lastTime = performance.now();
  }

  // speaker, faction, seed (portrait), duration in ms (null = stays until replaced), urgent cuts the line
  say(text, opts = {}) {
    const msg = { text, duration: 6500, ...opts };
    if (opts.duration === null) msg.duration = null;
    if (this.current && this.current.options && !msg.urgent) {
      this.queue.push(msg);
      return;
    }
    if (!this.current || msg.urgent || this.current.duration === null || this.current.shownFor > 1800) {
      this.show(msg);
    } else {
      this.queue.push(msg);
    }
  }

  // options: [{ label, run }]; answered with 1, 2, 3 or the mouse. onTimeout runs after `timeout` ms of silence.
  ask(text, options, opts = {}) {
    this.show({ text, duration: null, ...opts, options, timeout: opts.timeout || null, onTimeout: opts.onTimeout || null, urgent: true });
  }

  show(msg) {
    this.current = msg;
    msg.shownFor = 0;
    this.fullText = msg.text;
    this.revealed = this.reducedMotion ? msg.text.length : 0;
    this.textEl.textContent = this.reducedMotion ? msg.text : '';
    this.speakerEl.textContent = (msg.speaker || 'Funk').toUpperCase();
    this.el.dataset.faction = msg.faction || 'control';
    if (msg.seed === undefined) msg.seed = hashText(msg.speaker || 'funk');
    drawPortrait(this.portrait, msg.faction || 'control', msg.seed);
    this.optionsEl.replaceChildren();
    if (msg.options) {
      msg.options.forEach((option, i) => {
        const b = document.createElement('button');
        b.className = 'comm-option';
        b.textContent = `[${i + 1}] ${option.label}`;
        b.addEventListener('click', () => this.answer(i));
        this.optionsEl.appendChild(b);
      });
    }
    this.el.classList.remove('hidden');
    sfx.squelch();
  }

  get pendingQuestion() {
    return !!(this.current && this.current.options);
  }

  answer(index) {
    const msg = this.current;
    if (!msg || !msg.options || !msg.options[index]) return false;
    this.finish();
    msg.options[index].run();
    return true;
  }

  // Drop anything that belongs to a talk that has ended (the other ship died or left)
  cancelFrom(owner) {
    this.queue = this.queue.filter((m) => m.owner !== owner);
    if (this.current && this.current.owner === owner) this.finish();
  }

  finish() {
    this.current = null;
    this.optionsEl.replaceChildren();
    const next = this.queue.shift();
    if (next) this.show(next);
    else this.el.classList.add('hidden');
  }

  clear() {
    this.queue = [];
    this.current = null;
    this.el.classList.add('hidden');
  }

  update() {
    const now = performance.now();
    const dt = Math.min(100, now - this.lastTime);
    this.lastTime = now;
    const msg = this.current;
    if (!msg) return;
    msg.shownFor += dt;

    if (this.revealed < this.fullText.length) {
      this.revealed = Math.min(this.fullText.length, this.revealed + (dt / 1000) * CHARS_PER_SECOND);
      this.textEl.textContent = this.fullText.slice(0, Math.floor(this.revealed));
    }

    if (msg.options) {
      if (msg.timeout && msg.shownFor >= msg.timeout) {
        const run = msg.onTimeout;
        this.finish();
        if (run) run();
      }
    } else if (msg.duration !== null && msg.shownFor >= msg.duration) {
      this.finish();
    } else if (this.queue.length && msg.duration === null && msg.shownFor > 4000) {
      this.finish();
    }
  }
}

function hashText(text) {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}
