import { describe, expect, it } from 'vitest';

import { GRAPHITE_COLORS, VELLUM_COLORS, type ColorTokens } from './color-tokens.js';
import { SCALE_TOKENS } from './scale-tokens.js';
import { GRAPHITE_SHADOWS, VELLUM_SHADOWS } from './shadow-tokens.js';
import { TEXT_STYLES, TEXT_STYLE_TOKENS } from './text-styles.js';
import { THEME_LABELS, THEMES } from './theme-tokens.js';

/**
 * A `#rrggbb` colour's relative luminance (WCAG 2.2).
 *
 * @param hex - The colour.
 * @returns Its luminance, 0 to 1.
 */
function luminanceOf(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * The contrast ratio of two `#rrggbb` colours (WCAG 2.2).
 *
 * @param first - One colour.
 * @param second - The other.
 * @returns The ratio, 1 to 21.
 */
function contrastOf(first: string, second: string): number {
  const [lighter, darker] = [luminanceOf(first), luminanceOf(second)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/**
 * Hue in degrees for a `#rrggbb` colour.
 *
 * @param hex - The colour.
 * @returns Its hue, 0 to 360 degrees.
 */
function hueOf(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map(
    (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const difference = high - low;
  if (difference === 0) return 0;
  const sector =
    high === red
      ? ((green - blue) / difference) % 6
      : high === green
        ? (blue - red) / difference + 2
        : (red - green) / difference + 4;
  return (sector * 60 + 360) % 360;
}

/**
 * A `#rrggbb` colour drawn at an opacity over another, as the eye sees it (straight alpha).
 *
 * @param color - The colour drawn.
 * @param under - What it is drawn over.
 * @param opacity - Its opacity, 0 to 1.
 * @returns The colour seen, `#rrggbb`.
 */
function over(color: string, under: string, opacity: number): string {
  const channels = [1, 3, 5].map((start) => {
    const top = Number.parseInt(color.slice(start, start + 2), 16);
    const bottom = Number.parseInt(under.slice(start, start + 2), 16);
    return Math.round(top * opacity + bottom * (1 - opacity))
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

// The design's `canvas` collection, Graphite then Vellum, as the
// ticket transcribes it. A change here is a change to the design.
const FIGMA_CANVAS: Readonly<Record<string, readonly [graphite: string, vellum: string]>> = {
  'ground/mat': ['#232421', '#E6E5DF'],
  'ground/grid': ['#30322E', '#D6D5CE'],
  'surface/sheet': ['#2B2C29', '#F3F2EE'],
  'surface/raised': ['#343531', '#EBEAE5'],
  'surface/pressed': ['#3E3F3A', '#E0DFD9'],
  'line/hairline': ['#3B3D37', '#D5D3CB'],
  'line/strong': ['#51534C', '#BFBDB5'],
  'ink/primary': ['#ECEBE5', '#1E1F1C'],
  'ink/secondary': ['#A4A39C', '#5D5C57'],
  'ink/faint': ['#6C6B65', '#8C8A83'],
  'action/fill': ['#ECEBE5', '#1E1F1C'],
  'action/on': ['#232421', '#F3F2EE'],
  'hand/you': ['#E3A93B', '#B7801C'],
  'hand/agent': ['#9DB4C4', '#4E6E86'],
  'mark/red-pencil': ['#E0645A', '#C2382E'],
  'mark/live': ['#7DBF7A', '#3E8A3B'],
  'peer/mira': ['#C77DDB', '#9545AB'],
  'peer/jonas': ['#5FC2A6', '#22846A'],
};

const THEME_COLORS: readonly (readonly [string, ColorTokens])[] = [
  ['Graphite', GRAPHITE_COLORS],
  ['Vellum', VELLUM_COLORS],
];

/** The surfaces chrome sits on, from the board up. */
const SURFACES = [
  '--color-ground-mat',
  '--color-surface-sheet',
  '--color-surface-raised',
  '--color-surface-pressed',
] as const;

describe('theme tokens', () => {
  it('carry every Figma canvas variable with its Graphite and Vellum value', () => {
    for (const [variable, [graphite, vellum]] of Object.entries(FIGMA_CANVAS)) {
      const name = `--color-${variable.replace('/', '-')}` as keyof ColorTokens;
      expect(GRAPHITE_COLORS[name], variable).toBe(graphite.toLowerCase());
      expect(VELLUM_COLORS[name], variable).toBe(vellum.toLowerCase());
    }
  });

  it('carry the Figma space collection as scale tokens', () => {
    expect(SCALE_TOKENS).toMatchObject({
      '--space-1': '4px',
      '--space-2': '8px',
      '--space-3': '12px',
      '--space-4': '16px',
      '--radius-control': '4px',
      '--radius-sheet': '6px',
    });
  });

  it('carry the Float and Float/Light effect styles as shadow tokens', () => {
    expect(GRAPHITE_SHADOWS['--shadow-float']).toBe(
      '0 8px 24px 0 rgb(0 0 0 / 34%), 0 1px 2px 0 rgb(0 0 0 / 20%)',
    );
    expect(VELLUM_SHADOWS['--shadow-float']).toBe(
      '0 6px 18px 0 rgb(31 31 26 / 12%), 0 1px 2px 0 rgb(31 31 26 / 10%)',
    );
    expect(THEMES.dark['--shadow-float']).toBe(GRAPHITE_SHADOWS['--shadow-float']);
    expect(THEMES.light['--shadow-float']).toBe(VELLUM_SHADOWS['--shadow-float']);
  });

  it('give the floating chrome’s sheets Float/Light in both themes', () => {
    expect(GRAPHITE_SHADOWS['--shadow-sheet']).toBe(VELLUM_SHADOWS['--shadow-float']);
    expect(VELLUM_SHADOWS['--shadow-sheet']).toBe(VELLUM_SHADOWS['--shadow-float']);
    expect(THEMES.dark['--shadow-sheet']).toBe(VELLUM_SHADOWS['--shadow-float']);
  });

  it('carry the text styles as tokens, none heavier than Medium', () => {
    expect(TEXT_STYLES).toEqual({
      'display-large': {
        family: 'ui',
        sizePx: 44,
        lineHeightPx: 52,
        weight: 500,
        trackingPx: -0.8,
      },
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
      'bar-title': { family: 'ui', sizePx: 19, lineHeightPx: 28, weight: 500, trackingPx: -0.2 },
      'body-large': { family: 'ui', sizePx: 14, lineHeightPx: 20, weight: 400, trackingPx: 0 },
      'sheet-item': { family: 'ui', sizePx: 15, lineHeightPx: 18, weight: 400, trackingPx: 0 },
      'action-large': { family: 'ui', sizePx: 14, lineHeightPx: 16, weight: 500, trackingPx: 0 },
    });
    expect(TEXT_STYLE_TOKENS['--text-display']).toBe('500 22px/28px var(--font-ui)');
    expect(TEXT_STYLE_TOKENS['--text-mono-digit']).toBe('500 24px/32px var(--font-mono)');
    expect(TEXT_STYLE_TOKENS['--text-bar-title']).toBe('500 19px/28px var(--font-ui)');
    expect(TEXT_STYLE_TOKENS['--text-body-large']).toBe('400 14px/20px var(--font-ui)');
    expect(TEXT_STYLE_TOKENS['--text-sheet-item']).toBe('400 15px/18px var(--font-ui)');
    expect(TEXT_STYLE_TOKENS['--text-action-large']).toBe('500 14px/16px var(--font-ui)');
    expect(TEXT_STYLE_TOKENS['--text-strong']).toBe('500 12px/16px var(--font-ui)');
    expect(TEXT_STYLE_TOKENS['--text-mono-code']).toBe('400 11px/18px var(--font-mono)');
    expect(TEXT_STYLE_TOKENS['--text-body']).toBe('400 13px/18px var(--font-ui)');
    expect(TEXT_STYLE_TOKENS['--text-title-tracking']).toBe('-0.15px');
    expect(TEXT_STYLE_TOKENS['--text-mono-key']).toBe('500 10px/12px var(--font-mono)');
    expect(TEXT_STYLE_TOKENS['--text-section-weight']).toBe('500');
    expect(TEXT_STYLE_TOKENS['--text-caption-line-height']).toBe('14px');
    expect(TEXT_STYLE_TOKENS['--text-label-size']).toBe('12px');
  });

  it("set the chrome in the shell's own Geist by default, and its numbers in Geist Mono", () => {
    expect(SCALE_TOKENS['--font-ui']).toMatch(/^"Geist", system-ui,/);
    expect(SCALE_TOKENS['--font-ui']).not.toMatch(/Rand/);
    expect(SCALE_TOKENS['--font-mono']).toMatch(/^"Geist Mono",/);
  });

  it('use neither pure black nor pure white in either theme', () => {
    for (const [theme, colors] of THEME_COLORS) {
      for (const [name, value] of Object.entries(colors)) {
        expect(value.toLowerCase(), `${theme} ${name}`).not.toMatch(
          /^#(?:000(?:000)?|fff(?:fff)?)$|^rgb\((?:0 0 0|255 255 255)\b/,
        );
      }
    }
  });

  it('give primary ink 4.5:1 on every surface and secondary ink on all but the pressed one', () => {
    for (const [theme, colors] of THEME_COLORS) {
      for (const surface of SURFACES) {
        const primary = contrastOf(colors['--color-ink-primary'], colors[surface]);
        expect(primary, `${theme} primary on ${surface}`).toBeGreaterThanOrEqual(4.5);
        if (surface === '--color-surface-pressed') continue;
        const secondary = contrastOf(colors['--color-ink-secondary'], colors[surface]);
        expect(secondary, `${theme} secondary on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      const onAction = contrastOf(colors['--color-action-on'], colors['--color-action-fill']);
      expect(onAction, `${theme} action`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gives danger ink 4.5:1 on every surface while staying near the red pencil hue', () => {
    for (const [theme, colors] of THEME_COLORS) {
      const danger = Object.entries(colors).find(([name]) => name === '--color-ink-danger')?.[1];
      expect(danger, `${theme} danger ink exists`).toBeDefined();
      if (danger === undefined) continue;
      const redPencil = colors['--color-mark-red-pencil'];
      const difference = Math.abs(hueOf(danger) - hueOf(redPencil));
      expect(Math.min(difference, 360 - difference), `${theme} danger hue`).toBeLessThanOrEqual(10);
      for (const surface of SURFACES) {
        expect(
          contrastOf(danger, colors[surface]),
          `${theme} danger on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('gives accent ink 4.5:1 on every surface while staying near the hand/you hue', () => {
    for (const [theme, colors] of THEME_COLORS) {
      const accent = colors['--color-ink-accent'];
      const hand = colors['--color-hand-you'];
      const difference = Math.abs(hueOf(accent) - hueOf(hand));
      expect(Math.min(difference, 360 - difference), `${theme} accent hue`).toBeLessThanOrEqual(10);
      for (const surface of SURFACES) {
        expect(
          contrastOf(accent, colors[surface]),
          `${theme} accent on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('give control borders, the focus ring and the agent colour 3:1 on every surface (WCAG 1.4.11)', () => {
    for (const [theme, colors] of THEME_COLORS) {
      for (const token of [
        '--color-line-control',
        '--color-focus-ring',
        '--color-hand-agent',
      ] as const) {
        for (const surface of SURFACES) {
          const ratio = contrastOf(colors[token], colors[surface]);
          expect(ratio, `${theme} ${token} on ${surface}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('draw the focus ring in hand/you: Graphite’s own, Vellum’s darkened to keep 3:1 (UI-18)', () => {
    // The control states sheet (35:1786): "Focus ring = 2 px hand/you outside the control". Vellum's
    // hand/you is 2.6:1 on the pressed surface, so its ring is the same hue 9% darker (a ruling of
    //); the 3:1 on every surface is the test above.
    expect(GRAPHITE_COLORS['--color-focus-ring']).toBe(GRAPHITE_COLORS['--color-hand-you']);
    expect(VELLUM_COLORS['--color-focus-ring']).toBe('#a77419');
    const ring = VELLUM_COLORS['--color-focus-ring'];
    const hand = VELLUM_COLORS['--color-hand-you'];
    for (const start of [1, 3, 5]) {
      const ratio =
        Number.parseInt(ring.slice(start, start + 2), 16) /
        Number.parseInt(hand.slice(start, start + 2), 16);
      expect(ratio).toBeCloseTo(0.91, 1);
    }
    expect(contrastOf(hand, VELLUM_COLORS['--color-surface-pressed'])).toBeLessThan(3);
  });

  it('draw the selection 3:1 on the mat around it and the sheet in its handles', () => {
    // The whiteboard selection's frame is 2 px off the object, so it is seen against the mat;
    // its handles are filled with the sheet. Vellum's hand/you is 2.7:1 on the mat.
    for (const [theme, colors] of THEME_COLORS) {
      for (const surface of ['--color-ground-mat', '--color-surface-sheet'] as const) {
        const ratio = contrastOf(colors['--color-selection'], colors[surface]);
        expect(ratio, `${theme} selection on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(GRAPHITE_COLORS['--color-selection']).toBe(GRAPHITE_COLORS['--color-hand-you']);
    expect(VELLUM_COLORS['--color-selection']).toBe('#a9761a');
    expect(
      contrastOf(VELLUM_COLORS['--color-hand-you'], VELLUM_COLORS['--color-ground-mat']),
    ).toBeLessThan(3);
  });

  it('state the contrast of a disabled control at 38% opacity on the sheet, in both themes', () => {
    // UI-18 item 2: disabled is 38% opacity (exempt from 1.4.3 and 1.4.11); this pins what each
    // button kind keeps against what is behind it, so a token change that erases it is seen.
    const expected = {
      Graphite: { primary: 3.15, fill: 3.02, secondary: 2.9 },
      Vellum: { primary: 2.29, fill: 2.29, secondary: 2.23 },
    } as const;
    for (const [theme, colors] of THEME_COLORS) {
      const sheet = colors['--color-surface-sheet'];
      const fill = over(colors['--color-action-fill'], sheet, 0.38);
      const primaryLabel = over(colors['--color-action-on'], sheet, 0.38);
      const secondaryFace = over(colors['--color-surface-raised'], sheet, 0.38);
      const label = over(colors['--color-ink-primary'], sheet, 0.38);
      const want = expected[theme as keyof typeof expected];
      expect(contrastOf(primaryLabel, fill), `${theme} primary`).toBeCloseTo(want.primary, 2);
      expect(contrastOf(fill, sheet), `${theme} fill`).toBeCloseTo(want.fill, 2);
      expect(contrastOf(label, secondaryFace), `${theme} secondary`).toBeCloseTo(want.secondary, 2);
      // Still well under the enabled control, so disabled reads as disabled.
      expect(
        contrastOf(colors['--color-action-on'], colors['--color-action-fill']),
      ).toBeGreaterThan(2 * want.primary);
    }
  });

  it('give the tooltip’s words and key 4.5:1: the mat’s colour on primary and secondary ink', () => {
    // The shared Tooltip (Figma 35:1769; UI-18) is the inverse chip (feedback/tooltip.module.css).
    for (const [theme, colors] of THEME_COLORS) {
      const words = contrastOf(colors['--color-ground-mat'], colors['--color-ink-primary']);
      const key = contrastOf(colors['--color-ground-mat'], colors['--color-ink-secondary']);
      expect(words, `${theme} words`).toBeGreaterThanOrEqual(4.5);
      expect(key, `${theme} key`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('state the contrast of a disabled control: faint ink on the sheet', () => {
    // A disabled control is exempt from 1.4.3 and 1.4.11; this pins what it gets (item 4).
    const graphite = contrastOf(
      GRAPHITE_COLORS['--color-ink-faint'],
      GRAPHITE_COLORS['--color-surface-sheet'],
    );
    const vellum = contrastOf(
      VELLUM_COLORS['--color-ink-faint'],
      VELLUM_COLORS['--color-surface-sheet'],
    );
    expect(graphite).toBeCloseTo(2.63, 2);
    expect(vellum).toBeCloseTo(3.08, 2);
  });

  it('state the dock’s disabled button against the dock: faint ink on the sheet, distinct', () => {
    // Item 4: the dock is the sheet surface (toolbar/dock.module.css); a disabled button's
    // icon is faint ink, the contrast pinned above, and stays distinct from an enabled button's
    // primary ink and a selected one's action colour on the pressed surface, in both themes.
    for (const colors of [GRAPHITE_COLORS, VELLUM_COLORS]) {
      const dock = colors['--color-surface-sheet'];
      const disabled = contrastOf(colors['--color-ink-faint'], dock);
      const enabled = contrastOf(colors['--color-ink-primary'], dock);
      const selected = contrastOf(colors['--color-action-fill'], colors['--color-surface-pressed']);
      expect(disabled).toBeGreaterThanOrEqual(2.5);
      expect(enabled - disabled).toBeGreaterThan(5);
      expect(Math.abs(selected - disabled)).toBeGreaterThan(0.5);
      expect(colors['--color-ink-faint']).not.toBe(colors['--color-action-fill']);
    }
  });

  it('defines the same colour tokens in Graphite and Vellum', () => {
    expect(Object.keys(VELLUM_COLORS).sort()).toEqual(Object.keys(GRAPHITE_COLORS).sort());
  });

  it('maps dark to Graphite and light to Vellum', () => {
    expect(THEME_LABELS).toEqual({ dark: 'Graphite', light: 'Vellum' });
    expect(THEMES.dark['--color-ground-mat']).toBe(GRAPHITE_COLORS['--color-ground-mat']);
    expect(THEMES.light['--color-ground-mat']).toBe(VELLUM_COLORS['--color-ground-mat']);
  });

  it('names every token as a CSS custom property', () => {
    for (const name of Object.keys(THEMES.light)) expect(name).toMatch(/^--[a-z0-9-]+$/);
  });

  it('shares spacing, radius, fonts and text styles between the themes', () => {
    for (const [name, value] of Object.entries({ ...SCALE_TOKENS, ...TEXT_STYLE_TOKENS })) {
      expect(THEMES.light[name as keyof typeof THEMES.light]).toBe(value);
      expect(THEMES.dark[name as keyof typeof THEMES.dark]).toBe(value);
    }
  });
});
