import { expect, it } from 'vitest';

import { resourceContext } from '../../workers/job-handlers.js';
import { loadRegularFontBytes } from '../__fixtures__/bundled-fonts.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';

import type { MsdfJobRequest } from './msdf-job-payload.js';
import { createMsdfJobHandler } from './msdf-job.js';

it('generates a glyph from the context resource when the request has no font bytes', async () => {
  const request: MsdfJobRequest = {
    faceId: 'regular',
    fontKey: 'regular#resource',
    keys: [0x41],
    tier: BASE_TIER,
    field: 'msdf',
  };
  const context = resourceContext(new Map([[request.fontKey, loadRegularFontBytes()]]));
  const outcome = await createMsdfJobHandler()(request, context);
  expect(outcome.response.glyphs).toHaveLength(1);
  expect(outcome.response.glyphs[0]?.bitmap.width).toBeGreaterThan(0);
  expect(outcome.response.glyphs[0]?.bitmap.height).toBeGreaterThan(0);
});

it('still generates a glyph from legacy request bytes without a context', async () => {
  const request: MsdfJobRequest = {
    faceId: 'regular',
    fontKey: 'regular#legacy',
    fontBytes: loadRegularFontBytes(),
    keys: [0x41],
    tier: BASE_TIER,
    field: 'msdf',
  };
  const outcome = await createMsdfJobHandler()(request);
  expect(outcome.response.glyphs[0]?.bitmap.width).toBeGreaterThan(0);
  expect(outcome.response.glyphs[0]?.bitmap.height).toBeGreaterThan(0);
});

it('returns an empty glyph for every key when neither source has a font', async () => {
  const request: MsdfJobRequest = {
    faceId: 'missing',
    fontKey: 'missing#1',
    keys: [0x41, 0x42],
    tier: BASE_TIER,
    field: 'msdf',
  };
  const outcome = await createMsdfJobHandler()(request);
  expect(
    outcome.response.glyphs.map(({ key, bitmap }) => [key, bitmap.width, bitmap.height]),
  ).toEqual([
    [0x41, 0, 0],
    [0x42, 0, 0],
  ]);
});
