import { describe, expect, it } from 'vitest';

import { newTextObject, PASTED_TEXT_STYLE, textContentOf } from './pasted-text.js';

describe('pasted text', () => {
  it('merges pieces of equal style into one run and skips empty pieces', () => {
    const bold = { ...PASTED_TEXT_STYLE, weight: 700 as const };
    expect(
      textContentOf([
        { text: 'a', style: PASTED_TEXT_STYLE },
        { text: '', style: bold },
        { text: 'b', style: PASTED_TEXT_STYLE },
        { text: 'c', style: bold },
      ]),
    ).toEqual({
      text: 'abc',
      runs: [
        { length: 2, style: PASTED_TEXT_STYLE },
        { length: 1, style: bold },
      ],
    });
    expect(textContentOf([{ text: '', style: bold }])).toBeUndefined();
  });

  it('makes an auto-width text centred on the point, sized from its lines', () => {
    const content = textContentOf([{ text: 'abcd\nab', style: PASTED_TEXT_STYLE }]);
    if (content === undefined) throw new Error('there is text');
    // Four characters at 0.6 × 16, two lines at 1.25 × 16.
    expect(newTextObject(content, { x: 100, y: 100 })).toMatchObject({
      type: 'text',
      parentId: null,
      x: 100 - 19.2,
      y: 80,
      width: 38.4,
      height: 40,
      autoWidth: true,
      text: 'abcd\nab',
    });
  });

  it('keeps a pasted list’s paragraph styles, and writes none for plain text', () => {
    const runs = [{ length: 3, style: PASTED_TEXT_STYLE }];
    const listed = newTextObject(
      { text: 'a\nb', runs, paragraphs: [{ list: 'bullet' }, {}] },
      { x: 0, y: 0 },
    );
    expect(listed).toMatchObject({ paragraphs: [{ list: 'bullet' }, {}] });
    const plain = newTextObject({ text: 'a\nb', runs, paragraphs: [{}, {}] }, { x: 0, y: 0 });
    expect(plain).not.toHaveProperty('paragraphs');
  });
});
