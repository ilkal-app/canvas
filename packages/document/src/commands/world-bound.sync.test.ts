import { describe, expect, it } from 'vitest';

import { BOARD_BOUND, type ObjectId } from '@canvas/schema';

import { boxSourceOf } from '../bound/box-source.js';
import { isPastBound } from '../bound/extent-rule.js';
import { worldBoxOf } from '../bound/world-box.js';
import { BOB, createSyncedPair, exchange } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { createObjectCommand } from './create-object.js';
import { moveObjectsCommand } from './move-objects.js';
import { resizeObjectsCommand } from './resize-objects.js';

// The board's bound is a rule on each command, judged on the board its client sees.
// Two clients' commands, each within the bound where it ran, can merge past it: a move and a
// resize of one box write different stored groups (placement, size), and both survive the merge.
// Nothing is refused afterwards for it: the object is far, and may stay or come in.

const B = BOARD_BOUND;

describe('the bound under concurrent commands', () => {
  it('a move and a resize, each within the bound, merge past it; the box may then only come in', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, createObjectCommand, {
      object: {
        id: 'edge',
        type: 'frame',
        x: B - 300,
        y: 0,
        width: 100,
        height: 10,
        name: 'edge',
        clip: false,
        background: null,
      },
    });
    exchange(ada, bob);
    applyCommand(ada, moveObjectsCommand, { moves: [{ id: 'edge', by: { x: 150, y: 0 } }] });
    applyCommand(
      bob,
      resizeObjectsCommand,
      { resizes: [{ id: 'edge', to: { width: 250, height: 10 } }] },
      BOB,
    );
    exchange(ada, bob);
    for (const store of [ada, bob]) {
      const edge = mustGet(store, 'edge');
      expect(edge).toMatchObject({ x: B - 150, width: 250 });
      expect(isPastBound(worldBoxOf(boxSourceOf(store), edge))).toBe(true);
    }
    applyCommand(ada, moveObjectsCommand, { moves: [{ id: 'edge', by: { x: -100, y: 0 } }] });
    expect(ada.get('edge' as ObjectId)).toMatchObject({ x: B - 250 });
  });
});
