import { describe, expect, it } from 'vitest';

import type { JobTicket, SubmitOptions } from '../../workers/job-submission.js';
import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { GLYPH_PADDING_PX } from '../atlas/glyph-bitmap.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';
import { FontLibrary } from '../font/font-library.js';

import { GlyphSource } from './glyph-source.js';
import type { MsdfJobRequest } from './msdf-job-payload.js';

describe('glyph source page-sized jobs', () => {
  it('submits no more glyphs than fit on its atlas page', async () => {
    const fonts = new FontLibrary();
    for (const { face, bytes } of loadBundledFaces()) fonts.addFace(face, bytes);
    const atlas = new GlyphAtlas({ pageSize: 512, budgetBytes: 2 * 512 * 512 * 4 });
    const submitted: MsdfJobRequest[] = [];
    const pool = {
      submit(kind: 'msdf', request: MsdfJobRequest, options: SubmitOptions): JobTicket<'msdf'> {
        expect(kind).toBe('msdf');
        expect(options.priority).toBe('visible');
        submitted.push(request);
        return { id: submitted.length, response: new Promise(() => undefined) };
      },
    };
    const source = new GlyphSource({ pool, fonts, atlas });
    const faceId = `400|n|${BUNDLED_FAMILY}`;
    const cell = Math.ceil(BASE_TIER * 1.25) + 2 * GLYPH_PADDING_PX + 2;
    const capacity = Math.floor(atlas.pageSize / cell) ** 2;
    const keys = Array.from({ length: capacity + 1 }, (ignored, index) => 0x4e00 + index);
    for (const key of keys) source.request({ faceId }, key, BASE_TIER);

    await Promise.resolve();

    expect(submitted.map(({ keys: batch }) => batch.length)).toEqual([capacity, 1]);
    expect(submitted.flatMap(({ keys: batch }) => batch)).toEqual(keys);
  });
});
