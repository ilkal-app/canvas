// The popover's shape and connector values: kinds, swaps, shared paints and widths,
// ends and caps. Pure.
import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { MIXED } from '../panels/controls/mixed-value.js';

import {
  capOf,
  capsOf,
  isLineSelection,
  isShapeSelection,
  kindStyleOf,
  shapeKindOf,
  sharedEndsOf,
  sharedFillOf,
  sharedStrokeWidthOf,
  type PopoverLine,
  type PopoverShape,
} from './shape-connector-values.js';

const shape = (fields: Partial<PopoverShape>): PopoverShape =>
  ({
    type: 'shape',
    kind: 'rectangle',
    sides: 4,
    fill: null,
    stroke: null,
    ...fields,
  }) as PopoverShape;
const line = (startCap: string, endCap: string): PopoverLine =>
  ({
    type: 'connector',
    startCap,
    endCap,
    stroke: { color: [0, 0, 0, 1], width: 2 },
  }) as PopoverLine;

describe('shape-connector values', () => {
  it('tells shape and line selections', () => {
    expect(isShapeSelection([shape({})])).toBe(true);
    expect(isShapeSelection([])).toBe(false);
    expect(isLineSelection([line('none', 'arrow'), { type: 'line' } as BoardObject])).toBe(true);
    expect(isLineSelection([line('none', 'arrow'), shape({})])).toBe(false);
  });

  it('reads a three-sided polygon as a triangle and swaps kinds with kind and sides only', () => {
    expect(shapeKindOf(shape({ kind: 'polygon', sides: 3 }))).toBe('triangle');
    expect(shapeKindOf(shape({ kind: 'polygon', sides: 6 }))).toBe('polygon');
    expect(kindStyleOf('triangle', shape({}))).toEqual({ kind: 'polygon', sides: 3 });
    expect(kindStyleOf('polygon', shape({ kind: 'polygon', sides: 6 }))).toEqual({
      kind: 'polygon',
      sides: 6,
    });
    expect(kindStyleOf('polygon', shape({ kind: 'polygon', sides: 3 }))).toEqual({
      kind: 'polygon',
      sides: 5,
    });
    expect(kindStyleOf('star', shape({}))).toEqual({ kind: 'star' });
  });

  it('shares a plain fill, none, or mixed for a gradient', () => {
    expect(sharedFillOf([shape({ fill: [1, 0, 0, 1] }), shape({ fill: [1, 0, 0, 1] })])).toEqual([
      1, 0, 0, 1,
    ]);
    expect(sharedFillOf([shape({}), shape({})])).toBeNull();
    const gradient = { type: 'linear', angle: 0, stops: [] } as unknown as PopoverShape['fill'];
    expect(sharedFillOf([shape({ fill: gradient })])).toBe(MIXED);
  });

  it('shares a stroke width, mixed where some have none', () => {
    const stroked = shape({ stroke: { color: [0, 0, 0, 1], width: 2 } });
    expect(sharedStrokeWidthOf([stroked, stroked])).toBe(2);
    expect(sharedStrokeWidthOf([stroked, shape({})])).toBe(MIXED);
    expect(sharedStrokeWidthOf([shape({})])).toBe(MIXED);
  });

  it('names ends, keeps a shared cap, and sets caps for each choice', () => {
    expect(sharedEndsOf([line('none', 'none')])).toBe('none');
    expect(sharedEndsOf([line('none', 'diamond')])).toBe('end');
    expect(sharedEndsOf([line('circle', 'circle')])).toBe('both');
    expect(sharedEndsOf([line('arrow', 'none')])).toBe(MIXED);
    expect(sharedEndsOf([line('none', 'arrow'), line('arrow', 'arrow')])).toBe(MIXED);
    expect(capOf([line('none', 'circle'), line('circle', 'circle')])).toBe('circle');
    expect(capOf([line('none', 'circle'), line('none', 'arrow')])).toBe('arrow');
    expect(capOf([line('none', 'none')])).toBe('arrow');
    expect(capsOf('none', 'arrow')).toEqual({ startCap: 'none', endCap: 'none' });
    expect(capsOf('end', 'diamond')).toEqual({ startCap: 'none', endCap: 'diamond' });
    expect(capsOf('both', 'circle')).toEqual({ startCap: 'circle', endCap: 'circle' });
  });
});
