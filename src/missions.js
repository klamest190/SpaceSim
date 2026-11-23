import * as THREE from 'three';
import { GOODS, GOOD_KEYS, STATION_DEFS, STARTING_DEBT } from './world';
import { sfx } from './sfx';
import { difficultyOf } from './difficulty';
import { CHAPTERS, SIDE } from './storyline';

// Jobs and the story. A mission is a small saved record (type, parameters, progress); its objectives are rebuilt from
// the type when needed, so saves stay simple. Objectives are a list: each knows where it points the pilot, what
// happens when it starts, and when it is done. Dying sends you back to the last checkpoint, not to the start.

const MAX_ACTIVE = 4;
const BOARD_LIFETIME = 300;
const OFFERS = 4;
const fmt = (n) => Math.round(n).toLocaleString('de-DE');
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const BOUNTY_NAMES = ['Kapitän Rostzahn', 'Die Schwarze Ilse', 'Einauge Brandt', 'Der Totengräber', 'Silberkehle', 'Vera Sturm', 'Lange Nase', 'Der Gerber'];

export class Missions {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.active = [];
    this.boards = {};
    this.open = ['rate'];   // story chapters on offer
    this.done = [];         // story chapters completed
    this.sideDone = [];     // side quests completed
    this.chapterOffers = {};
    this.nextId = 1;
    this.tracked = null;
    this.runtime = new Map(); // id -> { objectives, spawned, ... }, never saved
    this.marker = null;
    this.ensureMarker();
  }

  ensureMarker() {
    if (this.marker) return;
    const mesh = new THREE.Object3D();
    this.game.scene.add(mesh);
    this.marker = { kind: 'waypoint', name: 'NAVPUNKT', mesh };
  }

  toSave() {
    return {
      open: this.open,
      done: this.done,
      sideDone: this.sideDone,
      nextId: this.nextId,
      active: this.active.map((m) => ({ ...m, step: m.checkpoint ?? m.step })),
      tracked: this.tracked ? this.tracked.id : null,
    };
  }

  load(s) {
    if (!s) return;
    this.chapterOffers = {};
    if (s.open) {
      this.open = s.open.filter((id) => CHAPTERS[id]);
      this.done = s.done || [];
      this.sideDone = s.sideDone || [];
    } else {
      // A save from before the branching story: the old five chapters map onto Act I and the SOLPOL path
      const old = ['rate', 'notruf', 'elster', 'uniformen', 'nest'];
      const step = s.storyStep || 0;
      this.done = old.slice(0, step);
      this.open = step < old.length ? [old[step]] : [];
      if (step >= 4 && this.game.story) this.game.story.set('path', 'gesetz');
      if (step >= 5 && this.game.story && !this.game.story.ending) this.game.story.ending = 'ordnung';
    }
    this.nextId = s.nextId || 1;
    this.active = (s.active || []).map((m) => {
      if (m.type === 'story' && !m.chapter) m.chapter = ['rate', 'notruf', 'elster', 'uniformen', 'nest'][m.storyIndex] || 'rate';
      return m;
    }).filter((m) => m.type !== 'story' || CHAPTERS[m.chapter]);
    this.tracked = this.active.find((m) => m.id === s.tracked) || this.active[0] || null;
  }

  // ----- world lookups ------------------------------------------------------------------------

  station(name) {
    return this.game.solarSystem.stations.find((s) => s.name === name);
  }

  // A named place: offset from a station or a planet, following it as it moves
  spotPos(spot, out = new THREE.Vector3()) {
    const { solarSystem } = this.game;
    const st = solarSystem.stations.find((s) => s.name === spot.anchor);
    const base = st ? st.mesh.position : solarSystem.planets.find((p) => p.name === spot.anchor).group.position;
    return out.copy(base).add(V(...spot.off));
  }

  // Random offset a safe way out from a place; stays the same through saves
  makeSpot(anchor, dist) {
    const { solarSystem } = this.game;
    const st = solarSystem.stations.find((s) => s.name === anchor);
    const base = st ? st.mesh.position : solarSystem.planets.find((p) => p.name === anchor).group.position;
    const clear = st ? st.size + dist : solarSystem.planets.find((p) => p.name === anchor).radius + dist;
    const a = rand(0, Math.PI * 2);
    const offset = V(Math.cos(a) * clear, rand(-40, 40), Math.sin(a) * clear);
    // Keep the spot off the far side of a station's planet
    if (st && st.planetIndex !== 0) {
      const out = st.mesh.position.clone().sub(solarSystem.planets[st.planetIndex].group.position).normalize();
      offset.addScaledVector(out, clear * 0.6);
    }
    void base;
    return { anchor, off: [offset.x, offset.y, offset.z] };
  }

  stationDist(a, b) {
    return this.station(a).mesh.position.distanceTo(this.station(b).mesh.position);
  }

  knownStations() {
    return STATION_DEFS.filter((d) => !d.hidden || this.game.discovered.has(d.name)).map((d) => d.name);
  }

  // ----- objectives by mission type --------------------------------------------------------------

  objectivesFor(m) {
    const g = this.game;
    const dockedAt = (name) => g.ship.isDocked && g.ui.currentStationDocked === name;

    const goTo = (label, spot, range, enter) => ({
      label, spot, range, checkpoint: true,
      check: () => this.spotPos(spot).distanceTo(g.ship.position) < range,
      done: enter,
    });
    const dock = (label, name, done) => ({ label, station: name, check: () => dockedAt(name), done });
    const destroy = (label, listFn, opts = {}) => ({ label, check: () => listFn().every((n) => !n.alive), track: listFn, ...opts });
    const rt = () => this.rt(m);

    switch (m.type) {
      case 'delivery':
      case 'smuggle':
        return [
          {
            label: `${m.qty} t ${m.cargoName} nach ${this.shortName(m.to)} bringen`, station: m.to, check: () => dockedAt(m.to),
            tick: () => {
              if (m.ambush && !rt().sprung && this.station(m.to).mesh.position.distanceTo(g.ship.position) < 1200 && !g.ship.isWarping) {
                rt().sprung = true;
                g.encounters.spawnPiratesAttack(g.encounters.spawnPoint(420, 620), pick(['Schöne Fracht hast du da. Her damit!', 'Wir wissen, was du geladen hast.']));
              }
            },
          },
        ];

      case 'procure':
        return [{
          label: `${m.qty} t ${GOODS[m.good].name} nach ${this.shortName(m.to)} bringen`, station: m.to,
          check: () => dockedAt(m.to) && g.ship.cargo[m.good] >= m.qty,
          done: () => { g.ship.cargo[m.good] -= m.qty; },
        }];

      case 'bounty':
        return [
          goTo(`${m.targetName} aufspüren: ${this.placeName(m.spot.anchor)}`, m.spot, 650, () => {
            const at = this.spotPos(m.spot);
            const wing = g.encounters.spawnPirates(at, m.comp, { mission: m.id, lookAt: g.ship.position });
            wing.group.aggro = true;
            wing.leader.name = `${wing.leader.spec.label.toUpperCase()} ${m.targetName.toUpperCase()}`;
            wing.leader.bounty += 200;
            rt().spawned = wing.ships;
            rt().boss = wing.leader;
            wing.ships.forEach((p) => p.attack(g.ship));
            g.comm.say(pick(['Du suchst mich? Falscher Tag dafür.', 'Noch so ein Kopfgeldjäger. Sammelt ihr euch im Abo?', 'Schade um den Frachter.']), { speaker: m.targetName, faction: 'pirate', seed: m.id * 41, urgent: true, duration: 4500 });
          }),
          destroy(`${m.targetName} ausschalten`, () => (rt().boss ? [rt().boss] : [])),
        ];

      case 'patrol':
        return [
          goTo(`Patrouillenpunkt 1: ${this.placeName(m.spots[0].anchor)}`, m.spots[0], 500, () => this.patrolWave(m, 0)),
          destroy('Piraten im Sektor ausschalten', () => rt().spawned || []),
          goTo(`Patrouillenpunkt 2: ${this.placeName(m.spots[1].anchor)}`, m.spots[1], 500, () => this.patrolWave(m, 1)),
          destroy('Piraten im Sektor ausschalten', () => rt().spawned || []),
        ];

      case 'escort':
        return [
          goTo(`Treffpunkt mit dem Frachter bei ${this.placeName(m.spot.anchor)}`, m.spot, 400, () => this.startEscort(m)),
          {
            label: 'Frachter schützen, bis er springt', check: () => rt().arrived === true, track: () => (rt().convoy ? [rt().convoy] : []),
            tick: (dt) => this.tickEscort(m, dt),
          },
        ];

      case 'story':
      case 'side': {
        const say = (who, text, opts = {}) => g.comm.say(text, { ...who, duration: 8000, ...opts });
        const ask = (who, text, options, opts = {}) => g.comm.ask(text, options, { ...(who || { speaker: 'Bordcomputer', faction: 'control', seed: 3 }), ...opts });
        const ctx = { g, m, M: this, goTo, dock, destroy, rt, say, ask };
        const def = m.type === 'story' ? CHAPTERS[m.chapter] : SIDE[m.quest];
        return def ? def.objectives(ctx) : [];
      }
      default:
        return [];
    }
  }

  patrolWave(m, index) {
    const g = this.game;
    const at = this.spotPos(m.spots[index]);
    const wing = g.encounters.spawnPirates(at, g.encounters.pirateComp(index), { mission: m.id, lookAt: g.ship.position });
    wing.group.aggro = true;
    wing.ships.forEach((p) => p.attack(g.ship));
    this.rt(m).spawned = wing.ships;
    g.comm.say('Feindkontakt! Sie gehören Ihnen, Pilot.', { speaker: 'SOLPOL Leitstelle', faction: 'police', seed: 12, duration: 3500 });
  }

  startEscort(m) {
    const g = this.game;
    const r = this.rt(m);
    const at = this.spotPos(m.spot);
    const out = at.clone().sub(this.station(m.spot.anchor).mesh.position).setY(0).normalize();
    const dest = g.solarSystem.pushClear(at.clone().addScaledVector(out, 1100), 80);
    r.convoy = g.npcs.spawn('freighter', at.clone().addScaledVector(out, -20), {
      mission: m.id, mode: 'goto', dest, arriveRange: 30, slowArrival: false, lookAt: dest, name: `FRACHTER ${m.convoyName.toUpperCase()}`, speed: 10,
      onArrive: (n) => { r.arrived = true; n.jumpOut(); },
    });
    r.waves = 0;
    r.waveTimer = 12;
    g.comm.say(`Hier ${m.convoyName}. Wir laden den Sprungantrieb auf dem Weg. Halten Sie uns den Rücken frei!`, { speaker: r.convoy.name, faction: 'civil', seed: m.id * 3, urgent: true, duration: 6000 });
    g.setTarget(r.convoy);
  }

  tickEscort(m, dt) {
    const g = this.game;
    const r = this.rt(m);
    if (!r.convoy) {
      // Reloaded or respawned mid-way
      return;
    }
    if (!r.convoy.alive && !r.arrived) {
      this.fail(m, 'Der Frachter wurde zerstört.');
      return;
    }
    r.waveTimer -= dt;
    if (r.waveTimer <= 0 && r.waves < 2 && r.convoy.alive) {
      r.waves++;
      r.waveTimer = 26;
      const near = g.solarSystem.pushClear(r.convoy.pos.clone().add(V(rand(-1, 1), rand(-0.2, 0.2), rand(-1, 1)).setLength(rand(380, 520))), 40);
      const wing = g.encounters.spawnPirates(near, g.encounters.pirateComp(-1).slice(0, 3 + r.waves - 1), { mission: m.id, lookAt: r.convoy.pos });
      wing.ships.forEach((p) => p.attack(r.convoy));
      g.comm.say('Kontakte! Sie kommen direkt auf uns zu!', { speaker: r.convoy.name, faction: 'civil', seed: m.id * 3, urgent: true, duration: 3500 });
    }
  }

  // ----- bookkeeping ---------------------------------------------------------------------------

  shortName(name) {
    const def = STATION_DEFS.find((d) => d.name === name);
    return def ? def.short : name;
  }

  placeName(anchor) {
    const def = STATION_DEFS.find((d) => d.name === anchor);
    if (def) return def.short;
    return this.game.displayName(anchor);
  }

  rt(m) {
    if (!this.runtime.has(m.id)) {
      this.runtime.set(m.id, { objectives: this.objectivesFor(m), startedStep: -1 });
    }
    return this.runtime.get(m.id);
  }

  current(m) {
    return this.rt(m).objectives[m.step] || null;
  }

  // A story mission in progress may stage its own ambushes: no random ones on top
  isScripted() {
    return this.active.some((m) => (m.type === 'story' && m.chapter !== 'rate') || m.type === 'side');
  }

  contrabandFine() {
    let fine = 0;
    this.active.forEach((m) => { if (m.contraband) fine += Math.round(m.qty * 250); });
    return fine;
  }

  onConfiscated() {
    [...this.active].forEach((m) => { if (m.contraband) this.fail(m, 'SOLPOL hat die Fracht beschlagnahmt.'); });
  }

  missionCargo() {
    return this.active.reduce((s, m) => s + (m.cargoHeld || 0), 0);
  }

  // Pointing the pilot: the tracked mission's current destination, as an object the targeting system understands
  destination(m = this.tracked) {
    if (!m) return null;
    const obj = this.current(m);
    if (!obj) return null;
    if (obj.station) return this.station(obj.station);
    if (obj.spot) {
      this.marker.name = this.placeLabel(obj);
      this.spotPos(obj.spot, this.marker.mesh.position);
      return this.marker;
    }
    if (obj.track) {
      const alive = obj.track().filter((n) => n.alive);
      return alive[0] || null;
    }
    return null;
  }

  placeLabel(obj) {
    return obj.spot ? `NAVPUNKT ${this.placeName(obj.spot.anchor).toUpperCase()}` : 'NAVPUNKT';
  }

  // ----- the board ------------------------------------------------------------------------------

  offersAt(stationName) {
    const clock = this.game.economy.clock || 0;
    let board = this.boards[stationName];
    if (!board || board.until < clock) {
      board = { until: clock + BOARD_LIFETIME, offers: this.generate(stationName) };
      this.boards[stationName] = board;
    }
    const list = [...board.offers];
    list.unshift(...this.storyOffers(stationName));
    return list;
  }

  // A chapter's fields may depend on the story so far (who gives the finale where)
  field(ch, key) {
    const v = ch[key];
    return typeof v === 'function' ? v(this.game) : v;
  }

  // Story chapters on offer at this station, as mission offers
  storyOffers(stationName) {
    if (this.active.some((m) => m.type === 'story')) return [];
    return this.open.filter((id) => this.field(CHAPTERS[id], 'station') === stationName).map((id) => this.chapterOffer(id));
  }

  // Where the story goes on, for the logbook
  storyHints() {
    if (this.active.some((m) => m.type === 'story')) return [];
    return this.open.map((id) => `${CHAPTERS[id].title} · ${this.shortName(this.field(CHAPTERS[id], 'station'))}`);
  }

  storyOffer(stationName) {
    return this.storyOffers(stationName)[0] || null;
  }

  chapterOffer(id) {
    // Keep the same offer object while it is on offer, so a haggled price sticks
    if (this.chapterOffers[id]) return this.chapterOffers[id];
    const ch = CHAPTERS[id];
    const giver = this.field(ch, 'giver');
    const pay = difficultyOf(this.game).rewardMult * (this.game.story ? this.game.story.rewardMult() : 1);
    const offer = {
      id: `story_${id}`, type: 'story', chapter: id, title: ch.title, text: ch.text,
      giver: giver.speaker, giverFaction: giver.faction, seed: giver.seed, reward: Math.round((ch.reward * pay) / 10) * 10, story: true,
      danger: ch.danger || 1, rep: { police: ch.exclusive || (this.game.story && this.game.story.path === 'bank') ? 0 : 3 }, qty: ch.cargo || 0, cargoName: ch.cargoName || 'Fracht',
      room: this.field(ch, 'room') || (giver.faction === 'police' ? 'office' : 'bar'), talkOnly: !!ch.talkOnly, choice: ch.choice || null,
    };
    this.chapterOffers[id] = offer;
    return offer;
  }

  // Side quests are offered in person (crew, Dr. Varga), never on the board
  sideOffer(quest) {
    const q = SIDE[quest];
    if (!q || this.sideDone.includes(quest) || this.active.some((m) => m.quest === quest)) return null;
    const pay = difficultyOf(this.game).rewardMult * (this.game.story ? this.game.story.rewardMult() : 1);
    return {
      id: `side_${quest}`, type: 'side', quest, title: q.title, text: q.text, giver: q.giver, giverFaction: q.faction, seed: q.seed,
      reward: Math.round((q.reward * pay) / 10) * 10, danger: q.danger || 1, rep: {},
    };
  }

  generate(stationName) {
    const def = STATION_DEFS.find((d) => d.name === stationName);
    const known = this.knownStations().filter((n) => n !== stationName);
    const law = this.game.law;
    const offers = [];
    const pirateStation = def.faction === 'pirate' || def.blackMarket;
    const makers = pirateStation
      ? [() => this.makeSmuggle(stationName, known), () => this.makeSmuggle(stationName, known), () => this.makeDelivery(stationName, known), () => this.makeProcure(stationName)]
      : [() => this.makeDelivery(stationName, known), () => this.makeDelivery(stationName, known), () => this.makeProcure(stationName)];
    if (!pirateStation && law.rep.police > -25) makers.push(() => this.makeBounty(stationName), () => this.makeBounty(stationName), () => this.makePatrol(stationName), () => this.makeEscort(stationName));
    if (!pirateStation && def.security < 0.6 && Math.random() < 0.5) makers.push(() => this.makeSmuggle(stationName, known));
    for (let i = 0; i < OFFERS && makers.length; i++) {
      const j = Math.floor(Math.random() * makers.length);
      const m = makers.splice(j, 1)[0]();
      if (m) offers.push(m);
    }
    const pay = difficultyOf(this.game).rewardMult * (this.game.story ? this.game.story.rewardMult() : 1);
    offers.forEach((o) => { o.reward = Math.round((o.reward * pay) / 10) * 10; });
    return offers;
  }

  baseOffer(extra) {
    return { id: `o${Date.now()}${Math.floor(Math.random() * 1e5)}`, step: 0, rep: {}, danger: 1, ...extra };
  }

  makeDelivery(from, known) {
    const to = pick(known.filter((n) => n !== 'Hades-Nest'));
    if (!to) return null;
    const dist = this.stationDist(from, to);
    const qty = 2 + Math.floor(Math.random() * 7);
    const danger = Math.min(5, 1 + Math.round((1 - this.station(to).security) * 3));
    const reward = Math.round((280 + 16 * Math.sqrt(dist) + qty * 55) * (1 + (danger - 1) * 0.25));
    const name = pick(['Ersatzteile', 'Post', 'Reaktorstäbe', 'Saatgut', 'Medikamente', 'Geologiedaten']);
    return this.baseOffer({
      type: 'delivery', title: `${name} nach ${this.shortName(to)}`, to, qty, cargoName: name, reward, danger,
      ambush: Math.random() < 0.2 + (danger - 1) * 0.1,
      text: `${qty} t ${name}, versiegelt. Ablieferung bei ${this.shortName(to)}. Zahlung bei Übergabe.`,
      giver: pick(['Spedition Hansa', 'Reederei Kroll', 'Agentin Daro', 'Logistikamt']), giverFaction: 'civil', rep: { police: 0.5 },
    });
  }

  makeProcure(from) {
    const good = pick(GOOD_KEYS.filter((g) => !GOODS[g].contraband));
    const qty = 3 + Math.floor(Math.random() * 9);
    const value = GOODS[good].base * qty * 1.5 + 200;
    return this.baseOffer({
      type: 'procure', title: `${qty} t ${GOODS[good].name} beschaffen`, to: from, good, qty, reward: Math.round(value),
      text: `Wir brauchen ${qty} t ${GOODS[good].name} und zahlen deutlich über Markt. Ob gekauft oder aus dem Gestein geschossen, ist uns egal.`,
      giver: pick(['Versorgungsamt', 'Quartiermeisterin Lund', 'Einkauf Nord']), giverFaction: 'civil', danger: 1, rep: { police: 0.5 },
    });
  }

  makeBounty(from) {
    const anchor = this.pickDangerSpot(from);
    const name = pick(BOUNTY_NAMES);
    const power = this.game.ship.powerLevel();
    const tier = Math.min(3, Math.floor(rand(0, 1.4) + power * 3));
    const comp = [['jackal', 'crow'], ['jackal', 'crow', 'crow'], ['brute', 'crow', 'crow'], ['brute', 'jackal', 'jackal']][tier];
    const reward = [1800, 3000, 6000, 10000][tier];
    return this.baseOffer({
      type: 'bounty', title: `Kopfgeld: ${name}`, targetName: name, spot: this.makeSpot(anchor, rand(600, 1000)), comp, reward, danger: tier + 2,
      text: `${name} überfällt seit Wochen Frachter nahe ${this.placeName(anchor)}. Tot oder lebendig, SOLPOL fragt nicht nach.`,
      giver: 'SOLPOL Kopfgeldstelle', giverFaction: 'police', rep: { police: 3 + tier },
    });
  }

  makePatrol(from) {
    const a = this.pickDangerSpot(from);
    const b = this.pickDangerSpot(from);
    const power = this.game.ship.powerLevel();
    return this.baseOffer({
      type: 'patrol', title: 'Streifenflug', spots: [this.makeSpot(a, rand(500, 900)), this.makeSpot(b, rand(500, 900))],
      reward: Math.round(2200 + power * 5000), danger: 2 + Math.round(power * 2),
      text: `Uns fehlen Streifen. Fliegen Sie zwei Punkte an (${this.placeName(a)}, ${this.placeName(b)}) und säubern Sie, was Sie dort finden.`,
      giver: 'SOLPOL Leitstelle', giverFaction: 'police', rep: { police: 4 },
    });
  }

  makeEscort(from) {
    const name = pick(['Morgenrot', 'Treue Berta', 'Gute Hoffnung', 'Marsbote', 'Ida']);
    const power = this.game.ship.powerLevel();
    return this.baseOffer({
      type: 'escort', title: `Geleitschutz: ${name}`, spot: this.makeSpot(from, 240), convoyName: name, reward: Math.round(1900 + power * 3500), danger: 2 + Math.round(power * 2),
      text: `Die ${name} braucht Begleitung, bis sie aus dem Sprungbereich ist. Wir rechnen mit Überfällen. Treffpunkt direkt vor der Station.`,
      giver: 'Reederei Kroll', giverFaction: 'civil', rep: { police: 2 },
    });
  }

  makeSmuggle(from, known) {
    const lawful = known.filter((n) => this.station(n).security > 0.3);
    const to = pick(lawful.length ? lawful : known);
    if (!to) return null;
    const dist = this.stationDist(from, to);
    const qty = 2 + Math.floor(Math.random() * 5);
    return this.baseOffer({
      type: 'smuggle', title: `Heiße Ware nach ${this.shortName(to)}`, to, qty, cargoName: 'versiegelte Kisten', contraband: true,
      reward: Math.round((900 + 40 * Math.sqrt(dist) + qty * 220) * (0.9 + this.station(to).security)), danger: 2 + Math.round(this.station(to).security * 2),
      text: `${qty} t, keine Fragen. Ein Freund nimmt das bei ${this.shortName(to)} ab. Lass dich nicht scannen, Polizei versteht bei so etwas keinen Spaß.`,
      giver: pick(['Der Mittelsmann', 'Tante Ruth', 'Ein Unbekannter']), giverFaction: 'pirate', rep: { pirate: 4, police: -1 },
    });
  }

  pickDangerSpot(from) {
    const { solarSystem } = this.game;
    const here = this.station(from);
    const options = STATION_DEFS.filter((d) => !d.hidden && d.security < 0.7).map((d) => d.name);
    options.sort((a, b) => this.station(a).mesh.position.distanceTo(here.mesh.position) - this.station(b).mesh.position.distanceTo(here.mesh.position));
    void solarSystem;
    return pick(options.slice(0, 3));
  }

  // Can this offer be taken right now? Returns a reason why not, or null.
  blocker(m) {
    const { ship } = this.game;
    if (m.talkOnly) return 'Nur im persönlichen Gespräch';
    if (this.active.length >= MAX_ACTIVE) return 'Maximal vier Aufträge gleichzeitig';
    if ((m.qty && (m.type === 'delivery' || m.type === 'smuggle' || m.type === 'story')) && ship.getCurrentCargoWeight() + m.qty > ship.maxCargo) return `Zu wenig Frachtraum (${m.qty} t nötig)`;
    return null;
  }

  accept(offer, stationName) {
    if (this.blocker(offer)) return false;
    const { game } = this;
    const m = { ...offer, id: this.nextId++, step: 0, from: stationName };
    if (m.type === 'story') this.prepareStory(m);
    if (m.type === 'side' && SIDE[m.quest].prepare) SIDE[m.quest].prepare(this, m);
    if ((m.type === 'delivery' || m.type === 'smuggle' || m.type === 'story') && m.qty) m.cargoHeld = m.qty;
    this.active.push(m);
    const board = this.boards[stationName];
    if (board) board.offers = board.offers.filter((o) => o.id !== offer.id);
    this.tracked = m;
    game.navRefresh();
    game.saveProgress();
    return m;
  }

  prepareStory(m) {
    const ch = CHAPTERS[m.chapter];
    if (ch.prepare) ch.prepare(this, m);
    if (ch.onAccept) ch.onAccept(this.game, m);
    // Choosing one door at the crossroads closes the others
    if (ch.exclusive) this.open = this.open.filter((id) => id === m.chapter || CHAPTERS[id].exclusive !== ch.exclusive);
    this.chapterOffers = {};
    if (this.game.crew) this.game.crew.onChapter(m.chapter, 'accept');
  }

  // A chapter that is only a conversation (no flying): done the moment it is talked through
  finishTalk(id) {
    this.open = this.open.filter((x) => x !== id);
    this.done.push(id);
    this.chapterOffers = {};
    this.game.saveProgress();
  }

  abort(m) {
    const { law } = this.game;
    if (m.type === 'story' || m.type === 'side') {
      this.remove(m);
      this.game.hud.toast(m.type === 'story' ? 'Auftrag abgebrochen. Er wartet weiter am Terminal.' : 'Auftrag abgebrochen. Du kannst ihn später wieder annehmen.', 'warn');
      return;
    }
    law.changeRep('police', m.giverFaction === 'police' ? -3 : -1);
    this.remove(m);
    this.game.hud.toast('Auftrag abgebrochen', 'warn');
  }

  remove(m) {
    const r = this.runtime.get(m.id);
    const { npcs } = this.game;
    // Mission ships still around simply go back to being ordinary ships in the world
    if (r) npcs.ships.forEach((n) => { if (n.mission === m.id) n.mission = null; });
    this.runtime.delete(m.id);
    this.active = this.active.filter((x) => x !== m);
    if (this.tracked === m) this.tracked = this.active[0] || null;
    this.game.navRefresh();
    this.game.saveProgress();
  }

  complete(m) {
    const { ship, law, hud, story, crew } = this.game;
    ship.credits += m.reward;
    Object.entries(m.rep || {}).forEach(([f, v]) => law.changeRep(f, v));
    if (m.reward) hud.toast(`Auftrag erfüllt: +${fmt(m.reward)} Cr`, 'gain');
    sfx.coin();
    this.remove(m);
    this.experience(m);
    if (crew) crew.onMission(m);
    if (m.type === 'story') {
      const ch = CHAPTERS[m.chapter];
      this.done.push(m.chapter);
      this.open = this.open.filter((id) => id !== m.chapter);
      if (ch.onComplete) ch.onComplete(this.game, m);
      if (ch.log) story.log(ch.log);
      if (ch.news) story.news(ch.news);
      const next = ch.next(this.game).filter((id) => !this.done.includes(id) && !this.open.includes(id));
      this.open.push(...next);
      this.chapterOffers = {};
      if (crew) crew.onChapter(m.chapter, 'done');
      if (ch.announce) {
        hud.toast(ch.announce, 'info');
      } else if (next.length) {
        const nc = CHAPTERS[next[0]];
        const where = this.shortName(this.field(nc, 'station'));
        hud.toast(nc.talkOnly ? `Jemand erwartet dich: ${where}.` : `Nächster Auftrag wartet: ${nc.title}, bei ${where}.`, 'info');
      }
    } else if (m.type === 'side') {
      const q = SIDE[m.quest];
      this.sideDone.push(m.quest);
      if (q.onComplete) q.onComplete(this.game, m);
      if (q.log) story.log(q.log, 'side');
    } else {
      story.log(`Auftrag erledigt: ${m.title} (${fmt(m.reward)} Cr).`, 'job');
    }
    this.game.ui.stationUI.refresh();
    this.game.saveProgress();
  }

  // What a finished job teaches
  experience(m) {
    const { story } = this.game;
    if (!story) return;
    switch (m.type) {
      case 'bounty': case 'patrol': story.gain('flug', 45); story.gain('reden', 8); break;
      case 'escort': story.gain('flug', 35); story.gain('reden', 8); story.stats.rescued++; story.changeRep({ guild: 2 }); break;
      case 'delivery': story.gain('handel', 30); story.gain('reden', 10); story.stats.delivered++; this.ownerRep(m.to, 1.5); break;
      case 'procure': story.gain('handel', 35); story.gain('reden', 10); story.stats.delivered++; this.ownerRep(m.to, 2); break;
      case 'smuggle': story.gain('handel', 35); story.gain('reden', 15); story.stats.smuggled++; break;
      case 'story': story.gain('reden', 45); story.gain('flug', 30); break;
      case 'side': story.gain('reden', 35); story.gain('technik', 20); break;
      default:
    }
  }

  ownerRep(stationName, amount) {
    const def = STATION_DEFS.find((d) => d.name === stationName);
    if (def && def.owner && def.owner !== 'police') this.game.law.changeRep(def.owner, amount);
  }

  fail(m, why) {
    const { hud, comm, law } = this.game;
    hud.toast(`Auftrag gescheitert: ${m.title}`, 'bad');
    comm.say(`${why} Der Auftrag ist gescheitert.`, { speaker: m.giver, faction: m.giverFaction, seed: m.seed || 5, urgent: true, duration: 6000 });
    if (m.type !== 'story' && m.type !== 'side') law.changeRep('police', -1);
    if (this.game.crew) this.game.crew.onFail(m);
    this.remove(m);
  }

  onKill(npc) {
    const { encounters } = this.game;
    encounters.noteHelp(npc);
  }

  // Death: mission ships are gone, so each mission replays from its last checkpoint
  onRespawn() {
    this.active.forEach((m) => {
      if (m.checkpoint !== undefined) m.step = m.checkpoint;
      this.runtime.delete(m.id);
    });
  }

  update(dt) {
    const { ship, ui } = this.game;
    if (ship.isDestroyed) return;
    [...this.active].forEach((m) => {
      const r = this.rt(m);
      const obj = r.objectives[m.step];
      if (!obj) {
        this.complete(m);
        return;
      }
      if (r.startedStep !== m.step) {
        r.startedStep = m.step;
        if (obj.checkpoint) m.checkpoint = m.step;
        if (obj.start) obj.start();
        ui.stationUI.refresh();
      }
      if (obj.tick) obj.tick(dt);
      if (!this.active.includes(m)) return; // failed in tick
      if (obj.check()) {
        if (obj.done) obj.done();
        m.step++;
        if (m.step >= r.objectives.length) this.complete(m);
        else if (m === this.tracked) {
          const next = r.objectives[m.step];
          this.game.hud.toast(`Neues Ziel: ${next.label}`, 'info');
          const dest = this.destination(m);
          if (dest && !ship.isDocked) this.game.setTarget(dest);
        }
      }
    });
    // Keep the free nav marker on its moving anchor
    if (this.tracked) this.destination();
    this.game.ship.missionCargoWeight = this.missionCargo();
  }
}

export { STARTING_DEBT };
