import { THEMES } from '../theme/theme-tokens.js';

/** The ink of an avatar's initials: the themes' darkest or lightest text. */
export type AvatarInk = 'dark' | 'light';

/** How an avatar is painted: its fill and the ink of its initials. */
export interface AvatarColors {
  /** The fill, `#rrggbb`: the presence colour, or as little lighter or darker as legibility needs. */
  readonly fill: string;
  /** Which ink the initials take (the sheet maps it to a token per theme). */
  readonly ink: AvatarInk;
}

/** The contrast small text needs (WCAG 1.4.3, AA): the initials are 10 px. */
const MINIMUM_CONTRAST = 4.5;

/**
 * Each ink's colours in both themes (`--color-action-on` and `--color-ink-primary`, whichever is
 * dark or light there), so a fill is held to the worse of the two.
 */
const INKS: Readonly<Record<AvatarInk, readonly string[]>> = {
  dark: [THEMES.dark['--color-action-on'], THEMES.light['--color-ink-primary']],
  light: [THEMES.dark['--color-ink-primary'], THEMES.light['--color-action-on']],
};

/** What a fill is mixed toward to make it lighter (for dark ink) or darker (for light ink). */
const MIX_TOWARD: Readonly<Record<AvatarInk, number>> = { dark: 255, light: 0 };

/**
 * The channels of a `#rrggbb` colour.
 *
 * @param hex - The colour.
 * @returns Red, green and blue, 0 to 255.
 */
function channelsOf(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * A colour's relative luminance (WCAG 2.2).
 *
 * @param hex - A `#rrggbb` colour.
 * @returns Its luminance, 0 to 1.
 */
function luminanceOf(hex: string): number {
  const [red, green, blue] = channelsOf(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

/**
 * The contrast ratio of two colours (WCAG 2.2).
 *
 * @param first - A `#rrggbb` colour.
 * @param second - Another.
 * @returns The ratio, 1 to 21.
 */
export function contrastOf(first: string, second: string): number {
  const [lighter = 0, darker = 0] = [luminanceOf(first), luminanceOf(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The worst contrast an ink has on a fill, over both themes.
 *
 * @param fill - The fill.
 * @param ink - The ink.
 * @returns The ratio.
 */
function inkContrast(fill: string, ink: AvatarInk): number {
  return Math.min(...INKS[ink].map((color) => contrastOf(fill, color)));
}

/**
 * A colour mixed toward white or black.
 *
 * @param hex - The colour.
 * @param toward - 255 for white, 0 for black.
 * @param share - How much of it, 0 to 1.
 * @returns The mix, `#rrggbb`.
 */
function mix(hex: string, toward: number, share: number): string {
  const channels = channelsOf(hex).map((channel) =>
    Math.round(channel + (toward - channel) * share)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${channels.join('')}`;
}

/**
 * How to paint a person's avatar so their initials stay legible in both themes: the
 * ink (dark or light) with the better contrast on their presence colour, and the presence colour
 * itself as the fill when that ink reaches 4.5:1 on it, else the colour lightened (dark ink) or
 * darkened (light ink) in 5 % steps until it does. Pure.
 *
 * @param color - The person's presence colour, `#rrggbb`.
 * @returns The fill and the ink.
 */
export function avatarColorsOf(color: string): AvatarColors {
  const ink: AvatarInk =
    inkContrast(color, 'dark') >= inkContrast(color, 'light') ? 'dark' : 'light';
  let fill = color;
  for (let step = 1; step <= 20 && inkContrast(fill, ink) < MINIMUM_CONTRAST; step += 1) {
    fill = mix(color, MIX_TOWARD[ink], step / 20);
  }
  return { fill, ink };
}
