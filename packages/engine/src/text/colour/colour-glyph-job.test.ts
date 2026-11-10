import { describe, expect, it, vi } from 'vitest';

import type { Shaper } from '@canvas/text';

import type { JobOutcome } from '../../workers/job-handlers.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';
import type { MsdfJobRequest } from '../msdf/msdf-job-payload.js';

import type { ColourCanvasFactory } from './colour-canvas.js';
import { withColourGlyphs } from './colour-glyph-job.js';

const request: MsdfJobRequest = {
  faceId: 'face',
  fontKey: 'face',
  fontBytes: new ArrayBuffer(8),
  keys: [65],
  tier: BASE_TIER,
  field: 'sdf',
};

const fields = {
  response: { glyphs: [] },
  transfer: [],
} as unknown as JobOutcome<'msdf'>;

const canvas: ColourCanvasFactory = {
  create: () => {
    throw new Error('no canvas expected');
  },
  decodePng: () => Promise.reject(new Error('no image expected')),
};

/**
 * A shaper whose face does or does not have colour glyphs.
 *
 * @param hasColourGlyphs - Whether the face has colour glyphs.
 * @returns The shaper.
 */
function shaperWith(hasColourGlyphs: boolean): Shaper {
  return {
    face: () => ({}),
    hasColourGlyphs: () => hasColourGlyphs,
    colourGlyph: () => undefined,
  } as unknown as Shaper;
}

describe('withColourGlyphs', () => {
  it('passes a face without colour glyphs through, loading HarfBuzz once', async () => {
    const load = vi.fn(() => Promise.resolve(shaperWith(false)));
    const handler = withColourGlyphs(() => Promise.resolve(fields), canvas, { load });
    expect(await handler(request)).toBe(fields);
    expect(await handler(request)).toBe(fields);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('passes the distance fields through when our parser cannot read the face', async () => {
    const handler = withColourGlyphs(() => Promise.resolve(fields), canvas, {
      load: () => Promise.resolve(shaperWith(true)),
    });
    expect(await handler(request)).toBe(fields);
  });
});
