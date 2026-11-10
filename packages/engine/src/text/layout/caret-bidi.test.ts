import { describe, expect, it } from 'vitest';

import type { LayoutGlyph, TextLayout } from '@canvas/text';

import { hitTest } from './caret.js';

/**
 * One line of `a` then the Hebrew `אב` drawn right to left, with letter spacing: `a` over
 * [0, 10], a gap, then `ב` over [30, 40] and `א` over [40, 50].
 *
 * @returns The layout.
 */
function spacedMixedLine(): TextLayout {
  const text = 'aאב';
  const glyph = (index: number, x: number, level: number): LayoutGlyph => ({
    codepoint: text.codePointAt(index) ?? 0,
    index,
    end: index + 1,
    glyphId: index + 1,
    level,
    line: 0,
    x,
    y: 15,
    advance: 10,
    run: 0,
  });
  return {
    text,
    runs: [{ faceId: 'face', fontSize: 16, color: [0, 0, 0, 1] }],
    glyphs: [glyph(0, 0, 0), glyph(1, 40, 1), glyph(2, 30, 1)],
    lines: [
      {
        start: 0,
        end: 3,
        isHard: true,
        x: 0,
        y: 0,
        height: 20,
        ascent: 15,
        descent: 5,
        baseline: 15,
        width: 50,
      },
    ],
    width: 50,
    height: 20,
  };
}

describe('hitTest on a mixed line with letter spacing', () => {
  it('takes the nearest grapheme edge in a gap, not the next box', () => {
    const layout = spacedMixedLine();
    // Just after `a`: the caret after it, not past the right-to-left run.
    expect(hitTest(layout, { x: 11, y: 10 })).toBe(1);
    // Just before `ב`'s left edge, which is the run's logical end.
    expect(hitTest(layout, { x: 29, y: 10 })).toBe(3);
  });

  it('takes the nearest edge past the line ends', () => {
    const layout = spacedMixedLine();
    expect(hitTest(layout, { x: -5, y: 10 })).toBe(0);
    // Past `א`'s right edge, its leading edge: the run's start.
    expect(hitTest(layout, { x: 60, y: 10 })).toBe(1);
  });
});
