import { expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import { holdLocalImage } from './hold-local.js';

it('waits for nothing without the adapter’s link', async () => {
  const held = new Map<AssetId, () => void>();
  await holdLocalImage(
    undefined,
    held,
    {
      assetId: 'e'.repeat(64) as AssetId,
      naturalSize: { width: 1, height: 1 },
      mimeType: 'image/png',
      byteLength: 1,
    },
    new Blob(['x']),
  );
  expect(held.size).toBe(0);
});
