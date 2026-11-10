/** The shadow tokens every theme defines, as CSS custom property names. */
export type ShadowTokenName = '--shadow-float' | '--shadow-sheet';

/** A complete set of shadow token values, one per {@link ShadowTokenName}. */
export type ShadowTokens = Readonly<Record<ShadowTokenName, string>>;

/**
 * The floating whiteboard chrome's sheets (the board bar, menus, popovers, tool panels, search, the
 * dock, the zoom control and the Facilitate card): the design board's Float/Light in every theme,
 * as its dark frame keeps it. Dialogs and drawers keep the theme's `--shadow-float`.
 */
const FLOATING_SHEET_SHADOW = '0 6px 18px 0 rgb(31 31 26 / 12%), 0 1px 2px 0 rgb(31 31 26 / 10%)';

/**
 * Graphite's shadows: the Figma effect style Float, two drop shadows (0 8 24 at 34% black, 0 1 2
 * at 20%), under everything that floats over the board (the dock, drawers, menus, dialogs).
 */
export const GRAPHITE_SHADOWS: ShadowTokens = {
  '--shadow-float': '0 8px 24px 0 rgb(0 0 0 / 34%), 0 1px 2px 0 rgb(0 0 0 / 20%)',
  '--shadow-sheet': FLOATING_SHEET_SHADOW,
};

/** Vellum's shadows: the Figma effect style Float/Light (0 6 18 at 12%, 0 1 2 at 10%, ink-tinted). */
export const VELLUM_SHADOWS: ShadowTokens = {
  '--shadow-float': FLOATING_SHEET_SHADOW,
  '--shadow-sheet': FLOATING_SHEET_SHADOW,
};
