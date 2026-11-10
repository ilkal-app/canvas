import { describe, expect, it } from 'vitest';

import type { Gradient, Shadow } from '@canvas/schema';

import { frameObject, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { stickyObject } from '../scene/segments/__fixtures__/note-and-text-passes.js';
import type { WorldTransform } from '../scene/world-transform.js';

import { SHAPE_INSTANCE_FLOATS } from './shape-instance-layout.js';
import {
  drawnShadowOf,
  readShadow,
  SHADOW_SOFTNESS_PER_BLUR,
  shadowMarginOf,
  shadowPlacementOf,
  shadowSilhouetteOf,
  writeObjectShadowRecord,
  writeShadowRecord,
  type ShadowSilhouette,
} from './shape-shadow.js';

const SHADOW: Shadow = { x: 3, y: 4, blur: 10, spread: 2, color: [0.1, 0.2, 0.3, 0.5] };
const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 } as const;
const BOX: ShadowSilhouette = {
  width: 100,
  height: 50,
  kindCode: 0,
  radius: 8,
  sides: 4,
  outlineWidth: 0,
  outlineOutside: 0,
  outset: 0,
};
const GRADIENT: Gradient = {
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: [1, 0, 0, 1] },
    { offset: 1, color: [0, 0, 1, 1] },
  ],
};

/**
 * A shadow record written for a silhouette.
 *
 * @param shadow - The shadow.
 * @param silhouette - What casts it.
 * @param transform - The object's transform.
 * @returns The record's floats.
 */
function recordOf(
  shadow: Shadow,
  silhouette: ShadowSilhouette,
  transform: WorldTransform = IDENTITY,
): number[] {
  const record = new Float32Array(SHAPE_INSTANCE_FLOATS);
  writeShadowRecord(record, shadow, silhouette, transform);
  return Array.from(record);
}

describe('readShadow', () => {
  it('reads a valid shadow, and none for absent, null, refused or transparent ones', () => {
    expect(readShadow(SHADOW)).toBe(SHADOW);
    expect(readShadow(undefined)).toBeUndefined();
    expect(readShadow(null)).toBeUndefined();
    expect(readShadow('soft')).toBeUndefined();
    expect(readShadow({ ...SHADOW, blur: -1 })).toBeUndefined();
    expect(readShadow({ ...SHADOW, color: 'ink' })).toBeUndefined();
    expect(readShadow({ ...SHADOW, color: [0, 0, 0, 0] })).toBeUndefined();
  });

  it('reads a list of layers as its lowest, and a refused list as none', () => {
    const top: Shadow = { ...SHADOW, y: 1, blur: 2 };
    expect(readShadow([SHADOW, top])).toEqual(SHADOW);
    expect(readShadow([])).toBeUndefined();
    expect(readShadow([SHADOW, { ...SHADOW, blur: -1 }])).toBeUndefined();
  });

  it('judges a value once and gives the same answer again', () => {
    const refused = { ...SHADOW, x: Number.NaN };
    expect(readShadow(refused)).toBeUndefined();
    expect(readShadow(refused)).toBeUndefined();
    const valid = { ...SHADOW };
    expect(readShadow(valid)).toBe(valid);
    expect(readShadow(valid)).toBe(valid);
  });
});

describe('shadowMarginOf', () => {
  it('is the offset’s length, the positive spread and the soft edge', () => {
    expect(shadowMarginOf(SHADOW)).toBeCloseTo(5 + 2 + SHADOW_SOFTNESS_PER_BLUR * 10, 10);
    expect(shadowMarginOf({ ...SHADOW, spread: -20 })).toBeCloseTo(
      5 + SHADOW_SOFTNESS_PER_BLUR * 10,
      10,
    );
    expect(shadowMarginOf({ ...SHADOW, x: 0, y: 0, blur: 0, spread: 0 })).toBe(0);
  });
});

