import { sfx } from './sfx';

// The pilot's story state: what has happened (flags), what the pilot can do (four skills that grow with use),
// the chronicle of the career, and how the world talks about it. The plot itself lives in storyline.js;
// this keeps score, so every system (dialogue, crew, news, prices, the ending) can ask one place.

export const SKILLS = {
  flug: { name: 'Fliegen', text: 'Tempo, Schub und Wendigkeit, Zielsicherheit in Gesprächen unter Piloten.' },
  handel: { name: 'Handel', text: 'Bessere Kurse an der Börse, mehr Geld beim Feilschen.' },
  technik: { name: 'Technik', text: 'Billigere Reparaturen; ab Stufe 3 flickt sich die Bordelektronik unterwegs selbst.' },
  reden: { name: 'Reden', text: 'Höhere Auftragsprämien, niedrigere Bußgelder, mehr Wege in Gesprächen.' },
};
export const SKILL_KEYS = Object.keys(SKILLS);
const LEVEL_XP = [0, 0, 150, 450, 1000, 1900]; // XP needed for level 1..5
export const MAX_LEVEL = 5;

// The powers of the solar system and who runs which station
export const FACTIONS = {
  police: { name: 'SOLPOL', short: 'SOLPOL' },
  pirate: { name: 'Aschebund', short: 'Aschebund' },
  bank: { name: 'Kreditbank Sol', short: 'Kreditbank' },
  guild: { name: 'Bergbaugilde', short: 'Gilde' },
  europa: { name: 'Freies Europa', short: 'Europa' },
};
export const FACTION_KEYS = Object.keys(FACTIONS);

export const ENDINGS = {
  ordnung: {
    title: 'Recht und Ordnung',
    text: 'Hollmann sitzt in einer Zelle der Erde-Station, Oberst Kessler in der Nachbarzelle. Die Kreditbank Sol steht unter Zwangsverwaltung, und Inspektorin Rhee hat zum ersten Mal seit Jahren Urlaub beantragt. Abgelehnt, natürlich. Die SOL 4471 gehört dir, schuldenfrei. Auf den Frachtrouten wird es ruhiger.',
  },
  freie_flagge: {
    title: 'Freie Flagge',
    text: 'Mit dem Kontobuch der Bank in der Hand handelt Mara Voss etwas aus, das niemand für möglich hielt: Der Aschebund wird zur Gürtelmiliz, die Gilde bekommt ihre Schürfrechte zurück, und das Hades-Nest öffnet seine Schleusen für jeden, der ehrlich zahlt. SOLPOL schäumt. Die Bergleute nennen dich beim Namen, wenn du in ihre Bars kommst.',
  },
  vergeltung: {
    title: 'Kurzer Prozess',
    text: 'Die Goldene Rate ist ein Trümmerfeld über den Wolken der Venus, und mit ihr alles, was Hollmann je hätte aussagen können. Die Bank schweigt, bezahlt Anwälte und macht weiter, nur leiser. Du bist frei, und die Kneipen erzählen von dir. Ob das Gerechtigkeit war, fragst du dich nur nachts.',
  },
  preis: {
    title: 'Der Preis',
    text: 'Hundertfünfzigtausend Credits, und die Goldene Rate springt davon. Die SOL 4471 ist bezahlt, das Konto voll, die Funkkanäle still. Wer an deiner Seite geflogen ist, redet nicht mehr mit dir. Irgendwo in der Wolkenstadt öffnet die Kreditbank eine neue Abteilung. Sie heißt wieder Sonderforderungen.',
  },
  teilhaber: {
    title: 'Der neue Teilhaber',
    text: 'Inspektorin Rhee wurde mit allen Ehren bestattet; die Untersuchung verlief im Sand. Du sitzt jetzt im Aufsichtsrat der Kreditbank Sol, mit Blick über die Säurewolken. Die Piraten, die Polizei, die Gilde: alles Kunden. Die SOL 4471 steht in deinem Privathangar. Du fliegst sie selten.',
  },
  allein: {
    title: 'Ohne Flagge',
    text: 'Du hast Hollmann den Rücken gekehrt, mit seinem Geld auf dem Konto und Rhees Blut an den Händen. SOLPOL kann dir nichts beweisen, der Bank bist du zu gefährlich. Du fliegst weiter Fracht, allein, und hältst dich von der Wolkenstadt fern. Manche Schulden tilgt kein Geld.',
  },
};

