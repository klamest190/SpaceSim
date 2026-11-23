import { GOODS, GOOD_KEYS } from './world';
import { sfx } from './sfx';
import { rng } from './shipModel';

// Pirate radio. Every pirate wing has a captain with a name and a temper (a butcher, a businesswoman, a loudmouth,
// starving miners, a gentleman) who talks: calls you up on the way in, makes a demand you can meet, haggle down
// (Handel), face down (your reputation and Reden) or answer with guns; trash-talks through the fight, mourns a
// wingman, smells blood when your shields fail and begs when it goes wrong. Captains who get away remember you:
// the one you spared lets you pass, the one you shamed comes back for more.
// Z hails whatever ship is targeted: pirates, police, freighters, all have something to say.

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const fmt = (n) => Math.round(n).toLocaleString('de-DE');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (p) => `${Math.round(p * 100)} %`;

const NICKS = ['Rostzahn', 'Mutter Asche', 'Kupferkralle', 'Der Gerber', 'Glut-Vera', 'Schiefer-Jon', 'Die Zecke', 'Halbmond', 'Silberkehle', 'Rabenaas', 'Krätze', 'Die Witwe', 'Lumpen-Kai', 'Funken-Ole', 'Eisenmagd', 'Der Prediger', 'Sense', 'Vipernzahn', 'Bleifuß', 'Kaltschnauze'];
const HAIL_RANGE = 2500;

