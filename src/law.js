import { GOODS, RANKS } from './world';
import { sfx } from './sfx';

// Crime and standing. SOLPOL keeps a wanted level, unpaid fines and a reputation; the Aschebund keeps its own opinion of you.
// wanted 0: clean. 1: fined, not hunted. 2+: patrols open fire and hunters come. 3+: no lawful station will have you.
// Nothing is a dead end: fines can be paid at any lawful station (wanted 0-1) or, for a markup,
// through a fixer on a black-market station, and a new clone starts with a clean wanted level.

const WITNESS_RANGE = 1600;
const DECAY_INTERVAL = 240; // seconds without police nearby for the wanted level to drop by one (up to level 2)
const WANTED_LABEL = ['Sauber', 'Bußgeld offen', 'Gesucht', 'Schwer gesucht', 'Staatsfeind', 'Staatsfeind Nr. 1'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Law {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.wanted = 0;
    this.fines = 0;
    this.rep = { police: 0, pirate: -20 };
    this.points = 0;
    this.kills = { pirate: 0, police: 0, civil: 0 };
    this.decayTimer = 0;
    this.warnedAt = -100;
    this.time = 0;
  }

  toSave() {
    return { wanted: this.wanted, fines: this.fines, rep: this.rep, points: this.points, kills: this.kills };
  }

  load(s) {
    if (!s) return;
    this.wanted = s.wanted || 0;
    this.fines = s.fines || 0;
    Object.assign(this.rep, s.rep);
    this.points = s.points || 0;
    Object.assign(this.kills, s.kills);
  }

  piratesHostile() {
    return this.rep.pirate < 40;
  }

  wantedLabel() {
    return WANTED_LABEL[clamp(this.wanted, 0, WANTED_LABEL.length - 1)];
  }

  rank() {
    let current = RANKS[0];
    for (const r of RANKS) if (this.points >= r.points) current = r;
    return current;
  }

  nextRank() {
    return RANKS.find((r) => r.points > this.points) || null;
  }

  repText(value) {
    if (value >= 60) return 'Verbündet';
    if (value >= 25) return 'Freundlich';
    if (value > -25) return 'Neutral';
    if (value > -60) return 'Misstrauisch';
    return 'Verhasst';
  }

  changeRep(faction, amount) {
    this.rep[faction] = clamp(this.rep[faction] + amount, -100, 100);
  }

  witnessed(npc) {
    const { game } = this;
    if (npc.faction === 'police') return true;
    if (game.solarSystem.securityAt(npc.pos) > 0.45) return true;
    return game.npcs.ships.some((s) => s.faction === 'police' && s.alive && s.pos.distanceTo(npc.pos) < WITNESS_RANGE);
  }

  raise(level, fine, message) {
    const before = this.wanted;
    this.wanted = Math.min(5, Math.max(this.wanted, level));
    this.fines += fine;
    this.decayTimer = 0;
    if (this.wanted > before) {
      sfx.siren();
      this.game.comm.say(message || `Hier SOLPOL. Ihr Status: ${this.wantedLabel().toUpperCase()}. Offene Bußgelder: ${this.fines.toLocaleString('de-DE')} Cr.`, { speaker: 'SOLPOL Zentrale', faction: 'police', duration: 7000, urgent: true });
    }
    if (this.wanted >= 2) {
      this.game.npcs.ships.forEach((s) => {
        if (s.faction === 'police' && s.guns && s.alive && s.pos.distanceTo(this.game.ship.position) < 2000) s.attack(this.game.ship);
      });
    }
    this.game.saveProgress();
  }

  // The player's guns hit a ship. Stray shots earn a warning; keeping at it is a crime.
  reportHit(npc) {
    if (npc.faction === 'pirate') return;
    this.time = performance.now() / 1000;
    npc.crimeHits++;
    if (npc.crimeHits === 1 && this.time - this.warnedAt > 6) {
      this.warnedAt = this.time;
      if (this.witnessed(npc)) {
        this.game.comm.say(npc.faction === 'police' ? 'Sie feuern auf ein Polizeischiff! Sofort einstellen!' : 'Hier SOLPOL: Feuer auf den Zivilisten einstellen! Letzte Warnung.', { speaker: 'SOLPOL Streife', faction: 'police', duration: 5000, urgent: true });
      }
    }
    if (npc.crimeHits >= 4 && this.witnessed(npc)) {
      if (npc.faction === 'police') this.raise(2, 1500);
      else this.raise(this.wanted >= 1 ? 2 : 1, 600);
      this.changeRep('police', -2);
    }
  }

  reportKill(npc) {
    const { ship, hud, missions } = this.game;
    this.kills[npc.faction] = (this.kills[npc.faction] || 0) + 1;
    this.points += npc.points;
    const seen = this.witnessed(npc);

    if (npc.faction === 'pirate') {
      this.changeRep('police', 1 + npc.points * 0.3);
      this.changeRep('pirate', -1 - npc.points * 0.4);
      if (npc.bounty > 0) {
        if (this.wanted <= 1) {
          ship.credits += npc.bounty;
          hud.toast(`Kopfgeld +${npc.bounty.toLocaleString('de-DE')} Cr`, 'gain');
          sfx.coin();
        } else {
          hud.toast('Kopfgeld gesperrt: Du wirst selbst gesucht', 'warn');
        }
      }
    } else if (npc.faction === 'police') {
      this.changeRep('police', -30);
      this.changeRep('pirate', 6);
      this.raise(Math.min(5, Math.max(3, this.wanted + 1)), 9000);
    } else {
      this.changeRep('pirate', 3);
      if (seen) {
        this.changeRep('police', -15);
        this.raise(Math.max(2, this.wanted + 1), 3500);
      } else {
        // Nobody saw it. Word still gets around, a little.
        this.changeRep('police', -3);
      }
    }

    const before = this.rankedAt;
    const rank = this.rank();
    if (before && before !== rank.name) {
      hud.toast(`Neuer Rang: ${rank.name}`, 'gain');
      sfx.coin();
    }
    this.rankedAt = rank.name;
    missions.onKill(npc);
  }

  // Police scan found contraband in the hold; the choice is the player's
  contrabandFine() {
    const { ship } = this.game;
    let fine = 0;
    Object.entries(ship.cargo).forEach(([k, n]) => {
      if (GOODS[k].contraband) fine += n * GOODS[k].base * 0.6;
    });
    return Math.round(fine);
  }

  confiscate() {
    const { ship } = this.game;
    Object.keys(ship.cargo).forEach((k) => {
      if (GOODS[k].contraband) ship.cargo[k] = 0;
    });
  }

  payFines() {
    const { ship } = this.game;
    if (ship.credits < this.fines) return false;
    ship.credits -= this.fines;
    this.fines = 0;
    this.wanted = 0;
    this.clearPoliceAggro();
    return true;
  }

  fixerPrice() {
    return Math.round(Math.max(800, this.fines * 1.5 + this.wanted * 1200));
  }

  payFixer() {
    const { ship } = this.game;
    const price = this.fixerPrice();
    if (ship.credits < price) return false;
    ship.credits -= price;
    this.fines = 0;
    this.wanted = 0;
    this.clearPoliceAggro();
    return true;
  }

  clearPoliceAggro() {
    this.game.npcs.ships.forEach((s) => {
      if (s.faction === 'police') {
        s.aggro = false;
        if (s.wing) s.wing.aggro = false;
        if (s.target === this.game.ship) s.resume();
      }
    });
  }

  // Dying as a wanted pilot: the clone wakes up under a new ID, half the fines still follow it
  onDeath() {
    this.wanted = 0;
    this.fines = Math.round(this.fines * 0.5);
    this.clearPoliceAggro();
  }

  update(dt) {
    if (this.wanted === 0 || this.wanted > 2) return;
    const { ship, npcs } = this.game;
    const copsNear = npcs.ships.some((s) => s.faction === 'police' && s.pos.distanceTo(ship.position) < 3000);
    if (copsNear) {
      this.decayTimer = 0;
      return;
    }
    this.decayTimer += dt;
    if (this.decayTimer > DECAY_INTERVAL && this.wanted === 2) {
      this.decayTimer = 0;
      this.wanted = 1;
      this.game.hud.toast('Fahndung ausgelaufen: nur noch Bußgeld', 'info');
    }
  }
}
