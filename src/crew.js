import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROOMS, FLOOR_Y } from './shipInterior';
import { sfx } from './sfx';

// The crew: people who fly with you and stand at their posts aboard the SOL 4471. Each brings a skill to the
// ship (repairs, shorter jumps, a silver tongue), has opinions about what you do, a loyalty that follows from it,
// a past to tell about and, once they trust you, a favour to ask. Walk up to them (U, then E) to talk.

const fmt = (n) => Math.round(n).toLocaleString('de-DE');
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export const CREW_DEFS = {
  jo: {
    name: 'Jo Okafor', title: 'Mechanikerin', seed: 1201, faction: 'civil', station: 'Mars Außenposten', cost: 1500, wage: 40,
    post: { x: 1.35, z: 9.0, yaw: -Math.PI / 2, room: ROOMS.engine, block: [1.08, 1.62, 8.74, 9.26] },
    look: { suit: 0xc06a28, legs: 0x3a3c40, skin: 0x6a4630, hair: 0x1a1410 },
    bonus: 'Repariert unterwegs Hülle und Systeme. Technik +1 in Gesprächen.',
    skill: { technik: 1 },
    pitch: 'Jo Okafor, Mechanikerin, frei seit die Gilde meine Werkstatt dichtgemacht hat. Ich flicke dir die Kiste im Flug, nicht erst am Dock. 1.500 Cr Handgeld, 40 pro Andocken. Und ich frage nicht, was du lädst. Meistens.',
    back: [
      'Ich bin auf Ceres aufgewachsen, drei Meter unter dem Eis. Mein Vater hat Bohrköpfe repariert, ich hab ihm die Schrauben gereicht, seit ich laufen kann.',
      'Die Gilde hatte mal vierzig Schiffe. Dann kamen die Überfälle, dann die Bank mit den Pfändungsbescheiden. Heute sind es elf.',
      'Mein kleiner Bruder Ade hat nicht mehr gewartet, bis die Bank auch unser Schiff holt. Er ist zum Aschebund gegangen. Ich red nicht gern drüber.',
      'Weißt du, was ich an Maschinen mag? Sie lügen nicht. Wenn was kaputt ist, hörst du es.',
    ],
    quest: 'ade', questAt: 60,
    questPitch: 'Käpt\'n, hast du kurz Zeit? Komm mal zu mir in den Maschinenraum.',
    ambient: ['Der Reaktor singt heute schön sauber. Hörst du das?', 'Ich hab die Kühlleitung zwei neu verlegt. Frag nicht, wie die vorher gehalten hat.', 'Wenn du wieder so scharf bremst, fliegt mir das Werkzeug durch den Maschinenraum.'],
    places: { Ceres: 'Ceres. Da unten irgendwo ist meine alte Werkstatt.', Mars: 'Mars. Staub in jeder Dichtung, garantiert.' },
  },
  teo: {
    name: 'Teodor Brandl', title: 'Navigator', seed: 1301, faction: 'civil', station: 'Erde Orbital-Station', cost: 2500, wage: 60,
    post: { x: -1.45, z: -3.1, yaw: yawTo(-0.85, -2.2), room: ROOMS.bridge, block: [-1.72, -1.18, -3.38, -2.82] },
    look: { suit: 0x2c3e5a, legs: 0x22262c, skin: 0xd8b49a, hair: 0xb8b8b8 },
    bonus: 'Kürzere, sparsamere Sprünge, seltener aus dem Sprung gerissen. Fliegen +1 in Gesprächen.',
    skill: { flug: 1 },
    pitch: 'Teodor Brandl. Ich bin dreißig Jahre Linie geflogen, die letzten elf als Navigator für andere. Ich rechne Ihnen Sprünge, die ein Viertel weniger Treibstoff fressen. 2.500 Cr, 60 pro Andocken. Und ich fliege nicht für Schmuggler.',
    back: [
      'Ich war Kapitän, wissen Sie. Die Kranich, ein Eisfrachter. Bester Schiffsrumpf, der je aus einer Marswerft kam.',
      'Vor elf Jahren, bei Triton, ist sie verloren gegangen. Mit sechs Leuten an Bord. Ich war im Shuttle unterwegs zur Station. Reaktorausfall, hieß es.',
      'Ich habe nie geglaubt, dass es der Reaktor war. Die Kranich hatte einen neuen. Ich habe ihn selbst abgenommen.',
      'Navigieren ist Vertrauen in Zahlen. Menschen sind schwieriger. Sie haben bisher nicht enttäuscht.',
    ],
    quest: 'kranich', questAt: 55,
    questPitch: 'Kapitän, auf ein Wort? Ich bin auf der Brücke.',
    ambient: ['Kurs liegt sauber an. Wenn Sie wieder springen wollen, die Rechnung ist fertig.', 'Wussten Sie, dass man früher Monate bis zum Jupiter brauchte? Heute beschwert man sich über Minuten.', 'Ich habe den Funkverkehr mitgehört. Die Streifen sind heute nervös.'],
    places: { Jupiter: 'Jupiter. So oft gesehen, und ich muss immer noch hinsehen.', Saturn: 'Die Ringe. Wer da nicht still wird, hat kein Herz.', Neptune: 'Neptun. Hier draußen hört man das Schiff atmen.', Triton: 'Triton... Hier habe ich die Kranich verloren.' },
  },
  nachtigall: {
    name: 'Leon Nachtigall', title: 'Passagier', seed: 6060, faction: 'civil', station: 'Titan-Raffinerie', cost: 0, wage: 0, seated: true,
    post: { x: -1.7, z: -1.86, yaw: Math.PI, room: ROOMS.crew, block: null },
    look: { suit: 0x6a6a5c, legs: 0x2e2e30, skin: 0xe0c0a4, hair: 0x5a3a20 },
    bonus: 'Kennt die Tricks der Bank: Reden +1 in Gesprächen, Schmuggelaufträge zahlen 15 % mehr.',
    skill: { reden: 1 },
    pitch: 'Sie haben mich vor den Uniformen gerettet. Ich schulde Ihnen etwas, und ich kann hier nicht bleiben. Nehmen Sie mich mit? Ich zahle mit dem, was ich weiß. Und ich weiß eine Menge über die Kreditbank.',
    back: [
      'Ich war Buchhalter bei der Kreditbank Sol. Abteilung Sonderforderungen. Klingt harmlos, nicht wahr?',
      'Sonderforderungen heißt: Wir kaufen Schulden von Leuten, die gleich pleitegehen werden. Und wir sorgen dafür, dass sie es tun.',
      'Konto 7-Null habe ich selbst eingerichtet. Auf Anweisung von Herrn Hollmann. Ich wusste lange nicht, wofür. Dann wusste ich es.',
      'Nachtigall ist nicht mein richtiger Name. Den richtigen benutze ich wieder, wenn Hollmann hinter Gittern sitzt.',
    ],
    quest: 'konto', questAt: 50,
    questPitch: 'Hätten Sie einen Moment? Ich sitze in der Messe. Es ist wichtig.',
    ambient: ['Ich habe die Nachrichten durchgesehen. Die Bank kauft weiter Schürfrechte, als wäre nichts.', 'Ihr Kaffee ist schlecht. Das ist ein Kompliment, nach dem, was ich bei der Bank getrunken habe.', 'Wenn ich höre, dass sich ein Schiff nähert, zucke ich noch immer zusammen.'],
    places: { Venus: 'Die Wolkenstadt. Bitte docken Sie da nicht an, wenn es nicht sein muss.', Titan: 'Titan. Ich habe da drei Wochen in einem Lüftungsschacht gewohnt.' },
  },
};
export const CREW_KEYS = Object.keys(CREW_DEFS);

