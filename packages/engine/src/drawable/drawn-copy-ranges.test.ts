import { describe, expect, it } from 'vitest';

import { MAX_DRAWABLE_SIZE, type BoardObject, type ObjectId } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { stickyObject, textObject } from '../spatial/__fixtures__/spatial-objects.js';

import { ownUndrawableReason } from './drawable-fields.js';

/**
 * The object as an instance's virtual copy: the same fields under a virtual address.
 *
 * @param object - A stored object.
 * @returns Its copy.
 */
function copyOf<Type extends BoardObject>(object: Type): Type {
  return { ...object, id: `inst/${object.id}` as ObjectId };
}

/**
 * The object with its one run's style patched.
 *
 * @param object - A text or sticky.
 * @param style - The style fields to replace.
 * @returns The patched object.
 * @throws {Error} When the object holds no runs.
 */
function withRun(object: BoardObject, style: Record<string, unknown>): BoardObject {
  if (object.type !== 'text' && object.type !== 'sticky') throw new Error('not a text');
  return {
    ...object,
    runs: object.runs.map((run) => ({ ...run, style: { ...run.style, ...style } })),
  };
}

describe('drawn ranges of a scaled instance copy', () => {
  it('draws a copy whose stroke and font sizes are past the stored ranges', () => {
    const shape = { ...shapeObject('s'), stroke: { color: [0, 0, 0, 1], width: 1280 } };
    expect(ownUndrawableReason(shape as BoardObject)).toBe('out-of-range');
    expect(ownUndrawableReason(copyOf(shape as BoardObject))).toBeUndefined();
    for (const fontSize of [480, 1.2]) {
      const text = withRun(textObject('t'), {
        fontSize,
        letterSpacing: { unit: 'px', value: -8000 },
        lineHeight: { unit: 'px', value: 9600 },
      });
      expect(ownUndrawableReason(text)).toBe('out-of-range');
      expect(ownUndrawableReason(copyOf(text))).toBeUndefined();
    }
  });

  it('still refuses a copy whose lengths are not finite, not positive or past the drawable size', () => {
    const sticky = stickyObject('n');
    for (const style of [
      { fontSize: Number.NaN },
      { fontSize: 0 },
      { fontSize: MAX_DRAWABLE_SIZE * 2 },
      { lineHeight: { unit: 'px', value: -1 } },
      { letterSpacing: { unit: 'px', value: Number.POSITIVE_INFINITY } },
    ]) {
      expect(ownUndrawableReason(copyOf(withRun(sticky, style)))).toBeDefined();
    }
    const shape = { ...shapeObject('s'), stroke: { color: [0, 0, 0, 1], width: Number.NaN } };
    expect(ownUndrawableReason(copyOf(shape as BoardObject))).toBe('not-finite');
  });

  it('draws a nested instance copy whose composed scale leaves the stored range, not a stored one', () => {
    const nested = {
      id: 'nested' as ObjectId,
      type: 'instance',
      parentId: null,
      x: 0,
      y: 0,
      rotation: 0,
      z: 'a0',
      locked: false,
      createdBy: 'user:ada',
      createdAt: 1,
      updatedAt: 1,
      width: 10,
      height: 10,
      mainId: 'main' as ObjectId,
      overrides: {},
      scale: 0.0025,
    } as unknown as BoardObject;
    expect(ownUndrawableReason(nested)).toBe('out-of-range');
    expect(ownUndrawableReason(copyOf(nested))).toBeUndefined();
    expect(ownUndrawableReason(copyOf({ ...nested, scale: 0 } as BoardObject))).toBe(
      'out-of-range',
    );
  });

  it('keeps the stored ranges for everything else a copy holds', () => {
    const sticky = withRun(stickyObject('n'), {
      weight: 450,
      letterSpacing: { unit: 'percent', value: 900 },
    });
    expect(ownUndrawableReason(copyOf(sticky))).toBeDefined();
  });
});
