import * as THREE from 'three';
import { sfx } from './sfx';

// The plot. Act I (four chapters) follows Inspektorin Rhee from a cargo run into a conspiracy; at Titan the pilot
// chooses who to trust: SOLPOL (Rhee), the Aschebund (Mara Voss) or the Kreditbank (Hollmann, through Herr Grau).
// Each path has two chapters of its own and they meet again over Venus, where the pilot decides what becomes of
// Hollmann; the bank's path can also end in the dark without that. Side quests (the crew's own stories and the
// signal beyond Neptune) run alongside.
//
// A chapter: who offers it where, what it pays, an optional conversation (a tree of nodes the station screen walks
// through), what accepting it changes, the objectives (built by missions.js with the helpers in ctx), and which
// chapters open once it is done. Objective lists rebuild from the saved record, so spawns sit behind checkpoints.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rand = (a, b) => a + Math.random() * (b - a);

export const HOLLMANN = { speaker: 'Hollmann, Kreditbank', faction: 'civil', seed: 4021 };
export const RHEE = { speaker: 'Inspektorin Rhee, SOLPOL', faction: 'police', seed: 88 };
export const VOSS = { speaker: 'Mara Voss', faction: 'pirate', seed: 777 };
export const GRAU = { speaker: 'Herr Grau, Kreditbank', faction: 'civil', seed: 9113 };
export const BOTE = { speaker: 'Ein Bote des Aschebunds', faction: 'pirate', seed: 3131 };
export const KESSLER = { speaker: 'Oberst Kessler', faction: 'police', seed: 5150 };
export const NACHTIGALL = { speaker: 'Kurier Nachtigall', faction: 'civil', seed: 6060 };
export const VARGA = { speaker: 'Dr. Ilse Varga, Xenoforschung', faction: 'civil', seed: 2718 };

const fmt = (n) => Math.round(n).toLocaleString('de-DE');

// ----- shared mission pieces --------------------------------------------------------------------

// Ships that give up: no guns, no grudge, nobody's enemy any more
function surrender(ships) {
  ships.forEach((n) => {
    if (!n.alive) return;
    n.faction = 'civil';
    n.guns = null;
    n.missiles = 0;
    n.aggro = false;
    n.target = null;
    n.raider = false;
    n.mode = 'surrender';
    n.surrendered = true;
    if (n.wing) { n.wing.truce = true; n.wing.aggro = false; }
  });
}

// Kessler's turncoats in SOLPOL colours
function turncoats(g, m, types, at, opts = {}) {
  const w = g.encounters.spawnWing(types, at, { kind: 'rogue', faction: 'rogue', mission: m.id, lookAt: g.ship.position, level: 1.1, bounty: 900, ...opts });
  w.ships.forEach((s, i) => { s.name = `${s.spec.label.toUpperCase()} ${opts.prefix || 'KESSLER'}-${i + 1}`; });
  return w;
}

// Wingmen on the pilot's side for one fight
function allies(g, m, types, at, faction, lookAt) {
  const w = g.encounters.spawnWing(types, at, { kind: 'allies', faction, ally: true, mission: m.id, lookAt, mode: 'patrol', bounty: 0, raider: false });
  w.ships.forEach((s) => { s.ally = true; s.fearless = true; });
  return w;
}

function hp(n) {
  return n && n.alive ? n.hull / n.maxHull : 0;
}

// Open the story's next doors: shown in the HUD and on the comm
function announce(g, text, who) {
  if (who) g.comm.say(text, { ...who, duration: 9000 });
  g.hud.toast(text, 'info');
}

// ----- the chapters -------------------------------------------------------------------------------

