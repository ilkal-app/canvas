import { describe, expect, it, vi } from 'vitest';

import { AtlasLoan } from '../memory/atlas-loan.js';

import { imageObject } from './__fixtures__/image-objects.js';
import {
  cameraAt,
  textureBudget,
  TextureManagerHarness,
} from './__fixtures__/texture-manager-harness.js';
import { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';
import type { ImagePlanner } from './image-planner.js';
import type { TextureManagerParts } from './texture-manager-parts.js';
import { TextureManager } from './texture-manager.js';

const MIB = 1024 * 1024;
const TEXTURES_BYTES = 80 * MIB;
const PHOTO = fixtureAssetId('photo');
/** The 4000 × 3000 original's bytes over the planning share: what the image wants. */
const WANTED = (4000 * 3000 * 4) / 0.8;

/**
 * A texture manager on the harness with a loan.
 *
 * @param loan - The loan.
 * @returns The harness.
 */
function harnessWith(loan: AtlasLoan): TextureManagerHarness {
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
    atlasLoan: loan,
  });
  return harness;
}

/**
 * The manager's residency, for its cap.
 *
 * @param harness - The harness.
 * @returns The residency.
 */
function residencyOf(harness: TextureManagerHarness): TextureManagerParts['residency'] {
  return (harness.manager as unknown as { parts: TextureManagerParts }).parts.residency;
}

/**
 * The manager's planner, for what its last plan wanted.
 *
 * @param harness - The harness.
 * @returns The planner.
 */
function plannerOf(harness: TextureManagerHarness): ImagePlanner {
  return (harness.manager as unknown as { planner: ImagePlanner }).planner;
}

/**
 * The manager's demand probe, for what it found the images want while lending.
 *
 * @param harness - The harness.
 * @returns The probe.
 */
function probeOf(harness: TextureManagerHarness): ImagePlanner {
  return (harness.manager as unknown as { demandProbe: ImagePlanner }).demandProbe;
}

describe('TextureManager taking memory back from the atlas', () => {
  it('takes back all the atlas borrows before lowering its cap after an allocation failure', async () => {
    const loan = new AtlasLoan({ texturesBytes: TEXTURES_BYTES, marginBytes: 0 });
    let borrowed = 20 * MIB;
    const release = vi.fn((target: number) => {
      borrowed = target;
    });
    loan.attachBorrower(() => borrowed, release);
    const harness = harnessWith(loan);
    // The placeholder and the atlas page fit; a texture of the image's own does not.
    harness.backend.maxLiveTextures = 2;
    harness.track(imageObject());
    try {
      await harness.settle(cameraAt(1));
      expect(harness.manager.stats.allocationFailures).toBeGreaterThanOrEqual(1);
      expect(release).toHaveBeenCalledWith(0);
      expect(borrowed).toBe(0);
    } finally {
      harness.manager.destroy();
    }
  });

  it('reclaims what the images want past its cap before the frame plans', async () => {
    const loan = new AtlasLoan({ texturesBytes: TEXTURES_BYTES, marginBytes: 0 });
    let borrowed = 40 * MIB;
    const release = vi.fn((target: number) => {
      borrowed = target;
    });
    loan.attachBorrower(() => borrowed, release);
    const harness = harnessWith(loan);
    harness.track(imageObject());
    const camera = cameraAt(10);
    try {
      harness.frame(camera);
      await harness.jobs.settle();
      const plan = vi.spyOn(plannerOf(harness), 'plan');
      release.mockClear();
      harness.frame(camera);
      // One plan, after the atlas gave back: nothing was loaded, flushed, uploaded or rebound
      // against the borrowed cap first.
      expect(plan).toHaveBeenCalledTimes(1);
      expect(release.mock.invocationCallOrder[0]).toBeLessThan(
        plan.mock.invocationCallOrder[0] ?? 0,
      );
      // The plan wanted the original past 80 − 40 MiB: the atlas gave back at once what the
      // resident levels and the original need beyond the cap, before the frame's only plan, which
      // therefore already wants the original.
      expect(release).toHaveBeenCalled();
      expect(plannerOf(harness).wants.has('photo|L4000')).toBe(true);
      expect(residencyOf(harness).budgetBytes).toBe(TEXTURES_BYTES - borrowed);
      expect(residencyOf(harness).budgetBytes).toBeGreaterThanOrEqual(
        residencyOf(harness).residentBytes + WANTED,
      );
      await harness.settle(camera);
      expect(harness.manager.shownKeys(imageObject().id)).toContain('photo|L4000');
    } finally {
      harness.manager.destroy();
    }
  });

  it('probes the levels the real plan keeps when lending starts on a held level', async () => {
    const loan = new AtlasLoan({ texturesBytes: TEXTURES_BYTES, marginBytes: 0 });
    let borrowed = 0;
    loan.attachBorrower(() => borrowed);
    const harness = harnessWith(loan);
    harness.track(imageObject());
    try {
      // 1200 px picks the 2048 level; at 440 px the 512 level fits but has too little room to
      // spare, so the plan holds 2048 where a plan with no history would pick 512.
      await harness.settle(cameraAt(3));
      expect(plannerOf(harness).wants.has('photo|L2048')).toBe(true);
      borrowed = 40 * MIB;
      harness.frame(cameraAt(1.1));
      expect(plannerOf(harness).wants.has('photo|L2048')).toBe(true);
      expect(probeOf(harness).wants.has('photo|L2048')).toBe(true);
      expect(probeOf(harness).wants.has('photo|L512')).toBe(false);
      expect(probeOf(harness).wantedBytes).toBe(plannerOf(harness).wantedBytes);
    } finally {
      harness.manager.destroy();
    }
  });

  it('lends only from what the textures may hold after an allocation failure or a reservation', () => {
    const loan = new AtlasLoan({ texturesBytes: 80 * MIB, marginBytes: 0 });
    loan.reportTextures(10 * MIB, 10 * MIB, 20 * MIB);
    expect(loan.lendableBytes).toBe(10 * MIB);
    loan.reportTextures(10 * MIB, 30 * MIB, 20 * MIB);
    expect(loan.lendableBytes).toBe(0);
  });

  it('asks the borrower for nothing when it borrows nothing', () => {
    const loan = new AtlasLoan({ texturesBytes: 80 * MIB, marginBytes: 0 });
    const release = vi.fn();
    loan.attachBorrower(() => 0, release);
    loan.reclaim(8 * MIB);
    expect(release).not.toHaveBeenCalled();
    loan.attachBorrower(() => 12 * MIB, release);
    loan.reclaim(20 * MIB);
    expect(release).toHaveBeenCalledWith(0);
  });
});
