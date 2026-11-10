// Acceptance, second slice: the
// expansion's cost is pinned by counting its `DefinitionSource` reads, not by mocking its
// internals. No step reads the whole board: the same steps read exactly as much with 2,000
// unrelated objects on both pages as without them; moving an instance reads none of its main's
// content and does not scale with how many instances the main has.
import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import {
  cardMain,
  ComponentBoard,
  ExpansionHarness,
  frame,
  instance,
  shape,
} from './__fixtures__/component-scene.js';
import { expectedExport } from './__fixtures__/expected-api.js';

/** The ids of the card main and its descendants. */
const MAIN_CONTENT = new Set(['main', 'title', 'note', 'caption', 'photo', 'badge', 'dot', 'link']);

/**
 * 1,000 unrelated shapes in 10 frames on each page.
 *
 * @returns The 2,020 objects.
 */
function unrelated(): BoardObject[] {
  const objects: BoardObject[] = [];
  for (const page of ['page-a', 'page-b']) {
    for (let f = 0; f < 10; f += 1) {
      const frameId = `${page}-frame-${String(f)}`;
      objects.push(frame(frameId, null, { pageId: page, x: f * 1_000, y: 5_000 }));
      for (let s = 0; s < 100; s += 1)
        objects.push(shape(`${frameId}-shape-${String(s)}`, frameId, { x: s }));
    }
  }
  return objects;
}

/**
 * The card main on page A and `count` instances of it on page B, page B shown.
 *
 * @param count - How many instances.
 * @param hasUnrelated - Whether the 2,020 unrelated objects are on the board too.
 * @returns The board, not yet attached.
 */
function boardOf(count: number, hasUnrelated: boolean): ComponentBoard {
  const instances = [...Array<undefined>(count).keys()].map((index) =>
    instance(`inst-${String(index)}`, 'main', { pageId: 'page-b', x: index * 250 }),
  );
  return new ComponentBoard(
    [...cardMain('page-a'), ...instances, ...(hasUnrelated ? unrelated() : [])],
    'page-b',
  );
}

// The steps whose reads are counted, in order.
const STEPS: readonly (readonly [string, (board: ComponentBoard) => void])[] = [
  ['attach', () => undefined],
  [
    'main child edit',
    (board) => {
      board.update('title', { fill: [1, 0, 0, 1] });
    },
  ],
  [
    'instance move',
    (board) => {
      board.update('inst-3', { x: -500 });
    },
  ],
  [
    'instance resize',
    (board) => {
      board.update('inst-3', { width: 320 });
    },
  ],
  [
    'override',
    (board) => {
      board.update('inst-4', { overrides: { note: { text: 'Hey' } } });
    },
  ],
  [
    'main child deletion',
    (board) => {
      board.remove('note');
    },
  ],
  [
    'page switch',
    (board) => {
      board.show('page-a');
    },
  ],
  [
    'page switch back',
    (board) => {
      board.show('page-b');
    },
  ],
];

/**
 * Runs every step on a fresh board, counting the reads each makes.
 *
 * @param count - How many instances.
 * @param hasUnrelated - Whether the unrelated objects are on the board.
 * @returns The read count of each step, by name.
 */
function readsPerStep(count: number, hasUnrelated: boolean): Record<string, number> {
  const board = boardOf(count, hasUnrelated);
  const harness = new ExpansionHarness(board, expectedExport('InstanceExpansion'));
  const reads: Record<string, number> = {};
  for (const [name, change] of STEPS) {
    change(board);
    board.resetReads();
    harness.step();
    reads[name] = board.reads.length;
  }
  harness.expectScene();
  return reads;
}

describe('InstanceExpansion: definition reads', () => {
  it('reads exactly as much with 2,000 unrelated objects on the board as without', () => {
    expect(readsPerStep(50, true)).toEqual(readsPerStep(50, false));
  });

  it('reads none of the main’s content when an instance moves, whatever the instance count', () => {
    const counts = [1, 50].map((count) => {
      const board = boardOf(count, false);
      const harness = new ExpansionHarness(board, expectedExport('InstanceExpansion'));
      harness.step();
      board.update('inst-0', { x: 777, y: 42, rotation: 1 });
      board.resetReads();
      harness.step();
      expect(board.reads.filter(({ id }) => id !== null && MAIN_CONTENT.has(id))).toEqual([]);
      return board.reads.length;
    });
    expect(counts[1]).toBe(counts[0]);
  });

  it('re-expands nothing for an edit outside every definition', () => {
    const board = boardOf(50, true);
    const harness = new ExpansionHarness(board, expectedExport('InstanceExpansion'));
    harness.step();
    const before = harness.outputs.length;
    board.update('page-a-frame-3-shape-7', { fill: [0, 0, 0, 1] });
    board.update('page-b-frame-2-shape-9', { x: 55 });
    board.resetReads();
    harness.step();
    expect([...harness.listedSince(before)].filter((key) => key.includes('/'))).toEqual([]);
    expect(board.reads.length).toBeLessThanOrEqual(8);
  });
});
