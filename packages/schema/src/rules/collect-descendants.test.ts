import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';

import { collectDescendants } from './collect-descendants.js';

const id = (value: string): ObjectId => value as ObjectId;

describe('collectDescendants', () => {
  const frame = sampleObject('frame', 'frame');
  const group = sampleObject('group', 'group', { parentId: frame.id });
  const board = createBoard([
    frame,
    group,
    sampleObject('shape', 'inner', { parentId: group.id }),
    sampleObject('text', 'caption', { parentId: frame.id }),
    sampleObject('shape', 'outside'),
  ]);

  it('returns the objects and every descendant, sorted by id', () => {
    expect(collectDescendants(board, [frame.id])).toEqual(['caption', 'frame', 'group', 'inner']);
  });

  it('ignores ids that are not on the board and collapses overlapping requests', () => {
    expect(collectDescendants(board, [group.id, id('inner'), id('missing')])).toEqual([
      'group',
      'inner',
    ]);
  });

  it('terminates on a parent cycle', () => {
    const cyclic = createBoard([
      sampleObject('group', 'a', { parentId: id('b') }),
      sampleObject('group', 'b', { parentId: id('a') }),
    ]);
    expect(collectDescendants(cyclic, [id('a')])).toEqual(['a', 'b']);
  });
});
