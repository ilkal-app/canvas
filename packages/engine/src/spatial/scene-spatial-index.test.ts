import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { nestedBoard } from './__fixtures__/nested-board.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';

function loadedIndex(): { index: SceneSpatialIndex; document: FakeSceneDocument } {
  const document = new FakeSceneDocument();
  document.create(...nestedBoard());
  const index = new SceneSpatialIndex();
  index.apply(document.takeChanges());
  return { index, document };
}

function expectBox(index: SceneSpatialIndex, id: string, expected: number[]) {
  const bounds = index.boundsOf(id as ObjectId);
  expect(bounds).toBeDefined();
  if (!bounds) return;
  const actual = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
  actual.forEach((value, axis) => {
    expect(value).toBeCloseTo(expected[axis] ?? Number.NaN, 9);
  });
}

function sortedIds(ids: readonly ObjectId[]): string[] {
  return [...ids].sort();
}

describe('SceneSpatialIndex', () => {
  it('indexes nested and rotated objects by their world boxes, and groups not at all', () => {
    const { index } = loadedIndex();
    expect(index.size).toBe(5);
    expectBox(index, 'f', [0, 100, 100, 200]);
    expectBox(index, 'f-a', [90, 110, 100, 120]);
    expectBox(index, 'g-b', [50, 150, 70, 160]);
    const half = 5 * Math.SQRT2;
    expectBox(index, 'r', [300 - half, 0, 300 + half, 2 * half]);
    expect(index.boundsOf('g' as ObjectId)).toBeUndefined();
    expect(index.validate()).toEqual([]);
  });

  it('answers rect and point queries in world space', () => {
    const { index } = loadedIndex();
    expect(sortedIds(index.searchRect({ minX: 80, minY: 105, maxX: 95, maxY: 115 }))).toEqual([
      'f',
      'f-a',
    ]);
    expect(sortedIds(index.searchPoint({ x: 60, y: 155 }))).toEqual(['f', 'g-b']);
    expect(index.searchPoint({ x: 1000, y: 1000 })).toEqual([]);
  });

  it('moves every descendant when an ancestor moves, though only the ancestor is listed', () => {
    const { index, document } = loadedIndex();
    document.update('f', { x: 200 });
    const refreshed = index.apply(document.takeChanges());
    expect(sortedIds([...refreshed.keys()])).toEqual(['f', 'f-a', 'g', 'g-b']);
    expect(refreshed.get('g' as ObjectId)).toEqual({ previous: undefined, next: undefined });
    const moved = refreshed.get('f-a' as ObjectId);
    expect(moved?.previous?.minX).toBeCloseTo(90, 9);
    expect(moved?.next?.minX).toBeCloseTo(190, 9);
    expectBox(index, 'f-a', [190, 110, 200, 120]);
    expectBox(index, 'g-b', [150, 150, 170, 160]);
    expect(index.searchPoint({ x: 60, y: 155 })).toEqual([]);
  });

  it('turns the descendants of a rotated group with it', () => {
    const { index, document } = loadedIndex();
    // The group is now at the frame's rotation (90°): g-b's local (u, v) lands at
    // (50 − v, 150 + u), so its 20 × 10 box becomes x 40..50, y 150..170.
    document.update('g', { rotation: 0 });
    index.apply(document.takeChanges());
    expectBox(index, 'g-b', [40, 150, 50, 170]);
  });

  it('follows reparenting into another frame', () => {
    const { index, document } = loadedIndex();
    document.update('r', { parentId: 'f' as ObjectId, x: 0, y: 0, rotation: 0 });
    document.update('f', { y: 0 });
    index.apply(document.takeChanges());
    expectBox(index, 'r', [90, 0, 100, 10]);
    document.update('f', { x: 0 });
    index.apply(document.takeChanges());
    expectBox(index, 'r', [-10, 0, 0, 10]);
  });

  it('removes deleted objects and re-roots the children of a deleted parent', () => {
    const { index, document } = loadedIndex();
    document.delete('g');
    index.apply(document.takeChanges());
    // g-b's parent is gone, so it is placed as if at the root: x 0..20, y 0..10.
    expectBox(index, 'g-b', [0, 0, 20, 10]);
    document.delete('g-b', 'far');
    const refreshed = index.apply(document.takeChanges());
    expect(refreshed.get('far' as ObjectId)).toEqual({
      previous: { minX: 5000, minY: 5000, maxX: 5010, maxY: 5010 },
      next: undefined,
    });
    expect(index.size).toBe(3);
    expect(index.boundsOf('far' as ObjectId)).toBeUndefined();
  });

  it('adds later objects one by one after the first load', () => {
    const { index, document } = loadedIndex();
    for (let n = 0; n < 50; n += 1) {
      document.create(shapeObject(`extra-${String(n)}`, { x: n * 20, y: -100 }));
    }
    index.apply(document.takeChanges());
    expect(index.size).toBe(55);
    expect(index.searchRect({ minX: 0, minY: -100, maxX: 1000, maxY: -95 })).toHaveLength(50);
    expect(index.validate()).toEqual([]);
    expect(index.bounds).toEqual({ minX: 0, minY: -100, maxX: 5010, maxY: 5010 });
  });

  it('swaps a whole board for another at once, as a page switch does', () => {
    const { index, document } = loadedIndex();
    document.delete('f', 'f-a', 'g', 'g-b', 'r', 'far');
    for (let n = 0; n < 200; n += 1) {
      document.create(
        shapeObject(`next-${String(n)}`, { x: (n % 20) * 20, y: Math.floor(n / 20) * 20 }),
      );
    }
    const refreshed = index.apply(document.takeChanges());
    expect(index.size).toBe(200);
    expect(refreshed.get('f' as ObjectId)).toEqual({
      previous: { minX: 0, minY: 100, maxX: 100, maxY: 200 },
      next: undefined,
    });
    expect(refreshed.get('next-0' as ObjectId)?.previous).toBeUndefined();
    expect(index.boundsOf('far' as ObjectId)).toBeUndefined();
    expect(index.searchRect({ minX: 0, minY: 0, maxX: 15, maxY: 15 })).toEqual(['next-0']);
    expect(index.validate()).toEqual([]);
  });

  it('reports a recolour as refreshed without moving anything', () => {
    const { index, document } = loadedIndex();
    document.update('far', { fill: [0, 1, 0, 1] });
    const refreshed = index.apply(document.takeChanges());
    expect([...refreshed.keys()]).toEqual(['far']);
    expectBox(index, 'far', [5000, 5000, 5010, 5010]);
  });

  it('does not mutate the objects it reads', () => {
    const document = new FakeSceneDocument();
    const board = nestedBoard().map((object) => Object.freeze(object));
    document.create(...board);
    expect(() => new SceneSpatialIndex().apply(document.takeChanges())).not.toThrow();
  });
});
