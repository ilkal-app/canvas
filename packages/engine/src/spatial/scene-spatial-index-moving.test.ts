import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { SceneSpatialIndex } from './scene-spatial-index.js';

const id = (value: string): ObjectId => value as ObjectId;

/**
 * An index of a moving shape and a static one, with `moving` in the moving set.
 *
 * @returns The index and its document.
 */
function movingIndex(): { index: SceneSpatialIndex; document: FakeSceneDocument } {
  const document = new FakeSceneDocument();
  document.create(shapeObject('moving', { x: 0, y: 0 }), shapeObject('still', { x: 200, y: 0 }));
  const index = new SceneSpatialIndex();
  index.apply(document.takeChanges());
  index.beginMoving([id('moving')], new Float64Array([0, 0]));
  return { index, document };
}

describe('SceneSpatialIndex moving set', () => {
  it('answers queries for moving boxes and keeps them out of the tree until the end', () => {
    const { index } = movingIndex();
    const revision = index.drawingBoundsRevision;
    expect(index.size).toBe(2);
    expect(index.isMoving(id('moving'))).toBe(true);
    index.moveMoving(new Float64Array([50, 50]));
    expect(index.searchPoint({ x: 55, y: 55 })).toEqual([id('moving')]);
    expect(index.searchPoint({ x: 5, y: 5 })).toEqual([]);
    expect(index.bounds?.minY).toBe(0);
    expect(index.bounds?.maxY).toBeGreaterThan(50);
    expect(index.boundsWithoutDrawingOf(id('moving'))).toEqual(index.boundsOf(id('moving')));
    // The static shape stays in the tree, so the end packs the moving one into a non-empty tree.
    index.endMoving();
    expect(index.isMoving(id('moving'))).toBe(false);
    expect(index.movingCount).toBe(0);
    expect(index.searchPoint({ x: 55, y: 55 })).toEqual([id('moving')]);
    expect(index.validate()).toEqual([]);
    expect(index.drawingBoundsRevision).toBe(revision + 1);
    // A second end does nothing.
    index.endMoving();
    expect(index.drawingBoundsRevision).toBe(revision + 1);
  });

  it('keeps a moving text’s drawing bounds with it, for the tree to take at the end', () => {
    const { index } = movingIndex();
    const drawing = { minX: 0, minY: -30, maxX: 10, maxY: 0 };
    expect(index.setDrawingBounds(id('moving'), drawing).next?.minY).toBe(-30);
    expect(index.searchPoint({ x: 5, y: -20 })).toEqual([id('moving')]);
    expect(index.setDrawingBounds(id('moving'), undefined).next?.minY).toBe(0);
    index.setDrawingBounds(id('moving'), drawing);
    index.endMoving();
    expect(index.searchPoint({ x: 5, y: -20 })).toEqual([id('moving')]);
  });

  it('ends the moving set when a change set lists a moving object', () => {
    const { index, document } = movingIndex();
    index.moveMoving(new Float64Array([50, 50]));
    document.update(id('moving'), { x: 300, y: 300 });
    index.apply(document.takeChanges());
    expect(index.movingCount).toBe(0);
    expect(index.isMoving(id('moving'))).toBe(false);
    expect(index.searchPoint({ x: 305, y: 305 })).toEqual([id('moving')]);
    expect(index.validate()).toEqual([]);
  });

  it('leaves the moving set alone for a change set that lists other objects', () => {
    const { index, document } = movingIndex();
    document.update(id('still'), { x: 400 });
    index.apply(document.takeChanges());
    expect(index.isMoving(id('moving'))).toBe(true);
  });
});
