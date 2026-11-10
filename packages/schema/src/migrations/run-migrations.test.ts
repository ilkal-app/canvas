import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import type { MigrationRegistry, VersionedDocumentJson } from './migration-step.js';
import { migrateToLatest, runMigrations } from './run-migrations.js';

/**
 * Makes a step that appends `entry` to the document's `log`, so a test can see which steps ran
 * and in what order.
 *
 * @param entry - The text the step appends.
 * @returns The migration step.
 */
function appendToLog(entry: string): (document: VersionedDocumentJson) => VersionedDocumentJson {
  return (document) => ({ ...document, log: [...(document.log as string[]), entry] });
}

const REGISTRY: MigrationRegistry = new Map([
  [1, (document: VersionedDocumentJson) => document],
  // Out of insertion order on purpose: the runner orders by version, not by map order.
  [3, appendToLog('to 3')],
  [2, appendToLog('to 2')],
  [4, appendToLog('to 4')],
]);

describe('runMigrations', () => {
  it('applies every step after the document version, in version order, and stamps each version', () => {
    const migrated = runMigrations({ schemaVersion: 1, log: [] }, REGISTRY, 4);
    expect(migrated).toEqual({ schemaVersion: 4, log: ['to 2', 'to 3', 'to 4'] });
  });

  it('starts from the version the document records', () => {
    expect(runMigrations({ schemaVersion: 3, log: [] }, REGISTRY, 4)).toEqual({
      schemaVersion: 4,
      log: ['to 4'],
    });
  });

  it('stops at the target version', () => {
    expect(runMigrations({ schemaVersion: 1, log: [] }, REGISTRY, 2)).toEqual({
      schemaVersion: 2,
      log: ['to 2'],
    });
  });

  it('returns a document already at the target version unchanged', () => {
    const document = { schemaVersion: 4, log: [] };
    expect(runMigrations(document, REGISTRY, 4)).toBe(document);
  });

  it('never mutates the document it is given', () => {
    const document = Object.freeze({ schemaVersion: 1, log: Object.freeze([]) });
    runMigrations(document, REGISTRY, 4);
    expect(document).toEqual({ schemaVersion: 1, log: [] });
  });

  it('refuses a version newer than the target, below 1 or not an integer', () => {
    for (const schemaVersion of [5, 0, -1, 1.5, Number.NaN]) {
      expect(() => runMigrations({ schemaVersion, log: [] }, REGISTRY, 4)).toThrow(RangeError);
    }
    expect(() => runMigrations({ schemaVersion: 5 }, REGISTRY, 4)).toThrow(
      'Unknown schema version 5: this build reads versions 1 to 4',
    );
  });

  it('refuses a document with no numeric schema version, or that is not an object', () => {
    for (const document of [{ log: [] }, { schemaVersion: '1' }, null, [], 'board']) {
      expect(() => runMigrations(document, REGISTRY, 4)).toThrow(TypeError);
    }
  });

  it('refuses to skip a version the registry has no step for', () => {
    const gappy: MigrationRegistry = new Map([[3, appendToLog('to 3')]]);
    expect(() => runMigrations({ schemaVersion: 1, log: [] }, gappy, 3)).toThrow(
      new RangeError('No migration step produces schema version 2'),
    );
  });
});

describe('MIGRATIONS', () => {
  it('has exactly one step for every version from 1 to SCHEMA_VERSION', () => {
    expect([...MIGRATIONS.keys()].sort((first, second) => first - second)).toEqual(
      [...Array(SCHEMA_VERSION).keys()].map((index) => index + 1),
    );
  });

  it('makes version 1 the baseline, whose step changes nothing', () => {
    const document = { schemaVersion: 0, objects: [] };
    expect(MIGRATIONS.get(1)?.(document)).toBe(document);
  });
});

describe('migrateToLatest', () => {
  it('brings a current document to SCHEMA_VERSION unchanged', () => {
    const document = { schemaVersion: SCHEMA_VERSION, objects: [] };
    expect(migrateToLatest(document)).toBe(document);
  });

  it('refuses a document from a newer build', () => {
    expect(() => migrateToLatest({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(RangeError);
  });
});
