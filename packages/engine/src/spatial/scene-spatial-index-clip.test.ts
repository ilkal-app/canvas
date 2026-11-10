import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';

import { SceneSpatialIndex } from './scene-spatial-index.js';

function indexOf(...objects: BoardObject[]): {
  index: SceneSpatialIndex;
  document: FakeSceneDocument;
} {
  const document = new FakeSceneDocument();
  document.create(...objects);
  const index = new SceneSpatialIndex();
  index.apply(document.takeChanges());
  return { index, document };
}

function expectBox(actual: WorldBounds | undefined, expected: readonly number[]): void {
  expect(actual).toBeDefined();
  const values = [actual?.minX, actual?.minY, actual?.maxX, actual?.maxY];
  values.forEach((value, axis) => {
    expect(value).toBeCloseTo(expected[axis] ?? Number.NaN, 9);
  });
}

const id = (value: string): ObjectId => value as ObjectId;

/**
 * A clipping frame "p" over [0, 100]² with a child "s" overflowing its right edge.
 *
 * @returns The objects.
 */
function clippedBoard(): BoardObject[] {
  return [
    frameObject('p', { clip: true }),
    shapeObject('s', { parentId: 'p', x: 80, y: 10, width: 40, height: 10 }),
  ];
}

describe('SceneSpatialIndex clipping', () => {
  it('indexes what a clipping frame leaves of a child, and the frame whole', () => {
    const { index } = indexOf(...clippedBoard());
    expectBox(index.boundsOf(id('s')), [80, 10, 100, 20]);
    expectBox(index.boundsOf(id('p')), [0, 0, 100, 100]);
    expect(index.searchPoint({ x: 110, y: 15 })).toEqual([]);
    expect(index.validate()).toEqual([]);
  });

  it('leaves a fully clipped child out of the index and counts it', () => {
    const { index, document } = indexOf(
      ...clippedBoard(),
      shapeObject('out', { parentId: 'p', x: 150, y: 10 }),
    );
    expect(index.boundsOf(id('out'))).toBeUndefined();
    expect(index.size).toBe(2);
    expect(index.clippedAwayCount).toBe(1);
    expect(index.isClippedAway(id('out'))).toBe(true);
    expect(index.isClippedAway(id('s'))).toBe(false);
    document.delete('out');
    index.apply(document.takeChanges());
    expect(index.clippedAwayCount).toBe(0);
  });

  it('cuts a turned child by its turned box, not its bounding box', () => {
    // A 20 × 20 square turned 45° whose bounding box overlaps the frame's corner at (100, 100)
    // while the diamond itself stays outside it.
    const { index } = indexOf(
      frameObject('p', { clip: true }),
      shapeObject('d', {
        parentId: 'p',
        x: 112,
        y: 112 - 10 * Math.SQRT2,
        width: 20,
        height: 20,
        rotation: Math.PI / 4,
      }),
    );
    expect(index.boundsOf(id('d'))).toBeUndefined();
    expect(index.isClippedAway(id('d'))).toBe(true);
  });

  it('cuts by a turned clipping frame exactly', () => {
    // The frame turned 90°: its box covers world x −100..0, y 0..100.
    const { index } = indexOf(
      frameObject('p', { clip: true, rotation: Math.PI / 2 }),
      shapeObject('s', { parentId: 'p', x: 90, y: 0, width: 40, height: 10 }),
    );
    // Local x 90..100 survives: world y 90..100, x −10..0.
    expectBox(index.boundsOf(id('s')), [-10, 90, 0, 100]);
  });

  it('intersects nested clips and clips a nested frame by its parent, not itself', () => {
    const { index } = indexOf(
      frameObject('p', { clip: true }),
      frameObject('q', { parentId: 'p', x: 50, y: 50, clip: true }),
      shapeObject('leaf', { parentId: 'q', x: 30, y: 30, width: 40, height: 40 }),
    );
    expectBox(index.boundsOf(id('q')), [50, 50, 100, 100]);
    expectBox(index.boundsOf(id('leaf')), [80, 80, 100, 100]);
  });

  it('passes clips through groups', () => {
    const { index } = indexOf(
      frameObject('p', { clip: true }),
      groupObject('g', { parentId: 'p', x: 50, y: 0 }),
      shapeObject('s', { parentId: 'g', x: 40, y: 0, width: 30, height: 10 }),
    );
    expectBox(index.boundsOf(id('s')), [90, 0, 100, 10]);
  });

  it('keeps the innermost eight clips, as the shaders do', () => {
    const frames = Array.from({ length: 9 }, (unused, level) =>
      frameObject(`f${String(level)}`, {
        parentId: level === 0 ? null : `f${String(level - 1)}`,
        width: level === 0 ? 50 : 1000,
        height: level === 0 ? 50 : 1000,
        clip: true,
      }),
    );
    const { index } = indexOf(...frames, shapeObject('leaf', { parentId: 'f8', x: 100, y: 100 }));
    // f0 is the ninth clip out from the leaf, so it does not cut the leaf; it does cut f1.
    expectBox(index.boundsOf(id('leaf')), [100, 100, 110, 110]);
    expectBox(index.boundsOf(id('f1')), [0, 0, 50, 50]);
  });

  it('re-clips descendants when the frame stops clipping, resizes or moves', () => {
    const { index, document } = indexOf(...clippedBoard());
    document.update('p', { width: 85 });
    expect(index.apply(document.takeChanges()).get(id('s'))?.next?.maxX).toBeCloseTo(85, 9);
    document.update('p', { clip: false });
    index.apply(document.takeChanges());
    expectBox(index.boundsOf(id('s')), [80, 10, 120, 20]);
    document.update('p', { clip: true, width: 100, x: 500 });
    index.apply(document.takeChanges());
    expectBox(index.boundsOf(id('s')), [580, 10, 600, 20]);
  });

  it('re-clips a child that moves or is reparented', () => {
    const { index, document } = indexOf(...clippedBoard());
    document.update('s', { x: 200 });
    const moved = index.apply(document.takeChanges()).get(id('s'));
    expect(moved?.previous).toBeDefined();
    expect(moved?.next).toBeUndefined();
    expect(index.clippedAwayCount).toBe(1);
    document.update('s', { parentId: null });
    index.apply(document.takeChanges());
    expectBox(index.boundsOf(id('s')), [200, 10, 240, 20]);
    expect(index.clippedAwayCount).toBe(0);
  });

  it('clips drawing bounds by the same chain, so label overflow is cut', () => {
    const { index } = indexOf(
      frameObject('p', { clip: true }),
      shapeObject('s', { parentId: 'p', x: 10, y: 10 }),
    );
    const change = index.setDrawingBounds(id('s'), { minX: 5, minY: 90, maxX: 200, maxY: 120 });
    expectBox(change.next, [5, 10, 100, 100]);
    expectBox(index.boundsOf(id('s')), [5, 10, 100, 100]);
    expect(index.drawingBoundsRevision).toBe(1);
    index.setDrawingBounds(id('s'), undefined);
    expectBox(index.boundsOf(id('s')), [10, 10, 20, 20]);
  });

  it('reads a box without its drawing bounds, clipped as the box is', () => {
    const { index } = indexOf(
      frameObject('p', { clip: true }),
      shapeObject('s', { parentId: 'p', x: 95, y: 10 }),
    );
    expect(index.boundsWithoutDrawingOf(id('missing'))).toBeUndefined();
    expectBox(index.boundsWithoutDrawingOf(id('s')), [95, 10, 100, 20]);
    index.setDrawingBounds(id('s'), { minX: 5, minY: 90, maxX: 200, maxY: 120 });
    expectBox(index.boundsOf(id('s')), [5, 10, 100, 100]);
    expectBox(index.boundsWithoutDrawingOf(id('s')), [95, 10, 100, 20]);
  });

  it('indexes a clipped-away object whose drawing reaches into the clip, and drops it again', () => {
    const { index } = indexOf(
      frameObject('p', { clip: true }),
      shapeObject('s', { parentId: 'p', x: 150, y: 10 }),
    );
    const change = index.setDrawingBounds(id('s'), { minX: 90, minY: 10, maxX: 160, maxY: 20 });
    expect(change.previous).toBeUndefined();
    expectBox(index.boundsOf(id('s')), [90, 10, 100, 20]);
    expect(index.clippedAwayCount).toBe(0);
    const removed = index.setDrawingBounds(id('s'), undefined);
    expect(removed.next).toBeUndefined();
    expect(index.boundsOf(id('s'))).toBeUndefined();
    expect(index.clippedAwayCount).toBe(1);
    expect(index.validate()).toEqual([]);
  });

  it("clips a nested frame's title by its ancestors only", () => {
    const { index } = indexOf(
      frameObject('p', { clip: true }),
      frameObject('q', { parentId: 'p', x: 10, y: 10, width: 50, height: 50, clip: true }),
      frameObject('top', { x: 300, y: 300, clip: true }),
    );
    index.setDrawingBounds(id('q'), { minX: 10, minY: -14, maxX: 60, maxY: 10 });
    expectBox(index.boundsOf(id('q')), [10, 0, 60, 60]);
    index.setDrawingBounds(id('top'), { minX: 300, minY: 276, maxX: 400, maxY: 300 });
    expectBox(index.boundsOf(id('top')), [300, 276, 400, 400]);
  });

  it('keeps staged drawing bounds clipped when the change set is applied', () => {
    const document = new FakeSceneDocument();
    document.create(...clippedBoard());
    const index = new SceneSpatialIndex();
    index.setDrawingBounds(id('s'), { minX: 80, minY: 10, maxX: 300, maxY: 30 }, false);
    index.apply(document.takeChanges());
    expectBox(index.boundsOf(id('s')), [80, 10, 100, 30]);
  });
});
