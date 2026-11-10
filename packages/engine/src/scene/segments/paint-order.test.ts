import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { paintOrderOf, paintRanksOfSiblings, type StackedObject } from './paint-order.js';
import { SiblingLists } from './sibling-lists.js';

function stacked(id: string, z: string, parentId: string | null = null): StackedObject {
  return { id: id as ObjectId, z, parentId: parentId as ObjectId | null };
}

describe('paintOrderOf', () => {
  it('paints root objects bottom to top by z', () => {
    const objects = [stacked('top', 'a2'), stacked('bottom', 'a0'), stacked('middle', 'a1')];
    expect(paintOrderOf(objects)).toEqual(['bottom', 'middle', 'top']);
  });

  it('paints a parent before its children and its children before its next sibling', () => {
    const objects = [
      stacked('frame', 'a0'),
      stacked('above', 'a1'),
      stacked('child-top', 'a1', 'frame'),
      stacked('child-bottom', 'a0', 'frame'),
      stacked('grandchild', 'a0', 'child-top'),
    ];
    expect(paintOrderOf(objects)).toEqual([
      'frame',
      'child-bottom',
      'child-top',
      'grandchild',
      'above',
    ]);
  });

  it('breaks equal keys by id, like the document package', () => {
    const objects = [stacked('b', 'a0'), stacked('a', 'a0')];
    expect(paintOrderOf(objects)).toEqual(['a', 'b']);
  });

  it('paints an object whose parent is missing as a root object', () => {
    const objects = [stacked('orphan', 'a1', 'gone'), stacked('root', 'a0')];
    expect(paintOrderOf(objects)).toEqual(['root', 'orphan']);
  });

  it('paints objects caught in a parent cycle last, once each, so the frame still draws', () => {
    const objects = [stacked('p', 'a0', 'q'), stacked('q', 'a1', 'p'), stacked('root', 'a5')];
    expect(paintOrderOf(objects)).toEqual(['root', 'p', 'q']);
  });

  it('returns an empty order for no objects and does not mutate its input', () => {
    expect(paintOrderOf([])).toEqual([]);
    const objects = Object.freeze([stacked('b', 'a1'), stacked('a', 'a0')]);
    paintOrderOf(objects);
    expect(objects.map(({ id }) => id)).toEqual(['b', 'a']);
  });
});

describe('paintRanksOfSiblings (closing ranks)', () => {
  const board = [
    stacked('outer', 'a0'),
    stacked('inner', 'a0', 'outer'),
    stacked('leaf', 'a0', 'inner'),
    stacked('beside', 'a1', 'outer'),
    stacked('next', 'a1'),
  ];

  it('gives the plain paint order, and no closing rank, when nothing closes', () => {
    const ranks = paintRanksOfSiblings(SiblingLists.of(board));
    expect(ranks.ids).toEqual(paintOrderOf(board));
    expect([...ranks.isClosingRank]).toEqual([0, 0, 0, 0, 0]);
    expect(ranks.closingCount).toBe(0);
  });

  it('closes an object after its whole subtree, nested closings inside their parent’s', () => {
    const closes = new Set(['outer', 'inner', 'next']);
    const ranks = paintRanksOfSiblings(SiblingLists.of(board), (id) => closes.has(id));
    expect(ranks.ids).toEqual([
      'outer',
      'inner',
      'leaf',
      'inner',
      'beside',
      'outer',
      'next',
      'next',
    ]);
    expect([...ranks.isClosingRank]).toEqual([0, 0, 0, 1, 0, 1, 0, 1]);
    expect(ranks.closingCount).toBe(3);
  });

  it('closes objects caught in a parent cycle too, once each', () => {
    const cycle = [stacked('a', 'a0', 'b'), stacked('b', 'a0', 'a'), stacked('root', 'a0')];
    const ranks = paintRanksOfSiblings(SiblingLists.of(cycle), (id) => id === 'a');
    expect(ranks.ids.filter((id) => id === 'a')).toHaveLength(2);
    expect(ranks.ids.filter((id) => id === 'b')).toHaveLength(1);
    expect(ranks.closingCount).toBe(1);
    const a = 'a' as ObjectId;
    expect(ranks.ids.indexOf(a)).toBeLessThan(ranks.ids.lastIndexOf(a));
  });
});
