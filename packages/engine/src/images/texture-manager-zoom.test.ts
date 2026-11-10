import { afterEach, expect, it, vi } from 'vitest';

import { imageObject } from './__fixtures__/image-objects.js';
import { cameraAt, TextureManagerHarness } from './__fixtures__/texture-manager-harness.js';
import { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';
import { ImagePlanner } from './image-planner.js';

const PHOTO = fixtureAssetId('photo');
const NATURAL_SIZE = { width: 1000, height: 666 };

async function settledAt(zoom: number) {
  const harness = new TextureManagerHarness(
    createFixtureAssetSource(5, { assets: { [PHOTO]: { naturalSize: NATURAL_SIZE } } }),
  );
  harness.track(imageObject({ width: 100, height: 66.6, x: 100, naturalSize: NATURAL_SIZE }));
  await harness.settle(cameraAt(zoom, 0));
  return harness;
}

afterEach(() => vi.restoreAllMocks());

it('skips planning within every image level band and plans on its upper boundary crossing', async () => {
  const harness = await settledAt(1);
  const plan = vi.spyOn(ImagePlanner.prototype, 'plan');
  harness.frame(cameraAt(1.01, 0));
  harness.frame(cameraAt(1.1, 0));
  expect(plan).not.toHaveBeenCalled();
  harness.frame(cameraAt(1.42, 0));
  expect(plan).toHaveBeenCalledOnce();
});

it('keeps the picked level on a zoom out until the lower hysteresis boundary is crossed', async () => {
  const harness = await settledAt(2);
  const plan = vi.spyOn(ImagePlanner.prototype, 'plan');
  harness.frame(cameraAt(1.8, 0));
  expect(plan).not.toHaveBeenCalled();
  harness.frame(cameraAt(1.01, 0));
  expect(plan).toHaveBeenCalledOnce();
});

it('does not reuse a scale interval after an image record changes', async () => {
  const harness = await settledAt(1);
  harness.frame(cameraAt(1.01, 0));
  const plan = vi.spyOn(ImagePlanner.prototype, 'plan');
  harness.track(imageObject({ width: 800, height: 533, x: 100, naturalSize: NATURAL_SIZE }));
  harness.frame(cameraAt(1.02, 0));
  expect(plan).toHaveBeenCalledOnce();
});
