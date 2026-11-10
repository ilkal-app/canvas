import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SDK_API_VERSION } from './sdk-api-version.js';

/** The SDK's package version, from its package.json. */
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

describe('SDK_API_VERSION', () => {
  it('is the package’s major version (0 until the API freeze)', () => {
    expect(Number.isInteger(SDK_API_VERSION)).toBe(true);
    expect(SDK_API_VERSION).toBe(Number(version.split('.')[0]));
  });
});
