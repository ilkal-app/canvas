import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import { layoutText } from '@canvas/text';

import { FakeGlyphMeasurer } from './__fixtures__/fake-glyph-measurer.js';
import { caretRect, hitTest, indexAtLine, lineEndIndex, lineOf } from './caret.js';

const STYLE: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const MEASURER = new FakeGlyphMeasurer();
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

function lay(text: string) {
  return layoutText(text, [{ length: text.length, style: STYLE }], null, MEASURER);
}

describe('hard terminator caret acceptance', () => {
  it.each(TERMINATORS.map(([name, breakText]) => ({ name, breakText })))(
    '$name ends its line before the terminator in hit testing',
    ({ breakText }) => {
      const layout = lay(`a${breakText}b`);
      expect(layout.lines).toHaveLength(2);
      expect(lineEndIndex(layout, 0)).toBe(1);
      expect(indexAtLine(layout, 0, 1_000)).toBe(1);
      expect(hitTest(layout, { x: 1_000, y: (layout.lines[0]?.y ?? 0) + 1 })).toBe(1);
      expect(indexAtLine(layout, 1, -1_000)).toBe(1 + breakText.length);
    },
  );

  it('maps the forbidden CR LF interior index to the CR line and its end caret', () => {
    const layout = lay('a\r\nb');
    expect(lineOf(layout, 1)).toBe(0);
    expect(lineOf(layout, 2)).toBe(0);
    expect(lineOf(layout, 3)).toBe(1);
    expect(caretRect(layout, 2)).toEqual(caretRect(layout, 1));
    expect(indexAtLine(layout, 0, 1_000)).toBe(1);
    expect(hitTest(layout, { x: 1_000, y: (layout.lines[0]?.y ?? 0) + 1 })).toBe(1);
  });
});
