// PR 1: paintReason and the style judges admit image paints only at legal targets.
import { describe, expect, it } from 'vitest';

import { BOARD_BOUND } from '../fields/board-bound.js';
import type { Paint } from '../fields/paint.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { findValueLimitIssues } from '../rules/value-limits.js';

import { drawableValuesReason } from './drawable-values.js';
import { paintReason } from './paint-values.js';

const IMAGE = {
  type: 'image',
  assetId: 'asset-photo',
  naturalSize: { width: 1600, height: 900 },
  fit: 'crop',
  crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
} as const;

describe('image paint at the relay value door', () => {
  it.each(['fill', 'fit', 'crop', 'tile'])(
    'accepts fit %s on shape fill and frame background',
    (fit) => {
      const paint = { ...IMAGE, fit };
      expect(paintReason(paint)).toBeUndefined();
      expect(drawableValuesReason('style', { fill: paint })).toBeUndefined();
      expect(drawableValuesReason('style', { background: paint })).toBeUndefined();
    },
  );

  it.each([
    [{ ...IMAGE, assetId: 'bad id' }, 'assetId'],
    [{ ...IMAGE, naturalSize: { width: 0, height: 900 } }, 'naturalSize.width'],
    [{ ...IMAGE, naturalSize: { width: 1.5, height: 900 } }, 'naturalSize.width'],
    [{ ...IMAGE, crop: { x: 0.8, y: 0, width: 0.3, height: 1 } }, 'crop.width'],
    [{ ...IMAGE, fit: 'cover' }, 'fit'],
    [{ ...IMAGE, extra: true }, ''],
  ] as const)('refuses invalid paint %# at %s', (paint, field) => {
    expect(paintReason(paint)?.field).toBe(field);
    expect(drawableValuesReason('style', { fill: paint })?.field).toBe(
      field === '' ? 'fill' : `fill.${field}`,
    );
  });
});

describe('image paint value limits', () => {
  it('bounds natural size and the source area behind a tiny crop on shapes and frames', () => {
    const huge = {
      ...IMAGE,
      naturalSize: { width: BOARD_BOUND + 1, height: 10 },
    } as unknown as Paint;
    const tiny = { ...IMAGE, crop: { x: 0, y: 0, width: 1e-7, height: 1e-7 } } as unknown as Paint;
    expect(
      findValueLimitIssues(sampleObject('shape', 'shape', { fill: huge })).map(({ path }) =>
        path.join('.'),
      ),
    ).toContain('fill.naturalSize.width');
    expect(
      findValueLimitIssues(sampleObject('frame', 'frame', { background: tiny })).map(({ path }) =>
        path.join('.'),
      ),
    ).toEqual(expect.arrayContaining(['background.crop.width', 'background.crop.height']));
  });
});
