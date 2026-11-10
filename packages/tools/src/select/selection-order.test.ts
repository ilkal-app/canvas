import { describe, expect, it } from 'vitest';

import { id, mapSource, selectBoardObjects } from './__fixtures__/select-board.js';
import { orderTargetOf } from './selection-order.js';

const SOURCE = mapSource(selectBoardObjects());

describe('orderTargetOf', () => {
  it('takes a selection that shares one parent whole', () => {
    expect(orderTargetOf([id('rect-a'), id('rect-b'), id('frame-f')], SOURCE)).toEqual({
      ids: ['rect-a', 'rect-b', 'frame-f'],
      leftOutIds: [],
    });
  });

  it('keeps the largest same-parent subset of a selection spanning several parents', () => {
    expect(orderTargetOf([id('rect-c'), id('rect-a'), id('rect-d'), id('rect-b')], SOURCE)).toEqual(
      { ids: ['rect-a', 'rect-b'], leftOutIds: ['rect-c', 'rect-d'] },
    );
  });

  it('breaks a tie toward the parent of the object selected first', () => {
    expect(orderTargetOf([id('rect-c'), id('rect-a')], SOURCE)).toEqual({
      ids: ['rect-c'],
      leftOutIds: ['rect-a'],
    });
    expect(orderTargetOf([id('rect-d'), id('group-h'), id('rect-a')], SOURCE)).toEqual({
      ids: ['rect-d', 'group-h'],
      leftOutIds: ['rect-a'],
    });
  });

  it('keeps locked objects, which may be reordered, and drops ids with no object', () => {
    expect(orderTargetOf([id('rect-locked'), id('gone'), id('rect-a')], SOURCE)).toEqual({
      ids: ['rect-locked', 'rect-a'],
      leftOutIds: [],
    });
  });

  it('is empty for an empty selection', () => {
    expect(orderTargetOf([], SOURCE)).toEqual({ ids: [], leftOutIds: [] });
  });
});
