import { controls } from './controls';
import { spaceAudio } from './audio';

const CHARS_PER_SECOND = 45;

// Guided first flight: each step waits for the pilot to actually do the thing
const STEPS = [
  {
    text: 'Flugleitung Erde an Pilot: Bewege die Maus, um dein Schiff auszurichten.',
    done: (ship, ctx) => ctx.mouseTravel > 400
  },
  {
    text: 'Gut. Mit W gibst du Schub, mit S drosselst du bis in den Rückwärtsgang.',
    done: ship => ship.throttle > 0.25
  },
  {
    text: 'Die Erde-Station ist als Ziel erfasst. Drücke X, der Autopilot bringt dich hin.',
    done: (ship, ctx) => ship.autopilotActive || !!ctx.dockable
  },
  {
    text: 'Der Autopilot hält vor der Station. Halte W, um heranzugleiten. Sobald die Andock-Anzeige erscheint, drücke G.',
    done: ship => ship.isDocked
  }
];

const FINAL_TEXT = 'Willkommen im Geschäft. N öffnet die Navkarte: Ziel wählen, X fliegt per Autopilot hin, J springt per Warp. Mit dem Mausrad zoomst du aus dem Cockpit raus. Quantenchips und Eis bringen auf dem Mars gutes Geld.';
const WELCOME_BACK_TEXT = 'Flugleitung Erde: Willkommen zurück. Die Erde-Station ist als Ziel erfasst.';

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('comm-vdu');
    this.textEl = document.getElementById('comm-text');
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.active = false;
    this.step = 0;
    this.mouseTravel = 0;
    this.pendingFinal = false;

    this.fullText = '';
    this.revealed = 0;
    this.hideAt = null;
    this.lastTime = performance.now();
  }

  start(alreadyDone) {
    if (alreadyDone) {
      this.active = false;
      this.say(WELCOME_BACK_TEXT, 9000);
      return;
    }
    this.active = true;
    this.step = 0;
    this.mouseTravel = 0;
    this.say(STEPS[0].text);
  }

  // Show a radio message; duration in ms, or null to keep it until replaced
  say(text, duration = null) {
    this.fullText = text;
    this.revealed = this.reducedMotion ? text.length : 0;
    this.textEl.textContent = this.reducedMotion ? text : '';
    this.hideAt = duration ? performance.now() + duration : null;
    this.el.classList.remove('hidden');
    spaceAudio.playBeep();
  }

  onDocked() {
    if (!this.active) return;
    this.active = false;
    this.pendingFinal = true;
    this.el.classList.add('hidden');
    this.game.saveProgress({ tutorialDone: true });
  }

  update(ship, dockable) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // Typewriter reveal
    if (this.revealed < this.fullText.length) {
      this.revealed = Math.min(this.fullText.length, this.revealed + dt * CHARS_PER_SECOND);
      this.textEl.textContent = this.fullText.slice(0, Math.floor(this.revealed));
    }

    if (this.hideAt && now >= this.hideAt) {
      this.hideAt = null;
      this.el.classList.add('hidden');
    }

    if (this.pendingFinal && !ship.isDocked) {
      this.pendingFinal = false;
      this.say(FINAL_TEXT, 16000);
    }

    if (!this.active) return;

    if (controls.pointerLocked) {
      this.mouseTravel += Math.abs(controls.mouseDelta.x) + Math.abs(controls.mouseDelta.y);
    }

    // Jump past the furthest step the pilot has already completed (they may act ahead of the radio)
    const ctx = { mouseTravel: this.mouseTravel, dockable };
    for (let i = STEPS.length - 1; i >= this.step; i--) {
      if (STEPS[i].done(ship, ctx)) {
        this.step = i + 1;
        if (this.step < STEPS.length) this.say(STEPS[this.step].text);
        break;
      }
    }
  }
}
