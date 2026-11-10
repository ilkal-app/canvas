import { expect, it } from 'vitest';

import { isPreviewCertificate } from './scene-certificate.js';

const certificate = {
  scene: { session: 'mount', sequence: 0 },
  camera: { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 100, viewportHeightPx: 100 },
  coverage: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  fontSetKey: 'fonts',
  candidates: ['visible'],
  assets: [],
  imagePlanKey: '[]',
  lodPlanKey: '[]',
  frameIndex: 0,
  resourceGeneration: 0,
};

/**
 * A font-set key as the page writes it, `font-set:v1:` and one `[id, sha-256]` entry per face.
 *
 * @param faces - How many faces.
 * @returns The key.
 */
function fontSetKey(faces: number): string {
  const entries = Array.from({ length: faces }, (unused, index) => [
    `400|n|Family ${String(index)}`,
    'a'.repeat(64),
  ]);
  return `font-set:v1:${JSON.stringify(entries)}`;
}

it("accepts the bundled faces' key, longer than 4,096 characters", () => {
  const key = fontSetKey(48);
  expect(key.length).toBeGreaterThan(4_096);
  expect(isPreviewCertificate({ ...certificate, fontSetKey: key })).toBe(true);
});

it('accepts a key up to 1 MiB, the longest the page reads back, and refuses a longer one', () => {
  expect(isPreviewCertificate({ ...certificate, fontSetKey: 'k'.repeat(1024 * 1024) })).toBe(true);
  expect(isPreviewCertificate({ ...certificate, fontSetKey: 'k'.repeat(1024 * 1024 + 1) })).toBe(
    false,
  );
});
