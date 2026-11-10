import { describe, expect, it } from 'vitest';

import type { TextLayout } from '@canvas/engine';
import type { Rgba } from '@canvas/schema';

import { monoLayout } from './__fixtures__/mono-layout.js';
import { TEN } from './__fixtures__/text-mode-context.js';
import {
  CARET_WIDTH_PX,
  TEXT_SELECTION_FILL,
  textEditingRects,
  type TextEditingRectsInput,
} from './text-editing-rects.js';

const RED: Rgba = [1, 0, 0, 1];

function layoutOf(): TextLayout {
  const text = 'aאבb';
  return {
    text,
    runs: [],
    glyphs: [
      { index: 0, end: 1, glyphId: null, level: 0, line: 0, x: 0, advance: 10 },
      { index: 1, end: 2, glyphId: null, level: 1, line: 0, x: 20, advance: 10 },
      { index: 2, end: 3, glyphId: null, level: 1, line: 0, x: 10, advance: 10 },
      { index: 3, end: 4, glyphId: null, level: 0, line: 0, x: 30, advance: 10 },
    ].map((glyph) => ({ ...glyph, codepoint: text.codePointAt(glyph.index) ?? 0, y: 15, run: 0 })),
    lines: [
      {
        start: 0,
        end: 4,
        isHard: true,
        x: 0,
        y: 0,
        height: 20,
        ascent: 15,
        descent: 5,
        baseline: 15,
        width: 40,
      },
    ],
    width: 40,
    height: 20,
  };
}

function inputOf(fields: Partial<TextEditingRectsInput>): TextEditingRectsInput {
  return {
    layout: layoutOf(),
    box: { x: 0, y: 0, width: 40, height: 20 },
    transform: { cos: 1, sin: 0, x: 0, y: 0 },
    selection: [0, 0],
    caret: 0,
    composition: undefined,
    caretColor: RED,
    zoom: 1,
    ...fields,
  };
}

describe('bidi editing rectangles acceptance', () => {
  it('draws one highlight per visual selection run', () => {
    const rects = textEditingRects(inputOf({ selection: [0, 2], caret: 2 }));
    expect(
      rects.filter((rect) => rect.color === TEXT_SELECTION_FILL).map(({ box }) => box),
    ).toEqual([
      { x: 0, y: 0, width: 10, height: 20, rotation: 0 },
      { x: 20, y: 0, width: 10, height: 20, rotation: 0 },
    ]);
  });

  it('underlines only selected visual boxes of a composition', () => {
    const rects = textEditingRects(
      inputOf({ selection: [4, 4], caret: 4, composition: [0, 2], zoom: 2 }),
    );
    expect(
      rects.filter((rect) => rect.color === RED && rect.box.width > 2).map(({ box }) => box),
    ).toEqual([
      { x: 0, y: 19, width: 10, height: 0.5, rotation: 0 },
      { x: 20, y: 19, width: 10, height: 0.5, rotation: 0 },
    ]);
  });

  it('draws primary and secondary caret bars in the upper and lower line halves', () => {
    const rects = textEditingRects(inputOf({ selection: [1, 1], caret: 1, zoom: 2 }));
    expect(rects.filter((rect) => rect.color === RED).map(({ box }) => box)).toEqual([
      { x: 30 - CARET_WIDTH_PX / 4, y: 0, width: CARET_WIDTH_PX / 2, height: 10, rotation: 0 },
      { x: 10 - CARET_WIDTH_PX / 4, y: 10, width: CARET_WIDTH_PX / 2, height: 10, rotation: 0 },
    ]);
  });

  it('splits an input method caret at a direction boundary by its own index', () => {
    // The whole text composed, the editor's caret at its end, the input method's caret at 1.
    const rects = textEditingRects(
      inputOf({
        selection: [4, 4],
        caret: 4,
        composition: [0, 4],
        compositionSelection: [1, 1],
        zoom: 2,
      }),
    );
    expect(
      rects.filter((rect) => rect.color === RED && rect.box.width < 2).map(({ box }) => box),
    ).toEqual([
      { x: 30 - CARET_WIDTH_PX / 4, y: 0, width: CARET_WIDTH_PX / 2, height: 10, rotation: 0 },
      { x: 10 - CARET_WIDTH_PX / 4, y: 10, width: CARET_WIDTH_PX / 2, height: 10, rotation: 0 },
    ]);
  });

  it('keeps a single full-height caret when both sides have the same level', () => {
    const rects = textEditingRects(inputOf({ selection: [2, 2], caret: 2 }));
    expect(rects.filter((rect) => rect.color === RED).map(({ box }) => box)).toEqual([
      { x: 20 - CARET_WIDTH_PX / 2, y: 0, width: CARET_WIDTH_PX, height: 20, rotation: 0 },
    ]);
  });
});

describe('LTR overlay identity acceptance', () => {
  it.each([
    { text: 'abcd', selection: [1, 3] as const, expected: [[6, 12]] },
    {
      text: 'ab\ncd',
      selection: [1, 4] as const,
      expected: [
        [6, 6],
        [0, 6],
      ],
    },
    { text: 'a b c', selection: [0, 5] as const, expected: [[0, 30]] },
  ])('keeps the current per-line selection extents for $text', ({ text, selection, expected }) => {
    const layout = monoLayout(text, [{ length: text.length, style: TEN }]);
    const rects = textEditingRects(inputOf({ layout, selection, caret: selection[1] }));
    expect(
      rects
        .filter((rect) => rect.color === TEXT_SELECTION_FILL)
        .map(({ box }) => [box.x, box.width]),
    ).toEqual(expected);
  });
});