// What each of them thinks about the situation, first match wins
const OPINIONS = {
  jo: [
    [(g) => g.missions.open.includes('bote'), 'Drei Leute wollen was von dir. Hör dir wenigstens Voss an. Der Aschebund sind nicht alles Mörder. Manche sind nur Bergleute ohne Schiff.'],
    [(g) => g.story.path === 'bank', 'Die Bank. Ausgerechnet. Ich hoffe, du weißt, was du tust, Käpt\'n.'],
    [(g) => g.story.path === 'asche', 'Mit Voss fliegen... Mein Vater würde sich im Grab umdrehen. Oder lachen.'],
    [(g) => g.story.path === 'gesetz', 'Rhee ist in Ordnung. Für eine Polizistin.'],
    [(g) => g.missions.done.includes('notruf'), 'Den Konvoi bei Ceres hast du gerettet. Die Gilde redet von dir.'],
    [() => true, 'Läuft. Die Kiste hält, du hältst, ich halte. Mehr verlang ich nicht.'],
  ],
  teo: [
    [(g) => g.missions.open.includes('bote'), 'Rhee, Kapitän. Immer das Gesetz. Wer mit Piraten oder Bankiers paktiert, kommt nicht mehr sauber da raus.'],
    [(g) => g.story.path === 'bank', 'Ich fliege für Sie, weil ich es versprochen habe. Nicht, weil ich gutheiße, was Sie tun.'],
    [(g) => g.story.path === 'asche', 'Piraten. Ich hätte nicht gedacht, dass ich einmal für Piraten navigiere.'],
    [(g) => g.story.has('kranich_log'), 'Bergung Sol. Ich träume jede Nacht davon. Danke, dass Sie mit mir zur Kranich geflogen sind.'],
    [() => true, 'Ruhige Sprünge, gute Zahlen. Mehr kann ein Navigator nicht verlangen.'],
  ],
  nachtigall: [
    [(g) => g.missions.open.includes('bote'), 'Trauen Sie keinem davon. Wenn Sie mich fragen: Am wenigsten der Bank. Ich habe gesehen, was sie mit Menschen machen.'],
    [(g) => g.story.has('beweise'), 'Mit dem Würfel kann niemand mehr leugnen. Hollmann wird gestehen müssen, wenn man ihn stellt.'],
    [(g) => g.story.path === 'asche', 'Voss ist gefährlich. Aber sie hat ein Gedächtnis, und das macht sie berechenbar.'],
    [() => true, 'Ich lebe noch. Das ist mehr, als die Bank für mich geplant hatte.'],
  ],
};