describe('writeShadowRecord', () => {
  it('writes the box moved and grown, a grown radius, the soft edge and the colour as fill', () => {
    expect(recordOf(SHADOW, BOX)).toEqual(
      Array.from(
        new Float32Array([
          1,
          2,
          104,
          54,
          0.1,
          0.2,
          0.3,
          0.5,
          10,
          SHADOW_SOFTNESS_PER_BLUR * 10,
          0,
          1,
          0,
          0,
          0,
          0,
          0,
          0,
          4,
          0,
        ]),
      ),
    );
  });

  it('keeps a sharp corner sharp, and clamps a radius shrunk by a negative spread at 0', () => {
    expect(recordOf(SHADOW, { ...BOX, radius: 0 })[8]).toBe(0);
    expect(recordOf({ ...SHADOW, spread: -10 }, BOX)[8]).toBe(0);
    expect(recordOf({ ...SHADOW, spread: -3 }, BOX)[8]).toBe(5);
  });

  it('casts a hollow silhouette’s ring: the colour on the band, widened by the spread', () => {
    const record = recordOf(SHADOW, { ...BOX, outlineWidth: 3 });
    expect(record.slice(4, 8)).toEqual([0, 0, 0, 0]);
    expect(record.slice(13, 18)).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3, 0.5, 7])));
  });

  it('leaves the record clear when the spread shrinks the box or the ring to nothing', () => {
    const clear = new Array<number>(SHAPE_INSTANCE_FLOATS).fill(0);
    expect(recordOf({ ...SHADOW, spread: -25 }, BOX)).toEqual(clear);
    expect(recordOf({ ...SHADOW, spread: -2 }, { ...BOX, outlineWidth: 4 })).toEqual(clear);
  });

  it('turns with the object: the offset is in its frame, placed as shadowPlacementOf says', () => {
    const transform = { cos: 0, sin: 1, x: 40, y: 30 };
    const record = recordOf(SHADOW, BOX, transform);
    const placement = shadowPlacementOf(SHADOW, BOX, transform);
    // The box's local corner (1, 2) turned a quarter: (−2, 1) from the object's origin.
    expect(placement).toEqual({ x: 38, y: 31, cos: 0, sin: 1 });
    expect(record.slice(0, 2)).toEqual([38, 31]);
    expect(record.slice(11, 13)).toEqual([0, 1]);
  });
});

describe('shadows of aligned outlines', () => {
  const stroke = { color: [0, 0, 0, 1] as [number, number, number, number], width: 4 };

  it('grows a filled silhouette by its outline’s part outside the edge', () => {
    for (const [strokeAlign, outset] of [
      ['inside', 0],
      ['center', 2],
      ['outside', 4],
    ] as const) {
      const shape = shapeObject('s', { cornerRadius: 6, stroke, strokeAlign, shadow: SHADOW });
      expect(shadowSilhouetteOf(shape)).toMatchObject({ outset, outlineWidth: 0 });
      const frame = frameObject('f', { stroke, strokeAlign, shadow: SHADOW });
      expect(shadowSilhouetteOf(frame)).toMatchObject({ outset, outlineWidth: 0 });
    }
    // An outline that paints nothing grows nothing.
    const clear = { ...stroke, color: [0, 0, 0, 0] as [number, number, number, number] };
    const unseen = shapeObject('s', { stroke: clear, strokeAlign: 'outside', shadow: SHADOW });
    expect(shadowSilhouetteOf(unseen)).toMatchObject({ outset: 0 });
    // Grown by the spread and the outset: box, origin and a rounded corner's radius.
    const record = recordOf(SHADOW, { ...BOX, outset: 4 });
    expect(record.slice(0, 4)).toEqual([3 - 6, 4 - 6, 112, 62]);
    expect(record[8]).toBe(14);
    expect(record[19]).toBe(0);
  });

  it('keeps a hollow silhouette’s band where the outline lies, widened by the spread', () => {
    const hollow = (strokeAlign: 'inside' | 'center' | 'outside'): ShadowSilhouette => {
      const silhouette = shadowSilhouetteOf(
        shapeObject('s', { fill: null, stroke, strokeAlign, shadow: SHADOW }),
      );
      if (silhouette === undefined) throw new Error('No silhouette');
      return silhouette;
    };
    expect(hollow('outside')).toMatchObject({ outlineWidth: 4, outlineOutside: 1, outset: 0 });
    // The band spans [edge − inside − spread, edge + outside + spread] of the moved box.
    for (const [align, fraction] of [
      ['inside', 0],
      ['center', 0.5],
      ['outside', 1],
    ] as const) {
      const silhouette = { ...BOX, outlineWidth: 4, outlineOutside: fraction };
      expect(hollow(align).outlineOutside).toBe(fraction);
      const record = recordOf(SHADOW, silhouette);
      const grow = (record[2] ?? 0) / 2 - 50;
      const band = record[17] ?? 0;
      const outsideReach = grow + band * (record[19] ?? 0);
      const insideReach = band * (1 - (record[19] ?? 0)) - grow;
      expect(band).toBe(8);
      expect(outsideReach).toBeCloseTo(4 * fraction + 2, 5);
      expect(insideReach).toBeCloseTo(4 * (1 - fraction) + 2, 5);
    }
  });

  it('gives a frame painted by its outline alone a ring, and places it as written', () => {
    const frame = frameObject('f', {
      width: 30,
      height: 20,
      background: null,
      stroke,
      strokeAlign: 'center',
      shadow: SHADOW,
    });
    expect(drawnShadowOf(frame)).toBe(SHADOW);
    const silhouette = shadowSilhouetteOf(frame);
    expect(silhouette).toMatchObject({ outlineWidth: 4, outlineOutside: 0.5, outset: 0 });
    if (silhouette === undefined) throw new Error('No silhouette');
    const record = recordOf(SHADOW, silhouette);
    expect(record.slice(0, 2)).toEqual([3, 4]);
    expect(shadowPlacementOf(SHADOW, silhouette, IDENTITY)).toMatchObject({ x: 3, y: 4 });
    const bare = frameObject('f', { background: null, stroke: null, shadow: SHADOW });
    expect(drawnShadowOf(bare)).toBeUndefined();
  });
});

