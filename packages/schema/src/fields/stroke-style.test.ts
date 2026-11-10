import { describe, expect, it } from 'vitest';

import { strokeStyleReason } from '../drawable/stroke-style-values.js';

import {
  strokeCapSchema,
  strokeDashSchema,
  strokeJoinSchema,
  strokeMiterLimitSchema,
  strokeStyleFields,
} from './stroke-style.js';
import { strokeSchema } from './stroke.js';

// The stroke style fields of paths, lines and connectors, siblings of `stroke`.

describe('strokeDashSchema', () => {
  it('accepts 1 to 8 lengths from 0 to 4096, not all zero, with an optional offset', () => {
    for (const dash of [
      { pattern: [4] },
      { pattern: [0, 3] },
      { pattern: [1, 2, 3, 4, 5, 6, 7, 4096], offset: -10 },
      { pattern: [2.5, 1.25], offset: 32768 },
    ]) {
      expect(strokeDashSchema.safeParse(dash).success).toBe(true);
    }
  });

  it('refuses empty, long, zero, negative, huge or non-finite patterns and unknown keys', () => {
    for (const dash of [
      { pattern: [] },
      { pattern: [1, 1, 1, 1, 1, 1, 1, 1, 1] },
      { pattern: [0, 0, 0] },
      { pattern: [4, -1] },
      { pattern: [4097] },
      { pattern: [Number.NaN] },
      { pattern: [Number.POSITIVE_INFINITY] },
      { pattern: [4], offset: 40000 },
      { pattern: [4], offset: Number.NaN },
      { pattern: [4], phase: 1 },
      [4, 2],
    ]) {
      expect(strokeDashSchema.safeParse(dash).success).toBe(false);
    }
  });

  it('agrees with the door on every case', () => {
    const cases: unknown[] = [
      { pattern: [4] },
      { pattern: [0, 0] },
      { pattern: [4], offset: 1e9 },
      { pattern: [4], extra: true },
      { pattern: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    ];
    for (const strokeDash of cases) {
      const isAccepted = strokeDashSchema.safeParse(strokeDash).success;
      expect(strokeStyleReason({ strokeDash }) === undefined).toBe(isAccepted);
    }
  });
});

describe('the join, miter limit and cap', () => {
  it('accept the SVG names and a limit from 1 to 100', () => {
    expect(strokeJoinSchema.options).toEqual(['miter', 'round', 'bevel']);
    expect(strokeCapSchema.options).toEqual(['butt', 'round', 'square']);
    expect(strokeMiterLimitSchema.safeParse(1).success).toBe(true);
    expect(strokeMiterLimitSchema.safeParse(100).success).toBe(true);
    expect(strokeMiterLimitSchema.safeParse(0.99).success).toBe(false);
    expect(strokeMiterLimitSchema.safeParse(101).success).toBe(false);
    expect(strokeJoinSchema.safeParse('ink').success).toBe(false);
    expect(strokeCapSchema.safeParse('arrow').success).toBe(false);
  });

  it('are all optional, and the dash may be null for solid', () => {
    expect(strokeStyleFields.strokeDash.safeParse(undefined).success).toBe(true);
    expect(strokeStyleFields.strokeDash.safeParse(null).success).toBe(true);
    expect(strokeStyleFields.strokeJoin.safeParse(undefined).success).toBe(true);
    expect(strokeStyleFields.strokeMiterLimit.safeParse(undefined).success).toBe(true);
    expect(strokeStyleFields.strokeCap.safeParse(undefined).success).toBe(true);
  });

  it('leave the stroke itself strict: { color, width } only', () => {
    const stroke = { color: [0, 0, 0, 1], width: 2 };
    expect(strokeSchema.safeParse(stroke).success).toBe(true);
    expect(strokeSchema.safeParse({ ...stroke, dash: [4, 2] }).success).toBe(false);
  });
});
