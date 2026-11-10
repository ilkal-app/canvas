import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import { buildChildIndex } from '../board/child-index.js';
import type { ObjectId } from '../ids/object-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';

import { parentToBoardTransform } from './board-transform.js';
import { commentPinPoint, connectorEndPoint } from './reference-points.js';

const id = (value: string): ObjectId => value as ObjectId;

describe('connectorEndPoint', () => {
  it('returns a free end as it is stored, in the connector frame', () => {
    const connector = sampleObject('connector', 'c', { x: 100, y: 100, rotation: 1 });
    const board = createBoard([connector]);
    expect(
      connectorEndPoint(board, connector, { kind: 'point', x: 3, y: 4 }, buildChildIndex(board)),
    ).toEqual({
      x: 3,
      y: 4,
    });
  });

  it('measures an anchor on a group target from its derived bounds', () => {
    const group = sampleObject('group', 'g', { x: 0, y: 0 });
    const shape = sampleObject('shape', 's', {
      parentId: group.id,
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
    const connector = sampleObject('connector', 'c', { x: 0, y: 0 });
    const board = createBoard([group, shape, connector]);
    const end = { kind: 'object', objectId: group.id, anchor: { x: 0, y: 1 } } as const;
    expect(connectorEndPoint(board, connector, end, buildChildIndex(board))).toEqual({
      x: 10,
      y: 70,
    });
  });
});

describe('commentPinPoint', () => {
  it('returns the comment position for a point anchor', () => {
    const comment = sampleObject('comment', 'm', { x: 7, y: 8 });
    expect(commentPinPoint(createBoard([comment]), comment)).toEqual({ x: 7, y: 8 });
  });

  it('falls back to the comment position when the anchor object is not on the board', () => {
    const comment = sampleObject('comment', 'm', {
      x: 7,
      y: 8,
      anchor: { kind: 'object', objectId: id('gone'), offset: { x: 1, y: 1 } },
    });
    expect(commentPinPoint(createBoard([comment]), comment)).toEqual({ x: 7, y: 8 });
  });
});

describe('parentToBoardTransform', () => {
  it('throws for an object that is its own parent', () => {
    const group = sampleObject('group', 'g', { parentId: id('g') });
    expect(() => parentToBoardTransform(createBoard([group]), group)).toThrow(RangeError);
  });
});