// Loyalty in words
function moodLine(id, loyalty) {
  const lines = {
    jo: [[80, 'Ehrlich? Besser als je zuvor. Du bist der erste Käpt\'n, dem ich den Schraubenschlüssel geben würde.'], [55, 'Gut. Die Arbeit macht Spaß, der Käpt\'n meistens auch.'], [30, 'Geht so. Manche Sachen, die du machst, gefallen mir nicht.'], [0, 'Frag lieber nicht. Ich überlege, ob ich beim nächsten Halt aussteige.']],
    teo: [[80, 'Ich bin stolz, auf Ihrer Brücke zu stehen, Kapitän.'], [55, 'Zufrieden. Es ist ein gutes Schiff, mit einem ordentlichen Kapitän.'], [30, 'Ich habe Bedenken. Ich behalte sie für mich. Noch.'], [0, 'Ich bin nicht sicher, ob ich noch auf diesem Schiff sein will.']],
    nachtigall: [[80, 'Zum ersten Mal seit Jahren schlafe ich durch. Danke.'], [55, 'Gut. Ich bin noch nervös, aber gut.'], [30, 'Sie machen mir manchmal Angst, wissen Sie das?'], [0, 'Ich glaube, ich muss mir ein anderes Versteck suchen.']],
  }[id];
  return lines.find(([min]) => loyalty >= min)[1];
}

// ----- a crew member aboard, as a figure -------------------------------------------------------------

