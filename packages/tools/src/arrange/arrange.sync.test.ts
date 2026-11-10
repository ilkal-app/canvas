import { describe, expect, it } from 'vitest';

import {
  deleteObjectsCommand,
  moveObjectsCommand,
  runCommand,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import type { PrincipalId } from '@canvas/schema';

import { id, rect } from '../select/__fixtures__/select-board.js';
import {
  ADA,
  createSelectStore,
  ENVIRONMENT,
  storeSource,
} from '../select/__fixtures__/select-store.js';

import { planArrange, runArrange } from './arrange-plan.js';

// Sync tests for a multi-object alignment (Global Constraint 1): the alignment is one
// moveObjects command, whose convergence the document's sync tests and the fuzz cover; these
// check that a whole alignment converges against another client's concurrent edits.

const BOB: TransactionOrigin = { kind: 'user', principalId: 'user:bob' as PrincipalId };

/** Three rectangles at the root: r1 at (0, 0), r2 at (70, 30), r3 at (300, 100). */
const RECTS = [
  rect('r1', null, { x: 0, y: 0, width: 50, height: 50 }),
  rect('r2', null, { x: 70, y: 30, width: 50, height: 50 }),
  rect('r3', null, { x: 300, y: 100, width: 50, height: 50 }),
];

/**
 * Sends each store what the other lacks, as the relay would.
 *
 * @param first - One client.
 * @param second - The other.
 */
function exchange(first: YjsDocumentStore, second: YjsDocumentStore): void {
  const forSecond = first.encodeState(second.encodeStateVector());
  const forFirst = second.encodeState(first.encodeStateVector());
  second.applyUpdate(forSecond, SYSTEM_ORIGIN);
  first.applyUpdate(forFirst, SYSTEM_ORIGIN);
}

/**
 * Two synced clients holding the three rectangles.
 *
 * @returns Ada's store and Bob's.
 */
function createPair(): [YjsDocumentStore, YjsDocumentStore] {
  const ada = createSelectStore(RECTS);
  const bob = new YjsDocumentStore();
  exchange(ada, bob);
  return [ada, bob];
}

/**
 * Ada aligns the three rectangles' left edges.
 *
 * @param ada - Ada's store.
 */
function alignLeft(ada: YjsDocumentStore): void {
  const plan = planArrange('alignLeft', ['r1', 'r2', 'r3'].map(id), storeSource(ada));
  if (plan) runArrange(ada, ADA, ENVIRONMENT, plan);
}

function expectConverged(ada: YjsDocumentStore, bob: YjsDocumentStore): void {
  expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
  expect(ada.read().issues).toEqual([]);
}

describe('a multi-object alignment with concurrent edits', () => {
  it('converges when another client moves one of the aligned objects', () => {
    const [ada, bob] = createPair();
    alignLeft(ada);
    runCommand(
      bob,
      BOB,
      moveObjectsCommand,
      { moves: [{ id: 'r3', by: { x: 0, y: 400 } }] },
      ENVIRONMENT,
    );
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(bob.get(id('r2'))).toMatchObject({ x: 0, y: 30 });
    expect(bob.get(id('r1'))).toMatchObject({ x: 0, y: 0 });
  });

  it('converges when another client deletes one of the aligned objects', () => {
    const [ada, bob] = createPair();
    alignLeft(ada);
    runCommand(bob, BOB, deleteObjectsCommand, { ids: ['r3'] }, ENVIRONMENT);
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(bob.get(id('r3'))).toBeUndefined();
    expect(bob.get(id('r2'))).toMatchObject({ x: 0, y: 30 });
  });
});
