/**
 * The Ilkal colourways, in the order the brand kit
 * lists them. Gulabi is Ilkal's own; each of the others is a product's (Kesari is Boards').
 */
export const COLOURWAYS = ['gulabi', 'kesari', 'neeli', 'kempu', 'nerale', 'hasiru'] as const;

/** One of the {@link COLOURWAYS}. */
export type Colourway = (typeof COLOURWAYS)[number];

/** A colourway's colours, `#rrggbb`, as the brand kit's `tokens/brand.json` has them. */
export interface ColourwayColors {
  /** The body: the light that fills most of a mark or a long form. */
  readonly light: string;
  /** The pallu: the dark of the same family, beyond the threads. */
  readonly dark: string;
  /** A product tile's fill on a light page: the light 72% toward white. */
  readonly tile: string;
  /** A product tile's fill on a dark page: the dark 55% toward the brand's dark. */
  readonly tileDark: string;
}

/**
 * The colourways' colours: the brand kit's masters (`packages/app/assets/brand/tokens/brand.json`,
 * generated from the brand kit), which `brand-tokens.test.ts` holds this copy to.
 */
export const COLOURWAY_COLORS: Readonly<Record<Colourway, ColourwayColors>> = {
  gulabi: { light: '#f38db5', dark: '#cf4766', tile: '#fbdfea', tileDark: '#6c2f3c' },
  kesari: { light: '#fbc566', dark: '#ea7a3c', tile: '#fdeed4', tileDark: '#784629' },
  neeli: { light: '#7fb0f0', dark: '#296dc7', tile: '#dbe8fa', tileDark: '#214168' },
  kempu: { light: '#f7a58d', dark: '#c74d29', tile: '#fce5df', tileDark: '#683221' },
  nerale: { light: '#c3a8f2', dark: '#7a52c9', tile: '#eee6fb', tileDark: '#463469' },
  hasiru: { light: '#86cc93', dark: '#3aa293', tile: '#ddf0e0', tileDark: '#295851' },
};

/** The brand's neutrals. */
export const BRAND_NEUTRALS = {
  /** White: the threads, and text on a colourway. */
  white: '#ffffff',
  /** Ink (masi, soot ink): the brand's black, the wordmark on light. */
  ink: '#1e1f1c',
  /** Grey: lighter text, for hierarchy without weight. */
  grey: '#8a877f',
  /** Paper: the brand's light ground. */
  paper: '#f6f5f2',
  /** Dark: the brand's dark ground. */
  dark: '#1c1d1b',
} as const;

/** The contrast white text needs on a colourway's fill (WCAG 1.4.3, AA, small text). */
const LABEL_CONTRAST = 4.5;

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
 * A colour mixed toward another.
 *
 * @param hex - The colour, `#rrggbb`.
 * @param toward - What it is mixed toward, `#rrggbb`.
 * @param share - How much of it, 0 to 1.
 * @returns The mix, `#rrggbb`.
 */
function mix(hex: string, toward: string, share: number): string {
  const target = channelsOf(toward);
  const channels = channelsOf(hex).map((channel, index) =>
    Math.round(channel + ((target[index] ?? 0) - channel) * share)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${channels.join('')}`;
}

/**
 * A colourway's label fill: the fill of a name written in white on the colourway (the brand's
 * "text on colour is white"), as a presence cursor's name tag. The dark itself where white meets
 * 4.5:1 on it, else the dark mixed toward the brand's ink in 5 % steps until it does. Pure.
 *
 * @param colourway - The colourway.
 * @returns The fill, `#rrggbb`.
 */
export function colourwayLabelOf(colourway: Colourway): string {
  const { dark } = COLOURWAY_COLORS[colourway];
  const white = luminanceOf(BRAND_NEUTRALS.white);
  let fill = dark;
  for (
    let step = 1;
    step <= 20 && (white + 0.05) / (luminanceOf(fill) + 0.05) < LABEL_CONTRAST;
    step += 1
  ) {
    fill = mix(dark, BRAND_NEUTRALS.ink, step / 20);
  }
  return fill;
}

/** The brand tokens every theme defines, as CSS custom property names. */
export type BrandTokenName =
  | `--brand-${Colourway}-${'light' | 'dark' | 'tile' | 'label'}`
  | `--brand-${keyof typeof BRAND_NEUTRALS}`;

/** A complete set of brand token values, one per {@link BrandTokenName}. */
export type BrandTokens = Readonly<Record<BrandTokenName, string>>;

/**
 * A theme's brand tokens: each colourway's light, dark and label fill (the same in both themes;
 * the brand is one), its product tile's fill (the light tile on Vellum, the dark one on
 * Graphite), and the neutrals. Brand surfaces (board cards' long form, presence cursors) take
 * these, never a literal; the UI's own accent stays `hand/you` amber.
 *
 * @param isDark - Whether the theme is Graphite.
 * @returns The tokens.
 */
function brandTokensOf(isDark: boolean): BrandTokens {
  const tokens: Record<string, string> = {};
  for (const colourway of COLOURWAYS) {
    const colors = COLOURWAY_COLORS[colourway];
    tokens[`--brand-${colourway}-light`] = colors.light;
    tokens[`--brand-${colourway}-dark`] = colors.dark;
    tokens[`--brand-${colourway}-tile`] = isDark ? colors.tileDark : colors.tile;
    tokens[`--brand-${colourway}-label`] = colourwayLabelOf(colourway);
  }
  for (const [name, value] of Object.entries(BRAND_NEUTRALS)) tokens[`--brand-${name}`] = value;
  return tokens as BrandTokens;
}

/** Graphite's brand tokens. */
export const GRAPHITE_BRAND: BrandTokens = brandTokensOf(true);

/** Vellum's brand tokens. */
export const VELLUM_BRAND: BrandTokens = brandTokensOf(false);
