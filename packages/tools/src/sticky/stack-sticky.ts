import { noteMinHeight } from '@canvas/engine';
import type { StickyObject } from '@canvas/schema';

import type { NewStickyObject } from './new-sticky-object.js';

/** The gap between a stacked note and the note above it, world units. */
export const STACK_GAP = 16;

/**
 * The note Shift+N, Shift+click with the sticky tool and Add note below stack below a note:
 * in the same parent, the same width, colour, size, rotation and alignment,
 * its text style the first run's, as tall as an empty note of its aspect, left-aligned with it
 * and {@link STACK_GAP} below its bottom edge in the note's own frame, so below a rotated note is
 * along its rotated down (rotation is about the top-left corner, `x`, `y`). Pure.
 *
 * @param above - The note to stack below.
 * @returns The new note.
 */
export function stackedStickyOf(above: StickyObject): NewStickyObject {
  const [first] = above.runs;
  const down = above.height + STACK_GAP;
  return {
    type: 'sticky',
    parentId: above.parentId,
    x: above.x - Math.sin(above.rotation) * down,
    y: above.y + Math.cos(above.rotation) * down,
    rotation: above.rotation,
    locked: false,
    width: above.width,
    height: noteMinHeight(above.width, above.aspect),
    text: '',
    runs: first === undefined ? [] : [{ length: 0, style: structuredClone(first.style) }],
    align: above.align,
    autoWidth: false,
    verticalAlign: above.verticalAlign,
    color: structuredClone(above.color),
    ...(above.aspect === undefined ? {} : { aspect: above.aspect }),
  };
}
