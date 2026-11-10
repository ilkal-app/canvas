import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import * as publicSchema from '@canvas/schema';

import { textStyleOverrideSchema } from '../instances/instance-overrides.js';
import { MIGRATIONS } from '../migrations/migration-registry.js';
import { runMigrations } from '../migrations/run-migrations.js';
import * as versions from '../version/schema-version.js';

import { textStyleValueSchema, TEXT_STYLE_VALUE_FIELDS } from './named-styles.js';
import { isSameTextStyle, textStyleSchema } from './text-style.js';

const BODY = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
} as const;
const FACE = 'InterDisplay-Regular';

describe('PostScript face identity', () => {
  it('validates the OpenType name ID 6 character set and length', () => {
    const field = (publicSchema as unknown as { postScriptNameSchema?: z.ZodType })
      .postScriptNameSchema;
    expect(field).toBeDefined();
    for (const name of ['A', FACE, 'A'.repeat(63), 'A!#_+-.:=?@^~']) {
      expect(field?.safeParse(name).success, name).toBe(true);
    }
    for (const name of [
      '',
      'A'.repeat(64),
      'A B',
      'A/B',
      'A%B',
      'A[B',
      'A(B',
      'A{B',
      'A<B',
      'Café',
      'A\u007fB',
    ]) {
      expect(field?.safeParse(name).success, name).toBe(false);
    }
  });

  it('accepts a face on runs, named styles, and instance overrides while remaining strict', () => {
    expect(textStyleSchema.safeParse({ ...BODY, postScriptName: FACE }).success).toBe(true);
    expect(
      textStyleValueSchema.safeParse({
        fontFamily: 'Inter',
        fontSize: 16,
        weight: 400,
        italic: false,
        postScriptName: FACE,
      }).success,
    ).toBe(true);
    expect(textStyleOverrideSchema.safeParse({ postScriptName: FACE }).success).toBe(true);
    expect(TEXT_STYLE_VALUE_FIELDS).toContain('postScriptName');
    expect(textStyleSchema.parse(BODY)).not.toHaveProperty('postScriptName');
    expect(textStyleSchema.safeParse({ ...BODY, unknownFaceField: FACE }).success).toBe(false);
  });

  it('compares face names so adjacent runs with different faces stay distinct', () => {
    const base = textStyleSchema.parse(BODY);
    const display = { ...base, postScriptName: FACE };
    const narrow = { ...base, postScriptName: 'InterNarrow-Regular' };
    expect(isSameTextStyle(base, { ...base })).toBe(true);
    expect(isSameTextStyle(display, { ...display })).toBe(true);
    expect(isSameTextStyle(base, display)).toBe(false);
    expect(isSameTextStyle(display, narrow)).toBe(false);
  });
});

describe('PostScript name schema migration', () => {
  it('registers version 28 as an identity migration', () => {
    const step = (versions as unknown as Record<string, number>).POSTSCRIPT_NAME_VERSION ?? 0;
    expect(step).toBe(28);
    expect(versions.SCHEMA_VERSION).toBeGreaterThanOrEqual(step);
    expect((publicSchema as unknown as Record<string, unknown>).POSTSCRIPT_NAME_VERSION).toBe(28);
    expect(MIGRATIONS.has(28)).toBe(true);
    const before = {
      schemaVersion: 27,
      objects: [{ id: 'old', type: 'text', runs: [{ length: 1, style: { weight: 400 } }] }],
    };
    const input = structuredClone(before);
    expect(runMigrations(input, MIGRATIONS, 28)).toEqual({ ...before, schemaVersion: 28 });
    expect(input).toEqual(before);
  });
});
