import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';
import { sampleObject, SAMPLE_STYLE } from '../objects/__fixtures__/object-samples.js';
import { stickyObjectSchema } from '../objects/sticky-object.js';
import { textObjectSchema } from '../objects/text-object.js';

import type { ParagraphStyle } from './paragraph-style.js';
import { textContentSchema } from './text-content.js';
import { isSameTextStyle, textStyleSchema } from './text-style.js';

const { paragraphCount, paragraphStyleSchema } = schema;
const content = (text: string, paragraphs?: unknown) => ({
  text,
  runs: [{ length: text.length, style: SAMPLE_STYLE }],
  ...(paragraphs === undefined ? {} : { paragraphs }),
});

describe('text lists schema', () => {
  it('counts empty and newline-delimited paragraphs', () => {
    expect(Reflect.get(schema, 'MAX_LIST_LEVEL')).toBe(3);
    expect(paragraphCount('')).toBe(1);
    expect(paragraphCount('a\nb\n')).toBe(3);
  });

  it('accepts only strict list styles with levels 0 through 3', () => {
    for (const value of [
      {},
      { list: 'bullet' },
      { list: 'numbered', level: 0 },
      { list: 'bullet', level: 3 },
    ]) {
      expect(paragraphStyleSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [
      { level: 1 },
      { list: 'roman' },
      { list: 'bullet', level: -1 },
      { list: 'bullet', level: 4 },
      { list: 'bullet', level: 1.5 },
      { list: 'bullet', extra: true },
    ]) {
      expect(paragraphStyleSchema.safeParse(value).success).toBe(false);
    }
  });

  it('accepts decoration booleans and merges false with absent', () => {
    expect(
      textStyleSchema.safeParse({ ...SAMPLE_STYLE, underline: true, strikethrough: true }).success,
    ).toBe(true);
    expect(textStyleSchema.safeParse({ ...SAMPLE_STYLE, underline: 'yes' }).success).toBe(false);
    const equal = isSameTextStyle as (first: unknown, second: unknown) => boolean;
    expect(equal(SAMPLE_STYLE, { ...SAMPLE_STYLE, underline: false })).toBe(true);
    expect(equal(SAMPLE_STYLE, { ...SAMPLE_STYLE, strikethrough: false })).toBe(true);
    expect(equal(SAMPLE_STYLE, { ...SAMPLE_STYLE, underline: true })).toBe(false);
    expect(equal(SAMPLE_STYLE, { ...SAMPLE_STYLE, strikethrough: true })).toBe(false);
  });

  it('validates paragraph count and styles on content, text, sticky, and labels', () => {
    const valid = {
      text: 'one\ntwo\nthree',
      runs: [{ length: 'one\ntwo\nthree'.length, style: SAMPLE_STYLE }],
      paragraphs: [
        {},
        { list: 'bullet', level: 2 },
        { list: 'numbered', level: 1 },
      ] satisfies ParagraphStyle[],
    };
    expect(textContentSchema.safeParse(valid).success).toBe(true);
    expect(
      textObjectSchema.safeParse({ ...sampleObject('text', 'text-list'), ...valid }).success,
    ).toBe(true);
    expect(
      stickyObjectSchema.safeParse({ ...sampleObject('sticky', 'sticky-list'), ...valid }).success,
    ).toBe(true);
    expect(
      schema.boardObjectSchema.safeParse(sampleObject('shape', 'shape-list', { label: valid }))
        .success,
    ).toBe(true);
    expect(
      schema.boardObjectSchema.safeParse(
        sampleObject('connector', 'connector-list', { label: valid }),
      ).success,
    ).toBe(true);
    for (const paragraphs of [
      [],
      [{}],
      [{}, {}, {}, {}],
      [{}, { level: 1 }, {}],
      [{}, { list: 'bullet', extra: true }, {}],
      [{}, { list: 'roman' }, {}],
      [{}, { list: 'bullet', level: 4 }, {}],
    ]) {
      expect(textContentSchema.safeParse(content(valid.text, paragraphs)).success).toBe(false);
      expect(
        textObjectSchema.safeParse({
          ...sampleObject('text', 'text-list'),
          ...content(valid.text, paragraphs),
        }).success,
      ).toBe(false);
      expect(
        stickyObjectSchema.safeParse({
          ...sampleObject('sticky', 'sticky-list'),
          ...content(valid.text, paragraphs),
        }).success,
      ).toBe(false);
    }
    expect(textContentSchema.safeParse(content('', [{}])).success).toBe(true);
    expect(textContentSchema.safeParse(content('', [])).success).toBe(false);
  });
});
