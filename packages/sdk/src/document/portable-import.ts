import { importedObjectsInStackOrder, type CommandError } from '@canvas/document';
import { BoardImportError, importBoard, type BoardIssue, type ObjectId } from '@canvas/schema';

import type { CanvasDocument, ObjectChanges, RunOptions } from './canvas-document.js';

/** What {@link CanvasDocument.import} is given besides the document. */
export interface ImportOptions extends RunOptions {
  /** The page the objects go on; the board's first page if absent. */
  readonly pageId?: string;
  /** The group or frame the document's top-level objects go in; the board's root if absent. */
  readonly parentId?: string;
}

/** The outcome of {@link CanvasDocument.import}. */
export type ImportOutcome =
  | {
      /** The document's objects were created, in one undo step. */
      readonly status: 'applied';
      /** The new objects' ids, in the document's order. */
      readonly ids: readonly ObjectId[];
      /** Each of the document's object ids, and the id its object was created with. */
      readonly idMap: Readonly<Record<string, ObjectId>>;
      /** What the import changed. */
      readonly changes: ObjectChanges;
    }
  | {
      /** The document is not a valid portable board: nothing was written. */
      readonly status: 'invalid';
      /** Every problem found, in document order; never empty. */
      readonly issues: readonly BoardIssue[];
    }
  | {
      /** The board refused the objects (past its bound, a missing parent): nothing was written. */
      readonly status: 'rejected';
      /** Every problem found; never empty. */
      readonly errors: readonly CommandError[];
    };

/** The issue of a valid document with no objects: there is nothing to import. */
const NO_OBJECTS: BoardIssue = {
  code: 'invalid-format',
  objectId: null,
  relatedId: null,
  path: ['objects'],
  message: 'The document has no objects.',
};

/**
 * Imports a portable board document as the MCP server's `import_document` does: the document is
 * checked and migrated (`importBoard`), then its objects are created with the `createObjects`
 * command, in stacking order, with fresh ids and the references between them kept, in one undo
 * step. The document's own pages, colour tokens and named styles are not created: objects naming
 * a token or style the board lacks draw with their defaults.
 *
 * @param document - The board's document, whose `run` writes the objects.
 * @param json - The portable board JSON, already parsed.
 * @param options - Where the objects go and who the change is attributed to.
 * @returns The new ids, or why nothing was written (`invalid` for a document with no objects too).
 * @throws {Error} When the importer fails for a reason other than the document's problems.
 */
export function importPortableBoard(
  document: Pick<CanvasDocument, 'run'>,
  json: unknown,
  options: ImportOptions = {},
): ImportOutcome {
  let imported: ReturnType<typeof importBoard>;
  try {
    imported = importBoard(json);
  } catch (error: unknown) {
    if (error instanceof BoardImportError) return { status: 'invalid', issues: error.issues };
    throw error;
  }
  const documentOrder = [...imported.objects.values()];
  // As the MCP server's import refuses one: a document with nothing to create.
  if (documentOrder.length === 0) return { status: 'invalid', issues: [NO_OBJECTS] };
  const stackOrder = importedObjectsInStackOrder(imported);
  const outcome = document.run(
    'createObjects',
    {
      objects: stackOrder.map(({ object }) => object),
      parentId: options.parentId ?? null,
      ...(options.pageId === undefined ? {} : { pageId: options.pageId }),
    },
    options.origin === undefined ? {} : { origin: options.origin },
  );
  if (outcome.status === 'rejected') return outcome;
  const newIdAt = new Map(
    stackOrder.map(({ index }, position) => [index, outcome.result.ids[position]]),
  );
  const ids = documentOrder.flatMap((...[, index]) => newIdAt.get(index) ?? []);
  const idMap = Object.fromEntries(
    documentOrder.flatMap(({ id }, index) => {
      const created = newIdAt.get(index);
      return created === undefined ? [] : [[id, created]];
    }),
  );
  return { status: 'applied', ids, idMap, changes: outcome.changes };
}
