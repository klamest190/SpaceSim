import { STARTING_DEBT } from './world';

// Three ways to play. Everything the game scales is read from here.
//  freeWarp     jumps cost no fuel
//  damageTaken  multiplier on every hit the player's ship takes
//  eventRate    how often encounters (pirates, scans, raids) happen
//  rewardMult   mission pay
export const DIFFICULTIES = {
  easy: {
    label: 'Leicht',
    tagline: 'Entdecken und handeln, ohne Druck',
    perks: ['Unbegrenzte Warpsprünge, kein Treibstoff nötig', '75.000 Cr Startkapital, nur 10.000 Cr Schulden', 'Ausgebautes Schiff (Stufe 2), volle Raketen und Täuschkörper', 'Halber Schaden, seltener Ärger, +50 % Auftragslohn'],
    credits: 75000, debt: 10000, upgradeTier: 2, fullAmmo: true,
    freeWarp: true, damageTaken: 0.5, eventRate: 0.6, rewardMult: 1.5,
  },
  normal: {
    label: 'Normal',
    tagline: 'Die Karriere, wie sie gedacht ist',
    perks: ['Sprünge kosten Treibstoff', '1.000 Cr Startkapital, 40.000 Cr Schulden', 'Serienschiff, 2 Raketen', 'Normaler Schaden und Lohn'],
    credits: 1000, debt: STARTING_DEBT, upgradeTier: 1, fullAmmo: false,
    freeWarp: false, damageTaken: 1, eventRate: 1, rewardMult: 1,
  },
  hard: {
    label: 'Schwer',
    tagline: 'Für alte Hasen',
    perks: ['Sprünge kosten 50 % mehr Treibstoff', '300 Cr Startkapital, 60.000 Cr Schulden', 'Serienschiff, keine Raketen', '40 % mehr Schaden, häufiger Ärger, weniger Lohn'],
    credits: 300, debt: 60000, upgradeTier: 1, fullAmmo: false, noMissiles: true,
    freeWarp: false, warpCostMult: 1.5, damageTaken: 1.4, eventRate: 1.35, rewardMult: 0.85,
  },
};

export const DIFFICULTY_KEYS = ['easy', 'normal', 'hard'];

export function difficultyOf(game) {
  return DIFFICULTIES[game.difficulty] || DIFFICULTIES.normal;
}
