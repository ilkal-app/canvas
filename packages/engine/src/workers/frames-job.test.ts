import { describe, expect, it } from 'vitest';

import { encodeFixtureGif } from '../images/fixture-gif.js';

import { framesJob } from './frames-job.js';

const LIMITS = { maxLongEdgePx: 512, maxBytes: 1024 * 1024 };

function gif(frameCount: number): ArrayBuffer {
  return encodeFixtureGif({
    widthPx: 3,
    heightPx: 2,
    palette: [
      [255, 0, 0],
      [0, 0, 255],
    ],
    loopCount: 0,
    frames: Array.from({ length: frameCount }, (unused, index) => ({
      indices: index % 2,
      delayCs: 5 * (index + 1),
    })),
  });
}

describe('framesJob', () => {
  it('decodes every frame of an animated GIF and transfers their buffers back', async () => {
    const outcome = await framesJob({ assetId: 'a', bytes: gif(3), ...LIMITS });
    expect(outcome.response).toMatchObject({
      assetId: 'a',
      widthPx: 3,
      heightPx: 2,
      plays: Infinity,
    });
    expect(outcome.response.frames.map(({ durationMs }) => durationMs)).toEqual([50, 100, 150]);
    expect([...(outcome.response.frames[1]?.rgba.subarray(0, 4) ?? [])]).toEqual([0, 0, 255, 255]);
    expect(outcome.transfer).toEqual(outcome.response.frames.map(({ rgba }) => rgba.buffer));
  });

  it('answers a still GIF, or a file that is not a GIF, with nothing to play', async () => {
    const still = await framesJob({ assetId: 's', bytes: gif(1), ...LIMITS });
    expect(still.response.frames).toEqual([]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
    const other = await framesJob({ assetId: 'p', bytes: png, ...LIMITS });
    expect(other.response.frames).toEqual([]);
    expect(other.transfer).toEqual([]);
  });

  it('keeps the frames within the request’s limits', async () => {
    const outcome = await framesJob({
      assetId: 'a',
      bytes: gif(2),
      maxLongEdgePx: 1,
      maxBytes: 64,
    });
    expect(outcome.response).toMatchObject({ widthPx: 1, heightPx: 1 });
  });
});
