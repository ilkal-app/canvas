import { describe, expect, it } from 'vitest';

import { monoLayout } from './__fixtures__/mono-layout.js';
import { moveCaret } from './caret-motion.js';
import { hardLineAt, setCaret } from './editor-navigation.js';
import { createEditorState } from './editor-state.js';
import { deleteBackward, deleteForward } from './editor.js';
import { nextGraphemeIndex, previousGraphemeIndex } from './grapheme-steps.js';
import { BASE, runsOf } from './runs/__fixtures__/text-styles.js';

// The contract of this public pure helper from editor-navigation.ts.

const TERMINATORS = [
  ['LF', '\n'],
  ['CR LF', '\r\n'],
  ['CR', '\r'],
  ['NEL', '\u0085'],
  ['VT', '\v'],
  ['FF', '\f'],
  ['LS', '\u2028'],
  ['PS', '\u2029'],
] as const;

function state(text: string, caret: number) {
  return createEditorState(text, runsOf([text.length, BASE]), caret);
}

function move(
  text: string,
  index: number,
  unit: 'line' | 'lineEdge' | 'textEdge',
  direction: -1 | 1,
  isExtending = false,
  hasLayout = false,
) {
  return moveCaret(
    state(text, index),
    { unit, direction, isExtending },
    hasLayout ? monoLayout(text, runsOf([text.length, BASE])) : undefined,
  );
}

describe('CR LF is one editing unit', () => {
  it('grapheme steps and setCaret never stop between CR and LF', () => {
    const text = 'a\r\nb';
    expect(nextGraphemeIndex(text, 1)).toBe(3);
    expect(previousGraphemeIndex(text, 3)).toBe(1);
    expect(setCaret(state(text, 3), 2, false)).toMatchObject({ caret: 1, anchor: 1 });
    expect(move(text, 1, 'lineEdge', 1).caret).not.toBe(2);
    expect(
      moveCaret(state(text, 1), { unit: 'character', direction: 1, isExtending: false }, undefined)
        .caret,
    ).toBe(3);
    expect(
      moveCaret(state(text, 3), { unit: 'character', direction: -1, isExtending: false }, undefined)
        .caret,
    ).toBe(1);
  });

  it('Backspace after and Delete before CR LF remove both code units', () => {
    expect(deleteBackward(state('a\r\nb', 3))).toMatchObject({ text: 'ab', caret: 1 });
    expect(deleteForward(state('a\r\nb', 1))).toMatchObject({ text: 'ab', caret: 1 });
  });
});

describe('every hard terminator edits as one unit', () => {
  it.each(TERMINATORS.map(([name, breakText]) => ({ name, breakText })))(
    '$name is crossed and deleted in one step',
    ({ breakText }) => {
      const text = `a${breakText}b`;
      const after = 1 + breakText.length;
      expect(
        moveCaret(
          state(text, 1),
          { unit: 'character', direction: 1, isExtending: false },
          undefined,
        ).caret,
      ).toBe(after);
      expect(
        moveCaret(
          state(text, after),
          { unit: 'character', direction: -1, isExtending: false },
          undefined,
        ).caret,
      ).toBe(1);
      expect(deleteBackward(state(text, after))).toMatchObject({ text: 'ab', caret: 1 });
      expect(deleteForward(state(text, 1))).toMatchObject({ text: 'ab', caret: 1 });
    },
  );
});

describe('hardLineAt(text, index) contract', () => {
  it('is exported as a pure helper from editor-navigation.ts', () => {
    expect(hardLineAt).toBeTypeOf('function');
  });

  it.each(TERMINATORS.map(([name, breakText]) => ({ name, breakText })))(
    '$name excludes the terminator and finds both adjacent lines',
    ({ breakText }) => {
      const text = `ab${breakText}cde`;
      expect(hardLineAt(text, 1)).toEqual([0, 2]);
      expect(hardLineAt(text, 2)).toEqual([0, 2]);
      expect(hardLineAt(text, 2 + breakText.length)).toEqual([2 + breakText.length, text.length]);
    },
  );

  it('keeps the CR LF interior on the preceding line and handles empty lines', () => {
    expect(hardLineAt('ab\r\ncd', 3)).toEqual([0, 2]);
    expect(hardLineAt('\n', 0)).toEqual([0, 0]);
    expect(hardLineAt('\n', 1)).toEqual([1, 1]);
    expect(hardLineAt('', 0)).toEqual([0, 0]);
  });
});

describe('line motion for every terminator', () => {
  it.each(TERMINATORS.map(([name, breakText]) => ({ name, breakText })))(
    '$name Home and End stay on the hard line, with and without layout',
    ({ breakText }) => {
      const text = `ab${breakText}cde`;
      const second = 2 + breakText.length;
      for (const hasLayout of [false, true]) {
        expect(move(text, second + 1, 'lineEdge', -1, false, hasLayout)).toMatchObject({
          caret: second,
          anchor: second,
        });
        expect(move(text, 1, 'lineEdge', 1, false, hasLayout)).toMatchObject({
          caret: 2,
          anchor: 2,
        });
        expect(move(text, second + 1, 'lineEdge', 1, false, hasLayout).caret).toBe(text.length);
      }
    },
  );

  it.each(TERMINATORS.map(([name, breakText]) => ({ name, breakText })))(
    '$name Up and Down follow hard lines with no layout',
    ({ breakText }) => {
      const text = `abc${breakText}xy${breakText}pqrst`;
      const second = 3 + breakText.length;
      const third = second + 2 + breakText.length;
      expect(move(text, second + 1, 'line', -1).caret).toBe(1);
      expect(move(text, second + 1, 'line', 1).caret).toBe(third + 1);
      expect(move(text, 3, 'line', 1).caret).toBe(second + 2);
      expect(move(text, third + 4, 'line', -1).caret).toBe(second + 2);
      expect(move(text, 1, 'line', -1).caret).toBe(0);
      expect(move(text, third + 1, 'line', 1).caret).toBe(text.length);
    },
  );

  it.each(TERMINATORS.map(([name, breakText]) => ({ name, breakText })))(
    '$name Up and Down follow laid-out hard lines',
    ({ breakText }) => {
      const text = `abc${breakText}xyz`;
      const second = 3 + breakText.length;
      expect(move(text, second + 1, 'line', -1, false, true).caret).toBe(1);
      expect(move(text, 1, 'line', 1, false, true).caret).toBe(second + 1);
    },
  );

  it('Shift extends line motion while text-edge motion retains its meaning', () => {
    const text = 'ab\ncd\nef';
    expect(move(text, 4, 'lineEdge', -1, true)).toMatchObject({ caret: 3, anchor: 4 });
    expect(move(text, 4, 'line', -1, true)).toMatchObject({ caret: 1, anchor: 4 });
    expect(move(text, 4, 'line', 1, true)).toMatchObject({ caret: 7, anchor: 4 });
    expect(move(text, 4, 'textEdge', -1)).toMatchObject({ caret: 0, anchor: 0 });
    expect(move(text, 4, 'textEdge', 1, true)).toMatchObject({ caret: text.length, anchor: 4 });
  });
});
