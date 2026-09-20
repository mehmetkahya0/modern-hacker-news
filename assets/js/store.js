// localStorage tabanlı tercihler: tema, okunanlar, kaydedilenler.

const KEYS = {
  theme: 'mhn:theme',
  read: 'mhn:read',
  saved: 'mhn:saved',
  visits: 'mhn:visits',
  lang: 'mhn:lang',
  reading: 'mhn:reading',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* kota dolu / gizli mod: sessizce yoksay */
  }
}

/* --- Tema --- */
export function getTheme() {
  return read(KEYS.theme, 'system');
}

export function setTheme(theme) {
  write(KEYS.theme, theme);
  applyTheme(theme);
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1115' : '#fbfaf8');
}

export function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(getTheme()) + 1) % order.length];
  setTheme(next);
  return next;
}

/* --- Okuma tercihleri --- */
// Tasarım belirteçlerini doğrudan sürer: değerler CSS'te zaten değişken,
// burada yalnızca kök öğedeki karşılıkları yazılır.
export const READING_DEFAULTS = { scale: 100, width: 68, density: 'cozy', family: 'sans' };
export const READING_LIMITS = { scale: { min: 85, max: 150, step: 5 }, width: [58, 68, 82] };

function clampReading(r) {
  const { min, max, step } = READING_LIMITS.scale;
  const scale = Math.min(max, Math.max(min, Math.round((Number(r.scale) || 100) / step) * step));
  const width = READING_LIMITS.width.includes(Number(r.width)) ? Number(r.width) : READING_DEFAULTS.width;
  return {
    scale,
    width,
    density: r.density === 'compact' ? 'compact' : 'cozy',
    family: r.family === 'serif' ? 'serif' : 'sans',
  };
}

export function getReading() {
  return clampReading({ ...READING_DEFAULTS, ...read(KEYS.reading, {}) });
}

export function setReading(patch) {
  const next = clampReading({ ...getReading(), ...patch });
  write(KEYS.reading, next);
  applyReading(next);
  return next;
}

export function resetReading() {
  write(KEYS.reading, READING_DEFAULTS);
  applyReading(READING_DEFAULTS);
  return { ...READING_DEFAULTS };
}

export function applyReading(r = getReading()) {
  const root = document.documentElement;
  root.style.setProperty('--read-scale', String(r.scale / 100));
  root.style.setProperty('--read-width', `${r.width}ch`);
  root.dataset.density = r.density;
  root.dataset.reading = r.family;
}

/* --- Çeviri Dili --- */
export function getLang() {
  return read(KEYS.lang, 'tr');
}

export function setLang(lang) {
  write(KEYS.lang, lang);
}

/* --- Okunanlar --- */
const readSet = new Set(read(KEYS.read, []));

export function isRead(id) {
  return readSet.has(id);
}

export function markRead(id) {
  if (readSet.has(id)) return;
  readSet.add(id);
  const arr = [...readSet];
  write(KEYS.read, arr.slice(-1500)); // sınırsız büyümesin
}

/* --- Ziyaretler: "son okumandan beri ne değişti" --- */
// { [id]: { t: ziyaret zamanı (unix sn), c: o andaki yorum sayısı } }
let visits = read(KEYS.visits, {});

export function getVisit(id) {
  return visits[id] || null;
}

export function recordVisit(id, commentCount = 0) {
  visits[id] = { t: Math.floor(Date.now() / 1000), c: commentCount };
  const ids = Object.keys(visits);
  if (ids.length > 400) {
    // en eski kayıtları at
    const kept = ids.sort((a, b) => visits[b].t - visits[a].t).slice(0, 400);
    visits = Object.fromEntries(kept.map((k) => [k, visits[k]]));
  }
  write(KEYS.visits, visits);
}

/* --- Kaydedilenler --- */
let saved = read(KEYS.saved, []);

export function getSaved() {
  return [...saved];
}

export function isSaved(id) {
  return saved.some((s) => s.id === id);
}

export function toggleSaved(story) {
  if (isSaved(story.id)) {
    saved = saved.filter((s) => s.id !== story.id);
  } else {
    saved = [{ id: story.id, title: story.title, url: story.url, savedAt: Date.now() }, ...saved].slice(0, 500);
  }
  write(KEYS.saved, saved);
  return isSaved(story.id);
}
