import type { DocumentStore } from '@canvas/document';
import type { BoardObject, Point } from '@canvas/schema';
import { frameUnderPoint } from '@canvas/tools';

/**
 * The section a paste at the pointer goes into (item 9): the top-most unlocked frame on
 * the page shown under the pointer (`frameUnderPoint`), so pasted content joins the section it
 * lands on, as a drop or a new object does. None for a paste with no pointer (at the view's
 * centre) or over no frame.
 *
 * @param store - The board as the page shown has it.
 * @param pointer - The pointer on the board, if the paste is at it.
 * @returns The frame, or undefined.
 */
export function pasteSectionOf(
  store: Pick<DocumentStore, 'read' | 'get'>,
  pointer: Point | undefined,
): BoardObject | undefined {
  if (pointer === undefined) return undefined;
  return frameUnderPoint(store.read(), (id) => store.get(id) !== undefined, pointer);
}