function buildFigure(interior, def) {
  const L = def.look;
  const room = def.post.room;
  const parts = [];
  const box = (color, w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(interior.tag(g, room, color));
  };
  if (def.seated) {
    // On the bench, facing the table: thighs forward, shins down
    [-0.1, 0.1].forEach((x) => {
      box(L.legs, 0.15, 0.15, 0.46, x, 0.5, -0.2);
      box(L.legs, 0.14, 0.46, 0.15, x, 0.23, -0.4);
      box(0x1a1a1a, 0.15, 0.06, 0.24, x, 0.03, -0.46);
    });
    box(L.suit, 0.42, 0.58, 0.24, 0, 0.82, 0.02);
    [-0.27, 0.27].forEach((x) => box(L.suit, 0.11, 0.5, 0.12, x, 0.84, -0.06));
    box(L.skin, 0.09, 0.08, 0.3, -0.27, 0.62, -0.24);
    box(L.skin, 0.1, 0.07, 0.1, 0, 1.14, 0.02);
    box(L.skin, 0.22, 0.26, 0.24, 0, 1.3, 0.01);
    box(L.hair, 0.24, 0.08, 0.26, 0, 1.45, 0.02);
    box(L.hair, 0.24, 0.16, 0.06, 0, 1.36, 0.13);
  } else {
    [-0.1, 0.1].forEach((x) => {
      box(L.legs, 0.15, 0.82, 0.17, x, 0.41, 0);
      box(0x1a1a1a, 0.16, 0.07, 0.26, x, 0.035, -0.04);
    });
    box(L.suit, 0.44, 0.62, 0.25, 0, 1.13, 0);
    box(L.suit, 0.46, 0.08, 0.27, 0, 0.86, 0);
    [-0.28, 0.28].forEach((x) => {
      box(L.suit, 0.11, 0.56, 0.13, x, 1.14, 0);
      box(L.skin, 0.09, 0.1, 0.1, x, 0.82, 0);
    });
    box(L.skin, 0.1, 0.07, 0.1, 0, 1.475, 0);
    box(L.skin, 0.22, 0.27, 0.24, 0, 1.64, 0);
    box(L.hair, 0.24, 0.08, 0.26, 0, 1.79, 0.01);
    box(L.hair, 0.24, 0.16, 0.06, 0, 1.7, 0.12);
    // a collar stripe in the ship's ochre
    box(0xc07a24, 0.45, 0.04, 0.26, 0, 1.41, 0);
  }
  // A face: eyes under brows, a nose, a mouth, hair down the sides and an ear each side
  const hy = def.seated ? 1.3 : 1.64;   // head centre
  const hz = def.seated ? 0.01 : 0;
  const front = hz - 0.12;
  const shade = new THREE.Color(L.skin).multiplyScalar(0.72).getHex();
  [-0.055, 0.055].forEach((x) => {
    box(0xf0ece0, 0.045, 0.026, 0.01, x, hy + 0.02, front - 0.002);
    box(0x141414, 0.022, 0.026, 0.012, x, hy + 0.02, front - 0.006);
    box(L.hair, 0.06, 0.014, 0.012, x, hy + 0.05, front - 0.004);
    box(shade, 0.02, 0.06, 0.045, x > 0 ? 0.115 : -0.115, hy - 0.01, hz);
  });
  box(shade, 0.04, 0.06, 0.04, 0, hy - 0.025, front - 0.018);
  box(0x5a2a24, 0.075, 0.016, 0.01, 0, hy - 0.08, front - 0.003);
  box(L.hair, 0.025, 0.12, 0.2, -0.123, hy + 0.08, hz + 0.03);
  box(L.hair, 0.025, 0.12, 0.2, 0.123, hy + 0.08, hz + 0.03);
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, interior.materials.plain);
  mesh.position.set(def.post.x, FLOOR_Y + (def.seated ? -0.02 : 0), def.post.z);
  mesh.rotation.y = def.post.yaw;
  interior.attachLit(mesh);
  return mesh;
}

// ----- the crew ----------------------------------------------------------------------------------------

export class Crew {
  constructor(game) {
    this.game = game;
    this.figures = {};
    this.reset();
  }

  reset() {
    this.members = {};      // id -> { loyalty, talks, pitched }
    this.gone = [];          // left or fired for good
    this.commentAt = 0;
    this.ambientTimer = 240;
    this.syncFigures();
  }

  toSave() {
    return { members: this.members, gone: this.gone };
  }

  load(s) {
    if (!s) return;
    this.members = s.members || {};
    this.gone = s.gone || [];
    this.syncFigures();
  }

  has(id) {
    return !!this.members[id];
  }

  list() {
    return CREW_KEYS.filter((id) => this.members[id]);
  }

  loyalty(id) {
    return this.members[id] ? this.members[id].loyalty : 0;
  }

  skillBonus(skill) {
    return this.list().reduce((n, id) => n + (CREW_DEFS[id].skill[skill] || 0), 0);
  }

  warpMult() {
    return this.has('teo') ? 0.75 : 1;
  }

  interdictionMult() {
    return this.has('teo') ? 0.5 : 1;
  }

  // ----- hiring and leaving -------------------------------------------------------------------------

  canHire(id, stationName) {
    const def = CREW_DEFS[id];
    if (this.has(id) || this.gone.includes(id) || def.station !== stationName) return false;
    const { story } = this.game;
    if (id === 'nachtigall') return story.has('nachtigall_lebt') && story.path !== 'bank';
    if (id === 'teo') return story.path !== 'bank';
    return true;
  }

