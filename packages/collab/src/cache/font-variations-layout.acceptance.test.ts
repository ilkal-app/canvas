import { describe, expect, it } from 'vitest';

import { DOCUMENT_LAYOUT_VERSION, FONT_VARIATIONS_LAYOUT_VERSION } from '@canvas/document';

import { DEFAULT_LAYOUT_CONVERTERS, layoutStepKey } from './layout-converters.js';

describe('font variations cache carry over', () => {
  it('has an identity converter from the preceding stored layout', () => {
    // A later layout may follow ('s 24); this gate's converter stays.
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(FONT_VARIATIONS_LAYOUT_VERSION);
    const convert = DEFAULT_LAYOUT_CONVERTERS.get(
      layoutStepKey(FONT_VARIATIONS_LAYOUT_VERSION - 1, FONT_VARIATIONS_LAYOUT_VERSION),
    );
    expect(convert).toBeTypeOf('function');
    const unsent = Uint8Array.of(1, 2, 3, 4);
    expect(convert?.(unsent)).toBe(unsent);
  });
});
