import * as THREE from 'three';
import { GOODS, GOOD_KEYS, STATION_DEFS, STARTING_DEBT } from './world';
import { sfx } from './sfx';
import { difficultyOf } from './difficulty';

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

// Characters of the main story
const HOLLMANN = { speaker: 'Hollmann, Kreditbank', faction: 'civil', seed: 4021 };
const RHEE = { speaker: 'Inspektorin Rhee, SOLPOL', faction: 'police', seed: 88 };
const VOSS = { speaker: 'Mara Voss', faction: 'pirate', seed: 777 };

export const STORY = [
  {
    station: 'Erde Orbital-Station', title: 'Die erste Rate', giver: HOLLMANN, reward: 2500,
    text: 'Der Frachter gehört zu 40.000 Cr noch uns, das wissen Sie. Damit Sie nicht gleich säumig werden: 5 t Chips für den Mars-Posten. Die Route gilt als sicher. Gilt.',
    cargo: 5,
  },
  {
    station: 'Mars Außenposten', title: 'Notruf aus dem Gürtel', giver: RHEE, reward: 4500,
    text: 'Sie haben sich gegen diese Krähen gut geschlagen. Mir fehlen Schiffe. Ein Erzkonvoi wird bei der Ceres-Mine angegriffen, meine nächste Streife braucht zu lange. Fliegen Sie hin und halten Sie die Frachter am Leben.',
  },
  {
    station: 'Ceres-Mine', title: 'Die Elster', giver: RHEE, reward: 6500,
    text: 'Der Konvoi war kein Zufall: jemand verkauft dem Aschebund unsere Routen. Ein Kurier mit dem Rufnamen Elster bringt die Daten gerade zu Jupiter. Holen Sie ihn vom Himmel, sammeln Sie den Datenkern ein und bringen Sie ihn zur Europa-Station.',
  },
  {
    station: 'Europa-Station', title: 'Falsche Uniformen', giver: RHEE, reward: 8500,
    text: 'Der Datenkern nennt einen Informanten beim Saturn. Er will nur mit jemandem von außen reden, also mit Ihnen. Treffen Sie ihn bei Titan. Und seien Sie vorsichtig: Laut den Daten trägt nicht jeder Pirat Schwarz.',
  },
  {
    station: 'Titan-Raffinerie', title: 'Hades-Nest', giver: RHEE, reward: 25000,
    text: 'Das sind die Koordinaten des Hades-Nests, das Hauptquartier des Aschebunds, mitten im Gürtel. Davor liegt ihr Träger, die Schwarze Sonne, mit Mara Voss an Bord. Meine Einsatzgruppe schlägt in wenigen Minuten zu, aber wir brauchen jeden Piloten. Rüsten Sie auf. Das hier wird kein Spaziergang.',
  },
];