  hire(id) {
    const def = CREW_DEFS[id];
    const { ship, story } = this.game;
    if (ship.credits < def.cost) return false;
    ship.credits -= def.cost;
    this.members[id] = { loyalty: 50, talks: 0, pitched: false };
    story.log(`${def.name} (${def.title}) an Bord genommen.`, 'crew');
    this.game.hud.toast(`${def.name} gehört jetzt zur Crew`, 'gain');
    this.syncFigures();
    this.game.saveProgress();
    return true;
  }

  leave(id, line, fired = false) {
    const def = CREW_DEFS[id];
    if (!this.members[id]) return;
    delete this.members[id];
    this.gone.push(id);
    this.game.story.log(`${def.name} ${fired ? 'entlassen' : 'hat das Schiff verlassen'}.`, 'crew');
    this.game.hud.toast(`${def.name} ${fired ? 'wurde entlassen' : 'verlässt die Crew'}`, 'warn');
    if (line) this.speak(id, line, true);
    this.syncFigures();
    this.game.saveProgress();
  }

  fire(id) {
    this.leave(id, id === 'jo' ? 'Schon gut. War nett mit dir. Meistens.' : id === 'teo' ? 'Wie Sie wünschen, Kapitän. Viel Glück.' : 'Ich verstehe. Ich verschwinde.', true);
  }

  // ----- loyalty -----------------------------------------------------------------------------------

  adjust(id, delta, line = null) {
    const m = this.members[id];
    if (!m) return;
    m.loyalty = Math.max(0, Math.min(100, m.loyalty + delta));
    if (line) this.speak(id, line, true);
    if (m.loyalty <= 0) m.leaving = true;
    // A favour to ask, once they trust you enough
    const def = CREW_DEFS[id];
    if (!m.pitched && m.loyalty >= def.questAt && this.questReady(id)) {
      m.pitched = true;
      setTimeout(() => this.speak(id, def.questPitch, false), 3000);
    }
  }

  // Many of them at once, with one remark from whoever minds most
  react(changes, lines = {}) {
    let worst = null, worstDelta = 0;
    Object.entries(changes).forEach(([id, d]) => {
      if (!this.has(id)) return;
      this.adjust(id, d);
      if (Math.abs(d) > Math.abs(worstDelta) && lines[id]) { worst = id; worstDelta = d; }
    });
    const now = performance.now();
    if (worst && now - this.commentAt > 15000) {
      this.commentAt = now;
      this.speak(worst, lines[worst], false);
    }
  }

  speak(id, text, urgent) {
    const def = CREW_DEFS[id];
    this.game.comm.say(text, { speaker: `${def.name}, ${def.title}`, faction: def.faction, seed: def.seed, duration: 7000, urgent });
  }

  questReady(id) {
    const def = CREW_DEFS[id];
    const { missions, story } = this.game;
    if (missions.sideDone.includes(def.quest) || missions.active.some((m) => m.quest === def.quest)) return false;
    if (id === 'jo') return missions.done.includes('elster') && !story.has('ade_tot');
    if (id === 'teo') return missions.done.includes('notruf');
    if (id === 'nachtigall') return story.path !== 'bank';
    return false;
  }

  // ----- what they think of what you do ------------------------------------------------------------

  onKill(npc, seen) {
    if (npc.faction === 'civil') {
      this.react({ jo: -10, teo: -14, nachtigall: -5 }, { jo: 'Das war ein Zivilist! Was soll das, Käpt\'n?!', teo: 'Kapitän! Das war ein ziviles Schiff. Ich hoffe, Sie haben eine verdammt gute Erklärung.', nachtigall: 'So hat die Bank auch angefangen. Mit Leuten, die nicht zurückschießen.' });
    } else if (npc.faction === 'police' && !npc.surrendered) {
      this.react({ jo: -5, teo: -15 }, { teo: 'Sie schießen auf SOLPOL? Das ist kein Spiel mehr, Kapitän.', jo: 'Polizei abschießen. Na toll. Jetzt sind wir die Bösen.' });
    } else if (npc.faction === 'pirate' && npc.points >= 5) {
      this.react({ teo: 2, jo: 1 }, { teo: 'Saubere Arbeit, Kapitän.' });
    }
    void seen;
  }

