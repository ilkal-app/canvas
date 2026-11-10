import { describe, expect, it } from 'vitest';

import * as publicSchema from '@canvas/schema';

import { TEXT_STYLE_VALUE_FIELDS, textStyleValueSchema } from './named-styles.js';
import * as styles from './text-style.js';

const { fontVariationsSchema, MAX_FONT_VARIATION_AXES, isSameTextStyle, textStyleSchema } = styles;

const BODY = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
} as const;

describe('font variation coordinates', () => {
  it('accepts empty and bounded OpenType axis maps in run and named styles', () => {
    expect(MAX_FONT_VARIATION_AXES).toBe(16);
    expect((publicSchema as unknown as Record<string, unknown>).fontVariationsSchema).toBe(
      fontVariationsSchema,
    );
    expect((publicSchema as unknown as Record<string, unknown>).MAX_FONT_VARIATION_AXES).toBe(16);
    for (const fontVariations of [{}, { wght: 650, wdth: 87.5, 'A!  ': -32768 }, { opsz: 32767 }]) {
      expect(fontVariationsSchema.safeParse(fontVariations).success).toBe(true);
      expect(textStyleSchema.safeParse({ ...BODY, fontVariations }).success).toBe(true);
      expect(
        textStyleValueSchema.safeParse({
          fontFamily: 'Inter',
          fontSize: 16,
          weight: 400,
          italic: false,
          fontVariations,
        }).success,
      ).toBe(true);
    }
    expect(textStyleSchema.parse(BODY)).not.toHaveProperty('fontVariations');
    expect(TEXT_STYLE_VALUE_FIELDS).toContain('fontVariations');
  });

  it('rejects invalid tags, coordinates, and more than 16 axes', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: MAX_FONT_VARIATION_AXES + 1 }, (unused, index) => [
        `a${String(index).padStart(3, '0')}`,
        index,
      ]),
    );
    for (const fontVariations of [
      [],
      null,
      'wght=650',
      { wgh: 1 },
      { weight: 1 },
      { éght: 1 },
      { '\u001fght': 1 },
      { 'wgh\u007f': 1 },
      { wght: Number.NaN },
      { wght: Infinity },
      { wght: -32769 },
      { wght: 32768 },
      { wght: '650' },
      tooMany,
    ]) {
      expect(fontVariationsSchema.safeParse(fontVariations).success).toBe(false);
      expect(textStyleSchema.safeParse({ ...BODY, fontVariations }).success).toBe(false);
    }
  });

  it('compares coordinates independent of order and treats empty as absent', () => {
    const base = textStyleSchema.parse(BODY);
    expect(isSameTextStyle(base, { ...base, fontVariations: {} })).toBe(true);
    expect(
      isSameTextStyle(
        { ...base, fontVariations: { wght: 600, wdth: 90 } },
        { ...base, fontVariations: { wdth: 90, wght: 600 } },
      ),
    ).toBe(true);
    expect(isSameTextStyle(base, { ...base, fontVariations: { wght: 600 } })).toBe(false);
    expect(
      isSameTextStyle(
        { ...base, fontVariations: { wght: 600 } },
        { ...base, fontVariations: { wght: 601 } },
      ),
    ).toBe(false);
  });
});
