import { describe, expect, it } from 'vitest';

import { MIGRATIONS } from './migration-registry.js';
import { runMigrations } from './run-migrations.js';

describe('the schema 3 step', () => {
  it('adds Page 1 and names it on root objects only, without mutating its input', () => {
    const fixture = {
      schemaVersion: 2,
      objects: [
        { id: 'root', parentId: null, x: 1 },
        { id: 'child', parentId: 'root', x: 2 },
        'not an object',
      ],
    };
    const before = structuredClone(fixture);
    expect(runMigrations(fixture, MIGRATIONS, 3)).toEqual({
      schemaVersion: 3,
      pages: [{ id: 'page-1', name: 'Page 1', order: 'a0' }],
      objects: [
        { id: 'root', parentId: null, x: 1, pageId: 'page-1' },
        { id: 'child', parentId: 'root', x: 2, pageId: null },
        'not an object',
      ],
    });
    expect(fixture).toEqual(before);
  });

  it('adds the page to a document without an object list', () => {
    expect(runMigrations({ schemaVersion: 2 }, MIGRATIONS, 3)).toEqual({
      schemaVersion: 3,
      pages: [{ id: 'page-1', name: 'Page 1', order: 'a0' }],
    });
  });
});
