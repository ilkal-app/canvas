import { describe, expect, it } from 'vitest';

import {
  isSameParagraphStyle,
  MAX_LIST_LEVEL,
  paragraphCount,
  paragraphStyleSchema,
} from './paragraph-style.js';

describe('paragraphCount', () => {
  it('counts the text split on newlines, empty text as one paragraph', () => {
    expect(paragraphCount('')).toBe(1);
    expect(paragraphCount('one')).toBe(1);
    expect(paragraphCount('one\ntwo')).toBe(2);
    expect(paragraphCount('one\n')).toBe(2);
    expect(paragraphCount('\n\n')).toBe(3);
  });
});

describe('paragraphStyleSchema', () => {
  it('accepts a plain paragraph and list items at every level', () => {
    expect(paragraphStyleSchema.safeParse({}).success).toBe(true);
    for (let level = 0; level <= MAX_LIST_LEVEL; level += 1) {
      expect(paragraphStyleSchema.safeParse({ list: 'numbered', level }).success).toBe(true);
    }
  });

  it('refuses a level without a list, a level out of range and an unknown kind', () => {
    expect(paragraphStyleSchema.safeParse({ level: 1 }).success).toBe(false);
    expect(
      paragraphStyleSchema.safeParse({ list: 'bullet', level: MAX_LIST_LEVEL + 1 }).success,
    ).toBe(false);
    expect(paragraphStyleSchema.safeParse({ list: 'checklist' }).success).toBe(false);
  });
});

describe('isSameParagraphStyle', () => {
  it('treats a missing level as 0 and every plain paragraph as the same', () => {
    expect(isSameParagraphStyle({}, {})).toBe(true);
    expect(isSameParagraphStyle({ list: 'bullet' }, { list: 'bullet', level: 0 })).toBe(true);
  });

  it('tells kinds and levels apart', () => {
    expect(isSameParagraphStyle({ list: 'bullet' }, { list: 'numbered' })).toBe(false);
    expect(isSameParagraphStyle({ list: 'bullet', level: 1 }, { list: 'bullet', level: 2 })).toBe(
      false,
    );
    expect(isSameParagraphStyle({}, { list: 'bullet' })).toBe(false);
  });
});
