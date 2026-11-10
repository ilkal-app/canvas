import { expect } from 'vitest';
import * as Y from 'yjs';

import { validateBoard, type PrincipalId } from '@canvas/schema';

import { testEnvironment } from '../../commands/__fixtures__/command-fixtures.js';
import { judgedAtDoor } from '../../commands/__fixtures__/door-judgement.js';
import type { AnyCommand } from '../../commands/command.js';
import { COMMANDS, type CommandName } from '../../commands/registry.js';
import { runCommand } from '../../commands/run-command.js';
import { ADA, RELAY, unreadableEntries } from '../../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../../store/document-store.js';
import { OBJECTS_MAP_NAME, type YjsDocumentStore } from '../../store/yjs-document-store.js';
import type { UndoHistory } from '../undo-manager.js';

// The door guard's tests: a peer leaves a value the relay's door refuses on a board, by
// a raw update no door judged (as a board stored before the door existed holds it), Ada runs
// honest commands, and her undo and redo are judged as the relay's door judges every update.

/** Ada's principal id. */
export const ADA_PRINCIPAL = 'user:ada' as PrincipalId;

/** A width past the door's 2^32. */
export const FAR_WIDTH = 2 ** 40;

/**
 * Writes raw into an object's map, as a peer that skips validation does, and delivers it.
 *
 * @param store - The store that receives the peer's update.
 * @param objectId - The object.
 * @param write - Writes into the object's map, in the peer's document.
 */
export function writeRaw(
  store: YjsDocumentStore,
  objectId: string,
  write: (map: Y.Map<unknown>) => void,
): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, store.encodeState());
  peer.transact(() => {
    const map = peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(objectId);
    if (map === undefined) throw new Error(`no ${objectId} to write into`);
    write(map);
  });
  store.applyUpdate(Y.encodeStateAsUpdate(peer, store.encodeStateVector()), RELAY);
  peer.destroy();
}

/**
 * Merges fields into a stored group of an object, raw.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @param key - The group (`size`, `placement`, `style`).
 * @param fields - The fields to set.
 */
export function mergeRaw(
  store: YjsDocumentStore,
  objectId: string,
  key: string,
  fields: Readonly<Record<string, unknown>>,
): void {
  writeRaw(store, objectId, (map) => {
    map.set(key, { ...(map.get(key) as Record<string, unknown>), ...fields });
  });
}

/**
 * Runs one of Ada's commands by name, as the tools and agents do.
 *
 * @param store - The store.
 * @param name - The command.
 * @param input - Its input.
 * @param seed - The id generator's seed.
 * @throws {Error} When the command is refused.
 */
export function runAsAda(store: DocumentStore, name: CommandName, input: unknown, seed = 7): void {
  const outcome = runCommand(
    store,
    ADA,
    COMMANDS[name] as AnyCommand,
    input,
    testEnvironment(seed),
  );
  if (outcome.status !== 'applied') throw new Error(`${name} was not applied`);
}

/** What an undo or redo did, as the relay's door judged it. */
export interface JudgedRestore {
  /** What `undo()` or `redo()` returned. */
  readonly isChanged: boolean;
  /** `lastOmission()` after it. */
  readonly omission: string | undefined;
  /** `lastOmittedObjects()` after it. */
  readonly omittedObjects: number;
  /** The updates the door refused (none, ever). */
  readonly findings: readonly unknown[];
  /** How many updates it sent: one per part, with no repair after. */
  readonly updateCount: number;
}

/**
 * Undoes or redoes, judging every update as the relay's door does, and checks the board stays
 * readable and keeps the board rules (no dangling reference).
 *
 * @param store - Ada's store.
 * @param history - Ada's history.
 * @param direction - Undo or redo.
 * @returns What it did.
 */
export function judgedRestore(
  store: DocumentStore,
  history: UndoHistory,
  direction: 'undo' | 'redo',
): JudgedRestore {
  const {
    result: isChanged,
    findings,
    updateCount,
  } = judgedAtDoor(store, () => (direction === 'undo' ? history.undo() : history.redo()));
  expect(unreadableEntries(store)).toEqual([]);
  expect(validateBoard(store.read())).toEqual([]);
  return {
    isChanged,
    omission: history.lastOmission(),
    omittedObjects: history.lastOmittedObjects(),
    findings,
    updateCount,
  };
}
