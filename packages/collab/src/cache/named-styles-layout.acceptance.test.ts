// Acceptance, written before the code.
import { expect, it } from 'vitest';

import { DOCUMENT_LAYOUT_VERSION, STROKE_ALIGN_LAYOUT_VERSION } from '@canvas/document';

import { findLayoutConverter } from './layout-converters.js';

it('carries the preceding layout’s unsent update unchanged into the style-map layout', () => {
  expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThan(STROKE_ALIGN_LAYOUT_VERSION);
  const unsent = new Uint8Array([0, 1, 2, 255]);
  const convert = findLayoutConverter(DOCUMENT_LAYOUT_VERSION - 1, DOCUMENT_LAYOUT_VERSION);
  expect(convert).toBeTypeOf('function');
  expect(convert?.(unsent)).toBe(unsent);
});
