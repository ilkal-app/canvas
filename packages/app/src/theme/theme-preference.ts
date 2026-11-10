import type { PreferenceStorage } from '../state/view-preferences.js';

import type { ThemeName } from './theme-tokens.js';

/** What the person chose: a theme, or `system` to follow `prefers-color-scheme`. */
export type ThemePreference = 'system' | ThemeName;

/**
 * Decides the theme to show.
 *
 * @param preference - The person's choice.
 * @param isSystemDark - Whether `prefers-color-scheme: dark` matches; undefined where the media
 *   query cannot be evaluated (no `matchMedia`), which falls back to Graphite.
 * @returns The explicit theme, or the system's when the preference is `system`.
 */
export function resolveTheme(
  preference: ThemePreference,
  isSystemDark: boolean | undefined,
): ThemeName {
  if (preference !== 'system') return preference;
  return isSystemDark === false ? 'light' : 'dark';
}

/**
 * The preference a theme toggle moves to next: Graphite, then Vellum, then system (the
 * default), then Graphite again.
 *
 * @param preference - The current preference.
 * @returns The next preference.
 */
export function nextThemePreference(preference: ThemePreference): ThemePreference {
  switch (preference) {
    case 'dark':
      return 'light';
    case 'light':
      return 'system';
    case 'system':
      return 'dark';
  }
}

/**
 * A person with no stored preference follows the operating system's mode (Graphite
 * until then), Graphite where it cannot be read.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** The `localStorage` key the preference is kept under, one per device as the grid's is. */
export const THEME_PREFERENCE_STORAGE_KEY = 'canvas.theme-preference';

const PREFERENCES: readonly string[] = ['system', 'light', 'dark'];

/**
 * The page's `localStorage`, or undefined where there is none or reading it throws.
 *
 * @returns The storage, or undefined.
 */
function pageStorage(): PreferenceStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Reads the person's theme preference on this device, or {@link DEFAULT_THEME_PREFERENCE} when
 * there is none, it is not a preference, or the storage cannot be read.
 *
 * @param storage - Where it is kept; the page's `localStorage` if absent.
 * @returns The preference.
 */
export function loadThemePreference(
  storage: PreferenceStorage | undefined = pageStorage(),
): ThemePreference {
  try {
    const stored = storage?.getItem(THEME_PREFERENCE_STORAGE_KEY) ?? null;
    return stored !== null && PREFERENCES.includes(stored)
      ? (stored as ThemePreference)
      : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/**
 * Keeps the person's theme preference for their next visit on this device; a storage that
 * refuses is ignored, since the choice still applies for this visit.
 *
 * @param preference - The preference.
 * @param storage - Where to keep it; the page's `localStorage` if absent.
 */
export function saveThemePreference(
  preference: ThemePreference,
  storage: PreferenceStorage | undefined = pageStorage(),
): void {
  try {
    storage?.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // Storage is a convenience: the preference holds for this visit either way.
  }
}
