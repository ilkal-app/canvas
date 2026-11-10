// An image's optional outline is a stored stroke, with no default.
import { describe, expect, it } from 'vitest';

import * as publicSchema from '@canvas/schema';

import { createBoard } from '../board/board.js';
import { drawableValuesReason } from '../drawable/drawable-values.js';
import { strokeSchema } from '../fields/stroke.js';
import { MIGRATIONS } from '../migrations/migration-registry.js';
import { runMigrations } from '../migrations/run-migrations.js';
import { exportBoard } from '../portable/export-board.js';
import { importBoard } from '../portable/import-board.js';
import { colorTokenUsesOf } from '../tokens/color-token-refs.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { sampleObject } from './__fixtures__/object-samples.js';
import { boardObjectSchema } from './board-object.js';

const BORDER = { color: { token: 'accent' }, width: 2 } as const;
const image = sampleObject('image', 'border-image');

describe('image border schema', () => {
  it('accepts a stroke, null and absence without adding a default', () => {
    expect(boardObjectSchema.parse(image)).not.toHaveProperty('border');
    for (const border of [BORDER, { color: 'ink', width: 64 }, null]) {
      expect(boardObjectSchema.parse({ ...image, border })).toHaveProperty('border', border);
    }
    expect(strokeSchema.safeParse(BORDER).success).toBe(true);
  });

  it.each([
    { color: [1, 0, 0, 1], width: 0 },
    { color: 'ink', width: 65 },
    { color: { token: 'bad id' }, width: 2 },
    { color: 'red', width: 2 },
    { color: 'ink', width: 2, extra: true },
  ])('refuses an invalid border %# in the schema and relay value judge', (border) => {
    expect(boardObjectSchema.safeParse({ ...image, border }).success).toBe(false);
    expect(drawableValuesReason('style', { border })?.field).toMatch(/^border/);
  });

  it('judges a valid border and allows null or absence', () => {
    for (const border of [BORDER, null, undefined]) {
      expect(drawableValuesReason('style', { border })).toBeUndefined();
    }
  });

  it('registers schema 35 as an identity migration', () => {
    // 35, not 34: took 34 first (the ledger's swap). Bump-stable: the step to 35 is checked.
    expect((publicSchema as unknown as Record<string, unknown>).IMAGE_BORDER_VERSION).toBe(35);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(35);
    expect(MIGRATIONS.has(35)).toBe(true);
    const before = { schemaVersion: 34, objects: [image] };
    expect(runMigrations(structuredClone(before), MIGRATIONS, 35)).toEqual({
      ...before,
      schemaVersion: 35,
    });
  });

  it('finds the border colour token and preserves it through portable JSON', () => {
    const bordered = boardObjectSchema.parse({ ...image, border: BORDER });
    expect(colorTokenUsesOf(bordered)).toContainEqual({
      token: 'accent',
      path: ['border', 'color'],
    });
    const portable = exportBoard(createBoard([bordered]));
    expect(portable.objects).toEqual([bordered]);
    expect(exportBoard(importBoard(portable)).objects).toEqual([bordered]);
    expect(
      exportBoard(importBoard(exportBoard(createBoard([image])))).objects[0],
    ).not.toHaveProperty('border');
  });
});
