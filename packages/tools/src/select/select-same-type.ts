import type { BoardObject, ObjectId, ObjectType, ShapeObject } from '@canvas/schema';

import type { SelectionState } from './selection-state.js';

/**
 * What select same type reads from the document: objects by id and the children of a parent or
 * of the board's root. `DocumentStore` provides both (`get`, `references.childrenOf`).
 */
export interface SameTypeSource {
  /**
   * An object by id.
   *
   * @param id - The id.
   * @returns The object, or undefined when the document has none.
   */
  get(id: ObjectId): BoardObject | undefined;
  /**
   * The ids of a parent's children.
   *
   * @param parentId - A group or frame id, or null for the board's root.
   * @returns The children's ids, in no particular order.
   */
  childrenOf(parentId: ObjectId | null): Iterable<ObjectId>;
}

/**
 * What "the same type" compares: the object types, and for shapes the kinds, so a rectangle
 * matches rectangles and not ellipses. Only shapes carry a kind. Two sets rather than one of
 * composed keys, so a match reads the object's own strings and allocates nothing.
 */
interface SameTypeKeys {
  readonly types: Set<ObjectType>;
  readonly shapeKinds: Set<ShapeObject['kind']>;
}

/**
 * Whether an object is of one of the types (a shape, of one of the kinds).
 *
 * @param object - The object.
 * @param keys - The types and shape kinds.
 * @returns True when it matches.
 */
function isSameType(object: BoardObject, keys: SameTypeKeys): boolean {
  return object.type === 'shape' ? keys.shapeKinds.has(object.kind) : keys.types.has(object.type);
}

/**
 * Select same type: extends a selection with
 * every unlocked object in the scope whose type is one of the selected objects' types (for a
 * shape, of the same kind too). The scope is its parent's children and, through every frame
 * among them, the frames' children at any depth (a locked frame is not taken but does not hide
 * its children, as with a marquee); a group's children are never taken, since a group is
 * selected whole, unless the group is itself the scope (entered). The selection keeps its
 * objects, in order, and its primary; new ones follow, the scope's own children first. One
 * pass over the scope's objects; pure, and the selection is never stored in the document.
 *
 * @param selection - The selection; not changed.
 * @param board - The document.
 * @param scope - The parent whose children are candidates: null for the board's root, or an
 *   entered group's id.
 * @returns The extended selection; the same object when nothing is added, so an empty
 *   selection stays as it is.
 */
export function selectSameTypeOf(
  selection: SelectionState,
  board: SameTypeSource,
  scope: ObjectId | null,
): SelectionState {
  const keys: SameTypeKeys = { types: new Set(), shapeKinds: new Set() };
  for (const id of selection.ids) {
    const object = board.get(id);
    if (object?.type === 'shape') keys.shapeKinds.add(object.kind);
    else if (object) keys.types.add(object.type);
  }
  if (keys.types.size + keys.shapeKinds.size === 0) return selection;
  const selected = new Set(selection.ids);
  const added: ObjectId[] = [];
  // Breadth first: a frame found among a parent's children is appended to `parents`, which the
  // loop then reaches (an array's iterator reads its length at each step); `visited` stops at a
  // parent cycle a peer's edits could leave before the document repairs it.
  const parents: (ObjectId | null)[] = [scope];
  const visited = new Set(parents);
  for (const parent of parents) {
    for (const id of board.childrenOf(parent)) {
      const object = board.get(id);
      if (!object) continue;
      if (object.type === 'frame' && !visited.has(id)) {
        visited.add(id);
        parents.push(id);
      }
      if (!object.locked && !selected.has(id) && isSameType(object, keys)) added.push(id);
    }
  }
  if (added.length === 0) return selection;
  return { ids: [...selection.ids, ...added], primaryId: selection.primaryId };
}
