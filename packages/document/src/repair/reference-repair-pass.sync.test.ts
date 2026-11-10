// The store's repair pass beyond the rules: undo by the user whose edit the repair
// overwrote, the repair not being anyone's undo step, a second pass writing nothing, and
// errors of listeners during the update and the repair.
import { describe, expect, it } from 'vitest';

import { validateBoard } from '@canvas/schema';

import { applyCommand, mustGet, NOW } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import {
  ADA_ID,
  BOB_ID,
  createClientPair,
  Link,
} from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { BOB, id, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';

import {
  BOB_ENVIRONMENT,
  expectValidAndConverged,
  newShape,
  ORDERS,
  recordRepairs,
} from './__fixtures__/repair-fixtures.js';

describe.each(ORDERS)('undo after the repair ($name)', ({ adaClientId, bobClientId }) => {
  it('lets the user whose edit the repair overwrote undo it without reverting or fighting the repair', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const bobHistory = createHistory(bob, BOB_ID);
    const link = new Link(ada, bob);
    link.disconnect();
    applyCommand(ada, deleteObjectsCommand, { ids: ['frame-plan'] });
    // Apart from Ada, Bob puts c in the frame, then, a second later, moves it there.
    applyCommand(
      bob,
      createObjectCommand,
      { object: newShape('shape-c', 'frame-plan', 40) },
      BOB,
      BOB_ENVIRONMENT,
    );
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'shape-c', by: { x: 30, y: 20 } }] },
      BOB,
      { ...BOB_ENVIRONMENT, clock: () => NOW + 1_000 },
    );
    link.reconnect();
    // Both clients repaired c to the root. The link delivers Bob's two commands one at a time,
    // so Ada repaired c between them, concurrently with his move: which of the two keeps c's
    // placement depends on the merge order, and one placement is kept whole. Either way, both
    // clients hold the same valid board.
    const repaired = mustGet(bob, 'shape-c');
    expect(repaired.parentId).toBeNull();
    expectValidAndConverged(ada, bob);
    const repairs = [recordRepairs(ada), recordRepairs(bob)];
    // Undoing the move: the repair's later writes to c's placement win over the undo, so c
    // stays at the root where it is; only what the repair left alone (`updatedAt`) goes back.
    expect(bobHistory.undo()).toBe(true);
    link.deliver();
    expect(mustGet(bob, 'shape-c')).toEqual({ ...repaired, updatedAt: NOW });
    expectValidAndConverged(ada, bob);
    // Undoing the creation removes c. No repair runs at any point after the first.
    expect(bobHistory.undo()).toBe(true);
    link.deliver();
    expect(bob.get(id('shape-c'))).toBeUndefined();
    expect(repairs.flat()).toEqual([]);
    expectValidAndConverged(ada, bob);
  });
});

describe('the store’s repair pass', () => {
  it('is no one’s undo step: Ada’s undo reverts her delete, and the repair stays', () => {
    const [ada, bob] = createClientPair(2, 1);
    const history = createHistory(ada, ADA_ID);
    const link = new Link(ada, bob);
    link.disconnect();
    applyCommand(ada, deleteObjectsCommand, { ids: ['video-demo'] });
    applyCommand(
      bob,
      createObjectCommand,
      {
        object: {
          type: 'comment',
          id: 'comment-late',
          x: 0,
          y: 0,
          threadId: 'thread-late',
          anchor: { kind: 'object', objectId: 'video-demo', offset: { x: 30, y: 40 } },
        },
      },
      BOB,
      BOB_ENVIRONMENT,
    );
    link.reconnect();
    const repaired = mustGet(ada, 'comment-late');
    expect(repaired).toMatchObject({ anchor: { kind: 'point' } });
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    link.deliver();
    expect(ada.get(id('video-demo'))).toBeDefined();
    expect(mustGet(ada, 'comment-late')).toEqual(repaired);
    expectValidAndConverged(ada, bob);
  });

  it('runs after an update applied from storage, and a second pass changes nothing', () => {
    const [ada, bob] = createClientPair(1, 2);
    const stateBefore = bob.encodeStateVector();
    applyCommand(ada, deleteObjectsCommand, { ids: ['group-diagram'] });
    applyCommand(bob, createObjectCommand, { object: newShape('shape-late', 'group-diagram', 0) });
    const repairs = recordRepairs(bob);
    bob.applyUpdate(ada.encodeState(stateBefore), RELAY);
    expect(repairs.map(({ changes }) => [...changes.updated])).toEqual([[id('shape-late')]]);
    expect(internalsOf(bob).repairReferences(new Set([id('shape-late')]))).toEqual([]);
    expect(repairs).toHaveLength(1);
    expect(validateBoard(bob.read())).toEqual([]);
  });

  it('still repairs when a listener throws during the update, then rethrows', () => {
    const [ada, bob] = createClientPair(1, 2);
    const stateBefore = bob.encodeStateVector();
    applyCommand(ada, deleteObjectsCommand, { ids: ['group-diagram'] });
    applyCommand(bob, createObjectCommand, { object: newShape('shape-late', 'group-diagram', 0) });
    const failure = new Error('a listener failed');
    const unsubscribe = bob.subscribe((changes) => {
      if (!changes.isLocal) throw failure;
    });
    expect(() => {
      bob.applyUpdate(ada.encodeState(stateBefore), RELAY);
    }).toThrow(failure);
    unsubscribe();
    expect(mustGet(bob, 'shape-late').parentId).toBe('frame-plan');
    expect(validateBoard(bob.read())).toEqual([]);
  });

  it('reports both errors when a listener throws on the update and on the repair', () => {
    const [ada, bob] = createClientPair(1, 2);
    const stateBefore = bob.encodeStateVector();
    applyCommand(ada, deleteObjectsCommand, { ids: ['group-diagram'] });
    applyCommand(bob, createObjectCommand, { object: newShape('shape-late', 'group-diagram', 0) });
    const [onUpdate, onRepair] = [new Error('on the update'), new Error('on the repair')];
    bob.subscribe((changes) => {
      throw changes.isLocal ? onRepair : onUpdate;
    });
    let thrown: unknown;
    try {
      bob.applyUpdate(ada.encodeState(stateBefore), RELAY);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([onUpdate, onRepair]);
    // The repair's transaction was committed before its listener threw.
    expect(mustGet(bob, 'shape-late').parentId).toBe('frame-plan');
  });
});
