import type { TextAlign } from '@canvas/engine';
import type { Point, TextObject, TextStyle } from '@canvas/schema';

/** The narrowest text box the text tool creates, world units: a drag narrower is a click. */
export const MIN_TEXT_BOX_WIDTH = 8;

/**
 * What the text tool creates: a text object as the `createObject` input takes it, without the
 * fields the command fills in (id, stacking key, author and times).
 */
export type NewTextObject = Omit<TextObject, 'id' | 'z' | 'createdBy' | 'createdAt' | 'updatedAt'>;

/**
 * The empty text box a text tool press makes: a click makes an
 * auto-width box at the press, a drag at least {@link MIN_TEXT_BOX_WIDTH} wide a fixed-width box
 * as wide as the drag, from its left end. Its height is one line in the style; its one
 * zero-length run carries the style typing will use. Pure.
 *
 * @param press - Where the button went down, world units.
 * @param release - Where it came up.
 * @param style - The style of the text to be typed.
 * @param lineHeight - One line's height in that style, world units.
 * @param align - Its lines' alignment; left by default.
 * @returns The object to create.
 */
export function newTextObject(
  press: Point,
  release: Point,
  style: TextStyle,
  lineHeight: number,
  align: TextAlign = 'left',
): NewTextObject {
  const dragWidth = Math.abs(release.x - press.x);
  const isFixedWidth = dragWidth >= MIN_TEXT_BOX_WIDTH;
  return {
    type: 'text',
    parentId: null,
    x: isFixedWidth ? Math.min(press.x, release.x) : press.x,
    y: press.y,
    rotation: 0,
    locked: false,
    width: isFixedWidth ? dragWidth : 1,
    height: lineHeight,
    text: '',
    runs: [{ length: 0, style }],
    align,
    autoWidth: !isFixedWidth,
    verticalAlign: 'top',
  };
}
