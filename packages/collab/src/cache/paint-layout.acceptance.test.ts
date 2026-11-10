import { describe, expect, it } from 'vitest';

import { DOCUMENT_LAYOUT_VERSION, READABLE_LAYOUT_VERSIONS } from '@canvas/document';
import { SCHEMA_VERSION } from '@canvas/schema';

import { DEFAULT_LAYOUT_CONVERTERS, findLayoutConverter } from './layout-converters.js';

describe('/312 paint layout compatibility', () => {
  it('supports layout 3 and retains older readers in the new build', () => {
    // Future approved layout 4 builds must retain the paint contract too.
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(3);
    expect(READABLE_LAYOUT_VERSIONS).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });
  it('carries every unsent byte across the identity 2->3 bump', () => {
    const unsent = new Uint8Array([0, 255, 7, 128, 31]);
    const before = unsent.slice();
    expect(DEFAULT_LAYOUT_CONVERTERS.has('2->3')).toBe(true);
    expect(findLayoutConverter(2, 3)?.(unsent)).toEqual(before);
    expect(findLayoutConverter(1, 3)?.(unsent)).toEqual(before);
    expect(unsent).toEqual(before);
  });
});
