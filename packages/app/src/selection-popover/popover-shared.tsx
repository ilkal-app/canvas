import { useState, type ReactElement } from 'react';

import type { InkableColor } from '@canvas/schema';

import { ColourButton } from '../controls/colour-button.js';
import { FontFamilyDropdown } from '../controls/font-family-dropdown.js';
import { FontSizeDropdown } from '../controls/font-size-dropdown.js';
import type { TextStyleChange } from '../engine/text-style-types.js';
import { useBoardTokens } from '../hooks/use-board-tokens.js';
import { MIXED, type Mixable } from '../panels/controls/mixed-value.js';
import { FONT_FAMILIES } from '../text-input/font-catalogue.js';
import { colourOfValue, colourValueOf } from '../toolbar/tool-panels/panel-colours.js';

import {
  colourShown,
  popoverPaletteOf,
  recentChoicesOf,
  type PopoverColourKind,
} from './popover-colours.js';
import type { PopoverStyleControlsProps } from './popover-controls.js';
import type { PopoverTextValues } from './popover-values.js';
import { loadRecentColours, saveRecentColours, withRecentColour } from './recent-colours.js';

/**
 * How a colour, or none, shows.
 *
 * @param color - The colour, or null for none.
 * @param table - The board's token table.
 * @param mode - The mode the board is shown in.
 * @returns Its name and swatch.
 */
function colourShownOrNone(
  color: InkableColor | null,
  table: Parameters<typeof colourShown>[1],
  mode: Parameters<typeof colourShown>[2],
): { readonly label: string; readonly swatch: string } {
  return color === null
    ? { label: 'None', swatch: 'transparent' }
    : colourShown(color, table, mode);
}

/** The families the font dropdown offers: the bundled ones, in the catalogue's order. */
const FAMILIES = FONT_FAMILIES.map((entry) => entry.family);

/** Space between a popover control and the palette or menu it opens, px (frame A). */
export const POPUP_GAP_PX = 12;

/** Each colour button's name, by what it colours. */
const COLOUR_LABELS: Readonly<Record<PopoverColourKind, string>> = {
  note: 'Note colour',
  text: 'Text colour',
  fill: 'Fill',
  stroke: 'Stroke',
  line: 'Line colour',
  colour: 'Colour',
  border: 'Border',
};

/** The colour buttons that offer None (no fill, no stroke, no border). */
const CAN_BE_NONE: ReadonlySet<PopoverColourKind> = new Set(['fill', 'stroke', 'border']);

/** The colour buttons that offer ink. */
const CAN_BE_INK: ReadonlySet<PopoverColourKind> = new Set(['text', 'stroke', 'line', 'border']);

/**
 * The recent colours, kept on this device, and a function that records one used.
 *
 * @returns The list and the recorder.
 */
function useRecentColours(): readonly [readonly string[], (value: string) => void] {
  const [recent, setRecent] = useState(() => loadRecentColours());
  const use = (value: string): void => {
    const next = withRecentColour(recent, value);
    setRecent(next);
    saveRecentColours(next);
  };
  return [recent, use];
}

/**
 * A colour button of the popover: its palette, the recent colours, Mixed.
 *
 * @param props - What it colours, its value and handler, and the board's tokens.
 * @param props.kind - What it colours: a sticky's note, a text, a shape's fill or stroke, a line.
 * @param props.value - The colour the selection shares (null: none), or mixed.
 * @param props.onChange - Receives a colour chosen.
 * @param props.controls - The popover's controls' props.
 * @param props.isDisabled - Whether it does nothing now (a locked selection).
 * @returns The button.
 */
export function PopoverColourButton(props: {
  readonly kind: PopoverColourKind;
  readonly value: Mixable<InkableColor | null>;
  readonly onChange: (color: InkableColor | null) => void;
  readonly controls: PopoverStyleControlsProps;
  readonly isDisabled?: boolean | undefined;
}): ReactElement {
  const { kind, value } = props;
  const { mode } = props.controls;
  const table = useBoardTokens(props.controls.engine?.board);
  const [recent, useColour] = useRecentColours();
  const isMixed = value === MIXED;
  const shown = isMixed ? undefined : colourShownOrNone(value, table, mode);
  return (
    <ColourButton
      label={COLOUR_LABELS[kind]}
      value={isMixed ? '' : colourValueOf(value)}
      valueLabel={shown?.label ?? 'Mixed'}
      swatch={shown?.swatch ?? 'transparent'}
      isMixed={isMixed}
      groups={popoverPaletteOf(kind, table, mode)}
      recent={recentChoicesOf(recent, table, mode, CAN_BE_INK.has(kind))}
      gap={POPUP_GAP_PX}
      isDisabled={props.isDisabled}
      onChange={(chosen) => {
        const color = colourOfValue(chosen);
        if (color === undefined || (color === null && !CAN_BE_NONE.has(kind))) return;
        useColour(chosen);
        props.onChange(color);
      }}
    />
  );
}

/**
 * The font, size and alignment controls a sticky and a text share.
 *
 * @param props - The controls' props and the selection's values.
 * @param props.controls - The popover's controls' props.
 * @param props.values - What the selection shares.
 * @returns The controls.
 */
export function TypeControls(props: {
  readonly controls: PopoverStyleControlsProps;
  readonly values: PopoverTextValues;
}): ReactElement {
  const { controls, values } = props;
  const restyle = (change: TextStyleChange): void => {
    controls.onTextStyle?.(change);
  };
  return (
    <>
      <FontFamilyDropdown
        value={values.fontFamily ?? MIXED}
        families={FAMILIES}
        onChange={(fontFamily) => {
          restyle({ kind: 'style', patch: { fontFamily } });
        }}
      />
      <FontSizeDropdown
        value={values.fontSize ?? MIXED}
        onChange={(fontSize) => {
          restyle({ kind: 'style', patch: { fontSize } });
        }}
      />
    </>
  );
}
