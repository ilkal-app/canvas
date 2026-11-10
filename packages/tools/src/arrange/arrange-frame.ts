import type { ArrangeBox } from '@canvas/document';
import { worldTransformOf } from '@canvas/engine';
import {
  applyTransform,
  invertTransform,
  type ObjectId,
  type Rect,
  type RigidTransform,
} from '@canvas/schema';

import { nearIds } from '../select/far-objects.js';
import { boxAround, boxCornersOf } from '../select/oriented-box.js';
import { orientedBoxOf, type SelectionSource } from '../select/selection-geometry.js';

/** The board's own frame. */
const BOARD_FRAME: RigidTransform = { cos: 1, sin: 0, x: 0, y: 0 };

/**
 * The selection as the arrange planners take it: the movable objects' boxes in the frame they
 * are arranged in, and that frame.
 */
export interface ArrangeFrame {
  /** The frame's placement on the board: the common parent's world transform, or identity. */
  readonly toBoard: RigidTransform;
  /** Each movable object's axis-aligned box in the frame, in selection order. */
  readonly boxes: readonly ArrangeBox[];
  /**
   * The common parent's own rectangle in the frame, when that parent is a frame object: what a
   * single object aligns to.
   */
  readonly parentRect: Rect | undefined;
}

/**
 * The parent every movable object shares, or undefined when they have different parents.
 *
 * @param ids - The movable objects.
 * @param source - The document.
 * @returns The parent's id, `null` for the root, or undefined.
 */
function commonParentOf(
  ids: readonly ObjectId[],
  source: SelectionSource,
): ObjectId | null | undefined {
  const parents = new Set(ids.map((id) => source.get(id)?.parentId ?? null));
  return parents.size === 1 ? [...parents][0] : undefined;
}

/**
 * Reads the selection for arranging: the objects a move may change
 * (`nearIds`: no locked object, none whose ancestor is selected too, none placed far away) that have a box
 * (connectors and comments have none), each by the axis-aligned rectangle round its turned
 * corners in the common parent's frame, so objects in a turned frame line up along the frame's
 * own axes; objects with different parents are arranged on the board's axes. Pure.
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @returns The frame and the boxes in it.
 */
export function arrangeFrameOf(ids: readonly ObjectId[], source: SelectionSource): ArrangeFrame {
  const movable = nearIds(ids, source);
  const parentId = commonParentOf(movable, source);
  const parent = parentId === undefined || parentId === null ? undefined : source.get(parentId);
  const toBoard = parent ? worldTransformOf(parent, source) : BOARD_FRAME;
  const toFrame = invertTransform(toBoard);
  const boxes = movable.flatMap((id): ArrangeBox[] => {
    const box = orientedBoxOf(id, source);
    const around =
      box && boxAround(boxCornersOf(box).map((corner) => applyTransform(toFrame, corner)));
    return around
      ? [{ id, x: around.x, y: around.y, width: around.width, height: around.height }]
      : [];
  });
  const parentRect =
    parent?.type === 'frame'
      ? { x: 0, y: 0, width: parent.width, height: parent.height }
      : undefined;
  return { toBoard, boxes, parentRect };
}
