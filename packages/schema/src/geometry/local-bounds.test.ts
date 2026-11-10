import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import { buildChildIndex } from '../board/child-index.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import type { BoardObject } from '../objects/board-object.js';

import { objectToBoardTransform } from './board-transform.js';
import { localBounds, type BoundsCache } from './local-bounds.js';
import { applyTransform } from './rigid-transform.js';

function boundsOf(objects: BoardObject[], id: string): ReturnType<typeof localBounds> {
  const board = createBoard(objects);
  const object = objects.find((candidate) => candidate.id === id);
  if (object === undefined) throw new Error(`no object ${id}`);
  return localBounds(board, object, buildChildIndex(board));
}

describe('localBounds', () => {
  it('is the stored box for boxed types', () => {
    expect(boundsOf([sampleObject('image', 'i')], 'i')).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 240,
    });
  });

  it('spans the two points of a line', () => {
    const points = [
      { x: 30, y: -10 },
      { x: -5, y: 20 },
    ] as [{ x: number; y: number }, { x: number; y: number }];
    expect(boundsOf([sampleObject('line', 'l', { points })], 'l')).toEqual({
      x: -5,
      y: -10,
      width: 35,
      height: 30,
    });
  });

  it('spans the vertices and handle control points of a path, which contain its curves', () => {
    const path = sampleObject('path', 'p', {
      vertices: [
        { id: 'v1', x: 0, y: 0, mirror: 'none' },
        { id: 'v2', x: 100, y: 0, mirror: 'none' },
      ],
      segments: [{ id: 's1', a: 'v1', b: 'v2', ha: { x: 0, y: -40 }, hb: { x: 0, y: -40 } }],
    });
    expect(boundsOf([path], 'p')).toEqual({ x: 0, y: -40, width: 100, height: 40 });
  });

  it('is an empty box at the origin for an empty path, a connector and a comment', () => {
    for (const object of [
      sampleObject('path', 'x'),
      sampleObject('connector', 'x'),
      sampleObject('comment', 'x'),
    ]) {
      expect(boundsOf([object], 'x')).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    }
  });

  it('derives a group from its children placed in the group frame, including rotated and nested ones', () => {
    const group = sampleObject('group', 'g', { x: 0, y: 0 });
    const inner = sampleObject('group', 'inner', { parentId: group.id, x: 100, y: 0 });
    const objects = [
      group,
      sampleObject('shape', 'a', { parentId: group.id, x: 10, y: 10, width: 20, height: 20 }),
      inner,
      // A quarter turn clockwise about its origin: the 40 × 10 box covers x ∈ [-10, 0], y ∈ [0, 40].
      sampleObject('shape', 'b', {
        parentId: inner.id,
        x: 0,
        y: 0,
        width: 40,
        height: 10,
        rotation: Math.PI / 2,
      }),
    ];
    const bounds = boundsOf(objects, 'g');
    expect(bounds.x).toBeCloseTo(10, 9);
    expect(bounds.y).toBeCloseTo(0, 9);
    expect(bounds.width).toBeCloseTo(90, 9);
    expect(bounds.height).toBeCloseTo(40, 9);
  });

  it('ignores connectors and comments in a group, whose geometry derives from other objects', () => {
    const group = sampleObject('group', 'g');
    const objects = [
      group,
      sampleObject('shape', 's', { parentId: group.id, x: 0, y: 0, width: 10, height: 10 }),
      sampleObject('connector', 'c', { parentId: group.id, x: 500, y: 500 }),
      sampleObject('comment', 'm', { parentId: group.id, x: -500, y: -500 }),
    ];
    expect(boundsOf(objects, 'g')).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
});

describe('objectToBoardTransform', () => {
  it('composes every ancestor, so a child of a moved frame moves with it', () => {
    const frame = sampleObject('frame', 'f', { x: 1000, y: 500 });
    const group = sampleObject('group', 'g', {
      parentId: frame.id,
      x: 10,
      y: 0,
      rotation: Math.PI,
    });
    const shape = sampleObject('shape', 's', { parentId: group.id, x: 5, y: 5 });
    const board = createBoard([frame, group, shape]);
    const origin = applyTransform(objectToBoardTransform(board, shape), { x: 0, y: 0 });
    expect(origin.x).toBeCloseTo(1005, 9);
    expect(origin.y).toBeCloseTo(495, 9);
  });

  it('treats a missing parent as the board root', () => {
    const shape = sampleObject('shape', 's', {
      parentId: sampleObject('group', 'gone').id,
      x: 3,
      y: 4,
    });
    expect(
      applyTransform(objectToBoardTransform(createBoard([shape]), shape), { x: 0, y: 0 }),
    ).toEqual({ x: 3, y: 4 });
  });

  it('throws on a parent cycle instead of looping forever', () => {
    const first = sampleObject('group', 'g1', { parentId: sampleObject('group', 'g2').id });
    const second = sampleObject('group', 'g2', { parentId: first.id });
    expect(() => objectToBoardTransform(createBoard([first, second]), first)).toThrow(RangeError);
  });
});

describe('localBounds at the 50k-object budget', () => {
  it('bounds a group of 40,000 children and a path of 40,000 vertices without exhausting the stack', () => {
    const group = sampleObject('group', 'g');
    const children = [...Array(40_000).keys()].map((index) =>
      sampleObject('shape', `s${String(index)}`, {
        parentId: group.id,
        x: index,
        y: -index,
        width: 1,
        height: 1,
      }),
    );
    expect(boundsOf([group, ...children], 'g')).toEqual({
      x: 0,
      y: -39_999,
      width: 40_000,
      height: 40_000,
    });

    const vertices = [...Array(40_000).keys()].map((index) => ({
      id: `v${String(index)}`,
      x: index,
      y: index % 2,
      mirror: 'none' as const,
    }));
    const segments = vertices.slice(1).map((vertex, index) => ({
      id: `s${String(index)}`,
      a: `v${String(index)}`,
      b: vertex.id,
      ha: { x: 0, y: 0 },
      hb: { x: 0, y: 0 },
    }));
    expect(boundsOf([sampleObject('path', 'p', { vertices, segments })], 'p')).toEqual({
      x: 0,
      y: 0,
      width: 39_999,
      height: 1,
    });
  });
});

describe('localBounds with a shared cache', () => {
  it('measures a target once and serves the same rectangle to later callers', () => {
    const group = sampleObject('group', 'g');
    const board = createBoard([
      group,
      sampleObject('shape', 's', { parentId: group.id, width: 5, height: 5 }),
    ]);
    const cache: BoundsCache = new Map();
    const first = localBounds(board, group, buildChildIndex(board), cache);
    expect(cache.get(group.id)).toBe(first);
    expect(localBounds(board, group, buildChildIndex(board), cache)).toBe(first);
  });
});
