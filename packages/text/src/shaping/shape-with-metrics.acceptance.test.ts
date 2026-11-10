import { describe, expect, it } from 'vitest';

import * as canvasText from '@canvas/text';
import type { FontMetrics, ShapedRun } from '@canvas/text';

// Typed by hand: written before the public export existed.
const textWithMetrics = canvasText as typeof canvasText & {
  shapeWithMetrics(metrics: FontMetrics, text: string, start: number, end: number): ShapedRun;
};
const shapeWithMetrics = (
  metrics: FontMetrics,
  text: string,
  start: number,
  end: number,
): ShapedRun => textWithMetrics.shapeWithMetrics(metrics, text, start, end);

const METRICS: FontMetrics = {
  face: { family: 'Acceptance', weight: 400, isItalic: false },
  ascent: 0.8,
  descent: 0.2,
  missingAdvance: 0.37,
  advances: [
    [0x41, 0.6],
    [0x56, 0.7],
    [0x301, 0],
    [0x1f600, 1.2],
  ],
  kerning: [[0x41, 0x56, -0.12]],
};

describe('shapeWithMetrics', () => {
  it('gives a base and combining mark one logical cluster and keeps UTF-16 offsets', () => {
    expect(typeof textWithMetrics.shapeWithMetrics).toBe('function');
    const text = '😀A\u0301V';
    expect(shapeWithMetrics(METRICS, text, 2, text.length)).toEqual({
      direction: 'ltr',
      glyphs: [
        {
          glyphId: 1,
          cluster: 2,
          advance: 0.6,
          xOffset: 0,
          yOffset: 0,
          isUnsafeToBreak: false,
        },
        {
          glyphId: 1,
          cluster: 4,
          advance: 0.7,
          xOffset: 0,
          yOffset: 0,
          isUnsafeToBreak: false,
        },
      ],
    });
  });

  it('applies pair kerning to the previous glyph', () => {
    expect(typeof textWithMetrics.shapeWithMetrics).toBe('function');
    const glyphs = shapeWithMetrics(METRICS, 'AV', 0, 2).glyphs;
    expect(glyphs.map(({ advance }) => advance)).toEqual([0.48, 0.7]);
    expect(glyphs.map(({ cluster }) => cluster)).toEqual([0, 1]);
  });

  it('uses missingAdvance and glyphId zero when the cluster begins unmapped', () => {
    expect(typeof textWithMetrics.shapeWithMetrics).toBe('function');
    const glyphs = shapeWithMetrics(METRICS, 'A?\u0301', 0, 3).glyphs;
    expect(glyphs).toHaveLength(2);
    expect(glyphs[1]).toMatchObject({ glyphId: 0, cluster: 1, advance: 0.37 });
  });
});
