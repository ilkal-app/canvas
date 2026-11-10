import { describe, expect, it } from 'vitest';

import { BOARD_BOUND } from '../fields/board-bound.js';
import type { ObjectId } from '../ids/object-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';

import { findValueLimitIssues } from './value-limits.js';

const B = BOARD_BOUND;

/**
 * The paths of an object's values past their limits.
 *
 * @param object - The object.
 * @returns The paths, dotted.
 */
function pathsOf(object: Parameters<typeof findValueLimitIssues>[0]): string[] {
  return findValueLimitIssues(object).map(({ path }) => path.join('.'));
}

describe('findValueLimitIssues', () => {
  it('finds nothing on values at their limits', () => {
    expect(pathsOf(sampleObject('shape', 's', { rotation: -B, cornerRadius: B }))).toEqual([]);
    const pinned = sampleObject('comment', 'c', {
      anchor: { kind: 'object', objectId: 's' as ObjectId, offset: { x: B, y: -B } },
    });
    expect(pathsOf(pinned)).toEqual([]);
  });

  it('finds a rotation, a corner radius and a pin offset past their limits', () => {
    expect(pathsOf(sampleObject('shape', 's', { rotation: 1e300, cornerRadius: B + 1 }))).toEqual([
      'rotation',
      'cornerRadius',
    ]);
    const pinned = sampleObject('comment', 'c', {
      anchor: { kind: 'object', objectId: 's' as ObjectId, offset: { x: 0, y: -1e300 } },
    });
    expect(findValueLimitIssues(pinned)).toEqual([
      {
        path: ['anchor', 'offset', 'y'],
        magnitude: 1e300,
        limit: B,
        message: `the pin is 1e+300, past its limit of ${String(B)}`,
      },
    ]);
  });

  it('finds an image’s natural size, and a whole source image behind its crop, past their limits', () => {
    const image = sampleObject('image', 'i');
    expect(pathsOf({ ...image, naturalSize: { width: 2 ** 31, height: 10 } })).toEqual([
      'naturalSize.width',
    ]);
    const box = { width: 1000, height: 1000, naturalSize: { width: 500, height: 500 } };
    // The box shows a 1e-7 part of the image each way: the whole image is 1e10 across.
    const tiny = { ...image, ...box, crop: { x: 0, y: 0, width: 1e-7, height: 1e-7 } };
    expect(pathsOf(tiny)).toEqual(['crop.width', 'crop.height']);
    const ordinary = { ...image, ...box, crop: { x: 0.25, y: 0, width: 0.5, height: 0.5 } };
    expect(pathsOf(ordinary)).toEqual([]);
  });
});
