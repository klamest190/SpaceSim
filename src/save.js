// Persistent pilot career (credits, cargo, upgrades, standing, missions, the market) and the pilot's settings
const SAVE_KEY = 'solaris.save.v1';
const SETTINGS_KEY = 'solaris.settings.v1';

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGame(ship, extra = {}) {
  const previous = loadGame() || {};
  const data = {
    ...previous,
    ...extra,
    credits: ship.credits,
    cargo: { ...ship.cargo },
    upgrades: { ...ship.upgrades },
    savedAt: Date.now()
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or disabled: the career simply isn't persisted
  }
}

export function clearGame() {
  localStorage.removeItem(SAVE_KEY);
}

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // not persisted
  }
}
