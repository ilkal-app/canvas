import { describe, expect, it } from 'vitest';

import { createHistory, type ChangeSet } from '@canvas/document';

import { id, rect } from '../select/__fixtures__/select-board.js';
import {
  ADA,
  createSelectStore,
  ENVIRONMENT,
  storeSource,
} from '../select/__fixtures__/select-store.js';

import { ARRANGE_OPERATIONS, planArrange, runArrange } from './arrange-plan.js';

// Each of the nine arrange operations as the app runs it, on three unturned 50 × 50
// rectangles: r1 at (0, 0), r2 at (70, 30) and r3 at (300, 100); every one moves something.
const RECTS = [
  rect('r1', null, { x: 0, y: 0, width: 50, height: 50 }),
  rect('r2', null, { x: 70, y: 30, width: 50, height: 50 }),
  rect('r3', null, { x: 300, y: 100, width: 50, height: 50 }),
];
const IDS = ['r1', 'r2', 'r3'].map(id);

describe('an arrange operation and the undo history', () => {
  it.each(ARRANGE_OPERATIONS)('%s is one change set and one undo step', (operation) => {
    const store = createSelectStore(RECTS);
    const history = createHistory(store, ADA.principalId);
    const changeSets: ChangeSet[] = [];
    store.subscribe((changes) => changeSets.push(changes));
    const positions = () => IDS.map((each) => [store.get(each)?.x, store.get(each)?.y]);
    const before = positions();
    const plan = planArrange(operation, IDS, storeSource(store));
    if (plan) runArrange(store, ADA, ENVIRONMENT, plan);
    expect(changeSets).toHaveLength(1);
    expect(positions()).not.toEqual(before);
    history.undo();
    expect(positions()).toEqual(before);
  });
});
