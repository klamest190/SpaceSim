// A rival: Dragan Kral, "der Geier", a bounty hunter the Aschebund has put on the SOL 4471 after the pilot
// started making trouble. He turns up out of nowhere every so often, a little better armed each time, and runs
// before he dies. The third time there is no running: you finish him, or let him go.

const ROUNDS = [
  { comp: ['jackal', 'crow', 'crow'], level: 1.15, hello: 'Du bist also der Frachterpilot, über den alle reden. Ich bin Kral. Man nennt mich den Geier. Wir zwei werden uns oft sehen.', bye: 'Nicht schlecht, Frachter! Das nächste Mal bringe ich mehr mit.' },
  { comp: ['brute', 'jackal', 'crow'], level: 1.3, hello: 'Da bist du ja wieder. Ich habe aufgerüstet. Du hoffentlich auch, sonst wird das peinlich.', bye: 'Verdammt! Schon wieder! Na warte, Frachter. Beim dritten Mal...' },
  { comp: ['brute', 'jackal', 'jackal'], level: 1.5, hello: 'Drittes Mal, Frachter. Keine Ausflüchte, kein Abhauen. Einer von uns fliegt heute nicht nach Hause.', bye: null },
];
const FIRST_DELAY = 420;      // seconds of flying after Act I reaches the Elster chapter
const BETWEEN = [600, 900];

export class Rival {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.round = 0;
    this.timer = FIRST_DELAY;
    this.active = null;
    this.done = false;
  }

  toSave() {
    return { round: this.round, timer: Math.round(this.timer), done: this.done };
  }

  load(s) {
    if (!s) return;
    this.round = s.round || 0;
    this.timer = s.timer || FIRST_DELAY;
    this.done = !!s.done;
  }

  update(dt) {
    const g = this.game;
    const { ship, missions } = g;
    if (this.done) return;
    if (this.active) { this.watch(); return; }
    if (!missions.done.includes('notruf')) return;
    if (ship.isDocked || ship.isWarping || ship.isDestroyed || missions.isScripted() || g.ui.tutorial.active || g.surface.active) return;
    if (g.encounters.hail || g.encounters.scan || g.hostilesNear(2500)) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    // He likes the dark: only where SOLPOL is thin
    if (g.solarSystem.securityAt(ship.position) > 0.6) { this.timer = 60; return; }
    this.spawn();
  }

  spawn() {
    const g = this.game;
    const r = ROUNDS[this.round];
    const at = g.encounters.spawnPoint(520, 700);
    const w = g.encounters.spawnPirates(at, r.comp, { level: r.level, lookAt: g.ship.position });
    w.group.aggro = true;
    w.leader.name = `${w.leader.spec.label.toUpperCase()} DER GEIER`;
    w.leader.fearless = true;
    w.leader.bounty = [2500, 5000, 12000][this.round];
    w.leader.rival = true;
    w.ships.forEach((p) => p.attack(g.ship));
    this.active = { leader: w.leader, wing: w, asked: false, gone: false };
    g.comm.say(r.hello, this.talk({ urgent: true, duration: 8000 }));
  }

  talk(extra = {}) {
    return { speaker: 'Dragan Kral, der Geier', faction: 'pirate', seed: 6666, ...extra };
  }

  watch() {
    const g = this.game;
    const a = this.active;
    const k = a.leader;
    if (!k.alive) {
      // Shot down before he could run (or after the last talk)
      this.active = null;
      if (this.round >= 2) {
        this.done = true;
        g.story.set('geier_tot');
        g.story.log('Dragan Kral, der Geier, ist tot.');
        g.story.news('SOLNET: Kopfgeldjäger „der Geier" bei einem Gefecht getötet. Auf Triton wird gefeiert.');
      } else if (!a.gone) {
        // Killed early: the Aschebund sends someone else, but it is over with Kral
        this.done = true;
        g.story.set('geier_tot');
      }
      return;
    }
    const hp = k.hull / k.maxHull;
    if (this.round < 2 && hp < 0.3 && !a.gone) {
      a.gone = true;
      g.comm.say(ROUNDS[this.round].bye, this.talk({ urgent: true, duration: 5000 }));
      a.wing.ships.forEach((s) => { if (s.alive) s.jumpOut(); });
      this.round++;
      this.timer = BETWEEN[0] + Math.random() * (BETWEEN[1] - BETWEEN[0]);
      this.active = null;
      g.story.gain('flug', 60);
      g.story.log(`Der Geier ist mir zum ${this.round}. Mal entkommen.`);
      g.saveProgress();
      return;
    }
    if (this.round >= 2 && hp < 0.25 && !a.asked) {
      a.asked = true;
      g.comm.ask('Na gut. Na gut! Du bist besser. Lass mich ziehen, und du hörst nie wieder von mir. Mein Wort drauf, und das ist mehr wert, als du denkst.', [
        { label: 'Verschwinde, Kral.', run: () => {
          this.done = true;
          this.active = null;
          a.wing.ships.forEach((s) => { if (s.alive) { s.guns = null; s.wing.truce = true; s.wing.aggro = false; s.aggro = false; s.jumpOut(); } });
          g.story.set('geier_verschont');
          g.story.stats.spared++;
          g.story.gain('reden', 40);
          g.story.log('Den Geier laufen lassen. Er hat sein Wort gegeben.');
          g.comm.say('Ich vergesse das nicht, Frachter. Wirklich nicht.', this.talk({ urgent: true, duration: 5000 }));
          g.saveProgress();
        } },
        { label: 'Nein. Heute endet das.', run: () => g.comm.say('Dann eben so!', this.talk({ urgent: true, duration: 3000 })) },
      ], this.talk({ timeout: 15000 }));
    }
  }
}
