// A sticky's optional stored aspect and its identity schema migration.
import { describe, expect, it } from 'vitest';

import * as publicSchema from '@canvas/schema';

import { MIGRATIONS } from '../migrations/migration-registry.js';
import { runMigrations } from '../migrations/run-migrations.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { sampleObject } from './__fixtures__/object-samples.js';
import { stickyObjectSchema } from './sticky-object.js';

const exports = publicSchema as unknown as Record<string, unknown>;

describe('sticky aspect schema', () => {
  it('exports square and wide and keeps an absent aspect absent', () => {
    expect(exports.STICKY_ASPECTS).toEqual(['square', 'wide']);
    const square = sampleObject('sticky', 'square');
    expect(stickyObjectSchema.parse(square)).not.toHaveProperty('aspect');
    expect(stickyObjectSchema.parse({ ...square, aspect: 'square' })).toHaveProperty(
      'aspect',
      'square',
    );
    expect(stickyObjectSchema.parse({ ...square, aspect: 'wide' })).toHaveProperty(
      'aspect',
      'wide',
    );
  });

  it('refuses every aspect outside the declared choices', () => {
    const sticky = sampleObject('sticky', 'bad');
    for (const aspect of ['tall', 2, null]) {
      expect(stickyObjectSchema.safeParse({ ...sticky, aspect }).success).toBe(false);
    }
  });

  it('registers an identity migration without adding a square default', () => {
    const version = exports.STICKY_ASPECT_VERSION;
    expect(version).toBeLessThanOrEqual(SCHEMA_VERSION);
    expect(typeof version).toBe('number');
    expect(MIGRATIONS.has(version as number)).toBe(true);
    const before = {
      schemaVersion: (version as number) - 1,
      objects: [sampleObject('sticky', 'old')],
    };
    const input = structuredClone(before);
    expect(runMigrations(input, MIGRATIONS, SCHEMA_VERSION)).toEqual({
      ...before,
      schemaVersion: SCHEMA_VERSION,
    });
    expect(input).toEqual(before);
  });
});
