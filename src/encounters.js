import * as THREE from 'three';
import { GOODS, GOOD_KEYS } from './world';
import { sfx } from './sfx';
import { difficultyOf } from './difficulty';

// The director: keeps the space around the player alive. Stations get patrols and freighter traffic in
// proportion to their security; out in the dark, things happen on a timer weighted by how lawless the place is:
// pirate shakedowns, freighters under attack, skirmishes, wrecks, police scans, bounty hunters.
// Nothing is simulated far away: ships exist in a bubble around the player and vanish when left far behind.

const DESPAWN_RANGE = 9000;
const MAX_SHIPS = 26;
const TRAFFIC_INTERVAL = 7;
const FIRST_EVENT_DELAY = 70;
const MASS_LOCK_RANGE = 420;
const INTERDICTION_COOLDOWN = 200;
const HAIL_TIMEOUT = 16000;

const TAUNTS = ['Dafür wirst du bezahlen!', 'Rückzug! Alle raus hier!', 'Das war nicht das letzte Mal!', 'Der Aschebund vergisst nicht!', 'Mein Antrieb brennt! Ich hau ab!'];
const SURRENDER = ['Nicht schießen! Nimm die Ladung und lass mich ziehen!', 'Schon gut, schon gut! Ladung ist draußen!'];
const CHATTER = {
  police: ['Streife an alle: Sektor ruhig, halten Sie Abstand zu den Schifffahrtswegen.', 'SOLPOL erinnert: Waffen und Stims sind im Hoheitsgebiet verboten.', 'Hier Streife. Melden Sie verdächtige Schiffe auf dieser Frequenz.'],
  civil: ['Hier Frachter im Anflug, wer hat Kaffee an Bord?', 'Achtung, Schwerlast. Bitte Abstand halten.', 'Die Preise für Eis sind wieder ein Witz, sag ich dir.'],
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Encounters {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.trafficTimer = 2;
    this.eventTimer = FIRST_EVENT_DELAY;
    this.wantedTimer = 20;
    this.interdictionCooldown = 60;
    this.chatterTimer = 40;
    this.despawnTimer = 3;
    this.scan = null;
    this.hail = null;
    this.rescues = [];
    this.traps = [];
    this.lastDistress = -100;
  }

  // --- placement ------------------------------------------------------------------------------

  // A spot around the player, biased ahead so things appear where the pilot is looking, clear of bodies
  spawnPoint(min, max, aheadBias = 0.8) {
    const { ship, solarSystem } = this.game;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    const dir = new THREE.Vector3(rand(-1, 1), rand(-0.35, 0.35), rand(-1, 1)).normalize().addScaledVector(fwd, aheadBias).normalize();
    const pos = ship.position.clone().addScaledVector(dir, rand(min, max));
    return solarSystem.pushClear(pos, 40);
  }

  scatter(center, spread) {
    return center.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1)).multiplyScalar(spread));
  }

  danger() {
    const { ship, solarSystem } = this.game;
    return 1 - solarSystem.securityAt(ship.position);
  }

  // Tougher pirates as the pilot gets tougher, and further from the law
  pirateComp(extraBudget = 0) {
    const { ship, law } = this.game;
    const power = ship.powerLevel();
    const ranked = Math.min(1, law.points / 110);
    let budget = 1.5 + power * 7 + ranked * 4 + this.danger() * 2.5 + extraBudget;
    const comp = [];
    while (budget >= 1 && comp.length < 6) {
      if (budget >= 7 && Math.random() < 0.35 && !comp.includes('brute')) {
        comp.push('brute');
        budget -= 5;
      } else if (budget >= 3 && Math.random() < 0.55) {
        comp.push('jackal');
        budget -= 2;
      } else {
        comp.push('crow');
        budget -= 1;
      }
    }
    if (!comp.length) comp.push('crow');
    return comp.sort((a, b) => ['brute', 'jackal', 'crow'].indexOf(a) - ['brute', 'jackal', 'crow'].indexOf(b));
  }

  // Leader flies `mode`, the rest hold a V behind it
  spawnWing(types, pos, opts = {}, arrive = true) {
    const { npcs, ship } = this.game;
    const group = opts.group || npcs.newGroup({ kind: opts.kind || 'wing' });
    const spawnFn = arrive ? npcs.arrive.bind(npcs) : npcs.spawn.bind(npcs);
    const lookAt = opts.lookAt || ship.position;
    let leader = null;
    const ships = types.map((type, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const row = Math.ceil(i / 2);
      const slot = new THREE.Vector3(side * row * 14, 0, row * 12);
      const from = i === 0 ? pos : pos.clone().add(slot);
      const npc = spawnFn(type, from, {
        ...opts, group, lookAt, speed: opts.speed,
        mode: i === 0 ? opts.mode || 'patrol' : 'formation',
        leader: i === 0 ? null : leader, slot,
      });
      if (i === 0) leader = npc;
      return npc;
    });
    return { group, ships, leader };
  }

  spawnPirates(pos, comp, opts = {}) {
    return this.spawnWing(comp, pos, { kind: 'pirates', raider: true, ...opts });
  }

  // --- the update loop --------------------------------------------------------------------------

  update(dt) {
    const { ship, ui, npcs } = this.game;
    if (this.interdictionCooldown > 0) this.interdictionCooldown -= dt;
    this.updateScan(dt);
    this.updateRescues();
    this.updateTraps();

    this.despawnTimer -= dt;
    if (this.despawnTimer <= 0) {
      this.despawnTimer = 3;
      [...npcs.ships].forEach((n) => {
        if (!n.mission && n.pos.distanceTo(ship.position) > DESPAWN_RANGE) npcs.remove(n);
      });
    }

    if (ship.isDocked || ship.isDestroyed || ship.isWarping || ui.tutorial.active) return;

    this.trafficTimer -= dt;
    if (this.trafficTimer <= 0) {
      this.trafficTimer = TRAFFIC_INTERVAL;
      this.updateTraffic();
    }

    this.updateWanted(dt);

    this.chatterTimer -= dt;
    if (this.chatterTimer <= 0) {
      this.chatterTimer = rand(70, 150);
      this.chatter();
    }

    if (this.hail || this.scan) return;
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      const danger = this.danger();
      this.eventTimer = (rand(45, 85) + (1 - danger) * 60) / difficultyOf(this.game).eventRate;
      this.fireEvent(danger);
    }
  }

  updateTraffic() {
    const { ship, npcs, solarSystem } = this.game;
    const st = solarSystem.nearestStation(ship.position);
    if (!st || st.mesh.position.distanceTo(ship.position) > 2800) return;
    if (npcs.ships.length >= MAX_SHIPS) return;

    const near = (n) => n.home.station === st;
    const pirateBase = st.def.faction === 'pirate';
    const guardFaction = pirateBase ? 'pirate' : 'police';

    const wantGuards = pirateBase ? 4 : Math.round(st.security * 3.4);
    if (npcs.count((n) => near(n) && n.faction === guardFaction) < wantGuards) {
      const spot = this.aroundStation(st, 500, 900);
      const type = pirateBase ? pick(['crow', 'jackal']) : st.security > 0.7 && Math.random() < 0.2 ? 'cutter' : 'patrol';
      const npc = npcs.arrive(type, spot, { mode: 'patrol', anchor: st, patrolRadius: st.size + 450, lookAt: st.mesh.position });
      npc.home.station = st;
    }

    if (pirateBase) return;
    const wantTraffic = 1 + Math.round(st.security * 2.2);
    if (npcs.count((n) => near(n) && n.faction === 'civil') < wantTraffic) {
      const type = Math.random() < 0.7 ? 'freighter' : 'courier';
      if (Math.random() < 0.55) {
        // Arrives from afar and heads in to dock
        const spot = this.aroundStation(st, 900, 1400);
        const npc = npcs.arrive(type, spot, {
          mode: 'goto', dest: st, arriveRange: st.size + 14, lookAt: st.mesh.position,
          onArrive: (n) => npcs.remove(n),
        });
        npc.home.station = st;
      } else {
        // Leaves the station and jumps out
        const out = new THREE.Vector3(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).normalize();
        const start = st.mesh.position.clone().addScaledVector(out, st.size + 12);
        const dest = solarSystem.pushClear(start.clone().addScaledVector(out, rand(700, 1100)), 60);
        const npc = npcs.spawn(type, start, { mode: 'goto', dest, arriveRange: 30, slowArrival: false, lookAt: dest, speed: 4 });
        npc.home.station = st;
      }
    }
  }

  aroundStation(st, min, max) {
    const a = rand(0, Math.PI * 2);
    const r = rand(min, max);
    const p = st.mesh.position.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(-60, 60), Math.sin(a) * r));
    return this.game.solarSystem.pushClear(p, 40);
  }

  chatter() {
    const { npcs, comm, ship } = this.game;
    if (comm.current) return;
    const nearby = npcs.ships.filter((n) => n.faction !== 'pirate' && n.pos.distanceTo(ship.position) < 1500);
    if (!nearby.length || this.game.hostilesNear(1500)) return;
    const speaker = pick(nearby);
    comm.say(pick(CHATTER[speaker.faction]), { speaker: speaker.name, faction: speaker.faction, seed: speaker.pos.x * 7, duration: 5000 });
  }

  // Each event's weight comes from where the pilot is and what they have done
  fireEvent(danger) {
    const { law, npcs, ship } = this.game;
    if (npcs.ships.length >= MAX_SHIPS - 4) return;
    const cargoWorth = ship.getCurrentCargoWeight() > 0 ? 1 : 0.5;
    const options = [
      ['ambush', law.piratesHostile() ? danger * 3 * cargoWorth : 0],
      ['raid', 0.35 + danger * 1.3],
      ['battle', danger * 1],
      ['wreck', 0.25 + danger * 0.5],
      ['startScan', (1 - danger) * 2.2 + (law.wanted === 0 ? 0.2 : 0)],
      ['hunters', law.rep.pirate < -35 ? danger * 1 : 0],
      ['quiet', 0.6],
    ];
    const total = options.reduce((s, o) => s + o[1], 0);
    let roll = Math.random() * total;
    for (const [name, weight] of options) {
      roll -= weight;
      if (roll <= 0) {
        if (name !== 'quiet') this[name]();
        return;
      }
    }
  }

  // --- pirate shakedown -------------------------------------------------------------------------

  ambush(pos = null, extra = 0) {
    const { ship, comm } = this.game;
    const at = pos || this.spawnPoint(520, 780);
    const wing = this.spawnPirates(at, this.pirateComp(extra), { mode: 'hail' });
    wing.group.truce = true;
    wing.leader.holdRange = 190;
    this.hail = { group: wing.group, leader: wing.leader };
    const w = wing.leader;
    const seed = w.pos.x * 13;
    const talk = { speaker: w.name, faction: 'pirate', seed, owner: wing.group };

    const weight = ship.getCurrentCargoWeight();
    const demand = Math.round(Math.max(300, ship.credits * 0.12));
    const options = [];
    let line;
    if (weight > 0) {
      line = `Hübscher Frachter. Hier spricht der Aschebund. Ladung abwerfen, dann lebst du weiter.`;
      options.push({ label: 'Ladung abwerfen', run: () => this.surrenderCargo(wing, talk) });
    } else {
      line = `Leerer Bauch, voller Beutel? Hier Aschebund. ${demand.toLocaleString('de-DE')} Cr, oder du bist Schrott.`;
      if (ship.credits >= demand) options.push({ label: `${demand.toLocaleString('de-DE')} Cr zahlen`, run: () => this.payOff(wing, talk, demand) });
    }
    options.push({ label: 'Komm und hol es dir', run: () => this.startFight(wing.group, talk, 'Dann eben auf die harte Tour!') });
    sfx.klaxon();
    comm.ask(line, options, { ...talk, timeout: HAIL_TIMEOUT, onTimeout: () => this.startFight(wing.group, talk, 'Zu lange überlegt. Feuer frei!') });
    return wing;
  }

  startFight(group, talk, line) {
    const { comm, ship } = this.game;
    this.hail = null;
    group.truce = false;
    group.aggro = true;
    group.members.forEach((n) => { if (n.alive && n.guns) n.attack(ship); });
    if (line) comm.say(line, { ...talk, owner: undefined, urgent: true, duration: 3500 });
  }

  surrenderCargo(wing, talk) {
    const { ship, law, comm } = this.game;
    this.hail = null;
    const keys = GOOD_KEYS.filter((k) => ship.cargo[k] > 0).sort((a, b) => GOODS[b].base - GOODS[a].base);
    let toDrop = Math.ceil(ship.getCurrentCargoWeight() * 0.6);
    keys.forEach((k) => {
      const n = Math.min(toDrop, ship.cargo[k]);
      ship.cargo[k] -= n;
      toDrop -= n;
    });
    law.changeRep('pirate', 2);
    comm.say('Kluge Entscheidung. Flieg weiter, bevor ich es mir anders überlege.', { ...talk, owner: undefined, urgent: true, duration: 5000 });
    wing.group.members.forEach((n) => { if (n.alive) { n.mode = 'flee'; n.fleeFrom = null; n.leaving = rand(5, 8); } });
    this.game.ui.updateHUDStats();
  }

  payOff(wing, talk, amount) {
    const { ship, law, comm } = this.game;
    this.hail = null;
    ship.credits -= amount;
    law.changeRep('pirate', 2);
    comm.say('Geht doch. Bis zum nächsten Mal, Kleiner.', { ...talk, owner: undefined, urgent: true, duration: 5000 });
    wing.group.members.forEach((n) => { if (n.alive) { n.mode = 'flee'; n.fleeFrom = null; n.leaving = rand(5, 8); } });
    this.game.ui.updateHUDStats();
  }

  // --- a freighter under attack --------------------------------------------------------------------

  raid() {
    const { npcs, comm } = this.game;
    const at = this.spawnPoint(900, 1400);
    const dest = at.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).setLength(1500));
    const victim = npcs.arrive(Math.random() < 0.75 ? 'freighter' : 'courier', at, { mode: 'goto', dest, arriveRange: 40, slowArrival: false, lookAt: dest });
    const comp = this.pirateComp(-1).slice(0, 3);
    const wing = this.spawnPirates(this.scatter(at, 180), comp, { lookAt: at });
    wing.ships.forEach((p) => p.attack(victim));
    const rescue = { victim, wing: wing.ships, reward: Math.round(rand(500, 1200) + comp.length * 350), done: false };
    this.rescues.push(rescue);
    comm.ask(`Mayday, Mayday! Hier ${victim.name}, wir werden von Piraten beschossen! Wer uns hört, bitte helfen!`, [
      { label: 'Ziel aufschalten', run: () => { this.game.setTarget(victim); sfx.lockOn(); } },
      { label: 'Ignorieren', run: () => {} },
    ], { speaker: victim.name, faction: 'civil', seed: at.x, timeout: 11000, owner: victim });
  }

  updateRescues() {
    const { ship, comm, law, hud } = this.game;
    this.rescues = this.rescues.filter((r) => {
      if (!r.victim.alive) return false; // destroyed or gone
      const threats = r.wing.filter((p) => p.alive);
      if (threats.length === 0) {
        if (r.victim.pos.distanceTo(ship.position) < 3000 && r.playerHelped) {
          ship.credits += r.reward;
          law.changeRep('police', 3);
          comm.say(`Danke, Pilot! Das hätte böse enden können. Wir überweisen ${r.reward.toLocaleString('de-DE')} Cr.`, { speaker: r.victim.name, faction: 'civil', seed: r.victim.pos.x, duration: 6000 });
          hud.toast(`Belohnung +${r.reward.toLocaleString('de-DE')} Cr`, 'gain');
          sfx.coin();
        }
        return false;
      }
      return true;
    });
  }

  noteHelp(pirate) {
    this.rescues.forEach((r) => { if (r.wing.includes(pirate)) r.playerHelped = true; });
  }

  // --- police and pirates already fighting ------------------------------------------------------------

  battle() {
    const { comm } = this.game;
    const at = this.spawnPoint(900, 1300);
    const cops = this.spawnWing(['patrol', 'patrol'], at, { lookAt: this.scatter(at, 200) });
    const crooks = this.spawnPirates(this.scatter(at, 260), this.pirateComp(0).slice(0, 3), { lookAt: at });
    cops.ships.forEach((c) => c.attack(crooks.leader));
    crooks.ships.forEach((p) => p.attack(cops.leader));
    if (!comm.current) comm.say('SOLPOL an alle: Gefecht mit Piraten im Sektor. Unterstützung erwünscht, Kopfgeld wird ausgezahlt.', { speaker: 'SOLPOL Streife', faction: 'police', duration: 6000 });
  }

  // --- a drifting wreck, maybe bait ------------------------------------------------------------------

  wreck() {
    const { hud, fx } = this.game;
    const at = this.spawnPoint(450, 800);
    const crates = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < crates; i++) {
      const good = pick(GOOD_KEYS);
      this.game.spawnLoot(this.scatter(at, 30), good, 1 + Math.floor(Math.random() * 2));
    }
    for (let i = 0; i < 16; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      fx.chunk(this.scatter(at, 22), dir.multiplyScalar(rand(0.2, 1.4)), rand(0.4, 1.8), 90);
    }
    hud.toast('Sensoren: Wrackteile in der Nähe', 'info');
    if (Math.random() < 0.35) this.traps.push({ at, sprung: false });
  }

  updateTraps() {
    const { ship } = this.game;
    this.traps = this.traps.filter((t) => {
      if (t.at.distanceTo(ship.position) > 5000) return false;
      if (t.at.distanceTo(ship.position) < 130) {
        this.spawnPiratesAttack(this.spawnPoint(380, 520, 0), 'Danke fürs Vorbeikommen. Das Wrack war unser Köder!');
        return false;
      }
      return true;
    });
  }

  spawnPiratesAttack(pos, line, extra = 0) {
    const { ship, comm } = this.game;
    const wing = this.spawnPirates(pos, this.pirateComp(extra), {});
    wing.group.aggro = true;
    wing.ships.forEach((p) => p.attack(ship));
    if (line) comm.say(line, { speaker: wing.leader.name, faction: 'pirate', seed: pos.x, urgent: true, duration: 5000 });
    sfx.klaxon();
    return wing;
  }

  // --- bounty hunters --------------------------------------------------------------------------------

  hunters() {
    const { ship, comm } = this.game;
    const wing = this.spawnPirates(this.spawnPoint(600, 900), ['jackal', 'jackal', ...(ship.powerLevel() > 0.4 ? ['brute'] : ['crow'])], { level: 1.15 });
    wing.group.aggro = true;
    wing.ships.forEach((p) => p.attack(ship));
    comm.say('Der Aschebund zahlt gut für deinen Kopf. Nichts Persönliches.', { speaker: wing.leader.name, faction: 'pirate', seed: 99, urgent: true, duration: 5500 });
    sfx.klaxon();
  }

  // --- police: hunting wanted pilots ------------------------------------------------------------------

  updateWanted(dt) {
    const { law, npcs, ship, comm, solarSystem } = this.game;
    if (law.wanted < 2) return;
    this.wantedTimer -= dt;
    if (this.wantedTimer > 0) return;
    this.wantedTimer = 50 - law.wanted * 6;
    const sec = solarSystem.securityAt(ship.position);
    if (sec < 0.08 || npcs.ships.length >= MAX_SHIPS) return; // the law doesn't come out this far
    const cops = npcs.count((n) => n.faction === 'police' && n.pos.distanceTo(ship.position) < 2500);
    if (cops >= law.wanted + 1) return;
    const types = law.wanted >= 4 ? ['cutter', 'patrol', 'patrol'] : law.wanted >= 3 ? ['patrol', 'patrol', 'patrol'] : ['patrol', 'patrol'];
    const wing = this.spawnWing(types, this.spawnPoint(700, 1000), { mode: 'patrol', level: 1 + (law.wanted - 2) * 0.12 });
    wing.ships.forEach((c) => c.attack(ship));
    sfx.siren();
    comm.say('Hier SOLPOL. Sie sind festgenommen. Waffen deaktivieren und Maschinen stoppen!', { speaker: wing.leader.name, faction: 'police', seed: 31, urgent: true, duration: 5000 });
  }

  // --- police: cargo scan -------------------------------------------------------------------------------

  // Use a patrol that is already close, or have one jump in
  startScan(npc = null) {
    const { npcs, ship, comm } = this.game;
    if (this.scan) return;
    let cop = npc || npcs.ships.find((n) => n.faction === 'police' && n.typeKey === 'patrol' && n.mode !== 'attack' && n.pos.distanceTo(ship.position) < 1600);
    if (!cop) cop = npcs.arrive('patrol', this.spawnPoint(300, 420), { mode: 'patrol', anchor: ship.position.clone() });
    cop.mode = 'hail';
    cop.holdRange = 70;
    cop.target = null;
    this.scan = { cop, time: 0, seconds: 0, warned: false };
    comm.say('Hier SOLPOL. Routinekontrolle. Halten Sie Kurs und Geschwindigkeit, Ihre Ladung wird gescannt.', { speaker: cop.name, faction: 'police', seed: cop.pos.x, urgent: true, duration: 7000, owner: this.scan });
  }

  updateScan(dt) {
    const { ship, fx, comm, law } = this.game;
    const scan = this.scan;
    if (!scan) return;
    const { cop } = scan;
    if (!cop.alive || cop.mode !== 'hail' || !ship.alive) {
      this.scan = null;
      return;
    }
    const dist = cop.pos.distanceTo(ship.position);
    if (dist < 320) {
      scan.seconds += dt;
      fx.beam(0, cop.pos, ship.position);
    }
    // Running from a scan looks bad
    if (dist > 1400 && !scan.warned) {
      scan.warned = true;
      comm.say('Halten Sie sofort an, oder wir werten das als Flucht!', { speaker: cop.name, faction: 'police', seed: cop.pos.x, urgent: true, duration: 4000 });
    }
    if (dist > 2200) {
      this.scan = null;
      law.raise(Math.max(1, law.wanted), 400);
      cop.resume();
      return;
    }
    if (scan.seconds > 4) {
      this.scan = null;
      this.scanResult(cop);
    }
  }

  scanResult(cop) {
    const { law, comm, ship, missions } = this.game;
    const fine = law.contrabandFine() + missions.contrabandFine();
    const talk = { speaker: cop.name, faction: 'police', seed: cop.pos.x };
    if (fine <= 0 && law.wanted === 0) {
      comm.say('Alles in Ordnung. Guten Flug, Pilot.', { ...talk, duration: 4000 });
      law.changeRep('police', 0.5);
      cop.resume();
      return;
    }
    if (fine <= 0) {
      comm.say(`Ihre Akte zeigt offene Bußgelder: ${law.fines.toLocaleString('de-DE')} Cr. Begleichen Sie das an der nächsten Station.`, { ...talk, duration: 6000 });
      cop.resume();
      return;
    }
    const bribe = Math.round(fine * 0.45);
    const options = [];
    if (ship.credits >= fine) options.push({ label: `Bußgeld zahlen (${fine.toLocaleString('de-DE')} Cr)`, run: () => this.payScanFine(cop, fine, talk) });
    else options.push({ label: 'Ware abgeben, Bußgeld anschreiben', run: () => this.onCredit(cop, fine, talk) });
    if (ship.credits >= bribe) options.push({ label: `Bestechen (${bribe.toLocaleString('de-DE')} Cr)`, run: () => this.tryBribe(cop, fine, bribe, talk) });
    options.push({ label: 'Flucht', run: () => this.runFromScan(cop, fine, talk) });
    sfx.siren();
    comm.ask(`Schmuggelware im Frachtraum! Das macht ${fine.toLocaleString('de-DE')} Cr, die Ware wird beschlagnahmt.`, options, {
      ...talk, timeout: HAIL_TIMEOUT, onTimeout: () => this.onCredit(cop, fine, talk),
    });
  }

  payScanFine(cop, fine, talk) {
    const { ship, law, comm, missions } = this.game;
    ship.credits -= fine;
    law.confiscate();
    missions.onConfiscated();
    comm.say('Ware beschlagnahmt, Bußgeld bezahlt. Lassen Sie sich das eine Lehre sein.', { ...talk, duration: 5000 });
    cop.resume();
    this.game.ui.updateHUDStats();
  }

  onCredit(cop, fine, talk) {
    const { law, comm, missions } = this.game;
    law.confiscate();
    missions.onConfiscated();
    law.raise(Math.max(1, law.wanted), fine);
    comm.say('Ware beschlagnahmt. Das Bußgeld steht in Ihrer Akte. Begleichen Sie es an der nächsten Station.', { ...talk, duration: 5500 });
    cop.resume();
    this.game.ui.updateHUDStats();
  }

  tryBribe(cop, fine, bribe, talk) {
    const { ship, law, comm, missions } = this.game;
    const chance = 0.45 + law.rep.pirate * 0.002 - Math.max(0, law.rep.police) * 0.001;
    ship.credits -= bribe;
    if (Math.random() < chance) {
      law.changeRep('police', -1);
      comm.say('Ich habe nichts gesehen. Und Sie haben mich nie gesehen. Verschwinden Sie.', { ...talk, duration: 5500 });
    } else {
      law.confiscate();
      missions.onConfiscated();
      law.changeRep('police', -4);
      law.raise(Math.max(1, law.wanted), fine * 2);
      comm.say('Bestechung eines Beamten? Das verdoppelt die Strafe. Ihr Geld behalte ich als Beweis.', { ...talk, duration: 6000, urgent: true });
    }
    cop.resume();
    this.game.ui.updateHUDStats();
  }

  runFromScan(cop, fine, talk) {
    const { law, comm, ship } = this.game;
    law.raise(2, fine);
    cop.aggro = true;
    cop.attack(ship);
    comm.say('Halt! Stehenbleiben! Alle Einheiten: Flüchtiger im Sektor!', { ...talk, urgent: true, duration: 4000 });
  }

  // --- warp interdiction: pulled out of the jump between here and there ---------------------------------

  rollInterdiction(from, to, distance) {
    const { law, solarSystem, ui, missions } = this.game;
    if (ui.tutorial.active || this.interdictionCooldown > 0 || distance < 650) return false;
    if (!law.piratesHostile() || missions.isScripted()) return false;
    const danger = 1 - Math.max(solarSystem.securityAt(from), solarSystem.securityAt(to));
    const chance = 0.05 + danger * 0.28;
    if (Math.random() > chance) return false;
    this.interdictionCooldown = INTERDICTION_COOLDOWN;
    return true;
  }

  // Called once the ship has been dragged out of the jump
  sprungInterdiction() {
    this.spawnPiratesAttack(this.spawnPoint(260, 380, 0.3), 'Überraschung! Unser Störsender holt alles aus dem Sprung, was Ladung hat.', 1);
  }

  // --- notifications from ships ---------------------------------------------------------------------------

  onFlee(npc) {
    const { comm, ship } = this.game;
    if (npc.faction !== 'pirate' || npc.pos.distanceTo(ship.position) > 900 || comm.pendingQuestion) return;
    // Sometimes they buy their way out, leaving a crate
    if (npc.lastAttacker === ship && Math.random() < 0.35) {
      comm.say(pick(SURRENDER), { speaker: npc.name, faction: 'pirate', seed: npc.pos.x, duration: 3500 });
      this.game.spawnLoot(npc.pos.clone(), pick(['tech', 'lux', 'stims', 'arms']), 1 + Math.floor(Math.random() * 2));
    } else if (Math.random() < 0.4) {
      comm.say(pick(TAUNTS), { speaker: npc.name, faction: 'pirate', seed: npc.pos.x, duration: 3000 });
    }
  }

  distress(npc, attacker) {
    const { comm, ship } = this.game;
    const now = performance.now() / 1000;
    if (now - this.lastDistress < 14 || npc.pos.distanceTo(ship.position) > 2000 || comm.pendingQuestion) return;
    this.lastDistress = now;
    const line = attacker === ship ? 'Was soll das?! Wir sind unbewaffnet! Hilfe, SOLPOL!' : 'Wir werden angegriffen! An alle Schiffe, Hilfe!';
    comm.say(line, { speaker: npc.name, faction: 'civil', seed: npc.pos.x, duration: 4500 });
  }

  onRemoved(npc) {
    const { comm } = this.game;
    comm.cancelFrom(npc);
    if (this.hail && this.hail.leader === npc) {
      comm.cancelFrom(this.hail.group);
      this.hail = null;
    }
  }

  // Warp blocked: armed ships close enough to disturb the jump field
  massLocked() {
    const { npcs, ship } = this.game;
    return npcs.ships.some((n) => n.guns && n.pos.distanceTo(ship.position) < MASS_LOCK_RANGE && (npcs.isHostile(n, ship) || (this.hail && n.wing === this.hail.group)));
  }
}
