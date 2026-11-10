// Independent acceptance:, theme-aware ink as approved at 5c73722a.
import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';
import { sampleObject, SAMPLE_STYLE } from '../objects/__fixtures__/object-samples.js';

describe('ink value acceptance', () => {
  it.each(['shape', 'line', 'connector', 'path'] as const)(
    'accepts ink as a %s stroke but preserves a black tuple',
    (type) => {
      expect(
        schema.boardObjectSchema.safeParse({
          ...sampleObject(type, 'drawn'),
          stroke: { color: 'ink', width: 2 },
        }).success,
      ).toBe(true);
      const black = { ...sampleObject(type, 'drawn'), stroke: { color: [0, 0, 0, 1], width: 2 } };
      expect(schema.boardObjectSchema.parse(black)).toEqual(black);
    },
  );
  it('accepts ink text and keeps the token through portable JSON', () => {
    const text = {
      ...sampleObject('text', 'text'),
      text: 'Ink',
      runs: [{ length: 3, style: { ...SAMPLE_STYLE, color: 'ink' } }],
    };
    expect(schema.boardObjectSchema.safeParse(text).success).toBe(true);
    const portable = {
      format: schema.PORTABLE_BOARD_FORMAT,
      schemaVersion: schema.SCHEMA_VERSION,
      objects: [text],
    };
    expect(schema.exportBoard(schema.importBoard(portable)).objects).toEqual([text]);
  });
  it.each(['Ink', 'INK', '', '#ffffff', { type: 'ink' }])(
    'refuses an unrecognised token %j',
    (color) => {
      expect(
        schema.boardObjectSchema.safeParse({
          ...sampleObject('line', 'l'),
          stroke: { color, width: 2 },
        }).success,
      ).toBe(false);
    },
  );
  it('refuses ink in fills, frame backgrounds, sticky colours and gradient stops', () => {
    for (const object of [
      { ...sampleObject('shape', 's'), fill: 'ink' },
      { ...sampleObject('frame', 'f'), background: 'ink' },
      { ...sampleObject('sticky', 'n'), color: 'ink' },
      {
        ...sampleObject('shape', 's'),
        fill: {
          type: 'linear',
          angle: 0,
          stops: [
            { offset: 0, color: 'ink' },
            { offset: 1, color: [1, 1, 1, 1] },
          ],
        },
      },
    ])
      expect(schema.boardObjectSchema.safeParse(object).success).toBe(false);
  });
  it('pins viewer resolutions to the theme ink tokens', () => {
    const api = schema as unknown as Record<string, unknown>;
    expect(api.INK_COLORS).toEqual({
      // Vellum ink/primary #1E1F1C and Graphite ink/primary #ECEBE5.
      // Derives ink from theme tokens, rather than a separate palette.
      light: [30 / 255, 31 / 255, 28 / 255, 1],
      dark: [236 / 255, 235 / 255, 229 / 255, 1],
    });
  });
});
