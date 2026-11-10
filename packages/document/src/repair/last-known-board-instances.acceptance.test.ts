// Acceptance, written by Claude after the hosted coverage run of PR 153:
// `LastKnownBoard` answers every reverse index but `childrenOf` from the store's own (see
// last-known-board.test.ts, "answers the other indexes from the store's"); the instance index
// that adds to `BoardReferences` is one of them, so a repair measuring on the last-known
// board sees a main's instances exactly as the store indexes them.
import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { placeInstance, seedLeafMain } from '../commands/__fixtures__/component-boards.js';
import { instancesOf } from '../commands/__fixtures__/component-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { LastKnownBoard } from './last-known-board.js';

it("answers a main's instances from the store's index", () => {
  const store = new YjsDocumentStore({ clientId: 1 });
  seedLeafMain(store, 'main', { x: 0, y: 0 });
  placeInstance(store, 'main', { instanceId: 'first', x: 400, y: 0 });
  placeInstance(store, 'main', { instanceId: 'second', x: 800, y: 0 });
  const board = new LastKnownBoard(store, internalsOf(store).lastKnown);
  const fromBoard = (board.references as unknown as Record<string, (id: ObjectId) => unknown>)
    .instancesOf;
  if (typeof fromBoard !== 'function') throw new Error('missing references.instancesOf');
  expect(fromBoard('main' as ObjectId)).toBe(instancesOf(store, 'main'));
  expect([...instancesOf(store, 'main')].sort()).toEqual(['first', 'second']);
});
