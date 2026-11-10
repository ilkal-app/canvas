import { describe, expect, it } from 'vitest';

import type { LayoutGlyph, LayoutLine, TextLayout } from '@canvas/engine';

import { moveCaret } from './caret-motion.js';
import { moveHorizontal } from './editor-navigation.js';
import { createEditorState, type EditorState } from './editor-state.js';

type Glyph = readonly [index: number, x: number, level: number, line?: number];

function layoutOf(text: string, specs: readonly Glyph[], ends = [text.length]): TextLayout {
  const lines: LayoutLine[] = ends.map((end, line) => ({
    start: line === 0 ? 0 : (ends[line - 1] ?? 0),
    end,
    isHard: line === ends.length - 1,
    x: 0,
    y: line * 20,
    height: 20,
    ascent: 15,
    descent: 5,
    baseline: line * 20 + 15,
    width: Math.max(
      0,
      ...specs.filter((item) => (item[3] ?? 0) === line).map((item) => item[1] + 10),
    ),
  }));
  const glyphs: LayoutGlyph[] = specs.map(([index, x, level, line = 0]) => ({
    codepoint: text.codePointAt(index) ?? 0,
    index,
    end: index + 1,
    glyphId: 1,
    level,
    line,
    x,
    y: line * 20 + 15,
    advance: 10,
    run: 0,
  }));
  return {
    text,
    glyphs,
    lines,
    runs: [],
    width: Math.max(...lines.map((line) => line.width)),
    height: lines.length * 20,
  };
}

const RTL = layoutOf('אבג', [
  [0, 20, 1],
  [1, 10, 1],
  [2, 0, 1],
]);
const MIXED = layoutOf('aאבb', [
  [0, 0, 0],
  [1, 20, 1],
  [2, 10, 1],
  [3, 30, 0],
]);
const LTR = layoutOf('abc', [
  [0, 0, 0],
  [1, 10, 0],
  [2, 20, 0],
]);
const WRAPPED = layoutOf(
  'אבcd',
  [
    [0, 10, 1],
    [1, 0, 1],
    [2, 0, 0, 1],
    [3, 10, 0, 1],
  ],
  [2, 4],
);

function arrow(
  state: EditorState,
  direction: -1 | 1,
  layout: TextLayout | undefined,
  isExtending = false,
): EditorState {
  return moveCaret(state, { unit: 'character', direction, isExtending }, layout);
}

describe('visual character arrow acceptance', () => {
  it('moves left through an RTL word and right through it from the visual left', () => {
    const start = createEditorState(RTL.text, [], 0);
    expect(arrow(start, -1, RTL)).toMatchObject({ caret: 1, anchor: 1 });
    expect(arrow(arrow(start, -1, RTL), -1, RTL)).toMatchObject({ caret: 2, anchor: 2 });
    expect(arrow(createEditorState(RTL.text, [], 3), 1, RTL)).toMatchObject({
      caret: 2,
      anchor: 2,
    });
  });

  it('keeps the anchor with Shift while the visual caret advances', () => {
    const start = createEditorState(RTL.text, [], 0);
    const first = arrow(start, -1, RTL, true);
    expect(first).toMatchObject({ caret: 1, anchor: 0 });
    expect(arrow(first, -1, RTL, true)).toMatchObject({ caret: 2, anchor: 0 });
  });

  it('collapses a same-line selection toward the screen side, regardless of text order', () => {
    const selected = { ...createEditorState(RTL.text, [], 0), anchor: 2 };
    expect(arrow(selected, -1, RTL)).toMatchObject({ caret: 2, anchor: 2 });
    expect(arrow(selected, 1, RTL)).toMatchObject({ caret: 0, anchor: 0 });
    const reversed = { ...selected, caret: 2, anchor: 0 };
    expect(arrow(reversed, -1, RTL)).toMatchObject({ caret: 2, anchor: 2 });
  });

  it('uses primary caret x for mixed-line selection collapse', () => {
    const selected = { ...createEditorState(MIXED.text, [], 0), anchor: 2 };
    expect(arrow(selected, -1, MIXED)).toMatchObject({ caret: 0, anchor: 0 });
    expect(arrow(selected, 1, MIXED)).toMatchObject({ caret: 2, anchor: 2 });
  });

  it('preserves text-order movement without a layout, on LTR lines, and for words', () => {
    for (const direction of [-1, 1] as const) {
      const state = { ...createEditorState(LTR.text, [], 1), anchor: 2 };
      expect(arrow(state, direction, LTR)).toEqual(
        moveHorizontal(state, direction, 'character', false),
      );
      expect(arrow(state, direction, undefined)).toEqual(
        moveHorizontal(state, direction, 'character', false),
      );
      const word = { unit: 'word', direction, isExtending: true } as const;
      expect(moveCaret(state, word, MIXED)).toEqual(moveHorizontal(state, direction, 'word', true));
    }
  });

  it('keeps text-order selection collapse across lines', () => {
    const state = { ...createEditorState(WRAPPED.text, [], 1), anchor: 3 };
    expect(arrow(state, -1, WRAPPED)).toEqual(moveHorizontal(state, -1, 'character', false));
    expect(arrow(state, 1, WRAPPED)).toEqual(moveHorizontal(state, 1, 'character', false));
  });
});
