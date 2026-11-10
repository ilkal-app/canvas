import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { measureObjectText } from './measure-object.js';
import { measuringFontsFor, measureText } from './measure-text.js';

const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 16,
  color: 'ink',
  weight: 400,
  italic: false,
};

function note(lines: number, height = 200) {
  const text = Array.from({ length: lines }, () => 'word').join('\n');
  const runs: StyleRun[] = [{ length: text.length, style: STYLE }];
  return { type: 'sticky' as const, text, runs, width: 200, height };
}

const { fonts } = measuringFontsFor([[{ length: 0, style: STYLE }]]);

describe('measureObjectText sticky auto-fit', () => {
  it('keeps its height when the maximum overflows but a smaller size fits', () => {
    const object = note(12);
    expect(measureText(object.text, object.runs, 168, fonts).height).toBeGreaterThan(168);
    const result = measureObjectText(object, fonts);
    expect(result?.box).toEqual({ width: 200, height: 200 });
    expect(result?.text.height).toBeLessThanOrEqual(168);
  });

  it('grows only when text still overflows at the floor', () => {
    const object = note(30);
    const result = measureObjectText(object, fonts);
    expect(result?.text.height).toBeGreaterThan(168);
    expect(result).toBeDefined();
    if (result === undefined) throw new Error('Sticky measurement missing.');
    expect(result.box).toEqual({ width: 200, height: result.text.height + 32 });
  });

  it('preserves a previously taller stored height', () => {
    expect(measureObjectText(note(12, 400), fonts)?.box).toEqual({ width: 200, height: 400 });
  });
});
