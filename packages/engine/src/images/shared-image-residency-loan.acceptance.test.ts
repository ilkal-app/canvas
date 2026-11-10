import { expect, it } from 'vitest';

import { visibleWorldBounds } from '../camera/camera.js';
import { AtlasLoan } from '../memory/atlas-loan.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import type { ScenePassEnvironment } from '../scene/scene-pass.js';

import { cameraAt, textureBudget } from './__fixtures__/texture-manager-harness.js';
import { NO_IMAGE_ASSETS, createImagePassSupport } from './image-pass-support.js';
import { SharedImageResidency } from './shared-image-residency.js';
import type { TextureManagerParts } from './texture-manager-parts.js';

const MIB = 1024 * 1024;

it('passes the environment loan to the shared image texture manager', () => {
  const texturesBytes = 40 * MIB;
  const loan = new AtlasLoan({ texturesBytes, marginBytes: 0 });
  loan.attachBorrower(() => 8 * MIB);
  const backend = new FakeGpuBackend();
  const jobs = {
    submit: () => {
      throw new Error('No image jobs are expected');
    },
    cancel: () => false,
    setPriority: () => false,
  };
  const environment = {
    backend,
    budget: textureBudget(texturesBytes),
    atlasLoan: loan,
    requestFrame: () => undefined,
    now: () => 0,
    images: createImagePassSupport(NO_IMAGE_ASSETS, jobs, backend.capabilities.maxTextureSize),
  } as ScenePassEnvironment;
  const holder = { passName: 'image', targets: new Map() };
  const shared = SharedImageResidency.join(environment, holder);
  try {
    const camera = cameraAt(1);
    const manager = shared.manager;
    manager.update({ camera, viewport: visibleWorldBounds(camera), frameIndex: 0, timeMs: 0 });
    const { residency } = (manager as unknown as { parts: TextureManagerParts }).parts;

    expect(residency.budgetBytes).toBe(texturesBytes - 8 * MIB);
  } finally {
    shared.leave(holder);
    environment.images?.catalogue.destroy();
  }
});