// Each temper: how it talks, how it deals. haggle / bluff shift the odds of those answers; demand scales the price.
const PERSONAS = {
  brutal: {
    title: 'Schlächter', haggle: -0.25, bluff: -0.3, demand: 1.5, share: 0.7, haggleAgain: false,
    greet: ['Hier spricht {name}. Motor aus, {ship}. Ich sag es nicht zweimal.', '{name} hier. Du fliegst durch mein Revier, Frachter. Das kostet.'],
    cargo: ['Wirf {share} von deiner Ladung ab. Alles wär mir lieber, aber ich bin heute gnädig.', 'Ich sehe {cargo} in deinem Bauch. {share} davon gehört jetzt mir.'],
    cash: ['{demand} Cr. Sofort. Oder ich zähle deine Einzelteile.', 'Leerer Laderaum? Dann zahlst du eben: {demand} Cr.'],
    haggleYes: ['Pah. Na gut, {price}. Bevor ich es mir anders überlege.'],
    haggleNo: ['Feilschen? Mit mir? Jungs, nehmt ihn auseinander!'],
    bluffYes: ['Du bist der {epithet}? ... Verdammt. Abdrehen, alle. Heute nicht.'],
    bluffNo: ['Ich hab schon Größere als dich gefressen. Feuer!'],
    comply: ['Kluge Wahl. Und jetzt verschwinde, bevor ich Hunger kriege.'],
    fight: ['Endlich. Ich dachte schon, du bist feige!', 'Gut. Ich mag es, wenn sie sich wehren.'],
    hurt: ['Das gibt Narben. Für dich!', 'Du kratzt am Lack. Ich kratz dir die Augen aus!'],
    wingLost: ['Du hast {wing} erwischt! Dafür häute ich dich!', '{wing} ist hin. Das zahlst du mit Blut.'],
    shields: ['Seine Schilde sind weg! Jetzt, alle zusammen!'],
    plea: ['Schon gut... Schon gut! Du hast gewonnen. Lass mich ziehen, und du siehst mich nie wieder.'],
    spared: ['Das... vergesse ich nicht. Ehrlich nicht.'],
    refused: ['Dann eben zusammen in die Hölle!'],
    flee: ['Wir sehen uns wieder, {ship}. Und dann ohne Gespräch.'],
  },
  geschaeft: {
    title: 'Geschäftsfrau', haggle: 0.2, bluff: 0, demand: 1, share: 0.5, haggleAgain: true,
    greet: ['Guten Tag, {ship}. {name}, Aschebund, Abteilung Wegezoll. Keine Sorge, das hier ist rein geschäftlich.', 'Hier {name}. Bitte bleiben Sie ruhig, wir sind gleich bei Ihnen. Eine kleine Formalität.'],
    cargo: ['Der Wegezoll beträgt heute {share} Ihrer Ladung. Ich sehe {cargo}, das sollte reichen.', 'Für die Durchfahrt nehmen wir {share} der Fracht. Quittungen stellen wir leider nicht aus.'],
    cash: ['Der Wegezoll beträgt heute {demand} Cr. Bargeldlos, selbstverständlich.', 'Sie fliegen leer? Dann eben {demand} Cr. Ich bin nicht unvernünftig.'],
    haggleYes: ['Sie verhandeln gut. {price}, und wir sind uns einig.', 'Na schön, Kulanz. {price}. Empfehlen Sie uns weiter.'],
    haggleNo: ['Mein Angebot war schon großzügig. Letzte Chance: {price}.'],
    bluffYes: ['Der {epithet}? Oh. Das ändert die Geschäftsgrundlage. Gute Reise.'],
    bluffNo: ['Beeindruckend. Aber Geschäft ist Geschäft. Feuer frei.'],
    comply: ['Danke für Ihre Kooperation. Wir wünschen eine sichere Weiterreise. Ironisch gemeint, natürlich.'],
    fight: ['Bedauerlich. Dann buche ich das unter Verlust ab. Ihren.', 'Schade. Ich hasse unbezahlte Rechnungen.'],
    hurt: ['Das wird eine teure Reparatur. Ich schicke Ihnen die Rechnung.', 'Sie beschädigen Firmeneigentum!'],
    wingLost: ['{wing} ist ausgefallen. Das schreibe ich Ihnen gut. Mit Zinsen.'],
    shields: ['Ihre Schilde sind erschöpft. Möchten Sie neu verhandeln? Nein? Dann weiter.'],
    plea: ['Gut, gut. Ein Vergleich: Ich lasse etwas Fracht hier, Sie lassen mich ziehen. Für beide Seiten ein gutes Geschäft.'],
    spared: ['Ein Ehrenmann. Das merke ich mir. Im Guten.'],
    refused: ['Dann eben die Insolvenz. Für uns beide.'],
    flee: ['Ich verbuche das als Lehrgeld. Bis zum nächsten Mal, {ship}.'],
  },
  grossmaul: {
    title: 'Großmaul', haggle: -0.05, bluff: 0.3, demand: 1.1, share: 0.6, haggleAgain: true,
    greet: ['HIER SPRICHT {name}, DER SCHRECKEN DES GÜRTELS! Zittere, {ship}!', 'Frachter! Weißt du, wer ich bin? {name}! Die Kinder auf Ceres haben Albträume von mir!'],
    cargo: ['Wirf {share} von deinem Kram ab, und vielleicht, VIELLEICHT, lasse ich dich leben!', '{cargo}? Her damit! {share}! Sofort! Das ist ein Befehl!'],
    cash: ['{demand} Credits, oder ich mache aus deinem Frachter eine Konservendose!', 'Du hast nichts geladen? Dann zahlst du {demand} Cr. Für meine Mühe!'],
    haggleYes: ['W-Was? Na... na gut! {price}! Aber nur, weil ich heute gute Laune habe!'],
    haggleNo: ['Feilschen?! MIT MIR?! {price}, und keinen Credit weniger!'],
    bluffYes: ['Der... der {epithet}? Ich... wir haben uns wohl im Schiff geirrt. Weitermachen! Ich meine, wegfliegen! Alle!', 'Ach DU bist das. Haha. Nur ein Scherz. Gute Reise!'],
    bluffNo: ['Das glaubst du doch selbst nicht! Angriff!'],
    comply: ['HA! Wieder einer, der vor {name} gekuscht hat! Erzähl es allen!'],
    fight: ['Du wagst es?! Das wird legendär! Für mich!', 'Gut! Endlich ein Kampf, über den man Lieder singt!'],
    hurt: ['Au! AU! Das war ein Glückstreffer!', 'Mein schönes Schiff! Du Barbar!'],
    wingLost: ['{wing}?! Du hast {wing} abgeschossen! Das... das war mein bester Mann!'],
    shields: ['Seine Schilde sind unten! Ich hab es euch gesagt! Ich bin unbesiegbar!'],
    plea: ['Okay, okay, okay! Auszeit! Wir können doch über alles reden! Ich lass die Beute da, du lässt mich gehen, ja? Bitte?'],
    spared: ['Ich erzähle allen, dass ich entkommen bin! Ähm. Danke.'],
    refused: ['Mama!'],
    flee: ['Das war ein taktischer Rückzug! Taktisch! Wir sehen uns, {ship}!'],
  },
  hunger: {
    title: 'Verzweifelte', haggle: 0.35, bluff: 0.25, demand: 0.45, share: 0.35, haggleAgain: true,
    greet: ['Hier ist {name}... Bitte, wir wollen keinen Ärger. Unsere Bohrung ist gepfändet, wir haben seit Tagen nichts gegessen.', '{name} an Frachter. Wir... wir müssen das tun. Tut mir leid. Wirklich.'],
    cargo: ['Gib uns {share} von deiner Ladung. Nur so viel, dass wir über den Monat kommen.', 'Bitte. {share} von {cargo}. Dann lassen wir dich in Ruhe.'],
    cash: ['{demand} Cr. Für Essen. Mehr wollen wir nicht.', 'Hast du {demand} Cr? Die Kinder in unserer Kolonie... bitte.'],
    haggleYes: ['{price}? Ja. Ja, das reicht. Danke.'],
    haggleNo: ['Weniger geht nicht. Wirklich nicht. {price}, bitte.'],
    bluffYes: ['Der {epithet}... Nein. Mit dir legen wir uns nicht an. Entschuldige. Wir fliegen.'],
    bluffNo: ['Wir haben nichts mehr zu verlieren. Verstehst du? Nichts!'],
    comply: ['Danke. Danke! Du hast keine Ahnung, was das bedeutet.'],
    fight: ['Dann... dann eben so. Gott steh uns bei.', 'Wir haben keine Wahl. Du schon. Merk dir das.'],
    hurt: ['Unser Schiff! Wir haben nur das eine!'],
    wingLost: ['Nein... {wing}... Er hatte zwei Kinder!'],
    shields: ['Seine Schilde sind unten. Bitte, gib einfach auf!'],
    plea: ['Aufhören! Bitte! Wir ergeben uns! Wir wollten doch nur essen!'],
    spared: ['Danke. Wir... wir suchen uns ehrliche Arbeit. Versprochen.'],
    refused: ['Dann sterben wir eben satt vor Wut.'],
    flee: ['Wir fliegen... Du hättest uns auch einfach was geben können.'],
  },
  kavalier: {
    title: 'Kavalier', haggle: 0.1, bluff: 0.1, demand: 1.2, share: 0.5, haggleAgain: true,
    greet: ['Einen wunderschönen guten Tag, {ship}! {name} am Apparat. Ich bitte um Verzeihung für die Störung.', 'Hier {name}, zu Ihren Diensten. Und Sie, fürchte ich, zu meinen.'],
    cargo: ['Ich muss Sie leider um {share} Ihrer Fracht erleichtern. {cargo}, wie ich sehe. Exquisit.', 'Wären Sie so liebenswürdig, {share} Ihrer Ladung über Bord zu geben? Ich wäre Ihnen sehr verbunden.'],
    cash: ['Eine bescheidene Spende von {demand} Cr, und wir trennen uns als Freunde.', '{demand} Cr, und ich vergesse, dass wir uns je begegnet sind. Ein fairer Handel, nicht wahr?'],
    haggleYes: ['Sie feilschen mit Stil. {price}, abgemacht. Es ist mir ein Vergnügen.'],
    haggleNo: ['Charmant, aber nein. {price}, mein letztes Wort.'],
    bluffYes: ['Der {epithet}? Welche Ehre! Unter Kollegen bestiehlt man sich nicht. Gute Reise!'],
    bluffNo: ['Ein hübscher Bluff. Leider durchschaut. Zu den Waffen!'],
    comply: ['Merci! Es war mir eine Ehre. Fliegen Sie vorsichtig, es treiben sich Piraten herum.'],
    fight: ['Ein Duell! Wie altmodisch. Ich liebe es!', 'En garde, {ship}!'],
    hurt: ['Touché! Aber noch nicht vorbei.', 'Ein Treffer, ich gebe es zu.'],
    wingLost: ['Adieu, {wing}. Ich trinke auf dich, heute Abend.'],
    shields: ['Ihre Schilde sind dahin, mein Freund. Ergeben Sie sich doch, es wäre so viel eleganter.'],
    plea: ['Ich gestehe meine Niederlage ein. Unter Ehrenleuten: Lassen Sie mich ziehen, und meine Fracht gehört Ihnen.'],
    spared: ['Sie sind ein wahrer Kavalier. Ich stehe in Ihrer Schuld.'],
    refused: ['Dann sterbe ich wenigstens mit Stil.'],
    flee: ['Ein strategischer Rückzug! Au revoir, {ship}!'],
  },
};
const PERSONA_KEYS = Object.keys(PERSONAS);

