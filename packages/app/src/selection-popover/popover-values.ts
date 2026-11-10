import type { BoardObject, Color, InkableColor } from '@canvas/schema';

import type { TextStyleContext } from '../engine/text-style-types.js';
import { commonValue, isSameColour, MIXED, type Mixable } from '../panels/controls/mixed-value.js';
import { shownAlign } from '../panels/sections/text-direction-row.js';

/** A text's vertical alignment in its box: a sticky's or a text object's. */
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/** A horizontal alignment the popover offers. */
export type PopoverAlign = 'left' | 'center' | 'right';

/**
 * What the selection popover's text controls show: each field the selection shares,
 * {@link MIXED} where it differs, or undefined where the selection has no such field.
 */
export interface PopoverTextValues {
  /** The font family. */
  readonly fontFamily: Mixable<string> | undefined;
  /** The font size, px. */
  readonly fontSize: Mixable<number> | undefined;
  /** The text's colour. */
  readonly textColor: Mixable<InkableColor> | undefined;
  /** The horizontal alignment; undefined where the text cannot be aligned (shape labels). */
  readonly align: Mixable<PopoverAlign> | undefined;
  /** The vertical alignment of the selected stickies and texts. */
  readonly verticalAlign: Mixable<VerticalAlign> | undefined;
  /** The note colour, only when every selected object is a sticky. */
  readonly noteColor: Mixable<Color> | undefined;
}

/**
 * A field of the shared text style: its value, {@link MIXED} when the field is missing (the
 * targets differ), or undefined without a text style.
 *
 * @param textStyle - The targeted text's shared style, if any.
 * @param value - The field's shared value.
 * @returns The value to show.
 */
function shared<Value>(
  textStyle: TextStyleContext | undefined,
  value: Value | undefined,
): Mixable<Value> | undefined {
  if (textStyle === undefined) return undefined;
  return value ?? MIXED;
}

/**
 * The horizontal alignment to show: a `start` or `end` alignment by its direction.
 *
 * @param textStyle - The targeted text's shared style, if any.
 * @returns The alignment, mixed, or undefined.
 */
function alignOf(textStyle: TextStyleContext | undefined): Mixable<PopoverAlign> | undefined {
  if (textStyle === undefined || textStyle.canAlign === false) return undefined;
  const align = shownAlign(textStyle);
  return align === 'left' || align === 'center' || align === 'right' ? align : MIXED;
}

/**
 * The vertical alignment the selected stickies and texts share.
 *
 * @param selection - The selected objects.
 * @returns It, mixed, or undefined when none has one.
 */
function verticalAlignOf(selection: readonly BoardObject[]): Mixable<VerticalAlign> | undefined {
  const aligned = selection.flatMap((object) =>
    object.type === 'sticky' || object.type === 'text' ? [object.verticalAlign] : [],
  );
  return commonValue(aligned, (align) => align);
}

/**
 * The note colour the selection shares, when it is all stickies.
 *
 * @param selection - The selected objects.
 * @returns It, mixed, or undefined.
 */
function noteColorOf(selection: readonly BoardObject[]): Mixable<Color> | undefined {
  const notes = selection.flatMap((object) => (object.type === 'sticky' ? [object] : []));
  if (notes.length === 0 || notes.length !== selection.length) return undefined;
  return commonValue(notes, (note) => note.color, isSameColour);
}

/**
 * What the selection popover's text controls show for a selection. Pure.
 *
 * @param selection - The selected objects.
 * @param textStyle - The engine's view of the targeted text, if any.
 * @returns The values, mixed or absent per field.
 */
export function popoverTextValues(
  selection: readonly BoardObject[],
  textStyle: TextStyleContext | undefined,
): PopoverTextValues {
  const style = textStyle?.style;
  return {
    fontFamily: shared(textStyle, style?.fontFamily),
    fontSize: shared(textStyle, style?.fontSize),
    textColor: shared(textStyle, style?.color),
    align: alignOf(textStyle),
    verticalAlign: verticalAlignOf(selection),
    noteColor: noteColorOf(selection),
  };
}
