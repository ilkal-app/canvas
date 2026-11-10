import { describe, expect, it, vi } from 'vitest';

import type { ScenePass } from '../../scene/scene-pass.js';
import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';

import { CAMERA, createTextSetUp, STYLE, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS, TEXT_PASS_NAME } from './text-pass.js';

const PAGE_BITMAP = {
  field: 'sdf' as const,
  width: 2044,
  height: 2044,
  pixels: new Uint8Array(2044 * 2044),
  left: 0,
  top: 24,
  advance: 24,
};

/**
 * Reaches the scene pass's owned atlas.
 *
 * @param pass - The scene text pass.
 * @returns Its glyph atlas.
 */
function atlasOf(pass: ScenePass): GlyphAtlas {
  return (pass as ScenePass & { readonly atlas: GlyphAtlas }).atlas;
}

describe('scene text pass eviction', () => {
  it('rewrites A when its atlas glyph is evicted without rewriting B', async () => {
    const setup = createTextSetUp(
      CAMERA,
      true,
      false,
      { passes: [TEXT_PASS] },
      { atlasBudgetBytes: 2 * 2048 * 2048 },
    );
    const { renderer, document, settle } = setup;
    try {
      const pass = renderer.scene.passes.find((candidate) => candidate.name === TEXT_PASS_NAME);
      if (pass === undefined) throw new Error('Scene text pass is missing');
      const atlas = atlasOf(pass);
      const lookup = vi.spyOn(atlas, 'lookup');
      document.create(textObject('a', 'A'), textObject('b', 'B', { x: 100 }));
      renderer.enqueue(document.takeChanges());
      await settle();
      const keys = [
        ...new Map(
          lookup.mock.calls
            .filter(([, , tier]) => tier === BASE_TIER)
            .map(([face, key, tier]) => [`${face}|${String(key)}`, [face, key, tier] as const]),
        ).values(),
      ];
      expect(keys).toHaveLength(2);
      lookup.mockRestore();

      atlas.clear();
      const firstKey = keys[0];
      const secondKey = keys[1];
      if (firstKey === undefined || secondKey === undefined) throw new Error('Missing glyph keys');
      const first = atlas.insert(...firstKey, PAGE_BITMAP);
      const second = atlas.insert(...secondKey, PAGE_BITMAP);
      expect(first?.pageId).toBeDefined();
      expect(second?.pageId).toBeDefined();
      expect(first?.pageId).not.toBe(second?.pageId);
      document.update('a', { text: 'A ', runs: [{ length: 2, style: STYLE }] });
      document.update('b', { text: 'B ', runs: [{ length: 2, style: STYLE }] });
      renderer.enqueue(document.takeChanges());
      await settle();
      expect(atlas.memory().glyphCount).toBe(2);

      atlas.beginFrame();
      const replacement = atlas.insert('other-face', 67, BASE_TIER, PAGE_BITMAP);
      expect(replacement).toBeDefined();
      expect(atlas.memory().evictedGlyphCount).toBe(1);
      const rewrites = vi.spyOn(renderer.scene, 'rewriteRecords');
      renderer.renderFrame({ timeMs: 2_000, camera: CAMERA });
      const rewrittenIds = rewrites.mock.calls
        .filter(([name]) => name === TEXT_PASS_NAME)
        .flatMap(([, targets]) => Array.from(targets, ({ object }) => object.id));
      expect(rewrittenIds).toEqual(['a']);
    } finally {
      renderer.destroy();
    }
  });
});
