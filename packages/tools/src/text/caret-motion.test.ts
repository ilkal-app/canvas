import { describe, expect, it } from 'vitest';

import { monoLayout } from './__fixtures__/mono-layout.js';
import { moveCaret } from './caret-motion.js';
import { createEditorState } from './editor-state.js';
import { BASE, runsOf } from './runs/__fixtures__/text-styles.js';

const TEXT = 'one two\nthree';
const RUNS = runsOf([TEXT.length, BASE]);
const LAYOUT = monoLayout(TEXT, RUNS);

describe('moveCaret', () => {
  it('moves by character and word along the text', () => {
    const state = createEditorState(TEXT, RUNS, 0);
    expect(
      moveCaret(state, { unit: 'character', direction: 1, isExtending: false }, LAYOUT),
    ).toMatchObject({ caret: 1, anchor: 1 });
    expect(
      moveCaret(state, { unit: 'word', direction: 1, isExtending: true }, LAYOUT),
    ).toMatchObject({
      caret: 3,
      anchor: 0,
    });
  });

  it('moves by line and to line edges through the layout', () => {
    const state = createEditorState(TEXT, RUNS, 2);
    expect(moveCaret(state, { unit: 'line', direction: 1, isExtending: false }, LAYOUT).caret).toBe(
      10,
    );
    expect(
      moveCaret(state, { unit: 'lineEdge', direction: 1, isExtending: false }, LAYOUT).caret,
    ).toBe(7);
  });

  it('follows hard lines for line moves while the text cannot be laid out', () => {
    const state = createEditorState(TEXT, RUNS, 2);
    // Down keeps the column on the next hard line ('three'), not the text's end.
    expect(
      moveCaret(state, { unit: 'line', direction: 1, isExtending: false }, undefined).caret,
    ).toBe(10);
    expect(
      moveCaret(state, { unit: 'lineEdge', direction: -1, isExtending: true }, undefined),
    ).toMatchObject({ caret: 0, anchor: 2 });
    expect(
      moveCaret(state, { unit: 'textEdge', direction: 1, isExtending: false }, LAYOUT).caret,
    ).toBe(TEXT.length);
  });
});
