import { afterEach, describe, expect, it } from 'vitest';

import { MemoryLedger } from '../../diagnostics/memory-ledger.js';
import { EngineFoundation } from '../../host/engine-foundation.js';
import { budgetForDevice, type DeviceMemoryBudget } from '../../memory/device-budget.js';
import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import type { ScenePass, ScenePassFactory } from '../../scene/scene-pass.js';
import { WorkerPool } from '../../workers/worker-pool.js';
import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { FontLibrary } from '../font/font-library.js';

import { FRAME_TITLE_PASS } from './frame-title-pass.js';
import { TEXT_PASS } from './text-pass.js';

const MIB = 1024 * 1024;
const pools: WorkerPool[] = [];
const foundations: EngineFoundation[] = [];

/**
 * Creates a text pass with a fake backend and no GPU or font jobs.
 *
 * @param factory - The pass kind to create.
 * @param budget - The optional device budget.
 * @param atlasBudgetBytes - The optional explicit atlas cap.
 * @returns A pass with an atlas.
 */
function passOf(
  factory: ScenePassFactory,
  budget?: DeviceMemoryBudget,
  atlasBudgetBytes?: number,
): ScenePass {
  const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: {} });
  pools.push(pool);
  return factory.create({
    backend: new FakeGpuBackend(),
    requestFrame: () => undefined,
    now: () => 0,
    ...(budget === undefined ? {} : { budget }),
    text: {
      fonts: new FontLibrary(),
      jobs: pool,
      ...(atlasBudgetBytes === undefined ? {} : { atlasBudgetBytes }),
    },
  });
}

/**
 * Reaches the atlas owned by an existing text pass so its public sizing is observable.
 *
 * @param pass - The created text pass.
 * @returns Its glyph atlas.
 */
function atlasOf(pass: ScenePass): GlyphAtlas {
  return (pass as ScenePass & { readonly atlas: GlyphAtlas }).atlas;
}

afterEach(() => {
  for (const pool of pools.splice(0)) pool.terminate();
  for (const foundation of foundations.splice(0)) foundation.destroy();
});

describe('text pass atlas budgets', () => {
  it.each([
    { isMobile: false, textBytes: 56 * MIB, textPage: 2048, titleBytes: 8 * MIB, titlePage: 1024 },
    {
      isMobile: true,
      textBytes: 17.5 * MIB,
      textPage: 1024,
      titleBytes: 2.5 * MIB,
      titlePage: 512,
    },
  ])(
    'sizes both passes from the $isMobile device budget',
    ({ isMobile, textBytes, textPage, titleBytes, titlePage }) => {
      const budget = budgetForDevice({ isMobile, maxTextureSize: 8192, deviceMemoryGb: undefined });
      const text = atlasOf(passOf(TEXT_PASS, budget));
      const title = atlasOf(passOf(FRAME_TITLE_PASS, budget));

      expect([text.memory().budgetBytes, text.pageSize]).toEqual([textBytes, textPage]);
      expect([title.memory().budgetBytes, title.pageSize]).toEqual([titleBytes, titlePage]);
      expect(text.memory().budgetBytes + title.memory().budgetBytes).toBe(
        budget.bytesByCategory.atlases,
      );
    },
  );

  it.each([TEXT_PASS, FRAME_TITLE_PASS])(
    'keeps an explicit resource budget and 2048 pages for $name',
    (factory) => {
      const mobile = budgetForDevice({
        isMobile: true,
        maxTextureSize: 8192,
        deviceMemoryGb: undefined,
      });
      const atlas = atlasOf(passOf(factory, mobile, 5 * MIB));
      expect([atlas.memory().budgetBytes, atlas.pageSize]).toEqual([5 * MIB, 2048]);
    },
  );

  it.each([TEXT_PASS, FRAME_TITLE_PASS])(
    'keeps the legacy defaults without a device budget for $name',
    (factory) => {
      const atlas = atlasOf(passOf(factory));
      expect([atlas.memory().budgetBytes, atlas.pageSize]).toEqual([48 * MIB, 2048]);
    },
  );

  it('uses the adopted backend budget for passes created after device loss', () => {
    const firstBackend = new FakeGpuBackend({ maxTextureSize: 8192 });
    const foundation = new EngineFoundation(
      firstBackend,
      {},
      { createTextResources: () => new FontLibrary() },
      new MemoryLedger(),
    );
    foundations.push(foundation);
    const build = (factory: ScenePassFactory, backend: FakeGpuBackend): GlyphAtlas =>
      atlasOf(
        factory.create({
          ...foundation.environment,
          backend,
          requestFrame: () => undefined,
          now: () => 0,
        }),
      );
    expect([
      build(TEXT_PASS, firstBackend).memory().budgetBytes,
      build(FRAME_TITLE_PASS, firstBackend).memory().budgetBytes,
    ]).toEqual([56 * MIB, 8 * MIB]);

    const nextBackend = new FakeGpuBackend({ maxTextureSize: 2048 });
    foundation.adoptBackend(nextBackend);
    const text = build(TEXT_PASS, nextBackend);
    const title = build(FRAME_TITLE_PASS, nextBackend);
    expect([text.memory().budgetBytes, text.pageSize]).toEqual([28 * MIB, 2048]);
    expect([title.memory().budgetBytes, title.pageSize]).toEqual([4 * MIB, 512]);
  });
});
