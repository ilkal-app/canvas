import { describe, expect, it } from 'vitest';

import type { Rgba, TextObject } from '@canvas/schema';

import { monoLayout } from './__fixtures__/mono-layout.js';
import { createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import { textEditingRects, type TextEditingRectsInput } from './text-editing-rects.js';
import { TextEditingSession } from './text-session.js';

const RED: Rgba = [1, 0, 0, 1];

type SelectionSession = Omit<TextEditingSession, 'updateComposition' | 'displayed'> & {
  updateComposition(text: string, selection?: readonly [number, number]): void;
  displayed(): ReturnType<TextEditingSession['displayed']> & {
    readonly compositionSelection?: readonly [number, number] | undefined;
  };
};

type SelectionRectsInput = TextEditingRectsInput & {
  readonly compositionSelection?: readonly [number, number] | undefined;
};

function sessionAt(caret: number) {
  const object = tenPointText('composition', 'abcd');
  const fixture = createTextModeContext([object]);
  const session = new TextEditingSession(fixture.context, object, caret) as SelectionSession;
  const read = (): TextObject => fixture.store.get(object.id) as TextObject;
  return { ...fixture, session, read };
}

function rectInput(fields: Partial<SelectionRectsInput> = {}): SelectionRectsInput {
  const text = 'ab中文cd';
  return {
    layout: monoLayout(text, [{ length: text.length, style: TEN }]),
    box: { x: 0, y: 0, width: 36, height: 12.5 },
    transform: { cos: 1, sin: 0, x: 0, y: 0 },
    selection: [4, 4],
    caret: 4,
    composition: [2, 4],
    caretColor: RED,
    zoom: 2,
    ...fields,
  };
}

describe('IME composition selection acceptance', () => {
  it('shows a collapsed IME caret as an absolute UTF-16 range and defaults to the end', () => {
    const { session, read } = sessionAt(2);
    session.startComposition();
    session.updateComposition('zhongwen', [3, 3]);
    expect(session.displayed()).toMatchObject({
      text: 'abzhongwencd',
      composition: [2, 10],
      compositionSelection: [5, 5],
    });
    expect(read().text).toBe('abcd');
    session.updateComposition('中文');
    expect(session.displayed()).toMatchObject({
      composition: [2, 4],
      compositionSelection: [4, 4],
    });
  });

  it('clamps a target clause to the composition in UTF-16 units', () => {
    const { session } = sessionAt(2);
    session.updateComposition('中😀文', [-2, 99]);
    expect(session.displayed()).toMatchObject({
      text: 'ab中😀文cd',
      composition: [2, 6],
      compositionSelection: [2, 6],
    });
    session.updateComposition('中😀文', [1, 3]);
    expect(session.displayed().compositionSelection).toEqual([3, 5]);
  });

  it('commits once in the run style, puts the caret after Chinese, and clears the target', () => {
    const { session, read, record } = sessionAt(2);
    session.startComposition();
    session.updateComposition('中文', [0, 1]);
    const writesBeforeCommit = record.capture.length;
    expect(read().text).toBe('abcd');
    session.commitComposition('中文');
    expect(read()).toMatchObject({
      text: 'ab中文cd',
      runs: [{ length: 6, style: TEN }],
    });
    expect(session.editor).toMatchObject({ caret: 4, anchor: 4 });
    expect(session.displayed().compositionSelection).toBeUndefined();
    expect(record.capture.slice(writesBeforeCommit)).toHaveLength(1);
  });

  it('cancels without changing the text and clears the target', () => {
    const { session, read, record } = sessionAt(2);
    session.startComposition();
    session.updateComposition('中', [0, 1]);
    const writesBeforeCancel = record.capture.length;
    session.commitComposition('');
    expect(read().text).toBe('abcd');
    expect(session.editor).toMatchObject({ caret: 2, anchor: 2 });
    expect(session.displayed().compositionSelection).toBeUndefined();
    expect(record.capture).toHaveLength(writesBeforeCancel);
  });

  it('places the caret inside a collapsed composition selection', () => {
    const rects = textEditingRects(rectInput({ compositionSelection: [3, 3] }));
    const caret = rects.filter(({ color, box }) => color === RED && box.width < 2);
    expect(caret).toHaveLength(1);
    expect(caret[0]?.box.x).toBeCloseTo(18 - 0.375);
  });

  it('draws a two-pixel target underline, a one-pixel remainder, and no caret', () => {
    const rects = textEditingRects(rectInput({ compositionSelection: [2, 3] }));
    const red = rects
      .filter(({ color, box }) => color === RED && box.width > 2)
      .map(({ box }) => box)
      .sort((left, right) => left.x - right.x);
    expect(red).toMatchObject([
      { x: 12, width: 6, height: 1 },
      { x: 18, width: 6, height: 0.5 },
    ]);
    expect(red.every(({ y }) => y >= 10.5 && y <= 12)).toBe(true);
    expect(rects.filter(({ color, box }) => color === RED && box.width < 2)).toHaveLength(0);
  });

  it('keeps the existing rectangles when the composition selection is omitted', () => {
    const rects = textEditingRects(rectInput());
    expect(rects.filter(({ color }) => color === RED).map(({ box }) => box)).toEqual([
      { x: 12, y: 11.5, width: 12, height: 0.5, rotation: 0 },
      { x: 23.625, y: 0, width: 0.75, height: 12.5, rotation: 0 },
    ]);
  });
});
