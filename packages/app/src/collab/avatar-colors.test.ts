import { describe, expect, it } from 'vitest';

import { PRESENCE_PALETTE } from '@canvas/collab';

import { THEMES } from '../theme/theme-tokens.js';

import { avatarColorsOf, contrastOf } from './avatar-colors.js';

/**
 * The ink's colour in a theme, as the presence bar's sheet maps it.
 *
 * @param ink - The ink.
 * @param theme - The theme.
 * @returns The colour.
 */
function inkIn(ink: 'dark' | 'light', theme: 'dark' | 'light'): string {
  const isActionOn = (ink === 'dark') === (theme === 'dark');
  return THEMES[theme][isActionOn ? '--color-action-on' : '--color-ink-primary'];
}

describe('avatarColorsOf', () => {
  it('keeps a presence colour whose initials are legible as it is', () => {
    expect(avatarColorsOf('#c77ddb')).toEqual({ fill: '#c77ddb', ink: 'dark' });
  });

  it('makes every presence colour legible in both themes, changing it as little as it can', () => {
    for (const color of PRESENCE_PALETTE) {
      const { fill, ink } = avatarColorsOf(color);
      for (const theme of ['dark', 'light'] as const) {
        expect(contrastOf(fill, inkIn(ink, theme)), `${color} in ${theme}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it('lightens a mid-tone for dark ink rather than give up', () => {
    const { fill, ink } = avatarColorsOf('#a18072');
    expect(ink).toBe('dark');
    expect(fill).not.toBe('#a18072');
    expect(fill).toMatch(/^#[0-9a-f]{6}$/);
  });
});
