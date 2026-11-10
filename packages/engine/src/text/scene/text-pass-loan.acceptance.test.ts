import { describe, expect, it } from 'vitest';

import { AtlasLoan } from '../../memory/atlas-loan.js';
import { budgetForDevice } from '../../memory/device-budget.js';
import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import type { ScenePass } from '../../scene/scene-pass.js';
import { SceneRenderer } from '../../scene/scene-renderer.js';
import { WorkerPool } from '../../workers/worker-pool.js';
import { textAtlasOptions, TEXT_ATLAS_SHARE } from '../atlas/glyph-atlas-sizing.js';
import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';
import { FontLibrary } from '../font/font-library.js';

import { CAMERA } from './__fixtures__/text-objects.js';
import { FRAME_TITLE_PASS, FRAME_TITLE_PASS_NAME } from './frame-title-pass.js';
import { TEXT_PASS, TEXT_PASS_NAME } from './text-pass.js';

const MIB = 1024 * 1024;

/**
 * Reaches a pass's owned atlas so its public memory report can be checked.
 *
 * @param pass - The scene or frame-title pass.
 * @returns The glyph atlas.
 */
function atlasOf(pass: ScenePass): GlyphAtlas {
  return (pass as ScenePass & { readonly atlas: GlyphAtlas }).atlas;
}

describe('scene text atlas loan', () => {
  it('borrows at textBegin, returns pages on texture demand, and leaves frame titles at base', () => {
    const budget = budgetForDevice({
      isMobile: true,
      maxTextureSize: 8192,
      deviceMemoryGb: undefined,
    });
    const loan = new AtlasLoan({ texturesBytes: budget.bytesByCategory.textures });
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: {} });
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: [TEXT_PASS, FRAME_TITLE_PASS],
      environment: {
        budget,
        atlasLoan: loan,
        requestFrame: () => undefined,
        now: () => 0,
        text: { fonts: new FontLibrary(), jobs: pool },
      },
    });
    try {
      const textPass = renderer.scene.passes.find(({ name }) => name === TEXT_PASS_NAME);
      const titlePass = renderer.scene.passes.find(({ name }) => name === FRAME_TITLE_PASS_NAME);
      if (textPass === undefined || titlePass === undefined)
        throw new Error('Text pass is missing');
      const atlas = atlasOf(textPass);
      const titleAtlas = atlasOf(titlePass);
      const base = textAtlasOptions(budget, undefined, TEXT_ATLAS_SHARE).budgetBytes;
      if (base === undefined) throw new Error('No atlas base budget');
      const titleBase = titleAtlas.memory().budgetBytes;
      expect(base).toBe(17.5 * MIB);
      expect(titleBase).toBe(2.5 * MIB);

      renderer.renderFrame({ timeMs: 0, camera: CAMERA });
      expect(atlas.memory().budgetBytes).toBe(base + loan.lendableBytes);
      expect(atlas.pageSize).toBe(2048);
      expect(titleAtlas.memory().budgetBytes).toBe(titleBase);
      expect(titleAtlas.pageSize).toBe(512);

      const bitmap = {
        field: 'msdf' as const,
        width: 1022,
        height: 1022,
        pixels: new Uint8Array(1022 * 1022 * 4),
        left: 0,
        top: 1022,
        advance: 1022,
      };
      for (let key = 1; key <= 8; key += 1) {
        expect(atlas.insert('face', key, BASE_TIER, bitmap)).toBeDefined();
      }
      expect(atlas.pages.map(({ size }) => size)).toEqual([2048, 2048]);
      expect(atlas.memory().residentBytes).toBe(32 * MIB);
      expect(loan.borrowedBytes).toBe(32 * MIB - base);

      loan.reportTextures(0, budget.bytesByCategory.textures);
      renderer.renderFrame({ timeMs: 16, camera: CAMERA });
      expect([loan.lendableBytes, atlas.memory().budgetBytes]).toEqual([0, base]);
      expect(atlas.memory()).toMatchObject({
        residentBytes: 16 * MIB,
        pageCount: 1,
        evictedGlyphCount: 4,
      });
      expect(atlas.pages.map(({ size }) => size)).toEqual([2048]);
      expect(loan.borrowedBytes).toBe(0);
      expect(titleAtlas.memory().budgetBytes).toBe(titleBase);
    } finally {
      renderer.destroy();
      pool.terminate();
    }
  });
});
