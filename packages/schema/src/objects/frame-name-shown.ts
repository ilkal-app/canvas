import type { ObjectId } from '../ids/object-id.js';

import type { BoardObject } from './board-object.js';
import type { FrameObject } from './frame-object.js';

/**
 * The ancestors that make a frame nested: a frame, a component's main, and an instance, whose
 * expanded content (the engine's virtual copies of the main's children) sits under it.
 */
const CONTAINER_TYPES: ReadonlySet<BoardObject['type']> = new Set([
  'frame',
  'component',
  'instance',
]);

/** What the rule reads of an ancestor: its type and its own parent. */
export type FrameNameAncestor = Pick<BoardObject, 'type' | 'parentId'>;

/**
 * Whether a frame's name is drawn above it: its stored `showName` when it has one,
 * else the default, hidden when the frame is nested and shown otherwise. A frame is nested when
 * its nearest container ancestor, walking up through groups, is a frame or a component (a main,
 * or an instance, whose expanded copy of a main's frame matches the main's); a frame
 * at the root, or with only groups above it, is not. An ancestor the lookup cannot find ends the
 * walk (the frame counts as at the root), and so does a parent cycle. Pure; a renderer resolves
 * it when the frame or an ancestor changes, never per drawn frame.
 *
 * @param frame - The frame, or the fields the rule reads.
 * @param lookup - Finds an object of the board by id, for the frame's ancestors.
 * @returns `true` when the name is shown.
 */
export function isFrameNameShown(
  frame: Pick<FrameObject, 'parentId' | 'showName'>,
  lookup: (id: ObjectId) => FrameNameAncestor | undefined,
): boolean {
  if (frame.showName !== undefined) return frame.showName;
  const seen = new Set<ObjectId>();
  for (let parentId = frame.parentId; parentId !== null && !seen.has(parentId);) {
    seen.add(parentId);
    const parent = lookup(parentId);
    if (parent === undefined) return true;
    if (CONTAINER_TYPES.has(parent.type)) return false;
    parentId = parent.parentId;
  }
  return true;
}
