import {
  worldBoundsOf,
  worldTransformOf,
  type SearchHighlightBox,
  type SearchHighlightModel,
} from '@canvas/engine';
import type { Board, ObjectId, Rgba } from '@canvas/schema';

/**
 * The board search highlight for the objects found: each one's world bounds as the
 * renderer draws it, in the results' order, the active result marked; an id the board no longer
 * has, or an object with no geometry of its own (a group), is left out. Pure.
 *
 * @param board - The board.
 * @param ids - The objects found, in the results' order.
 * @param activeId - The active result, if it is an object.
 * @param color - The person's colour of the theme.
 * @returns The model for the engine's highlight layer.
 */
export function searchHighlightModelOf(
  board: Board,
  ids: readonly ObjectId[],
  activeId: ObjectId | undefined,
  color: Readonly<Rgba>,
): SearchHighlightModel {
  const source = { get: (id: ObjectId) => board.objects.get(id) };
  const boxes = ids.flatMap((id): SearchHighlightBox[] => {
    const object = board.objects.get(id);
    const bounds =
      object === undefined ? undefined : worldBoundsOf(object, worldTransformOf(object, source));
    return bounds === undefined ? [] : [{ bounds, isActive: id === activeId }];
  });
  return { boxes, color };
}
