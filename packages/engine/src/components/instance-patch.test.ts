// Edits to a leaf child of a main patch each instance's copy in place; every step is checked
// against a full resolution by the harness's oracle (`expectScene`).
import { describe, expect, it } from 'vitest';

import {
  cardMain,
  ComponentBoard,
  ExpansionHarness,
  frame,
  group,
  instance,
  shape,
} from './__fixtures__/component-scene.js';
import { InstanceExpansion } from './instance-expansion.js';

const RED = [0.9, 0.1, 0.1, 1];

/**
 * The card main with a frame chain, and instances at the main's size, resized, overridden and
 * with a hidden child.
 *
 * @returns The stepped harness.
 */
function scene(): ExpansionHarness {
  const board = new ComponentBoard([
    ...cardMain(),
    frame('panel', 'main', { x: 20, y: 60, width: 60, height: 30, z: 'a6' }),
    shape('chip', 'panel', {
      x: 5,
      y: 5,
      width: 10,
      height: 10,
      constraints: { x: 'end', y: 'end' },
    }),
    shape('pin', 'main', { x: 170, y: 70, constraints: { x: 'end', y: 'center' } }),
    instance('same', 'main'),
    instance('wide', 'main', { x: 400, width: 420, height: 180 }),
    instance('styled', 'main', {
      x: 900,
      width: 260,
      overrides: { title: { fill: [0, 0, 1, 1] }, pin: { isHidden: true } },
    }),
  ]);
  const harness = new ExpansionHarness(board, InstanceExpansion);
  harness.step();
  return harness;
}

/**
 * Applies an edit and checks the scene against a full resolution.
 *
 * @param harness - The stepped harness.
 * @param edit - The edit.
 * @returns The virtual ids listed for the edit.
 */
function step(harness: ExpansionHarness, edit: (board: ComponentBoard) => void): string[] {
  const from = harness.outputs.length;
  edit(harness.board);
  harness.step();
  harness.expectScene();
  return [...harness.listedSince(from)].filter((id) => id.includes('/')).sort();
}

describe('patching an edited leaf of a main', () => {
  it('restyles a child in every instance, keeping an override', () => {
    const harness = scene();
    expect(
      step(harness, (b) => {
        b.update('title', { fill: RED });
      }),
    ).toEqual(['same/title', 'wide/title']);
  });

  it('moves and resizes a pinned child at each instance size', () => {
    const harness = scene();
    expect(
      step(harness, (b) => {
        b.update('pin', { x: 160, width: 30 });
      }),
    ).toEqual(['same/pin', 'wide/pin']);
  });

  it('follows a child inside a frame chain', () => {
    const harness = scene();
    expect(
      step(harness, (b) => {
        b.update('chip', { fill: RED, y: 12 });
      }),
    ).toEqual(['same/chip', 'styled/chip', 'wide/chip']);
  });

  it('reads only the edited child and its ancestors, never a whole definition', () => {
    const harness = scene();
    harness.board.resetReads();
    step(harness, (b) => {
      b.update('chip', { fill: RED });
    });
    expect(harness.board.reads.filter(({ kind }) => kind === 'childrenOf')).toEqual([]);
    expect(harness.board.reads.length).toBeLessThanOrEqual(6);
  });

  it('resolves in full when the edit changes the tree', () => {
    const harness = scene();
    step(harness, (b) => {
      b.add(group('box', 'main', { z: 'a9' }));
    });
    step(harness, (b) => {
      b.update('caption', { parentId: 'box' });
    });
    step(harness, (b) => {
      b.update('panel', { width: 90 });
    });
    step(harness, (b) => {
      b.update('chip', { parentId: 'main' });
    });
    step(harness, (b) => {
      b.remove('photo');
    });
  });

  it('resolves in full when a patchable edit and a structural one share a step', () => {
    for (const order of ['edit first', 'add first']) {
      const harness = scene();
      const listed = step(harness, (b) => {
        if (order === 'add first') b.add(shape('extra', 'main', { z: 'b0' }));
        b.update('title', { x: 9 });
        if (order === 'edit first') b.add(shape('extra', 'main', { z: 'b0' }));
      });
      expect(listed).toEqual(expect.arrayContaining(['same/extra', 'wide/extra', 'styled/extra']));
    }
  });

  it('patches several edits in one step', () => {
    const harness = scene();
    step(harness, (b) => {
      b.update('title', { fill: RED });
      b.update('pin', { y: 10 });
      b.update('note', { text: { text: 'x', runs: [] } });
    });
  });
});