describe('drawnShadowOf and shadowSilhouetteOf', () => {
  it('gives a painted shape’s shadow, a gradient-filled one’s and an outline-only one’s', () => {
    expect(drawnShadowOf(shapeObject('s', { shadow: SHADOW }))).toBe(SHADOW);
    expect(drawnShadowOf(shapeObject('s', { fill: GRADIENT, shadow: SHADOW }))).toBe(SHADOW);
    const stroke = { color: [0, 0, 0, 1] as [number, number, number, number], width: 2 };
    expect(drawnShadowOf(shapeObject('s', { fill: null, stroke, shadow: SHADOW }))).toBe(SHADOW);
  });

  it('gives none for a shape or frame that paints nothing, or another type', () => {
    expect(drawnShadowOf(shapeObject('s', { fill: null, shadow: SHADOW }))).toBeUndefined();
    expect(drawnShadowOf(shapeObject('s'))).toBeUndefined();
    expect(drawnShadowOf(frameObject('f', { background: null, shadow: SHADOW }))).toBeUndefined();
    expect(drawnShadowOf(frameObject('f', { shadow: SHADOW }))).toBe(SHADOW);
    expect(drawnShadowOf(frameObject('f', { background: GRADIENT, shadow: SHADOW }))).toBe(SHADOW);
    expect(drawnShadowOf(stickyObject('n'))).toBeUndefined();
  });

  it('casts a frame’s sharp box, a shape’s kind, radius and sides, and a hollow shape’s band', () => {
    expect(shadowSilhouetteOf(frameObject('f', { width: 30, height: 20 }))).toEqual({
      width: 30,
      height: 20,
      kindCode: 0,
      radius: 0,
      sides: 0,
      outlineWidth: 0,
      outlineOutside: 0,
      outset: 0,
    });
    const star = shapeObject('s', { kind: 'star', sides: 5, cornerRadius: 4 });
    expect(shadowSilhouetteOf(star)).toMatchObject({ kindCode: 4, radius: 0, sides: 5 });
    const rounded = shapeObject('s', { cornerRadius: 6 });
    expect(shadowSilhouetteOf(rounded)).toMatchObject({ kindCode: 0, radius: 6, outlineWidth: 0 });
    const stroke = { color: [0, 0, 0, 1] as [number, number, number, number], width: 3 };
    const hollow = shapeObject('s', { fill: null, stroke });
    expect(shadowSilhouetteOf(hollow)).toMatchObject({ outlineWidth: 3 });
    const bare = shapeObject('s', { fill: null, stroke: null });
    expect(shadowSilhouetteOf(bare)).toMatchObject({ outlineWidth: 0 });
    expect(shadowSilhouetteOf(stickyObject('n'))).toBeUndefined();
  });

  it('writes an object’s record only when it draws a shadow, without mutating it', () => {
    const shape = shapeObject('s', { width: 100, height: 50, cornerRadius: 8, shadow: SHADOW });
    const before = structuredClone(shape);
    const record = new Float32Array(SHAPE_INSTANCE_FLOATS);
    writeObjectShadowRecord(record, shape, IDENTITY);
    expect(Array.from(record)).toEqual(recordOf(SHADOW, BOX));
    expect(shape).toEqual(before);
    const none = new Float32Array(SHAPE_INSTANCE_FLOATS);
    writeObjectShadowRecord(none, shapeObject('s'), IDENTITY);
    writeObjectShadowRecord(none, stickyObject('n'), IDENTITY);
    expect(none.every((value) => value === 0)).toBe(true);
  });
});