const fmt = (n) => Math.round(n).toLocaleString('de-DE');

export class Story {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.flags = {};
    this.xp = Object.fromEntries(SKILL_KEYS.map((k) => [k, 0]));
    this.journal = [];
    this.stats = { smuggled: 0, delivered: 0, rescued: 0, mined: 0, bribes: 0, spared: 0 };
    this.ending = null;
    this.newsKills = 0;
  }

  toSave() {
    return { flags: this.flags, xp: this.xp, journal: this.journal.slice(0, 60), stats: this.stats, ending: this.ending, newsKills: this.newsKills };
  }

  load(s) {
    if (!s) return;
    this.flags = s.flags || {};
    Object.assign(this.xp, s.xp || {});
    this.journal = s.journal || [];
    Object.assign(this.stats, s.stats || {});
    this.ending = s.ending || null;
    this.newsKills = s.newsKills || 0;
  }

  // ----- flags ---------------------------------------------------------------------------------

  has(flag) {
    return !!this.flags[flag];
  }

  set(flag, value = true) {
    this.flags[flag] = value;
  }

  get path() {
    return this.flags.path || null; // 'gesetz' | 'asche' | 'bank'
  }

  // ----- skills --------------------------------------------------------------------------------

  level(skill) {
    const xp = this.xp[skill] || 0;
    let lvl = 1;
    for (let i = 2; i <= MAX_LEVEL; i++) if (xp >= LEVEL_XP[i]) lvl = i;
    return lvl;
  }

  // Level with help from the crew: a mechanic aboard counts for Technik and so on
  effective(skill) {
    return this.level(skill) + (this.game.crew ? this.game.crew.skillBonus(skill) : 0);
  }

  progress(skill) {
    const lvl = this.level(skill);
    if (lvl >= MAX_LEVEL) return { lvl, frac: 1, next: null };
    const a = LEVEL_XP[lvl], b = LEVEL_XP[lvl + 1];
    return { lvl, frac: ((this.xp[skill] || 0) - a) / (b - a), next: b };
  }

  gain(skill, amount) {
    if (!amount || !SKILLS[skill]) return;
    const before = this.level(skill);
    this.xp[skill] = (this.xp[skill] || 0) + amount;
    const after = this.level(skill);
    if (after > before) {
      const { hud, ship } = this.game;
      hud.toast(`${SKILLS[skill].name} steigt auf Stufe ${after}`, 'gain');
      sfx.coin();
      this.log(`${SKILLS[skill].name} auf Stufe ${after} verbessert.`, 'skill');
      if (skill === 'flug' && ship) ship.applyUpgrades(true);
    }
  }

  // Dialogue checks: true if the pilot (with crew help) reaches the level
  check(skill, lvl) {
    return this.effective(skill) >= lvl;
  }

  // ----- what the skills do --------------------------------------------------------------------

  flightMult() {
    return 1 + (this.level('flug') - 1) * 0.04;
  }

  buyMult() {
    return 1 - (this.level('handel') - 1) * 0.015;
  }

  sellMult() {
    return 1 + (this.level('handel') - 1) * 0.015;
  }

  repairMult() {
    return 1 - (this.level('technik') - 1) * 0.08;
  }

  rewardMult() {
    return 1 + (this.level('reden') - 1) * 0.04;
  }

  fineMult() {
    return 1 - (this.level('reden') - 1) * 0.08;
  }

  // ----- factions ------------------------------------------------------------------------------

  rep(faction) {
    return this.game.law.rep[faction] || 0;
  }

  // Price factor at a station for standing with whoever runs it
  standingMult(owner) {
    if (!owner) return 1;
    const r = this.rep(owner);
    if (r >= 60) return 0.94;
    if (r >= 25) return 0.97;
    if (r <= -60) return 1.1;
    if (r <= -25) return 1.04;
    return 1;
  }

  changeRep(changes) {
    Object.entries(changes || {}).forEach(([f, v]) => this.game.law.changeRep(f, v));
  }

  // ----- chronicle and news --------------------------------------------------------------------

  log(text, kind = 'story') {
    const clock = Math.floor(this.game.economy ? this.game.economy.clock || 0 : 0);
    this.journal.unshift({ text, kind, t: clock });
    this.journal.length = Math.min(this.journal.length, 60);
  }

  news(text) {
    const { economy, hud } = this.game;
    economy.addNews(text);
    if (this.game.simRunning && hud) hud.ticker(text);
  }

  // What people call the pilot, from what the pilot has done
  epithet() {
    const { law } = this.game;
    const k = law.kills;
    if (this.ending === 'teilhaber') return 'Herr Teilhaber';
    if (this.ending === 'freie_flagge') return 'Freund der Gilde';
    if (k.police >= 4) return 'Bullenschreck';
    if (k.pirate >= 40) return 'Krähentod';
    if (this.stats.smuggled >= 6) return 'Schmugglerkönig';
    if (k.pirate >= 15) return 'Piratenschreck';
    if (this.stats.rescued >= 4) return 'Schutzengel der Frachter';
    if (this.stats.mined >= 40) return 'Steinbeißer';
    if (this.stats.delivered >= 10) return 'Fuhrmann';
    return null;
  }

  // A line for bar talk: what the system says about recent events, if anything
  gossip(seed = 0) {
    const f = this.flags;
    const lines = [];
    const name = this.epithet();
    if (name) lines.push(`Man nennt dich „${name}", wusstest du das? Die Leute reden.`);
    if (f.elster_tot) lines.push('Die Elster ist abgeschossen worden, heißt es. Irgendein Frachterpilot. Mutig oder dumm.');
    if (f.nachtigall_lebt) lines.push('Bei Titan hat einer eine ganze falsche Streife zerlegt und den Kurier lebend rausgeholt. Ich glaub ja kein Wort.');
    if (f.voss_gefangen) lines.push('Mara Voss in Ketten! Ich hab nie gedacht, dass ich das noch erlebe.');
    if (f.voss_tot) lines.push('Die Schwarze Sonne ist gefallen. Auf Ceres haben manche geweint, und nicht aus Freude.');
    if (f.path === 'asche') lines.push('Man sagt, der Aschebund hat einen neuen Piloten. Einen, der vorher für die Polizei geflogen ist.');
    if (f.path === 'bank') lines.push('Die Kreditbank zahlt neuerdings gut für Leute, die nicht zu viele Fragen stellen. Hab ich gehört.');
    if (f.kessler_aussage) lines.push('Oberst Kessler sagt aus, gegen wen auch immer. In der Wolkenstadt werden sie nervös.');
    if (f.geier_verschont) lines.push('Der Geier hat aufgehört. Einfach so. Jemand hat ihn laufen lassen.');
    if (f.geier_tot) lines.push('Der Geier ist tot. Auf Triton haben sie einen auf ihn getrunken, aus Erleichterung.');
    if (f.signal_offen) lines.push('Hast du die Europa-Meldung gesehen? Ein Signal von draußen. Seitdem schläft keiner mehr richtig.');
    if (f.signal_verkauft) lines.push('Die Bank hat Bergungsrechte hinter Neptun gekauft. Hinter Neptun! Was wollen die da?');
    if (f.ade_raus) lines.push('Ein Schakalpilot hat beim Aschebund hingeschmissen. Seine Schwester hat ihn abgeholt, sagt man.');
    if (!lines.length) return null;
    return lines[Math.abs(seed) % lines.length];
  }

  // Kills and deeds show up in the news now and then
  onKill(npc) {
    if (npc.faction !== 'pirate' && npc.faction !== 'rogue') return;
    this.gain('flug', 8 + npc.points * 8);
    const k = this.game.law.kills.pirate;
    if (k >= this.newsKills + 12) {
      this.newsKills = k;
      this.news(`SOLNET: Frachterpilot der SOL 4471 meldet den ${k}. Piratenabschuss. SOLPOL prüft eine Belobigung.`);
    }
  }

  // ----- the ending ----------------------------------------------------------------------------

  finish(endingId) {
    const g = this.game;
    this.ending = endingId;
    const e = ENDINGS[endingId];
    g.ship.debt = 0;
    this.log(`ENDE: ${e.title}`, 'ending');
    const news = {
      ordnung: 'SOLNET: Kreditbank-Direktor Hollmann verhaftet. Inspektorin Rhee: „Ohne einen gewissen Frachterpiloten säßen wir noch im Dunkeln."',
      freie_flagge: 'SOLNET: Überraschende Einigung im Gürtel: Aschebund wird Miliz, Gilde erhält Schürfrechte zurück.',
      vergeltung: 'SOLNET: Privatjacht eines Bankdirektors über der Venus zerstört. SOLPOL ermittelt.',
      preis: 'SOLNET: Kreditbank Sol meldet Rekordgewinn. Direktor Hollmann auf Geschäftsreise.',
      teilhaber: 'SOLNET: Trauer um Inspektorin Rhee. Die Kreditbank Sol stiftet eine Gedenktafel.',
      allein: 'SOLNET: Inspektorin Rhee im Dienst gefallen. Die Täter sind unbekannt.',
    }[endingId];
    if (news) this.news(news);
    if (endingId === 'freie_flagge') g.law.changeRep('pirate', 40);
    if (endingId === 'ordnung') g.law.changeRep('police', 20);
    g.saveProgress();
    setTimeout(() => g.ui.showEnding(endingId), 2500);
  }

  // Epilogue lines for the ending screen
  epilogue() {
    const f = this.flags;
    const g = this.game;
    const out = [];
    if (f.voss_gefangen) out.push('Mara Voss sagte gegen die Bank aus und sitzt ihre Strafe auf der Erde ab. Sie schreibt dir Briefe, die meisten unhöflich.');
    else if (f.voss_tot) out.push('Mara Voss starb an Bord der Schwarzen Sonne. Auf Ceres hängt ihr Bild noch in manchen Bars.');
    else if (f.path === 'asche') out.push('Mara Voss führt jetzt eine Miliz statt einer Bande. Sie findet, das sei dasselbe mit besseren Formularen.');
    if (f.path === 'asche' && !f.rhee_tot) out.push('Inspektorin Rhee hat deine Akte nie geschlossen. Manchmal schickt sie dir trotzdem eine Warnung, wenn Kesslers alte Leute in der Nähe sind.');
    if (f.rhee_tot) out.push('Inspektorin Rhee ist tot. Ihr Revier auf der Erde-Station trägt jetzt ihren Namen.');
    else if (f.bestochen) out.push(f.path === 'asche' ? 'Mara Voss hat in jeder Bar des Gürtels ausrichten lassen, dass du für sie gestorben bist.' : 'Inspektorin Rhee hat dir eine Akte angelegt. Darin steht nur ein Wort: „Käuflich".');
    else if (f.path === 'gesetz' || f.doppelspiel) out.push('Inspektorin Rhee hat dir eine Akte angelegt. Darin steht nur ein Wort: „Verlässlich".');
    if (f.kessler_aussage) out.push('Oberst Kessler hat ausgepackt, sechzig Stunden lang. Zwölf weitere Namen.');
    if (f.nachtigall_lebt) out.push(f.beweise ? 'Nachtigalls Datenwürfel liegt jetzt bei Gericht. Er selbst hat endlich wieder einen Nachnamen benutzt.' : 'Nachtigall lebt, versteckt und vorsichtig. Er schuldet dir etwas, und er weiß es.');
    if (f.geier_tot) out.push('Der Geier fliegt nicht mehr.');
    else if (f.geier_verschont) out.push('Der Geier hat bei Triton eine Werkstatt aufgemacht. Für dich repariert er umsonst.');
    if (f.signal_offen) out.push('Das Signal hinter Neptun wird jetzt von ganz Europa ausgewertet. Es wiederholt sich alle 41 Stunden. Niemand weiß, wer antwortet.');
    else if (f.signal_verkauft) out.push('Die Bank hat das Signal gekauft und verschlossen. Manchmal fragst du dich, was es sagt.');
    else if (f.signal_kopie) out.push('Eine Kopie des Signals liegt in deinem Bordrechner. Nachts hörst du es dir manchmal an.');
    if (g.crew) out.push(...g.crew.epilogue());
    return out;
  }
}

export { fmt as fmtCredits };
