/** The chrome's text styles: the design's text styles (`UI/Body` is `body`), set in `--font-ui`. */
export type TextStyleName =
  | 'display-large'
  | 'title'
  | 'body'
  | 'label'
  | 'strong'
  | 'section'
  | 'caption'
  | 'mono-value'
  | 'mono-key'
  | 'mono-code'
  | 'display'
  | 'action'
  | 'mono-digit'
  | 'bar-title'
  | 'body-large'
  | 'sheet-item'
  | 'action-large';

/** A text style's CSS custom properties: its `font` shorthand and its four metrics. */
export type TextStyleTokenName =
  `--text-${TextStyleName}${'' | '-size' | '-line-height' | '-weight' | '-tracking'}`;

/** One text style's metrics, as Figma states them. */
export interface TextStyleSpec {
  /** `ui` for the chrome's UI font (`--font-ui`), `mono` for Geist Mono. */
  readonly family: 'ui' | 'mono';
  /** The font size, CSS px. */
  readonly sizePx: number;
  /** The line height, CSS px. */
  readonly lineHeightPx: number;
  /** The font weight: Regular or Medium, never heavier (the Ilkal brand). */
  readonly weight: 400 | 500;
  /** The letter spacing, CSS px. */
  readonly trackingPx: number;
}

/**
 * The chrome's text styles, transcribed from the design: Title for dialog and
 * panel headings, Body for running text, Label for controls, Strong for a name that leads (the
 * floating board bar's), Section for a group's uppercase heading, Caption for secondary
 * notes, and Value, Key and Code in Geist Mono for numbers, shortcut keys and code. Strong and
 * Code come from the whiteboard design board's Library. Display (a page's own heading), Action (a
 * full-width page button's label) and Digit (one code digit in Geist Mono) come from the sign-in
 * frames of the MVP screens board, and Bar title (the mobile home's greeting) from its
 * frame M3, and Body large (Recent's search, the board's Note/Body) from its frame H1,
 * Sheet item (the phone's actions sheet's rows) from its frame M5 and Action large (the
 * phone's sign-in buttons) from its frame M1. Every theme shares them. The Figma
 * file's 600s are 500 since the chrome moved to Rand: hierarchy comes from size and the
 * secondary grey, never from bold.
 */
export const TEXT_STYLES: Readonly<Record<TextStyleName, TextStyleSpec>> = {
  // The home page's greeting (frame H1; the design board's Note/Display).
  'display-large': { family: 'ui', sizePx: 44, lineHeightPx: 52, weight: 500, trackingPx: -0.8 },
  title: { family: 'ui', sizePx: 15, lineHeightPx: 20, weight: 500, trackingPx: -0.15 },
  body: { family: 'ui', sizePx: 13, lineHeightPx: 18, weight: 400, trackingPx: 0 },
  label: { family: 'ui', sizePx: 12, lineHeightPx: 16, weight: 500, trackingPx: 0 },
  strong: { family: 'ui', sizePx: 12, lineHeightPx: 16, weight: 500, trackingPx: 0 },
  section: { family: 'ui', sizePx: 11, lineHeightPx: 14, weight: 500, trackingPx: 0.4 },
  caption: { family: 'ui', sizePx: 11, lineHeightPx: 14, weight: 400, trackingPx: 0.1 },
  'mono-value': { family: 'mono', sizePx: 12, lineHeightPx: 16, weight: 400, trackingPx: 0 },
  'mono-key': { family: 'mono', sizePx: 10, lineHeightPx: 12, weight: 500, trackingPx: 0 },
  'mono-code': { family: 'mono', sizePx: 11, lineHeightPx: 18, weight: 400, trackingPx: 0 },
  display: { family: 'ui', sizePx: 22, lineHeightPx: 28, weight: 500, trackingPx: -0.2 },
  action: { family: 'ui', sizePx: 13, lineHeightPx: 16, weight: 500, trackingPx: 0 },
  'mono-digit': { family: 'mono', sizePx: 24, lineHeightPx: 32, weight: 500, trackingPx: 0 },
  // The mobile home's bar title, the greeting (frame M3).
  'bar-title': { family: 'ui', sizePx: 19, lineHeightPx: 28, weight: 500, trackingPx: -0.2 },
  // Recent's search words (frame H1; the design board's Note/Body).
  'body-large': { family: 'ui', sizePx: 14, lineHeightPx: 20, weight: 400, trackingPx: 0 },
  // The phone's actions sheet's rows: Open, Rename, … Move to Trash (frame M5).
  'sheet-item': { family: 'ui', sizePx: 15, lineHeightPx: 18, weight: 400, trackingPx: 0 },
  // The phone's sign-in buttons: Continue with Google, … Email me a sign-in code (frame M1).
  'action-large': { family: 'ui', sizePx: 14, lineHeightPx: 16, weight: 500, trackingPx: 0 },
};

/**
 * The CSS custom properties of every text style: for style `body`, `--text-body` (a `font`
 * shorthand: weight, size, line height and family), and `--text-body-size`,
 * `--text-body-line-height`, `--text-body-weight` and `--text-body-tracking`. A rule sets a
 * style with `font: var(--text-body); letter-spacing: var(--text-body-tracking);`, since the
 * shorthand cannot carry letter spacing. Pure.
 *
 * @returns The properties, by name.
 */
function textStyleTokens(): Readonly<Record<TextStyleTokenName, string>> {
  const tokens: Partial<Record<TextStyleTokenName, string>> = {};
  for (const name of Object.keys(TEXT_STYLES) as TextStyleName[]) {
    const style = TEXT_STYLES[name];
    const family = style.family === 'ui' ? 'var(--font-ui)' : 'var(--font-mono)';
    const size = `${String(style.sizePx)}px`;
    const lineHeight = `${String(style.lineHeightPx)}px`;
    tokens[`--text-${name}`] = `${String(style.weight)} ${size}/${lineHeight} ${family}`;
    tokens[`--text-${name}-size`] = size;
    tokens[`--text-${name}-line-height`] = lineHeight;
    tokens[`--text-${name}-weight`] = String(style.weight);
    tokens[`--text-${name}-tracking`] = `${String(style.trackingPx)}px`;
  }
  return tokens as Record<TextStyleTokenName, string>;
}

/** Every text style's CSS custom properties; see {@link TEXT_STYLES} for how a rule uses them. */
export const TEXT_STYLE_TOKENS: Readonly<Record<TextStyleTokenName, string>> = textStyleTokens();
