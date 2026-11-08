// The game world's data: trade goods, stations, ship classes, ranks. No logic lives here.

export const GOODS = {
  ice:   { name: 'Eis',          base: 22 },
  ore:   { name: 'Eisenerz',     base: 32 },
  food:  { name: 'Nahrung',      base: 46 },
  med:   { name: 'Medizin',      base: 120 },
  tech:  { name: 'Quantenchips', base: 155 },
  lux:   { name: 'Luxusgüter',   base: 240 },
  stims: { name: 'Stims',        base: 190, contraband: true },
  arms:  { name: 'Waffen',       base: 340, contraband: true },
};

export const GOOD_KEYS = Object.keys(GOODS);

export function emptyCargo() {
  return Object.fromEntries(GOOD_KEYS.map((k) => [k, 0]));
}

// planetIndex: 0 = stands still in the belt, away from the Sun at orbitRadius, at `angle`.
// Others circle their planet at `orbit` planet radii, or with `moon` that moon at `orbit` moon radii. size: bounding radius in units (the ship is 2.5 long).
// security: 1 = SOLPOL everywhere, 0 = lawless. produces / consumes: tons per minute.
export const STATION_DEFS = [
  {
    name: 'Venus Wolkenstadt', short: 'Venus-Wolkenstadt', planetIndex: 2, orbit: 1.42, style: 'spindle', size: 24, security: 0.8,
    produces: { lux: 2, med: 2 }, consumes: { ice: 3, food: 2, ore: 1 },
    blurb: 'Schwebende Kuppeln über den Säurewolken. Reiches Publikum, teure Laster.',
  },
  {
    name: 'Erde Orbital-Station', short: 'Erde-Station', planetIndex: 3, orbit: 1.5, style: 'ring', size: 24, security: 0.95,
    produces: { tech: 3, food: 3, lux: 1 }, consumes: { ore: 3, ice: 2, med: 0.5 },
    blurb: 'Das Tor zur Erde. Strenge Zollkontrollen, beste Werften.',
  },
  {
    name: 'Mars Außenposten', short: 'Mars-Posten', planetIndex: 4, orbit: 1.65, style: 'ring', size: 22, security: 0.65,
    produces: { ore: 3, med: 0.5 }, consumes: { ice: 3, tech: 1.5, food: 2.5, lux: 0.3 },
    blurb: 'Rote Staubstürme, durstige Kolonien. Hier zählt jede Tonne Eis.',
  },
  {
    name: 'Ceres-Mine', short: 'Ceres-Mine', planetIndex: 0, orbitRadius: 3700, angle: 2.1, style: 'mine', size: 24, security: 0.35,
    produces: { ore: 5, ice: 3 }, consumes: { food: 3, med: 2, tech: 1.2 },
    blurb: 'Grubenstadt im Asteroidengürtel. Die Polizei kommt selten, die Piraten oft.',
  },
  {
    name: 'Europa-Station', short: 'Europa-Station', planetIndex: 5, moon: 'Europa', orbit: 2.0, style: 'spindle', size: 24, security: 0.5,
    produces: { ice: 5, med: 1.5 }, consumes: { tech: 1.2, ore: 2.5, lux: 0.7, food: 1.5 },
    blurb: 'Forschungsstation über Europas Eispanzer, Jupiter füllt den halben Himmel. Eis im Überfluss.',
  },
  {
    name: 'Titan-Raffinerie', short: 'Titan-Raffinerie', planetIndex: 6, moon: 'Titan', orbit: 1.75, style: 'mine', size: 24, security: 0.35,
    produces: { food: 1.5, ice: 1.5 }, consumes: { ore: 2.5, tech: 1, med: 1, lux: 0.4 },
    blurb: 'Methan und Rost über Titans orangem Smog, hinter den Ringen des Saturn. Hier fragt niemand zweimal.',
  },
  {
    name: 'Triton-Posten', short: 'Triton-Posten', planetIndex: 8, orbit: 1.34, style: 'ring', size: 22, security: 0.12, blackMarket: true,
    produces: { stims: 1.5 }, consumes: { arms: 1, food: 2.5, lux: 0.5, med: 1.5 },
    blurb: 'Letzter Halt vor dem Nichts. Der Zoll ist ein Gerücht.',
  },
  {
    name: 'Hades-Nest', short: 'Hades-Nest', planetIndex: 0, orbitRadius: 4500, angle: 3.9, style: 'nest', size: 30, security: 0, faction: 'pirate', blackMarket: true, hidden: true,
    produces: { arms: 2.5, stims: 2.5 }, consumes: { food: 3, med: 2, tech: 1, lux: 1 },
    blurb: 'Ein ausgehöhlter Fels, gespickt mit Kanonen. Heimat des Aschebunds.',
  },
];

// Asteroid fields: rocks scattered around a spot in the belt
export const FIELD_DEFS = [
  { name: 'Ceres-Feld', orbitRadius: 3700, angle: 2.1, spread: 1000, count: 190 },
  { name: 'Pallas-Feld', orbitRadius: 4150, angle: 0.6, spread: 800, count: 130 },
  { name: 'Hades-Feld', orbitRadius: 4500, angle: 3.9, spread: 900, count: 150 },
];

