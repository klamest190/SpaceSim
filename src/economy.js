import { GOODS, GOOD_KEYS, STATION_DEFS } from './world';

// A simple living market: each station produces and consumes goods by the minute, so stock drifts,
// and price follows stock. What you sell pushes the price down at once; a station starved of what it needs pays
// more; events (a strike, a plague, a blockade) squeeze things for a while and are the talk of the bars.

const NORMAL_STOCK = 100;
const MAX_STOCK = 400;
const SPREAD = 0.05;
const TICK = 6; // seconds
const EVENT_MIN = 150, EVENT_MAX = 330;

const EVENT_TEMPLATES = [
  { good: 'med', mult: 1.8, text: (s) => `Grippewelle in ${s}: Medizin wird händeringend gesucht.` },
  { good: 'food', mult: 1.7, text: (s) => `Gewächshausausfall in ${s}: Nahrung knapp, Preise explodieren.` },
  { good: 'ice', mult: 1.8, text: (s) => `Wasserleck in ${s}: Eis wird zu Höchstpreisen angekauft.` },
  { good: 'ore', mult: 1.6, text: (s) => `Werftaufträge in ${s}: Eisenerz ist gefragt wie nie.` },
  { good: 'tech', mult: 1.6, text: (s) => `Systemumbau in ${s}: Quantenchips sind Mangelware.` },
  { good: 'lux', mult: 1.8, text: (s) => `Gala in ${s}: die Reichen wollen Luxusgüter sehen.` },
  { good: 'ore', mult: 0.55, text: (s) => `Reiche Ader bei ${s} entdeckt: Eisenerz fast geschenkt.` },
  { good: 'tech', mult: 0.6, text: (s) => `Überproduktion in ${s}: Quantenchips werden verramscht.` },
  { good: 'food', mult: 0.6, text: (s) => `Rekordernte in ${s}: Nahrung billig wie nie.` },
];

