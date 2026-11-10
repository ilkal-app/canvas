import { expect, it } from 'vitest';

import { BASE_TIER } from '../atlas/glyph-tiers.js';

import { createMsdfJobHandler } from './msdf-job.js';

it('draws every glyph of a face its parser cannot read empty, not as a failed job', async () => {
  const handler = createMsdfJobHandler();
  const outcome = await handler({
    faceId: 'broken',
    fontKey: 'broken#1',
    fontBytes: new Uint8Array(12).buffer,
    keys: [0x41, 0x42],
    tier: BASE_TIER,
    field: 'sdf',
  });
  expect(outcome.response.glyphs.map(({ key }) => key)).toEqual([0x41, 0x42]);
  for (const { bitmap } of outcome.response.glyphs) {
    expect(bitmap).toMatchObject({ field: 'sdf', width: 0, height: 0 });
  }
});
