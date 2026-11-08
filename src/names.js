import { STATION_DEFS } from './world';

// German display names for bodies whose internal ids are English, and the short names of stations
const DE_NAMES = {
  Sun: 'Sonne',
  Mercury: 'Merkur',
  Venus: 'Venus',
  Earth: 'Erde',
  Mars: 'Mars',
  Jupiter: 'Jupiter',
  Saturn: 'Saturn',
  Uranus: 'Uranus',
  Neptune: 'Neptun',
  Moon: 'Mond',
  Io: 'Io',
  Europa: 'Europa',
  Titan: 'Titan',
};
STATION_DEFS.forEach((d) => { DE_NAMES[d.name] = d.short; });

export function displayName(name) {
  return DE_NAMES[name] || name;
}
