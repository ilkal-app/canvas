import { describe, expect, it } from 'vitest';

import { mirrorEditOf, mirrorOf } from './text-mirror.js';

describe('mirrorOf', () => {
  it('mirrors a short text whole, with the selection and its direction', () => {
    expect(mirrorOf('hello', 1, 4)).toEqual({
      offset: 0,
      value: 'hello',
      selectionStart: 1,
      selectionEnd: 4,
      direction: 'backward',
    });
    expect(mirrorOf('hello', 5, 5)).toMatchObject({ selectionStart: 5, direction: 'forward' });
  });

  it('mirrors a window around the caret of a long text', () => {
    const text = 'x'.repeat(10_000);
    const middle = mirrorOf(text, 5_000, 5_000);
    expect(middle).toMatchObject({ offset: 4_000, selectionStart: 1_000, selectionEnd: 1_000 });
    expect(middle.value).toHaveLength(2_000);
    expect(mirrorOf(text, 10, 10)).toMatchObject({ offset: 0, selectionStart: 10 });
    expect(mirrorOf(text, 9_990, 9_990)).toMatchObject({ offset: 8_000, selectionStart: 1_990 });
  });

  it('keeps a long selection whole, and never splits a surrogate pair', () => {
    const text = 'y'.repeat(4_000);
    const all = mirrorOf(text, 0, 4_000, 100);
    expect(all.value).toHaveLength(4_000);
    const emoji = `${'a'.repeat(49)}😀${'b'.repeat(100)}`;
    const window = mirrorOf(emoji, 100, 100, 100);
    expect(window.offset).toBe(49);
    expect(window.value.startsWith('😀')).toBe(true);
  });
});

describe('mirrorEditOf', () => {
  const at = (value: string, start: number, end = start) => ({
    offset: 0,
    value,
    selectionStart: start,
    selectionEnd: end,
    direction: 'forward' as const,
  });

  it('finds nothing when the value is the one mirrored', () => {
    expect(mirrorEditOf(at('abc', 1), 'abc', 1)).toBeUndefined();
  });

  it('finds a delete before or after the caret', () => {
    expect(mirrorEditOf(at('abc', 2), 'ac', 1)).toEqual({ start: 1, end: 2, text: '' });
    expect(mirrorEditOf(at('abc', 1), 'ac', 1)).toEqual({ start: 1, end: 2, text: '' });
  });

  it('places a repeated character where the caret was', () => {
    expect(mirrorEditOf(at('aa', 1), 'aaa', 2)).toEqual({ start: 1, end: 1, text: 'a' });
  });

  it('finds a replacement of the selection and an autocorrected word', () => {
    expect(mirrorEditOf(at('one two', 4, 7), 'one six', 7)).toEqual({
      start: 4,
      end: 7,
      text: 'six',
    });
    // The edit reaches the caret: what the keyboard rewrote up to it is replaced.
    expect(mirrorEditOf(at('teh ', 4), 'the ', 4)).toEqual({ start: 1, end: 4, text: 'he ' });
  });

  it('never splits a surrogate pair', () => {
    expect(mirrorEditOf(at('😀', 2), '😁', 2)).toEqual({ start: 0, end: 2, text: '😁' });
  });
});
