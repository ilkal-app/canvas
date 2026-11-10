/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import {
  createFontMetrics,
  createShapingMeasurer,
  layoutText,
  loadShaper,
  parseFont,
} from '@canvas/text';

import { visualCaretStep } from './caret.js';

const ARABIC = '../../../../app/assets/fonts/script-coverage/notosansarabic/400.ttf';

it('steps through a shaped Arabic word whose joined letters overlap, one letter a key', async () => {
  const bytes = readFileSync(new URL(ARABIC, import.meta.url));
  const family = 'Noto Sans Arabic';
  const metrics = createFontMetrics({ family, weight: 400, isItalic: false }, parseFont(bytes));
  const measurer = createShapingMeasurer(await loadShaper(), [{ bytes, metrics }]);
  const text = 'مرحبا';
  const style: TextStyle = {
    fontFamily: family,
    fontSize: 24,
    color: [0, 0, 0, 1],
    weight: 400,
    italic: false,
  };
  const layout = layoutText(text, [{ length: text.length, style }], null, measurer);
  // Right to left: ArrowLeft reads on, ArrowRight back, one letter at a time.
  for (let index = 0; index < text.length; index += 1) {
    expect(visualCaretStep(layout, index, -1)).toBe(index + 1);
    expect(visualCaretStep(layout, index + 1, 1)).toBe(index);
  }
});

it("crosses hard and empty lines off an Arabic line's visual edges", async () => {
  const bytes = readFileSync(new URL(ARABIC, import.meta.url));
  const family = 'Noto Sans Arabic';
  const metrics = createFontMetrics({ family, weight: 400, isItalic: false }, parseFont(bytes));
  const measurer = createShapingMeasurer(await loadShaper(), [{ bytes, metrics }]);
  const text = 'مرحبا\n\nمرحبا';
  const style: TextStyle = {
    fontFamily: family,
    fontSize: 24,
    color: [0, 0, 0, 1],
    weight: 400,
    italic: false,
  };
  const layout = layoutText(text, [{ length: text.length, style }], null, measurer);
  expect(layout.lines.map(({ start, end, isHard }) => [start, end, isHard])).toEqual([
    [0, 5, true],
    [6, 6, true],
    [7, 12, true],
  ]);
  // Off the first line's start edge (its right) the caret stays; off its end edge (its left) it
  // goes to the empty line, which text order then owns.
  expect(visualCaretStep(layout, 0, 1)).toBe(0);
  expect(visualCaretStep(layout, 5, -1)).toBe(6);
  expect(visualCaretStep(layout, 6, -1)).toBeUndefined();
  // Off the last line's start edge back to the empty line; off its end edge it stays.
  expect(visualCaretStep(layout, 7, 1)).toBe(6);
  expect(visualCaretStep(layout, 12, -1)).toBe(12);
});
