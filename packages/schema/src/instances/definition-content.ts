import type { Board } from '../board/board.js';
import { buildChildIndex, type ChildIndex } from '../board/child-index.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';

/**
 * Reads real definition descendants; comments and nested retired definitions are not content.
 * A retired root definition still supplies content to a late concurrent instance.
 *
 * @param board - The source board.
 * @param mainId - The definition whose real children to read.
 * @param children - An optional existing index for repeated resolution on one board.
 * @returns Descendants in parent-before-child order, without expanding nested instances.
 */
export function definitionContent(
  board: Board,
  mainId: ObjectId,
  children: ChildIndex = buildChildIndex(board),
): readonly BoardObject[] {
  const seen = new Set<ObjectId>([mainId]);
  const pending = [...(children.get(mainId) ?? [])];
  const content: BoardObject[] = [];
  for (const id of pending) {
    if (seen.has(id)) continue;
    seen.add(id);
    const object = board.objects.get(id);
    if (
      object === undefined ||
      object.type === 'comment' ||
      (object.type === 'component' && object.retired)
    ) {
      continue;
    }
    content.push(object);
    if (object.type !== 'instance') pending.push(...(children.get(id) ?? []));
  }
  return content;
}
