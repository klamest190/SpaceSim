// Persistent pilot career (credits, cargo, upgrades, tutorial progress)
const SAVE_KEY = 'solaris.save.v1';

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
