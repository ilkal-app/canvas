import { describe, expect, it } from 'vitest';

import {
  listParagraphsOf,
  paragraphRange,
  plainParagraphsOf,
  spliceParagraphs,
  touchedParagraphs,
  withoutParagraphs,
} from './paragraph-edits.js';

describe('paragraph edits', () => {
  it('gives one plain style per paragraph and each paragraph’s range', () => {
    expect(plainParagraphsOf('a\n\nb')).toEqual([{}, {}, {}]);
    expect(paragraphRange('ab\ncd\n', 0)).toEqual([0, 2]);
    expect(paragraphRange('ab\ncd\n', 1)).toEqual([3, 5]);
    expect(paragraphRange('ab\ncd\n', 2)).toEqual([6, 6]);
  });

  it('keeps the first touched paragraph’s style across a splice', () => {
    const styles = [{ list: 'bullet' as const }, {}, { list: 'numbered' as const }];
    expect(spliceParagraphs(styles, 'a\nb\nc', 1, 1, 'x\ny')).toEqual([
      { list: 'bullet' },
      { list: 'bullet' },
      {},
      { list: 'numbered' },
    ]);
    // 'a\nb' goes: the joined paragraph keeps the first's style, 'c' keeps its own.
    expect(spliceParagraphs(styles, 'a\nb\nc', 0, 3, '')).toEqual([
      { list: 'bullet' },
      { list: 'numbered' },
    ]);
    expect(spliceParagraphs(styles, 'a\nb\nc', 0, 1, 'z')).toBe(styles);
  });

  it('does not touch a paragraph a selection ends at the start of', () => {
    expect(touchedParagraphs('a\nb\nc', 0, 2)).toEqual([0, 0]);
    expect(touchedParagraphs('a\nb\nc', 0, 3)).toEqual([0, 1]);
    expect(touchedParagraphs('a\nb\nc', 2, 2)).toEqual([1, 1]);
  });

  it('lists paragraphs only when one is a list, and drops them from a copy', () => {
    expect(listParagraphsOf({ paragraphs: [{}, {}] })).toBeUndefined();
    expect(listParagraphsOf({})).toBeUndefined();
    expect(listParagraphsOf({ paragraphs: [{}, { list: 'bullet' }] })).toEqual([
      {},
      { list: 'bullet' },
    ]);
    const content = { text: 'a', paragraphs: [{ list: 'bullet' as const }] };
    expect(withoutParagraphs(content)).toEqual({ text: 'a' });
    expect(content.paragraphs).toHaveLength(1);
  });
});
