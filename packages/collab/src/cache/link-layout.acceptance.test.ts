// The 29 to 30 offline cache conversion preserves Yjs bytes.
import { describe, expect, it } from 'vitest';

import * as document from '@canvas/document';

import { DEFAULT_LAYOUT_CONVERTERS, layoutStepKey } from './layout-converters.js';

describe('link cache layout', () => {
  it('registers the identity converter for layout 30', () => {
    const versions = document as unknown as Record<string, unknown>;
    expect(versions.LINK_LAYOUT_VERSION).toBe(30);
    // Bump-stable (moved the layout to 31): the 29->30 step is the one checked.
    expect(document.DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(30);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(29);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(30);
    const convert = DEFAULT_LAYOUT_CONVERTERS.get(layoutStepKey(29, 30));
    expect(convert).toBeTypeOf('function');
    const bytes = Uint8Array.of(1, 2, 3, 4);
    expect(convert?.(bytes)).toBe(bytes);
  });
});