  onMission(m) {
    switch (m.type) {
      case 'smuggle':
        this.react({ teo: -6, nachtigall: 2 }, { teo: 'Schmuggelware. Ich habe gesagt, ich fliege nicht für Schmuggler.' });
        if (this.has('nachtigall') && m.reward) {
          const extra = Math.round(m.reward * 0.15);
          this.game.ship.credits += extra;
          this.game.hud.toast(`Nachtigall kennt den Abnehmer: +${fmt(extra)} Cr`, 'gain');
        }
        break;
      case 'escort': this.react({ jo: 3, teo: 2 }, { jo: 'Die Frachter sind durch. Gute Sache, Käpt\'n.' }); break;
      case 'bounty': case 'patrol': this.react({ teo: 2, jo: 1 }, {}); break;
      case 'delivery': case 'procure': this.react({ jo: 1, teo: 1, nachtigall: 1 }, {}); break;
      default:
    }
  }

  onFail(m) {
    if (m.type === 'escort') this.react({ jo: -3 }, { jo: 'Die armen Schweine im Frachter...' });
  }

  onChapter(id, phase) {
    const { story } = this.game;
    if (phase === 'accept') {
      if (id === 'nest') this.react({ teo: 10, jo: -3, nachtigall: 3 }, { teo: 'Rhee. Die richtige Wahl, Kapitän.', jo: 'Gegen Voss also. Hoffentlich weißt du, was du tust.' });
      if (id === 'bote') this.react({ jo: 10, teo: -10, nachtigall: 3 }, { jo: 'Du hörst dir Voss an? Gut. Wirklich gut.', teo: 'Zum Hades-Nest. Freiwillig. Ich werde nie verstehen, warum.' });
      if (id === 'schweigegeld') {
        this.react({ jo: -18, teo: -22 }, { teo: 'Sie verkaufen sich an die Bank? Nach allem, was wir wissen?', jo: 'Die Bank. Die Bank, die meine Gilde ruiniert hat. Echt jetzt?' });
        if (this.has('nachtigall')) this.leave('nachtigall', 'Sie verkaufen mich an die Leute, vor denen ich fliehe? Ich steige aus. Sofort. Vergessen Sie, dass Sie mich kannten.');
      }
      if (id === 'falle') this.react({ jo: -20, teo: -25 }, { teo: 'Rhee in eine Falle locken. Kapitän, das ist Mord.', jo: 'Wenn du das machst, Käpt\'n, dann ohne mich.' });
    } else if (phase === 'done') {
      if (id === 'falle' && story.has('rhee_tot')) {
        if (this.has('teo')) this.leave('teo', 'Sie haben Rhee sterben lassen. Ich steige beim nächsten Halt aus. Reden Sie nicht mit mir.');
        this.react({ jo: -40 }, { jo: 'Du hast sie einfach sterben lassen...' });
      }
      if (id === 'falle' && story.has('doppelspiel')) this.react({ teo: 25, jo: 20 }, { teo: 'Sie haben Rhee gewarnt. Ich wusste, dass Sie es nicht tun würden.' });
      if (id === 'wolkenstadt' && story.has('bestochen')) {
        this.react({ jo: -35, teo: -45, nachtigall: -60 }, { teo: 'Sie haben ihn laufen lassen. Für Geld. Ich habe mich in Ihnen getäuscht.', jo: 'Hundertfünfzigtausend. So viel bist du also wert.', nachtigall: 'Er läuft frei herum. Und Sie haben ihn bezahlt, damit er es kann.' });
      }
      if (id === 'wolkenstadt' && story.has('gestaendnis')) this.react({ jo: 10, teo: 10, nachtigall: 25 }, { nachtigall: 'Er hat gestanden. Auf offenem Kanal. Ich... ich weiß nicht, was ich sagen soll.' });
      if (id === 'nest' && story.has('voss_gefangen')) this.react({ jo: 8 }, { jo: 'Du hast Voss leben lassen. Danke. Auf Ceres hätten sie dich sonst gehasst.' });
    }
  }

