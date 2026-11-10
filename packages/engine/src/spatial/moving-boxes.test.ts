import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

import { MovingBoxes } from './moving-boxes.js';

const id = (value: string): ObjectId => value as ObjectId;
const box = (minX: number, minY: number, maxX: number, maxY: number): WorldBounds => ({
  minX,
  minY,
  maxX,
  maxY,
});

/**
 * Two moving objects with boxes, and a third without one.
 *
 * @returns The set, started at positions (0, 0), (100, 0) and (5, 5).
 */
function started(): MovingBoxes {
  const moving = new MovingBoxes();
  const boxes = new Map([
    [id('a'), { box: box(0, 0, 10, 10), drawing: undefined }],
    [id('b'), { box: box(100, 0, 110, 10), drawing: box(100, -5, 130, 0) }],
  ]);
  moving.begin(
    [id('a'), id('b'), id('boxless')],
    (key) => boxes.get(key),
    new Float64Array([0, 0, 100, 0, 5, 5]),
  );
  return moving;
}

describe('MovingBoxes', () => {
  it('starts idle, and holds every member while counting only those with boxes', () => {
    expect(new MovingBoxes().isActive).toBe(false);
    expect(new MovingBoxes().bounds).toBeUndefined();
    const moving = started();
    expect(moving.isActive).toBe(true);
    expect(moving.size).toBe(2);
    expect(moving.has(id('boxless'))).toBe(true);
    expect(moving.has(id('other'))).toBe(false);
    expect(moving.boundsOf(id('boxless'))).toBeUndefined();
    expect(moving.boundsOf(id('other'))).toBeUndefined();
    expect(moving.boundsOf(id('b'))).toEqual(box(100, -5, 130, 10));
    expect(moving.bounds).toEqual(box(0, -5, 130, 10));
  });

  it('translates boxes and drawing bounds by each object’s displacement', () => {
    const moving = started();
    expect(moving.move(new Float64Array([20, 30, 90, 0, 5, 5]))).toEqual([]);
    expect(moving.boundsOf(id('a'))).toEqual(box(20, 30, 30, 40));
    expect(moving.boundsOf(id('b'))).toEqual(box(90, -5, 120, 10));
    expect([...moving.entries()].map(([key]) => key)).toEqual([id('a'), id('b')]);
  });

  it('reports only the objects that enter or leave a tracked region', () => {
    const moving = started();
    const region = box(0, 0, 50, 50);
    expect(moving.move(new Float64Array([1, 1, 100, 0, 5, 5]), region)).toEqual([]);
    expect(moving.move(new Float64Array([200, 1, 30, 0, 5, 5]), region)).toEqual([
      id('a'),
      id('b'),
    ]);
    // Unchanged positions skip the object entirely.
    expect(moving.move(new Float64Array([200, 1, 30, 0, 5, 5]), region)).toEqual([]);
  });

  it('searches rectangles and points among the moving boxes', () => {
    const moving = started();
    expect(moving.searchRect(box(5, 5, 6, 6), [])).toEqual([id('a')]);
    expect(moving.searchRect(box(120, -4, 125, -1), [id('tree')])).toEqual([id('tree'), id('b')]);
    expect(moving.searchPoint({ x: 105, y: 5 }, [])).toEqual([id('b')]);
    expect(moving.searchPoint({ x: 50, y: 50 }, [])).toEqual([]);
  });

  it('replaces a moving object’s drawing bounds where it is drawn now, and refuses others', () => {
    const moving = started();
    moving.move(new Float64Array([10, 0, 100, 0, 5, 5]));
    expect(moving.setDrawing(id('a'), box(10, -20, 15, 0))).toEqual({
      previous: box(10, 0, 20, 10),
      next: box(10, -20, 20, 10),
    });
    // The drawing bounds move with the object afterwards.
    moving.move(new Float64Array([20, 0, 100, 0, 5, 5]));
    expect(moving.boundsOf(id('a'))).toEqual(box(20, -20, 30, 10));
    expect(moving.setDrawing(id('a'), undefined)?.next).toEqual(box(20, 0, 30, 10));
    expect(moving.setDrawing(id('other'), box(0, 0, 1, 1))).toBeUndefined();
  });

  it('ends the session: nothing is moving any more', () => {
    const moving = started();
    moving.end();
    expect(moving.isActive).toBe(false);
    expect(moving.size).toBe(0);
    expect(moving.has(id('a'))).toBe(false);
    expect(moving.searchRect(box(-1000, -1000, 1000, 1000), [])).toEqual([]);
  });

  it('translates every box by one shared displacement, then folds it into later moves', () => {
    const moving = started();
    const query = box(-1, -1, 50, 50);
    // b leaves nothing; a, shifted 60 right, leaves the query.
    expect(moving.translate(60, 0, query)).toEqual([id('a')]);
    expect(moving.boundsOf(id('a'))).toEqual(box(60, 0, 70, 10));
    expect(moving.boundsOf(id('b'))).toEqual(box(160, -5, 190, 10));
    expect(moving.translate(60, 0, query)).toEqual([]);
    // Positions after a translation: each object's own displacement, the shared one folded in.
    expect(moving.move(new Float64Array([0, 0, 100, 0, 5, 5]), query)).toEqual([id('a')]);
    expect(moving.boundsOf(id('a'))).toEqual(box(0, 0, 10, 10));
    expect(moving.boundsOf(id('b'))).toEqual(box(100, -5, 130, 10));
    expect(moving.translate(0, 0)).toEqual([]);
  });
});
