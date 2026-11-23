import { GOODS, GOOD_KEYS, UPGRADES, MISSILE_PRICE, FLARE_PRICE, FUEL_PRICE, HULL_REPAIR_PRICE, SYSTEM_REPAIR_PRICE, SUBSYSTEMS, STATION_DEFS } from './world';
import { spaceAudio } from './audio';
import { sfx } from './sfx';
import { displayName } from './names';
import { drawPortrait } from './comm';
import { rng } from './shipModel';
import { difficultyOf } from './difficulty';
import { W, H, buildRoom, drawPerson, drawFace, makePerson, hashStr, BAR_NAMES } from './concourse';
import { CHAPTERS, VARGA } from './storyline';
import { SKILLS, FACTIONS, FACTION_KEYS } from './story';
import { CREW_DEFS, CREW_KEYS } from './crew';

// Docked: you walk through the station. A lobby with doors to the bar, the exchange, the workshop, the mission office,
// the authorities (or a fixer) and the landing deck. Each room is a painted scene with people you can talk to;
// the trading, repair and mission screens open as a terminal panel beside them.

const fmt = (n) => Math.round(n).toLocaleString('de-DE');
const stars = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
const HADES_TIP_PRICE = 2500;
const CAST_PERIOD = 300; // seconds of game clock before the bar crowd changes
const ROOMS = ['lobby', 'bar', 'exchange', 'workshop', 'missions', 'office', 'hangar'];
const PANEL_OF = { exchange: 'market', workshop: 'shipyard', missions: 'missions', office: 'office' };

const RUMORS = [
  'Die Krähen jagen in Rudeln. Wer allein fliegt, sollte schnell sein oder gut zielen.',
  'SOLPOL scannt rund um die Erde fast jeden. Waffen und Stims bringt man besser woanders hin.',
  'Ein Mittelsmann auf dem Triton-Posten löscht Akten. Teuer, aber diskret.',
  'Aus dem Ceres-Feld kann man Erz schießen. Mit dem Traktorstrahl sammelt man die Brocken ein.',
  'Wer Eis an Bord hat, kommt immer nach Hause: Notfalls verbrennt der Antrieb es als Reaktionsmasse.',
  'Die Schwarze Sonne soll ein Trägerschiff sein, so groß wie eine Station. Niemand, der sie gesehen hat, redet gern darüber.',
  'Wenn die Raketenwarnung piept, wirf Täuschkörper. K, nicht zu früh, nicht zu spät.',
  'Piraten, die brennen, fliehen. Manche werfen dabei ihre Ladung ab.',
  'Die Sprungstörer des Aschebunds holen Frachter mitten aus dem Sprung. Je weiter draußen, desto öfter.',
];
const LORE = [
  'Früher war es hier draußen ruhig. Dann kamen die Krähen, und mit ihnen der Aschebund.',
  'Weißt du, warum sie Schwarze Sonne heißt? Weil man sie erst sieht, wenn sie das Licht schluckt.',
  'Dreißig Jahre bin ich Fracht geflogen. Mein Rat: Nie mit vollem Laderaum durch den Gürtel.',
  'Inspektorin Rhee? Hart, aber fair. Wer sie belügt, fliegt nie wieder für SOLPOL.',
  'Die SOLPOL ist da, wo das Geld ist. Draußen bei Triton bist du auf dich gestellt.',
  'Schilde nach vorn, wenn du angreifst. Nach hinten, wenn du fliehst. Das lernt man schnell oder gar nicht.',
  'Die Kreditbank Sol hat mir mal ein Schiff verkauft. Ich hab zwölf Jahre gebraucht, um es abzubezahlen.',
];
const GUARD_LINES = {
  police: ['Gehen Sie weiter, Pilot.', 'Alles ruhig heute. Hoffen wir, dass es so bleibt.', 'Kontrollen gibt es draußen, nicht hier drinnen. Meistens.', 'Melden Sie verdächtige Schiffe auf Kanal neun.'],
  pirate: ['Was glotzt du?', 'Ärger machst du hier nur einmal.', 'Der Boss mag keine Neugierigen.', 'Nett hier, was? Bleib einfach friedlich.'],
};
const LOUNGER_LINES = [
  'Schöne Aussicht, oder? Ich komme jeden Tag her.',
  'Mein Frachter steht seit drei Wochen in der Werkstatt. Drei Wochen!',
  'Hast du von dem Konvoi gehört? Keiner ist durchgekommen.',
  'Ich warte auf eine Mitfluggelegenheit. Du fliegst nicht zufällig nach Mars?',
  'Die Preise hier sind ein Witz. Aber der Kaffee ist gut.',
];
const FIRST = ['Jonas', 'Mira', 'Tarek', 'Ilka', 'Ruben', 'Sanna', 'Oskar', 'Leila', 'Bo', 'Ines', 'Pavel', 'Yuki', 'Greta', 'Malik', 'Nele', 'Dario', 'Frieda', 'Kofi', 'Alma', 'Viktor', 'Zora', 'Emil', 'Hana', 'Lasse'];
const LAST = ['Brandt', 'Okafor', 'Lindqvist', 'Moreau', 'Haas', 'Tanaka', 'Petrov', 'Novak', 'Weiss', 'Castell', 'Reyes', 'Kaya', 'Holm', 'Adler', 'Sørensen', 'Vidal', 'Kranz', 'Ito'];
const NICKS = ['Rost-Ede', 'Die Kralle', 'Zahnlos', 'Funke', 'Schrott-Jo', 'Lady Asche', 'Knochen', 'Zwieback', 'Glimmer', 'Die Natter'];

