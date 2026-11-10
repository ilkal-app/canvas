// Only text, sticky, and image objects store an optional canonical link.
import { describe, expect, it } from 'vitest';

import * as publicSchema from '@canvas/schema';

import { MIGRATIONS } from '../migrations/migration-registry.js';
import { runMigrations } from '../migrations/run-migrations.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { sampleObject } from './__fixtures__/object-samples.js';
import { boardObjectSchema } from './board-object.js';
import type { ObjectType } from './object-type.js';

const exports = publicSchema as unknown as Record<string, unknown>;
const LINK = 'https://example.com/target';

describe('object link schema', () => {
  it.each(['text', 'sticky', 'image'] as const)('keeps optional link on %s', (type) => {
    const object = sampleObject(type, `${type}-link`);
    expect(boardObjectSchema.parse(object)).not.toHaveProperty('link');
    expect(boardObjectSchema.parse({ ...object, link: LINK })).toHaveProperty('link', LINK);
    expect(boardObjectSchema.safeParse({ ...object, link: 'javascript:alert(1)' }).success).toBe(
      false,
    );
  });

  it('refuses link on every other strict object type', () => {
    const otherTypes: readonly ObjectType[] = [
      'video',
      'shape',
      'line',
      'connector',
      'path',
      'freehand',
      'group',
      'frame',
      'comment',
      'component',
      'instance',
    ];
    for (const type of otherTypes) {
      expect(
        boardObjectSchema.safeParse({ ...sampleObject(type, `${type}-link`), link: LINK }).success,
      ).toBe(false);
    }
  });

  it('registers schema 33 as an identity migration without adding a link default', () => {
    expect(exports.LINK_VERSION).toBe(33);
    // Bump-stable (moved the schema to 34): the step to 33 is the one checked.
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(33);
    expect(MIGRATIONS.has(33)).toBe(true);
    const before = { schemaVersion: 32, objects: [sampleObject('sticky', 'old')] };
    const input = structuredClone(before);
    expect(runMigrations(input, MIGRATIONS, 33)).toEqual({
      ...before,
      schemaVersion: 33,
    });
    expect(input).toEqual(before);
  });
});
