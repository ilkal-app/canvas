import { describe, expect, it } from 'vitest';

import { TEXT_ALIGNS, TEXT_DIRECTIONS } from '../index.js';

import { sampleObject } from './__fixtures__/object-samples.js';
import { stickyObjectSchema } from './sticky-object.js';
import { textObjectSchema } from './text-object.js';

describe('text box direction and logical alignment', () => {
  it('exports the complete align and direction choices', () => {
    expect(TEXT_ALIGNS).toEqual(['left', 'center', 'right', 'start', 'end']);
    expect(TEXT_DIRECTIONS).toEqual(['auto', 'ltr', 'rtl']);
  });

  for (const [type, schema] of [
    ['text', textObjectSchema],
    ['sticky', stickyObjectSchema],
  ] as const) {
    it(`${type} accepts absent, auto, ltr and rtl direction with start/end`, () => {
      const sample = sampleObject(type, `${type}-direction`);
      for (const align of ['start', 'end']) {
        expect(schema.safeParse({ ...sample, align }).success).toBe(true);
        for (const direction of TEXT_DIRECTIONS) {
          expect(schema.safeParse({ ...sample, align, direction }).success).toBe(true);
        }
      }
    });

    it(`${type} refuses unknown direction and alignment`, () => {
      const sample = sampleObject(type, `${type}-invalid-direction`);
      expect(schema.safeParse({ ...sample, direction: 'up' }).success).toBe(false);
      expect(schema.safeParse({ ...sample, align: 'justify' }).success).toBe(false);
    });
  }
});