export class Missions {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.active = [];
    this.boards = {};
    this.storyStep = 0;
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
      storyStep: this.storyStep,
      nextId: this.nextId,
      active: this.active.map((m) => ({ ...m, step: m.checkpoint ?? m.step })),
      tracked: this.tracked ? this.tracked.id : null,
    };
  }

  load(s) {
    if (!s) return;
    this.storyStep = s.storyStep || 0;
    this.nextId = s.nextId || 1;
    this.active = s.active || [];
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
        return this.storyObjectives(m, goTo, dock, destroy, rt);
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

  // ----- the main story --------------------------------------------------------------------------

  storyObjectives(m, goTo, dock, destroy, rt) {
    const g = this.game;
    const say = (who, text, opts = {}) => g.comm.say(text, { ...who, duration: 8000, ...opts });

    if (m.storyIndex === 0) {
      return [{
        label: `5 t Chips zum Mars-Posten bringen`, station: 'Mars Außenposten', checkpoint: true,
        check: () => g.ship.isDocked && g.ui.currentStationDocked === 'Mars Außenposten',
        track: () => rt().spawned || [],
        tick: () => {
          const r = rt();
          const st = this.station('Mars Außenposten');
          if (!r.sprung && !g.ship.isWarping && st.mesh.position.distanceTo(g.ship.position) < 1100) {
            r.sprung = true;
            const wing = g.encounters.spawnPirates(g.encounters.spawnPoint(340, 460), ['crow', 'crow'], { mission: m.id });
            wing.group.aggro = true;
            wing.ships.forEach((p) => p.attack(g.ship));
            r.spawned = wing.ships;
            g.comm.say('Na sieh mal an, ein Frachter ganz allein. Ladung oder Leben, Süßer!', { speaker: wing.leader.name, faction: 'pirate', seed: 301, urgent: true, duration: 4500 });
            g.comm.say('Flugleitung Mars: Piraten bei Ihnen! Taste R schaltet den nächsten Feind auf. Der Kreis zeigt, wohin Sie zielen müssen. Rechtsklick feuert eine Rakete: erst aufschalten, dann trifft sie sicher.', { speaker: 'Flugleitung Mars', faction: 'control', duration: 11000 });
            g.comm.say('Solange Feinde so nah sind, blockiert ihre Waffensignatur den Sprung. Rakete auf Sie? K wirft Täuschkörper. Umschalt gibt Nachbrenner.', { speaker: 'Flugleitung Mars', faction: 'control', duration: 10000 });
          }
        },
      }];
    }

    if (m.storyIndex === 1) {
      const spot = m.spot;
      return [
        goTo('Zum Erzkonvoi bei der Ceres-Mine', spot, 700, () => {
          const r = rt();
          const at = this.spotPos(spot);
          r.convoy = [0, 1].map((i) => g.npcs.spawn('freighter', at.clone().add(V(i * 40 - 20, 5, i * 30)), {
            mission: m.id, mode: 'goto', dest: this.station('Ceres-Mine'), arriveRange: 40, lookAt: this.station('Ceres-Mine').mesh.position, speed: 8,
            onArrive: (n) => { rt().anyJumped = true; n.jumpOut(); }, name: i ? 'ERZFRACHTER GUDRUN' : 'ERZFRACHTER HANNE',
          }));
          r.convoy.forEach((f) => { f.maxHull = f.hull = f.hull * 2; });
          r.waves = 0;
          r.waveTimer = 0;
          r.spawned = [];
        }),
        {
          label: 'Konvoi schützen: alle Angreifer ausschalten', track: () => rt().spawned || [],
          check: () => rt().waves >= 2 && (rt().spawned || []).every((n) => !n.alive),
          tick: (dt) => {
            const r = rt();
            if (!r.convoy) return;
            if (r.convoy.every((f) => !f.alive) && !r.anyJumped) {
              this.fail(m, 'Beide Frachter sind verloren.');
              return;
            }
            r.waveTimer -= dt;
            if (r.waveTimer <= 0 && r.waves < 2 && r.spawned.every((n) => !n.alive)) {
              r.waves++;
              r.waveTimer = 4;
              const t = r.convoy.find((f) => f.alive);
              const from = g.solarSystem.pushClear((t ? t.pos : g.ship.position).clone().add(V(rand(-1, 1), rand(-0.2, 0.2), rand(-1, 1)).setLength(rand(380, 520))), 40);
              const comp = r.waves === 1 ? ['crow', 'crow'] : ['jackal', 'crow', 'crow'];
              const wing = g.encounters.spawnPirates(from, comp, { mission: m.id, lookAt: t ? t.pos : g.ship.position });
              r.spawned = wing.ships;
              wing.ships.forEach((p, i) => p.attack(i % 2 && t ? t : g.ship));
              wing.group.aggro = true;
              if (r.waves === 2) say(RHEE, 'Zweite Welle im Anflug! Halten Sie durch, Streife ist unterwegs.', { urgent: true, duration: 5000 });
            }
          },
        },
      ];
    }

    if (m.storyIndex === 2) {
      return [
        goTo('Kurier Elster abfangen: Jupiter', m.spot, 800, () => {
          const r = rt();
          const at = this.spotPos(m.spot);
          const wing = g.encounters.spawnWing(['jackal', 'crow', 'crow'], at.clone().add(V(40, 0, 0)), { kind: 'pirates', raider: true, mission: m.id, lookAt: g.ship.position });
          wing.group.aggro = true;
          wing.ships.forEach((p) => p.attack(g.ship));
          const away = g.solarSystem.pushClear(at.clone().add(V(rand(-1, 1), 0, rand(-1, 1)).setLength(2600)), 80);
          r.courier = g.npcs.spawn('courier', at, { mission: m.id, faction: 'pirate', mode: 'goto', dest: away, arriveRange: 30, slowArrival: false, lookAt: away, name: 'KURIER ELSTER', fearless: true, bounty: 1500 });
          r.courier.maxSpeed = 30;
          r.courier.wing = wing.group;
          r.courier.loot = 0;
          // Reaching open space means it got away
          r.courier.home.onArrive = () => { r.escaped = true; r.courier.jumpOut(); };
          g.setTarget(r.courier);
          say({ speaker: 'Kurier Elster', faction: 'pirate', seed: 512 }, 'Scheiße, die haben mich! Haltet ihn auf, ich springe!', { urgent: true, duration: 4000 });
        }),
        {
          label: 'Kurier Elster abschießen, bevor er springt', track: () => (rt().courier ? [rt().courier] : []),
          check: () => rt().courier && !rt().courier.alive && !rt().escaped,
          tick: () => { if (rt().escaped) this.fail(m, 'Die Elster ist entkommen.'); },
          done: () => {
            const r = rt();
            r.core = g.spawnLoot(r.courier.pos.clone(), null, 0, 0, { special: 'Datenkern', onCollect: () => { r.collected = true; } });
            g.setTarget({ kind: 'waypoint', name: 'DATENKERN', mesh: r.core.group });
            say(RHEE, 'Da ist der Datenkern. Mit B holen Sie ihn per Traktorstrahl an Bord.', { duration: 6000 });
          },
        },
        { label: 'Datenkern mit dem Traktorstrahl bergen [B]', check: () => rt().collected === true || !rt().core },
        dock('Datenkern zur Europa-Station bringen', 'Europa-Station'),
      ];
    }

    if (m.storyIndex === 3) {
      return [
        goTo('Informant treffen: Titan', m.spot, 650, () => {
          const r = rt();
          const at = this.spotPos(m.spot);
          r.informant = g.npcs.arrive('courier', at, { mission: m.id, mode: 'idle', lookAt: g.ship.position, name: 'KURIER NACHTIGALL', speed: 2 });
          say({ speaker: 'Kurier Nachtigall', faction: 'civil', seed: 6060 }, 'Sie sind allein? Gut. Die Koordinaten stecken im... Moment. Das sind SOLPOL-Signaturen. Die gehören nicht zur Streife hier!', { urgent: true, duration: 7000 });
          r.ambushTimer = 7;
          r.spawned = [];
        }),
        {
          label: 'Überleben: die falsche Streife ausschalten', track: () => rt().spawned || [],
          check: () => rt().triggered && (rt().spawned || []).every((n) => !n.alive),
          tick: (dt) => {
            const r = rt();
            if (r.triggered) return;
            r.ambushTimer -= dt;
            if (r.ambushTimer > 0) return;
            r.triggered = true;
            const near = g.solarSystem.pushClear(g.ship.position.clone().add(V(rand(-1, 1), 0, rand(-1, 1)).setLength(420)), 40);
            const fake = g.encounters.spawnWing(['patrol', 'patrol', 'patrol', 'cutter'], near, { kind: 'pirates', faction: 'pirate', raider: true, mission: m.id, lookAt: g.ship.position, bounty: 900 });
            fake.group.aggro = true;
            fake.ships.forEach((p, i) => { p.name = `FALSCHE ${p.name}`; p.bounty = 1200; if (i === 0 && r.informant.alive) p.attack(r.informant); else p.attack(g.ship); });
            r.spawned = fake.ships;
            say(RHEE, 'Diese Streifen sind nicht von uns! Wer auch immer das ist, er trägt unsere Farben. Schießen Sie, Sie decken das rechtlich mit mir ab!', { urgent: true, duration: 8000 });
          },
          done: () => {
            g.discover('Hades-Nest');
            say(RHEE, 'Sie leben noch. Gut. Nachtigall hat die Koordinaten übertragen, bevor er starb: Hades-Nest, mitten im Gürtel. Kommen Sie zur Titan-Raffinerie.', { urgent: true, duration: 9000 });
          },
        },
        dock('Andocken: Titan-Raffinerie', 'Titan-Raffinerie'),
      ];
    }

    // The finale
    return [
      goTo('Sammelpunkt: Hades-Nest', m.spot, 900, () => {
        const r = rt();
        g.discover('Hades-Nest');
        const at = this.spotPos(m.spot);
        const nest = this.station('Hades-Nest');
        const facing = at.clone().add(nest.mesh.position.clone().sub(at).normalize().multiplyScalar(300));
        const queen = g.npcs.arrive('queen', facing, { mission: m.id, mode: 'idle', name: 'TRÄGER SCHWARZE SONNE', lookAt: g.ship.position, speed: 1, bounty: 15000 });
        const group = g.npcs.newGroup({ kind: 'pirates', aggro: true });
        queen.wing = group;
        group.members.push(queen);
        r.queen = queen;
        r.spawned = [queen];
        [[22, 8, -24], [-22, 8, -24], [22, 8, 12], [-22, 8, 12], [0, 14, -8], [0, -10, 16]].forEach(([x, y, z]) => {
          const off = V(x, y, z);
          const turret = g.npcs.spawn('turret', off.clone().applyQuaternion(queen.quat).add(queen.pos), { mission: m.id, mode: 'idle', group, parent: queen, parentOffset: off, speed: 0 });
          r.spawned.push(turret);
        });
        const strike = g.encounters.spawnWing(['cutter', 'patrol', 'patrol', 'patrol'], at.clone().add(V(-80, 10, 80)), { kind: 'police', mode: 'patrol', mission: m.id, lookAt: queen.pos, level: 1.1 });
        strike.ships.forEach((c) => c.attack(queen));
        r.strike = strike.ships;
        r.waveTimer = 8;
        r.phase = 0;
        g.setTarget(queen);
        say(VOSS, 'Inspektorin Rhee schickt mir einen Frachterpiloten? Ich bin beinahe gekränkt. Alle Staffeln: Macht sie nieder!', { urgent: true, duration: 7000 });
        say(RHEE, 'Das ist sie. Konzentrieren Sie das Feuer auf den Träger! Sobald er fällt, fallen auch die Türme.', { duration: 7000 });
      }),
      {
        label: 'Träger Schwarze Sonne vernichten', track: () => (rt().queen ? [rt().queen] : []),
        check: () => rt().queen && !rt().queen.alive,
        tick: (dt) => {
          const r = rt();
          if (!r.queen || !r.queen.alive) return;
          r.waveTimer -= dt;
          const pirates = g.npcs.count((n) => n.faction === 'pirate' && n.mission === m.id && n.typeKey !== 'turret' && n.typeKey !== 'queen');
          if (r.waveTimer <= 0 && pirates < 5) {
            r.waveTimer = 24;
            const comp = g.ship.powerLevel() > 0.45 ? ['jackal', 'jackal', 'crow'] : ['jackal', 'crow', 'crow'];
            const launch = r.queen.pos.clone().add(V(rand(-30, 30), 22, rand(-30, 30)));
            const wing = g.encounters.spawnWing(comp, launch, { kind: 'pirates', raider: true, mission: m.id, lookAt: g.ship.position });
            wing.group.aggro = true;
            wing.ships.forEach((p, i) => p.attack(i === 0 || !(r.strike || []).some((c) => c.alive) ? g.ship : r.strike.find((c) => c.alive)));
          }
          const hp = r.queen.hull / r.queen.maxHull;
          if (r.phase === 0 && hp < 0.66) {
            r.phase = 1;
            say(VOSS, 'Das ist alles? Ich habe schon Kreditraten gezahlt, die mir mehr wehgetan haben!', { urgent: true, duration: 5000 });
          } else if (r.phase === 1 && hp < 0.33) {
            r.phase = 2;
            say(VOSS, 'Reaktor kritisch?! Reißt euch zusammen! Wenn ich falle, reiße ich dich mit, Frachterpilot!', { urgent: true, duration: 5000 });
            const reinforce = g.encounters.spawnWing(['patrol', 'patrol'], g.solarSystem.pushClear(g.ship.position.clone().add(V(200, 40, 200)), 40), { kind: 'police', mission: m.id, lookAt: r.queen.pos });
            reinforce.ships.forEach((c) => c.attack(r.queen));
          }
        },
        done: () => {
          say(RHEE, 'Sie haben es geschafft. Der Aschebund ist kopflos, Voss ist tot, und die Kreditbank hat soeben ein sehr höfliches Schreiben von mir bekommen. Docken Sie an, Sie sind jetzt frei. Danke, Pilot.', { urgent: true, duration: 12000 });
          g.ship.debt = 0;
          g.hud.toast('Kredit getilgt: Das Schiff gehört dir', 'gain');
        },
      },
    ];
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
    return this.active.some((m) => m.type === 'story' && m.storyIndex >= 1);
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
    const story = this.storyOffer(stationName);
    if (story) list.unshift(story);
    return list;
  }

  storyOffer(stationName) {
    const step = STORY[this.storyStep];
    if (!step || step.station !== stationName || this.active.some((m) => m.type === 'story')) return null;
    return {
      id: `story${this.storyStep}`, type: 'story', storyIndex: this.storyStep, title: step.title, text: step.text,
      giver: step.giver.speaker, giverFaction: step.giver.faction, seed: step.giver.seed, reward: Math.round(step.reward * difficultyOf(this.game).rewardMult), story: true,
      danger: Math.min(5, this.storyStep + 1), rep: { police: 6 }, qty: step.cargo || 0, cargoName: 'Quantenchips',
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
    const pay = difficultyOf(this.game).rewardMult;
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
    if (this.active.length >= MAX_ACTIVE) return 'Maximal vier Aufträge gleichzeitig';
    if ((m.qty && (m.type === 'delivery' || m.type === 'smuggle' || (m.type === 'story' && m.storyIndex === 0))) && ship.getCurrentCargoWeight() + m.qty > ship.maxCargo) return `Zu wenig Frachtraum (${m.qty} t nötig)`;
    return null;
  }

  accept(offer, stationName) {
    if (this.blocker(offer)) return false;
    const { game } = this;
    const m = { ...offer, id: this.nextId++, step: 0, from: stationName };
    if (m.type === 'story') this.prepareStory(m);
    if ((m.type === 'delivery' || m.type === 'smuggle' || (m.type === 'story' && m.storyIndex === 0)) && m.qty) m.cargoHeld = m.qty;
    this.active.push(m);
    const board = this.boards[stationName];
    if (board) board.offers = board.offers.filter((o) => o.id !== offer.id);
    this.tracked = m;
    game.navRefresh();
    game.saveProgress();
    return m;
  }

  prepareStory(m) {
    const { solarSystem } = this.game;
    const spots = {
      1: () => this.makeSpot('Ceres-Mine', 700),
      2: () => this.makeSpot('Jupiter', 400),
      3: () => this.makeSpot('Titan-Raffinerie', 500),
      4: () => {
        const nest = this.station('Hades-Nest').mesh.position;
        const toSun = nest.clone().negate().setY(0).normalize().multiplyScalar(1200);
        return { anchor: 'Hades-Nest', off: [toSun.x, 30, toSun.z] };
      },
    };
    void solarSystem;
    if (spots[m.storyIndex]) m.spot = spots[m.storyIndex]();
    if (m.storyIndex === 4) this.game.discover('Hades-Nest');
  }

  abort(m) {
    const { law } = this.game;
    if (m.type === 'story') {
      this.remove(m);
      this.game.hud.toast('Auftrag abgebrochen. Er wartet weiter am Terminal.', 'warn');
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
    const { ship, law, hud, comm } = this.game;
    ship.credits += m.reward;
    Object.entries(m.rep || {}).forEach(([f, v]) => law.changeRep(f, v));
    hud.toast(`Auftrag erfüllt: +${fmt(m.reward)} Cr`, 'gain');
    sfx.coin();
    const wasStory = m.type === 'story';
    this.remove(m);
    if (wasStory) {
      this.storyStep++;
      const next = STORY[this.storyStep];
      if (next) {
        const msg = `Nächster Auftrag wartet: ${next.title}, bei ${this.shortName(next.station)}.`;
        comm.say(msg, { ...next.giver, duration: 8000 });
        hud.toast(msg, 'info');
      }
    }
    this.game.ui.stationUI.refresh();
    this.game.saveProgress();
  }

  fail(m, why) {
    const { hud, comm, law } = this.game;
    hud.toast(`Auftrag gescheitert: ${m.title}`, 'bad');
    comm.say(`${why} Der Auftrag ist gescheitert.`, { speaker: m.giver, faction: m.giverFaction, seed: m.seed || 5, urgent: true, duration: 6000 });
    if (m.type !== 'story') law.changeRep('police', -1);
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
