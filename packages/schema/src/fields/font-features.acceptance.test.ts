import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import * as publicSchema from '@canvas/schema';

import { textStyleOverrideSchema } from '../instances/instance-overrides.js';
import { MIGRATIONS } from '../migrations/migration-registry.js';
import { runMigrations } from '../migrations/run-migrations.js';
import * as versions from '../version/schema-version.js';

import { TEXT_STYLE_VALUE_FIELDS, textStyleValueSchema } from './named-styles.js';
import { isSameTextStyle, textStyleSchema } from './text-style.js';

const BODY = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
} as const;
const fields = publicSchema as unknown as Record<string, unknown> & {
  fontFeaturesSchema?: z.ZodType;
  isSameFontFeatures?: (
    first: Record<string, number> | undefined,
    second: Record<string, number> | undefined,
  ) => boolean;
};

describe('font features schema', () => {
  it('exports a bounded record and accepts feature values on all text-style paths', () => {
    expect(fields.MAX_FONT_FEATURES).toBe(32);
    expect(fields.fontFeaturesSchema).toBeDefined();
    for (const fontFeatures of [
      { liga: 0 },
      { tnum: 1, smcp: 1 },
      { aalt: 3 },
      { 'A!  ': 65535 },
      {},
    ]) {
      expect(fields.fontFeaturesSchema?.safeParse(fontFeatures).success).toBe(true);
      expect(textStyleSchema.safeParse({ ...BODY, fontFeatures }).success).toBe(true);
      expect(
        textStyleValueSchema.safeParse({
          fontFamily: 'Inter',
          fontSize: 16,
          weight: 400,
          italic: false,
          fontFeatures,
        }).success,
      ).toBe(true);
      expect(textStyleOverrideSchema.safeParse({ fontFeatures }).success).toBe(true);
    }
    expect(TEXT_STYLE_VALUE_FIELDS).toContain('fontFeatures');
    expect(textStyleSchema.parse(BODY)).not.toHaveProperty('fontFeatures');
  });

  it('refuses invalid tags, values, too many tags, and unknown style keys', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 33 }, (unused, index) => [`a${String(index).padStart(3, '0')}`, 1]),
    );
    for (const fontFeatures of [
      { lig: 1 },
      { ligaa: 1 },
      { 'lig\u007f': 1 },
      { liga: 0.5 },
      { liga: -1 },
      { liga: 65536 },
      tooMany,
    ]) {
      expect(fields.fontFeaturesSchema?.safeParse(fontFeatures).success).toBe(false);
      expect(textStyleSchema.safeParse({ ...BODY, fontFeatures }).success).toBe(false);
    }
    expect(textStyleSchema.safeParse({ ...BODY, unknownFeature: 1 }).success).toBe(false);
  });

  it('compares tag values independently of insertion order, with empty equal to absent', () => {
    const same = fields.isSameFontFeatures;
    expect(same).toBeTypeOf('function');
    expect(same?.(undefined, {})).toBe(true);
    expect(same?.({ liga: 0, tnum: 1 }, { tnum: 1, liga: 0 })).toBe(true);
    expect(same?.({ liga: 0 }, { liga: 1 })).toBe(false);
    const base = textStyleSchema.parse(BODY);
    expect(isSameTextStyle(base, { ...base, fontFeatures: {} })).toBe(true);
    expect(
      isSameTextStyle(
        { ...base, fontFeatures: { liga: 0, tnum: 1 } },
        { ...base, fontFeatures: { tnum: 1, liga: 0 } },
      ),
    ).toBe(true);
    expect(isSameTextStyle(base, { ...base, fontFeatures: { liga: 0 } })).toBe(false);
  });
});

describe('font features version', () => {
  it('registers identity migration 29 to 30', () => {
    expect(fields.FONT_FEATURES_VERSION).toBe(30);
    expect((versions as unknown as Record<string, number>).FONT_FEATURES_VERSION).toBe(30);
    expect(versions.SCHEMA_VERSION).toBeGreaterThanOrEqual(30);
    expect(MIGRATIONS.has(30)).toBe(true);
    const before = { schemaVersion: 29, objects: [{ id: 'old', type: 'text' }] };
    const input = structuredClone(before);
    expect(runMigrations(input, MIGRATIONS, 30)).toEqual({ ...before, schemaVersion: 30 });
    expect(input).toEqual(before);
  });
});
