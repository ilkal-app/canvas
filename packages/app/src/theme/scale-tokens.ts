/** Spacing, radius and font family tokens, as CSS custom property names. */
export type ScaleTokenName =
  | '--space-1'
  | '--space-2'
  | '--space-3'
  | '--space-4'
  | '--space-5'
  | '--space-6'
  | '--radius-control'
  | '--radius-sheet'
  | '--radius-site-row'
  | '--radius-site-control'
  | '--radius-site-surface'
  | '--radius-site-dialog'
  | '--radius-site-sheet'
  | '--radius-site-pill'
  | '--font-ui'
  | '--font-mono'
  | '--reaction-size'
  | '--reaction-line-height';

/**
 * Spacing (a 4 px step), corner radii and the chrome's font families, shared by every theme.
 * `--space-1` to `--space-4` and both radii are the design's `space` collection
 * (`radius/control` is `--radius-control`); `--space-5` and `--space-6` extend the step for the
 * site's page margins. The site's pages (home, sign-in, settings and their dialogs) round their
 * corners on their own scale, approved by the owner: a row 6 (nav rows, chips, small
 * icon buttons, segmented choices), a control 8 (buttons, fields, code digits, selects), a
 * surface 12 (cards, tiles, menus, toasts, the large search), a dialog 14, a phone sheet 20 on
 * its top corners, and a pill; the editor keeps its own 4 and 6. The chrome is set in the
 * host's fonts (`ChromeFontSet`): the shell's own are Geist and Geist Mono
 * (`NEUTRAL_CHROME_FONTS`), whose stacks are the defaults here; the site's are Rand
 * with Geist Mono for its numbers. `useTheme` sets the set's two stacks; text on the board
 * keeps its own fonts. Components size themselves
 * with these rather than literal lengths where a token fits. A reaction floating over the board
 * is set at twice the Title style, 30 px on a 40 px line (`--reaction-size`,
 * `--reaction-line-height`): set at the size it shows, never scaled up, so its glyph is
 * drawn at the screen's resolution.
 */
export const SCALE_TOKENS: Readonly<Record<ScaleTokenName, string>> = {
  '--space-1': '4px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-5': '24px',
  '--space-6': '32px',
  '--radius-control': '4px',
  '--radius-sheet': '6px',
  '--radius-site-row': '6px',
  '--radius-site-control': '8px',
  '--radius-site-surface': '12px',
  '--radius-site-dialog': '14px',
  '--radius-site-sheet': '20px',
  '--radius-site-pill': '999px',
  '--font-ui': '"Geist", system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif',
  '--font-mono': '"Geist Mono", ui-monospace, monospace',
  '--reaction-size': '30px',
  '--reaction-line-height': '40px',
};
