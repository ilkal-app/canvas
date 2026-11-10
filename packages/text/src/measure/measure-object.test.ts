import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { measureObjectText } from './measure-object.js';
import { measuringFontsFor, measureText } from './measure-text.js';

const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};
const TEXT = 'Label and value side by side';
const RUNS: StyleRun[] = [{ length: TEXT.length, style: STYLE }];
const { fonts } = measuringFontsFor([RUNS]);

describe('measureObjectText', () => {
  it('sizes an auto-width text to its longest line and its height', () => {
    const natural = measureText(TEXT, RUNS, null, fonts);
    const object = {
      type: 'text',
      text: TEXT,
      runs: RUNS,
      width: 0,
      height: 0,
      autoWidth: true,
    } as const;
    expect(measureObjectText(object, fonts)).toEqual({
      text: natural,
      box: { width: natural.width, height: natural.height },
    });
  });

  it('keeps a fixed-width text width, wraps at it and takes its height', () => {
    const wrapped = measureText(TEXT, RUNS, 100, fonts);
    const object = {
      type: 'text',
      text: TEXT,
      runs: RUNS,
      width: 100,
      height: 5,
      autoWidth: false,
    } as const;
    expect(wrapped.lineCount).toBeGreaterThan(1);
    expect(measureObjectText(object, fonts)).toEqual({
      text: wrapped,
      box: { width: 100, height: wrapped.height },
    });
  });

  it('never sizes a box below one unit', () => {
    const empty = {
      type: 'text',
      text: '',
      runs: [{ length: 0, style: STYLE }],
      width: 0,
      height: 0,
      autoWidth: true,
    } as const;
    expect(measureObjectText(empty, fonts)?.box).toEqual({ width: 1, height: 25 });
  });

  it('wraps a sticky note inside its padding and fits long text to its height', () => {
    const note = { type: 'sticky', text: TEXT, runs: RUNS, width: 120, height: 400 } as const;
    const wrapped = measureText(TEXT, RUNS, 88, fonts);
    expect(measureObjectText(note, fonts)).toEqual({
      text: wrapped,
      box: { width: 120, height: 400 },
      fittedFontSize: STYLE.fontSize,
    });
    const square = { ...note, height: 120 };
    const fitted = measureObjectText(square, fonts);
    expect(fitted?.box?.height).toBe(120);
    expect(fitted?.text.height).toBeLessThanOrEqual(120 - 32);
    expect(fitted?.fittedFontSize).toBeLessThan(STYLE.fontSize);
  });

  it('measures a shape label inside its inscribed box and a connector label at its width', () => {
    const label = { text: TEXT.repeat(3), runs: [{ length: TEXT.length * 3, style: STYLE }] };
    const shape = {
      type: 'shape',
      kind: 'ellipse',
      width: 300,
      height: 120,
      cornerRadius: 0,
      sides: 4,
      label,
    } as const;
    const inscribed = 300 * Math.SQRT1_2 - 16;
    expect(measureObjectText(shape, fonts)).toEqual({
      text: measureText(label.text, label.runs, inscribed, fonts),
    });
    expect(measureObjectText({ type: 'connector', label }, fonts)).toEqual({
      text: measureText(label.text, label.runs, 200, fonts),
    });
  });

  it('measures nothing for a shape or connector without a label', () => {
    expect(
      measureObjectText(
        {
          type: 'shape',
          kind: 'rectangle',
          width: 10,
          height: 10,
          cornerRadius: 0,
          sides: 4,
          label: null,
        },
        fonts,
      ),
    ).toBeUndefined();
    expect(measureObjectText({ type: 'connector', label: null }, fonts)).toBeUndefined();
  });
});