const nameFor = (seed, pirate) => {
  const r = rng(seed * 3 + 1);
  r();
  if (pirate && r() < 0.6) return NICKS[Math.floor(r() * NICKS.length)];
  return `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
};

export class StationUI {
  constructor(game) {
    this.game = game;
    this.screen = document.getElementById('spaceport-screen');
    this.stage = document.getElementById('station-stage');
    this.canvas = document.getElementById('station-scene');
    this.ctx = this.canvas.getContext('2d');
    this.layer = document.createElement('canvas');
    this.layer.width = W;
    this.layer.height = H;
    this.title = document.getElementById('terminal-station-title');
    this.blurb = document.getElementById('terminal-station-blurb');
    this.credits = document.getElementById('terminal-credits-val');
    this.nav = document.getElementById('station-nav');
    this.caption = document.getElementById('station-caption');
    this.panel = document.getElementById('station-panel');
    this.panelTitle = document.getElementById('station-panel-title');
    this.body = document.getElementById('station-body');
    this.dialogEl = document.getElementById('station-dialog');
    this.dlgFace = document.getElementById('station-dialog-face');
    this.dlgName = document.getElementById('station-dialog-name');
    this.dlgLine = document.getElementById('station-dialog-line');
    this.dlgOptions = document.getElementById('station-dialog-options');
    this.barks = document.getElementById('station-barks');
    this.fade = document.getElementById('station-fade');
    this.station = null;
    this.room = 'lobby';
    this.view = null;
    this.dialog = null;
    this.hover = null;
    this.rooms = {};
    this.raf = 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.canvas.addEventListener('mousemove', (e) => this.onMove(e));
    this.canvas.addEventListener('mouseleave', () => { this.hover = null; this.updateCaption(); });
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    this.nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-room]');
      if (b) this.go(b.dataset.room);
    });
    document.getElementById('exit-terminal-btn').addEventListener('click', () => this.game.undockShip());
    document.getElementById('station-panel-close').addEventListener('click', () => this.closePanel());
    this.dlgLine.addEventListener('click', () => { if (this.dialog) this.dialog.shown = this.dialog.text.length; });
    this.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      this.act(b.dataset.act.split(':'), e.shiftKey);
    });
    window.addEventListener('resize', () => this.fit());
  }

  get isOpen() {
    return !!this.station;
  }

  // ----- open / close ------------------------------------------------------------------------------

  open(name) {
    this.station = this.game.solarSystem.stations.find((s) => s.name === name);
    this.def = this.station.def;
    this.pirate = this.def.faction === 'pirate' || this.def.blackMarket;
    this.title.textContent = displayName(name).toUpperCase();
    const sec = this.def.security;
    const secText = sec >= 0.75 ? 'Hoch' : sec >= 0.45 ? 'Mittel' : sec >= 0.2 ? 'Niedrig' : 'Gesetzlos';
    this.secText = secText;
    this.blurb.textContent = `${this.def.blurb} · Sicherheit: ${secText}`;
    this.rooms = {};
    this.liveData = null;
    this.staff = this.makeStaff();
    this.walkers = this.makeWalkers();
    this.patronsKey = null;
    this.screen.classList.remove('hidden');
    this.fit();
    // Let the HUD notices show up inside the station
    const toasts = this.game.hud && this.game.hud.toasts;
    if (toasts) { this.toastHome = toasts.parentNode; this.stage.appendChild(toasts); }
    this.enter('lobby');
    this.t0 = performance.now();
    cancelAnimationFrame(this.raf);
    const loop = () => {
      if (!this.station) return;
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  close() {
    this.station = null;
    cancelAnimationFrame(this.raf);
    this.dialog = null;
    this.dialogEl.classList.add('hidden');
    this.panel.classList.add('hidden');
    this.barks.replaceChildren();
    this.screen.classList.add('hidden');
    const toasts = this.game.hud && this.game.hud.toasts;
    if (toasts && this.toastHome) this.toastHome.appendChild(toasts);
  }

  refresh() {
    if (!this.isOpen) return;
    this.credits.textContent = fmt(this.game.ship.credits);
    if (this.view) this.renderPanel();
    this.renderNav();
  }

  // Keep the 16:9 stage as large as the window allows
  fit() {
    const w = Math.min(window.innerWidth, window.innerHeight * (16 / 9));
    this.stage.style.width = `${Math.floor(w)}px`;
    this.stage.style.height = `${Math.floor(w * 9 / 16)}px`;
    this.stage.style.setProperty('--px', `${w / W}px`);
  }

  // ----- the cast ----------------------------------------------------------------------------------

  makeStaff() {
    const base = hashStr(this.def.name);
    const p = this.pirate;
    const person = (role, k, faction, title) => {
      const seed = (base + k * 7919) % 100000;
      return { id: role, role, title, faction, seed, name: nameFor(seed, p && faction === 'pirate'), spec: makePerson(seed, { faction, role }) };
    };
    return {
      bartender: person('bartender', 1, p ? 'pirate' : 'civil', 'Barkeeper'),
      trader: person('trader', 2, p ? 'pirate' : 'civil', 'Kursmakler'),
      mechanic: person('mechanic', 3, 'civil', 'Mechanik'),
      clerk: person('clerk', 4, p ? 'pirate' : 'civil', p ? 'Hehler' : 'Auftragsvermittlung'),
      officer: person('officer', 5, p ? 'pirate' : 'police', p ? 'Mittelsmann' : 'SOLPOL-Revier'),
      deckhand: person('deckhand', 6, 'civil', 'Deckcrew'),
      guard: person('guard', 7, p ? 'pirate' : 'police', p ? 'Wache' : 'SOLPOL-Streife'),
      lounger: person('lounger', 8, 'civil', 'Reisende'),
      vendor: person('vendor', 9, p ? 'pirate' : 'civil', 'Fliegender Händler'),
    };
  }

  makeWalkers() {
    const r = rng(hashStr(this.def.name) + 17);
    const n = this.def.security > 0.6 ? 6 : 4;
    return Array.from({ length: n }, (_, i) => this.newWalker(r, i, true));
  }

  newWalker(r, i, anywhere) {
    const faction = this.pirate ? (r() < 0.7 ? 'pirate' : 'civil') : (r() < 0.12 ? 'police' : 'civil');
    const seed = Math.floor(r() * 100000);
    const dir = r() < 0.5 ? -1 : 1;
    const y = 158 + r() * 50;
    return { seed, spec: makePerson(seed, { faction }), dir, y, x: anywhere ? r() * W : (dir > 0 ? -20 : W + 20), speed: 12 + r() * 12, phase: r() * 6, pause: 0 };
  }

  // Who sits in the bar (and who waits in the office) depends on the game state and changes over time
  patrons() {
    const { missions, economy, discovered } = this.game;
    const name = this.station.name;
    const clock = economy.clock || 0;
    const { crew, story: chronicle } = this.game;
    const stories = missions.storyOffers(name);
    const offers = missions.offersAt(name).filter((m) => !m.story);
    const recruits = CREW_KEYS.filter((id) => crew.canHire(id, name));
    const varga = this.vargaState();
    const key = `${name}:${Math.floor(clock / CAST_PERIOD)}:${stories.map((o) => o.id).join(',')}:${offers.length}:${discovered.has('Hades-Nest')}:${recruits.join(',')}:${varga}`;
    if (key === this.patronsKey) return this.patronList;
    this.patronsKey = key;
    const r = rng(hashStr(key));
    const list = [];
    const person = (kind, seed, faction, extra = {}) => ({ id: `${kind}${seed}`, kind, seed, faction, name: nameFor(seed, faction === 'pirate'), spec: makePerson(seed, { faction }), ...extra });

    stories.forEach((story) => {
      const p = { id: `story${story.id}`, kind: 'story', seed: story.seed, faction: story.giverFaction, name: story.giver, title: story.choice ? 'Wartet auf dich' : 'Hauptauftrag', spec: makePerson(story.seed, { faction: story.giverFaction }), offer: story, chapter: story.chapter };
      p.room = story.room || (story.giverFaction === 'police' ? 'office' : 'bar');
      list.push(p);
    });
    if (varga) list.push({ id: `varga${varga}`, kind: 'varga', seed: VARGA.seed, faction: 'civil', name: 'Dr. Ilse Varga', title: 'Xenoforschung', spec: makePerson(VARGA.seed, { faction: 'civil' }), room: 'bar', state: varga });
    recruits.forEach((id) => {
      const def = CREW_DEFS[id];
      list.push({ id: `recruit${id}`, kind: 'recruit', crewId: id, seed: def.seed, faction: def.faction, name: def.name, title: def.title, spec: makePerson(def.seed, { faction: def.faction }), room: 'bar' });
    });
    void chronicle;
    if (offers.length) {
      const m = offers[Math.floor(r() * offers.length)];
      const seed = Math.floor(r() * 100000);
      const personal = !/SOLPOL|Spedition|Reederei|amt|Einkauf|Unbekannter|Mittelsmann/.test(m.giver);
      list.push(person('contact', seed, m.giverFaction, { offerId: m.id, title: personal ? 'Auftraggeber' : `für ${m.giver}`, name: personal ? m.giver : nameFor(seed, m.giverFaction === 'pirate') }));
    }
    if (this.def.blackMarket && !discovered.has('Hades-Nest')) list.push(person('scarred', 4242, 'pirate', { name: 'Ein Mann mit Brandnarbe', title: '' }));
    const fillers = ['pilot', 'tipster', 'veteran'];
    while (list.filter((p) => !p.room || p.room === 'bar').length < 4 && fillers.length) {
      const kind = fillers.splice(Math.floor(r() * fillers.length), 1)[0];
      const faction = this.pirate ? 'pirate' : kind === 'pilot' && r() < 0.3 ? 'police' : 'civil';
      list.push(person(kind, Math.floor(r() * 100000), faction, { title: { pilot: 'Pilot', tipster: 'Händlerin', veteran: 'Alter Raumfahrer' }[kind] }));
    }
    // Seats: the story contact gets the booth
    const seats = ['seat2', 'seat1', 'stand1', 'stand2'];
    list.filter((p) => !p.room || p.room === 'bar').forEach((p) => { p.room = 'bar'; });
    const inBar = list.filter((p) => p.room === 'bar');
    const rank = (p) => ({ story: 0, varga: 1, recruit: 2, contact: 3, scarred: 4 }[p.kind] ?? 5);
    inBar.sort((a, b) => rank(a) - rank(b));
    inBar.forEach((p, i) => { p.slot = seats[i]; });
    list.filter((p) => p.room === 'office').forEach((p) => { p.slot = 'visitor'; });
    this.patronList = list.filter((p) => p.slot);
    return this.patronList;
  }

  // People placed in the current room: { npc, slot }
  peopleHere() {
    const room = this.rooms[this.room];
    const out = [];
    const put = (npc, slotName) => { const slot = room.slots[slotName]; if (slot) out.push({ npc, slot }); };
    const S = this.staff;
    switch (this.room) {
      case 'lobby': put(S.vendor, 'vendor'); put(S.guard, 'guard'); put(S.lounger, 'lounger'); break;
      case 'bar': put(S.bartender, 'bartender'); break;
      case 'exchange': put(S.trader, 'trader'); break;
      case 'workshop': put(S.mechanic, 'mechanic'); break;
      case 'missions': put(S.clerk, 'clerk'); break;
      case 'office': put(S.officer, 'officer'); break;
      case 'hangar': put(S.deckhand, 'deckhand'); break;
      default:
    }
    this.patrons().filter((p) => p.room === this.room && !(this.gone && this.gone.has(p.id))).forEach((p) => put(p, p.slot));
    return out;
  }

  // ----- rooms -------------------------------------------------------------------------------------

  go(room) {
    if (!ROOMS.includes(room) || !this.station) return;
    if (room === this.room && !this.dialog) return;
    this.closeDialog();
    sfx.door();
    if (this.reducedMotion) { this.enter(room); return; }
    this.fade.classList.add('on');
    clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => {
      if (!this.station) return;
      this.enter(room);
      this.fade.classList.remove('on');
    }, 170);
  }

  enter(room) {
    this.room = room;
    if (!this.rooms[room]) this.rooms[room] = buildRoom(room, this.def, this.live());
    this.hover = null;
    this.barks.replaceChildren();
    this.closeDialog();
    const people = this.peopleHere();
    const visitor = people.find((p) => p.npc.kind === 'story' && p.npc.room === 'office');
    const panel = PANEL_OF[room];
    if (panel && !visitor) this.openPanel(panel);
    else this.closePanel();
    // The person in charge says hello
    const host = people.find((p) => !p.npc.kind);
    const waiting = people.find((p) => p.npc.kind === 'story');
    if (waiting) this.bark(waiting, waiting.npc.offer && waiting.npc.offer.choice ? 'Hast du einen Moment? Hör mich an.' : 'Da bist du ja! Wir müssen reden.');
    else if (host && room !== 'lobby') this.bark(host, this.greeting(host.npc));
    this.renderNav();
    this.updateCaption();
  }

  greeting(npc) {
    const { ship, economy, law, missions } = this.game;
    const name = this.station.name;
    switch (npc.role) {
      case 'bartender': {
        const epithet = this.game.story.epithet();
        if (epithet) return `Sieh an, der ${epithet}! Willkommen im ${BAR_NAMES[this.def.name]}.`;
        return this.pirate ? `Im ${BAR_NAMES[this.def.name]} zahlt man vorher.` : `Willkommen im ${BAR_NAMES[this.def.name]}!`;
      }
      case 'trader': {
        const ev = economy.events.find((e) => e.station === name);
        return ev ? ev.text : 'Kauf billig, verkauf teuer. Mehr gibt es nicht zu wissen.';
      }
      case 'mechanic': {
        const k = ship.hull / ship.maxHull;
        if (k < 0.4) return 'Wer hat dich denn so zugerichtet? Das wird teuer.';
        if (k < 0.85) return 'Ein paar Dellen. Kriegen wir hin.';
        return ship.debt > 0 ? 'Schönes Schiff. Schon abbezahlt?' : 'Die Kiste ist in Topform.';
      }
      case 'clerk': {
        const n = missions.offersAt(name).length;
        return this.pirate ? 'Arbeit gibt es genug. Ehrliche nicht.' : n ? `${n} Aufträge sind offen. Schau sie dir an.` : 'Gerade ist nichts reingekommen.';
      }
      case 'officer':
        if (this.pirate) return law.wanted > 0 ? 'Ärger mit SOLPOL? Ich hab die Lösung.' : 'Du bist sauber. Wie langweilig.';
        return law.fines > 0 ? `Offene Bußgelder: ${fmt(law.fines)} Cr.` : 'Gegen Sie liegt nichts vor, Pilot.';
      case 'deckhand':
        return ship.fuel < ship.maxFuel * 0.25 ? 'Startklar. Aber dein Tank ist fast leer!' : 'Dein Schiff ist startklar.';
      default: return 'Hallo.';
    }
  }

  // Data the animated scenery shows: marquee, news, price board
  live() {
    const { economy } = this.game;
    const name = this.station.name;
    const news = economy.news.slice(0, 3);
    return {
      marquee: `${this.def.short} · Sicherheit ${this.secText}${news[0] ? ` · ${news[0]}` : ''}`,
      news: news.length ? news : ['Keine Meldungen'],
      ticker: GOOD_KEYS.filter((g) => economy.trades(name, g)).map((g) => ({
        name: GOODS[g].name.slice(0, 14),
        price: fmt(economy.buyPrice(name, g)),
        up: economy.mid(name, g) >= GOODS[g].base,
        stock: `${fmt(economy.available(name, g))}T`,
      })),
      hull: '#8a8c90',
    };
  }

  // ----- frame -------------------------------------------------------------------------------------

  frame() {
    const t = (performance.now() - this.t0) / 1000;
    const dt = Math.min(0.1, t - (this.lastT || t));
    this.lastT = t;
    const room = this.rooms[this.room];
    if (!room) return;
    if (!this.liveData || t - this.liveAt > 2) { this.liveData = this.live(); this.liveAt = t; }
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(room.bg, 0, 0);
    room.fx(ctx, t, this.liveData);

    // People and the furniture in front of them, back to front, on their own layer so the room light tints them
    const lctx = this.layer.getContext('2d');
    lctx.clearRect(0, 0, W, H);
    const items = [];
    this.placed = this.peopleHere();
    const talkingTo = this.dialog && this.dialog.npc;
    this.placed.forEach((p) => items.push({ y: p.slot.y, draw: () => {
      const hovered = this.hover && this.hover.npc === p.npc;
      drawPerson(lctx, p.slot.x, p.slot.y, p.slot.h, p.npc.spec, t, { ...(p.slot.pose || {}), talk: talkingTo === p.npc && this.dialog.shown < this.dialog.text.length });
      if (p.slot.front) p.slot.front(lctx);
      if (hovered) p.hl = true;
    } }));
    Object.entries(room.slots).forEach(([name, slot]) => {
      if (slot.front && !this.placed.some((p) => p.slot === slot)) items.push({ y: slot.y, draw: () => slot.front(lctx) });
      void name;
    });
    if (this.room === 'lobby') {
      const r = Math.random;
      this.walkers.forEach((w, i) => {
        if (w.pause > 0) w.pause -= dt;
        else {
          const k = 0.5 + (w.y - 150) / 120;
          w.x += w.dir * w.speed * k * dt;
          w.phase += w.speed * k * dt * 0.45;
          if (r() < dt * 0.04) w.pause = 1.5 + r() * 3;
        }
        if (w.x < -30 || w.x > W + 30) this.walkers[i] = this.newWalker(rng(Math.floor(r() * 1e9)), i, false);
        const h = 26 + (w.y - 150) * 0.62;
        items.push({ y: w.y, draw: () => drawPerson(lctx, w.x, w.y, h, w.spec, t, w.pause > 0 ? {} : { walk: w.phase }) });
      });
    }
    items.sort((a, b) => a.y - b.y).forEach((it) => it.draw());
    // Room light over the people
    const tint = this.room === 'bar' ? ['#ff8a40', 0.16] : this.room === 'office' && this.pirate ? ['#ff9050', 0.2] : [room.theme.light, 0.08];
    lctx.globalCompositeOperation = 'source-atop';
    lctx.fillStyle = tint[0];
    lctx.globalAlpha = tint[1];
    lctx.fillRect(0, 0, W, H);
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.layer, 0, 0);
    if (room.over) room.over(ctx, t, this.liveData);
    this.drawHover(ctx, t);
    this.updateDialog(dt);
  }

  drawHover(ctx, t) {
    const h = this.hover;
    if (!h) return;
    const a = 0.55 + Math.sin(t * 6) * 0.25;
    ctx.save();
    ctx.strokeStyle = `rgba(255,214,120,${a})`;
    ctx.lineWidth = 1;
    if (h.npc) {
      const p = this.placed.find((x) => x.npc === h.npc);
      if (p) {
        const [x, y, w, hh] = this.npcRect(p);
        ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(hh));
      }
    } else if (h.rect) {
      const [x, y, w, hh] = h.rect;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(hh));
    } else if (h.poly) {
      ctx.beginPath();
      h.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  npcRect(p) {
    const { x, y, h, seated } = p.slot;
    const tall = seated ? h * 0.58 : h;
    return [x - h * 0.2, y - tall, h * 0.4, tall];
  }

  // ----- pointer -----------------------------------------------------------------------------------

  scenePoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  hitTest(x, y) {
    const room = this.rooms[this.room];
    if (!room) return null;
    const people = (this.placed || []).slice().sort((a, b) => b.slot.y - a.slot.y);
    for (const p of people) {
      const [rx, ry, rw, rh] = this.npcRect(p);
      if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return { npc: p.npc, label: p.npc.title ? `${p.npc.name} · ${p.npc.title}` : p.npc.name };
    }
    for (let i = room.hotspots.length - 1; i >= 0; i--) {
      const hs = room.hotspots[i];
      if (hs.rect) {
        const [rx, ry, rw, rh] = hs.rect;
        if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return hs;
      } else if (hs.poly && inPoly(x, y, hs.poly)) return hs;
    }
    return null;
  }

  onMove(e) {
    const [x, y] = this.scenePoint(e);
    const h = this.hitTest(x, y);
    if ((h && h.npc) !== (this.hover && this.hover.npc) || (h && h.id) !== (this.hover && this.hover.id)) {
      this.hover = h;
      this.updateCaption();
    }
    this.canvas.style.cursor = h ? 'pointer' : 'default';
  }

  onClick(e) {
    const [x, y] = this.scenePoint(e);
    const h = this.hitTest(x, y);
    if (!h) { if (this.dialog) this.closeDialog(); return; }
    spaceAudio.playBeep();
    if (h.npc) { this.talkTo(h.npc); return; }
    switch (h.id) {
      case 'panel': this.openPanel(PANEL_OF[this.room]); break;
      case 'news': this.openPanel('news'); break;
      case 'launch': this.game.undockShip(); break;
      case 'vendor': this.talkTo(this.staff.vendor); break;
      default: this.go(h.id);
    }
  }

  updateCaption() {
    if (this.hover) { this.caption.textContent = this.hover.label; this.caption.classList.add('hot'); return; }
    this.caption.classList.remove('hot');
    const story = this.patrons().find((p) => p.kind === 'story' && p.room !== this.room);
    const where = { lobby: 'Lobby', bar: `Bar · ${BAR_NAMES[this.def.name]}`, exchange: 'Handelsbörse', workshop: 'Werkstatt', missions: this.pirate ? 'Auftragsbrett' : 'Auftragsbüro', office: this.pirate ? 'Mittelsmann' : 'SOLPOL-Revier', hangar: 'Landedeck' }[this.room];
    this.caption.textContent = story && this.room !== story.room
      ? `${where} · ${story.name} erwartet dich ${story.room === 'office' ? 'im SOLPOL-Revier' : 'in der Bar'}.`
      : where;
  }

  renderNav() {
    const offers = this.game.missions.offersAt(this.station.name).length;
    const label = { lobby: 'Lobby', bar: 'Bar', exchange: 'Börse', workshop: 'Werkstatt', missions: `Aufträge${offers ? ` (${offers})` : ''}`, office: this.pirate ? 'Kontor' : 'SOLPOL', hangar: 'Deck' };
    const waiting = this.patrons().filter((p) => p.kind === 'story' || p.kind === 'varga');
    this.nav.innerHTML = ROOMS.map((r) => `<button class="tab-btn ${r === this.room ? 'active' : ''} ${waiting.some((p) => p.room === r) ? 'alert' : ''}" data-room="${r}">${label[r]}</button>`).join('');
    this.credits.textContent = fmt(this.game.ship.credits);
  }

  bark(placed, text) {
    const [x, y] = [placed.slot.x, placed.slot.y - (placed.slot.seated ? placed.slot.h * 0.58 : placed.slot.h)];
    const b = document.createElement('div');
    b.className = 'station-bark';
    b.textContent = text;
    // Keep the bubble beside an open terminal panel, not under it
    b.style.left = `${this.view ? Math.min((x / W) * 100, 21) : (x / W) * 100}%`;
    b.style.top = `${(y / H) * 100}%`;
    this.barks.replaceChildren(b);
    setTimeout(() => b.classList.add('fade'), 4200);
    setTimeout(() => b.remove(), 5000);
  }

  // ----- terminal panel ----------------------------------------------------------------------------

  openPanel(view) {
    if (!view) return;
    this.view = view;
    const S = this.staff;
    const titles = {
      market: `Handelsbörse · ${S.trader.name}`,
      shipyard: `Werkstatt · ${S.mechanic.name}`,
      missions: this.pirate ? 'Auftragsbrett' : 'Auftragsbüro',
      office: this.pirate ? `Mittelsmann · ${S.officer.name}` : 'SOLPOL-Revier · Schalter',
      news: 'SOLNET · Nachrichten',
    };
    this.panelTitle.textContent = titles[view];
    this.panel.classList.remove('hidden');
    this.stage.classList.add('panel-open');
    this.renderPanel();
  }

  closePanel() {
    this.view = null;
    this.panel.classList.add('hidden');
    this.stage.classList.remove('panel-open');
  }

  renderPanel() {
    const views = { market: this.market, shipyard: this.shipyard, missions: this.missionBoard, news: this.bar, office: this.office };
    this.body.innerHTML = views[this.view].call(this);
    this.credits.textContent = fmt(this.game.ship.credits);
    if (this.view === 'missions' || this.view === 'news') {
      this.body.querySelectorAll('canvas[data-portrait]').forEach((c) => drawPortrait(c, c.dataset.faction, Number(c.dataset.seed)));
    }
  }

  // ----- conversations -----------------------------------------------------------------------------

  // node: { text, options: [{ label, run, disabled }] }
  say(npc, text, options) {
    this.dialog = { npc, text, shown: this.reducedMotion ? text.length : 0, options: options || [{ label: 'Bis dann.', run: () => this.closeDialog() }] };
    this.barks.replaceChildren();
    this.dlgName.textContent = npc.title ? `${npc.name} · ${npc.title}` : npc.name;
    this.dlgLine.textContent = '';
    this.dlgOptions.innerHTML = this.dialog.options.map((o, i) => `<button class="dialog-option" data-i="${i}" ${o.disabled ? 'disabled' : ''}>[${i + 1}] ${o.label}${o.disabled ? ` <small>${o.disabled}</small>` : ''}</button>`).join('');
    this.dlgOptions.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => this.answer(Number(b.dataset.i))));
    this.dialogEl.classList.remove('hidden');
    sfx.squelch();
  }

  updateDialog(dt) {
    const d = this.dialog;
    if (!d) return;
    if (d.shown < d.text.length) {
      d.shown = Math.min(d.text.length, d.shown + dt * 55);
      this.dlgLine.textContent = d.text.slice(0, Math.floor(d.shown));
    }
    const t = (performance.now() - this.t0) / 1000;
    drawFace(this.dlgFace, d.npc.spec, t, { talking: d.shown < d.text.length, bg: this.rooms[this.room].theme.wall2, light: this.rooms[this.room].theme.light });
  }

  answer(i) {
    const d = this.dialog;
    if (!d) return false;
    if (d.shown < d.text.length) { d.shown = d.text.length; this.dlgLine.textContent = d.text; return true; }
    const o = d.options[i];
    if (!o || o.disabled) { sfx.denied(); return true; }
    spaceAudio.playBeep();
    o.run();
    this.refresh();
    return true;
  }

  closeDialog() {
    this.dialog = null;
    this.dialogEl.classList.add('hidden');
  }

  // Esc: end the talk, then leave the room
  back() {
    if (this.dialog) { this.closeDialog(); return true; }
    if (this.room !== 'lobby') { this.go('lobby'); return true; }
    return false;
  }

  talkTo(npc) {
    const bye = { label: 'Bis dann.', run: () => this.closeDialog() };
    const more = (fn) => ({ label: 'Noch was …', run: fn });
    const { ship } = this.game;
    const name = this.station.name;
    switch (npc.kind || npc.role) {
      case 'bartender': {
        const price = this.pirate ? 25 : 15;
        const menu = () => this.say(npc, this.pirate ? 'Was willst du?' : 'Was darf\'s sein?', [
          { label: `Einen Drink (${price} Cr)`, disabled: ship.credits < price ? 'Zu wenig Geld' : null, run: () => {
            ship.credits -= price;
            sfx.coin();
            if ((this.drinks = (this.drinks || 0) + 1) <= 3) this.game.story.gain('reden', 4);
            const rumor = RUMORS[Math.floor(Math.random() * RUMORS.length)];
            this.say(npc, `Bitte schön. Und weil du so nett fragst: ${rumor}`, [more(menu), bye]);
          } },
          { label: 'Was gibt\'s Neues?', run: () => {
            const news = this.game.economy.news.slice(0, 2);
            this.say(npc, news.length ? `${news.join(' Und: ')} Mehr auf dem Schirm da drüben.` : 'Ruhige Zeiten. Verdächtig ruhig.', [more(menu), { label: 'Nachrichten ansehen', run: () => { this.closeDialog(); this.openPanel('news'); } }, bye]);
          } },
          { label: 'Wer zahlt gerade gut?', run: () => this.say(npc, this.tradeTip(), [more(menu), bye]) },
          bye,
        ]);
        menu();
        break;
      }
      case 'vendor': this.vendorTalk(npc); break;
      case 'guard': {
        const lines = GUARD_LINES[this.pirate ? 'pirate' : 'police'];
        const line = !this.pirate && this.game.law.wanted > 0 ? 'Ich hab Sie im Auge, Pilot.' : lines[Math.floor(Math.random() * lines.length)];
        this.say(npc, line);
        break;
      }
      case 'lounger': this.say(npc, LOUNGER_LINES[Math.floor(Math.random() * LOUNGER_LINES.length)]); break;
      case 'trader': this.closeDialog(); this.openPanel('market'); this.bark(this.placed.find((p) => p.npc === npc), this.greeting(npc)); break;
      case 'mechanic': this.closeDialog(); this.openPanel('shipyard'); this.bark(this.placed.find((p) => p.npc === npc), this.greeting(npc)); break;
      case 'clerk': this.closeDialog(); this.openPanel('missions'); this.bark(this.placed.find((p) => p.npc === npc), this.greeting(npc)); break;
      case 'officer': this.closeDialog(); this.openPanel('office'); this.bark(this.placed.find((p) => p.npc === npc), this.greeting(npc)); break;
      case 'deckhand':
        this.say(npc, `${this.greeting(npc)} Treibstoff ${Math.round(ship.fuel)} von ${ship.maxFuel}, Hülle ${Math.round((ship.hull / ship.maxHull) * 100)} %. Soll ich die Klammern lösen?`, [
          { label: 'Starten', run: () => this.game.undockShip() },
          { label: 'Noch nicht.', run: () => this.closeDialog() },
        ]);
        break;
      case 'story': {
        const offer = this.game.missions.storyOffers(name).find((o) => o.chapter === npc.chapter);
        if (!offer) { this.say(npc, 'Worauf wartest du noch?'); break; }
        this.runTree(npc, this.chapterTree(offer), 'start', offer);
        break;
      }
      case 'recruit': this.runTree(npc, this.recruitTree(npc, npc.crewId)); break;
      case 'varga': {
        const offer = npc.state === 'offer' ? this.game.missions.sideOffer('sonde') : null;
        if (npc.state === 'offer' && !offer) { this.say(npc, 'Fliegen Sie vorsichtig da draußen.'); break; }
        this.runTree(npc, this.vargaTree(npc, offer), 'start', offer);
        break;
      }
      case 'contact': {
        const offer = this.game.missions.offersAt(name).find((m) => m.id === npc.offerId);
        if (!offer) { this.say(npc, 'Der Job ist schon weg. Pech gehabt.'); break; }
        const blocker = this.game.missions.blocker(offer);
        this.say(npc, `Ich hätte Arbeit für dich. ${offer.title}: ${offer.text} Risiko ${stars(offer.danger || 1)}. Zahlt ${fmt(offer.reward)} Cr.`, [
          { label: 'Ich bin dabei.', disabled: blocker, run: () => {
            if (!this.game.missions.accept(offer, name)) { sfx.denied(); return; }
            this.game.hud.toast(`Auftrag angenommen: ${offer.title}`, 'info');
            this.gone = this.gone || new Set();
            this.say(npc, offer.giverFaction === 'pirate' ? 'Und kein Wort zu SOLPOL.' : 'Abgemacht. Enttäusch mich nicht.', [{ label: 'Bis dann.', run: () => { this.gone.add(npc.id); this.closeDialog(); } }]);
          } },
          { label: 'Nichts für mich.', run: () => this.closeDialog() },
        ]);
        break;
      }
      case 'scarred': {
        if (this.game.discovered.has('Hades-Nest')) { this.say(npc, 'Du weißt schon, wo es liegt. Verschwinde.'); break; }
        this.say(npc, `Du suchst das Nest? Ich wüsste, wo es liegt. ${fmt(HADES_TIP_PRICE)} Cr, und wir haben uns nie gesehen.`, [
          { label: `Koordinaten kaufen (${fmt(HADES_TIP_PRICE)} Cr)`, disabled: ship.credits < HADES_TIP_PRICE ? 'Zu wenig Geld' : null, run: () => {
            ship.credits -= HADES_TIP_PRICE;
            sfx.coin();
            this.game.discover('Hades-Nest');
            this.game.saveProgress();
            this.say(npc, 'Hinter dem Gürtel, wo das Hades-Feld am dichtesten ist. Steht jetzt auf deiner Karte. Und du hast es nicht von mir.');
          } },
          { label: 'Kein Interesse.', run: () => this.closeDialog() },
        ]);
        break;
      }
      case 'pilot': {
        const gossip = this.game.story.gossip(npc.seed);
        this.say(npc, gossip && npc.seed % 3 !== 0 ? `Du fliegst die SOL 4471? ${gossip}` : `Du fliegst die SOL 4471? ${RUMORS[npc.seed % RUMORS.length]}`);
        break;
      }
      case 'tipster': this.say(npc, this.tradeTip().replace(/^Händlerin am Tresen: /, '')); break;
      case 'veteran': this.say(npc, LORE[npc.seed % LORE.length], [{ label: 'Erzähl mehr.', run: () => this.say(npc, LORE[(npc.seed + 1 + Math.floor(Math.random() * 5)) % LORE.length]) }, { label: 'Was erzählt man sich so?', run: () => this.say(npc, this.game.story.gossip(npc.seed + 7) || 'Nichts, was du nicht schon weißt.') }, bye]); break;
      default: this.say(npc, 'Hallo.');
    }
  }

  // ----- dialogue trees ---------------------------------------------------------------------------
  // A node: { text, options: [{ label, need: [skill, level], if, hint, disabled, run, go, accept, close }] }.
  // Skill checks show the skill in front of the answer and stay greyed out until the pilot (with the crew) is good enough.

  runTree(npc, tree, id = 'start', offer = null) {
    const node = tree[id];
    if (!node) { this.closeDialog(); return; }
    const { story, missions } = this.game;
    const name = this.station.name;
    const options = node.options.filter((o) => !o.if || o.if()).map((o) => {
      let label = o.label;
      let disabled = o.disabled || null;
      if (o.need) {
        const [skill, lvl] = o.need;
        label = `[${SKILLS[skill].name} ${lvl}] ${label}`;
        if (!story.check(skill, lvl)) disabled = `${SKILLS[skill].name} ${lvl} nötig`;
      }
      if (o.accept && offer) {
        disabled = disabled || missions.blocker(offer);
        if (o.hint) label += ` · ${o.hint}`;
      } else if (o.hint) label += ` · ${o.hint}`;
      return {
        label, disabled,
        run: () => {
          if (o.need) story.gain('reden', 15);
          if (o.run) o.run();
          if (o.accept && offer) { this.acceptOffer(npc, offer, name); return; }
          if (o.close) { this.closeDialog(); return; }
          if (o.go) { this.runTree(npc, tree, o.go, offer); return; }
          if (!o.run) this.closeDialog();
        },
      };
    });
    const text = typeof node.text === 'function' ? node.text() : node.text;
    this.say(npc, text, options);
  }

  chapterTree(offer) {
    const ch = CHAPTERS[offer.chapter];
    const g = this.game;
    const finish = (endingId) => {
      g.missions.finishTalk(offer.chapter);
      this.closeDialog();
      this.gone = this.gone || new Set();
      g.story.finish(endingId);
    };
    if (ch.talk) return ch.talk({ offer, g, finish });
    return { start: { text: offer.text, options: [{ label: `Ich übernehme das (${fmt(offer.reward)} Cr)`, accept: true }, { label: 'Später.', close: true }] } };
  }

  acceptOffer(npc, offer, name) {
    const g = this.game;
    if (!g.missions.accept(offer, name)) { sfx.denied(); return; }
    g.hud.toast(`${offer.story ? 'Hauptauftrag' : 'Auftrag'} angenommen: ${offer.title}`, 'info');
    this.gone = this.gone || new Set();
    const line = offer.choice ? 'Dann ist es entschieden. Wir sehen uns da draußen.' : 'Gut. Ich verlasse mich auf dich. Viel Glück da draußen.';
    this.say(npc, line, [{ label: 'Bis dann.', run: () => { this.gone.add(npc.id); this.closeDialog(); this.patronsKey = null; this.renderNav(); } }]);
  }

  recruitTree(npc, id) {
    const def = CREW_DEFS[id];
    const g = this.game;
    const hire = {
      label: def.cost ? `Anheuern (${fmt(def.cost)} Cr)` : 'Komm an Bord.',
      disabled: g.ship.credits < def.cost ? 'Zu wenig Geld' : null,
      run: () => {
        if (!g.crew.hire(id)) { sfx.denied(); return; }
        sfx.coin();
        this.gone = this.gone || new Set();
        this.say(npc, id === 'jo' ? 'Abgemacht, Käpt\'n. Ich bring mein Werkzeug an Bord. Du findest mich im Maschinenraum.' : id === 'teo' ? 'Abgemacht. Sie finden mich auf der Brücke, Kapitän.' : 'Danke. Ich setze mich in die Messe und störe nicht.', [{ label: 'Willkommen an Bord.', run: () => { this.gone.add(npc.id); this.closeDialog(); this.patronsKey = null; } }]);
      },
    };
    return {
      start: { text: def.pitch, options: [hire, { label: 'Was bringst du mit?', go: 'bonus' }, { label: 'Erzähl mir von dir.', go: 'back' }, { label: 'Nein danke.', close: true }] },
      bonus: { text: def.bonus, options: [hire, { label: 'Erzähl mir von dir.', go: 'back' }, { label: 'Nein danke.', close: true }] },
      back: { text: def.back[0], options: [hire, { label: 'Was bringst du mit?', go: 'bonus' }, { label: 'Nein danke.', close: true }] },
    };
  }

  // Dr. Varga in the Europa bar: 'offer' while the signal quest is open, 'result' once the probe's core is here
  vargaState() {
    if (!this.station || this.station.name !== 'Europa-Station') return null;
    const { missions, story } = this.game;
    if (story.has('signal_kern') && !story.has('signal_entschieden')) return 'result';
    const ready = missions.done.includes('uniformen') || story.has('kranich_log');
    if (ready && missions.sideOffer('sonde')) return 'offer';
    return null;
  }

  vargaTree(npc, offer) {
    const g = this.game;
    const { story, missions } = g;
    if (npc.state === 'result') {
      const decide = (flag, text, credits, rep) => () => {
        story.set('signal_entschieden');
        story.set(flag);
        g.ship.credits += credits;
        story.changeRep(rep);
        if (credits) { sfx.coin(); g.hud.toast(`+${fmt(credits)} Cr`, 'gain'); }
        this.gone = this.gone || new Set();
        this.say(npc, text, [{ label: 'Leben Sie wohl, Doktor.', run: () => { this.gone.add(npc.id); this.closeDialog(); this.patronsKey = null; } }]);
        g.saveProgress();
      };
      return {
        start: {
          text: 'Ich habe den Speicherkern ausgelesen. Die AURORA-7 hat zwanzig Jahre lang etwas aufgezeichnet, das von weit hinter dem Kuipergürtel kommt. Es ist strukturiert. Es wiederholt sich. Und es enthält, ganz am Anfang, eine Folge von Primzahlen. Unsere eigene. Die, die wir 1974 von Arecibo gesendet haben.',
          options: [{ label: 'Eine Antwort?', go: 'antwort' }],
        },
        antwort: {
          text: 'Oder ein Echo. Oder etwas, das wir noch nicht verstehen. Die Frage ist: Wem gehört es? Ich will es veröffentlichen, für alle. Die Kreditbank hat mir heute früh 30.000 Credits geboten, damit es in ihrem Tresor verschwindet. Ihnen, nehme ich an, auch.',
          options: [
            { label: 'Veröffentlichen Sie es. Das gehört allen.', run: decide('signal_offen', 'Danke. Sie werden in den Fußnoten stehen, versprochen. Ganz oben.', 8000, { europa: 30, bank: -10 }) },
            { label: 'Ich behalte eine Kopie. Sie bekommen das Original.', need: ['technik', 3], run: () => { story.set('signal_kopie'); story.gain('technik', 40); decide('signal_offen', 'Sie haben eine Kopie gezogen, während wir geredet haben? Respekt. Passen Sie gut darauf auf.', 8000, { europa: 25 })(); } },
            { label: 'Die Bank zahlt 30.000. Ich verkaufe.', run: () => {
              decide('signal_verkauft', 'Dann gehen Sie. Und erzählen Sie mir nie, was die Bank damit gemacht hat.', 30000, { europa: -35, bank: 20 })();
              if (g.crew.has('teo')) g.crew.adjust('teo', -25, 'Sie verkaufen das an die Bank? Die Leute, die meine Mannschaft umgebracht haben?');
            } },
          ],
        },
      };
    }
    void missions;
    const intro = story.has('kranich_log')
      ? 'Sie haben das Logbuch der Kranich? Dann wissen Sie, dass hinter Neptun etwas sendet. Ich höre es seit Jahren, schwach, alle 41 Stunden.'
      : 'Sie sind Pilot? Ich suche jemanden, der weit fliegt und wenig fragt. Hinter Neptun sendet etwas, schwach und regelmäßig, alle 41 Stunden.';
    return {
      start: { text: intro, options: [{ label: 'Was soll ich tun?', go: 'offer' }, { label: 'Kein Interesse.', close: true }] },
      offer: { text: offer.text, options: [{ label: `Ich fliege hin (${fmt(offer.reward)} Cr)`, accept: true }, { label: 'Später.', close: true }] },
    };
  }

  tradeTip() {
    const { economy, missions } = this.game;
    const deals = economy.bestDeals(missions.knownStations()).filter((d) => d.bestBuy && d.bestSell && d.bestSell.price - d.bestBuy.price > GOODS[d.good].base * 0.35);
    deals.sort((a, b) => (b.bestSell.price - b.bestBuy.price) - (a.bestSell.price - a.bestBuy.price));
    const deal = deals[0];
    return deal
      ? `${GOODS[deal.good].name} kauft man gerade bei ${displayName(deal.bestBuy.name)} für ${fmt(deal.bestBuy.price)}, ${displayName(deal.bestSell.name)} zahlt ${fmt(deal.bestSell.price)}. Sag keinem, dass du's von mir hast.`
      : 'Die Preise sind gerade überall gleich mies.';
  }

  // ----- the street vendor -------------------------------------------------------------------------

  vendorOffers() {
    const { ship, economy, law } = this.game;
    const name = this.station.name;
    const key = `${name}:${Math.floor((economy.clock || 0) / 400)}`;
    if (this.vendorKey !== key) { this.vendorKey = key; this.vendorSold = new Set(); }
    const r = rng(hashStr(key));
    const free = ship.maxCargo - ship.getCurrentCargoWeight();
    const all = [
      () => { const p = Math.round(MISSILE_PRICE * 2 * 0.7); return { id: 'missiles', label: `2 Raketen aus Armeebeständen, ${fmt(p)} Cr`, price: p, why: ship.missiles + 2 > ship.maxMissiles ? 'Magazin voll' : null, apply: () => { ship.missiles += 2; } }; },
      () => { const p = Math.round(FLARE_PRICE * 4 * 0.6); return { id: 'flares', label: `4 Täuschkörper, ${fmt(p)} Cr`, price: p, why: ship.flares + 4 > ship.maxFlares ? 'Kein Platz' : null, apply: () => { ship.flares += 4; } }; },
      () => { const p = Math.round(25 * FUEL_PRICE * 0.7); return { id: 'fuel', label: `Kanister Treibstoff (+25), ${fmt(p)} Cr`, price: p, why: ship.fuel >= ship.maxFuel - 1 ? 'Tank ist voll' : null, apply: () => { ship.fuel = Math.min(ship.maxFuel, ship.fuel + 25); } }; },
      () => { const hp = Math.round(ship.maxHull * 0.25); const p = Math.round(hp * HULL_REPAIR_PRICE * 0.6); return { id: 'patch', label: `Notreparatur-Set (+${hp} Hülle), ${fmt(p)} Cr`, price: p, why: ship.hull >= ship.maxHull ? 'Hülle ist heil' : null, apply: () => { ship.hull = Math.min(ship.maxHull, ship.hull + hp); } }; },
      () => {
        const goods = GOOD_KEYS.filter((g) => economy.trades(name, g) && (!GOODS[g].contraband || this.def.blackMarket));
        if (!goods.length) return null;
        const g = goods[Math.floor(r() * goods.length)];
        const qty = 3 + Math.floor(r() * 5);
        const p = Math.round(economy.buyPrice(name, g) * 0.7) * qty;
        return { id: `goods-${g}`, label: `Restposten: ${qty} t ${GOODS[g].name}, ${fmt(p)} Cr`, price: p, why: free < qty ? 'Zu wenig Frachtraum' : null, apply: () => { ship.cargo[g] += qty; } };
      },
    ];
    if (this.def.blackMarket) all.push(() => ({ id: 'transponder', label: 'Gefälschter Transpondercode (Fahndung −1), 1.800 Cr', price: 1800, why: law.wanted <= 0 ? 'Du wirst nicht gesucht' : null, apply: () => { law.wanted = Math.max(0, law.wanted - 1); if (law.wanted === 0) law.clearPoliceAggro(); } }));
    // Shuffle by the period's seed and take three
    const order = all.map((f, i) => [r(), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => all[i]);
    const offers = [];
    for (const f of order) {
      const o = f();
      if (o) offers.push(o);
      if (offers.length >= 3) break;
    }
    return offers;
  }

  vendorTalk(npc) {
    const { ship } = this.game;
    const offers = this.vendorOffers();
    const options = offers.map((o) => ({
      label: this.vendorSold.has(o.id) ? `${o.label} (ausverkauft)` : o.label,
      disabled: this.vendorSold.has(o.id) ? 'Weg' : o.why || (ship.credits < o.price ? 'Zu teuer' : null),
      run: () => {
        ship.credits -= o.price;
        o.apply();
        this.vendorSold.add(o.id);
        sfx.coin();
        this.game.ui.updateHUDStats();
        this.game.saveProgress();
        this.say(npc, ['Gute Wahl! Frag nicht, woher es kommt.', 'Verkauft! Beehr mich bald wieder.', 'Ein Schnäppchen, ehrlich.'][Math.floor(Math.random() * 3)], [{ label: 'Was hast du noch?', run: () => this.vendorTalk(npc) }, { label: 'Bis dann.', run: () => this.closeDialog() }]);
      },
    }));
    options.push({ label: 'Kein Bedarf.', run: () => this.closeDialog() });
    this.say(npc, this.pirate ? 'Psst. Ware von "gefallenen" Frachtern. Keine Fragen, keine Quittung.' : 'Psst, Pilot! Restposten, nur heute, nur für dich.', options);
  }

  // ----- terminal views ----------------------------------------------------------------------------

  market() {
    const { economy, ship, missions } = this.game;
    const name = this.station.name;
    const known = missions.knownStations();
    const deals = economy.bestDeals(known.filter((n) => n !== name));
    const rows = GOOD_KEYS.filter((g) => economy.trades(name, g)).map((g) => {
      const buy = economy.buyPrice(name, g);
      const sell = economy.sellPrice(name, g);
      const stock = economy.available(name, g);
      const ratio = economy.mid(name, g) / GOODS[g].base;
      const tag = ratio > 1.25 ? '<em class="hi">gefragt</em>' : ratio < 0.8 ? '<em class="lo">günstig</em>' : '';
      const deal = deals.find((d) => d.good === g);
      const elsewhere = deal && deal.bestSell ? `${fmt(deal.bestSell.price)} · ${displayName(deal.bestSell.name)}` : '---';
      const held = ship.cargo[g];
      const cantBuy = stock <= 0 || ship.credits < buy || ship.getCurrentCargoWeight() >= ship.maxCargo;
      const event = economy.events.find((e) => e.station === name && e.good === g);
      return `<tr class="${GOODS[g].contraband ? 'contraband' : ''}">
        <td>${GOODS[g].name}${GOODS[g].contraband ? ' <em class="hi">illegal</em>' : ''} ${tag}${event ? ' <em class="ev">!</em>' : ''}</td>
        <td>${fmt(stock)} t</td>
        <td><b>${fmt(buy)}</b> / ${fmt(sell)}</td>
        <td class="dim">${elsewhere}</td>
        <td>${held} t</td>
        <td class="trade-btns">
          <button class="shop-action-btn" data-act="buy:${g}:1" ${cantBuy ? 'disabled' : ''}>+1</button>
          <button class="shop-action-btn" data-act="buy:${g}:10" ${cantBuy ? 'disabled' : ''}>+10</button>
          <button class="shop-action-btn sell" data-act="sell:${g}:1" ${held <= 0 ? 'disabled' : ''}>−1</button>
          <button class="shop-action-btn sell" data-act="sell:${g}:all" ${held <= 0 ? 'disabled' : ''}>Alles</button>
        </td></tr>`;
    }).join('');
    const free = ship.maxCargo - ship.getCurrentCargoWeight();
    const events = economy.events.filter((e) => e.station === name).map((e) => `<p class="event-line">! ${e.text}</p>`).join('');
    return `<div class="cargo-capacity-info">Frachtraum <span>${ship.getCurrentCargoWeight()} / ${ship.maxCargo} t</span>${ship.missionCargoWeight ? ` (davon ${ship.missionCargoWeight} t Auftragsfracht)` : ''} · frei ${free} t</div>
      ${events}
      <table class="market-table"><thead><tr><th>Ware</th><th>Lager</th><th>Kauf / Verkauf</th><th>Bester Verkauf anderswo</th><th>An Bord</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="trading-tip">Jede Tonne verändert den Preis. Große Ladungen drücken ihn spürbar, Mangel treibt ihn hoch.</p>`;
  }

  shipyard() {
    const ship = this.game.ship;
    const cards = Object.entries(UPGRADES).map(([key, u]) => {
      const tier = ship.upgrades[key];
      const cost = u.costs[tier - 1];
      const btn = tier >= 4
        ? '<button class="shop-action-btn upgrade-buy-btn" disabled>HÖCHSTE STUFE</button>'
        : `<button class="shop-action-btn upgrade-buy-btn" data-act="upgrade:${key}" ${ship.credits < cost ? 'disabled' : ''}>AUSBAUEN (${fmt(cost)} Cr)</button>`;
      return `<div class="upgrade-card"><h4>${u.name}</h4><p>${u.text}</p><div class="upgrade-info">Stufe <span>${tier}</span> von 4 <span class="pips">${'■'.repeat(tier)}${'□'.repeat(4 - tier)}</span></div>${btn}</div>`;
    }).join('');

    const tech = this.game.story.repairMult();
    const hullCost = Math.round((ship.maxHull - ship.hull) * HULL_REPAIR_PRICE * tech);
    const sysCost = Math.round(Object.values(ship.systems).reduce((s, c) => s + (1 - c) * 100, 0) * SYSTEM_REPAIR_PRICE * tech);
    const repair = hullCost + sysCost;
    const fuelCost = Math.round((ship.maxFuel - ship.fuel) * FUEL_PRICE);
    const sys = Object.entries(ship.systems).map(([k, c]) => `<span class="sys ${c < 0.35 ? 'bad' : c < 0.75 ? 'warn' : ''}">${SUBSYSTEMS[k]} ${Math.round(c * 100)}%</span>`).join('');
    return `<div class="service-row">
        <div class="service"><h4>Reparatur</h4><p>Hülle ${Math.round(ship.hull)} / ${ship.maxHull}</p><p class="sys-row">${sys}</p>
          <button class="shop-action-btn" data-act="repair" ${repair <= 0 || ship.credits <= 0 ? 'disabled' : ''}>${repair > 0 ? `Alles reparieren (${fmt(repair)} Cr)` : 'Keine Schäden'}</button></div>
        <div class="service"><h4>Treibstoff</h4><p>${Math.round(ship.fuel)} / ${ship.maxFuel} Einheiten</p><p class="dim">${difficultyOf(this.game).freeWarp ? 'Schwierigkeit Leicht: Sprünge kosten nichts.' : 'Ein Sprung kostet 2 bis 30 Einheiten, je nach Weite.'}</p>
          <button class="shop-action-btn" data-act="refuel" ${fuelCost <= 0 || ship.credits <= 0 ? 'disabled' : ''}>${fuelCost > 0 ? `Volltanken (${fmt(fuelCost)} Cr)` : 'Tank voll'}</button></div>
        <div class="service"><h4>Munition</h4><p>Raketen ${ship.missiles} / ${ship.maxMissiles} · Täuschkörper ${ship.flares} / ${ship.maxFlares}</p>
          <button class="shop-action-btn" data-act="missile" ${ship.missiles >= ship.maxMissiles || ship.credits < MISSILE_PRICE ? 'disabled' : ''}>Rakete (${MISSILE_PRICE} Cr)</button>
          <button class="shop-action-btn" data-act="flare" ${ship.flares >= ship.maxFlares || ship.credits < FLARE_PRICE ? 'disabled' : ''}>Täuschkörper (${FLARE_PRICE} Cr)</button></div>
      </div>
      <div class="hangar-upgrades-grid">${cards}</div>`;
  }

  missionBoard() {
    const { missions } = this.game;
    const name = this.station.name;
    const offers = missions.offersAt(name);
    const portrait = (faction, seed) => `<canvas class="portrait" data-portrait data-faction="${faction}" data-seed="${seed}" width="32" height="32"></canvas>`;
    const offerCards = offers.map((m) => {
      const blocker = missions.blocker(m);
      return `<div class="mission-card ${m.story ? 'story' : ''}">
        ${portrait(m.giverFaction, m.seed || m.giver.length * 97)}
        <div class="mission-text"><h4>${m.story ? 'HAUPTAUFTRAG · ' : ''}${m.title}</h4><p class="giver">${m.giver} · Risiko ${stars(m.danger || 1)}</p><p>${m.text}</p></div>
        <div class="mission-side"><b>${fmt(m.reward)} Cr</b>
        <button class="shop-action-btn" data-act="accept:${m.id}" ${blocker ? 'disabled' : ''}>Annehmen</button>${blocker ? `<small>${blocker}</small>` : ''}</div></div>`;
    }).join('') || '<p class="dim">Keine Aufträge im Moment. Schau später wieder vorbei.</p>';
    const active = missions.active.map((m) => {
      const obj = missions.current(m);
      return `<div class="mission-active ${missions.tracked === m ? 'tracked' : ''}"><span><b>${m.title}</b> · ${obj ? obj.label : ''}</span>
        <span><button class="shop-action-btn" data-act="track:${m.id}">Verfolgen</button><button class="shop-action-btn sell" data-act="abort:${m.id}">Abbrechen</button></span></div>`;
    }).join('');
    return `${active ? `<h3 class="section">Laufende Aufträge</h3>${active}` : ''}<h3 class="section">Angebote</h3>${offerCards}`;
  }

  // The news screen in the bar
  bar() {
    const { economy, law } = this.game;
    const news = economy.news.slice(0, 6).map((n) => `<li>${n}</li>`).join('') || '<li>Keine Meldungen.</li>';
    const standing = FACTION_KEYS.map((f) => `${FACTIONS[f].name}: <b>${law.repText(law.rep[f] || 0)}</b>`).join(' · ');
    return `<div class="bar-view">
      <div class="bar-col"><h3 class="section">Meldungen</h3><ul class="news">${news}</ul></div>
      <div class="bar-col"><h3 class="section">Dein Ruf</h3><p class="dim">${standing}</p><p class="rumor">Im Lokal hört man mehr: Sprich die Leute an.</p></div></div>`;
  }

  office() {
    const { law, ship } = this.game;
    const pirate = this.pirate;
    const debt = ship.debt > 0
      ? `<div class="service"><h4>Kreditbank Sol</h4><p>Restschuld für die SOL 4471: <b>${fmt(ship.debt)} Cr</b></p>
          ${pirate ? '<p class="dim">Hier gibt es keine Bankfiliale.</p>' : [1000, 5000].map((n) => `<button class="shop-action-btn" data-act="debt:${n}" ${ship.credits < Math.min(n, ship.debt) ? 'disabled' : ''}>${fmt(Math.min(n, ship.debt))} Cr tilgen</button>`).join('') + `<button class="shop-action-btn" data-act="debt:all" ${ship.credits < ship.debt ? 'disabled' : ''}>Alles tilgen</button>`}</div>`
      : '<div class="service"><h4>Kreditbank Sol</h4><p>Das Schiff gehört dir. Schuldenfrei.</p></div>';
    let law_ = '';
    if (pirate) {
      const price = law.fixerPrice();
      law_ = law.wanted > 0 || law.fines > 0
        ? `<div class="service"><h4>Mittelsmann</h4><p>„${law.wantedLabel()}, ${fmt(law.fines)} Cr offen. Für ${fmt(price)} Cr verschwindet deine Akte."</p><button class="shop-action-btn" data-act="fixer" ${ship.credits < price ? 'disabled' : ''}>Akte löschen (${fmt(price)} Cr)</button></div>`
        : '<div class="service"><h4>Mittelsmann</h4><p>„Deine Akte ist sauber. Langweilig."</p></div>';
    } else {
      const due = law.finesDue();
      law_ = law.fines > 0
        ? `<div class="service"><h4>SOLPOL Revier</h4><p>Status: <b>${law.wantedLabel()}</b>. Offene Bußgelder: <b>${fmt(law.fines)} Cr</b>${due < law.fines ? ` · nach einem Gespräch am Schalter: <b>${fmt(due)} Cr</b>` : ''}.</p><button class="shop-action-btn" data-act="fines" ${ship.credits < due ? 'disabled' : ''}>Bußgeld bezahlen (${fmt(due)} Cr)</button></div>`
        : '<div class="service"><h4>SOLPOL Revier</h4><p>Gegen Sie liegt nichts vor. Guten Flug.</p></div>';
    }
    const rank = law.rank();
    const next = law.nextRank();
    const record = `<div class="service"><h4>Pilotenakte</h4><p>Rang <b>${rank.name}</b>${next ? ` · nächster: ${next.name} (${law.points} / ${next.points})` : ''}</p>
      <p>Abschüsse: ${law.kills.pirate} Piraten, ${law.kills.police} Polizei, ${law.kills.civil} Zivil</p>
      <p>${FACTION_KEYS.map((f) => `${FACTIONS[f].short}: ${law.repText(law.rep[f] || 0)}`).join(' · ')}</p></div>`;
    return `<div class="service-row">${law_}${debt}${record}</div>`;
  }

  // ----- actions -----------------------------------------------------------------------------------

  act([what, a, b], shift) {
    const g = this.game;
    const { ship, economy, missions, law } = g;
    const name = this.station.name;
    let ok = true;
    switch (what) {
      case 'buy': {
        const n = b === 'all' ? 999 : Number(b) * (shift ? 5 : 1);
        ok = economy.buy(name, a, n).moved > 0;
        break;
      }
      case 'sell': {
        const n = b === 'all' ? 999 : Number(b) * (shift ? 10 : 1);
        ok = economy.sell(name, a, n).moved > 0;
        if (ok) sfx.coin();
        break;
      }
      case 'upgrade': {
        const cost = UPGRADES[a].costs[ship.upgrades[a] - 1];
        if (ship.upgrades[a] >= 4 || ship.credits < cost) { ok = false; break; }
        ship.credits -= cost;
        ship.upgrades[a]++;
        const hullFrac = ship.hull / ship.maxHull;
        ship.applyUpgrades();
        if (a === 'armor') ship.hull = ship.maxHull * hullFrac;
        if (a === 'shield') ship.shield = ship.maxShield;
        g.hud.toast(`${UPGRADES[a].name} auf Stufe ${ship.upgrades[a]}`, 'gain');
        break;
      }
      case 'repair': {
        const tech = g.story.repairMult();
        const hullCost = (ship.maxHull - ship.hull) * HULL_REPAIR_PRICE * tech;
        const sysCost = Object.values(ship.systems).reduce((s, c) => s + (1 - c) * 100, 0) * SYSTEM_REPAIR_PRICE * tech;
        const total = hullCost + sysCost;
        const k = Math.min(1, ship.credits / total);
        ship.credits -= Math.round(total * k);
        g.story.gain('technik', Math.round((total * k) / 60));
        ship.hull += (ship.maxHull - ship.hull) * k;
        Object.keys(ship.systems).forEach((s) => { ship.systems[s] += (1 - ship.systems[s]) * k; });
        break;
      }
      case 'refuel': {
        const want = ship.maxFuel - ship.fuel;
        const units = Math.min(want, Math.floor(ship.credits / FUEL_PRICE));
        ship.fuel += units;
        ship.credits -= Math.round(units * FUEL_PRICE);
        ok = units > 0;
        break;
      }
      case 'missile':
        if (ship.credits < MISSILE_PRICE || ship.missiles >= ship.maxMissiles) { ok = false; break; }
        ship.credits -= MISSILE_PRICE;
        ship.missiles++;
        break;
      case 'flare':
        if (ship.credits < FLARE_PRICE || ship.flares >= ship.maxFlares) { ok = false; break; }
        ship.credits -= FLARE_PRICE;
        ship.flares++;
        break;
      case 'accept': {
        const offer = missions.offersAt(name).find((m) => String(m.id) === a);
        ok = !!(offer && missions.accept(offer, name));
        if (ok) g.hud.toast(`Auftrag angenommen: ${offer.title}`, 'info');
        break;
      }
      case 'abort': {
        const m = missions.active.find((x) => String(x.id) === a);
        if (m) missions.abort(m);
        break;
      }
      case 'track': {
        const m = missions.active.find((x) => String(x.id) === a);
        if (m) missions.tracked = m;
        break;
      }
      case 'fines':
        ok = law.payFines();
        if (ok) g.hud.toast('Bußgelder bezahlt. Akte sauber.', 'gain');
        break;
      case 'fixer':
        ok = law.payFixer();
        if (ok) g.hud.toast('Deine Akte ist verschwunden.', 'gain');
        break;
      case 'debt': {
        const amount = a === 'all' ? ship.debt : Math.min(Number(a), ship.debt);
        if (ship.credits < amount || amount <= 0) { ok = false; break; }
        ship.credits -= amount;
        ship.debt -= amount;
        sfx.coin();
        if (ship.debt <= 0) {
          g.hud.toast('Kredit getilgt: Die SOL 4471 gehört dir!', 'gain');
          g.comm.say('Hier Kreditbank Sol. Ihr Kredit ist vollständig getilgt. Herzlichen Glückwunsch, das Schiff gehört Ihnen.', { speaker: 'Hollmann, Kreditbank', faction: 'civil', seed: 4021, duration: 8000 });
        }
        break;
      }
      default:
        ok = false;
    }
    if (ok) spaceAudio.playBeep();
    else sfx.denied();
    g.ui.updateHUDStats();
    g.saveProgress();
    this.renderPanel();
    this.renderNav();
  }
}

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export { STATION_DEFS };