  // Docked: pay day, and the ones who have had enough go ashore
  onDock() {
    const { ship } = this.game;
    this.list().forEach((id) => {
      const def = CREW_DEFS[id];
      const m = this.members[id];
      if (m.leaving || m.loyalty <= 8) {
        this.leave(id, id === 'jo' ? 'Das war\'s für mich, Käpt\'n. Such dir eine andere Mechanikerin.' : id === 'teo' ? 'Hier gehe ich von Bord, Kapitän. Mit dem, was Sie tun, will ich nichts zu tun haben.' : 'Ich suche mir ein anderes Versteck. Leben Sie wohl.');
        return;
      }
      if (!def.wage) return;
      if (ship.credits >= def.wage) {
        ship.credits -= def.wage;
      } else {
        this.adjust(id, -6, `${def.name}: „Kein Lohn diesmal? Das merke ich mir."`);
      }
    });
  }

  // ----- talking aboard ------------------------------------------------------------------------------

  talk(id) {
    const def = CREW_DEFS[id];
    const m = this.members[id];
    if (!m) return;
    const g = this.game;
    const who = { speaker: `${def.name}, ${def.title}`, faction: def.faction, seed: def.seed };
    const say = (text) => g.comm.say(text, { ...who, urgent: true, duration: 9000 });
    const offer = this.questReady(id) && m.loyalty >= def.questAt ? g.missions.sideOffer(def.quest) : null;
    sfx.squelch();
    const options = [
      { label: 'Wie geht\'s dir?', run: () => say(moodLine(id, m.loyalty)) },
      { label: 'Erzähl mir von dir.', run: () => {
        const i = m.talks % def.back.length;
        if (m.talks < def.back.length) { this.adjust(id, 3); g.story.gain('reden', 10); }
        m.talks++;
        say(def.back[i]);
      } },
      offer
        ? { label: 'Du wolltest etwas besprechen?', run: () => this.pitchQuest(id, offer) }
        : { label: 'Was hältst du von der Lage?', run: () => say(OPINIONS[id].find(([cond]) => cond(g))[1]) },
      { label: 'Bis später.', run: () => say(pick(['Bis später.', 'Ich bin hier, wenn du mich brauchst.', 'Alles klar.'])) },
    ];
    g.comm.ask(id === 'jo' ? 'Was gibt\'s, Käpt\'n?' : id === 'teo' ? 'Kapitän?' : 'Ja?', options, { ...who, timeout: 20000 });
  }

  pitchQuest(id, offer) {
    const g = this.game;
    const def = CREW_DEFS[id];
    const who = { speaker: `${def.name}, ${def.title}`, faction: def.faction, seed: def.seed };
    g.comm.ask(offer.text, [
      { label: 'Machen wir.', run: () => {
        const blocker = g.missions.blocker(offer);
        if (blocker) { g.hud.toast(blocker, 'bad'); sfx.denied(); return; }
        g.missions.accept(offer, null);
        g.hud.toast(`Auftrag angenommen: ${offer.title}`, 'info');
        this.adjust(id, 5);
        g.comm.say(id === 'jo' ? 'Danke, Käpt\'n. Wirklich.' : id === 'teo' ? 'Danke, Kapitän. Ich habe den Kurs schon berechnet.' : 'Danke. Ich habe so lange darauf gewartet.', { ...who, urgent: true, duration: 5000 });
      } },
      { label: 'Später.', run: () => g.comm.say('Schon gut. Wenn du so weit bist.', { ...who, urgent: true, duration: 4000 }) },
    ], { ...who, timeout: 30000 });
  }

  // ----- every frame ---------------------------------------------------------------------------------

  update(dt) {
    const g = this.game;
    const { ship } = g;
    if (ship.isDocked || ship.isDestroyed) return;
    const calm = performance.now() - (ship.lastHullHit || 0) > 8000 && !g.hostilesNear(1200);
    // Jo patches the ship up as it flies; a good technician's electronics heal themselves too
    const techy = g.story.level('technik') >= 3;
    if (calm && (this.has('jo') || techy)) {
      if (this.has('jo') && ship.hull < ship.maxHull) ship.hull = Math.min(ship.maxHull, ship.hull + 0.35 * dt);
      const rate = (this.has('jo') ? 0.004 : 0) + (techy ? 0.0015 : 0);
      Object.keys(ship.systems).forEach((k) => { if (ship.systems[k] < 1) ship.systems[k] = Math.min(1, ship.systems[k] + rate * dt); });
    }
    // Now and then somebody says something
    if (calm && this.list().length && !g.comm.current && !ship.isWarping) {
      this.ambientTimer -= dt;
      if (this.ambientTimer <= 0) {
        this.ambientTimer = 260 + Math.random() * 280;
        this.ambient();
      }
    }
    if (g.onFoot.active) this.updateFigures(dt);
  }

