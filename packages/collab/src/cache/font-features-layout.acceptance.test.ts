import { describe, expect, it } from 'vitest';

import * as document from '@canvas/document';

import { DEFAULT_LAYOUT_CONVERTERS, layoutStepKey } from './layout-converters.js';

describe('font features cache layout', () => {
  it('gates layout 27 and carries layout 26 bytes unchanged', () => {
    const version = (document as unknown as Record<string, number>).FONT_FEATURES_LAYOUT_VERSION;
    expect(version).toBe(27);
    expect(document.DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(27);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(26);
    const convert = DEFAULT_LAYOUT_CONVERTERS.get(layoutStepKey(26, 27));
    expect(convert).toBeTypeOf('function');
    const bytes = Uint8Array.of(1, 2, 3, 4);
    expect(convert?.(bytes)).toBe(bytes);
  });
});