export class Economy {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.stock = {};
    STATION_DEFS.forEach((def) => {
      const s = {};
      GOOD_KEYS.forEach((g) => {
        const contraband = GOODS[g].contraband;
        if (contraband && !def.blackMarket) {
          s[g] = 0;
          return;
        }
        const prod = (def.produces && def.produces[g]) || 0;
        const cons = (def.consumes && def.consumes[g]) || 0;
        s[g] = Math.round(NORMAL_STOCK + prod * 34 - cons * 22 + (Math.random() - 0.5) * 30);
      });
      this.stock[def.name] = s;
    });
    this.events = [];
    this.news = [];
    this.tickTimer = 0;
    this.eventTimer = 30 + Math.random() * 60;
  }

  toSave() {
    return { stock: this.stock, events: this.events.map(({ station, good, mult, text, until }) => ({ station, good, mult, text, until })), news: this.news.slice(0, 6), clock: this.clock || 0 };
  }

  load(s) {
    if (!s) return;
    Object.entries(s.stock || {}).forEach(([k, v]) => { if (this.stock[k]) Object.assign(this.stock[k], v); });
    this.clock = s.clock || 0;
    this.events = s.events || [];
    this.news = s.news || [];
  }

  defFor(name) {
    return STATION_DEFS.find((d) => d.name === name);
  }

  trades(stationName, good) {
    return !GOODS[good].contraband || !!this.defFor(stationName).blackMarket;
  }

  eventMult(stationName, good) {
    let m = 1;
    this.events.forEach((e) => { if (e.station === stationName && e.good === good) m *= e.mult; });
    return m;
  }

  mid(stationName, good, stockDelta = 0) {
    const stock = this.stock[stationName][good] + stockDelta;
    const factor = Math.max(0.62, Math.min(1.5, 1.55 - 0.55 * (stock / NORMAL_STOCK)));
    return GOODS[good].base * factor * this.eventMult(stationName, good);
  }

  buyPrice(stationName, good, stockDelta = 0) {
    return Math.max(1, Math.round(this.mid(stationName, good, stockDelta) * (1 + SPREAD)));
  }

  sellPrice(stationName, good, stockDelta = 0) {
    return Math.max(1, Math.round(this.mid(stationName, good, stockDelta) * (1 - SPREAD)));
  }

  available(stationName, good) {
    return Math.max(0, Math.floor(this.stock[stationName][good]));
  }

  // Trades of n tons, one at a time so a big deal walks the price; returns the total, or 0 if nothing moved
  buy(stationName, good, n) {
    const { ship } = this.game;
    let total = 0, moved = 0;
    while (moved < n) {
      if (this.available(stationName, good) <= 0 || ship.getCurrentCargoWeight() >= ship.maxCargo) break;
      const price = this.buyPrice(stationName, good);
      if (ship.credits < price) break;
      ship.credits -= price;
      ship.cargo[good]++;
      this.stock[stationName][good]--;
      total += price;
      moved++;
    }
    return { total, moved };
  }

  sell(stationName, good, n) {
    const { ship } = this.game;
    let total = 0, moved = 0;
    while (moved < n && ship.cargo[good] > 0) {
      const price = this.sellPrice(stationName, good);
      ship.credits += price;
      ship.cargo[good]--;
      this.stock[stationName][good]++;
      total += price;
      moved++;
    }
    return { total, moved };
  }

  // Best known places to buy and sell, for the exchange board: only stations the pilot knows about
  bestDeals(knownStations) {
    return GOOD_KEYS.map((good) => {
      let bestBuy = null, bestSell = null;
      knownStations.forEach((name) => {
        if (!this.trades(name, good)) return;
        const buy = this.buyPrice(name, good), sell = this.sellPrice(name, good);
        if (this.available(name, good) > 0 && (!bestBuy || buy < bestBuy.price)) bestBuy = { name, price: buy };
        if (!bestSell || sell > bestSell.price) bestSell = { name, price: sell };
      });
      return { good, bestBuy, bestSell };
    });
  }

  addNews(text) {
    this.news.unshift(text);
    this.news.length = Math.min(this.news.length, 8);
  }

  update(dt) {
    this.clock = (this.clock || 0) + dt;
    this.tickTimer -= dt;
    if (this.tickTimer <= 0) {
      this.tickTimer = TICK;
      this.tick(TICK);
    }
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      this.eventTimer = EVENT_MIN + Math.random() * (EVENT_MAX - EVENT_MIN);
      this.startEvent();
    }
    this.events = this.events.filter((e) => e.until > this.clock);
  }

  tick(seconds) {
    const minutes = seconds / 60;
    STATION_DEFS.forEach((def) => {
      const s = this.stock[def.name];
      GOOD_KEYS.forEach((g) => {
        if (GOODS[g].contraband && !def.blackMarket) return;
        const prod = (def.produces && def.produces[g]) || 0;
        const cons = (def.consumes && def.consumes[g]) || 0;
        // Drift towards the balance this station's economy settles at, plus a little noise
        const balance = NORMAL_STOCK + prod * 34 - cons * 22;
        s[g] += (prod - cons) * minutes + (balance - s[g]) * 0.02 * minutes * 6 + (Math.random() - 0.5) * 0.4;
        s[g] = Math.max(0, Math.min(MAX_STOCK, s[g]));
      });
    });
  }

  startEvent() {
    const defs = STATION_DEFS.filter((d) => !d.hidden);
    const def = defs[Math.floor(Math.random() * defs.length)];
    const tpl = EVENT_TEMPLATES[Math.floor(Math.random() * EVENT_TEMPLATES.length)];
    if (this.events.some((e) => e.station === def.name)) return;
    const text = tpl.text(def.short);
    this.events.push({ station: def.name, good: tpl.good, mult: tpl.mult, text, until: this.clock + 240 + Math.random() * 300 });
    this.addNews(text);
    if (this.game.simRunning) this.game.hud.ticker(text);
  }
}
