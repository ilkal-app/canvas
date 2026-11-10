import { describe, expect, it } from 'vitest';

import type { ShapeObject, TextStyle } from '@canvas/schema';

import { shapeObject } from '../../scene/__fixtures__/scene-objects.js';
import { polygonDistance } from '../../shapes/shape-distance.js';

import {
  LABEL_PADDING,
  labelPaddingOf,
  shapeLabelBox,
  shapeLabelPlacement,
} from './shape-label-box.js';
import { textOriginOf, textPlacementOf } from './text-placement.js';

const STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

/**
 * A 200 × 100 shape of a kind, labelled `Hi`.
 *
 * @param kind - The kind.
 * @param overrides - Fields to change.
 * @returns The shape.
 */
function labelled(kind: ShapeObject['kind'], overrides: Partial<ShapeObject> = {}): ShapeObject {
  return shapeObject('s', {
    kind,
    width: 200,
    height: 100,
    label: { text: 'Hi', runs: [{ length: 2, style: STYLE }] },
    ...overrides,
  });
}

describe('shapeLabelBox', () => {
  it("is a sharp rectangle's whole box", () => {
    expect(shapeLabelBox(labelled('rectangle'))).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it("keeps a rounded rectangle's corners out of the box", () => {
    const inset = 20 * (1 - Math.SQRT1_2);
    const box = shapeLabelBox(labelled('rectangle', { cornerRadius: 20 }));
    expect(box.x).toBeCloseTo(inset, 9);
    expect(box.width).toBeCloseTo(200 - 2 * inset, 9);
  });

  it('is the largest rectangle inside an ellipse, 1/√2 of each axis, centred', () => {
    const box = shapeLabelBox(labelled('ellipse'));
    expect(box.width).toBeCloseTo(200 * Math.SQRT1_2, 9);
    expect(box.height).toBeCloseTo(100 * Math.SQRT1_2, 9);
    expect(box.x + box.width / 2).toBeCloseTo(100, 9);
    expect(box.y + box.height / 2).toBeCloseTo(50, 9);
  });

  it("is a diamond's 2:1 box in its inscribed circle, stretched as the diamond is", () => {
    // The unit rhombus's inradius is 1/√2; the 2:1 box in that circle is 2/√5 by 1/√5 of it.
    const box = shapeLabelBox(labelled('diamond'));
    expect(box.width).toBeCloseTo(200 * Math.SQRT1_2 * (2 / Math.sqrt(5)), 9);
    expect(box.height).toBeCloseTo(100 * Math.SQRT1_2 * (1 / Math.sqrt(5)), 9);
    expect(box.x + box.width / 2).toBeCloseTo(100, 9);
    expect(box.y + box.height / 2).toBeCloseTo(50, 9);
  });

  it('stays inside a triangle, a pentagon and a star: every corner of the box is inside', () => {
    for (const [kind, sides] of [
      ['polygon', 3],
      ['polygon', 5],
      ['star', 5],
      ['star', 12],
    ] as const) {
      const box = shapeLabelBox(labelled(kind, { sides }));
      expect(box.width).toBeGreaterThan(0);
      for (const [x, y] of [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x, box.y + box.height],
        [box.x + box.width, box.y + box.height],
      ] as const) {
        const local = { x: x - 100, y: y - 50 };
        expect(polygonDistance(local, { x: 100, y: 50 }, sides, kind === 'star')).toBeLessThan(
          1e-6,
        );
      }
    }
  });
});

describe('shapeLabelPlacement', () => {
  it("centres the label in the kind's box inside the padding, wrapping at its width", () => {
    const placement = shapeLabelPlacement(labelled('rectangle'));
    expect(placement.text).toBe('Hi');
    expect(placement.origin).toEqual({ x: LABEL_PADDING, y: LABEL_PADDING });
    expect(placement.wrapWidth).toBe(200 - 2 * LABEL_PADDING);
    expect(placement.boxHeight).toBe(100 - 2 * LABEL_PADDING);
    expect(placement.align).toBe('center');
    expect(placement.verticalAlign).toBe('middle');
  });

  it("keeps less padding in a small box: at most 15% of the box's shorter side", () => {
    expect(labelPaddingOf({ x: 0, y: 0, width: 200, height: 100 })).toBe(LABEL_PADDING);
    expect(labelPaddingOf({ x: 0, y: 0, width: 40, height: 20 })).toBeCloseTo(3, 12);
    const star = labelled('star', { width: 120, height: 90 });
    const box = shapeLabelBox(star);
    const padding = labelPaddingOf(box);
    expect(shapeLabelPlacement(star).wrapWidth).toBeCloseTo(box.width - 2 * padding, 9);
  });

  it('keeps a label taller than its box centred on it, overflowing equally above and below', () => {
    const placement = shapeLabelPlacement(labelled('rectangle'));
    expect(placement.isOverflowAligned).toBe(true);
    // The box is 84 tall inside the padding; 120 of text overflows it by 18 above and 18 below.
    expect(textOriginOf(placement, { height: 120 })).toEqual({ x: LABEL_PADDING, y: -10 });
    expect(textOriginOf(placement, { height: 20 })).toEqual({ x: LABEL_PADDING, y: 40 });
  });

  it('places an empty label for a shape without one, and never wraps below one unit', () => {
    const placement = shapeLabelPlacement(labelled('rectangle', { label: null, width: 0 }));
    expect(placement.text).toBe('');
    expect(placement.runs).toEqual([]);
    // A shape with no width has no room to pad: the wrap width's floor, the whole height.
    expect(placement.wrapWidth).toBe(1);
    expect(placement.boxHeight).toBe(100);
  });

  it('is what the text pass draws for a labelled shape, and nothing for one without', () => {
    expect(textPlacementOf(labelled('ellipse'))).toEqual(shapeLabelPlacement(labelled('ellipse')));
    expect(textPlacementOf(labelled('ellipse', { label: null }))).toBeUndefined();
  });
});
