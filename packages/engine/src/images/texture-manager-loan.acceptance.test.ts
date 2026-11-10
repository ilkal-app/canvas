import { describe, expect, it, vi } from 'vitest';

import { AtlasLoan } from '../memory/atlas-loan.js';

import { imageObject } from './__fixtures__/image-objects.js';
import {
  cameraAt,
  textureBudget,
  TextureManagerHarness,
} from './__fixtures__/texture-manager-harness.js';
import { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';
import type { TextureManagerParts } from './texture-manager-parts.js';
import { TextureManager } from './texture-manager.js';

const MIB = 1024 * 1024;
const TEXTURES_BYTES = 80 * MIB;
const PHOTO = fixtureAssetId('photo');

/**
 * Uses the texture manager harness's frame driver with a manager configured for a loan.
 *
 * @param loan - The optional loan.
 * @returns The harness.
 */
function harnessWithLoan(loan?: AtlasLoan): TextureManagerHarness {
  const harness = new TextureManagerHarness(
    createFixtureAssetSource(5, {
      assets: { [PHOTO]: { naturalSize: { width: 4000, height: 3000 } } },
    }),
    { texturesBytes: TEXTURES_BYTES },
  );
  harness.manager.destroy();
  harness.manager = new TextureManager({
    backend: harness.backend,
    catalogue: harness.catalogue,
    jobs: harness.jobs,
    ledger: harness.ledger,
    budget: textureBudget(TEXTURES_BYTES),
    requestFrame: () => {
      harness.frameRequests += 1;
    },
    ...(loan === undefined ? {} : { atlasLoan: loan }),
  });
  return harness;
}

/**
 * Reads the existing manager harness's residency for the effective byte cap.
 *
 * @param harness - The frame driver.
 * @returns The residency's budget and bytes.
 */
function residencyOf(harness: TextureManagerHarness): TextureManagerParts['residency'] {
  return (harness.manager as unknown as { parts: TextureManagerParts }).parts.residency;
}

describe('TextureManager with an atlas loan', () => {
  it('reports resident plus ideal pick bytes and the available texture capacity', async () => {
    const loan = new AtlasLoan({ texturesBytes: TEXTURES_BYTES, marginBytes: 0 });
    const report = vi.spyOn(loan, 'reportTextures');
    const harness = harnessWithLoan(loan);
    harness.track(imageObject());
    const camera = cameraAt(10);
    try {
      harness.frame(camera);
      await harness.jobs.settle();
      harness.frame(camera);

      // The ideal original is 4000 × 3000 RGBA; planning reserves its 0.8 share.
      expect(report).toHaveBeenCalledWith(0, (4000 * 3000 * 4) / 0.8, TEXTURES_BYTES);
      await harness.settle(camera);
      harness.frame(camera);
      expect(report).toHaveBeenLastCalledWith(
        residencyOf(harness).residentBytes,
        residencyOf(harness).residentBytes + (4000 * 3000 * 4) / 0.8,
        TEXTURES_BYTES,
      );
    } finally {
      harness.manager.destroy();
    }
  });

  it('stops uploads at textures minus borrowed bytes and restores the unloaned cap at zero', async () => {
    const loan = new AtlasLoan({ texturesBytes: TEXTURES_BYTES, marginBytes: 0 });
    let borrowed = 24 * MIB;
    loan.attachBorrower(() => borrowed);
    const harness = harnessWithLoan(loan);
    const baseline = harnessWithLoan();
    const camera = cameraAt(10);
    harness.track(imageObject());
    baseline.track(imageObject());
    try {
      await harness.settle(camera);
      expect(residencyOf(harness).budgetBytes).toBe(TEXTURES_BYTES - borrowed);
      expect(residencyOf(harness).residentBytes).toBeLessThanOrEqual(TEXTURES_BYTES - borrowed);
      expect(harness.manager.shownKeys(imageObject().id)).not.toContain('photo|L4000');
      borrowed = 0;
      harness.frame(cameraAt(9.9));
      await baseline.settle(camera);
      expect(baseline.manager.shownKeys(imageObject().id)).toContain('photo|L4000');
      expect(residencyOf(harness).budgetBytes).toBe(residencyOf(baseline).budgetBytes);
      expect(residencyOf(harness).budgetBytes).toBe(TEXTURES_BYTES);
    } finally {
      harness.manager.destroy();
      baseline.manager.destroy();
    }
  });
});
