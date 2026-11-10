// The sticky aspect cache layout converter preserves the Yjs bytes.
import { describe, expect, it } from 'vitest';

import * as document from '@canvas/document';

import { DEFAULT_LAYOUT_CONVERTERS, layoutStepKey } from './layout-converters.js';

describe('sticky aspect cache layout', () => {
  it('registers an identity converter into the current stored layout', () => {
    const version = document.STICKY_ASPECT_LAYOUT_VERSION;
    expect(version).toBeLessThanOrEqual(document.DOCUMENT_LAYOUT_VERSION);
    expect(version).toBeTypeOf('number');
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(version - 1);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(version);
    const convert = DEFAULT_LAYOUT_CONVERTERS.get(layoutStepKey(version - 1, version));
    expect(convert).toBeTypeOf('function');
    const bytes = Uint8Array.of(1, 2, 3, 4);
    expect(convert?.(bytes)).toBe(bytes);
  });
});
