import {
  createObjectCommand,
  runCommand,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
  type DocumentStore,
  type NewObject,
  type TransactionOrigin,
} from '@canvas/document';
import type { BoardObject, PrincipalId } from '@canvas/schema';

import { createDemoBoard } from './demo-board.js';

/**
 * The person using the app until sign-in exists: the origin of every command the tools run and
 * the principal whose undo history the app keeps (undo is per user).
 */
export const LOCAL_USER_ORIGIN: TransactionOrigin = Object.freeze({
  kind: 'user',
  principalId: 'user:local' as PrincipalId,
});

/**
 * The fields `createObject` fills in itself: the id (from the command's id generator, which
 * hands out the object's own), the stacking key and the stamps.
 */
const FILLED_IN_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'z',
  'createdBy',
  'createdAt',
  'updatedAt',
]);

/**
 * A board object as `createObject` takes it.
 *
 * @param object - The object.
 * @returns Its fields without the ones the command fills in.
 */
function toNewObject(object: BoardObject): NewObject {
  const entries = Object.entries(object).filter(([key]) => !FILLED_IN_FIELDS.has(key));
  return Object.fromEntries(entries) as NewObject;
}

/**
 * Writes a board into a document through the command layer as the product's own change
 * (`createObject` with the system origin, parents before children, so every object is stacked
 * above the siblings created before it): a user's undo history never includes it. Deterministic:
 * the objects keep their ids, and the command clock is the objects' own creation time, so two
 * clients seeding the same empty board write the same objects. Main thread.
 *
 * @param store - The document to write into.
 * @param objects - The board, parents before children.
 * @throws {Error} When an object is refused (a bug in the board given); the objects before it
 *   stay written.
 */
export function writeBoard(store: DocumentStore, objects: readonly BoardObject[]): void {
  for (const object of objects) {
    const outcome = runCommand(
      store,
      SYSTEM_ORIGIN,
      createObjectCommand,
      { object: toNewObject(object) },
      {
        clock: () => object.createdAt,
        createId: () => object.id,
      },
    );
    if (outcome.status === 'rejected') {
      const reasons = outcome.errors.map((error) => error.message).join('; ');
      throw new Error(`The board object "${object.id}" was refused: ${reasons}`);
    }
  }
}

/**
 * A new document holding a board, written with {@link writeBoard}: the app's board when no relay
 * is configured or reachable (the playground's offline fallback), and what an empty board on
 * the relay is seeded with.
 *
 * @param objects - The board, parents before children; the demo board by default.
 * @returns The store.
 * @throws {Error} When an object is refused (a bug in the board given).
 */
export function createDemoDocument(
  objects: readonly BoardObject[] = createDemoBoard(),
): YjsDocumentStore {
  const store = new YjsDocumentStore();
  writeBoard(store, objects);
  return store;
}
