// Colour schemes picked in Settings > Appearance. 'dark' is the default look. The other schemes
// only override surface and text tokens in index.css, so components keep using the same variables.
export const THEMES = [
  { id: 'dark', label: 'Obsidian Dark', hint: 'Default neutral dark' },
  { id: 'gray', label: 'Dark Gray', hint: 'Softer, lighter neutral gray' },
  { id: 'oled', label: 'True Black', hint: 'Pure black, best on OLED screens' },
  { id: 'light', label: 'Light', hint: 'Bright studio look' }
];

const STORAGE_KEY = 'cg_artist_theme';
const LEGACY_STORAGE_KEY = 'vfx_studio_theme';

export function loadSavedTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    return THEMES.some((t) => t.id === saved) ? saved : 'dark';
  } catch {
    return 'dark';
  }
}

export function rememberTheme(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable: the choice just won't be remembered */
  }
}

export function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id);
}
