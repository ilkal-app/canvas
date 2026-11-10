// The 31 to 32 offline cache conversion preserves Yjs bytes.
import { describe, expect, it } from 'vitest';

import * as document from '@canvas/document';

import { DEFAULT_LAYOUT_CONVERTERS, layoutStepKey } from './layout-converters.js';

describe('image border cache layout', () => {
  it('registers the identity converter for layout 32', () => {
    // 32, not 31: took 31 first. Bump-stable: the 31->32 step is the one checked.
    expect((document as unknown as Record<string, unknown>).IMAGE_BORDER_LAYOUT_VERSION).toBe(32);
    expect(document.DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(32);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(31);
    const convert = DEFAULT_LAYOUT_CONVERTERS.get(layoutStepKey(31, 32));
    expect(convert).toBeTypeOf('function');
    const bytes = Uint8Array.of(1, 2, 3, 4);
    expect(convert?.(bytes)).toBe(bytes);
  });
});
