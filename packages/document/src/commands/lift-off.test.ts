import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import {
  BOB_ENVIRONMENT,
  create,
  moveBy,
  newShape,
  refill,
  sendAll,
  type,
} from '../history/__fixtures__/creation-fixtures.js';
import { ADA_ID, SCOUT_FOR_ADA } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ADA, BOB, fixtureBoard } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, testEnvironment } from './__fixtures__/command-fixtures.js';
import { connectCommand } from './connect.js';
import { liftOff } from './lift-off.js';
import { writtenSinceCreation } from './written-since-creation.js';

// Lift off deletes an agent's trace sheet as one command, one undo step for the person
// who lifts it, and keeps what a person has written to since the agent made it (the
// rule): Scout, an agent, works in a client of its own; Ada lifts its sheet off in hers; Bob
// edits from a third.

/**
 * Three clients on the fixture board: Ada's, Bob's and the agent's, with fixed client ids.
 *
 * @returns The stores, a full exchange between them, and Ada's history.
 */
function createBoard() {
  const stores = [1, 2, 3].map((clientId) => {
    const store = new YjsDocumentStore();
    internalsOf(store).doc.clientID = clientId;
    return store;
  });
  const [ada, bob, scout] = stores as [YjsDocumentStore, YjsDocumentStore, YjsDocumentStore];
  ada.transact(ADA, (transaction) => {
    for (const object of fixtureBoard().objects.values()) transaction.setObject(object);
  });
  const sync = (): void => {
    for (const from of stores) for (const to of stores) if (from !== to) sendAll(from, to);
  };
  sync();
  return { ada, bob, scout, sync, history: createHistory(ada, ADA_ID) };
}

/**
 * Creates the agent's three shapes in its own client.
 *
 * @param scout - The agent's store.
 * @returns Their ids.
 */
function agentWork(scout: YjsDocumentStore): ObjectId[] {
  return ['one', 'two', 'three'].map((id) => create(scout, newShape(`agent-${id}`), SCOUT_FOR_ADA));
}

describe('writtenSinceCreation', () => {
  it('tells a person’s edits of an agent’s objects from the agent’s own', () => {
    const { ada, bob, scout, sync } = createBoard();
    const [one, two, three] = agentWork(scout) as [ObjectId, ObjectId, ObjectId];
    sync();
    // The agent restyles its own shape: still only its work.
    refill(scout, one, [0, 1, 0, 1], SCOUT_FOR_ADA);
    moveBy(bob, two, 30);
    type(ada, three, 'Ada');
    sync();
    for (const store of [ada, bob, scout]) {
      expect(writtenSinceCreation(store, [one, two, three])).toEqual([two, three]);
    }
  });

  it('leaves out ids that are not on the board', () => {
    const { ada } = createBoard();
    expect(writtenSinceCreation(ada, ['missing' as ObjectId])).toEqual([]);
  });
});

describe('liftOff', () => {
  it('deletes the agent’s objects in one undo step, keeping the one a person edited', () => {
    const { ada, bob, scout, sync, history } = createBoard();
    const ids = agentWork(scout);
    sync();
    const [one, two, three] = ids as [ObjectId, ObjectId, ObjectId];
    refill(bob, two, [0, 0, 1, 1]);
    sync();

    const outcome = liftOff(ada, ADA, ids, testEnvironment());
    expect(outcome).toMatchObject({
      status: 'applied',
      liftedIds: [one, three].sort(),
      keptIds: [two],
    });
    sync();
    for (const store of [ada, bob, scout]) {
      expect([one, two, three].map((id) => store.get(id) !== undefined)).toEqual([
        false,
        true,
        false,
      ]);
    }
    expect(history.undo()).toBe(true);
    expect([one, three].map((id) => ada.get(id)?.createdBy)).toEqual([
      'agent:scout',
      'agent:scout',
    ]);
    expect(history.canUndo()).toBe(false);
  });

  it('keeps an object a person attached a connector to, and an agent frame holding their shape', () => {
    const { ada, bob, scout, sync } = createBoard();
    const target = create(scout, newShape('agent-target'), SCOUT_FOR_ADA);
    const frame = create(
      scout,
      {
        type: 'frame',
        id: 'agent-frame',
        x: 3_000,
        y: 0,
        width: 400,
        height: 300,
        name: 'Agent',
        clip: true,
        background: [1, 1, 1, 1],
      },
      SCOUT_FOR_ADA,
    );
    const inside = create(scout, newShape('agent-inside', frame), SCOUT_FOR_ADA);
    sync();
    const connector = applyCommand(
      bob,
      connectCommand,
      { from: { objectId: target }, to: { point: { x: 900, y: 900 } } },
      BOB,
      BOB_ENVIRONMENT,
    ).result.id;
    create(bob, newShape('bob-in-frame', frame), BOB);
    sync();

    const outcome = liftOff(ada, ADA, [target, frame, inside], testEnvironment());
    expect(outcome).toMatchObject({
      status: 'applied',
      liftedIds: [inside],
      keptIds: [frame, target].sort(),
    });
    expect(ada.get(connector)).toBeDefined();
  });

  it('runs nothing when every object is kept or gone', () => {
    const { ada, bob, scout, sync, history } = createBoard();
    const [one] = agentWork(scout) as [ObjectId];
    sync();
    refill(bob, one, [0, 0, 1, 1]);
    sync();
    expect(liftOff(ada, ADA, [one, 'gone' as ObjectId], testEnvironment())).toEqual({
      status: 'nothing',
      liftedIds: [],
      keptIds: [one],
    });
    expect(history.canUndo()).toBe(false);
  });
});
