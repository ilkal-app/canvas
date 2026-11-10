// A new person's theme follows the system, with Graphite when the browser cannot
// report a colour scheme. The document paints the dark mat before the app starts.
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { GRAPHITE_COLORS } from './color-tokens.js';
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCE_STORAGE_KEY,
  loadThemePreference,
  resolveTheme,
} from './theme-preference.js';

/** The page's document, which paints the mat before the app starts. */
const INDEX_HTML = new URL('../../index.html', import.meta.url);

describe('system theme preference', () => {
  it('starts with system when no preference is stored', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
    expect(loadThemePreference({ getItem: () => null, setItem: () => undefined })).toBe('system');
  });

  it('uses system for an invalid or unreadable stored preference', () => {
    expect(
      loadThemePreference({
        getItem: (key) => (key === THEME_PREFERENCE_STORAGE_KEY ? 'sepia' : null),
        setItem: () => undefined,
      }),
    ).toBe('system');
    expect(
      loadThemePreference({
        getItem: () => {
          throw new Error('storage denied');
        },
        setItem: () => undefined,
      }),
    ).toBe('system');
  });

  it('resolves system to dark or light and falls back to Graphite without a media query', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', undefined)).toBe('dark');
  });

  it('keeps an explicit choice even when the system differs or is unavailable', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', undefined)).toBe('light');
  });

  // The page's document is the site's entry, which the public repository's export leaves out.
  it.skipIf(!existsSync(INDEX_HTML))(
    'paints the Graphite mat in dark mode before JavaScript and adds no light rule',
    () => {
      const html = readFileSync(INDEX_HTML, 'utf8');
      const inlineStyle = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
      expect(inlineStyle).toBeDefined();
      const darkRule = inlineStyle?.match(
        /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*html\s*\{([^}]+)\}\s*\}/,
      )?.[1];
      expect(darkRule).toBeDefined();
      expect(darkRule?.match(/background:\s*(#[\da-fA-F]{6})\s*;/)?.[1]).toBe(
        GRAPHITE_COLORS['--color-ground-mat'],
      );
      expect(darkRule).toMatch(/color-scheme:\s*dark\s*;/);
      expect(inlineStyle).not.toMatch(/@media\s*\(prefers-color-scheme:\s*light\)/);
    },
  );
});
