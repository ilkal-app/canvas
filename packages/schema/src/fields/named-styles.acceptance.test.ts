// Acceptance, written before the code.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import * as schema from '../index.js';
import { sampleObject, SAMPLE_STYLE } from '../objects/__fixtures__/object-samples.js';

const api = schema as unknown as Readonly<Record<string, unknown>>;
const VALUE = { fontFamily: 'Inter', fontSize: 24, weight: 400, italic: false };
const SHADOW = { x: 0, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 0.25] };

function required(name: string): unknown {
  const found = api[name];
  if (found === undefined) throw new Error(`missing @canvas/schema export: ${name}`);
  return found;
}

function parser(name: string): z.ZodType {
  return required(name) as z.ZodType;
}

describe('named style schema', () => {
  it('uses token-shaped ids, trimmed names with slashes, and per-kind limits', () => {
    expect(required('MAX_TEXT_STYLES')).toBe(64);
    expect(required('MAX_EFFECT_STYLES')).toBe(64);
    expect(required('MAX_SHADOW_LAYERS')).toBe(8);
    expect(parser('styleIdSchema').safeParse('style-one').success).toBe(true);
    expect(parser('styleIdSchema').safeParse('bad id').success).toBe(false);
    for (const name of ['Heading/Primary', 'x', 'x'.repeat(40)])
      expect(parser('styleNameSchema').safeParse(name).success).toBe(true);
    for (const name of ['', ' Heading', 'Heading ', '   ', 'x'.repeat(41)])
      expect(parser('styleNameSchema').safeParse(name).success).toBe(false);
  });

  it('accepts a strict text value with run bounds and no colour', () => {
    const value = parser('textStyleValueSchema');
    expect(value.safeParse(VALUE).success).toBe(true);
    expect(
      value.safeParse({ ...VALUE, letterSpacing: { unit: 'px', value: 2 }, lineHeight: 'auto' })
        .success,
    ).toBe(true);
    for (const invalid of [
      { ...VALUE, color: [1, 0, 0, 1] },
      { ...VALUE, fontSize: 3 },
      { ...VALUE, weight: 450 },
    ])
      expect(value.safeParse(invalid).success).toBe(false);
  });

  it('accepts one through eight shadows, rejects zero or nine and invalid layers', () => {
    const effect = parser('effectStyleValueSchema');
    expect(effect.safeParse({ shadows: [SHADOW] }).success).toBe(true);
    expect(effect.safeParse({ shadows: Array(8).fill(SHADOW) }).success).toBe(true);
    for (const shadows of [[], Array(9).fill(SHADOW), [{ ...SHADOW, blur: -1 }]])
      expect(effect.safeParse({ shadows }).success).toBe(false);
    expect(effect.safeParse({ shadows: [SHADOW], extra: true }).success).toBe(false);
    for (const type of ['shape', 'frame'] as const) {
      const object = sampleObject(type, type);
      expect(
        schema.boardObjectSchema.safeParse({
          ...object,
          shadow: Array(8).fill(SHADOW),
          effectStyleId: 'effect-one',
        }).success,
      ).toBe(true);
      expect(schema.boardObjectSchema.safeParse({ ...object, shadow: [] }).success).toBe(false);
      expect(
        schema.boardObjectSchema.safeParse({ ...object, shadow: Array(9).fill(SHADOW) }).success,
      ).toBe(false);
    }
  });

  it('accepts a run style id while keeping its stored colour', () => {
    expect(schema.textStyleSchema.safeParse({ ...SAMPLE_STYLE, textStyleId: 'body' }).success).toBe(
      true,
    );
    expect(
      schema.textStyleSchema.safeParse({ ...SAMPLE_STYLE, textStyleId: 'bad id' }).success,
    ).toBe(false);
  });

  it('reports missing style references as notices and keeps their stored values', () => {
    const text = {
      ...sampleObject('text', 'text'),
      runs: [{ length: 5, style: { ...SAMPLE_STYLE, textStyleId: 'gone-text' } }],
    };
    const shape = {
      ...sampleObject('shape', 'shape'),
      shadow: SHADOW,
      effectStyleId: 'gone-effect',
    };
    const issues = schema.validateBoard({
      objects: new Map<schema.ObjectId, schema.BoardObject>([
        [text.id, text],
        [shape.id, shape],
      ] as never),
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unknown-text-style',
          objectId: text.id,
          severity: 'notice',
        }),
        expect.objectContaining({
          code: 'unknown-effect-style',
          objectId: shape.id,
          severity: 'notice',
        }),
      ]),
    );
    expect(text.runs[0]?.style.color).toEqual(SAMPLE_STYLE.color);
    expect(shape.shadow).toEqual(SHADOW);
  });
});
