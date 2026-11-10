import { describe, expect, it } from 'vitest';

import { drawableValuesReason } from './drawable-values.js';
import { paintReason, strokeValueReason } from './paint-values.js';

const stops = [
  { offset: 0, color: [1, 0, 0, 1] },
  { offset: 1, color: [0, 0, 1, 1] },
];
const linear = { type: 'linear', angle: 0, stops };
const radial = { type: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0.5, stops };

describe('paintReason', () => {
  it('accepts absent, null, a tuple and both gradients', () => {
    for (const value of [undefined, null, [0, 0.5, 1, 1], linear, radial]) {
      expect(paintReason(value)).toBeUndefined();
    }
    expect(paintReason({ ...linear, angle: Math.PI })).toBeUndefined();
    expect(paintReason({ ...radial, radius: 2, center: { x: 0, y: 1 } })).toBeUndefined();
  });

  it('names the first refused field of a gradient', () => {
    const nine = Array.from({ length: 9 }, (unused, i) => ({ offset: i / 8, color: [1, 0, 0, 1] }));
    expect(paintReason({ ...linear, stops: nine })).toEqual({
      field: 'stops',
      reason: 'out-of-range',
    });
    const four = [...stops, stops[1], { offset: 1.5, color: [0, 0, 0, 1] }];
    expect(paintReason({ ...linear, stops: four })).toEqual({
      field: 'stops.3.offset',
      reason: 'out-of-range',
    });
    expect(paintReason({ ...linear, stops: [...stops].reverse() })).toEqual({
      field: 'stops.1.offset',
      reason: 'out-of-range',
    });
    expect(paintReason({ ...linear, stops: [stops[0], { ...stops[1], extra: 1 }] })).toEqual({
      field: 'stops.1',
      reason: 'not-a-record',
    });
    expect(paintReason({ ...linear, stops: 'red' })).toEqual({
      field: 'stops',
      reason: 'not-a-record',
    });
    expect(paintReason({ ...linear, stops: [stops[0], 'red'] })).toEqual({
      field: 'stops.1',
      reason: 'not-a-record',
    });
    expect(paintReason({ ...linear, angle: Number.NaN })).toEqual({
      field: 'angle',
      reason: 'not-finite',
    });
    expect(paintReason({ ...linear, angle: -Math.PI })).toEqual({
      field: 'angle',
      reason: 'out-of-range',
    });
    expect(paintReason({ ...radial, radius: 0 })).toEqual({
      field: 'radius',
      reason: 'out-of-range',
    });
    expect(paintReason({ ...radial, center: { x: 0.5, y: 1e999 } })).toEqual({
      field: 'center.y',
      reason: 'not-finite',
    });
    expect(paintReason({ ...linear, stops: [{ offset: 0, color: [1, 0, 0] }, stops[1]] })).toEqual({
      field: 'stops.0.color',
      reason: 'not-a-record',
    });
  });

  it('refuses unknown types and keys, strings and ink', () => {
    for (const value of [
      { ...linear, type: 'conic' },
      { ...linear, extra: 1 },
      { ...radial, center: { x: 0.5, y: 0.5, z: 0 } },
      'ink',
      7,
    ]) {
      expect(paintReason(value)?.reason).toBe('not-a-record');
    }
    expect(paintReason([1, 0, 0])).toEqual({ field: '', reason: 'not-a-record' });
    expect(paintReason([1, 0, 0, 'a'])).toEqual({ field: '3', reason: 'not-a-number' });
  });
});

describe('paintReason on an image paint', () => {
  const image = {
    type: 'image',
    assetId: 'asset-photo',
    naturalSize: { width: 1600, height: 900 },
    fit: 'tile',
    crop: { x: 0, y: 0, width: 1, height: 1 },
  };

  it('names a natural size or crop that is not the record it should be', () => {
    for (const naturalSize of [null, [1600, 900], { width: 1600 }]) {
      expect(paintReason({ ...image, naturalSize })).toEqual({
        field: 'naturalSize',
        reason: 'not-a-record',
      });
    }
    for (const crop of [null, [0, 0, 1, 1], { ...image.crop, extra: 1 }]) {
      expect(paintReason({ ...image, crop })).toEqual({ field: 'crop', reason: 'not-a-record' });
    }
  });

  it('names a natural size that is not a finite number, and a crop past the image’s foot', () => {
    expect(paintReason({ ...image, naturalSize: { width: '1600', height: 900 } })).toEqual({
      field: 'naturalSize.width',
      reason: 'not-a-number',
    });
    expect(paintReason({ ...image, naturalSize: { width: 1600, height: Infinity } })).toEqual({
      field: 'naturalSize.height',
      reason: 'not-finite',
    });
    expect(paintReason({ ...image, crop: { x: 0, y: 0.5, width: 1, height: 0.6 } })).toEqual({
      field: 'crop.height',
      reason: 'out-of-range',
    });
  });
});

describe('strokeValueReason', () => {
  it('accepts a tuple or exactly ink, and a width in (0, 64]', () => {
    expect(strokeValueReason(undefined)).toBeUndefined();
    expect(strokeValueReason(null)).toBeUndefined();
    expect(strokeValueReason({ color: 'ink', width: 64 })).toBeUndefined();
    expect(strokeValueReason({ color: [0, 0, 0, 1], width: 0.5 })).toBeUndefined();
  });

  it('refuses other tokens, widths and keys', () => {
    expect(strokeValueReason({ color: 'Ink', width: 2 })).toEqual({
      field: 'color',
      reason: 'not-a-record',
    });
    expect(strokeValueReason({ color: 'ink', width: 0 })).toEqual({
      field: 'width',
      reason: 'out-of-range',
    });
    expect(strokeValueReason({ color: 'ink', width: 65 })?.reason).toBe('out-of-range');
    expect(strokeValueReason({ color: 'ink' })?.reason).toBe('not-a-record');
  });
});

describe('the style door kind', () => {
  it('judges fills, backgrounds and strokes, with the field path', () => {
    expect(
      drawableValuesReason('style', { fill: linear, stroke: { color: 'ink', width: 2 } }),
    ).toBeUndefined();
    expect(drawableValuesReason('style', { background: { ...linear, stops: [] } })).toEqual({
      field: 'background.stops',
      reason: 'out-of-range',
    });
    expect(drawableValuesReason('style', { stroke: { color: 'white', width: 2 } })).toEqual({
      field: 'stroke.color',
      reason: 'not-a-record',
    });
    expect(drawableValuesReason('style', { fill: 'ink' })).toEqual({
      field: 'fill',
      reason: 'not-a-record',
    });
  });

  it('lets a refused paint through when the board already holds it', () => {
    const bad = { ...linear, stops: [] };
    expect(
      drawableValuesReason('style', { fill: bad, cornerRadius: 2 }, () => ({
        value: { fill: bad, cornerRadius: 0 },
      })),
    ).toBeUndefined();
  });
});
