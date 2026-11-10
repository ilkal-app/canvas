import { describe, expect, it } from 'vitest';

import { isValidKey, MAX_KEY_LENGTH, type ObjectId } from '@canvas/schema';

import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { createSiblingStore, FRAME_ID, objectId } from './__fixtures__/sibling-board.js';
import { planReorder, type ReorderDirection } from './reorder-plan.js';
import { sortedSiblings } from './sibling-order.js';

/**
 * Plans a reorder of `s<n>` shapes and returns the frame's order the plan would produce.
 *
 * @param store - The store.
 * @param names - The shapes to move.
 * @param direction - The move.
 * @returns The ids bottom to top after applying the plan to a copy of the order.
 * @throws {Error} When the plan fails.
 */
function orderAfter(
  store: YjsDocumentStore,
  names: readonly string[],
  direction: ReorderDirection,
): string[] {
  const plan = planReorder(store, names.map(objectId), direction);
  if ('issues' in plan) throw new Error(plan.issues.map((issue) => issue.message).join('; '));
  for (const key of plan.keys.values()) expect(isValidKey(key)).toBe(true);
  const keyOf = (id: ObjectId) => plan.keys.get(id) ?? store.get(id)?.z ?? '';
  return [...sortedSiblings(store, FRAME_ID)].sort((first, second) => {
    const [a, b] = [keyOf(first), keyOf(second)];
    return a < b ? -1 : 1;
  });
}

describe('bring to front', () => {
  it('moves the selection above every sibling, keeping its relative order', () => {
    expect(orderAfter(createSiblingStore(), ['s3', 's1'], 'front')).toEqual([
      's0',
      's2',
      's4',
      's5',
      's1',
      's3',
    ]);
  });

  it('changes nothing when the selection is already at the front', () => {
    const plan = planReorder(createSiblingStore(), [objectId('s4'), objectId('s5')], 'front');
    expect(plan).toEqual({ parentId: FRAME_ID, keys: new Map() });
  });

  it('changes nothing when every sibling is selected', () => {
    const plan = planReorder(createSiblingStore(3), ['s0', 's1', 's2'].map(objectId), 'front');
    expect('keys' in plan && plan.keys.size).toBe(0);
  });
});

describe('send to back', () => {
  it('moves the selection below every sibling, keeping its relative order', () => {
    expect(orderAfter(createSiblingStore(), ['s4', 's2'], 'back')).toEqual([
      's2',
      's4',
      's0',
      's1',
      's3',
      's5',
    ]);
  });

  it('changes nothing when the selection is already at the back', () => {
    const plan = planReorder(createSiblingStore(), [objectId('s0')], 'back');
    expect('keys' in plan && plan.keys.size).toBe(0);
  });
});

describe('bring forward', () => {
  it('moves one object above the sibling directly above it', () => {
    expect(orderAfter(createSiblingStore(), ['s1'], 'forward')).toEqual([
      's0',
      's2',
      's1',
      's3',
      's4',
      's5',
    ]);
  });

  it('moves each run of selected siblings above the next unselected one', () => {
    expect(orderAfter(createSiblingStore(), ['s0', 's1', 's3'], 'forward')).toEqual([
      's2',
      's0',
      's1',
      's4',
      's3',
      's5',
    ]);
  });

  it('lets a lower run land next to a run that moved first', () => {
    expect(orderAfter(createSiblingStore(), ['s2', 's4'], 'forward')).toEqual([
      's0',
      's1',
      's3',
      's2',
      's5',
      's4',
    ]);
  });

  it('leaves a run at the front where it is', () => {
    expect(orderAfter(createSiblingStore(), ['s1', 's5'], 'forward')).toEqual([
      's0',
      's2',
      's1',
      's3',
      's4',
      's5',
    ]);
    const plan = planReorder(createSiblingStore(), [objectId('s5')], 'forward');
    expect('keys' in plan && plan.keys.size).toBe(0);
  });
});

describe('send backward', () => {
  it('moves an object below the bottom sibling when that is the one it hops over', () => {
    expect(orderAfter(createSiblingStore(), ['s1'], 'backward')).toEqual([
      's1',
      's0',
      's2',
      's3',
      's4',
      's5',
    ]);
  });

  it('moves each run of selected siblings below the next unselected one', () => {
    expect(orderAfter(createSiblingStore(), ['s2', 's4'], 'backward')).toEqual([
      's0',
      's2',
      's1',
      's4',
      's3',
      's5',
    ]);
  });

  it('moves a run as a block and leaves a run at the back where it is', () => {
    expect(orderAfter(createSiblingStore(), ['s0', 's3', 's4'], 'backward')).toEqual([
      's0',
      's1',
      's3',
      's4',
      's2',
      's5',
    ]);
  });
});

describe('refusals', () => {
  it('names every missing object', () => {
    const plan = planReorder(
      createSiblingStore(),
      [objectId('s0'), objectId('ghost'), objectId('gone')],
      'front',
    );
    expect(plan).toEqual({
      issues: [expect.objectContaining({ code: 'missing-object', ids: ['ghost', 'gone'] })],
    });
  });

  it('refuses objects of different parents', () => {
    const plan = planReorder(createSiblingStore(), [objectId('s0'), objectId('r0')], 'front');
    expect(plan).toEqual({
      issues: [expect.objectContaining({ code: 'mixed-parents', ids: ['s0', 'r0'] })],
    });
  });

  it('refuses to place between neighbours that share a key', () => {
    const store = createSiblingStore(3, { 1: 'a1', 2: 'a1' });
    const plan = planReorder(store, [objectId('s0')], 'forward');
    expect(plan).toEqual({
      issues: [expect.objectContaining({ code: 'unorderable-neighbours', ids: ['s0'] })],
    });
  });

  it('refuses to place next to a neighbour whose key is not a fractional-index key', () => {
    const store = createSiblingStore(3, { 2: 'legacy' });
    const plan = planReorder(store, [objectId('s0')], 'front');
    expect('issues' in plan && plan.issues[0]?.code).toBe('unorderable-neighbours');
  });

  it('words a huge neighbour key in the refusal by a bounded description', () => {
    const store = createSiblingStore(3, { 2: 'x'.repeat(500_000) });
    const plan = planReorder(store, [objectId('s0')], 'front');
    const message = 'issues' in plan ? (plan.issues[0]?.message ?? '') : '';
    expect(message.length).toBeLessThan(400);
    expect(message).toContain('characters)');
  });

  it('refuses a move whose key would exceed the maximum length', () => {
    const long = `a0${'z'.repeat(MAX_KEY_LENGTH - 3)}`;
    const store = createSiblingStore(3, { 1: long, 2: 'a1' });
    const plan = planReorder(store, [objectId('s0')], 'forward');
    expect('issues' in plan && plan.issues[0]?.code).toBe('key-too-long');
  });

  it('treats a repeated id as one object', () => {
    const plan = planReorder(createSiblingStore(), [objectId('s1'), objectId('s1')], 'front');
    expect('keys' in plan && [...plan.keys.keys()]).toEqual(['s1']);
  });
});
