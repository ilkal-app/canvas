import { bench, describe } from 'vitest';

import { isSupportedSchemaVersion } from './schema-version.js';

// Every stored document is version-checked on load, so this stays a handful of comparisons.
const CANDIDATE_VERSIONS = [...Array(1000).keys()].map((index) => index - 500);

describe('isSupportedSchemaVersion', () => {
  bench('checks 1000 candidate versions', () => {
    for (const version of CANDIDATE_VERSIONS) {
      isSupportedSchemaVersion(version);
    }
  });
});
