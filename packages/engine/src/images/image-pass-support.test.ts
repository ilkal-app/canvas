import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';

import { ManualJobRunner } from './__fixtures__/manual-job-runner.js';
import { createImagePassSupport, NO_IMAGE_ASSETS } from './image-pass-support.js';

const PHOTO = 'photo' as AssetId;

describe('NO_IMAGE_ASSETS', () => {
  it('describes and loads nothing, so its images keep their placeholder', async () => {
    await expect(NO_IMAGE_ASSETS.describe(PHOTO)).rejects.toThrow('No asset source can load');
    await expect(NO_IMAGE_ASSETS.fetchLevel(PHOTO, 128)).rejects.toThrow(Error);
    await expect(NO_IMAGE_ASSETS.fetchOriginal(PHOTO)).rejects.toThrow(Error);
    const unsubscribe = NO_IMAGE_ASSETS.subscribe(PHOTO, () => undefined);
    expect(unsubscribe).not.toThrow();
  });
});

describe('createImagePassSupport', () => {
  it('wraps the source in a catalogue at the GPU texture limit, with the job pool', () => {
    const jobs = new ManualJobRunner();
    const { maxTextureSize } = new FakeGpuBackend().capabilities;

    const support = createImagePassSupport(NO_IMAGE_ASSETS, jobs, maxTextureSize);

    expect(support.catalogue.assets).toBe(NO_IMAGE_ASSETS);
    expect(support.jobs).toBe(jobs);
  });

  it('reports once, through the fault channel, that nothing can decode images', () => {
    const faults: Error[] = [];
    const support = createImagePassSupport(NO_IMAGE_ASSETS, new ManualJobRunner(), 4096, (error) =>
      faults.push(error),
    );

    support.reportDecoderMissing(new Error('No handler is registered for "decode" jobs.'));
    support.reportDecoderMissing(new Error('No handler is registered for "decode" jobs.'));

    expect(faults).toHaveLength(1);
    expect(faults[0]?.message).toContain('Images cannot be decoded');
  });
});
