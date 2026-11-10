import { describe, expect, it } from 'vitest';

import { AtlasLoan } from '../../memory/atlas-loan.js';
import { budgetForDevice } from '../../memory/device-budget.js';
import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';

import { FRAME_TITLE_PASS_KIND } from './frame-title-pass.js';
import { loanedTextAtlas } from './text-atlas-loan.js';
import { TEXT_PASS_KIND } from './text-pass-definition.js';

const budget = budgetForDevice({ isMobile: true, maxTextureSize: 8192, deviceMemoryGb: undefined });

function environment(maxTextureSize: number) {
  return {
    backend: new FakeGpuBackend({ maxTextureSize }),
    budget,
    atlasLoan: new AtlasLoan({ texturesBytes: budget.bytesByCategory.textures }),
  };
}

describe('loanedTextAtlas single-channel page sizing', () => {
  it.each([8192, 2048])('doubles scene R8 sides up to backend limit %i', (limit) => {
    const { atlas } = loanedTextAtlas(environment(limit), {}, TEXT_PASS_KIND);
    expect(atlas.singleChannelPageSize).toBe(Math.min(2 * atlas.pageSize, limit));
    expect(atlas.singleChannelPageSize).toBeGreaterThanOrEqual(atlas.pageSize);
  });

  it('keeps frame titles and explicit-budget text at their ordinary page side', () => {
    const env = environment(8192);
    const title = loanedTextAtlas(env, {}, FRAME_TITLE_PASS_KIND).atlas;
    const explicit = loanedTextAtlas(
      env,
      { atlasBudgetBytes: 8 * 1024 * 1024 },
      TEXT_PASS_KIND,
    ).atlas;
    expect(title.singleChannelPageSize).toBe(title.pageSize);
    expect(explicit.singleChannelPageSize).toBe(explicit.pageSize);
  });
});
