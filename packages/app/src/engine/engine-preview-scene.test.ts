import { expect, it, vi } from 'vitest';

import { visibleWorldBounds, type EngineHost } from '@canvas/engine';

import { START_CAMERA } from './__fixtures__/fake-engine-host.js';
import { waitForSceneFrame } from './engine-preview-scene.js';

it('acknowledges the requested camera through an ordered projection read', async () => {
  const readProjection = vi.fn().mockResolvedValue({ camera: START_CAMERA });
  await waitForSceneFrame({ readProjection } as unknown as EngineHost, START_CAMERA);
  expect(readProjection).toHaveBeenCalledExactlyOnceWith(visibleWorldBounds(START_CAMERA));
});

it.each([undefined, { camera: { ...START_CAMERA, zoom: 2 } }])(
  'refuses a missing or mismatched projection',
  async (frame) => {
    const readProjection = vi.fn().mockResolvedValue(frame);
    await expect(
      waitForSceneFrame({ readProjection } as unknown as EngineHost, START_CAMERA),
    ).rejects.toThrow('could not be confirmed');
  },
);

it('refuses a host without an ordered projection capability', async () => {
  await expect(waitForSceneFrame({} as EngineHost, START_CAMERA)).rejects.toThrow(
    'could not be confirmed',
  );
});

it('discards an old camera response after a resize and confirms the new viewport', async () => {
  let camera = START_CAMERA;
  const resized = { ...START_CAMERA, viewportWidthPx: 800 };
  const readProjection = vi
    .fn()
    .mockImplementationOnce(() => {
      camera = resized;
      return Promise.resolve({ camera: START_CAMERA });
    })
    .mockResolvedValue({ camera: resized });
  await waitForSceneFrame({ readProjection } as unknown as EngineHost, () => camera);
  expect(readProjection.mock.calls).toEqual([
    [visibleWorldBounds(START_CAMERA)],
    [visibleWorldBounds(resized)],
  ]);
});

it('waits for a later ordered frame when the first read is temporarily busy', async () => {
  const readProjection = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValue({ camera: START_CAMERA });
  await waitForSceneFrame({ readProjection } as unknown as EngineHost, START_CAMERA);
  expect(readProjection).toHaveBeenCalledTimes(2);
});