export class Radio {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.known = [];     // captains who got away: { nick, persona, seed, relation }
    this.parley = null;  // the shakedown under way
    this.fights = [];    // pirate wings with a talking captain
  }

  toSave() {
    return { known: this.known };
  }

  load(s) {
    if (!s) return;
    this.known = s.known || [];
  }

  // ----- captains ------------------------------------------------------------------------------------

  newCaptain() {
    const seed = Math.floor(Math.random() * 1e6);
    const r = rng(seed);
    const inBelt = this.game.solarSystem.securityAt(this.game.ship.position) < 0.4;
    // Starving miners are a belt thing
    const pool = inBelt ? PERSONA_KEYS : PERSONA_KEYS.filter((k) => k !== 'hunger');
    const used = new Set(this.known.map((k) => k.nick));
    const nicks = NICKS.filter((n) => !used.has(n));
    return { nick: nicks[Math.floor(r() * nicks.length)] || pick(NICKS), persona: pool[Math.floor(r() * pool.length)], seed, relation: null };
  }

  // Make a wing's leader a talking captain
  adopt(wing, captain = null) {
    const cap = captain || this.newCaptain();
    const leader = wing.leader;
    leader.captain = cap;
    leader.name = `${leader.spec.label.toUpperCase()} ${cap.nick.toUpperCase()}`;
    leader.fearless = true; // begs instead of running
    const fight = { wing, leader, cap, said: {}, lastLine: -1e9, pleaded: false };
    this.fights.push(fight);
    return fight;
  }

  who(cap) {
    const p = PERSONAS[cap.persona];
    return { speaker: `${cap.nick} · ${p.title}`, faction: 'pirate', seed: cap.seed };
  }

  fill(text, cap, extra = {}) {
    const g = this.game;
    const epithet = g.story.epithet() || 'Frachterpilot der SOL 4471';
    return text
      .replace(/\{name\}/g, cap.nick)
      .replace(/\{ship\}/g, 'SOL 4471')
      .replace(/\{epithet\}/g, epithet)
      .replace(/\{price\}/g, extra.demand !== undefined ? `${fmt(extra.demand)} Cr` : extra.share !== undefined ? `${Math.round(extra.share * 100)} Prozent der Ladung` : 'so viel')
      .replace(/\{demand\}/g, extra.demand !== undefined ? fmt(extra.demand) : '')
      .replace(/\{share\}/g, extra.share !== undefined ? `${Math.round(extra.share * 100)} Prozent` : '')
      .replace(/\{cargo\}/g, extra.cargo || 'Fracht')
      .replace(/\{wing\}/g, extra.wing || 'mein Flügelmann');
  }

  line(cap, key, extra = {}, opts = {}) {
    const p = PERSONAS[cap.persona];
    const text = this.fill(pick(p[key]), cap, extra);
    this.game.comm.say(text, { ...this.who(cap), urgent: true, duration: Math.max(4000, text.length * 55), ...opts });
    return text;
  }

  remember(cap, relation) {
    cap.relation = relation;
    const i = this.known.findIndex((k) => k.nick === cap.nick);
    if (i >= 0) this.known.splice(i, 1);
    if (relation === 'dead') return;
    this.known.unshift({ nick: cap.nick, persona: cap.persona, seed: cap.seed, relation });
    this.known.length = Math.min(this.known.length, 8);
  }

  // ----- the shakedown -------------------------------------------------------------------------------

  // Replaces the old fixed demand: a captain closes in, calls, and the talk decides
  ambush(pos, extra = 0) {
    const g = this.game;
    const enc = g.encounters;
    const at = pos || enc.spawnPoint(900, 1200);
    // Now and then it is someone you have met before
    const old = this.known.length && Math.random() < 0.4 ? pick(this.known) : null;
    const wing = enc.spawnPirates(at, enc.pirateComp(extra), { mode: 'hail' });
    wing.group.truce = true;
    wing.leader.holdRange = 200;
    const fight = this.adopt(wing, old ? { ...old } : null);
    enc.hail = { group: wing.group, leader: wing.leader };
    this.parley = { fight, wing, timer: 0, asked: false, haggled: false };
    sfx.klaxon();
    const cap = fight.cap;
    if (old && old.relation === 'spared') {
      g.comm.say(this.fill('Na sieh mal an. {ship}. Du hast mich damals laufen lassen, {name} vergisst so was nicht. Flieg weiter, heute bist du sicher.', cap), { ...this.who(cap), urgent: true, duration: 7000 });
      this.leave(wing, 'spared-pass');
      return wing;
    }
    if (old && old.relation === 'grudge') {
      g.comm.say(this.fill('Du! {ship}! Du hast {name} gedemütigt, das spricht sich rum. Diesmal gibt es nichts zu reden.', cap), { ...this.who(cap), urgent: true, duration: 6000 });
      this.startFight(wing, null);
      return wing;
    }
    if (old && old.relation === 'customer') {
      g.comm.say(this.fill('Mein liebster Kunde! {ship}, wie schön. Gleiches Spiel wie letztes Mal?', cap), { ...this.who(cap), urgent: true, duration: 6000 });
      this.parley.customer = true;
    } else {
      this.line(cap, 'greet');
    }
    return wing;
  }

  demandFor(cap, customer) {
    const { ship } = this.game;
    const p = PERSONAS[cap.persona];
    const weight = ship.getCurrentCargoWeight() - ship.missionCargoWeight;
    const bump = customer ? 1.25 : 1;
    if (weight > 0) {
      const top = GOOD_KEYS.filter((k) => ship.cargo[k] > 0).sort((a, b) => ship.cargo[b] - ship.cargo[a])[0];
      return { kind: 'cargo', share: Math.min(0.9, p.share * bump), cargo: `${ship.cargo[top]} t ${GOODS[top].name}` };
    }
    return { kind: 'cash', demand: Math.round(Math.max(200, ship.credits * 0.12 * p.demand * bump) / 10) * 10 };
  }

  odds(kind, cap) {
    const g = this.game;
    const p = PERSONAS[cap.persona];
    if (kind === 'haggle') return clamp(0.25 + (g.story.effective('handel') - 1) * 0.15 + p.haggle, 0.05, 0.92);
    const fame = Math.min(0.35, g.law.kills.pirate * 0.012) + (g.story.epithet() ? 0.12 : 0) + (g.story.effective('reden') - 1) * 0.08 + Math.min(0.15, g.law.points / 800);
    return clamp(0.08 + fame + p.bluff, 0.03, 0.9);
  }

  // Asked once they are close, or after a while
  ask() {
    const g = this.game;
    const P = this.parley;
    const { fight, wing } = P;
    const cap = fight.cap;
    const p = PERSONAS[cap.persona];
    const d = P.deal || this.demandFor(cap, P.customer);
    P.deal = d;
    const ship = g.ship;
    const text = d.kind === 'cargo' ? this.fill(pick(p.cargo), cap, d) : this.fill(pick(p.cash), cap, d);
    const options = [];
    if (d.kind === 'cargo') options.push({ label: `Ladung abwerfen (${Math.round(d.share * 100)} %)`, run: () => this.comply(d) });
    else options.push({ label: `${fmt(d.demand)} Cr zahlen`, disabled: ship.credits < d.demand ? 'Zu wenig Geld' : null, run: () => this.comply(d) });
    if (!P.haggled) {
      const o = this.odds('haggle', cap);
      options.push({ label: `[Handel] ${d.kind === 'cargo' ? 'Weniger. Viel weniger.' : 'Die Hälfte, und alle sind zufrieden.'} (${pct(o)})`, run: () => this.haggle(o) });
    }
    // One special way out, if the pilot has one
    const special = this.specialOption(cap);
    if (special) options.push(special);
    else if (!P.bluffed) {
      const o = this.odds('bluff', cap);
      options.push({ label: `[Ruf] Weißt du, mit wem du redest? (${pct(o)})`, run: () => this.bluff(o) });
    }
    options.push({ label: 'Komm und hol es dir.', run: () => this.startFight(wing, 'fight') });
    g.comm.ask(text, options, { ...this.who(cap), timeout: 18000, owner: wing.group, onTimeout: () => { g.comm.say(this.fill('Zu lange überlegt, {ship}. Feuer!', cap), { ...this.who(cap), urgent: true, duration: 3500 }); this.startFight(wing, null); } });
  }

  specialOption(cap) {
    const g = this.game;
    const { story, law, ship } = g;
    if (cap.persona === 'hunger') {
      const food = ['food', 'med'].filter((k) => ship.cargo[k] > 0);
      if (food.length) {
        const k = food[0];
        const n = Math.min(ship.cargo[k], 6);
        return { label: `Nehmt ${n} t ${GOODS[k].name}. Geschenkt.`, run: () => {
          ship.cargo[k] -= n;
          law.changeRep('pirate', 4);
          law.changeRep('guild', 3);
          story.gain('reden', 25);
          story.stats.spared++;
          g.comm.say(this.fill('Geschenkt? ... Danke. Ich weiß nicht, was ich sagen soll. Wenn du mal Hilfe brauchst im Gürtel: Frag nach {name}.', cap), { ...this.who(cap), urgent: true, duration: 7000 });
          this.remember(cap, 'spared');
          if (g.crew) g.crew.react({ jo: 6, teo: 3, nachtigall: 3 }, { jo: 'Das war anständig, Käpt\'n. Richtig anständig.' });
          this.leave(this.parley.wing, 'gift');
          g.ui.updateHUDStats();
        } };
      }
    }
    if (story.has('geier_verschont')) {
      return { label: 'Dragan Kral schuldet mir einen Gefallen.', run: () => {
        g.comm.say(this.fill('Kral? Der Geier? ... Wenn der für dich bürgt, will ich keinen Ärger. Weiterfliegen, {ship}.', cap), { ...this.who(cap), urgent: true, duration: 6000 });
        this.leave(this.parley.wing, 'name');
      } };
    }
    if ((story.path === 'asche' && !story.has('voss_tot')) || law.rep.pirate >= 25) {
      return { label: 'Ich fliege für Mara Voss.', run: () => {
        g.comm.say(this.fill('Für Voss? ... Das hättest du gleich sagen können. Grüß sie von {name}. Und vergiss uns, ja?', cap), { ...this.who(cap), urgent: true, duration: 6000 });
        law.changeRep('pirate', 1);
        this.leave(this.parley.wing, 'name');
      } };
    }
    return null;
  }

  comply(deal) {
    const g = this.game;
    const { ship, law } = g;
    const P = this.parley;
    if (deal.kind === 'cargo') {
      const keys = GOOD_KEYS.filter((k) => ship.cargo[k] > 0).sort((a, b) => GOODS[b].base - GOODS[a].base);
      let toDrop = Math.ceil((ship.getCurrentCargoWeight() - ship.missionCargoWeight) * deal.share);
      keys.forEach((k) => { const n = Math.min(toDrop, ship.cargo[k]); ship.cargo[k] -= n; toDrop -= n; });
    } else {
      if (ship.credits < deal.demand) { sfx.denied(); this.ask(); return; }
      ship.credits -= deal.demand;
    }
    law.changeRep('pirate', 2);
    this.line(P.fight.cap, 'comply');
    this.remember(P.fight.cap, 'customer');
    this.leave(P.wing, 'comply');
    g.ui.updateHUDStats();
  }

  haggle(chance) {
    const g = this.game;
    const P = this.parley;
    const cap = P.fight.cap;
    const p = PERSONAS[cap.persona];
    P.haggled = true;
    g.story.gain('handel', 12);
    if (Math.random() < chance) {
      g.story.gain('reden', 10);
      if (P.deal.kind === 'cargo') P.deal = { ...P.deal, share: Math.max(0.15, P.deal.share * 0.5) };
      else P.deal = { ...P.deal, demand: Math.round(P.deal.demand * 0.5 / 10) * 10 };
      this.line(cap, 'haggleYes', P.deal);
      setTimeout(() => { if (this.parley === P) this.ask(); }, 2200);
    } else if (!p.haggleAgain) {
      this.line(cap, 'haggleNo', P.deal);
      this.startFight(P.wing, null);
    } else {
      this.line(cap, 'haggleNo', P.deal);
      setTimeout(() => { if (this.parley === P) this.ask(); }, 2600);
    }
  }

  bluff(chance) {
    const g = this.game;
    const P = this.parley;
    const cap = P.fight.cap;
    P.bluffed = true;
    if (Math.random() < chance) {
      g.story.gain('reden', 30);
      this.line(cap, 'bluffYes');
      this.remember(cap, 'grudge');
      this.leave(P.wing, 'bluff');
    } else {
      g.story.gain('reden', 8);
      this.line(cap, 'bluffNo');
      this.startFight(P.wing, null);
    }
  }

  // The wing turns away and jumps out after a while
  leave(wing, why) {
    const enc = this.game.encounters;
    if (enc.hail && enc.hail.group === wing.group) enc.hail = null;
    if (this.parley && this.parley.wing === wing) this.parley = null;
    wing.group.truce = true;
    wing.group.aggro = false;
    wing.ships.forEach((n) => { if (n.alive) { n.aggro = false; n.mode = 'flee'; n.fleeFrom = null; n.leaving = 5 + Math.random() * 3; } });
    this.fights = this.fights.filter((f) => f.wing !== wing);
    void why;
  }

  startFight(wing, key) {
    const g = this.game;
    const enc = g.encounters;
    if (enc.hail && enc.hail.group === wing.group) enc.hail = null;
    if (this.parley && this.parley.wing === wing) this.parley = null;
    wing.group.truce = false;
    wing.group.aggro = true;
    wing.ships.forEach((n) => { if (n.alive && n.guns) n.attack(g.ship); });
    const f = this.fights.find((x) => x.wing === wing);
    if (f && key) this.line(f.cap, key);
  }

  // ----- every frame -----------------------------------------------------------------------------------

  update(dt) {
    const g = this.game;
    const ship = g.ship;
    const P = this.parley;
    if (P) {
      const leader = P.fight.leader;
      if (!leader.alive) { this.parley = null; g.encounters.hail = null; }
      else if (!P.asked) {
        P.timer += dt;
        if (leader.pos.distanceTo(ship.position) < 520 || P.timer > 9) {
          P.asked = true;
          this.ask();
        }
      }
    }
    const now = performance.now();
    this.fights = this.fights.filter((f) => f.leader.alive || f.wing.ships.some((s) => s.alive));
    this.fights.forEach((f) => {
      const L = f.leader;
      if (!L.alive || !f.wing.group.aggro || L.surrendered) return;
      const quiet = now - f.lastLine > 7000 && !g.comm.pendingQuestion;
      const k = L.hull / L.maxHull;
      if (!f.said.hurt && k < 0.6 && quiet) { f.said.hurt = true; f.lastLine = now; this.line(f.cap, 'hurt'); }
      else if (!f.said.shields && ship.shield <= 1 && L.pos.distanceTo(ship.position) < 1200 && quiet) { f.said.shields = true; f.lastLine = now; this.line(f.cap, 'shields'); }
      if (!f.pleaded && k < 0.25 && !g.comm.pendingQuestion) {
        f.pleaded = true;
        f.lastLine = now;
        this.plea(f);
      }
    });
  }

  // Low on hull: the captain begs
  plea(f) {
    const g = this.game;
    const L = f.leader;
    const cap = f.cap;
    const p = PERSONAS[cap.persona];
    const sec = g.solarSystem.securityAt(L.pos);
    g.comm.ask(this.fill(pick(p.plea), cap), [
      { label: 'Verschwinde. Und lass die Ladung hier.', run: () => {
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) g.spawnLoot(L.pos.clone().add(L.vel.clone().multiplyScalar(0.2)).addScaledVector(L.forward().clone(), -8 - i * 3), pick(['tech', 'lux', 'med', 'arms', 'stims']), 1 + Math.floor(Math.random() * 2));
        g.law.changeRep('pirate', 3);
        g.story.stats.spared++;
        g.story.gain('reden', 20);
        this.line(cap, 'spared');
        this.remember(cap, 'spared');
        this.leave(f.wing, 'spared');
        f.wing.ships.forEach((s) => { if (s.alive) s.jumpOut(); });
      } },
      { label: sec > 0.2 ? 'Ergib dich. SOLPOL holt dich ab.' : 'Ergib dich. Ich schleppe dich zur nächsten Streife.', run: () => this.arrest(f) },
      { label: 'Nein.', run: () => { this.line(cap, 'refused'); } },
    ], { ...this.who(cap), timeout: 12000, owner: f.wing.group, onTimeout: () => this.line(cap, 'refused') });
  }

  // Taken alive: the bounty, a little more, and SOLPOL's thanks
  arrest(f) {
    const g = this.game;
    const L = f.leader;
    const cap = f.cap;
    L.surrendered = true;
    L.guns = null;
    L.missiles = 0;
    L.faction = 'civil';
    L.mode = 'surrender';
    L.target = null;
    f.wing.group.truce = true;
    f.wing.group.aggro = false;
    f.wing.ships.forEach((s) => { if (s !== L && s.alive) s.jumpOut(); });
    this.fights = this.fights.filter((x) => x !== f);
    g.comm.say(this.fill('Schon gut. Ich ergebe mich. Waffen sind kalt. Wenigstens krieg ich in der Zelle was zu essen.', cap), { ...this.who(cap), urgent: true, duration: 5000 });
    this.remember(cap, 'dead'); // out of circulation
    setTimeout(() => {
      if (!L.alive) return;
      const reward = Math.round((L.bounty || 500) * 1.5);
      if (g.law.wanted <= 1) {
        g.ship.credits += reward;
        g.hud.toast(`Lebend gefasst: ${cap.nick} · +${fmt(reward)} Cr`, 'gain');
        sfx.coin();
      }
      g.law.changeRep('police', 4);
      g.law.changeRep('pirate', -2);
      g.law.points += L.points;
      g.story.gain('reden', 25);
      g.story.stats.spared++;
      g.comm.say(`Hier SOLPOL. Wir übernehmen ${cap.nick}. Saubere Arbeit, Pilot, lebend ist er uns lieber.`, { speaker: 'SOLPOL Leitstelle', faction: 'police', seed: 12, duration: 6000 });
      g.story.news(`SOLNET: Piratenkapitän „${cap.nick}" lebend gefasst. Ein Frachterpilot lieferte ihn bei SOLPOL ab.`);
      g.fx.warpFlash(L.pos, L.forward().clone());
      g.npcs.remove(L);
      g.ui.updateHUDStats();
    }, 7000);
  }

  // A ship died: wingmen grieve, a captain's crew may give up
  onKill(npc, killer) {
    const g = this.game;
    const f = this.fights.find((x) => x.wing.ships.includes(npc));
    if (!f) return;
    if (npc === f.leader) {
      this.remember(f.cap, 'dead');
      const left = f.wing.ships.filter((s) => s.alive && s !== npc);
      if (left.length && killer === g.ship && Math.random() < 0.55) {
        g.comm.say(pick(['Der Käpt\'n ist tot! Rückzug, alle raus!', 'Sie haben den Käpt\'n erwischt! Nicht schießen, wir hauen ab!']), { speaker: left[0].name, faction: 'pirate', seed: left[0].pos.x, urgent: true, duration: 4000 });
        left.forEach((s) => { s.wing.truce = true; s.wing.aggro = false; s.aggro = false; s.flee(g.ship); });
      }
      return;
    }
    if (f.leader.alive && killer === g.ship && !f.said.wing) {
      f.said.wing = true;
      const wingName = npc.name.split(' ').slice(1).join(' ') || 'mein Flügelmann';
      f.lastLine = performance.now();
      this.line(f.cap, 'wingLost', { wing: wingName.charAt(0) + wingName.slice(1).toLowerCase() });
    }
  }

  // A captain's ship running for it
  onFlee(npc) {
    const f = this.fights.find((x) => x.leader === npc);
    if (!f) return false;
    this.line(f.cap, 'flee');
    this.remember(f.cap, 'grudge');
    return true;
  }

  // ----- Z: hail the targeted ship -----------------------------------------------------------------------

  hail() {
    const g = this.game;
    const { ship, comm } = g;
    if (!g.flying() || comm.pendingQuestion) return;
    const t = ship.targetObject;
    if (!t || t.kind !== 'npc' || !t.alive) {
      sfx.denied();
      g.hud.toast('Erst ein Schiff aufschalten (R oder T), dann Z zum Anfunken', 'info');
      return;
    }
    if (t.pos.distanceTo(ship.position) > HAIL_RANGE) {
      sfx.denied();
      g.hud.toast('Zu weit weg für Funk', 'info');
      return;
    }
    sfx.squelch();
    if (t.surrendered) { comm.say('Wir ergeben uns doch schon! Was willst du noch?', { speaker: t.name, faction: 'civil', seed: t.pos.x, urgent: true }); return; }
    if (t.ally) { comm.say(pick(['Wir sind bei dir, Pilot. Konzentrier dich aufs Ziel!', 'Rücken frei, wir passen auf.', 'Funkdisziplin, Pilot!']), { speaker: t.name, faction: t.look, seed: t.pos.x, urgent: true }); return; }
    if (t.faction === 'pirate') this.hailPirate(t);
    else if (t.faction === 'police') this.hailPolice(t);
    else if (t.faction === 'rogue') comm.say(pick(['Hier SOLPOL. Ähm. Weiterfliegen, Frachter. Nichts zu sehen.', 'Das geht Sie nichts an. Abdrehen.']), { speaker: t.name, faction: 'police', seed: t.pos.x, urgent: true });
    else this.hailCivil(t);
  }

  hailPirate(t) {
    const g = this.game;
    const { comm, ship, npcs, law, story } = g;
    const f = this.fights.find((x) => x.wing.ships.includes(t));
    const lead = f && f.leader.alive ? f.leader : t;
    const cap = f ? f.cap : null;
    const who = cap ? this.who(cap) : { speaker: t.name, faction: 'pirate', seed: t.pos.x };
    const say = (text) => comm.say(text, { ...who, urgent: true, duration: 6000 });
    const wing = f ? f.wing : t.wing ? { group: t.wing, ships: t.wing.members, leader: lead } : { group: null, ships: [t], leader: t };
    // Fighting you, or just out there (maybe busy with someone else)?
    const engaged = wing.ships.some((s) => s.alive && s.target === ship && s.mode === 'attack') || (wing.group && wing.group.aggro);
    const hostile = npcs.isHostile(t, ship);
    if (this.parley && this.parley.wing.ships.includes(t)) { this.ask(); return; }

    if (engaged) {
      // Mid-fight: buy a ceasefire or talk them out of it, easier when they are losing
      const alive = wing.ships.filter((s) => s.alive);
      const health = alive.reduce((s, n) => s + n.hull / n.maxHull, 0) / Math.max(1, alive.length);
      const price = Math.round(Math.max(300, ship.credits * 0.1) / 10) * 10;
      const o = clamp(0.1 + (1 - health) * 0.5 + (story.effective('reden') - 1) * 0.08 + (cap ? PERSONAS[cap.persona].bluff * 0.5 : 0), 0.05, 0.9);
      comm.ask(cap ? this.fill('Was ist, {ship}? Angst gekriegt?', cap) : 'Was willst du? Wir sind beschäftigt!', [
        { label: `Waffenstillstand: ${fmt(price)} Cr, und ihr dreht ab.`, disabled: ship.credits < price ? 'Zu wenig Geld' : null, run: () => {
          ship.credits -= price;
          law.changeRep('pirate', 1);
          say(cap ? this.fill('Geld stinkt nicht. Abmarsch, Leute. Bis bald, {ship}.', cap) : 'Gekauft. Wir sind weg.');
          if (cap) this.remember(cap, 'customer');
          this.leave(wing, 'ceasefire');
          g.ui.updateHUDStats();
        } },
        { label: `[Reden] Ihr verliert. Haut ab, solange ihr könnt. (${pct(o)})`, run: () => {
          if (Math.random() < o) {
            story.gain('reden', 25);
            say(cap ? this.fill('...Verdammt. Du hast recht. Rückzug! Das hier ist noch nicht vorbei, {ship}.', cap) : 'Na gut, na gut! Wir sind weg!');
            if (cap) this.remember(cap, 'grudge');
            this.leave(wing, 'talked');
          } else {
            story.gain('reden', 6);
            say(cap ? this.fill('Netter Versuch. Weiterschießen!', cap) : 'Ha! Weiterschießen, Jungs!');
          }
        } },
        { label: 'Nichts. Feuer frei.', run: () => say('Dachte ich mir.') },
      ], { ...who, timeout: 12000, owner: wing.group });
      return;
    }

    // Not hostile: business, gossip, or the pilot picking a fight for someone else
    const victim = lead.target && lead.target.alive && lead.target !== ship && lead.target.faction === 'civil' ? lead.target : null;
    const options = [];
    if (victim) {
      const o = this.odds('bluff', cap || { persona: 'geschaeft' });
      options.push({ label: `[Ruf] Lasst den Frachter in Ruhe. (${pct(o)})`, run: () => {
        if (Math.random() < o) {
          story.gain('reden', 25);
          say('Schon gut, schon gut. Der gehört dir. Abdrehen!');
          this.leave(wing, 'protect');
          story.stats.rescued++;
        } else {
          say('Misch dich nicht ein, Frachter. Oder bist du der Nächste?');
          if (wing.group) { wing.group.truce = false; wing.group.aggro = true; }
          wing.ships.forEach((s) => { if (s.alive && s.guns) s.attack(ship); });
        }
      } });
    }
    const goods = ['stims', 'arms'];
    const good = goods[Math.floor(t.pos.x * 7) % 2 === 0 ? 0 : 1];
    const qty = 3;
    const price = Math.round(GOODS[good].base * 0.7) * qty;
    const free = ship.maxCargo - ship.getCurrentCargoWeight();
    if (!hostile) options.push({ label: `Habt ihr Ware? (${qty} t ${GOODS[good].name}, ${fmt(price)} Cr)`, disabled: ship.credits < price ? 'Zu wenig Geld' : free < qty ? 'Kein Frachtraum' : null, run: () => {
      ship.credits -= price;
      ship.cargo[good] += qty;
      law.changeRep('pirate', 1);
      story.gain('handel', 15);
      say(`${qty} t ${GOODS[good].name}, frisch vom Laster gefallen. Lass dich nicht von SOLPOL scannen.`);
      g.ui.updateHUDStats();
    } });
    options.push({ label: 'Was erzählt man sich im Gürtel?', run: () => say(story.gossip(Math.floor(t.pos.x)) || pick(['Die Bank kauft Schürfrechte, als gäb es kein Morgen. Wer pleitegeht, kommt zu uns.', 'Kesslers Streifen schießen auf alles, was zu viel weiß. Pass auf dich auf.', 'Die Schwarze Sonne ist größer als jede Station. Sagt man.'])) });
    options.push({ label: 'Nichts.', run: () => say('Dann stör nicht.') });
    const opener = victim ? 'Beschäftigt, Frachter. Was willst du?' : hostile ? 'Du funkst uns an? Mutig. Was willst du, {ship}?' : '{name} hier. Was willst du, {ship}?';
    comm.ask(cap ? this.fill(opener, cap) : this.fill(opener, { nick: t.name }), options, { ...who, timeout: 15000, owner: wing.group });
  }

  hailPolice(t) {
    const g = this.game;
    const { comm, law, npcs, ship } = g;
    const who = { speaker: t.name, faction: 'police', seed: t.pos.x };
    const say = (text) => comm.say(text, { ...who, urgent: true, duration: 6000 });
    if (law.wanted >= 2) { say('Sie wagen es, uns anzufunken? Maschinen stoppen, Sie sind festgenommen!'); return; }
    const pirate = npcs.ships.filter((n) => n.alive && n.faction === 'pirate' && n.pos.distanceTo(ship.position) < 2500).sort((a, b) => a.pos.distanceTo(ship.position) - b.pos.distanceTo(ship.position))[0];
    const options = [
      { label: 'Wie ist die Lage im Sektor?', run: () => say(law.wanted === 1 ? `Für Sie liegt ein Bußgeld von ${fmt(law.fines)} Cr vor. Begleichen Sie es an der nächsten Station.` : pick(['Ruhig, soweit. Halten Sie sich von den Schifffahrtswegen im Gürtel fern.', 'Wir hatten heute zwei Überfälle. Fliegen Sie nicht allein, wenn es sich vermeiden lässt.', 'Alles sauber. Und das bleibt hoffentlich so.'])) },
    ];
    if (pirate) options.push({ label: `Piraten gemeldet: ${pirate.name}!`, run: () => { t.attack(pirate); law.changeRep('police', 1); say('Verstanden, wir übernehmen. Halten Sie Abstand, Pilot.'); } });
    options.push({ label: 'Nichts. Guten Flug.', run: () => say('Guten Flug, Pilot.') });
    comm.ask('Hier SOLPOL. Was gibt es, Pilot?', options, { ...who, timeout: 12000 });
  }

  hailCivil(t) {
    const g = this.game;
    const { comm } = g;
    const who = { speaker: t.name, faction: 'civil', seed: t.pos.x };
    const say = (text) => comm.say(text, { ...who, urgent: true, duration: 7000 });
    comm.ask(pick(['Hier Frachter. Was gibt es, Kollege?', 'Ja? Hier Frachter, wir hören.']), [
      { label: 'Wo zahlt man gerade gut?', run: () => say(g.ui.stationUI.tradeTip()) },
      { label: 'Was gibt es Neues?', run: () => say(g.story.gossip(Math.floor(t.pos.z)) || g.economy.news[0] || 'Nichts Neues. Und das ist gut so.') },
      { label: 'Guten Flug.', run: () => say(pick(['Dir auch. Pass auf im Gürtel.', 'Danke, Kollege. Klare Sterne!'])) },
    ], { ...who, timeout: 12000 });
  }
}
