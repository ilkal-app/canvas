import { describe, expect, it } from 'vitest';

import * as schema from '@canvas/schema';

import * as publicApi from '../index.js';

describe('the z-order key rule', () => {
  it("is re-exported from the schema under the document's existing names", () => {
    expect(publicApi.compareKeys).toBe(schema.compareKeys);
    expect(publicApi.isValidKey).toBe(schema.isValidKey);
    expect(publicApi.MAX_KEY_LENGTH).toBe(schema.MAX_KEY_LENGTH);
  });
});
