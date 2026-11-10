import { expect, it } from 'vitest';

import { isPreviewCertificate, isPreviewRequest } from './scene-certificate.js';

const certificate = {
  scene: { session: 'mount', sequence: 0 },
  camera: { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 100, viewportHeightPx: 100 },
  coverage: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  fontSetKey: 'fonts',
  candidates: ['visible'],
  assets: [{ assetId: 'asset', contentVersion: 'v1' }],
  imagePlanKey: '[]',
  lodPlanKey: '[]',
  frameIndex: 0,
  resourceGeneration: 0,
};

it.each([undefined, null, 0, 'request'])(
  'refuses non-object protocol requests and certificates: %s',
  (value) => {
    expect(isPreviewRequest(value)).toBe(false);
    expect(isPreviewCertificate(value)).toBe(false);
  },
);

it('accepts bounded asset identities but refuses malformed, empty, duplicate and oversized identities', () => {
  expect(isPreviewCertificate(certificate)).toBe(true);
  for (const assets of [
    [null],
    ['asset'],
    [{ assetId: 42, contentVersion: 'v1' }],
    [{ assetId: '', contentVersion: 'v1' }],
    [{ assetId: 'asset', contentVersion: '' }],
    [{ assetId: 'asset', contentVersion: 'x'.repeat(4097) }],
    [{ assetId: 'x'.repeat(4097), contentVersion: 'v1' }],
    [...certificate.assets, ...certificate.assets],
  ])
    expect(isPreviewCertificate({ ...certificate, assets })).toBe(false);
  expect(
    isPreviewCertificate({
      ...certificate,
      assets: [{ assetId: 'x'.repeat(4096), contentVersion: 'y'.repeat(4096) }],
    }),
  ).toBe(true);
});

it('rejects invalid candidate identities without rejecting the permitted boundary', () => {
  for (const candidates of [[null], [''], ['x'.repeat(4097)], ['same', 'same']]) {
    expect(isPreviewCertificate({ ...certificate, candidates })).toBe(false);
  }
  expect(isPreviewCertificate({ ...certificate, candidates: ['x'.repeat(4096)] })).toBe(true);
});
