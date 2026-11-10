/** The stacking tokens, as CSS custom property names (item 9). */
export type LayerTokenName =
  | '--layer-drawer'
  | '--layer-controls'
  | '--layer-bars'
  | '--layer-menu'
  | '--layer-notice'
  | '--layer-dialog';

/**
 * The shell's one stacking order, low to high, as `z-index` values every theme shares (
 * item 9): what floats over the canvas takes its layer from here rather than a number of its own.
 * Each layer is a stacking context, so a menu, flyout or popover opened from a layer's sheet
 * stacks with it.
 *
 * - `--layer-drawer`: the drawers and panels beside the canvas: the layers drawer, the
 *   right-hand slot (the inspector, history) and the comments panel. A drawer holding an open
 *   modal dialog rises to `--layer-dialog` while it does.
 * - `--layer-controls`: the dock and the zoom control, with their flyouts.
 * - `--layer-bars`: the top bars, with the board menu, the "+N" list and the account menu,
 *   which open over the drawers under them.
 * - `--layer-menu`: the canvas's context menu, over the rest of the shell.
 * - `--layer-notice`: the toast region's home over the dock, where the board's notices show
 *   (item 4): over everything but a dialog, so no open menu hides a notice.
 * - `--layer-dialog`: a modal dialog's backdrop, over the whole shell.
 *
 * What the canvas itself shows (comment pins, trace sheets, editing labels) stays under the
 * drawers, with its own small numbers.
 */
export const LAYER_TOKENS: Readonly<Record<LayerTokenName, string>> = {
  '--layer-drawer': '12',
  '--layer-controls': '14',
  '--layer-bars': '16',
  '--layer-menu': '20',
  '--layer-notice': '25',
  '--layer-dialog': '30',
};
