import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { clampLines, LINE_CLAMP_ELLIPSIS, type LineClampLayout } from './line-clamp.js';

const BOLD: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 14,
  color: [0, 0, 0, 1],
  weight: 700,
  italic: false,
};
const PLAIN: TextStyle = { ...BOLD, fontSize: 12, weight: 400 };

/**
 * Lays text out `width` characters to a line, breaking at newlines: a stand-in for a measurer
 * with one advance.
 *
 * @param width - Characters per line.
 * @returns The layout function.
 */
function fixedWidth(width: number) {
  return (text: string): LineClampLayout => {
    const lines: { start: number; end: number; isHard: boolean }[] = [];
    let start = 0;
    for (const paragraph of text.split('\n')) {
      const end = start + paragraph.length;
      let lineStart = start;
      do {
        const lineEnd = Math.min(end, lineStart + width);
        lines.push({ start: lineStart, end: lineEnd, isHard: lineEnd === end });
        lineStart = lineEnd;
      } while (lineStart < end);
      start = end + 1;
    }
    return { lines };
  };
}

/**
 * One run of a style over a text.
 *
 * @param text - The text.
 * @param style - The style.
 * @returns The runs.
 */
function runOf(text: string, style: TextStyle = PLAIN): StyleRun[] {
  return [{ length: text.length, style }];
}

describe('clampLines', () => {
  it('leaves a text within its caps whole', () => {
    const clamp = clampLines({ text: 'abcdefg', runs: runOf('abcdefg'), caps: [2] }, fixedWidth(4));
    expect(clamp.text).toBe('abcdefg');
    expect(clamp.layout.lines).toHaveLength(2);
  });

  it('cuts a paragraph on its last allowed line, as late as the ellipsis still fits', () => {
    const text = 'abcdefghij';
    const clamp = clampLines({ text, runs: runOf(text), caps: [2] }, fixedWidth(4));
    expect(clamp.text).toBe(`abcdefg${LINE_CLAMP_ELLIPSIS}`);
    expect(clamp.layout.lines).toHaveLength(2);
    expect(clamp.runs).toEqual([{ length: 8, style: PLAIN }]);
  });

  it('clamps each paragraph to its own cap and keeps the newlines', () => {
    const title = 'abcdefghij';
    const description = 'klmnopqrstuv';
    const text = `${title}\n${description}`;
    const runs = [
      { length: title.length + 1, style: BOLD },
      { length: description.length, style: PLAIN },
    ];
    const clamp = clampLines({ text, runs, caps: [1, 2] }, fixedWidth(4));
    expect(clamp.text).toBe(`abc${LINE_CLAMP_ELLIPSIS}\nklmnopq${LINE_CLAMP_ELLIPSIS}`);
    expect(clamp.runs).toEqual([
      { length: 5, style: BOLD },
      { length: 8, style: PLAIN },
    ]);
    expect(clamp.layout.lines).toHaveLength(3);
  });

  it('drops the white space before the ellipsis, and never splits a surrogate pair', () => {
    const spaced = 'ab  cdefgh';
    expect(clampLines({ text: spaced, runs: runOf(spaced), caps: [1] }, fixedWidth(4)).text).toBe(
      `ab${LINE_CLAMP_ELLIPSIS}`,
    );
    const emoji = 'ab😀cdefg';
    const clamp = clampLines({ text: emoji, runs: runOf(emoji), caps: [1] }, fixedWidth(4));
    expect(clamp.text).toBe(`ab${LINE_CLAMP_ELLIPSIS}`);
  });

  it('keeps a run for an ellipsis alone, where nothing of the line fits beside it', () => {
    const text = 'abcdefghij';
    const clamp = clampLines({ text, runs: runOf(text), caps: [1] }, fixedWidth(1));
    expect(clamp.text).toBe(LINE_CLAMP_ELLIPSIS);
    expect(clamp.runs).toEqual([{ length: 1, style: PLAIN }]);
  });

  it('leaves paragraphs past the caps whole', () => {
    const text = 'ab\ncdefghij';
    const clamp = clampLines({ text, runs: runOf(text), caps: [1] }, fixedWidth(4));
    expect(clamp.text).toBe(text);
  });
});
