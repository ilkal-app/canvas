import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { FakeSceneDocument, frameObject } from '../scene/__fixtures__/scene-objects.js';

import { clipCoverageAt, isInsideClipChain, type ClipRect } from './clip-chain.js';
import { cornerRadiusAt, isInsideFrameShape, roundedFrameDistance } from './frame-hit.js';
import { hitPoint } from './hit-point.js';
import { worldBoundsOf } from './object-world-bounds.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';

// A rounded frame's hit area, bounds and clip, as the shaders draw them.

const SIZE = { width: 100, height: 80 };

function rect(fields: Partial<ClipRect> = {}): ClipRect {
  return { id: 'c' as ObjectId, x: 0, y: 0, cos: 1, sin: 0, ...SIZE, ...fields };
}

function indexed(...objects: BoardObject[]) {
  const document = new FakeSceneDocument();
  document.create(...objects);
  const index = new SceneSpatialIndex();
  index.apply(document.takeChanges());
  return { document, index };
}

describe('frame corner distance', () => {
  it('picks the radius of the quadrant a point lies in', () => {
    const radii = [1, 2, 3, 4] as const;
    expect(cornerRadiusAt({ x: -1, y: -1 }, radii)).toBe(1);
    expect(cornerRadiusAt({ x: 1, y: -1 }, radii)).toBe(2);
    expect(cornerRadiusAt({ x: 1, y: 1 }, radii)).toBe(3);
    expect(cornerRadiusAt({ x: -1, y: 1 }, radii)).toBe(4);
  });

  it('is negative inside, positive in a rounded corner, and grows with an outline', () => {
    const radii = [20, 0, 0, 0] as const;
    expect(roundedFrameDistance({ x: 50, y: 40 }, SIZE, radii, 0)).toBeLessThan(0);
    expect(roundedFrameDistance({ x: 1, y: 1 }, SIZE, radii, 0)).toBeGreaterThan(0);
    // The sharp top-right corner stays sharp; grown by 2 it reaches (102, -2).
    expect(roundedFrameDistance({ x: 99.5, y: 0.5 }, SIZE, radii, 0)).toBeLessThan(0);
    expect(roundedFrameDistance({ x: 102, y: -2 }, SIZE, radii, 2)).toBeCloseTo(0);
    // The rounded corner's radius grows with it: 22 about (20, 20).
    expect(
      roundedFrameDistance(
        { x: 20 - 22 * Math.SQRT1_2, y: 20 - 22 * Math.SQRT1_2 },
        SIZE,
        radii,
        2,
      ),
    ).toBeCloseTo(0);
  });
});

describe('isInsideFrameShape', () => {
  it('is the box, grown by an outline, for a sharp frame and leaves out rounded corners', () => {
    const sharp = frameObject('s', SIZE);
    expect(isInsideFrameShape(sharp, { x: 0, y: 80 })).toBe(true);
    expect(isInsideFrameShape(sharp, { x: -1, y: 40 })).toBe(false);
    expect(isInsideFrameShape(sharp, { x: -1, y: 81 }, 2)).toBe(true);
    const rounded = frameObject('r', { ...SIZE, cornerRadius: 30 });
    expect(isInsideFrameShape(rounded, { x: 1, y: 1 })).toBe(false);
    expect(isInsideFrameShape(rounded, { x: 50, y: 40 })).toBe(true);
  });
});

describe('rounded frame hit testing', () => {
  it('counts an outline outside the edge, around the rounded corner', () => {
    const stroke = { color: [0, 0, 0, 1] as [number, number, number, number], width: 8 };
    const { document, index } = indexed(
      frameObject('f', { ...SIZE, cornerRadius: 30, stroke, strokeAlign: 'outside' }),
    );
    const options = { zoom: 1, tolerancePx: 0 };
    expect(hitPoint(index, document, { x: 50, y: -6 }, options)).toEqual(['f']);
    expect(hitPoint(index, document, { x: -3, y: -3 }, options)).toEqual([]);
  });
});

describe('rounded frame world bounds', () => {
  it('bounds a turned frame by its corner circles, each corner its own', () => {
    const transform = { x: 0, y: 0, cos: Math.SQRT1_2, sin: Math.SQRT1_2 };
    const frame = frameObject('f', { width: 100, height: 100, cornerRadius: [50, 0, 50, 0] });
    const bounds = worldBoundsOf(frame, transform);
    // The sharp corners at (100, 0) and (0, 100) reach ±70.7 in x; the rounded ones less.
    expect(bounds?.minX).toBeCloseTo(-100 * Math.SQRT1_2);
    expect(bounds?.maxX).toBeCloseTo(100 * Math.SQRT1_2);
    expect(bounds?.minY).toBeCloseTo(100 * Math.SQRT1_2 - 50);
    expect(bounds?.maxY).toBeCloseTo(100 * Math.SQRT1_2 + 50);
  });

  it('keeps an upright rounded frame’s bounds its box', () => {
    const frame = frameObject('f', { ...SIZE, cornerRadius: 30 });
    expect(worldBoundsOf(frame, { x: 5, y: 6, cos: 1, sin: 0 })).toEqual({
      minX: 5,
      minY: 6,
      maxX: 105,
      maxY: 86,
    });
  });
});

describe('rounded clips', () => {
  it('clips the rounded corner away and keeps a sharp clip as a box', () => {
    expect(isInsideClipChain({ x: 1, y: 1 }, [rect({ cornerRadius: 20 })])).toBe(false);
    expect(isInsideClipChain({ x: 1, y: 1 }, [rect()])).toBe(true);
    expect(isInsideClipChain({ x: 1, y: 1 }, [rect({ cornerRadius: 0 })])).toBe(true);
    expect(isInsideClipChain({ x: 99, y: 79 }, [rect({ cornerRadius: [20, 20, 0, 20] })])).toBe(
      true,
    );
  });

  it('rounds each corner by its own radius', () => {
    const chain = [rect({ cornerRadius: [10, 20, 30, 0] })];
    // Just inside each corner's square, outside its arc where it is rounded.
    expect(isInsideClipChain({ x: 2, y: 2 }, chain)).toBe(false);
    expect(isInsideClipChain({ x: 98, y: 2 }, chain)).toBe(false);
    expect(isInsideClipChain({ x: 97, y: 77 }, chain)).toBe(false);
    expect(isInsideClipChain({ x: 1, y: 79 }, chain)).toBe(true);
  });

  it('antialiases the rounded edge over one device pixel, as the shader does', () => {
    // On the arc of the top-left corner (radius 20 about (20, 20)): half covered.
    const onArc = { x: 20 - 20 * Math.SQRT1_2, y: 20 - 20 * Math.SQRT1_2 };
    expect(clipCoverageAt(onArc, [rect({ cornerRadius: [20, 0, 0, 0] })], 1)).toBeCloseTo(0.5);
    // A box's corner is a Chebyshev distance: the diagonal point half a pixel out is 0.
    expect(clipCoverageAt({ x: -0.5, y: -0.5 }, [rect()], 1)).toBe(0);
    // Turned with the frame: a quarter turn at (100, 0) puts the frame's (0, 0) there.
    const turned = rect({ x: 100, y: 0, cos: 0, sin: 1, cornerRadius: 20 });
    expect(isInsideClipChain({ x: 99, y: 1 }, [turned])).toBe(false);
    expect(isInsideClipChain({ x: 70, y: 30 }, [turned])).toBe(true);
  });
});
