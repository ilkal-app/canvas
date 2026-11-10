import { describe, expect, it } from 'vitest';

import {
  resolveParagraphLevels as publicResolveParagraphLevels,
  lineLevels as publicLineLevels,
  visualOrder as publicVisualOrder,
  splitParagraphs as publicSplitParagraphs,
  type ParagraphDirection,
  type BidiParagraphLevels,
} from '../index.js';

import { lineLevels, resolveParagraphLevels, visualOrder } from './bidi-levels.js';
import { splitParagraphs } from './split-paragraphs.js';

describe('UAX #9 paragraph boundaries and directions', () => {
  it('exports paragraph, line, and reorder operations from the package root', () => {
    const direction: ParagraphDirection = 'auto';
    const result: BidiParagraphLevels = publicResolveParagraphLevels('a', direction);
    expect(result.level).toBe(0);
    expect(publicSplitParagraphs('a')).toEqual([{ start: 0, end: 1 }]);
    expect(Array.from(publicLineLevels([0], ['L'], 0))).toEqual([0]);
    expect(publicVisualOrder([0])).toEqual([0]);
  });

  it('splits at B separators and keeps CR LF together', () => {
    expect(splitParagraphs('a\nb')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 3 },
    ]);
    expect(splitParagraphs('a\r\nb')).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 4 },
    ]);
    expect(splitParagraphs('a\u2029b')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 3 },
    ]);
    expect(splitParagraphs('a\u0085b')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 3 },
    ]);
    expect(splitParagraphs('a\u001cb')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 3 },
    ]);
    expect(splitParagraphs('a\n')).toEqual([{ start: 0, end: 2 }]);
    expect(splitParagraphs('')).toEqual([{ start: 0, end: 0 }]);
  });

  it('keeps line separator inside its paragraph', () => {
    expect(splitParagraphs('a\u2028b')).toEqual([{ start: 0, end: 3 }]);
  });

  it('chooses the first unisolated strong character for auto direction', () => {
    expect(resolveParagraphLevels('abc', 'auto').level).toBe(0);
    expect(resolveParagraphLevels('\u05d0\u05d1', 'auto').level).toBe(1);
    expect(resolveParagraphLevels('123 \u05d0', 'auto').level).toBe(1);
    expect(resolveParagraphLevels('\u2067\u05d0\u2069abc', 'auto').level).toBe(0);
  });

  it('keeps an explicit RTL paragraph level while resolving Latin at level two', () => {
    const result = resolveParagraphLevels('abc', 'rtl');
    expect(result.level).toBe(1);
    expect(Array.from(result.levels)).toEqual([2, 2, 2]);
  });

  it('marks both UTF-16 units of a supplementary character with the same level', () => {
    const result = resolveParagraphLevels('\u{1ee00}', 'ltr');
    expect(result.levels.length).toBe(2);
    expect(result.levels[0]).toBe(result.levels[1]);
  });

  it('resets trailing whitespace and removed formatting before reordering', () => {
    expect(Array.from(lineLevels([1, 1, 1], ['R', 'R', 'WS'], 0))).toEqual([1, 1, 0]);
    expect(visualOrder([1, 1, 0, 255])).toEqual([1, 0, 2]);
  });
});
