import { describe, expect, it } from 'vitest';

import type { Rgba } from '@canvas/schema';

import { SELECTION_COLOR } from '../select/overlay-rects.js';

import { monoLayout } from './__fixtures__/mono-layout.js';
import { TEN } from './__fixtures__/text-mode-context.js';
import {
  CARET_WIDTH_PX,
  TEXT_SELECTION_FILL,
  textEditingRects,
  type TextEditingRectsInput,
} from './text-editing-rects.js';

const RED: Rgba = [1, 0, 0, 1];

/**
 * The input for two lines, `abcd` over `ef`, in an unturned box at the origin at 100%.
 *
 * @param fields - What differs from a caret at 0.
 * @returns The input.
 */
function inputOf(fields: Partial<TextEditingRectsInput>): TextEditingRectsInput {
  const text = 'abcd\nef';
  return {
    layout: monoLayout(text, [{ length: text.length, style: TEN }]),
    box: { x: 0, y: 0, width: 24, height: 25 },
    transform: { cos: 1, sin: 0, x: 0, y: 0 },
    selection: [0, 0],
    caret: 0,
    composition: undefined,
    caretColor: RED,
    zoom: 1,
    ...fields,
  };
}

describe('textEditingRects', () => {
  it('outlines the box and draws the caret at a collapsed selection, sized for the zoom', () => {
    const rects = textEditingRects(inputOf({ caret: 2, zoom: 2 }));
    expect(rects.slice(0, 4).every(({ color }) => color === SELECTION_COLOR)).toBe(true);
    expect(rects).toHaveLength(5);
    expect(rects[4]).toMatchObject({ color: RED, box: { width: CARET_WIDTH_PX / 2, x: 11.625 } });
  });

  it('highlights a range across lines line by line, with no caret', () => {
    const rects = textEditingRects(inputOf({ selection: [2, 6], caret: 6 }));
    const highlights = rects.filter(({ color }) => color === TEXT_SELECTION_FILL);
    // From the caret to the first line's end, then from the second line's start to the caret.
    expect(highlights.map(({ box }) => [box.x, box.width])).toEqual([
      [12, 12],
      [0, 6],
    ]);
    expect(rects.some(({ color }) => color === RED)).toBe(false);
  });

  it('underlines a composition in the caret colour, one pixel high', () => {
    const rects = textEditingRects(inputOf({ caret: 7, selection: [7, 7], composition: [5, 7] }));
    const underline = rects.find(({ color, box }) => color === RED && box.width > 2);
    expect(underline?.box).toMatchObject({ x: 0, width: 12, height: 1 });
  });

  it('outlines and highlights in the given colours: the person’s amber in the shell', () => {
    const amber: Rgba = [0.89, 0.66, 0.23, 1];
    const highlight: Rgba = [0.89, 0.66, 0.23, 0.35];
    const rects = textEditingRects(
      inputOf({ selection: [2, 6], caret: 6, outlineColor: amber, highlightColor: highlight }),
    );
    expect(rects.slice(0, 4).every(({ color }) => color === amber)).toBe(true);
    expect(rects.filter(({ color }) => color === highlight)).toHaveLength(2);
    expect(rects.some(({ color }) => color === SELECTION_COLOR)).toBe(false);
  });
});