export const CHAPTERS = {
  // ===== Act I =====================================================================================
  rate: {
    title: 'Die erste Rate', giver: HOLLMANN, station: 'Erde Orbital-Station', reward: 2500, cargo: 5, cargoName: 'Quantenchips', danger: 1,
    text: 'Der Frachter gehört zu 40.000 Cr noch uns, das wissen Sie. Damit Sie nicht gleich säumig werden: 5 t Chips für den Mars-Posten. Die Route gilt als sicher. Gilt.',
    objectives: ({ g, m, M, rt }) => [{
      label: '5 t Chips zum Mars-Posten bringen', station: 'Mars Außenposten', checkpoint: true,
      check: () => g.ship.isDocked && g.ui.currentStationDocked === 'Mars Außenposten',
      track: () => rt().spawned || [],
      tick: () => {
        const r = rt();
        const st = M.station('Mars Außenposten');
        if (!r.sprung && !g.ship.isWarping && st.mesh.position.distanceTo(g.ship.position) < 1100) {
          r.sprung = true;
          const wing = g.encounters.spawnPirates(g.encounters.spawnPoint(340, 460), ['crow', 'crow'], { mission: m.id });
          wing.group.aggro = true;
          wing.ships.forEach((p) => p.attack(g.ship));
          r.spawned = wing.ships;
          g.comm.say('Na sieh mal an, ein Frachter ganz allein, pünktlich wie angekündigt. Ladung oder Leben, Süßer!', { speaker: wing.leader.name, faction: 'pirate', seed: 301, urgent: true, duration: 4500 });
          g.comm.say('Flugleitung Mars: Piraten bei Ihnen! Taste R schaltet den nächsten Feind auf. Der Kreis zeigt, wohin Sie zielen müssen. Rechtsklick feuert eine Rakete: erst aufschalten, dann trifft sie sicher.', { speaker: 'Flugleitung Mars', faction: 'control', duration: 11000 });
          g.comm.say('Solange Feinde so nah sind, blockiert ihre Waffensignatur den Sprung. Rakete auf Sie? K wirft Täuschkörper. Y oder Umschalt gibt Nachbrenner.', { speaker: 'Flugleitung Mars', faction: 'control', duration: 10000 });
        }
      },
    }],
    log: 'Die erste Rate abgeliefert. Die Krähen am Mars wussten erstaunlich genau, wann ich komme.',
    next: () => ['notruf'],
  },

  notruf: {
    title: 'Notruf aus dem Gürtel', giver: RHEE, station: 'Mars Außenposten', reward: 4500, danger: 2,
    text: 'Sie haben sich gegen diese Krähen gut geschlagen. Mir fehlen Schiffe. Ein Erzkonvoi wird bei der Ceres-Mine angegriffen, meine nächste Streife braucht zu lange. Fliegen Sie hin und halten Sie die Frachter am Leben.',
    talk: ({ offer }) => ({
      start: {
        text: 'Sie sind der Frachterpilot, der die Krähen abgeschüttelt hat? Inspektorin Rhee, SOLPOL. Sie haben sich gut geschlagen. Mir fehlen Schiffe.',
        options: [
          { label: 'Woher wussten die Piraten, wann ich komme?', go: 'wer' },
          { label: 'Was brauchen Sie?', go: 'offer' },
          { label: 'Später.', close: true },
        ],
      },
      wer: {
        text: 'Gute Frage. Das fragen sich auf meinem Schreibtisch gerade zwölf andere Frachterpiloten auch. Die Krähen sind ein Ableger des Aschebunds, und der kennt neuerdings Frachtpläne, die er nicht kennen dürfte.',
        options: [{ label: 'Was brauchen Sie?', go: 'offer' }, { label: 'Später.', close: true }],
      },
      offer: { text: offer.text, options: [{ label: `Ich fliege hin (${fmt(offer.reward)} Cr)`, accept: true }, { label: 'Später.', close: true }] },
    }),
    prepare: (M, m) => { m.spot = M.makeSpot('Ceres-Mine', 700); },
    objectives: ({ g, m, M, goTo, rt, say }) => [
      goTo('Zum Erzkonvoi bei der Ceres-Mine', m.spot, 700, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        r.convoy = [0, 1].map((i) => g.npcs.spawn('freighter', at.clone().add(V(i * 40 - 20, 5, i * 30)), {
          mission: m.id, mode: 'goto', dest: M.station('Ceres-Mine'), arriveRange: 40, lookAt: M.station('Ceres-Mine').mesh.position, speed: 8,
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
            M.fail(m, 'Beide Frachter sind verloren.');
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
        done: () => {
          const r = rt();
          const saved = (r.convoy || []).filter((f) => f.alive).length;
          if (saved) g.story.set('konvoi_gerettet');
          g.story.stats.rescued++;
          g.story.changeRep({ guild: 8 });
        },
      },
    ],
    news: 'SOLNET: Erzkonvoi bei Ceres gerettet. Die Bergbaugilde dankt einem unbekannten Frachterpiloten.',
    log: 'Den Erzkonvoi bei Ceres verteidigt. Rhee glaubt, jemand verkauft dem Aschebund die Routen.',
    next: () => ['elster'],
  },

  elster: {
    title: 'Die Elster', giver: RHEE, station: 'Ceres-Mine', reward: 6500, danger: 3,
    text: 'Der Konvoi war kein Zufall: jemand verkauft dem Aschebund unsere Routen. Ein Kurier mit dem Rufnamen Elster bringt die Daten gerade zu Jupiter. Holen Sie ihn vom Himmel, sammeln Sie den Datenkern ein und bringen Sie ihn zur Europa-Station.',
    talk: ({ offer }) => ({
      start: {
        text: offer.text,
        options: [
          { label: 'Wer hat Zugang zu Frachtplänen?', go: 'wer' },
          { label: `Ich hole mir die Elster (${fmt(offer.reward)} Cr)`, accept: true },
          { label: 'Später.', close: true },
        ],
      },
      wer: {
        text: 'Reedereien. Versicherungen. Der Zoll, also wir. Und die Banken, die die Frachter finanzieren. Kurz: alle, die Geld daran verdienen, dass Fracht ankommt. Oder daran, dass sie es nicht tut.',
        options: [{ label: `Ich hole mir die Elster (${fmt(offer.reward)} Cr)`, accept: true }, { label: 'Später.', close: true }],
      },
    }),
    prepare: (M, m) => { m.spot = M.makeSpot('Jupiter', 400); },
    objectives: ({ g, m, M, goTo, dock, rt, say }) => [
      goTo('Kurier Elster abfangen: Jupiter', m.spot, 800, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        const wing = g.encounters.spawnWing(['jackal', 'crow', 'crow'], at.clone().add(V(40, 0, 0)), { kind: 'pirates', raider: true, mission: m.id, lookAt: g.ship.position });
        wing.group.aggro = true;
        wing.ships.forEach((p) => p.attack(g.ship));
        const away = g.solarSystem.pushClear(at.clone().add(V(rand(-1, 1), 0, rand(-1, 1)).setLength(2600)), 80);
        r.courier = g.npcs.spawn('courier', at, { mission: m.id, faction: 'pirate', mode: 'goto', dest: away, arriveRange: 30, slowArrival: false, lookAt: away, name: 'KURIER ELSTER', fearless: true, bounty: 1500 });
        r.courier.maxSpeed = 30;
        r.courier.wing = wing.group;
        r.courier.loot = 0;
        r.courier.home.onArrive = () => { r.escaped = true; r.courier.jumpOut(); };
        g.setTarget(r.courier);
        say({ speaker: 'Kurier Elster', faction: 'pirate', seed: 512 }, 'Scheiße, die haben mich! Haltet ihn auf, ich springe! Konto Null zahlt nicht für tote Kuriere!', { urgent: true, duration: 4500 });
      }),
      {
        label: 'Kurier Elster abschießen, bevor er springt', track: () => (rt().courier ? [rt().courier] : []),
        check: () => rt().courier && !rt().courier.alive && !rt().escaped,
        tick: () => { if (rt().escaped) M.fail(m, 'Die Elster ist entkommen.'); },
        done: () => {
          const r = rt();
          g.story.set('elster_tot');
          r.core = g.spawnLoot(r.courier.pos.clone(), null, 0, 0, { special: 'Datenkern', onCollect: () => { r.collected = true; } });
          g.setTarget({ kind: 'waypoint', name: 'DATENKERN', mesh: r.core.group });
          say(RHEE, 'Da ist der Datenkern. Mit B holen Sie ihn per Traktorstrahl an Bord.', { duration: 6000 });
        },
      },
      { label: 'Datenkern mit dem Traktorstrahl bergen [B]', check: () => rt().collected === true || !rt().core },
      dock('Datenkern zur Europa-Station bringen', 'Europa-Station'),
    ],
    news: 'SOLNET: Piratenkurier bei Jupiter abgeschossen. SOLPOL spricht von einem „wichtigen Fund".',
    log: 'Die Elster abgeschossen, ihren Datenkern nach Europa gebracht. Der Kurier redete von „Konto Null".',
    next: () => ['uniformen'],
  },

  uniformen: {
    title: 'Falsche Uniformen', giver: RHEE, station: 'Europa-Station', reward: 8500, danger: 3,
    text: 'Der Datenkern nennt einen Informanten beim Saturn, Rufname Nachtigall. Er will nur mit jemandem von außen reden, also mit Ihnen. Treffen Sie ihn bei Titan. Und seien Sie vorsichtig: Laut den Daten trägt nicht jeder Pirat Schwarz.',
    talk: ({ offer, g }) => ({
      start: {
        text: 'Wir haben den Datenkern ausgelesen. Halb. Der Rest ist verschlüsselt, aber eins ist klar: Die Routen wurden bezahlt. Über ein Nummernkonto. Konto 7-Null, bei der Kreditbank Sol.',
        options: [
          { label: 'Die Kreditbank? Der gehört mein Schiff.', go: 'bank' },
          { label: 'Lassen Sie mich an den verschlüsselten Teil.', need: ['technik', 2], go: 'crack', run: () => { g.story.set('spur_hollmann'); g.story.gain('technik', 40); } },
          { label: 'Wie geht es weiter?', go: 'offer' },
        ],
      },
      bank: {
        text: 'Dieselbe. Das macht Sie entweder zum Opfer oder zum Verdächtigen. Ich habe mich für Opfer entschieden. Vorerst.',
        options: [{ label: 'Wie geht es weiter?', go: 'offer' }],
      },
      crack: {
        text: 'Sie tippen sich durch drei Schichten Verschlüsselung. Unter jeder Zahlung steht dasselbe Freigabekürzel: K. H., Abteilung Sonderforderungen. Rhee wird blass. „Konrad Hollmann. Der Mann, der Ihnen den Kredit gegeben hat."',
        options: [{ label: 'Wie geht es weiter?', go: 'offer' }],
      },
      offer: { text: offer.text, options: [{ label: `Ich treffe ihn (${fmt(offer.reward)} Cr)`, accept: true }, { label: 'Später.', close: true }] },
    }),
    prepare: (M, m) => { m.spot = M.makeSpot('Titan-Raffinerie', 500); },
    objectives: ({ g, m, M, goTo, dock, rt, say }) => [
      goTo('Informant Nachtigall treffen: Titan', m.spot, 650, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        r.informant = g.npcs.arrive('courier', at, { mission: m.id, mode: 'idle', lookAt: g.ship.position, name: 'KURIER NACHTIGALL', speed: 2, fearless: true });
        r.informant.hunted = true; // the turncoats are here for him
        r.informant.maxHull = r.informant.hull = r.informant.hull * 3;
        r.informant.maxShield = r.informant.shield = r.informant.shield * 2;
        say(NACHTIGALL, 'Sie sind allein? Gut. Ich übertrage Ihnen alles, was ich über Konto 7-Null weiß, und die Koordinaten des Nests... Moment. Das sind SOLPOL-Signaturen. Die gehören nicht zur Streife hier!', { urgent: true, duration: 8000 });
        r.ambushTimer = 7;
        r.spawned = [];
      }),
      {
        label: 'Überleben: die falsche Streife ausschalten. Nachtigall schützen!', track: () => rt().spawned || [],
        check: () => rt().triggered && (rt().spawned || []).every((n) => !n.alive),
        tick: (dt) => {
          const r = rt();
          if (r.triggered) {
            if (r.informant && !r.informant.alive && !r.lostSaid) {
              r.lostSaid = true;
              say(RHEE, 'Nachtigall ist weg. Verdammt. Bleiben Sie wenigstens Sie am Leben!', { urgent: true, duration: 5000 });
            }
            return;
          }
          r.ambushTimer -= dt;
          if (r.ambushTimer > 0) return;
          r.triggered = true;
          const near = g.solarSystem.pushClear(g.ship.position.clone().add(V(rand(-1, 1), 0, rand(-1, 1)).setLength(420)), 40);
          const fake = turncoats(g, m, ['patrol', 'patrol', 'patrol', 'cutter'], near, { prefix: 'STREIFE', bounty: 1200 });
          fake.group.aggro = true;
          fake.ships.forEach((p, i) => { if (i < 2 && r.informant.alive) p.attack(r.informant); else p.attack(g.ship); });
          r.spawned = fake.ships;
          say(RHEE, 'Diese Streifen sind nicht von uns! Wer auch immer das ist, er trägt unsere Farben. Schießen Sie, ich decke das!', { urgent: true, duration: 8000 });
        },
        done: () => {
          const r = rt();
          g.discover('Hades-Nest');
          if (r.informant && r.informant.alive) {
            g.story.set('nachtigall_lebt');
            say(NACHTIGALL, 'Sie... Sie haben mich da rausgeholt. Das vergesse ich nicht. Ich verstecke mich in der Titan-Raffinerie. Fragen Sie in der Bar nach mir.', { urgent: true, duration: 8000 });
            const dest = M.station('Titan-Raffinerie');
            r.informant.home.mode = r.informant.mode = 'goto';
            r.informant.home.dest = dest;
            r.informant.home.arriveRange = dest.size + 14;
            r.informant.home.onArrive = (n) => g.npcs.remove(n);
            say(RHEE, 'Sie leben beide. Gut. Die Koordinaten sind da: das Hades-Nest, mitten im Gürtel. Kommen Sie zur Titan-Raffinerie, wir müssen reden.', { duration: 9000 });
          } else {
            g.story.set('nachtigall_tot');
            say(RHEE, 'Nachtigall hat die Koordinaten übertragen, bevor er starb: das Hades-Nest, mitten im Gürtel. Kommen Sie zur Titan-Raffinerie.', { urgent: true, duration: 9000 });
          }
        },
      },
      dock('Andocken: Titan-Raffinerie', 'Titan-Raffinerie'),
    ],
    log: 'Bei Titan von falschen SOLPOL-Streifen überfallen. Nachtigalls Übertragung liegt in meinem Bordrechner: Konto 7-Null, Kreditbank Sol.',
    news: 'SOLNET: Schießerei bei Titan. SOLPOL dementiert, dass eigene Schiffe beteiligt waren.',
    next: () => ['nest', 'bote', 'schweigegeld'],
    announce: 'Auf der Titan-Raffinerie warten drei Leute auf dich. Wem du folgst, entscheidet, wie es weitergeht.',
  },

  // ===== The choice at Titan ===========================================================================
  nest: {
    title: 'Hades-Nest', giver: RHEE, station: 'Titan-Raffinerie', reward: 14000, danger: 5, exclusive: 'scheideweg', choice: 'SOLPOL',
    text: 'Das Hades-Nest, das Hauptquartier des Aschebunds. Davor liegt ihr Träger, die Schwarze Sonne, mit Mara Voss an Bord. Meine Einsatzgruppe schlägt in wenigen Minuten zu, aber wir brauchen jeden Piloten. Rüsten Sie auf. Das wird kein Spaziergang.',
    talk: ({ offer, g }) => ({
      start: {
        text: g.story.has('nachtigall_lebt') ? 'Sie haben Nachtigall gerettet und eine falsche Streife zerlegt. Das spricht sich herum, leider auch bei den Falschen. Ich schlage jetzt zu, bevor sie es tun.' : 'Nachtigall ist tot, und wer immer diese Uniformen trägt, hat Angst vor dem, was er wusste. Ich schlage jetzt zu, bevor sie noch mehr Spuren verwischen.',
        options: [
          { label: 'Und die Bank? Konto 7-Null?', go: 'bank' },
          { label: 'Wie sieht der Plan aus?', go: 'offer' },
          { label: 'Ich höre mich erst um.', close: true },
        ],
      },
      bank: {
        text: 'Eins nach dem anderen. Gegen eine Bank brauche ich Aussagen, keine Zahlen auf einem Kurierchip. Voss hat Aussagen. Wenn sie überlebt. Holen Sie sie mir lebend, wenn Sie können.',
        options: [{ label: 'Wie sieht der Plan aus?', go: 'offer' }, { label: 'Ich höre mich erst um.', close: true }],
      },
      offer: {
        text: offer.text,
        options: [{ label: 'Ich fliege mit.', accept: true, hint: 'Entscheidung: SOLPOL' }, { label: 'Ich höre mich erst um.', close: true }],
      },
    }),
    onAccept: (g) => {
      g.story.set('path', 'gesetz');
      g.story.changeRep({ police: 10, pirate: -15, bank: -10 });
      g.story.log('Ich habe mich für Rhee entschieden. Für das Gesetz, oder was davon übrig ist.');
    },
    prepare: (M, m) => {
      const nest = M.station('Hades-Nest').mesh.position;
      const toSun = nest.clone().negate().setY(0).normalize().multiplyScalar(1200);
      m.spot = { anchor: 'Hades-Nest', off: [toSun.x, 30, toSun.z] };
      M.game.discover('Hades-Nest');
    },
    objectives: ({ g, m, M, goTo, rt, say, ask }) => [
      goTo('Sammelpunkt: Hades-Nest', m.spot, 900, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        const nest = M.station('Hades-Nest');
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
        const strike = g.encounters.spawnWing(['cutter', 'patrol', 'patrol', 'patrol'], at.clone().add(V(-80, 10, 80)), { kind: 'police', mode: 'patrol', mission: m.id, lookAt: queen.pos, level: 1.1, ally: true });
        strike.ships.forEach((c) => { c.ally = true; c.attack(queen); });
        r.strike = strike.ships;
        r.waveTimer = 8;
        r.phase = 0;
        g.setTarget(queen);
        say(VOSS, 'Inspektorin Rhee schickt mir einen Frachterpiloten? Ich bin beinahe gekränkt. Alle Staffeln: Macht sie nieder!', { urgent: true, duration: 7000 });
        say(RHEE, 'Das ist sie. Konzentrieren Sie das Feuer auf den Träger! Sobald er fällt, fallen auch die Türme.', { duration: 7000 });
      }),
      {
        label: 'Träger Schwarze Sonne stoppen', track: () => (rt().queen ? [rt().queen] : []),
        check: () => rt().queen && (!rt().queen.alive || rt().queen.surrendered),
        tick: (dt) => {
          const r = rt();
          if (!r.queen || !r.queen.alive || r.queen.surrendered) return;
          r.waveTimer -= dt;
          const pirates = g.npcs.count((n) => n.faction === 'pirate' && n.mission === m.id && n.typeKey !== 'turret' && n.typeKey !== 'queen');
          if (r.waveTimer <= 0 && pirates < 5 && r.phase < 3) {
            r.waveTimer = 24;
            const comp = g.ship.powerLevel() > 0.45 ? ['jackal', 'jackal', 'crow'] : ['jackal', 'crow', 'crow'];
            const launch = r.queen.pos.clone().add(V(rand(-30, 30), 22, rand(-30, 30)));
            const wing = g.encounters.spawnWing(comp, launch, { kind: 'pirates', raider: true, mission: m.id, lookAt: g.ship.position });
            wing.group.aggro = true;
            wing.ships.forEach((p, i) => p.attack(i === 0 || !(r.strike || []).some((c) => c.alive) ? g.ship : r.strike.find((c) => c.alive)));
          }
          const k = hp(r.queen);
          if (r.phase === 0 && k < 0.66) {
            r.phase = 1;
            say(VOSS, 'Das ist alles? Ich habe schon Kreditraten gezahlt, die mir mehr wehgetan haben!', { urgent: true, duration: 5000 });
          } else if (r.phase === 1 && k < 0.38) {
            r.phase = 2;
            say(VOSS, 'Reaktor kritisch?! Reißt euch zusammen! Wenn ich falle, reiße ich dich mit, Frachterpilot!', { urgent: true, duration: 5000 });
            const reinforce = g.encounters.spawnWing(['patrol', 'patrol'], g.solarSystem.pushClear(g.ship.position.clone().add(V(200, 40, 200)), 40), { kind: 'police', mission: m.id, lookAt: r.queen.pos, ally: true });
            reinforce.ships.forEach((c) => { c.ally = true; c.attack(r.queen); });
          } else if (r.phase === 2 && k < 0.18) {
            r.phase = 3;
            ask(VOSS, 'Genug! Genug... Ich ergebe mich. Und hör gut zu, Frachterpilot: Ich weiß, wer uns die Routen verkauft hat. Hollmann. Lass mich leben, und ich sage aus.', [
              { label: 'Triebwerke aus, Voss. Sie sind verhaftet.', run: () => {
                const group = r.queen.wing;
                surrender(group ? group.members : [r.queen]);
                g.npcs.ships.forEach((n) => { if (n.mission === m.id && n.faction === 'pirate') { surrender([n]); n.jumpOut(); } });
                r.queen.surrendered = true;
                g.story.set('voss_gefangen');
                g.story.stats.spared++;
                g.story.gain('reden', 30);
                say(RHEE, 'Feuer einstellen, alle! Die Schwarze Sonne ergibt sich. Gute Arbeit, Pilot. Lebend ist sie mir hundertmal mehr wert.', { urgent: true, duration: 8000 });
              } },
              { label: 'Kein Handel, Voss.', run: () => say(VOSS, 'Dann fahr mit mir zur Hölle!', { urgent: true, duration: 4000 }) },
            ], { timeout: 14000, onTimeout: () => say(VOSS, 'Keine Antwort ist auch eine Antwort. Feuer!', { urgent: true, duration: 4000 }) });
          }
        },
        done: () => {
          const r = rt();
          if (!r.queen.surrendered) {
            g.story.set('voss_tot');
            say(RHEE, 'Die Schwarze Sonne ist gefallen. Voss ist tot, und mit ihr ihre Aussage. Trotzdem: Der Aschebund ist kopflos. Kommen Sie zur Erde-Station, da wartet noch jemand auf Erklärungen.', { urgent: true, duration: 11000 });
          } else {
            say(RHEE, 'Voss sitzt in meiner Arrestzelle und redet schon. Kommen Sie zur Erde-Station, Pilot. Es geht um die falschen Uniformen.', { duration: 9000 });
          }
        },
      },
    ],
    news: 'SOLNET: Großeinsatz am Hades-Nest. Der Träger Schwarze Sonne ist gefallen, der Aschebund kopflos.',
    log: 'Mit Rhees Einsatzgruppe die Schwarze Sonne gestoppt.',
    next: () => ['maulwurf'],
  },

  bote: {
    title: 'Ein Bote aus der Asche', giver: BOTE, station: 'Titan-Raffinerie', reward: 3000, danger: 2, exclusive: 'scheideweg', choice: 'Aschebund', room: 'bar',
    text: 'Mara Voss will reden. Nicht schießen, reden. Sie sagt, die Uniformen bei Titan gehören nicht ihr. Und sie sagt, deine erste Rate war kein Zufall. Flieg zum Hades-Nest, man lässt dich andocken.',
    talk: ({ offer }) => ({
      start: {
        text: 'Psst. Du. Der Frachterpilot mit dem Glück. Mara Voss will mit dir reden. Nicht schießen: reden.',
        options: [
          { label: 'Warum sollte ich Voss trauen?', go: 'trauen' },
          { label: 'Was will sie?', go: 'offer' },
          { label: 'Verschwinde.', close: true },
        ],
      },
      trauen: {
        text: 'Solltest du nicht. Aber die Uniformen bei Titan gehören nicht uns, und das weißt du. Und sie sagt, sie weiß, warum die Krähen am Mars so pünktlich waren, als du deine erste Rate geflogen bist.',
        options: [{ label: 'Was will sie?', go: 'offer' }, { label: 'Verschwinde.', close: true }],
      },
      offer: {
        text: offer.text,
        options: [{ label: 'Bring mich zu ihr.', accept: true, hint: 'Entscheidung: Aschebund' }, { label: 'Ich überlege es mir.', close: true }],
      },
    }),
    onAccept: (g) => {
      g.story.set('path', 'asche');
      g.law.rep.pirate = Math.max(g.law.rep.pirate, 45);
      g.story.changeRep({ police: -15, bank: -10, guild: 5 });
      g.discover('Hades-Nest');
      g.story.log('Ich fliege zum Hades-Nest. Mara Voss will reden, und ich will hören, was sie weiß.');
      g.comm.say('Sie gehen zu Voss? Ich hoffe, Sie wissen, was Sie tun. Ich werde das nicht vergessen.', { ...RHEE, duration: 8000 });
    },
    objectives: ({ dock }) => [dock('Zum Hades-Nest fliegen und andocken', 'Hades-Nest')],
    log: 'Im Hades-Nest angedockt. Niemand hat auf mich geschossen. Noch nicht.',
    next: () => ['geldtransport'],
  },

  schweigegeld: {
    title: 'Schweigegeld', giver: GRAU, station: 'Titan-Raffinerie', reward: 20000, danger: 1, exclusive: 'scheideweg', choice: 'Kreditbank', room: 'bar',
    text: 'Ihre Restschuld: gestrichen. Dazu 20.000 Credits. Gegen Nachtigalls Übertragung in Ihrem Bordrechner, und gegen Ihr Gedächtnis. Bringen Sie die Daten persönlich in die Wolkenstadt. Herr Hollmann erwartet Sie.',
    talk: ({ offer, g }) => ({
      start: {
        text: 'Herr Grau, Kreditbank Sol. Herr Hollmann lässt grüßen. Er ist ein vernünftiger Mann, und er hält Sie für einen vernünftigen Piloten.',
        options: [
          { label: 'Was bietet er?', go: 'offer' },
          { label: 'Und wenn ich ablehne?', go: 'drohung' },
          { label: 'Ich rede nicht mit der Bank.', close: true },
        ],
      },
      drohung: {
        text: 'Dann fliegen Sie weiter für Inspektorin Rhee. Mit 40.000 Credits Schulden bei uns. Viele von Rhees Piloten fliegen nicht sehr lange, und ihre Schiffe kommen immer zu uns zurück.',
        options: [{ label: 'Was bietet er?', go: 'offer' }, { label: 'Ich rede nicht mit der Bank.', close: true }],
      },
      offer: {
        text: offer.text,
        options: [
          { label: 'Vierzigtausend. Mein Gedächtnis ist sehr gut.', need: ['handel', 3], if: () => !g.story.has('grau_doppelt'), go: 'doppelt', run: () => { g.story.set('grau_doppelt'); offer.reward = 40000; } },
          { label: 'Abgemacht.', accept: true, hint: 'Entscheidung: Kreditbank' },
          { label: 'Nein.', close: true },
        ],
      },
      doppelt: {
        text: 'Herr Grau lächelt zum ersten Mal, und es ist kein schönes Lächeln. „Vierzigtausend. Herr Hollmann schätzt Geschäftssinn."',
        options: [{ label: 'Abgemacht.', accept: true, hint: 'Entscheidung: Kreditbank' }, { label: 'Ich überlege es mir.', close: true }],
      },
    }),
    onAccept: (g) => {
      g.story.set('path', 'bank');
      g.story.changeRep({ bank: 40, police: -20, guild: -15 });
      g.story.log('Ich habe mich an die Bank verkauft. Die Schulden sind weg, sobald ich Nachtigalls Daten in die Wolkenstadt bringe.');
    },
    objectives: ({ dock }) => [dock('Nachtigalls Daten in die Wolkenstadt bringen', 'Venus Wolkenstadt')],
    onComplete: (g) => {
      g.ship.debt = 0;
      g.hud.toast('Kredit gestrichen: Die SOL 4471 gehört dir', 'gain');
      setTimeout(() => g.comm.say('Die Daten von Nachtigall sind verschwunden, und Sie auch. Ich hoffe, es war es wert, Pilot.', { ...RHEE, duration: 9000 }), 4000);
    },
    log: 'Die Daten der Bank übergeben. Das Schiff ist bezahlt. Es fühlt sich nicht so an.',
    next: () => ['falle'],
  },

  // ===== Path: SOLPOL ===================================================================================
  maulwurf: {
    title: 'Der Maulwurf', giver: RHEE, station: 'Erde Orbital-Station', reward: 12000, danger: 4,
    text: 'Die Transpondercodes der falschen Streifen führen zu Oberst Kessler, meinem eigenen Vorgesetzten. Kessler hat vor einer Stunde die Erde verlassen, mit seiner ganzen Staffel, Kurs Venus. Halten Sie ihn auf, bevor er in der Wolkenstadt untertaucht. Ich komme nach.',
    talk: ({ offer, g }) => ({
      start: {
        text: g.story.has('voss_gefangen')
          ? 'Voss redet, und zwar viel. Die falschen Streifen gehören Oberst Kessler, sagt sie, und Kessler gehört Hollmann. Kessler ist mein Vorgesetzter, Pilot.'
          : 'Ohne Voss habe ich keine Zeugin. Aber ich habe die Transpondercodes der falschen Streifen. Sie führen zu Oberst Kessler. Meinem Vorgesetzten.',
        options: [{ label: 'Was haben Sie vor?', go: 'offer' }, { label: 'Später.', close: true }],
      },
      offer: { text: offer.text, options: [{ label: `Ich hole ihn mir (${fmt(offer.reward)} Cr)`, accept: true }, { label: 'Später.', close: true }] },
    }),
    prepare: (M, m) => { m.spot = M.makeSpot('Venus', 500); },
    objectives: ({ g, m, M, goTo, dock, rt, say, ask }) => [
      goTo('Kesslers Staffel abfangen: Venus', m.spot, 750, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        const w = turncoats(g, m, ['cutter', 'patrol', 'patrol', 'patrol'], at, { level: 1.15 });
        w.leader.name = 'ZOLLKUTTER KESSLER';
        w.leader.bounty = 6000;
        w.leader.fearless = true;
        w.group.aggro = true;
        w.ships.forEach((p) => p.attack(g.ship));
        r.kessler = w.leader;
        r.spawned = w.ships;
        r.helpTimer = 14;
        g.setTarget(w.leader);
        say(KESSLER, 'Rhee schickt einen Frachterpiloten hinter mir her? Natürlich. Sie hatte schon immer mehr Mut als Verstand. Staffel: Ziel bekämpfen.', { urgent: true, duration: 7000 });
      }),
      {
        label: 'Oberst Kessler stoppen', track: () => (rt().spawned || []).filter((n) => n.alive && !n.surrendered),
        check: () => rt().kessler && (!rt().kessler.alive || rt().kessler.surrendered),
        tick: (dt) => {
          const r = rt();
          if (!r.kessler) return;
          if (r.helpTimer > 0) {
            r.helpTimer -= dt;
            if (r.helpTimer <= 0) {
              const help = allies(g, m, ['cutter', 'patrol'], g.solarSystem.pushClear(g.ship.position.clone().add(V(-150, 30, 150)), 40), 'police', r.kessler.pos);
              help.leader.name = 'ZOLLKUTTER RHEE';
              help.ships.forEach((c) => c.attack(r.kessler));
              say(RHEE, 'Hier Rhee! Ich bin da. Kessler, Sie sind Ihres Amtes enthoben. Ergeben Sie sich!', { urgent: true, duration: 6000 });
            }
          }
          if (!r.asked && r.kessler.alive && hp(r.kessler) < 0.25) {
            r.asked = true;
            ask(KESSLER, 'Schon gut! Schon gut! Ich ergebe mich. Ich sage gegen Hollmann aus, alles, jede Zahlung, jeden Namen. Aber lasst mich leben!', [
              { label: 'Triebwerke aus, Oberst.', run: () => {
                surrender([r.kessler]);
                (r.spawned || []).forEach((n) => { if (n.alive && n !== r.kessler) n.jumpOut(); });
                g.story.set('kessler_aussage');
                g.story.stats.spared++;
                g.story.gain('reden', 30);
                say(RHEE, 'Kessler ergibt sich. Ich übernehme ihn. Pilot... danke.', { urgent: true, duration: 6000 });
              } },
              { label: 'Zu spät, Oberst.', run: () => say(KESSLER, 'Dann sterben Sie mit mir!', { urgent: true, duration: 3500 }) },
            ], { timeout: 12000 });
          }
        },
        done: () => {
          if (!g.story.has('kessler_aussage')) g.story.set('kessler_tot');
          say(RHEE, 'Hollmann sitzt in der Wolkenstadt und weiß jetzt, dass wir kommen. Docken Sie dort an, ich treffe Sie im Revier.', { duration: 9000 });
        },
      },
      dock('Andocken: Venus-Wolkenstadt', 'Venus Wolkenstadt'),
    ],
    news: 'SOLNET: SOLPOL-Oberst Kessler nach Gefecht über der Venus festgesetzt. Interne Ermittlungen laufen.',
    log: 'Oberst Kessler gestellt, den Mann hinter den falschen Uniformen.',
    next: () => ['wolkenstadt'],
  },

  // ===== Path: Aschebund ================================================================================
  geldtransport: {
    title: 'Tresor 7', giver: VOSS, station: 'Hades-Nest', reward: 15000, danger: 4, room: 'bar',
    text: 'Die Bank bringt das Kontobuch von Konto 7-Null von Ceres zur Venus. Ein Geldtransporter, Tresor 7, mit Kesslers Staffel als Geleit. Wir holen es uns, am Mars. Du fliegst vorne, meine Leute decken dich. Mit dem Buch in der Hand kann uns keiner mehr Piraten nennen. Na gut, weniger Leute.',
    talk: ({ offer }) => ({
      start: {
        text: 'Da ist er ja, Rhees Lieblingspilot. Setz dich. Du willst wissen, was mit deiner ersten Rate war? Hollmann hat uns die Route verkauft, bevor du abgelegt hast. Ein Test, ob meine Krähen pünktlich sind und ob du zahlst oder stirbst. Du hast beides nicht getan. Das hat mir gefallen.',
        options: [
          { label: 'Warum arbeitet eine Bank mit Piraten?', go: 'warum' },
          { label: 'Und die falschen Streifen?', go: 'kessler' },
          { label: 'Was willst du von mir?', go: 'offer' },
        ],
      },
      warum: {
        text: 'Weil Piraten Frachter versenken und Bergleute pleitegehen. Pleite Bergleute verkaufen ihre Schürfrechte. An wen? Rate mal. Ich war Bergfrau auf Ceres, bis die Bank mein Schiff holte. Der Aschebund ist das, was übrig bleibt, wenn man Leuten alles nimmt außer ihren Waffen.',
        options: [{ label: 'Und die falschen Streifen?', go: 'kessler' }, { label: 'Was willst du von mir?', go: 'offer' }],
      },
      kessler: {
        text: 'Oberst Kessler. SOLPOL-Uniform, Bankgehalt. Seine Staffel räumt auf, wenn wir zu laut werden oder zu viel wissen. Bei Titan wollten sie Nachtigall. Und dich gleich mit.',
        options: [{ label: 'Warum arbeitet eine Bank mit Piraten?', go: 'warum' }, { label: 'Was willst du von mir?', go: 'offer' }],
      },
      offer: { text: offer.text, options: [{ label: `Ich fliege vorne (${fmt(offer.reward)} Cr)`, accept: true }, { label: 'Später.', close: true }] },
    }),
    prepare: (M, m) => { m.spot = M.makeSpot('Mars', 700); },
    objectives: ({ g, m, M, goTo, dock, rt, say }) => [
      goTo('Tresor 7 abfangen: Mars', m.spot, 800, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        const away = g.solarSystem.pushClear(at.clone().add(V(rand(-1, 1), 0, rand(-1, 1)).setLength(2400)), 80);
        r.transport = g.npcs.arrive('freighter', at.clone().add(V(30, 0, -40)), { mission: m.id, faction: 'rogue', look: 'civil', mode: 'goto', dest: away, arriveRange: 40, slowArrival: false, lookAt: away, name: 'GELDTRANSPORTER TRESOR 7', fearless: true, bounty: 0, speed: 10 });
        r.transport.maxHull = r.transport.hull = r.transport.hull * 2.2;
        r.transport.maxSpeed = 14;
        r.transport.home.onArrive = () => { r.escaped = true; r.transport.jumpOut(); };
        const esc = turncoats(g, m, ['cutter', 'patrol', 'patrol'], at.clone().add(V(-40, 10, 30)), { level: 1.1 });
        esc.group.aggro = true;
        esc.ships.forEach((p) => p.attack(g.ship));
        r.escort = esc.ships;
        const crew = allies(g, m, ['jackal', 'crow', 'crow'], g.solarSystem.pushClear(g.ship.position.clone().add(V(-90, 20, 90)), 40), 'pirate', at);
        crew.leader.name = 'SCHAKAL ASCHEFAUST';
        crew.ships.forEach((p, i) => p.attack(esc.ships[i % esc.ships.length]));
        r.spawned = [r.transport, ...esc.ships];
        g.setTarget(r.transport);
        say(VOSS, 'Da ist er, fett und langsam. Kümmer dich um den Transporter, meine Leute nehmen die Uniformen. Schieß ihn nicht in Stücke, ich will das Buch!', { urgent: true, duration: 7000 });
      }),
      {
        label: 'Tresor 7 stoppen, bevor er springt', track: () => (rt().transport && rt().transport.alive ? [rt().transport] : []),
        check: () => rt().dropped === true,
        tick: () => {
          const r = rt();
          if (!r.transport) return;
          if (r.escaped) { M.fail(m, 'Tresor 7 ist entkommen.'); return; }
          if (r.transport.alive) r.lastPos = r.transport.pos.clone();
          const escortsDown = (r.escort || []).every((n) => !n.alive);
          if (!r.dropped && (!r.transport.alive || hp(r.transport) < 0.45 || (escortsDown && hp(r.transport) < 0.8))) {
            r.dropped = true;
            const pos = r.lastPos || g.ship.position.clone();
            if (r.transport.alive) {
              surrender([r.transport]);
              r.transport.jumpOut();
              say({ speaker: 'Tresor 7', faction: 'civil', seed: 77 }, 'Nicht schießen! Wir werfen die Fracht ab! Wir sind nur Fahrer!', { urgent: true, duration: 4500 });
            }
            r.book = g.spawnLoot(pos.clone().add(V(0, 3, 0)), null, 0, 0, { special: 'Kontobuch 7-Null', onCollect: () => { r.collected = true; } });
            r.book.life = 900;
            g.setTarget({ kind: 'waypoint', name: 'KONTOBUCH', mesh: r.book.group });
          }
        },
      },
      { label: 'Kontobuch mit dem Traktorstrahl bergen [B]', check: () => rt().collected === true || !rt().book },
      dock('Kontobuch zum Hades-Nest bringen', 'Hades-Nest'),
    ],
    onComplete: (g) => { g.story.set('kontobuch'); g.story.changeRep({ pirate: 15, guild: 10, bank: -20 }); },
    news: 'SOLNET: Geldtransport der Kreditbank Sol am Mars überfallen. Die Bank spricht von „unbedeutenden Unterlagen".',
    log: 'Das Kontobuch von Konto 7-Null erbeutet. Jede Zahlung an den Aschebund, jede an Kessler. Alles mit Hollmanns Kürzel.',
    next: () => ['wolkenstadt'],
  },

  // ===== Path: Kreditbank ===============================================================================
  falle: {
    title: 'Die Falle', giver: HOLLMANN, station: 'Venus Wolkenstadt', reward: 25000, danger: 4, room: 'bar',
    text: 'Rhee gibt nicht auf. Sie fliegt Streife am Mars. Oberst Kesslers Männer kümmern sich um den Rest; Sie funken Rhee nur an und sagen, Sie hätten Nachtigalls Daten noch. Sie wird kommen. Sie kommt immer.',
    talk: ({ offer }) => ({
      start: {
        text: 'Mein neuer Lieblingspilot. Setzen Sie sich, die Aussicht ist das Teuerste hier. Ein letztes Problem noch, dann sind wir Partner: Inspektorin Rhee.',
        options: [
          { label: 'Was soll ich tun?', go: 'offer' },
          { label: 'Warum ich?', go: 'warum' },
          { label: 'Später.', close: true },
        ],
      },
      warum: {
        text: 'Weil Rhee Ihnen vertraut. Weil Sie ein Frachterpilot mit einem bezahlten Schiff sind, und weil Sie das bleiben möchten. Glauben Sie mir, ich kenne meine Kunden.',
        options: [{ label: 'Was soll ich tun?', go: 'offer' }, { label: 'Später.', close: true }],
      },
      offer: { text: offer.text, options: [{ label: 'Ich mach es.', accept: true }, { label: 'Später.', close: true }] },
    }),
    prepare: (M, m) => { m.spot = M.makeSpot('Mars', 600); },
    objectives: ({ g, m, M, goTo, rt, say, ask }) => [
      goTo('Zum Treffpunkt mit Rhee: Mars', m.spot, 650, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        const w = allies(g, m, ['cutter', 'patrol'], at.clone().add(V(60, 5, -60)), 'police', g.ship.position);
        w.leader.name = 'ZOLLKUTTER RHEE';
        w.ships.forEach((s) => { s.mode = s.home.mode = 'idle'; });
        r.rhee = w.ships;
        r.talkTimer = 5;
        g.setTarget(w.leader);
        say(RHEE, 'Sie haben Nerven, mich anzufunken, nach dem, was Sie getan haben. Also? Wo sind die Daten?', { urgent: true, duration: 6000 });
      }),
      {
        label: 'Entscheiden', track: () => (rt().kessler || []).filter((n) => n.alive),
        check: () => {
          const r = rt();
          if (!r.kessler) return false;
          const rheeAlive = r.rhee.some((n) => n.alive);
          const kesslerAlive = r.kessler.some((n) => n.alive);
          return !rheeAlive || !kesslerAlive;
        },
        tick: (dt) => {
          const r = rt();
          if (!r.rhee || r.decided) return;
          r.talkTimer -= dt;
          if (r.talkTimer > 0) return;
          r.decided = true;
          const arrive = (truce) => {
            const at = g.solarSystem.pushClear(r.rhee[0].pos.clone().add(V(rand(-1, 1), 0.2, rand(-1, 1)).setLength(380)), 40);
            const w = turncoats(g, m, ['cutter', 'patrol', 'patrol', 'patrol'], at, { level: 1.1 });
            w.leader.name = 'ZOLLKUTTER KESSLER';
            w.group.aggro = !truce;
            w.group.truce = truce;
            w.ships.forEach((p, i) => p.attack(truce || i % 2 ? r.rhee[0] : g.ship));
            r.kessler = w.ships;
          };
          ask(null, 'Rhee wartet auf eine Antwort. Auf dem Langstreckenscanner tauchen vier SOLPOL-Signaturen auf. Kesslers Staffel.', [
            { label: 'Rhee, das ist eine Falle! Kessler kommt!', run: () => {
              g.story.set('doppelspiel');
              g.story.changeRep({ police: 25, bank: -60 });
              arrive(false);
              r.rhee.forEach((s) => { s.mode = s.home.mode = 'patrol'; });
              say(RHEE, 'Was?! ... Verstanden. Alle Schiffe: Feuer frei auf die falschen Streifen! Und Sie, Pilot, Sie bleiben an meiner Seite.', { urgent: true, duration: 7000 });
            } },
            { label: '(Schweigen)', run: () => {
              arrive(true);
              say(RHEE, 'Kessler?! Sie... Sie haben mich verkauft. Hoffentlich war es das wert.', { urgent: true, duration: 6000 });
            } },
          ], { timeout: 20000, onTimeout: () => { arrive(true); say(RHEE, 'Kessler?! Sie haben mich verkauft!', { urgent: true, duration: 5000 }); } });
        },
        done: () => {
          const r = rt();
          if (r.rhee.some((n) => n.alive)) {
            if (!g.story.has('doppelspiel')) { g.story.set('doppelspiel'); g.story.set('spaete_reue'); g.story.changeRep({ police: 15, bank: -60 }); }
            (r.kessler || []).forEach((n) => { if (n.alive) n.jumpOut(); });
            say(RHEE, 'Ich weiß nicht, was Sie sind, Pilot. Aber heute waren Sie auf der richtigen Seite. Hollmann sitzt in der Wolkenstadt. Kommen Sie zum Mars-Posten, wir holen ihn uns.', { urgent: true, duration: 10000 });
          } else {
            g.story.set('rhee_tot');
            g.story.changeRep({ police: -40, bank: 20 });
            (r.kessler || []).forEach((n) => { if (n.alive) n.jumpOut(); });
            say(KESSLER, 'Erledigt. Herr Hollmann wird sehr zufrieden sein. Holen Sie sich Ihren Lohn in der Wolkenstadt.', { urgent: true, duration: 8000 });
          }
        },
      },
    ],
    log: 'Am Mars, bei Rhee, mit Kesslers Staffel im Anflug.',
    next: (g) => (g.story.has('rhee_tot') ? ['teilhaber'] : ['wolkenstadt']),
  },

  teilhaber: {
    title: 'Der Teilhaber', giver: HOLLMANN, station: 'Venus Wolkenstadt', reward: 0, danger: 0, room: 'bar', talkOnly: true,
    text: 'Hollmann erwartet dich.',
    talk: ({ g, finish }) => ({
      start: {
        text: 'Es ist erledigt. Rhee ist tot, Kessler hat aufgeräumt, die Akten sind weg. Mein Glückwunsch. Die Bank braucht Leute wie Sie: Leute, die wissen, was eine Rate ist. Ein Sitz im Aufsichtsrat. Ein Gehalt, von dem Ihr altes Ich nicht zu träumen wagte.',
        options: [
          { label: 'Ich nehme an.', run: () => finish('teilhaber') },
          { label: 'Nein. Ich bin raus.', go: 'nein' },
        ],
      },
      nein: {
        text: 'Hollmann zuckt mit den Schultern. „Wie Sie wollen. Ihr Konto bleibt, Ihr Schiff bleibt. Nur eins: Erinnern Sie sich nie wieder an mich." Er dreht sich zum Fenster und ist für dich schon nicht mehr da.',
        options: [{ label: 'Gehen.', run: () => finish('allein') }],
      },
    }),
    objectives: () => [],
    next: () => [],
  },

  // ===== The finale =====================================================================================
  wolkenstadt: {
    title: 'Die Goldene Rate', reward: 30000, danger: 5,
    giver: (g) => (g.story.path === 'asche' ? VOSS : RHEE),
    station: (g) => (g.story.path === 'asche' ? 'Hades-Nest' : g.story.has('doppelspiel') ? 'Mars Außenposten' : 'Venus Wolkenstadt'),
    room: (g) => (g.story.path === 'asche' ? 'bar' : 'office'),
    text: 'Hollmann weiß, dass wir kommen. Seine Privatjacht, die Goldene Rate, liegt startbereit an der Wolkenstadt, mit allem, was Kessler noch an Schiffen hat. Wenn er springt, sehen wir ihn nie wieder. Diesmal lassen wir ihn nicht entkommen.',
    talk: ({ offer, g }) => {
      const path = g.story.path;
      const intro = path === 'asche'
        ? 'Das Kontobuch ist echt. Jede Zahlung an uns, jede an Kessler, alles mit Hollmanns Kürzel. Er weiß, dass wir es haben, und will sich absetzen. Meine Leute sind bereit. Bist du es?'
        : g.story.has('doppelspiel')
          ? 'Sie haben mir das Leben gerettet, nachdem Sie mich verkauft haben. Darüber reden wir später. Jetzt reden wir über Hollmann.'
          : 'Hier bin ich, wie versprochen. Kessler ist erledigt, und Hollmann weiß es.';
      return {
        start: { text: intro, options: [{ label: 'Was ist der Plan?', go: 'offer' }, { label: 'Später.', close: true }] },
        offer: { text: offer.text, options: [{ label: 'Holen wir ihn uns.', accept: true, hint: 'Finale' }, { label: 'Ich muss mich noch vorbereiten.', close: true }] },
      };
    },
    prepare: (M, m) => { m.spot = M.makeSpot('Venus Wolkenstadt', 320); },
    objectives: ({ g, m, M, goTo, rt, say, ask }) => [
      goTo('Die Goldene Rate abfangen: Venus-Wolkenstadt', m.spot, 600, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        const st = M.station('Venus Wolkenstadt');
        const away = g.solarSystem.pushClear(at.clone().add(at.clone().sub(st.mesh.position).setY(0).normalize().multiplyScalar(2600)), 80);
        const yacht = g.npcs.arrive('cutter', at.clone().add(V(0, 10, 0)), { mission: m.id, faction: 'rogue', look: 'civil', mode: 'goto', dest: away, arriveRange: 40, slowArrival: false, lookAt: away, name: 'JACHT GOLDENE RATE', fearless: true, bounty: 0, level: 1.25, speed: 12 });
        yacht.maxSpeed = 20;
        yacht.home.onArrive = () => { r.escaped = true; yacht.jumpOut(); };
        r.yacht = yacht;
        const kesslerFree = !g.story.has('kessler_aussage') && !g.story.has('kessler_tot');
        const esc = turncoats(g, m, kesslerFree ? ['cutter', 'patrol', 'patrol', 'patrol'] : ['patrol', 'patrol', 'patrol'], at.clone().add(V(-50, 0, 50)), { level: 1.2, prefix: 'BANKSCHUTZ' });
        if (kesslerFree) esc.leader.name = 'ZOLLKUTTER KESSLER';
        esc.group.aggro = true;
        esc.ships.forEach((p) => p.attack(g.ship));
        const friends = g.story.path === 'asche'
          ? allies(g, m, ['brute', 'jackal', 'jackal'], g.solarSystem.pushClear(g.ship.position.clone().add(V(-100, 20, 100)), 40), 'pirate', at)
          : allies(g, m, ['cutter', 'patrol', 'patrol'], g.solarSystem.pushClear(g.ship.position.clone().add(V(-100, 20, 100)), 40), 'police', at);
        friends.leader.name = g.story.path === 'asche' ? 'HADESBARKE VOSS' : 'ZOLLKUTTER RHEE';
        friends.ships.forEach((p, i) => p.attack(esc.ships[i % esc.ships.length]));
        r.spawned = [yacht, ...esc.ships];
        g.setTarget(yacht);
        say(HOLLMANN, 'Ah, mein säumiger Kunde. Sie hätten Ihre Raten einfach weiter zahlen sollen. Bankschutz: Diese Forderung ist hiermit fällig.', { urgent: true, duration: 7000 });
        say(g.story.path === 'asche' ? VOSS : RHEE, 'Die Jacht! Lass ihn nicht springen. Wir halten dir die Uniformen vom Hals!', { duration: 6000 });
      }),
      {
        label: 'Die Goldene Rate stoppen', track: () => (rt().yacht && rt().yacht.alive && !rt().yacht.surrendered ? [rt().yacht] : (rt().spawned || []).filter((n) => n.alive && !n.surrendered)),
        check: () => !!rt().ending,
        tick: () => {
          const r = rt();
          if (!r.yacht || r.ending) return;
          const path = g.story.path;
          const captured = path === 'asche' ? 'freie_flagge' : 'ordnung';
          if (r.escaped && !r.ending) { M.fail(m, 'Hollmann ist entkommen. Er wird es wieder versuchen.'); return; }
          if (!r.yacht.alive) {
            r.ending = path === 'asche' ? 'freie_flagge' : 'vergeltung';
            g.story.set('hollmann_tot');
            return;
          }
          if (!r.asked && hp(r.yacht) < 0.3) {
            r.asked = true;
            const evidence = g.story.has('beweise') || g.story.has('kessler_aussage') || g.story.has('voss_gefangen') || g.story.has('kontobuch');
            ask(HOLLMANN, 'Schon gut! Schon gut. Wir sind doch vernünftige Leute. Hundertfünfzigtausend Credits, sofort, auf Ihr Konto. Und Sie haben mich nie gesehen.', [
              { label: 'Triebwerke aus, Hollmann. Es ist vorbei.', run: () => {
                surrender([r.yacht]);
                (r.spawned || []).forEach((n) => { if (n.alive && n !== r.yacht) n.jumpOut(); });
                r.ending = captured;
                say(path === 'asche' ? VOSS : RHEE, path === 'asche' ? 'Herr Hollmann, willkommen im Aschebund. Als Gefangener.' : 'Konrad Hollmann, Sie sind verhaftet. Und diesmal hat die Bank keine Anwälte im Orbit.', { urgent: true, duration: 7000 });
              } },
              { label: 'Gestehen Sie. Auf offenem Kanal.', disabled: evidence || g.story.check('reden', 4) ? null : 'Beweise oder Reden 4 nötig', run: () => {
                surrender([r.yacht]);
                (r.spawned || []).forEach((n) => { if (n.alive && n !== r.yacht) n.jumpOut(); });
                g.story.set('gestaendnis');
                g.story.gain('reden', 60);
                r.ending = captured;
                say(HOLLMANN, '... Hier spricht Konrad Hollmann, Kreditbank Sol. Ich habe ... die Routen verkauft. Kessler bezahlt. Ich gestehe. Zufrieden?', { urgent: true, duration: 9000 });
                g.story.news('SOLNET: Live-Geständnis über offenem Funk: Kreditbank-Direktor Hollmann gibt Bestechung und Piraterie zu.');
              } },
              { label: 'Abgemacht.', run: () => {
                g.ship.credits += 150000;
                g.story.set('bestochen');
                g.story.changeRep({ police: -30, pirate: -30, bank: 30 });
                r.yacht.home.onArrive = null;
                r.yacht.jumpOut();
                (r.spawned || []).forEach((n) => { if (n.alive) n.jumpOut(); });
                r.ending = 'preis';
                g.hud.toast('+150.000 Cr', 'gain');
                sfx.coin();
                say(path === 'asche' ? VOSS : RHEE, path === 'asche' ? 'Du lässt ihn laufen? Für Geld? Dann bist du genau wie er.' : 'Sie lassen ihn springen? ... Ich hätte es wissen müssen.', { urgent: true, duration: 7000 });
              } },
              { label: 'Nein. Feuer.', run: () => say(HOLLMANN, 'Das werden Sie bereuen!', { urgent: true, duration: 3000 }) },
            ], { timeout: 20000 });
          }
        },
        done: () => {
          const r = rt();
          setTimeout(() => g.story.finish(r.ending), 6000);
        },
      },
    ],
    log: 'Über der Wolkenstadt, Hollmann vor den Geschützen.',
    next: () => [],
  },
};

