// German display names for bodies whose internal ids are English
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
  'Erde Orbital-Station': 'Erde-Station',
  'Mars Außenposten': 'Mars-Posten'
};

export function displayName(name) {
  return DE_NAMES[name] || name;
}
