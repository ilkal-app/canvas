import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '@canvas/schema';

import {
  createDocumentMeta,
  DOCUMENT_LAYOUT_VERSION,
  isReadableMeta,
  READABLE_LAYOUT_VERSIONS,
} from './document-meta.js';

describe('createDocumentMeta', () => {
  it('stamps a document with the current schema version and stored layout', () => {
    expect(createDocumentMeta()).toEqual({
      schemaVersion: SCHEMA_VERSION,
      layoutVersion: DOCUMENT_LAYOUT_VERSION,
    });
  });

  it('returns frozen metadata that callers cannot share by accident', () => {
    const meta = createDocumentMeta();
    expect(Object.isFrozen(meta)).toBe(true);
    expect(createDocumentMeta()).not.toBe(meta);
  });
});

describe('isReadableMeta', () => {
  it('reads this build’s own metadata and every layout it lists', () => {
    expect(isReadableMeta(createDocumentMeta())).toBe(true);
    expect(READABLE_LAYOUT_VERSIONS).toContain(DOCUMENT_LAYOUT_VERSION);
    expect(Object.isFrozen(READABLE_LAYOUT_VERSIONS)).toBe(true);
  });

  it('refuses a newer schema, an unknown layout and anything malformed', () => {
    expect(isReadableMeta({ schemaVersion: SCHEMA_VERSION + 1, layoutVersion: 1 })).toBe(false);
    expect(isReadableMeta({ schemaVersion: SCHEMA_VERSION, layoutVersion: 99 })).toBe(false);
    expect(isReadableMeta({ schemaVersion: SCHEMA_VERSION })).toBe(false);
    expect(isReadableMeta(null)).toBe(false);
    expect(isReadableMeta('1')).toBe(false);
  });
});
