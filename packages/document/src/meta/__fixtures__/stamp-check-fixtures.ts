// Documents and updates for the relay's stamp check tests: a relay's copy of a board,
// a writer from before, the update a write makes, and what a store's version guard says
// once an update is applied.
import * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import { DocumentVersionGuard } from '../../store/document-version-guard.js';
import { OBJECTS_MAP_NAME } from '../../store/yjs-document-store.js';
import { DocumentVersionError } from '../document-version-error.js';

/** The Yjs client id of the old build in these tests: a writer that never stamps. */
export const OLD_BUILD = 77;

/**
 * A relay's copy of a board: a plain document holding what it was sent.
 *
 * @param updates - The updates it holds.
 * @returns The document.
 */
export function relayHolding(...updates: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const update of updates) Y.applyUpdate(doc, update);
  return doc;
}

/**
 * A writer from before: raw Yjs, objects and no stamp, holding what the relay holds.
 *
 * @param relay - The relay's copy, which the writer syncs from first.
 * @param clientId - The writer's Yjs client id; {@link OLD_BUILD} by default.
 * @returns The writer's document.
 */
export function oldBuildOn(relay: Y.Doc, clientId = OLD_BUILD): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(relay));
  return doc;
}

/**
 * Runs a write on a document and returns the update it made.
 *
 * @param doc - The document.
 * @param write - The write.
 * @returns The update's bytes.
 */
export function updateOf(doc: Y.Doc, write: () => void): Uint8Array {
  const before = Y.encodeStateVector(doc);
  doc.transact(write);
  return Y.encodeStateAsUpdate(doc, before);
}

/**
 * What a store's version guard says of a board, over every object entry: the real
 * `DocumentVersionGuard`, as a client opening the board runs it.
 *
 * @param doc - The board; not changed.
 * @returns The guard's problem (`unversioned`, `unreadable-version`), or undefined.
 * @throws {unknown} What the guard throws other than a `DocumentVersionError`.
 */
export function guardProblemOf(doc: Y.Doc): string | undefined {
  const objects = doc.getMap<unknown>(OBJECTS_MAP_NAME);
  const guard = new DocumentVersionGuard(doc, objects);
  try {
    guard.check(new Set([...objects._map.keys()].map((key) => key as ObjectId)));
    return undefined;
  } catch (error) {
    if (error instanceof DocumentVersionError) return error.problem;
    throw error;
  }
}

/**
 * What a store's version guard says of a board once an update is applied to a copy of it.
 *
 * @param doc - The board; not changed.
 * @param update - The update.
 * @returns The guard's problem, or undefined.
 */
export function guardProblemAfter(doc: Y.Doc, update: Uint8Array): string | undefined {
  const copy = relayHolding(Y.encodeStateAsUpdate(doc));
  Y.applyUpdate(copy, update);
  return guardProblemOf(copy);
}
