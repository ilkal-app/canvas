import type { ColorMode, InkableColor, TokenTable } from '@canvas/schema';
import { NOTE_COLORS } from '@canvas/tools';

import type { ColourChoice, ColourGroup } from '../controls/colour-button.js';
import { tokenOptionsOf } from '../panels/controls/token-options.js';
import { STICKY_PANEL_COLORS } from '../state/panel-choices/sticky-choices.js';
import {
  colourLabelOf,
  colourOfValue,
  colourSwatchOf,
  hexOfRgba,
  panelPaletteOf,
} from '../toolbar/tool-panels/panel-colours.js';

/**
 * The sticky colours in the design's order ('s Sticky panel), as palette choices.
 *
 * @returns The group.
 */
export function stickyColourGroup(): ColourGroup {
  const choices = STICKY_PANEL_COLORS.flatMap((name): ColourChoice[] => {
    const note = NOTE_COLORS.find((entry) => entry.name === name);
    if (note === undefined) return [];
    const hex = hexOfRgba(note.color);
    return [{ value: hex, label: name, swatch: hex }];
  });
  return { label: 'Sticky', choices };
}

/**
 * The board's colour tokens as palette choices (`token:<id>`), each swatch in the shown mode.
 *
 * @param table - The board's token table.
 * @param mode - The mode the board is shown in.
 * @returns The group.
 */
export function tokenColourGroup(table: TokenTable, mode: ColorMode): ColourGroup {
  return {
    label: 'Board colours',
    choices: tokenOptionsOf(table).map((token) => ({
      value: `token:${token.id}`,
      label: token.name,
      swatch: hexOfRgba(token.values[mode]),
    })),
  };
}

/**
 * What a popover colour button colours (several objects' colour and an image's
 * border).
 */
export type PopoverColourKind = 'note' | 'text' | 'fill' | 'stroke' | 'line' | 'colour' | 'border';

/**
 * The palette a popover colour button offers: a sticky's note colours and the
 * board's tokens; for text and lines ink, the fixed colours and the tokens; for a shape's fill
 * None, the fixed colours and the tokens; for its stroke None, ink, the fixed colours and the
 * tokens.
 *
 * @param kind - What it colours.
 * @param table - The board's token table.
 * @param mode - The mode the board is shown in.
 * @returns The groups.
 */
export function popoverPaletteOf(
  kind: PopoverColourKind,
  table: TokenTable,
  mode: ColorMode,
): readonly ColourGroup[] {
  const tokens = tokenColourGroup(table, mode);
  if (kind === 'note') return [stickyColourGroup(), tokens];
  const canBeInk = kind !== 'fill' && kind !== 'colour';
  const canBeNone = kind === 'fill' || kind === 'stroke' || kind === 'border';
  return [...panelPaletteOf({ canBeInk, canBeNone }), tokens];
}

/**
 * How a colour shows: its name and swatch, a token's by the board's table.
 *
 * @param color - The colour.
 * @param table - The board's token table.
 * @param mode - The mode the board is shown in.
 * @returns Its name and swatch.
 */
export function colourShown(
  color: InkableColor,
  table: TokenTable,
  mode: ColorMode,
): { readonly label: string; readonly swatch: string } {
  if (typeof color === 'object' && 'token' in color) {
    const token = tokenOptionsOf(table).find((entry) => entry.id === color.token);
    if (token !== undefined) return { label: token.name, swatch: hexOfRgba(token.values[mode]) };
  }
  return { label: colourLabelOf(color), swatch: colourSwatchOf(color) };
}

/**
 * The recent colours as palette choices: a value that no longer reads as a colour is left out,
 * and so is ink where the button cannot take it (a sticky's note colour).
 *
 * @param values - The recent colours, most recent first (colour button values).
 * @param table - The board's token table.
 * @param mode - The mode the board is shown in.
 * @param canBeInk - Whether the button takes ink.
 * @returns The choices.
 */
export function recentChoicesOf(
  values: readonly string[],
  table: TokenTable,
  mode: ColorMode,
  canBeInk: boolean,
): readonly ColourChoice[] {
  return values.flatMap((value): ColourChoice[] => {
    const color = colourOfValue(value);
    // None is the palette's own swatch where a button offers it, never a recent one.
    if (color === null || color === undefined || (color === 'ink' && !canBeInk)) return [];
    return [{ value, ...colourShown(color, table, mode) }];
  });
}
