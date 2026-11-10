/**
 * The colour tokens every theme defines, as CSS custom property names. Each is a variable of
 * the design's `canvas` collection (`ground/mat` is `--color-ground-mat`), except the seven
 * the file has no variable for: `--color-line-control`, `--color-line-search`,
 * `--color-ink-danger`, `--color-ink-accent`, `--color-focus-ring`, `--color-selection` and
 * `--color-backdrop`.
 */
export type ColorTokenName =
  | '--color-ground-mat'
  | '--color-ground-grid'
  | '--color-surface-sheet'
  | '--color-surface-raised'
  | '--color-surface-pressed'
  | '--color-line-hairline'
  | '--color-line-strong'
  | '--color-line-control'
  | '--color-line-search'
  | '--color-ink-primary'
  | '--color-ink-secondary'
  | '--color-ink-faint'
  | '--color-ink-danger'
  | '--color-ink-accent'
  | '--color-action-fill'
  | '--color-action-on'
  | '--color-hand-you'
  | '--color-hand-agent'
  | '--color-mark-red-pencil'
  | '--color-mark-live'
  | '--color-peer-mira'
  | '--color-peer-jonas'
  | '--color-focus-ring'
  | '--color-selection'
  | '--color-backdrop';

/** A complete set of colour token values, one per {@link ColorTokenName}. */
export type ColorTokens = Readonly<Record<ColorTokenName, string>>;

/**
 * Graphite, the dark theme and the default: the Figma `canvas` collection's Graphite
 * mode. The only literal colours in the shell: components reference these through
 * `var(--color-…)`. Primary and secondary ink meet 4.5:1 on the mat, the sheet and the raised
 * surface (primary on the pressed one too); `--color-line-control`, the border of a control that
 * must be seen (a swatch, a text field), and the focus ring meet 3:1 against every surface (WCAG
 * 1.4.11). `--color-line-strong` is Figma's divider and does not: it is never the only edge of a
 * control that needs one, only of a button its own label or icon identifies (WCAG 1.4.11 asks
 * nothing of that edge; the MVP frames draw it). `--color-line-search` is a search
 * field's edge: the lightest line that meets 3:1 on the mat, the sheet and the raised fill a
 * search sits on (owner; Graphite's is #7d7e77, the ruled #75766f lightened until it
 * keeps 3:1 on the raised fill of the New board dialog's search). `--color-ink-faint` is for
 * disabled controls and placeholders (2.6:1 on the sheet).
 * `--color-ink-danger` is a destructive action's words (Delete board): the design writes
 * them in `mark/red-pencil`, under 4.5:1 for small text on the surfaces, so it is that red
 * lightened (Graphite) or darkened (Vellum) until it meets 4.5:1 on every surface.
 * `--color-ink-accent` is the amber words the MVP frames draw in `hand/you` (a dialog's kicker,
 * a code's send-again link, a step's action): `hand/you` where it meets 4.5:1 on every surface
 * (Graphite), and darkened until it does (Vellum).
 * The focus ring is `hand/you` (UI-18: the control states sheet draws keyboard focus
 * as 2 px of the person's own colour outside the control). `--color-selection` is the canvas
 * selection's frame and handles under the floating whiteboard chrome, drawn 2 px off
 * the object on the mat: `hand/you` here, 7.4:1 on the mat.
 */
export const GRAPHITE_COLORS: ColorTokens = {
  '--color-ground-mat': '#232421',
  '--color-ground-grid': '#30322e',
  '--color-surface-sheet': '#2b2c29',
  '--color-surface-raised': '#343531',
  '--color-surface-pressed': '#3e3f3a',
  '--color-line-hairline': '#3b3d37',
  '--color-line-strong': '#51534c',
  '--color-line-control': '#8a8a83',
  '--color-line-search': '#7d7e77',
  '--color-ink-primary': '#ecebe5',
  '--color-ink-secondary': '#a4a39c',
  '--color-ink-faint': '#6c6b65',
  '--color-ink-danger': '#e9928b',
  '--color-ink-accent': '#e3a93b',
  '--color-action-fill': '#ecebe5',
  '--color-action-on': '#232421',
  '--color-hand-you': '#e3a93b',
  '--color-hand-agent': '#9db4c4',
  '--color-mark-red-pencil': '#e0645a',
  '--color-mark-live': '#7dbf7a',
  '--color-peer-mira': '#c77ddb',
  '--color-peer-jonas': '#5fc2a6',
  '--color-focus-ring': '#e3a93b',
  '--color-selection': '#e3a93b',
  '--color-backdrop': 'rgb(24 25 22 / 64%)',
};

/**
 * Vellum, the light theme: the Figma `canvas` collection's Vellum mode, with the same
 * guarantees as {@link GRAPHITE_COLORS} (faint ink is 3.1:1 on the sheet). Its focus ring is
 * `hand/you` darkened by 9% (`#b7801c` is 2.6:1 on the pressed surface, under the 3:1 a focus
 * indicator needs; `#a77419` meets it on every surface), a ruling of UI-18. Its
 * selection is `hand/you` darkened to `#a9761a`: `#b7801c` is 2.7:1 on the mat around a selected
 * object, under the 3:1 of WCAG 1.4.11; `#a9761a` is 3.1:1 on the mat and 3.5:1 on the sheet
 * inside its handles (a ruling of the coordinator). Nothing else changes colour.
 */
export const VELLUM_COLORS: ColorTokens = {
  '--color-ground-mat': '#e6e5df',
  '--color-ground-grid': '#d6d5ce',
  '--color-surface-sheet': '#f3f2ee',
  '--color-surface-raised': '#ebeae5',
  '--color-surface-pressed': '#e0dfd9',
  '--color-line-hairline': '#d5d3cb',
  '--color-line-strong': '#bfbdb5',
  '--color-line-control': '#787771',
  '--color-line-search': '#84837d',
  '--color-ink-primary': '#1e1f1c',
  '--color-ink-secondary': '#5d5c57',
  '--color-ink-faint': '#8c8a83',
  '--color-ink-danger': '#b4342b',
  '--color-ink-accent': '#7a5512',
  '--color-action-fill': '#1e1f1c',
  '--color-action-on': '#f3f2ee',
  '--color-hand-you': '#b7801c',
  '--color-hand-agent': '#4e6e86',
  '--color-mark-red-pencil': '#c2382e',
  '--color-mark-live': '#3e8a3b',
  '--color-peer-mira': '#9545ab',
  '--color-peer-jonas': '#22846a',
  '--color-focus-ring': '#a77419',
  '--color-selection': '#a9761a',
  '--color-backdrop': 'rgb(30 31 28 / 32%)',
};
