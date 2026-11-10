import type { TextAlign } from '@canvas/engine';
import type { Color, Point, StickyAspect, StickyObject, TextStyle } from '@canvas/schema';

/** A new sticky note's side, world units: it starts square. */
export const NOTE_SIZE = 200;

/** A new wide note's width, world units: twice {@link NOTE_SIZE}, as tall as a square one. */
export const WIDE_NOTE_WIDTH = 400;

/**
 * What the sticky tool creates: a sticky note as the `createObject` input takes it, without the
 * fields the command fills in (stacking key, author and times) and with the id left to it.
 */
export type NewStickyObject = Omit<
  StickyObject,
  'id' | 'z' | 'createdBy' | 'createdAt' | 'updatedAt'
>;

/**
 * The note a sticky tool click makes: {@link NOTE_SIZE} square, or
 * {@link WIDE_NOTE_WIDTH} by {@link NOTE_SIZE} for a wide note, centred on the click, empty, its text centred vertically and, unless the tool's style says
 * otherwise, horizontally, its one zero-length run carrying the style typing will use. Pure.
 *
 * @param centre - The click, world units.
 * @param style - The style of the text to be typed.
 * @param color - The note's colour: a tuple or a board colour token.
 * @param align - Its lines' alignment; centred by default.
 * @param aspect - Square (the default, stored as no `aspect`) or wide.
 * @returns The object to create.
 */
export function newStickyObject(
  centre: Point,
  style: TextStyle,
  color: Color,
  align: TextAlign = 'center',
  aspect: StickyAspect = 'square',
): NewStickyObject {
  const width = aspect === 'wide' ? WIDE_NOTE_WIDTH : NOTE_SIZE;
  return {
    type: 'sticky',
    parentId: null,
    x: centre.x - width / 2,
    y: centre.y - NOTE_SIZE / 2,
    rotation: 0,
    locked: false,
    width,
    height: NOTE_SIZE,
    text: '',
    runs: [{ length: 0, style }],
    align,
    autoWidth: false,
    verticalAlign: 'middle',
    color,
    ...(aspect === 'wide' ? { aspect } : {}),
  };
}
