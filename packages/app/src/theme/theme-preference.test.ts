import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCE_STORAGE_KEY,
  loadThemePreference,
  nextThemePreference,
  resolveTheme,
  saveThemePreference,
} from './theme-preference.js';

describe('resolveTheme', () => {
  it('follows the operating system when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    // No matchMedia to ask: Graphite.
    expect(resolveTheme('system', undefined)).toBe('dark');
  });

  it('uses an explicit preference whatever the operating system says', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('nextThemePreference', () => {
  it('cycles Graphite, Vellum, system and back to Graphite', () => {
    expect(nextThemePreference('dark')).toBe('light');
    expect(nextThemePreference('light')).toBe('system');
    expect(nextThemePreference('system')).toBe('dark');
  });
});

describe('theme preference storage', () => {
  function mapStorage(initial?: string) {
    const items = new Map<string, string>();
    if (initial !== undefined) items.set(THEME_PREFERENCE_STORAGE_KEY, initial);
    return {
      items,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
  }

  it('starts a person with no preference on the system’s theme', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
    expect(loadThemePreference(mapStorage())).toBe('system');
    expect(loadThemePreference(undefined)).toBe('system');
  });

  it('keeps the person’s choice for their next visit on this device', () => {
    const storage = mapStorage();
    saveThemePreference('system', storage);
    expect(loadThemePreference(storage)).toBe('system');
    saveThemePreference('light', storage);
    expect(loadThemePreference(storage)).toBe('light');
  });

  it('falls back to the system’s theme for a stored value it does not know', () => {
    expect(loadThemePreference(mapStorage('sepia'))).toBe('system');
  });

  it('ignores storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadThemePreference(throwing)).toBe('system');
    expect(() => {
      saveThemePreference('light', throwing);
    }).not.toThrow();
  });
});
