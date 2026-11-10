// An imported board's objects as `createObjectsCommand` takes them: the MCP's
// import_document and the relay's template seed share it, so a portable document becomes
// commands one way only.
import type { Board, BoardObject } from '@canvas/schema';

import type { NewObject } from './new-object-schema.js';

/** The fields of a document object `createObjects` sets itself, or that do not carry over. */
const LEFT_OUT_FIELDS: ReadonlySet<string> = new Set([
  'createdBy',
  'createdAt',
  'updatedAt',
  'z',
  'pageId',
]);

/** One object of an imported board, ready for `createObjectsCommand`. */
export interface ImportedObject {
  /** The object as `createObjects` takes it. */
  readonly object: NewObject;
  /** Its position in the board's document order. */
  readonly index: number;
}

/**
 * A document object as `createObjects` takes it: the fields the command sets (`createdBy`,
 * `createdAt`, `updatedAt`) and the stacking key (generated afresh, in stacking order) left
 * out, and the page dropped, since the document's pages are not created. Pure.
 *
 * @param object - An object of the imported board.
 * @returns The object to create.
 */
function newObjectOf(object: BoardObject): NewObject {
  const kept = Object.entries(object).filter(([key]) => !LEFT_OUT_FIELDS.has(key));
  return Object.fromEntries(kept) as unknown as NewObject;
}

/**
 * An imported board's objects (`importBoard`) as `createObjectsCommand` takes them, bottom first:
 * sorted by stacking key, then by document order, so each parent's children keep their order
 * when the command generates fresh keys. Ids stay the document's: the command gives every object
 * a fresh id and rewrites each `parentId`, connector end and comment anchor that names another
 * listed object. Each entry carries its document index, for a caller that reports in document
 * order. Pure: the board is not changed.
 *
 * @param board - The imported board.
 * @returns The objects in stacking order.
 */
export function importedObjectsInStackOrder(board: Board): ImportedObject[] {
  // Bottom first within each parent: a key compares by its characters (fractional indexing).
  return [...board.objects.values()]
    .map((object, index) => ({ object, index }))
    .sort((a, b) =>
      a.object.z < b.object.z ? -1 : a.object.z > b.object.z ? 1 : a.index - b.index,
    )
    .map(({ object, index }) => ({ object: newObjectOf(object), index }));
}