// radius: hit sphere. guns: damage per bolt, seconds between shots, bolt speed, reach.
// skill 0..1: aim quality. all-round guns act as turrets and need not point the hull at the target.
export const SHIP_TYPES = {
  crow:      { label: 'Krähe',      faction: 'pirate', radius: 2.6, hull: 36,  shield: 26,  speed: 40, accel: 44, turn: 1.9, guns: { damage: 4.5, cool: 0.36, speed: 260, range: 300 }, skill: 0.5,  bounty: 350,  points: 1, loot: 1 },
  jackal:    { label: 'Schakal',    faction: 'pirate', radius: 3.1, hull: 78,  shield: 58,  speed: 34, accel: 36, turn: 1.45, guns: { damage: 6.5, cool: 0.34, speed: 260, range: 340 }, skill: 0.68, bounty: 850,  points: 2, loot: 2, missiles: 2 },
  brute:     { label: 'Hadesbarke', faction: 'pirate', radius: 6.2, hull: 240, shield: 130, speed: 24, accel: 22, turn: 0.85, guns: { damage: 8.5, cool: 0.3, speed: 240, range: 420, allRound: true }, skill: 0.72, bounty: 2400, points: 5, loot: 4, missiles: 4 },
  queen:     { label: 'Trägerschiff', faction: 'pirate', radius: 34, hull: 1500, shield: 700, speed: 7, accel: 3, turn: 0.1, guns: { damage: 11, cool: 0.5, speed: 240, range: 650, allRound: true }, skill: 0.75, bounty: 20000, points: 40, loot: 12, missiles: 6, fearless: true },
  turret:    { label: 'Geschützturm', faction: 'pirate', radius: 3.4, hull: 110, shield: 50, speed: 0, accel: 0, turn: 2.2, guns: { damage: 7, cool: 0.55, speed: 250, range: 550, allRound: true }, skill: 0.6, bounty: 500, points: 1, loot: 0, fearless: true, immobile: true },
  patrol:    { label: 'Streife',    faction: 'police', radius: 2.8, hull: 70,  shield: 70,  speed: 42, accel: 46, turn: 1.8, guns: { damage: 6, cool: 0.34, speed: 280, range: 340 }, skill: 0.7,  bounty: 900,  points: 2, loot: 0 },
  cutter:    { label: 'Zollkutter', faction: 'police', radius: 6.4, hull: 280, shield: 200, speed: 26, accel: 24, turn: 0.95, guns: { damage: 9.5, cool: 0.3, speed: 280, range: 440, allRound: true }, skill: 0.8, bounty: 3000, points: 6, loot: 0, missiles: 4, fearless: true },
  freighter: { label: 'Frachter',   faction: 'civil',  radius: 7.2, hull: 190, shield: 50,  speed: 16, accel: 9,  turn: 0.45, guns: null, skill: 0, bounty: 0, points: 0, loot: 5 },
  courier:   { label: 'Kurier',     faction: 'civil',  radius: 2.8, hull: 44,  shield: 44,  speed: 46, accel: 40, turn: 1.4, guns: null, skill: 0, bounty: 0, points: 0, loot: 1 },
};

export const RANKS = [
  { points: 0,   name: 'Frischling' },
  { points: 6,   name: 'Geleitflieger' },
  { points: 20,  name: 'Jäger' },
  { points: 50,  name: 'Veteran' },
  { points: 110, name: 'Fliegeras' },
  { points: 220, name: 'Legende' },
];

export const STARTING_DEBT = 40000;

// Upgrade prices by the tier you are buying from (1 -> 2, 2 -> 3, 3 -> 4)
export const UPGRADES = {
  engine: { name: 'Ionentriebwerk',  text: 'Mehr Tempo, Schub und Wendigkeit.',                costs: [1800, 6500, 18000] },
  shield: { name: 'Schildgenerator', text: 'Mehr Kapazität, schnellere Aufladung.',            costs: [2200, 7500, 21000] },
  weapon: { name: 'Tachyon-Kanone',  text: 'Mehr Schaden, höhere Kadenz, weniger Energie.',    costs: [2500, 8500, 24000] },
  armor:  { name: 'Panzerung',       text: 'Mehr Hülle, Subsysteme nehmen seltener Schaden.',  costs: [1600, 5500, 16000] },
  cargo:  { name: 'Frachtraum',      text: 'Mehr Tonnen für Handel und Bergbau.',              costs: [1200, 4500, 12500] },
  sensor: { name: 'Sensorpaket',     text: 'Größere Radarreichweite, schnellere Zielerfassung.', costs: [1000, 3800, 11000] },
};

export const MISSILE_PRICE = 280;
export const FLARE_PRICE = 45;
export const FUEL_PRICE = 4;      // per unit
export const HULL_REPAIR_PRICE = 9;  // per point of hull
export const SYSTEM_REPAIR_PRICE = 14; // per percent of one subsystem

export const SUBSYSTEMS = {
  engine: 'Antrieb',
  weapons: 'Waffen',
  sensors: 'Sensoren',
  warp: 'Sprungantrieb',
};
