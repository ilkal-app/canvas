// Written before the code. CONTRACT: layout 31 has an identity 30-to-31 converter. Deliberately not asserted: drawing.
import { describe, expect, it } from 'vitest';

import * as document from '@canvas/document';

import { DEFAULT_LAYOUT_CONVERTERS, layoutStepKey } from './layout-converters.js';

describe('run link cache layout', () => {
  it('registers layout 31 and preserves old cache bytes', () => {
    expect((document as unknown as Record<string, unknown>).RUN_LINK_LAYOUT_VERSION).toBe(31);
    // Bump-stable (moved the layout to 32): the 30->31 step is the one checked.
    expect(document.DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(31);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(30);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(31);
    const bytes = Uint8Array.of(1, 2, 3);
    expect(DEFAULT_LAYOUT_CONVERTERS.get(layoutStepKey(30, 31))?.(bytes)).toBe(bytes);
  });
});