  ambient() {
    const g = this.game;
    const ids = this.list();
    const id = pick(ids);
    const def = CREW_DEFS[id];
    // A remark about where we are, if there is something big outside
    let line = null;
    const near = g.solarSystem.planets.find((p) => p.name !== 'Sun' && p.group.position.distanceTo(g.ship.position) < p.radius * 8);
    if (near && def.places[near.name]) line = def.places[near.name];
    if (!line && near && near.parent && def.places[near.parent.name]) line = def.places[near.parent.name];
    const st = g.solarSystem.nearestStation(g.ship.position);
    if (!line && st && st.mesh.position.distanceTo(g.ship.position) < 1500 && st.name.startsWith('Ceres') && def.places.Ceres) line = def.places.Ceres;
    if (!line) line = pick(def.ambient);
    this.speak(id, line, false);
  }

  // ----- the figures aboard ------------------------------------------------------------------------------

  syncFigures() {
    const interior = this.game.onFoot && this.game.onFoot.interior;
    if (!interior) return;
    CREW_KEYS.forEach((id) => {
      const def = CREW_DEFS[id];
      const want = this.has(id);
      const fig = this.figures[id];
      if (want && !fig) {
        const mesh = buildFigure(interior, def);
        this.figures[id] = { mesh, baseYaw: def.post.yaw, t: Math.random() * 6 };
        if (def.post.block) interior.obstacles.push(def.post.block);
        interior.interact(`crew:${id}`, def.post.x, def.post.z, def.seated ? 1.6 : 1.3, `Mit ${def.name} reden`, def.seated ? 1.1 : 1.5);
      } else if (!want && fig) {
        interior.group.remove(fig.mesh);
        fig.mesh.geometry.dispose();
        delete this.figures[id];
        if (def.post.block) interior.obstacles = interior.obstacles.filter((b) => b !== def.post.block);
        interior.interactables = interior.interactables.filter((o) => o.id !== `crew:${id}`);
      }
    });
  }

  // They glance round at you when you come close, and breathe
  updateFigures(dt) {
    const p = this.game.onFoot.pos;
    Object.entries(this.figures).forEach(([id, f]) => {
      const def = CREW_DEFS[id];
      f.t += dt;
      const dx = p.x - def.post.x, dz = p.z - def.post.z;
      const near = Math.hypot(dx, dz) < 2.6;
      const want = near && !def.seated ? yawTo(dx, dz) : def.post.yaw;
      let d = want - f.mesh.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      f.mesh.rotation.y += d * Math.min(1, dt * 3);
      f.mesh.scale.y = 1 + Math.sin(f.t * 1.7) * 0.006;
    });
  }

  epilogue() {
    const out = [];
    const s = this.game.story;
    const sour = this.list().filter((id) => this.loyalty(id) < 25);
    sour.forEach((id) => out.push(`${CREW_DEFS[id].name} ist beim nächsten Halt von Bord gegangen, ohne sich zu verabschieden.`));
    const stays = (id) => this.has(id) && !sour.includes(id);
    if (stays('jo')) out.push(s.has('ade_raus') ? 'Jo Okafor und ihr Bruder Ade haben auf Ceres eine Werkstatt eröffnet. Dein Schiff hat dort lebenslang Vorfahrt.' : 'Jo Okafor fliegt weiter mit dir. Sie sagt, die SOL 4471 sei das einzige Schiff, das ihr nie gelogen hat.');
    if (stays('teo')) out.push(s.has('kranich_log') ? 'Teodor Brandl hat seine Mannschaft von der Kranich endlich beerdigt, symbolisch, über Triton. Dann kam er zurück an Bord.' : 'Teodor Brandl navigiert weiter für dich. Er hat aufgehört, nach einem eigenen Schiff zu fragen.');
    if (stays('nachtigall')) out.push('Leon Nachtigall benutzt wieder seinen richtigen Namen. Er hat ihn dir als Erstem verraten.');
    if (this.gone.includes('teo') && s.has('rhee_tot')) out.push('Teodor Brandl hat bei SOLPOL ausgesagt. Es hat nichts geändert.');
    if (s.has('ade_tot')) out.push('Jo Okafor hat nie wieder mit dir gesprochen.');
    return out;
  }
}
