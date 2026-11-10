import type { BoardObject, InkableColor } from '@canvas/schema';

import { commonValue, isSameColour, MIXED, type Mixable } from '../panels/controls/mixed-value.js';
import type { StyleChange } from '../state/shell-action.js';

import { isLineSelection, isPlainColour } from './shape-connector-values.js';

/** A section: the board's frame. */
export type PopoverFrame = Extract<BoardObject, { readonly type: 'frame' }>;

/** An image. */
export type PopoverImage = Extract<BoardObject, { readonly type: 'image' }>;

/** The types whose selection, all of one type, has a row of its own. */
const OWN_ROW_TYPES: ReadonlySet<BoardObject['type']> = new Set([
  'sticky',
  'text',
  'shape',
  'frame',
  'image',
]);

/**
 * Whether every selected object is a section (a frame).
 *
 * @param selection - The selected objects.
 * @returns True for a selection of sections only.
 */
export function isFrameSelection(
  selection: readonly BoardObject[],
): selection is readonly PopoverFrame[] {
  return selection.length > 0 && selection.every((object) => object.type === 'frame');
}

/**
 * Whether every selected object is an image.
 *
 * @param selection - The selected objects.
 * @returns True for a selection of images only.
 */
export function isImageSelection(
  selection: readonly BoardObject[],
): selection is readonly PopoverImage[] {
  return selection.length > 0 && selection.every((object) => object.type === 'image');
}

/**
 * Whether the selection takes the several-objects row: two or more objects that are
 * not all of one type with a row of its own (stickies, texts, shapes, sections, images, or
 * connectors and lines together).
 *
 * @param selection - The selected objects.
 * @returns True for a mixed selection of two or more.
 */
export function isSeveralSelection(selection: readonly BoardObject[]): boolean {
  const [first] = selection;
  if (first === undefined || selection.length < 2 || isLineSelection(selection)) return false;
  const isOneType = selection.every((object) => object.type === first.type);
  return !(isOneType && OWN_ROW_TYPES.has(first.type));
}

/**
 * The colour the several-objects row reads and sets on an object: a sticky's colour, a shape's
 * or path's fill, a section's background, a connector's, line's or freehand stroke's colour.
 * Texts (their own text colour, so the change stays one step), images and groups take none.
 *
 * @param object - The object.
 * @returns Its colour (null: none), or undefined when it takes no colour here.
 */
function colourOf(object: BoardObject): unknown {
  switch (object.type) {
    case 'sticky':
      return object.color;
    case 'shape':
    case 'path':
      return object.fill;
    case 'frame':
      return object.background;
    case 'connector':
    case 'line':
    case 'freehand':
      return object.stroke.color;
    default:
      return undefined;
  }
}

/**
 * Whether the several-objects colour applies to an object.
 *
 * @param object - The object.
 * @returns True when it takes a colour.
 */
export function takesColour(object: BoardObject): boolean {
  return colourOf(object) !== undefined;
}

/**
 * The colour every object that takes one shares (null: none), or mixed; a gradient or image
 * paint counts as mixed.
 *
 * @param selection - The selected objects.
 * @returns The shared colour.
 */
export function sharedColourOf(selection: readonly BoardObject[]): Mixable<InkableColor | null> {
  const colours = selection.filter(takesColour).map(colourOf);
  if (colours.some((colour) => colour !== null && !isPlainColour(colour))) return MIXED;
  return (
    commonValue(colours as readonly (InkableColor | null)[], (colour) => colour, isSameColour) ??
    null
  );
}

/**
 * The changes that give every object that takes a colour the one chosen, in the selection's
 * order: one change each, so one style action and one undo step.
 *
 * @param selection - The selected objects.
 * @param color - The colour (never ink: a sticky, a fill and a background take none).
 * @returns One change per object that takes a colour.
 */
export function colourChangesOf(
  selection: readonly BoardObject[],
  color: Exclude<InkableColor, 'ink'>,
): StyleChange[] {
  return selection.flatMap((object): StyleChange[] => {
    switch (object.type) {
      case 'sticky':
        return [{ id: object.id, style: { color } }];
      case 'shape':
      case 'path':
        return [{ id: object.id, style: { fill: color } }];
      case 'frame':
        return [{ id: object.id, style: { background: color } }];
      case 'connector':
      case 'line':
      case 'freehand':
        return [{ id: object.id, style: { stroke: { ...object.stroke, color } } }];
      default:
        return [];
    }
  });
}

/**
 * The background the sections share (null: none), or mixed; a gradient or image paint counts as
 * mixed.
 *
 * @param frames - The sections.
 * @returns The shared background.
 */
export function sharedBackgroundOf(frames: readonly PopoverFrame[]): Mixable<InkableColor | null> {
  const backgrounds = frames.map((frame) => frame.background);
  if (backgrounds.some((paint) => paint !== null && !isPlainColour(paint))) return MIXED;
  return (
    commonValue(backgrounds as readonly (InkableColor | null)[], (paint) => paint, isSameColour) ??
    null
  );
}

/**
 * The border colour images share: their border's colour, null when none has a border,
 * or mixed when two differ (a bordered and a borderless image differ).
 *
 * @param images - The selected images.
 * @returns The shared colour, null, or mixed.
 */
export function sharedBorderColourOf(
  images: readonly PopoverImage[],
): Mixable<InkableColor | null> {
  return commonValue(images, (image) => image.border?.color ?? null, isSameColour) ?? null;
}

/**
 * The style changes that give images a border colour: each unlocked image's border in
 * that colour, keeping its width, 2 for one without a border; or no border (null) for None.
 * Locked images are left as they are.
 *
 * @param images - The selected images.
 * @param color - The colour chosen, or null for none.
 * @returns One change per unlocked image.
 */
export function borderChanges(
  images: readonly PopoverImage[],
  color: InkableColor | null,
): StyleChange[] {
  return images
    .filter((image) => !image.locked)
    .map((image) => ({
      id: image.id,
      style: { border: color === null ? null : { color, width: image.border?.width ?? 2 } },
    }));
}
