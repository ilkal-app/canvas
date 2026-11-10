// Acceptance, written by Claude from the nightly sync fuzz failure of
// 2026-10-10 (run 38043080593, seed 3939522526: every client converged with `c0s0` a child of
// `c0s11`, an instance; `invalid-parent`). A detach (by `detachInstance` or by deleting the
// main) turns an instance into a frame with the same id; another person may then put an object in
// that frame. Undoing the detach concurrently, before that person's write arrives, cannot be
// protected by the guard (it has not seen the write), so the merge itself must stay valid:
// the boards converge, nothing breaks a schema rule (no object is left under an instance), and the
// other person's object survives where they put it on the board. How the merge resolves it (the
// container rule or the instance's type) is the implementation's choice; these tests pin only
// that outcome, in both Yjs client-id orders.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import {
  createChild,
  createComponentPair,
  newSticky,
  placeInstance,
  seedMainWithChildren,
} from '../commands/__fixtures__/component-boards.js';
import { mustFindCommand } from '../commands/__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import {
  BOB_ENVIRONMENT,
  boardOf,
  expectValidAndConverged,
  ORDERS,
  placementOf,
} from '../repair/__fixtures__/repair-fixtures.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import { ADA_ID, Link } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

/** How Ada detaches the instance: by `detachInstance`, or by deleting its main. */
const ROUTES = ['detachInstance', 'deleteObjects of the main'] as const;

/** How Bob puts his sticky in the detached frame: a new object, or one moved in from the root. */
const WRITES = ['creates', 'moves'] as const;

/** Bob's sticky's box: in the frame, or at the board root before a move. */
const NOTE_BOX = { x: 5, y: 5, width: 100, height: 100 };

/**
 * Puts Bob's sticky `bobs-note` in the frame `inst-1`, as a new object or moved from the root.
 *
 * @param bob - Bob's store.
 * @param write - How.
 */
function putNoteInFrame(bob: DocumentStore, write: (typeof WRITES)[number]): void {
  if (write === 'creates') {
    createChild(bob, newSticky('bobs-note', 'inst-1', NOTE_BOX), BOB, BOB_ENVIRONMENT);
    return;
  }
  applyCommand(
    bob,
    moveObjectsCommand,
    { moves: [{ id: 'bobs-note', by: { x: 0, y: 0 }, parentId: 'inst-1' }] },
    BOB,
    BOB_ENVIRONMENT,
  );
}

describe.each(ORDERS)(
  'undoing a detach concurrently with a write into the frame ($name)',
  (order) => {
    describe.each(ROUTES)('detached by %s', (route) => {
      it.each(WRITES)('stays valid when Bob %s a sticky in the frame', (write) => {
        const [ada, bob] = createComponentPair(order.adaClientId, order.bobClientId, (store) => {
          seedMainWithChildren(store);
          placeInstance(store, 'main-card', { instanceId: 'inst-1', x: 1000, y: 0 });
          if (write === 'moves') createChild(store, newSticky('bobs-note', null, NOTE_BOX));
        });
        const history = createHistory(ada, ADA_ID);
        const link = new Link(ada, bob);
        if (route === 'detachInstance') {
          applyCommand(ada, mustFindCommand('detachInstance'), { id: 'inst-1' });
        } else {
          applyCommand(ada, deleteObjectsCommand, { ids: ['main-card'] });
        }
        link.deliver();
        expect(mustGet(bob, 'inst-1').type).toBe('frame');

        // Offline from each other: Ada undoes the detach, Bob puts his sticky in the frame.
        link.disconnect();
        expect(history.undo()).toBe(true);
        putNoteInFrame(bob, write);
        const note = mustGet(bob, 'bobs-note');
        expect(note.parentId).toBe('inst-1');
        const placed = placementOf(boardOf(bob), note);
        link.reconnect();

        expectValidAndConverged(ada, bob);
        const merged = mustGet(ada, 'bobs-note');
        expect(merged).toMatchObject({ type: 'sticky', text: 'Note' });
        expect(placementOf(boardOf(ada), merged)).toEqual(placed);
        expect(ada.get(merged.parentId ?? ('' as ObjectId))?.type).not.toBe('instance');
        history.destroy();
      });
    });
  },
);
