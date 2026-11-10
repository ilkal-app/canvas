import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createMetricsMeasurer } from '../index.js';
import { layoutText, type ClusterTextLayout } from '../shaping/__fixtures__/shaping-contract.js';
import { acceptanceFont } from '../shaping/__fixtures__/shaping-fonts.js';

const FONT = acceptanceFont('liberation-sans');
const MEASURER = createMetricsMeasurer([FONT.metrics]);
const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 10,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

/**
 * Removes only the fields added by, and's markers and decorations while they are
 * empty (as they are for plain text), leaving the old output intact.
 *
 * @param layout - The current layout.
 * @returns Its legacy shape for comparison with a pre-shaping snapshot.
 */
function withoutClusterFields(layout: ClusterTextLayout): unknown {
  const { markers, decorations, ...rest } = layout;
  return {
    ...rest,
    ...(markers === undefined || markers.length === 0 ? {} : { markers }),
    ...(decorations === undefined || decorations.length === 0 ? {} : { decorations }),
    glyphs: rest.glyphs.map((glyph) => {
      const legacy: Record<string, unknown> = { ...glyph };
      delete legacy.glyphId;
      delete legacy.end;
      delete legacy.level;
      return legacy;
    }),
  };
}

describe('metrics layout preserves its pre-shaping output', () => {
  it('keeps the old one-line AV layout byte-identical after removing cluster fields', () => {
    const text = 'AV';
    const runs: StyleRun[] = [{ length: text.length, style: STYLE }];
    const layout = layoutText(text, runs, null, MEASURER);
    expect(withoutClusterFields(layout)).toMatchInlineSnapshot(`
      {
        "glyphs": [
          {
            "advance": 6.669921875,
            "codepoint": 65,
            "index": 0,
            "line": 0,
            "run": 0,
            "x": 0,
            "y": 9.716796875,
          },
          {
            "advance": 6.669921875,
            "codepoint": 86,
            "index": 1,
            "line": 0,
            "run": 0,
            "x": 5.927734375,
            "y": 9.716796875,
          },
        ],
        "height": 12.5,
        "lines": [
          {
            "ascent": 9.716796875,
            "baseline": 9.716796875,
            "descent": 2.783203125,
            "end": 2,
            "height": 12.5,
            "isHard": true,
            "start": 0,
            "width": 12.59765625,
            "x": 0,
            "y": 0,
          },
        ],
        "runs": [
          {
            "color": [
              0,
              0,
              0,
              1,
            ],
            "faceId": "400|n|Liberation Sans",
            "fontSize": 10,
          },
        ],
        "text": "AV",
        "width": 12.59765625,
      }
    `);
    expect(layout.glyphs.map(({ index, end, glyphId }) => [index, end, glyphId])).toEqual([
      [0, 1, null],
      [1, 2, null],
    ]);
  });

  it('keeps the old surrogate-pair indices and advances', () => {
    const text = 'a😀b';
    const runs: StyleRun[] = [{ length: text.length, style: STYLE }];
    const layout = layoutText(text, runs, null, MEASURER);
    expect(withoutClusterFields(layout)).toMatchInlineSnapshot(`
      {
        "glyphs": [
          {
            "advance": 5.5615234375,
            "codepoint": 97,
            "index": 0,
            "line": 0,
            "run": 0,
            "x": 0,
            "y": 9.716796875,
          },
          {
            "advance": 3.65234375,
            "codepoint": 128512,
            "index": 1,
            "line": 0,
            "run": 0,
            "x": 5.5615234375,
            "y": 9.716796875,
          },
          {
            "advance": 5.5615234375,
            "codepoint": 98,
            "index": 3,
            "line": 0,
            "run": 0,
            "x": 9.2138671875,
            "y": 9.716796875,
          },
        ],
        "height": 12.5,
        "lines": [
          {
            "ascent": 9.716796875,
            "baseline": 9.716796875,
            "descent": 2.783203125,
            "end": 4,
            "height": 12.5,
            "isHard": true,
            "start": 0,
            "width": 14.775390625,
            "x": 0,
            "y": 0,
          },
        ],
        "runs": [
          {
            "color": [
              0,
              0,
              0,
              1,
            ],
            "faceId": "400|n|Liberation Sans",
            "fontSize": 10,
          },
        ],
        "text": "a😀b",
        "width": 14.775390625,
      }
    `);
    expect(layout.glyphs.map(({ index, end, glyphId }) => [index, end, glyphId])).toEqual([
      [0, 1, null],
      [1, 3, null],
      [3, 4, null],
    ]);
  });

  it('keeps old wrapping, line metrics and mixed-run positions', () => {
    const text = 'aa bb\nc';
    const runs: StyleRun[] = [
      { length: 3, style: STYLE },
      { length: 5, style: { ...STYLE, fontSize: 20, color: [1, 0, 0, 1] } },
    ];
    const layout = layoutText(text, runs, 24, MEASURER);
    expect(withoutClusterFields(layout)).toMatchInlineSnapshot(`
      {
        "glyphs": [
          {
            "advance": 5.5615234375,
            "codepoint": 97,
            "index": 0,
            "line": 0,
            "run": 0,
            "x": 0,
            "y": 9.716796875,
          },
          {
            "advance": 5.5615234375,
            "codepoint": 97,
            "index": 1,
            "line": 0,
            "run": 0,
            "x": 5.5615234375,
            "y": 9.716796875,
          },
          {
            "advance": 2.7783203125,
            "codepoint": 32,
            "index": 2,
            "line": 0,
            "run": 0,
            "x": 11.123046875,
            "y": 9.716796875,
          },
          {
            "advance": 11.123046875,
            "codepoint": 98,
            "index": 3,
            "line": 1,
            "run": 1,
            "x": 0,
            "y": 31.93359375,
          },
          {
            "advance": 11.123046875,
            "codepoint": 98,
            "index": 4,
            "line": 1,
            "run": 1,
            "x": 11.123046875,
            "y": 31.93359375,
          },
          {
            "advance": 10,
            "codepoint": 99,
            "index": 6,
            "line": 2,
            "run": 1,
            "x": 0,
            "y": 56.93359375,
          },
        ],
        "height": 62.5,
        "lines": [
          {
            "ascent": 9.716796875,
            "baseline": 9.716796875,
            "descent": 2.783203125,
            "end": 3,
            "height": 12.5,
            "isHard": false,
            "start": 0,
            "width": 13.9013671875,
            "x": 0,
            "y": 0,
          },
          {
            "ascent": 19.43359375,
            "baseline": 31.93359375,
            "descent": 5.56640625,
            "end": 5,
            "height": 25,
            "isHard": true,
            "start": 3,
            "width": 22.24609375,
            "x": 0,
            "y": 12.5,
          },
          {
            "ascent": 19.43359375,
            "baseline": 56.93359375,
            "descent": 5.56640625,
            "end": 7,
            "height": 25,
            "isHard": true,
            "start": 6,
            "width": 10,
            "x": 0,
            "y": 37.5,
          },
        ],
        "runs": [
          {
            "color": [
              0,
              0,
              0,
              1,
            ],
            "faceId": "400|n|Liberation Sans",
            "fontSize": 10,
          },
          {
            "color": [
              1,
              0,
              0,
              1,
            ],
            "faceId": "400|n|Liberation Sans",
            "fontSize": 20,
          },
        ],
        "text": "aa bb
      c",
        "width": 22.24609375,
      }
    `);
    expect(layout.glyphs.every((glyph) => glyph.glyphId === null)).toBe(true);
    expect(layout.glyphs.every((glyph) => glyph.end === glyph.index + 1)).toBe(true);
  });
});
