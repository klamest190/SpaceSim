import * as THREE from 'three';
import { PIRATE_MOUNTS } from './stationModels';
import { displayName } from './names';
import { sfx } from './sfx';

// Pirate bases out in space (the outposts in world.js; the Hades-Nest keeps to its story). Each keeps a guard wing and
// gun turrets on its rock. A stranger who comes close is warned off by radio and may turn away, pay the toll or talk
// back; whoever keeps coming, or is still inside when the countdown runs out, is fired on by the turrets and the
// guards together. Friends of the Aschebund are waved through.

const WARN_RANGE = 1500;     // the base hails strangers this close
const ATTACK_RANGE = 650;    // closer than this after the warning, the guns open up at once
const COUNTDOWN = 20;        // seconds to turn round after the warning
const SPAWN_RANGE = 2600;    // turrets are manned within this range of the ship
const DESPAWN_RANGE = 4200;
const CALM_DOWN = 60;        // seconds out of range before a base forgets a fight
const TURRET_RESPAWN = 300;  // seconds before shot-down turrets are replaced
const TOLL = 600;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const WARNINGS = [
  'Hier spricht {base}. Unbekanntes Schiff, du fliegst in unser Revier. Dreh ab, oder wir machen Schrott aus dir. {t} Sekunden.',
  '{base} an Frachter: Noch ein Stück näher und unsere Geschütze sagen Hallo. Du hast {t} Sekunden zum Umdrehen.',
  'Achtung, Eindringling. Das ist Aschebund-Gebiet. Wende, oder wir öffnen das Feuer. {t} Sekunden.',
];
const LAST_WARNINGS = ['Letzte Warnung. Zehn Sekunden.', 'Geschütze sind ausgerichtet. Zehn Sekunden, dann knallt es.', 'Ich zähle nicht noch mal. Zehn.'];
const OPEN_FIRE = ['Feuer frei! Holt ihn runter!', 'Du wolltest es nicht anders. Alle Geschütze: Feuer!', 'Ziel erfasst. Zerlegt ihn!'];
const TURNED_AWAY = ['Kluge Entscheidung. Lass dich hier nicht wieder blicken.', 'So ist brav. Und weg.', 'Na also. Flieg nach Hause, Kleiner.'];
const WELCOME = ['{base} grüßt einen Freund des Aschebunds. Landedeck ist frei.', 'Ah, du bist es. Komm rein, die Kneipe hat offen.', 'Freund erkannt. Geschütze bleiben kalt. Willkommen in {base}.'];
const TOLL_PAID = ['{toll} Credits, sauber. Du darfst andocken. Mach keinen Ärger.', 'Geld ist angekommen. Die Geschütze schauen weg, solange du dich benimmst.'];

export class PirateBases {
  constructor(game) {
    this.game = game;
    this.bases = new Map(); // station -> state
  }

  reset() {
    this.bases.forEach((b) => this.disarm(b, true));
    this.bases.clear();
  }

  // The bases' state, made the first time it is needed
  stateFor(st) {
    let b = this.bases.get(st);
    if (!b) {
      const wing = this.game.npcs.newGroup({ truce: true, base: st });
      // The turrets ride on this mount, which moves with the station (the Eisgrab orbits Uranus)
      const mount = { alive: true, pos: st.mesh.position, quat: new THREE.Quaternion(), vel: new THREE.Vector3() };
      b = { st, wing, mount, state: 'quiet', timer: 0, lastWarned: false, turrets: [], turretsDown: -Infinity, away: 0, tollPaid: false, lastPos: st.mesh.position.clone() };
      this.bases.set(st, b);
    }
    return b;
  }

  // The guard wing a pirate base's guards join (encounters.js spawns them)
  wingFor(st) {
    return this.stateFor(st).wing;
  }

  isBase(st) {
    return !!st && !!st.def.outpost && !st.hidden;
  }

  // Pilots the Aschebund lets in without a word
  friendly() {
    const { law, story, missions } = this.game;
    return !law.piratesHostile() || story.path === 'asche' || !!story.ending || missions.done.includes('nest');
  }

  // Paying the toll opens the docking clamps for this visit (see Game.dockRefusal)
  tollPaid(st) {
    const b = this.bases.get(st);
    return !!(b && b.tollPaid);
  }

  update(dt) {
    const { ship, solarSystem } = this.game;
    if (!ship || ship.isDestroyed) return;
    const flying = !ship.isDocked && !this.game.surface.active;
    solarSystem.stations.forEach((st) => {
      if (!this.isBase(st)) return;
      const b = this.stateFor(st);
      // The mount follows the station; its velocity keeps turret aim honest
      if (dt > 0) b.mount.vel.copy(st.mesh.position).sub(b.lastPos).divideScalar(dt);
      b.lastPos.copy(st.mesh.position);
      const d = st.mesh.position.distanceTo(ship.position);
      this.manTurrets(b, d);
      if (!flying) return;
      this.updateState(b, d, dt);
    });
  }

  // Turrets come and go with the ship's distance; shot-down ones are replaced after a while
  manTurrets(b, d) {
    const { npcs } = this.game;
    b.turrets = b.turrets.filter((t) => t.alive);
    if (d > DESPAWN_RANGE) {
      this.disarm(b);
      return;
    }
    if (d > SPAWN_RANGE || b.turrets.length || this.game.solarSystem.time - b.turretsDown < TURRET_RESPAWN) return;
    const r = b.st.size * 0.78;
    PIRATE_MOUNTS.forEach(([x, y, z]) => {
      const local = new THREE.Vector3(x, y, z).normalize().multiplyScalar(r).applyQuaternion(b.st.mesh.quaternion);
      const t = npcs.spawn('turret', b.st.mesh.position.clone().add(local), {
        mode: 'idle', group: b.wing, parent: b.mount, parentOffset: local, speed: 0, fearless: true,
      });
      t.home.station = b.st;
      t.baseTurret = true;
      b.turrets.push(t);
    });
  }

