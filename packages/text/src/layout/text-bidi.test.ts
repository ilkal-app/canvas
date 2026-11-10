// A text's layout levels, where a character rule X9 removes takes the level before it.
import { describe, expect, it } from 'vitest';

import { orderLine } from './bidi-line.js';
import { textBidi } from './text-bidi.js';

describe('textBidi', () => {
  it('gives an embedding character the level of the character before it', () => {
    const bidi = textBidi('a\u202bb\u202cc');
    expect(Array.from(bidi?.levels ?? [])).toEqual([0, 0, 2, 2, 0]);
    expect(Array.from(bidi?.paragraphLevels ?? [])).toEqual([0, 0, 0, 0, 0]);
  });

  it('orders the empty line after a final newline without reading past the text', () => {
    const text = 'abc \u05d0\n';
    const bidi = textBidi(text);
    if (bidi === undefined) throw new Error('expected bidi levels');
    expect(orderLine(text, [], bidi, text.length)).toEqual({ items: [], levels: [] });
  });

  it('has none for text without right-to-left or formatting characters', () => {
    expect(textBidi('plain text')).toBeUndefined();
  });
});
