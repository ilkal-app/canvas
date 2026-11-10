import { describe, expect, it } from 'vitest';

import { DOCUMENT_LAYOUT_VERSION, READABLE_LAYOUT_VERSIONS } from '@canvas/document';
import { SCHEMA_VERSION } from '@canvas/schema';

import { DEFAULT_LAYOUT_CONVERTERS, findLayoutConverter } from './layout-converters.js';

describe('sequential page layout', () => {
  it('supports layout 4 after paint and continues reading layouts 1, 2 and 3', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(4);
    expect(READABLE_LAYOUT_VERSIONS).toEqual(expect.arrayContaining([1, 2, 3, 4]));
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(3);
  });
  it('preserves unsent bytes through 3->4 and the sequential 2->3->4 chain', () => {
    const update = new Uint8Array([0, 255, 17, 128, 4]);
    const before = update.slice();
    expect(DEFAULT_LAYOUT_CONVERTERS.has('3->4')).toBe(true);
    expect(findLayoutConverter(3, 4)?.(update)).toEqual(before);
    expect(findLayoutConverter(2, 4)?.(update)).toEqual(before);
    expect(update).toEqual(before);
  });
});
