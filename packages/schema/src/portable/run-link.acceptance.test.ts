// Written before the code. CONTRACT: version 34 adds an identity migration and portable run links. Deliberately not asserted: legacy rendering.
import { describe, expect, it } from 'vitest';

import * as schema from '@canvas/schema';

import { MIGRATIONS } from '../migrations/migration-registry.js';
import { runMigrations } from '../migrations/run-migrations.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import * as versions from '../version/schema-version.js';

import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';
import { PORTABLE_BOARD_FORMAT } from './portable-board.js';

const LINK = 'https://example.com/range';

describe('run link portable version', () => {
  it('registers a no-op 33 to 34 migration', () => {
    expect((versions as unknown as Record<string, unknown>).RUN_LINK_VERSION).toBe(34);
    // Bump-stable (moved the schema to 35): the step to 34 is the one checked.
    expect(versions.SCHEMA_VERSION).toBeGreaterThanOrEqual(34);
    expect(MIGRATIONS.has(34)).toBe(true);
    const before = { schemaVersion: 33, objects: [sampleObject('text', 'old')] };
    const input = structuredClone(before);
    expect(runMigrations(input, MIGRATIONS, 34)).toEqual({ ...before, schemaVersion: 34 });
    expect(input).toEqual(before);
  });

  it('round-trips run links in a v34 portable board', () => {
    const object = sampleObject('text', 'linked');
    const first = object.runs[0];
    if (first === undefined) throw new Error('Expected text run');
    const linked = {
      ...object,
      runs: [{ length: object.text.length, style: { ...first.style, link: LINK } }],
    };
    const input = { format: PORTABLE_BOARD_FORMAT, schemaVersion: 34, objects: [linked] };
    const output = exportBoard(importBoard(input));
    expect(output.objects[0]).toMatchObject({ runs: [{ style: { link: LINK } }] });
    expect(exportBoard(importBoard(JSON.parse(JSON.stringify(output))))).toEqual(output);
    expect(schema.SCHEMA_VERSION).toBeGreaterThanOrEqual(34);
  });
});
