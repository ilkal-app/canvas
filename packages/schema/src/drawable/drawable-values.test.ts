import { describe, expect, it } from 'vitest';

import { drawableValuesReason } from './drawable-values.js';

const NOT_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe('drawableValuesReason', () => {
  it('judges a placement: coordinates finite, whatever their size; a rotation within float32', () => {
    const placement = { parentId: null, x: 1e308, y: -Number.MAX_VALUE, rotation: 1e38 };
    expect(drawableValuesReason('placement', placement)).toBeUndefined();
    expect(drawableValuesReason('placement', { ...placement, rotation: 2 ** 128 })).toEqual({
      field: 'rotation',
      reason: 'out-of-range',
    });
    for (const value of NOT_FINITE) {
      for (const field of ['x', 'y', 'rotation']) {
        expect(drawableValuesReason('placement', { ...placement, [field]: value })).toEqual({
          field,
          reason: 'not-finite',
        });
      }
    }
  });

  it('judges a size from 0 to 2^32, -0 and subnormals included', () => {
    expect(drawableValuesReason('size', { width: -0, height: Number.MIN_VALUE })).toBeUndefined();
    expect(drawableValuesReason('size', { width: 2 ** 32, height: 2 ** 32 })).toBeUndefined();
    expect(drawableValuesReason('size', { width: 2 ** 32 + 1, height: 1 })).toEqual({
      field: 'width',
      reason: 'past-extent',
    });
    expect(drawableValuesReason('size', { width: 1, height: -1 })).toEqual({
      field: 'height',
      reason: 'negative-size',
    });
    expect(drawableValuesReason('size', { width: Number.NaN, height: 1 })).toEqual({
      field: 'width',
      reason: 'not-finite',
    });
  });

  it('judges an image style: its crop whole within the image, its natural size whole numbers', () => {
    const style = {
      assetId: 'a',
      opacity: 1,
      crop: { x: 0.1, y: 0, width: 0.9, height: 1 },
      naturalSize: { width: 4000, height: 2 ** 32 },
    };
    expect(drawableValuesReason('style', style)).toBeUndefined();
    expect(
      drawableValuesReason('style', { ...style, crop: { x: 0.2, y: 0, width: 0.9, height: 1 } }),
    ).toEqual({ field: 'crop', reason: 'out-of-range' });
    expect(
      drawableValuesReason('style', { ...style, crop: { ...style.crop, height: Number.NaN } }),
    ).toEqual({ field: 'crop', reason: 'not-finite' });
    expect(
      drawableValuesReason('style', { ...style, naturalSize: { width: 0.5, height: 1 } }),
    ).toEqual({ field: 'naturalSize.width', reason: 'out-of-range' });
    expect(
      drawableValuesReason('style', { ...style, naturalSize: { width: 1, height: 2 ** 32 + 1 } }),
    ).toEqual({ field: 'naturalSize.height', reason: 'out-of-range' });
  });

  it('refuses a crop field that is not a number, and judges the numbers beside it on their own', () => {
    expect(
      drawableValuesReason('style', { crop: { x: 'left', y: 0, width: 1, height: 1 } }),
    ).toEqual({
      field: 'crop.x',
      reason: 'not-a-number',
    });
    expect(drawableValuesReason('style', { crop: { y: 2 } })).toEqual({
      field: 'crop.y',
      reason: 'out-of-range',
    });
    expect(drawableValuesReason('style', { crop: { width: 0.5 } })).toBeUndefined();
    expect(drawableValuesReason('style', { crop: 'all' })).toEqual({
      field: 'crop',
      reason: 'not-a-record',
    });
    expect(drawableValuesReason('style', { naturalSize: [1, 1] })).toEqual({
      field: 'naturalSize',
      reason: 'not-a-record',
    });
  });

  it('judges a line end, a pair of ends, a vertex and a segment’s handles as coordinates', () => {
    expect(drawableValuesReason('point', { x: 1e308, y: 0 })).toBeUndefined();
    expect(drawableValuesReason('point', { x: 0, y: Number.NaN })).toEqual({
      field: 'y',
      reason: 'not-finite',
    });
    const pair = [
      { x: 0, y: 0 },
      { x: Number.POSITIVE_INFINITY, y: 0 },
    ];
    expect(drawableValuesReason('points', pair)).toEqual({ field: '1.x', reason: 'not-finite' });
    expect(
      drawableValuesReason('points', [
        { x: Number.NaN, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toEqual({
      field: '0.x',
      reason: 'not-finite',
    });
    expect(drawableValuesReason('vertex', { id: 'v', x: 1, y: -1e300, mirror: 'none' })).toBe(
      undefined,
    );
    expect(
      drawableValuesReason('vertex', { id: 'v', x: 1, y: Number.NaN, mirror: 'none' }),
    ).toEqual({
      field: 'y',
      reason: 'not-finite',
    });
    const segment = { id: 's', a: 'v1', b: 'v2', ha: { x: 3, y: 0 }, hb: { x: 0, y: 0 } };
    expect(drawableValuesReason('segment', segment)).toBeUndefined();
    expect(
      drawableValuesReason('segment', { ...segment, hb: { x: Number.NEGATIVE_INFINITY, y: 0 } }),
    ).toEqual({ field: 'hb.x', reason: 'not-finite' });
    expect(drawableValuesReason('segment', { ...segment, ha: { x: 0, y: Number.NaN } })).toEqual({
      field: 'ha.y',
      reason: 'not-finite',
    });
  });

  it('refuses a value that is not a record, and a judged field that is not a number', () => {
    for (const value of [null, undefined, 'x', 3, [1, 2]]) {
      for (const kind of ['placement', 'size', 'style', 'point', 'vertex', 'segment'] as const) {
        expect(drawableValuesReason(kind, value), `${kind} ${String(value)}`).toEqual({
          field: '',
          reason: 'not-a-record',
        });
      }
    }
    for (const value of [null, 'x', [{ x: 0, y: 0 }], { 0: { x: 0, y: 0 }, 1: { x: 0, y: 0 } }]) {
      expect(drawableValuesReason('points', value)).toEqual({ field: '', reason: 'not-a-record' });
    }
    expect(drawableValuesReason('points', [{ x: 0, y: 0 }, null])).toEqual({
      field: '1',
      reason: 'not-a-record',
    });
    for (const field of ['NaN', null, true, { value: 1 }, [1], 10n]) {
      expect(drawableValuesReason('placement', { x: field, y: 0, rotation: 0 })).toEqual({
        field: 'x',
        reason: 'not-a-number',
      });
    }
    expect(drawableValuesReason('segment', { ha: { x: 0, y: '1' } })).toEqual({
      field: 'ha.y',
      reason: 'not-a-number',
    });
    expect(drawableValuesReason('segment', { ha: 'h' })).toEqual({
      field: 'ha',
      reason: 'not-a-record',
    });
  });

  it('judges a frame’s showName: absent or a boolean passes, anything else is refused', () => {
    const frameStyle = { name: 'Plan', clip: false, background: null };
    expect(drawableValuesReason('style', frameStyle)).toBeUndefined();
    expect(drawableValuesReason('style', { ...frameStyle, showName: true })).toBeUndefined();
    expect(drawableValuesReason('style', { ...frameStyle, showName: false })).toBeUndefined();
    for (const showName of ['yes', 1, 0, null, {}, [true]]) {
      expect(drawableValuesReason('style', { ...frameStyle, showName })).toEqual({
        field: 'showName',
        reason: 'not-a-boolean',
      });
    }
    // A value the board already holds there is not judged again.
    const stored = { ...frameStyle, showName: 'yes' };
    expect(drawableValuesReason('style', stored, () => ({ value: stored }))).toBeUndefined();
  });

  it('judges a shape’s or frame’s shadow by shadowValueReason, by its path', () => {
    const shadow = { x: 0, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 0.25] };
    const shapeStyle = { kind: 'rectangle', fill: [1, 1, 1, 1], stroke: null };
    expect(drawableValuesReason('style', { ...shapeStyle, shadow })).toBeUndefined();
    expect(drawableValuesReason('style', { ...shapeStyle, shadow: null })).toBeUndefined();
    const negativeBlur = { ...shapeStyle, shadow: { ...shadow, blur: -1 } };
    expect(drawableValuesReason('style', negativeBlur)).toEqual({
      field: 'shadow.blur',
      reason: 'out-of-range',
    });
    const inked = { ...shapeStyle, shadow: { ...shadow, color: 'ink' } };
    expect(drawableValuesReason('style', inked)).toEqual({
      field: 'shadow.color',
      reason: 'not-a-record',
    });
    expect(drawableValuesReason('style', { ...shapeStyle, shadow: 'soft' })).toEqual({
      field: 'shadow',
      reason: 'not-a-record',
    });
    // A value the board already holds there is not judged again.
    const stored = { ...shapeStyle, shadow: { ...shadow, x: Number.NaN } };
    expect(drawableValuesReason('style', stored, () => ({ value: stored }))).toBeUndefined();
  });

  it('judges a stroke alignment and a frame’s stroke by their door rules', () => {
    const shapeStyle = { kind: 'rectangle', fill: [1, 1, 1, 1], stroke: null };
    for (const strokeAlign of ['inside', 'center', 'outside']) {
      expect(drawableValuesReason('style', { ...shapeStyle, strokeAlign })).toBeUndefined();
    }
    for (const strokeAlign of ['Outside', null, 1]) {
      expect(drawableValuesReason('style', { ...shapeStyle, strokeAlign })).toEqual({
        field: 'strokeAlign',
        reason: 'out-of-range',
      });
    }
    const frameStyle = { name: 'F', clip: true, background: null };
    const stroke = { color: 'ink', width: 2 };
    expect(drawableValuesReason('style', { ...frameStyle, stroke })).toBeUndefined();
    expect(drawableValuesReason('style', { ...frameStyle, stroke: null })).toBeUndefined();
    expect(
      drawableValuesReason('style', { ...frameStyle, stroke: { ...stroke, width: 65 } }),
    ).toEqual({ field: 'stroke.width', reason: 'out-of-range' });
    expect(
      drawableValuesReason('style', { ...frameStyle, stroke: { ...stroke, color: 'Ink' } }),
    ).toEqual({ field: 'stroke.color', reason: 'not-a-record' });
    // A value the board already holds there is not judged again.
    const stored = { ...frameStyle, stroke, strokeAlign: 'middle' };
    expect(drawableValuesReason('style', stored, () => ({ value: stored }))).toBeUndefined();
  });

  it('leaves absent fields, and absent optional groups, to the decoder', () => {
    expect(drawableValuesReason('placement', { parentId: null })).toBeUndefined();
    expect(drawableValuesReason('style', { color: [1, 1, 1, 1] })).toBeUndefined();
    expect(drawableValuesReason('segment', { id: 's' })).toBeUndefined();
  });

  it('judges only what a write changes: a field the board already holds passes', () => {
    const stored = { parentId: null, x: 10, y: 20, rotation: 1e300 };
    const read = () => ({ value: stored });
    // A move of a note whose rotation was let stay: the rotation is not judged.
    expect(drawableValuesReason('placement', { ...stored, x: 11 }, read)).toBeUndefined();
    // A changed rotation is judged, though the board held one past the range already.
    expect(drawableValuesReason('placement', { ...stored, rotation: 1e299 }, read)).toEqual({
      field: 'rotation',
      reason: 'out-of-range',
    });
    expect(drawableValuesReason('placement', { ...stored, x: Number.NaN }, read)).toEqual({
      field: 'x',
      reason: 'not-finite',
    });
    // NaN is the same as NaN; a value never stored is judged; nothing stored judges everything.
    const nan = () => ({ value: { width: Number.NaN, height: 2 ** 33 } });
    expect(
      drawableValuesReason('size', { width: Number.NaN, height: 2 ** 33 }, nan),
    ).toBeUndefined();
    expect(
      drawableValuesReason('size', { width: Number.NaN, height: 1 }, () => ({ value: 7 })),
    ).toEqual({
      field: 'width',
      reason: 'not-finite',
    });
    expect(drawableValuesReason('size', { width: -1, height: 1 }, () => undefined)).toEqual({
      field: 'width',
      reason: 'negative-size',
    });
    // Whole records and pairs compare by value, key by key.
    const crop = { x: 0.5, y: 0, width: 0.9, height: 1 };
    const style = () => ({ value: { crop: { ...crop }, naturalSize: { width: 1, height: 1 } } });
    expect(
      drawableValuesReason('style', { crop, naturalSize: { width: 1, height: 1 } }, style),
    ).toBe(undefined);
    expect(drawableValuesReason('style', { crop: { ...crop, x: 0.4 } }, style)).toEqual({
      field: 'crop',
      reason: 'out-of-range',
    });
    expect(drawableValuesReason('style', { crop: { ...crop, extra: 1 } }, style)).toEqual({
      field: 'crop',
      reason: 'out-of-range',
    });
    for (const storedCrop of [null, [0.4, 0, 0.9, 1], { ...crop, x: 0.4, y: 0.1 }]) {
      expect(
        drawableValuesReason('style', { crop: { ...crop, x: 0.4 } }, () => ({
          value: { crop: storedCrop },
        })),
      ).toEqual({ field: 'crop', reason: 'out-of-range' });
    }
    const pair = [null, { x: 0, y: 0 }];
    expect(drawableValuesReason('points', pair, () => ({ value: [null, { x: 0, y: 0 }] }))).toBe(
      undefined,
    );
    expect(drawableValuesReason('points', pair, () => ({ value: { 0: null } }))).toBeUndefined();
    expect(drawableValuesReason('points', 'pair', () => ({ value: ['pair'] }))).toEqual({
      field: '',
      reason: 'not-a-record',
    });
  });

  it('does not mutate the value it judges', () => {
    const value = Object.freeze({ x: Number.NaN, y: Object.freeze({ z: 1 }) });
    expect(drawableValuesReason('placement', value)).toEqual({ field: 'x', reason: 'not-finite' });
  });
});
