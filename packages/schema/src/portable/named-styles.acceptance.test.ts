// Acceptance, written before the code.
import { describe, expect, it } from 'vitest';

import { MIGRATIONS, STROKE_ALIGN_VERSION } from '../migrations/migration-registry.js';
import { runMigrations } from '../migrations/run-migrations.js';
import { sampleObject, SAMPLE_STYLE } from '../objects/__fixtures__/object-samples.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';
import { PORTABLE_BOARD_FORMAT } from './portable-board.js';

const VALUE = { fontFamily: 'Inter', fontSize: 28, weight: 700, italic: false };
const SHADOW = { x: 0, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 0.25] };
const TEXT = {
  id: 'heading',
  name: 'Type/Heading',
  value: VALUE,
  createdBy: 'user:ada',
  createdAt: 1,
};
const EFFECT = {
  id: 'depth',
  name: 'Effects/Depth',
  value: { shadows: [SHADOW] },
  createdBy: 'user:ada',
  createdAt: 1,
};

function portable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: PORTABLE_BOARD_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    objects: [],
    ...overrides,
  };
}

describe('portable named styles', () => {
  it('omits empty tables, round trips both populated tables and preserves creator identity', () => {
    expect(exportBoard(importBoard(portable()))).not.toHaveProperty('textStyles');
    expect(exportBoard(importBoard(portable()))).not.toHaveProperty('effectStyles');
    const json = portable({ textStyles: [TEXT], effectStyles: [EFFECT] });
    const board = importBoard(json);
    const styled = board as unknown as {
      textStyles?: ReadonlyMap<string, unknown>;
      effectStyles?: ReadonlyMap<string, unknown>;
    };
    expect(styled.textStyles?.get(TEXT.id)).toMatchObject(TEXT);
    expect(styled.effectStyles?.get(EFFECT.id)).toMatchObject(EFFECT);
    expect(exportBoard(importBoard(exportBoard(board)))).toEqual(exportBoard(board));
  });

  it('refuses duplicate ids and case-blind duplicate names within each kind', () => {
    for (const field of ['textStyles', 'effectStyles'] as const) {
      const entry = field === 'textStyles' ? TEXT : EFFECT;
      expect(() => importBoard(portable({ [field]: [entry] }))).not.toThrow();
      for (const duplicate of [
        { ...entry },
        { ...entry, id: 'second', name: entry.name.toUpperCase() },
      ]) {
        expect(() => importBoard(portable({ [field]: [entry, duplicate] }))).toThrow();
      }
    }
  });

  it('imports objects with unknown style ids as drawable stored values', () => {
    const text = {
      ...sampleObject('text', 'text'),
      runs: [{ length: 5, style: { ...SAMPLE_STYLE, textStyleId: 'lost-text' } }],
    };
    const shape = {
      ...sampleObject('shape', 'shape'),
      shadow: SHADOW,
      effectStyleId: 'lost-effect',
    };
    const board = importBoard(portable({ objects: [text, shape] }));
    expect(board.objects.get(text.id)).toMatchObject(text);
    expect(board.objects.get(shape.id)).toMatchObject(shape);
  });

  it('has an identity migration for the preceding schema version', () => {
    expect(SCHEMA_VERSION).toBeGreaterThan(STROKE_ALIGN_VERSION);
    const old = { format: PORTABLE_BOARD_FORMAT, schemaVersion: SCHEMA_VERSION - 1, objects: [] };
    expect(MIGRATIONS.get(SCHEMA_VERSION)).toBeTypeOf('function');
    expect(runMigrations(old, MIGRATIONS, SCHEMA_VERSION)).toEqual({
      ...old,
      schemaVersion: SCHEMA_VERSION,
    });
  });
});
