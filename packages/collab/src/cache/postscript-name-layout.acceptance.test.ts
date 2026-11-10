import { describe, expect, it } from 'vitest';

import * as document from '@canvas/document';

import { DEFAULT_LAYOUT_CONVERTERS, layoutStepKey } from './layout-converters.js';

describe('PostScript name cache carry over', () => {
  it('gates layout 25 and carries unsent layout 24 bytes unchanged', () => {
    const version =
      (document as unknown as Record<string, number>).POSTSCRIPT_NAME_LAYOUT_VERSION ?? 0;
    expect(version).toBe(25);
    expect(document.DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(version);
    const convert = DEFAULT_LAYOUT_CONVERTERS.get(layoutStepKey(24, 25));
    expect(convert).toBeTypeOf('function');
    const unsent = Uint8Array.of(1, 2, 3, 4);
    expect(convert?.(unsent)).toBe(unsent);
  });
});
