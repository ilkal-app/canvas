import { describe, expect, it } from 'vitest';

import { isSupportedSchemaVersion, SCHEMA_VERSION } from './schema-version.js';

describe('isSupportedSchemaVersion', () => {
  it('accepts every version from 1 up to the current one', () => {
    for (let version = 1; version <= SCHEMA_VERSION; version += 1) {
      expect(isSupportedSchemaVersion(version)).toBe(true);
    }
  });

  it('rejects a version newer than this build', () => {
    expect(isSupportedSchemaVersion(SCHEMA_VERSION + 1)).toBe(false);
  });

  it('rejects zero, negative, fractional and NaN versions', () => {
    for (const version of [0, -1, 1.5, Number.NaN]) {
      expect(isSupportedSchemaVersion(version)).toBe(false);
    }
  });
});
