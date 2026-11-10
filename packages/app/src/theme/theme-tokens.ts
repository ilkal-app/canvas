import { GRAPHITE_BRAND, VELLUM_BRAND, type BrandTokenName } from './brand-tokens.js';
import { GRAPHITE_COLORS, VELLUM_COLORS, type ColorTokenName } from './color-tokens.js';
import { LAYER_TOKENS, type LayerTokenName } from './layer-tokens.js';
import { SCALE_TOKENS, type ScaleTokenName } from './scale-tokens.js';
import { GRAPHITE_SHADOWS, VELLUM_SHADOWS, type ShadowTokenName } from './shadow-tokens.js';
import { TEXT_STYLE_TOKENS, type TextStyleTokenName } from './text-styles.js';

/**
 * The shell's themes, by their CSS `color-scheme`: `dark` is Graphite,
 * the default, and `light` is Vellum ({@link THEME_LABELS}).
 */
export type ThemeName = 'light' | 'dark';

/** Every token a theme defines, by CSS custom property name (text style tokens included). */
export type ThemeTokens = Readonly<
  Record<
    | ColorTokenName
    | ScaleTokenName
    | LayerTokenName
    | ShadowTokenName
    | TextStyleTokenName
    | BrandTokenName,
    string
  >
>;

/**
 * The full token set of each theme: its colours, shadows and brand colourways plus the shared
 * scale, stacking layers and text styles.
 */
export const THEMES: Readonly<Record<ThemeName, ThemeTokens>> = {
  dark: {
    ...SCALE_TOKENS,
    ...LAYER_TOKENS,
    ...TEXT_STYLE_TOKENS,
    ...GRAPHITE_SHADOWS,
    ...GRAPHITE_COLORS,
    ...GRAPHITE_BRAND,
  },
  light: {
    ...SCALE_TOKENS,
    ...LAYER_TOKENS,
    ...TEXT_STYLE_TOKENS,
    ...VELLUM_SHADOWS,
    ...VELLUM_COLORS,
    ...VELLUM_BRAND,
  },
};

/** The name a person sees for each theme. */
export const THEME_LABELS: Readonly<Record<ThemeName, string>> = {
  dark: 'Graphite',
  light: 'Vellum',
};
