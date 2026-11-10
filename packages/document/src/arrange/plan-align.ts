import type { Rect } from '@canvas/schema';

import { boundsOfBoxes, moveBoxTo, type ArrangeBox, type ArrangeMove } from './arrange-box.js';

/** The six alignments, in the shortcut sheet's order. */
export const ALIGN_KINDS = ['left', 'centre', 'right', 'top', 'middle', 'bottom'] as const;

/**
 * An alignment: the left edges, the horizontal centres or the right edges line up on a
 * vertical line; the top edges, the vertical centres or the bottom edges on a horizontal one.
 */
export type AlignKind = (typeof ALIGN_KINDS)[number];

/**
 * Where a box's top-left corner goes when it is aligned to the anchor; one coordinate changes.
 *
 * @param kind - The alignment.
 * @param box - The box.
 * @param anchor - What it aligns to.
 * @returns The corner, world units.
 */
function alignedCorner(kind: AlignKind, box: ArrangeBox, anchor: Rect): { x: number; y: number } {
  switch (kind) {
    case 'left':
      return { x: anchor.x, y: box.y };
    case 'centre':
      return { x: anchor.x + (anchor.width - box.width) / 2, y: box.y };
    case 'right':
      return { x: anchor.x + anchor.width - box.width, y: box.y };
    case 'top':
      return { x: box.x, y: anchor.y };
    case 'middle':
      return { x: box.x, y: anchor.y + (anchor.height - box.height) / 2 };
    case 'bottom':
      return { x: box.x, y: anchor.y + anchor.height - box.height };
  }
}

/**
 * Plans an alignment: each box moves along one axis until its edge or
 * centre meets the anchor's. The anchor is the boxes' own bounds unless one is given (a single
 * object aligns to its parent frame). Pure; the boxes are not changed.
 *
 * @param kind - The alignment.
 * @param boxes - The boxes, axis-aligned in one frame, world units.
 * @param anchor - What to align to, in the same frame; the boxes' bounds by default.
 * @returns The moves, in the boxes' order; boxes already in place are left out.
 */
export function planAlign(
  kind: AlignKind,
  boxes: readonly ArrangeBox[],
  anchor: Rect | undefined = boundsOfBoxes(boxes),
): ArrangeMove[] {
  if (anchor === undefined) return [];
  return boxes.flatMap((box) => moveBoxTo(box, alignedCorner(kind, box, anchor)));
}