  // Turrets leave quietly when the ship is far away (they are not destroyed, just not simulated)
  disarm(b, all = false) {
    b.turrets.forEach((t) => { if (t.alive) this.game.npcs.remove(t); });
    b.turrets = [];
    if (all) b.state = 'quiet';
  }

  say(b, text, opts = {}) {
    this.game.comm.say(text.replace('{base}', displayName(b.st.name)).replace('{toll}', TOLL.toLocaleString('de-DE')), {
      speaker: `${displayName(b.st.name)} · Funk`, faction: 'pirate', urgent: true, duration: 7000, ...opts,
    });
  }

  updateState(b, d, dt) {
    const { ship } = this.game;
    b.wing.members = b.wing.members.filter((n) => n.alive);
    // Someone shot at the guards: the talking is over
    if (b.state !== 'hostile' && b.wing.members.some((n) => n.mode === 'attack' && n.target === ship && n.lastAttacker === ship)) {
      this.openFire(b);
      return;
    }
    if (b.state === 'quiet') {
      if (d > WARN_RANGE) return;
      if (this.friendly() || b.tollPaid) {
        b.state = 'welcome';
        this.say(b, pick(WELCOME));
        return;
      }
      b.state = 'warned';
      b.timer = COUNTDOWN;
      b.lastWarned = false;
      b.wing.truce = true;
      sfx.squelch();
      this.hail(b);
      return;
    }
    if (b.state === 'welcome') {
      // The toll buys one visit: gone from the area, it has to be paid again next time
      if (d > WARN_RANGE * 1.6) {
        b.state = 'quiet';
        b.tollPaid = false;
      }
      // Friendship can end while one is there (shots fired, a story turn): start over
      if (!this.friendly() && !b.tollPaid) b.state = 'quiet';
      return;
    }
    if (b.state === 'warned') {
      b.timer -= dt;
      if (d > WARN_RANGE * 1.25) {
        b.state = 'quiet';
        this.say(b, pick(TURNED_AWAY));
        return;
      }
      if (!b.lastWarned && b.timer <= 10) {
        b.lastWarned = true;
        this.say(b, pick(LAST_WARNINGS));
      }
      if (b.timer <= 0 || d < ATTACK_RANGE) this.openFire(b);
      return;
    }
    if (b.state === 'hostile') {
      if (d > DESPAWN_RANGE) {
        b.away += dt;
        if (b.away > CALM_DOWN) {
          b.state = 'quiet';
          b.away = 0;
          b.wing.truce = true;
          b.wing.aggro = false;
          b.wing.members.forEach((n) => { n.aggro = false; if (n.target === ship) n.resume(); });
        }
      } else {
        b.away = 0;
      }
    }
  }

  // The radio call with answers: turn away, pay, or talk back
  hail(b) {
    const { comm, ship } = this.game;
    const text = pick(WARNINGS).replace('{base}', displayName(b.st.name)).replace('{t}', String(COUNTDOWN));
    comm.ask(text, [
      { label: 'Schon gut, ich drehe ab.', run: () => { this.say(b, 'Dann mach. Die Uhr läuft trotzdem.'); } },
      {
        label: `Wegzoll zahlen (${TOLL} Cr)`,
        disabled: ship.credits < TOLL ? 'zu wenig Geld' : null,
        run: () => this.payToll(b),
      },
      { label: 'Kommt doch her, ihr Ratten.', run: () => { this.say(b, 'Mit Vergnügen.'); this.openFire(b); } },
    ], { speaker: `${displayName(b.st.name)} · Funk`, faction: 'pirate', timeout: 9000, onTimeout: () => {} });
  }

  payToll(b) {
    const { ship, hud } = this.game;
    if (b.state !== 'warned' || ship.credits < TOLL) return;
    ship.credits -= TOLL;
    hud.toast(`Wegzoll -${TOLL.toLocaleString('de-DE')} Cr`, 'bad');
    b.tollPaid = true;
    b.state = 'welcome';
    b.wing.truce = true;
    this.say(b, pick(TOLL_PAID));
  }

  // Guns and guards turn on the ship
  openFire(b) {
    if (b.state === 'hostile') return;
    const { ship, hud } = this.game;
    b.state = 'hostile';
    b.tollPaid = false;
    b.wing.truce = false;
    b.wing.aggro = true;
    this.say(b, pick(OPEN_FIRE));
    hud.toast(`${displayName(b.st.name)} eröffnet das Feuer!`, 'bad');
    b.wing.members.forEach((n) => { if (n.alive && n.guns) { n.aggro = true; n.attack(ship); } });
  }

  // Shots at the base itself (Game.onStationHit) end any talk at once
  onBaseHit(st) {
    if (!this.isBase(st)) return;
    this.openFire(this.stateFor(st));
  }

  // A turret down: remember when, so the rock is not rearmed at once
  onKilled(npc) {
    if (!npc.baseTurret || !npc.home.station) return;
    const b = this.bases.get(npc.home.station);
    if (b) b.turretsDown = this.game.solarSystem.time;
  }
}
