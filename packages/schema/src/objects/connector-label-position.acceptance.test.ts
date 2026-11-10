// Item 19: optional route-relative connector label position.
import { describe, expect, it } from 'vitest';

import * as publicSchema from '@canvas/schema';

import { createBoard } from '../board/board.js';
import { MIGRATIONS } from '../migrations/migration-registry.js';
import { runMigrations } from '../migrations/run-migrations.js';
import { exportBoard } from '../portable/export-board.js';
import { importBoard } from '../portable/import-board.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { sampleObject } from './__fixtures__/object-samples.js';
import { connectorObjectSchema } from './connector-object.js';

const exports = publicSchema as unknown as Record<string, unknown>;
const connector = sampleObject('connector', 'labelled');

describe('connector label position schema', () => {
  it('accepts the endpoints and fractions, leaving an absent position absent', () => {
    expect(connectorObjectSchema.parse(connector)).not.toHaveProperty('labelPosition');
    for (const labelPosition of [0, 0.25, 0.5, 0.75, 1]) {
      expect(connectorObjectSchema.parse({ ...connector, labelPosition })).toHaveProperty(
        'labelPosition',
        labelPosition,
      );
    }
  });

  it.each([-0.001, 1.001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses an out-of-range or non-finite position %s',
    (labelPosition) => {
      expect(connectorObjectSchema.safeParse({ ...connector, labelPosition }).success).toBe(false);
    },
  );

  it('registers schema 36 as an identity migration, preserving the absent midpoint', () => {
    expect(exports.CONNECTOR_LABEL_POSITION_VERSION).toBe(36);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(36);
    expect(MIGRATIONS.has(36)).toBe(true);
    const before = { schemaVersion: 35, objects: [connector] };
    const input = structuredClone(before);
    expect(runMigrations(input, MIGRATIONS, 36)).toEqual({ ...before, schemaVersion: 36 });
    expect(input).toEqual(before);
    expect(connectorObjectSchema.parse(connector)).not.toHaveProperty('labelPosition');
  });

  it('preserves explicit and absent positions through portable JSON', () => {
    const moved = connectorObjectSchema.parse({ ...connector, labelPosition: 0.75 });
    expect(exportBoard(importBoard(exportBoard(createBoard([moved])))).objects).toEqual([moved]);
    expect(
      exportBoard(importBoard(exportBoard(createBoard([connector])))).objects[0],
    ).not.toHaveProperty('labelPosition');
  });
});
