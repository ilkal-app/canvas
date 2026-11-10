// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { applyTheme } from './apply-theme.js';
import { THEMES } from './theme-tokens.js';

describe('applyTheme', () => {
  it('sets every token as a custom property on the element', () => {
    const element = document.createElement('div');
    applyTheme(element, 'dark');
    for (const [name, value] of Object.entries(THEMES.dark)) {
      expect(element.style.getPropertyValue(name), name).toBe(value);
    }
  });

  it('marks the element with the theme name and colour scheme', () => {
    const element = document.createElement('div');
    applyTheme(element, 'light');
    expect(element.dataset.theme).toBe('light');
    expect(element.style.colorScheme).toBe('light');
  });

  it('replaces one theme with another', () => {
    const element = document.createElement('div');
    applyTheme(element, 'light');
    applyTheme(element, 'dark');
    expect(element.style.getPropertyValue('--color-ground-mat')).toBe(
      THEMES.dark['--color-ground-mat'],
    );
    expect(element.dataset.theme).toBe('dark');
  });
});
