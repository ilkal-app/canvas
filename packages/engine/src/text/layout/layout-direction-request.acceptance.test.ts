import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { FontLibrary } from '../font/font-library.js';
import { textObject } from '../scene/__fixtures__/text-objects.js';
import { TextLayoutKey } from '../scene/text-layout-key.js';
import { textPlacementOf } from '../scene/text-placement.js';

import { layoutTextNow } from './layout-job.js';
import { createLayoutJobRequest } from './layout-request.js';

const STYLE: TextStyle = {
  fontFamily: BUNDLED_FAMILY,
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const RUNS: StyleRun[] = [{ length: 5, style: STYLE }];

/**
 * A font library with the bundled faces that layout requests resolve.
 *
 * @returns The font library.
 */
function library(): FontLibrary {
  const fonts = new FontLibrary();
  for (const { face, bytes } of loadBundledFaces()) fonts.addFace(face, bytes);
  return fonts;
}

describe('direction in engine layout requests', () => {
  it('carries an explicit direction and defaults an absent one to auto', () => {
    const input = {
      objectId: 't',
      text: 'Hello',
      runs: RUNS,
      maxWidth: 120,
      align: 'end',
    } as const;
    expect(createLayoutJobRequest({ ...input, direction: 'rtl' }, library())).toMatchObject({
      align: 'end',
      direction: 'rtl',
    });
    expect(createLayoutJobRequest(input, library()).direction).toBe('auto');
  });

  it('uses request direction when laying out a Latin paragraph', () => {
    const input = {
      objectId: 't',
      text: 'Hello',
      runs: RUNS,
      maxWidth: 120,
      align: 'start',
    } as const;
    const fonts = library();
    const ltr = layoutTextNow(createLayoutJobRequest({ ...input, direction: 'ltr' }, fonts));
    const rtl = layoutTextNow(createLayoutJobRequest({ ...input, direction: 'rtl' }, fonts));
    expect(ltr.lines[0]?.x).toBe(0);
    expect(rtl.lines[0]?.x).toBeGreaterThan(0);
    expect(rtl.width).toBe(ltr.width);
    expect(rtl.height).toBe(ltr.height);
  });

  for (const type of ['text', 'sticky'] as const) {
    it(`takes ${type} direction into placement and distinguishes it in the cache key`, () => {
      const base = textObject('label', 'Hello');
      const object =
        type === 'text' ? base : { ...base, type: 'sticky', autoWidth: false, color: [1, 1, 0, 1] };
      const ltr = textPlacementOf({ ...object, direction: 'ltr', align: 'end' } as never);
      const rtl = textPlacementOf({ ...object, direction: 'rtl', align: 'end' } as never);
      expect(ltr.direction).toBe('ltr');
      expect(rtl.direction).toBe('rtl');
      const key = new TextLayoutKey();
      expect(key.of(ltr, 'fonts')).not.toBe(key.of(rtl, 'fonts'));
    });
  }
});