// ----- side quests ------------------------------------------------------------------------------------

export const SIDE = {
  // Jo's brother in the Aschebund
  ade: {
    title: 'Ades Staffel', giver: 'Jo Okafor', faction: 'civil', seed: 1201, reward: 2500, danger: 2,
    text: 'Mein Bruder Ade fliegt beim Aschebund. Seine Staffel lauert draußen bei der Ceres-Mine. Bevor SOLPOL ihn erwischt, will ich ihn da rausholen. Lebend, bitte.',
    prepare: (M, m) => { m.spot = M.makeSpot('Ceres-Mine', 900); },
    objectives: ({ g, m, M, goTo, rt, say, ask }) => [
      goTo('Ades Staffel finden: Ceres-Mine', m.spot, 600, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        const w = g.encounters.spawnWing(['jackal', 'crow', 'crow'], at, { kind: 'pirates', mission: m.id, lookAt: g.ship.position, mode: 'patrol' });
        w.group.truce = true;
        w.leader.name = 'SCHAKAL ADE OKAFOR';
        w.leader.fearless = true;
        r.ade = w.leader;
        r.wing = w;
        r.spawned = w.ships;
        g.setTarget(w.leader);
        const jo = { speaker: 'Jo Okafor', faction: 'civil', seed: 1201 };
        const talk = { speaker: w.leader.name, faction: 'pirate', seed: 1202 };
        const free = () => {
          r.freed = true;
          g.story.set('ade_raus');
          w.ships.forEach((s) => s.jumpOut());
          say(talk, 'Ich flieg nach Ceres und meld mich bei der Gilde. Sag Jo... sag ihr danke.', { urgent: true, duration: 6000 });
          say(jo, 'Er ist raus. Er ist wirklich raus. Ich schulde dir was, Käpt\'n.', { duration: 6000 });
        };
        const fight = () => {
          w.group.truce = false;
          w.group.aggro = true;
          w.ships.forEach((s) => s.attack(g.ship));
          say(talk, 'Dann komm doch her!', { urgent: true, duration: 3000 });
        };
        ask(talk, 'Okafor? Die Jo? Sie fliegt mit dir? Was willst du, Frachter?', [
          { label: 'Ade, Jo ist an Bord. Sie will dich zurück.', disabled: g.story.check('reden', 2) ? null : 'Reden 2 nötig', run: () => { g.story.gain('reden', 30); free(); } },
          { label: 'Jo, sprich du mit ihm.', disabled: g.crew && g.crew.loyalty('jo') >= 70 ? null : 'Jo muss dir sehr vertrauen', run: () => { say(jo, 'Ade, du Idiot. Komm nach Hause. Mama fragt jeden Tag.', { urgent: true, duration: 5000 }); setTimeout(free, 3000); } },
          { label: 'Ergib dich, oder ich hole dich raus.', run: fight },
        ], { timeout: 18000, onTimeout: fight });
      }),
      {
        label: 'Ade aus dem Aschebund holen', track: () => (rt().ade && rt().ade.alive ? [rt().ade] : []),
        check: () => rt().freed || (rt().ade && !rt().ade.alive),
        tick: () => {
          const r = rt();
          if (r.ade && r.ade.alive && !r.freed && !r.ade.surrendered && hp(r.ade) < 0.35 && !r.wing.group.truce) {
            surrender([r.ade]);
            r.freed = true;
            g.story.set('ade_raus');
            g.story.set('ade_verletzt');
            r.ade.jumpOut();
            say({ speaker: 'Ade Okafor', faction: 'pirate', seed: 1202 }, 'Aufhören! Ich komme mit! Ich komme ja mit...', { urgent: true, duration: 5000 });
          }
        },
        done: () => {
          const r = rt();
          if (!r.freed) {
            g.story.set('ade_tot');
            if (g.crew) g.crew.adjust('jo', -60, 'Du hast meinen Bruder umgebracht. Ich steig beim nächsten Halt aus.');
          }
        },
      },
    ],
    onComplete: (g) => {
      if (!g.story.has('ade_raus') || !g.crew) return;
      g.crew.adjust('jo', g.story.has('ade_verletzt') ? 10 : 20);
      const ship = g.ship;
      if (ship.upgrades.engine < 4) {
        ship.upgrades.engine++;
        ship.applyUpgrades();
        g.hud.toast(`Jo baut dir das Triebwerk um: Ionentriebwerk Stufe ${ship.upgrades.engine}`, 'gain');
      } else {
        ship.credits += 6000;
        g.hud.toast('Jo gibt dir ihre Ersparnisse: +6.000 Cr', 'gain');
      }
    },
    log: 'Ade Okafor aus dem Aschebund geholt.',
  },

  // Teo's lost ship
  kranich: {
    title: 'Das Wrack der Kranich', giver: 'Teodor Brandl', faction: 'civil', seed: 1301, reward: 2000, danger: 1,
    text: 'Vor elf Jahren habe ich die Kranich bei Triton verloren, meine Mannschaft auch. Offiziell: Reaktorausfall. Ich habe das nie geglaubt. Das Wrack treibt noch dort draußen. Ich will wissen, was wirklich passiert ist.',
    prepare: (M, m) => { m.spot = M.makeSpot('Triton', 500); },
    objectives: ({ g, m, M, goTo, rt, say }) => [
      goTo('Das Wrack der Kranich suchen: Triton', m.spot, 500, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        r.wreck = g.npcs.spawn('freighter', at, { mission: m.id, faction: 'civil', mode: 'idle', name: 'WRACK KRANICH', speed: 0, fearless: true, lookAt: at.clone().add(V(1, 0.3, 0)) });
        r.wreck.maxSpeed = 0.3;
        r.wreck.guns = null;
        g.setTarget(r.wreck);
        say({ speaker: 'Teodor Brandl', faction: 'civil', seed: 1301 }, 'Da ist sie. Mein Gott, sie sieht aus, als hätte sie jemand aufgeschnitten. Flieg näher ran, ganz nah.', { duration: 7000 });
      }),
      {
        label: 'Wrack aus nächster Nähe untersuchen (unter 45 Einheiten)', track: () => (rt().wreck ? [rt().wreck] : []),
        check: () => rt().wreck && rt().wreck.pos.distanceTo(g.ship.position) < 45,
        done: () => {
          const r = rt();
          r.log = g.spawnLoot(r.wreck.pos.clone().add(V(0, 8, 0)), null, 0, 0, { special: 'Logbuch der Kranich', onCollect: () => { r.collected = true; } });
          r.log.life = 900;
          say({ speaker: 'Teodor Brandl', faction: 'civil', seed: 1301 }, 'Die Schleuse ist von außen aufgeschweißt. Das war kein Reaktor. Da treibt der Logbuchrekorder, hol ihn rein!', { duration: 7000 });
        },
      },
      { label: 'Logbuch mit dem Traktorstrahl bergen [B]', check: () => rt().collected === true || !rt().log },
    ],
    onComplete: (g) => {
      g.story.set('kranich_log');
      g.story.log('Logbuch der Kranich: Teos Schiff empfing hinter Neptun ein Signal. Zwei Tage später kam ein Bergungsschiff der „Bergung Sol GmbH", einer Tochter der Kreditbank. Danach brach das Logbuch ab.');
      if (g.crew) g.crew.adjust('teo', 20);
      setTimeout(() => g.comm.say('Bergung Sol. Eine Tochter der Kreditbank. Sie haben meine Leute umgebracht, wegen eines Signals hinter Neptun. Auf Europa gibt es eine Forscherin, Dr. Varga. Sie sollte das hören.', { speaker: 'Teodor Brandl', faction: 'civil', seed: 1301, duration: 10000 }), 2500);
    },
  },

  // Nachtigall's life insurance
  konto: {
    title: 'Die Lebensversicherung', giver: 'Nachtigall', faction: 'civil', seed: 6060, reward: 3000, danger: 3,
    text: 'Ich war Buchhalter bei der Kreditbank, Abteilung Sonderforderungen. Ich habe Konto 7-Null eingerichtet, Gott vergebe mir. Bevor ich floh, habe ich die Originalbuchungen auf einen Datenwürfel kopiert und in einem Felsen bei Ceres versteckt. Holen wir ihn.',
    prepare: (M, m) => { m.spot = M.makeSpot('Ceres-Mine', 1300); },
    objectives: ({ g, m, M, goTo, rt, say }) => [
      goTo('Nachtigalls Versteck: bei der Ceres-Mine', m.spot, 300, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        r.cube = g.spawnLoot(at.clone(), null, 0, 0, { special: 'Datenwürfel', onCollect: () => { r.collected = true; } });
        r.cube.life = 900;
        g.setTarget({ kind: 'waypoint', name: 'DATENWÜRFEL', mesh: r.cube.group });
        say(NACHTIGALL, 'Da, das Blinken in der Felsspalte. Holen Sie ihn rein, und dann nichts wie weg.', { duration: 6000 });
      }),
      { label: 'Datenwürfel bergen [B]', check: () => rt().collected === true || !rt().cube },
      {
        label: 'Bergung-Sol-Schiffe abwehren', checkpoint: false, track: () => rt().spawned || [],
        check: () => rt().spawned && rt().spawned.every((n) => !n.alive),
        start: () => {
          const r = rt();
          const w = turncoats(g, m, ['patrol', 'patrol', 'patrol'], g.encounters.spawnPoint(380, 500), { prefix: 'BERGUNG', look: 'civil' });
          w.group.aggro = true;
          w.ships.forEach((p) => p.attack(g.ship));
          r.spawned = w.ships;
          say({ speaker: w.leader.name, faction: 'civil', seed: 4040 }, 'Hier Bergung Sol. Der Würfel ist Eigentum der Kreditbank. Übergeben Sie ihn, oder wir holen ihn aus dem Wrack.', { urgent: true, duration: 6000 });
        },
      },
    ],
    onComplete: (g) => {
      g.story.set('beweise');
      g.story.log('Nachtigalls Datenwürfel geborgen: die Originalbuchungen von Konto 7-Null, freigegeben von Konrad Hollmann.');
      if (g.crew) g.crew.adjust('nachtigall', 20);
    },
  },

  // The signal beyond Neptune
  sonde: {
    title: 'Das Signal', giver: 'Dr. Ilse Varga', faction: 'civil', seed: 2718, reward: 5000, danger: 2,
    text: 'Hinter Neptun sendet etwas, schwach und regelmäßig, alle 41 Stunden. Ich habe die Koordinaten eingegrenzt. Fliegen Sie hin, scannen Sie es aus nächster Nähe und bringen Sie mir, was Sie finden.',
    prepare: (M, m) => { m.spot = M.makeSpot('Neptune', 1800); },
    objectives: ({ g, m, M, goTo, dock, rt, say }) => [
      goTo('Dem Signal folgen: hinter Neptun', m.spot, 700, () => {
        const r = rt();
        const at = M.spotPos(m.spot);
        r.probe = g.npcs.spawn('courier', at, { mission: m.id, faction: 'civil', mode: 'idle', name: 'UNBEKANNTES OBJEKT', speed: 0, fearless: true, lookAt: at.clone().add(V(0, 1, 0.2)) });
        r.probe.maxSpeed = 0.2;
        r.probe.guns = null;
        r.scan = 0;
        g.setTarget(r.probe);
        say({ speaker: 'Bordcomputer', faction: 'control', seed: 3 }, 'Kontakt. Kein Transponder, keine Wärmesignatur. Das Signal kommt von dort. Annäherung empfohlen: unter 60 Einheiten halten, um zu scannen.', { duration: 8000 });
      }),
      {
        label: 'Objekt scannen: unter 60 Einheiten halten', track: () => (rt().probe ? [rt().probe] : []),
        check: () => rt().scan >= 8,
        tick: (dt) => {
          const r = rt();
          if (!r.probe) return;
          const close = r.probe.pos.distanceTo(g.ship.position) < 60;
          const before = Math.floor(r.scan);
          if (close) r.scan += dt;
          if (close && Math.floor(r.scan) !== before && Math.floor(r.scan) % 2 === 0) g.hud.toast(`Scan ${Math.min(100, Math.round((r.scan / 8) * 100))} %`, 'info');
        },
        done: () => {
          const r = rt();
          g.ship.systems.sensors = Math.max(0.3, g.ship.systems.sensors - 0.2);
          say({ speaker: 'Bordcomputer', faction: 'control', seed: 3 }, 'Scan abgeschlossen. Kennung: AURORA-7, Tiefraumsonde der Erde, gestartet 2089, seit 2104 verschollen. Sie sendet nicht. Sie leitet weiter. Das Signal kommt von weiter draußen.', { urgent: true, duration: 11000 });
          r.core = g.spawnLoot(r.probe.pos.clone().add(V(0, 6, 0)), null, 0, 0, { special: 'Speicherkern der AURORA-7', onCollect: () => { r.collected = true; } });
          r.core.life = 900;
        },
      },
      {
        label: 'Speicherkern der Sonde bergen [B]', track: () => rt().spawned || [],
        check: () => rt().collected === true || !rt().core,
        start: () => {
          const r = rt();
          if (g.story.has('signal_bergung')) return;
          g.story.set('signal_bergung');
          const w = turncoats(g, m, ['patrol', 'patrol'], g.encounters.spawnPoint(420, 520), { prefix: 'BERGUNG', look: 'civil' });
          w.group.aggro = true;
          w.ships.forEach((p) => p.attack(g.ship));
          r.spawned = w.ships;
          say({ speaker: w.leader.name, faction: 'civil', seed: 4040 }, 'Hier Bergung Sol. Dieses Objekt ist Eigentum der Kreditbank. Entfernen Sie sich, oder wir entfernen Sie.', { urgent: true, duration: 6000 });
        },
      },
      dock('Den Speicherkern zur Europa-Station bringen', 'Europa-Station'),
    ],
    onComplete: (g) => {
      g.story.set('signal_kern');
      g.story.log('Die Quelle des Signals: AURORA-7, eine verschollene Sonde der Erde. Sie leitet etwas weiter, das von weiter draußen kommt.');
    },
  },
};
