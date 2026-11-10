import { expect, it } from 'vitest';

import { visibleWorldBounds, type PreviewCertificate } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { matchesPreviewResources } from './preview-resource-match.js';

const camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
const previous: PreviewCertificate = {
  scene: { session: 'old', sequence: 10 },
  camera,
  coverage: visibleWorldBounds(camera),
  fontSetKey: 'font-sha',
  candidates: [],
  assets: [{ assetId: 'asset', contentVersion: 'content-sha' }],
  imagePlanKey: '[]',
  lodPlanKey: '[]',
  frameIndex: 35,
  resourceGeneration: 18,
};

it('compares content across mounts without treating old frame/stream counters as current', () => {
  expect(
    matchesPreviewResources(previous, {
      ...previous,
      scene: { session: 'new', sequence: 0 },
      frameIndex: 2,
      resourceGeneration: 1,
    }),
  ).toBe(true);
});

it.each([
  { fontSetKey: 'different-font' },
  { camera: { ...camera, x: 1 } },
  { imagePlanKey: '[1]' },
  { lodPlanKey: '[1]' },
  { assets: [{ assetId: 'asset', contentVersion: 'different-content' }] },
  { assets: [] },
  { candidates: ['new-object'] },
  { coverage: { ...previous.coverage, maxX: 99 } },
])('rejects a reopened frame with different required resources or coverage: %j', (change) => {
  expect(matchesPreviewResources(previous, { ...previous, ...change })).toBe(false);
});

it('counts a fresh virtual candidate as its owner, the id the cache stores', () => {
  const stored = { ...previous, candidates: ['plain', 'inst'].map((id) => id as ObjectId) };
  const fresh = (candidates: string[]) => ({ ...stored, candidates });
  expect(matchesPreviewResources(stored, fresh(['plain', 'inst', 'inst/title', 'inst/a/b']))).toBe(
    true,
  );
  expect(matchesPreviewResources(stored, fresh(['plain', 'inst/title']))).toBe(true);
  expect(matchesPreviewResources(stored, fresh(['plain', 'other/title']))).toBe(false);
  expect(matchesPreviewResources(stored, fresh(['plain']))).toBe(false);
});
