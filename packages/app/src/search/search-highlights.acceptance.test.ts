import { describe, expect, it } from 'vitest';

import { createBoard, type BoardObject, type ObjectId, type Rgba } from '@canvas/schema';

import { memoryShape } from '../panels/__fixtures__/memory-board.js';

import { searchHighlightModelOf } from './search-highlights.js';

const COLOR: Rgba = [0.89, 0.66, 0.23, 1];
const id = (value: string): ObjectId => value as ObjectId;

const plain = { ...memoryShape('plain', 'a0'), x: 10, y: 20 };
const rotated = {
  ...memoryShape('rotated', 'a1'),
  x: 50,
  y: 60,
  rotation: Math.PI / 2,
};
const frame = {
  id: id('frame'),
  type: 'frame',
  parentId: null,
  x: 100,
  y: 200,
  rotation: 0,
  z: 'a2',
  locked: false,
  width: 100,
  height: 100,
  name: 'Parent',
  clip: false,
  background: [1, 1, 1, 1],
  createdBy: 'user:test',
  createdAt: 0,
  updatedAt: 0,
} as unknown as BoardObject;
const child = {
  ...memoryShape('child', 'a3', 'frame'),
  x: 5,
  y: 6,
};
const board = createBoard([plain, rotated, frame, child]);

describe('searchHighlightModelOf', () => {
  it('uses world bounds of plain, rotated and frame-child objects in id order', () => {
    const ids = Object.freeze([id('rotated'), id('plain'), id('child')]);
    expect(searchHighlightModelOf(board, ids, id('child'), COLOR)).toEqual({
      color: COLOR,
      boxes: [
        { bounds: { minX: 40, minY: 60, maxX: 50, maxY: 70 }, isActive: false },
        { bounds: { minX: 10, minY: 20, maxX: 20, maxY: 30 }, isActive: false },
        { bounds: { minX: 105, minY: 206, maxX: 115, maxY: 216 }, isActive: true },
      ],
    });
    expect(ids).toEqual([id('rotated'), id('plain'), id('child')]);
  });

  it('skips missing ids and objects without drawable bounds without changing frozen input', () => {
    const group = {
      ...memoryShape('group', 'a4'),
      type: 'group',
    } as BoardObject;
    const source = createBoard([plain, group]);
    const ids = Object.freeze([id('missing'), id('group'), id('plain')]);
    expect(searchHighlightModelOf(source, ids, id('missing'), COLOR)).toEqual({
      color: COLOR,
      boxes: [{ bounds: { minX: 10, minY: 20, maxX: 20, maxY: 30 }, isActive: false }],
    });
    expect(ids).toEqual([id('missing'), id('group'), id('plain')]);
    expect(searchHighlightModelOf(source, Object.freeze([]), undefined, COLOR).boxes).toEqual([]);
  });
});
