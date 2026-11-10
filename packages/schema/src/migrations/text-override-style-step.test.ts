import { describe, expect, it } from 'vitest';

import {
  BODY,
  boardOf,
  component,
  instance,
  text,
} from '../instances/__fixtures__/component-board.js';
import { exportBoard } from '../portable/export-board.js';
import { importBoard } from '../portable/import-board.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import { runMigrations } from './run-migrations.js';

// Override records may carry `textStyle` and `runs`; a version 4 reader refuses them
// (its record is strict), so portable JSON names the version that may hold them.

describe('the schema 5 step', () => {
  it('is version 5 or later (raised it to 6)', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(5);
  });

  it('is the identity on a version 4 document, without mutating it', () => {
    const fixture = {
      schemaVersion: 4,
      objects: [{ id: 'inst', type: 'instance', overrides: { child: { text: 'Hi' } } }],
    };
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, 5)).toEqual({ ...before, schemaVersion: 5 });
    expect(fixture).toEqual(before);
  });

  it('round-trips an instance whose records restyle text and carry runs', () => {
    const runs = [
      { length: 5, style: { ...BODY, color: [1, 0.75, 0, 1] } },
      { length: 3, style: BODY },
    ];
    const board = boardOf([
      component('main'),
      text('child', 'main'),
      instance('inst', 'main', {
        overrides: { child: { text: '@Mira hi', runs, textStyle: { fontSize: 12 } } },
      }),
    ]);
    const json = JSON.parse(JSON.stringify(exportBoard(board))) as unknown;
    expect(exportBoard(importBoard(json))).toEqual(exportBoard(board));
  });
});
