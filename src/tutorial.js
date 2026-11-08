import { controls } from './controls';

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
    text: 'Unter dem Fadenkreuz steht dein Ziel. Was du anvisierst, wird erfasst, T schaltet weiter. Steht dort die Erde-Station, drücke X.',
    done: (ship, ctx) => (ship.autopilotActive && ship.targetObject?.kind === 'station') || !!ctx.dockable
  },
  {
    text: 'Du hältst vor der Station. Halte W, um heranzugleiten. Sobald die Andock-Anzeige erscheint, drücke G. Wegfliegen geht mit X, S oder der Maus.',
    done: ship => ship.isDocked
  }
];

const FINAL_TEXT = 'Willkommen im Geschäft. Anvisieren und X bringt dich überall hin, N öffnet die Navkarte, I das Logbuch. Auf jeder Station kannst du herumlaufen: In der Bar, an der Börse und im Auftragsbüro warten Leute, Geschäfte und Arbeit. Die Kreditbank findest du am SOLPOL-Schalter. Und Vorsicht: Außerhalb der Sicherheitszonen jagt der Aschebund.';
const WELCOME_BACK_TEXT = 'Flugleitung: Willkommen zurück, Pilot. Die Heimatstation ist als Ziel erfasst.';

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.step = 0;
    this.mouseTravel = 0;
    this.pendingFinal = false;
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

  // Flight control on the radio; duration in ms, or null to keep it until replaced
  say(text, duration = null) {
    this.game.comm.say(text, { speaker: this.active ? 'Flugleitung Erde' : 'Flugleitung', faction: 'control', seed: 3, duration, urgent: this.active });
  }

  onDocked() {
    if (!this.active) return;
    this.active = false;
    this.pendingFinal = true;
    this.game.saveProgress({ tutorialDone: true });
  }

  update(ship, dockable) {
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
