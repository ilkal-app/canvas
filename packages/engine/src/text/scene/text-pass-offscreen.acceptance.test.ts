import { describe, expect, it, vi } from 'vitest';

import type { Camera } from '../../camera/camera.js';
import { AllVisibleCuller } from '../../scene/scene-culler.js';
import type { SceneObject, ScenePass } from '../../scene/scene-pass.js';
import { SpatialCuller } from '../../spatial/spatial-culler.js';
import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { glyphFaceOf } from '../atlas/glyph-key.js';
import { BASE_TIER, HIGH_TIER } from '../atlas/glyph-tiers.js';
import { preloadLayoutShaper } from '../layout/layout-job.js';
import { GlyphSource } from '../msdf/glyph-source.js';

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
 * Gets the pass's atlas for controlled glyph landings and evictions.
 *
 * @param renderer - The fixture renderer.
 * @returns The text atlas.
 * @throws {Error} When the renderer has no text pass.
 */
function atlasOf(renderer: ReturnType<typeof createTextSetUp>['renderer']): GlyphAtlas {
  const pass = renderer.scene.passes.find((candidate) => candidate.name === TEXT_PASS_NAME);
  if (pass === undefined) throw new Error('Scene text pass is missing');
  return (pass as ScenePass & { readonly atlas: GlyphAtlas }).atlas;
}

/**
 * Renders through layout completion without draining the pending glyph jobs.
 *
 * @param setup - The text fixture.
 * @param camera - The camera used to create the incomplete entries.
 */
async function primeIncomplete(
  setup: ReturnType<typeof createTextSetUp>,
  camera: Camera = CAMERA,
): Promise<void> {
  await preloadLayoutShaper();
  setup.renderer.renderFrame({ timeMs: 0, camera });
  setup.pool.drainMainThread(1_000, () => 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  setup.renderer.renderFrame({ timeMs: 16, camera });
}

/**
 * Reads text IDs passed to record rewrites since a spy was cleared.
 *
 * @param calls - The scene rewrite spy's calls.
 * @returns Rewritten text IDs in call order.
 */
function rewrittenIds(calls: readonly (readonly [string, Iterable<SceneObject>])[]): string[] {
  return calls
    .filter(([name]) => name === TEXT_PASS_NAME)
    .flatMap(([, targets]) => Array.from(targets, ({ object }) => object.id));
}

describe('off-screen text atlas acceptance', () => {
  it('rewrites only visible incomplete text when a glyph lands', async () => {
    const setup = createTextSetUp(CAMERA, true, false, {
      culler: new SpatialCuller({ paddingFraction: 0 }),
      passes: [TEXT_PASS],
    });
    const { renderer, document } = setup;
    const requests = vi.spyOn(GlyphSource.prototype, 'request');
    try {
      document.create(textObject('visible', 'A'), textObject('offscreen', 'B', { x: 1_000 }));
      renderer.enqueue(document.takeChanges());
      await primeIncomplete(setup);
      expect(renderer.scene.levelOfDetail.visibleIds).toEqual(['visible']);
      const offscreenKey = requests.mock.calls.at(-1)?.[1];
      expect(offscreenKey).toBeDefined();
      const atlas = atlasOf(renderer);
      const rewrites = vi.spyOn(renderer.scene, 'rewriteRecords');
      const first = requests.mock.calls[0];
      if (first === undefined) throw new Error('Missing visible glyph request');
      requests.mockClear();
      atlas.insert(glyphFaceOf(first[0]), first[1], first[2], PAGE_BITMAP);
      renderer.renderFrame({ timeMs: 32, camera: CAMERA });
      expect(rewrittenIds(rewrites.mock.calls)).toEqual(['visible']);
      expect(requests.mock.calls.some(([, key]) => key === offscreenKey)).toBe(false);
    } finally {
      requests.mockRestore();
      renderer.destroy();
    }
  });

  it('rewrites an incomplete text as it enters view at the current scale tier', async () => {
    const zoomed: Camera = { ...CAMERA, zoom: 8 };
    const setup = createTextSetUp(zoomed, true, false, {
      culler: new SpatialCuller({ paddingFraction: 0 }),
      passes: [TEXT_PASS],
    });
    const { renderer, document } = setup;
    const requests = vi.spyOn(GlyphSource.prototype, 'request');
    try {
      document.create(textObject('visible', 'A'), textObject('offscreen', 'B', { x: 1_000 }));
      renderer.enqueue(document.takeChanges());
      await primeIncomplete(setup, zoomed);
      const atlas = atlasOf(renderer);
      const first = requests.mock.calls[0];
      if (first === undefined) throw new Error('Missing visible glyph request');
      atlas.insert(glyphFaceOf(first[0]), first[1], first[2], PAGE_BITMAP);
      const deferred = vi.spyOn(renderer.scene, 'rewriteRecords');
      renderer.renderFrame({ timeMs: 32, camera: zoomed });
      expect(rewrittenIds(deferred.mock.calls)).toEqual(['visible']);
      deferred.mockRestore();
      const rewrites = vi.spyOn(renderer.scene, 'rewriteRecords');
      requests.mockClear();
      const panned: Camera = { ...zoomed, x: 1_000 };
      renderer.renderFrame({ timeMs: 48, camera: panned });
      expect(renderer.scene.levelOfDetail.visibleIds).toEqual(['offscreen']);
      expect(rewrittenIds(rewrites.mock.calls)).toContain('offscreen');
      expect(requests.mock.calls.some(([, , tier]) => tier === HIGH_TIER)).toBe(true);
    } finally {
      requests.mockRestore();
      renderer.destroy();
    }
  });

  it('does not request high-tier glyphs for overview texts outside a zoomed viewport', async () => {
    const overview: Camera = { ...CAMERA, zoom: 0.3 };
    const setup = createTextSetUp(overview, true, false, {
      culler: new SpatialCuller({ paddingFraction: 0 }),
      passes: [TEXT_PASS],
    });
    const { renderer, document } = setup;
    const requests = vi.spyOn(GlyphSource.prototype, 'request');
    try {
      const letters = 'BCDEFGHIJK';
      document.create(
        textObject('visible', 'A'),
        ...Array.from(letters, (letter, index) =>
          textObject(`offscreen-${String(index)}`, letter, { x: 450 + index * 70 }),
        ),
      );
      renderer.enqueue(document.takeChanges());
      await primeIncomplete(setup, overview);
      expect(renderer.scene.levelOfDetail.visibleIds).toHaveLength(letters.length + 1);
      const offscreenKeys = new Set(requests.mock.calls.slice(1).map(([, key]) => key));
      expect(offscreenKeys.size).toBeGreaterThan(0);
      requests.mockClear();
      const zoomed: Camera = { ...CAMERA, zoom: 8 };
      const atlas = atlasOf(renderer);
      for (let frame = 0; frame < 3; frame += 1) {
        atlas.insert('landing-face', 1_000 + frame, BASE_TIER, PAGE_BITMAP);
        renderer.renderFrame({ timeMs: 32 + frame * 16, camera: zoomed });
        expect(renderer.scene.levelOfDetail.visibleIds).toEqual(['visible']);
      }
      expect(
        requests.mock.calls.filter(([, key, tier]) => tier === HIGH_TIER && offscreenKeys.has(key))
          .length,
      ).toBe(0);
    } finally {
      requests.mockRestore();
      renderer.destroy();
    }
  });

  it('defers an evicted off-screen cell until entry', async () => {
    const setup = createTextSetUp(
      CAMERA,
      true,
      false,
      {
        culler: new SpatialCuller({ paddingFraction: 0 }),
        passes: [TEXT_PASS],
      },
      { atlasBudgetBytes: 2 * 2048 * 2048 },
    );
    const { renderer, document, settle } = setup;
    try {
      const atlas = atlasOf(renderer);
      const lookup = vi.spyOn(atlas, 'lookup');
      document.create(textObject('visible', 'A'), textObject('offscreen', 'B', { x: 1_000 }));
      renderer.enqueue(document.takeChanges());
      await settle();
      const keys = [
        ...new Map(
          lookup.mock.calls
            .filter(([, , tier]) => tier === BASE_TIER)
            .map(([face, key, tier]) => [String(key), [face, key, tier] as const]),
        ).values(),
      ];
      lookup.mockRestore();
      atlas.clear();
      expect(keys).toHaveLength(2);
      const visibleKey = keys[0];
      const offscreenKey = keys[1];
      if (visibleKey === undefined || offscreenKey === undefined) throw new Error('Missing keys');
      const first = atlas.insert(...offscreenKey, PAGE_BITMAP);
      const second = atlas.insert(...visibleKey, PAGE_BITMAP);
      expect(first?.pageId).not.toBe(second?.pageId);
      document.update('visible', { text: 'A ', runs: [{ length: 2, style: STYLE }] });
      document.update('offscreen', { text: 'B ', runs: [{ length: 2, style: STYLE }] });
      renderer.enqueue(document.takeChanges());
      await settle();
      const pass = renderer.scene.passes.find((candidate) => candidate.name === TEXT_PASS_NAME);
      const entries = (
        pass as ScenePass & {
          readonly entries: Map<string, { quads?: { quads: ({ pageId: number } | undefined)[] } }>;
        }
      ).entries;
      const visiblePage = entries.get('visible')?.quads?.quads[0]?.pageId;
      const offscreenPage = entries.get('offscreen')?.quads?.quads[0]?.pageId;
      expect(visiblePage).toBeDefined();
      expect(offscreenPage).toBeDefined();
      expect(visiblePage).not.toBe(offscreenPage);
      const rewrites = vi.spyOn(renderer.scene, 'rewriteRecords');
      atlas.beginFrame();
      const keyToKeep = first?.pageId === visiblePage ? offscreenKey : visibleKey;
      atlas.lookup(...keyToKeep);
      atlas.beginFrame();
      atlas.insert('other-face', 999, BASE_TIER, PAGE_BITMAP);
      expect(atlas.memory().evictedGlyphCount).toBe(1);
      renderer.renderFrame({ timeMs: 2_000, camera: CAMERA });
      expect(rewrittenIds(rewrites.mock.calls)).toEqual([]);
      rewrites.mockClear();
      renderer.renderFrame({ timeMs: 2_016, camera: { ...CAMERA, x: 1_000 } });
      expect(rewrittenIds(rewrites.mock.calls)).toContain('offscreen');
    } finally {
      renderer.destroy();
    }
  });

  it('rewrites visible text on an evicted cell in the next frame', async () => {
    const setup = createTextSetUp(
      CAMERA,
      true,
      false,
      {
        culler: new SpatialCuller({ paddingFraction: 0 }),
        passes: [TEXT_PASS],
      },
      { atlasBudgetBytes: 2048 * 2048 },
    );
    const { renderer, document, settle } = setup;
    try {
      const atlas = atlasOf(renderer);
      const lookup = vi.spyOn(atlas, 'lookup');
      document.create(textObject('visible', 'A'));
      renderer.enqueue(document.takeChanges());
      await settle();
      const key = lookup.mock.calls.find(([, , tier]) => tier === BASE_TIER);
      lookup.mockRestore();
      if (key === undefined) throw new Error('Missing glyph key');
      atlas.clear();
      atlas.insert(...key, PAGE_BITMAP);
      document.update('visible', { text: 'A ', runs: [{ length: 2, style: STYLE }] });
      renderer.enqueue(document.takeChanges());
      await settle();
      const rewrites = vi.spyOn(renderer.scene, 'rewriteRecords');
      atlas.beginFrame();
      atlas.insert('other-face', 999, BASE_TIER, PAGE_BITMAP);
      expect(atlas.memory().evictedGlyphCount).toBe(1);
      renderer.renderFrame({ timeMs: 2_000, camera: CAMERA });
      expect(rewrittenIds(rewrites.mock.calls)).toEqual(['visible']);
    } finally {
      renderer.destroy();
    }
  });

  it('still rewrites every incomplete text when no visible set is supplied', async () => {
    const setup = createTextSetUp(CAMERA, true, false, {
      culler: new AllVisibleCuller(),
      passes: [TEXT_PASS],
    });
    const { renderer, document } = setup;
    try {
      document.create(textObject('a', 'A'), textObject('b', 'B', { x: 1_000 }));
      renderer.enqueue(document.takeChanges());
      await primeIncomplete(setup);
      expect(renderer.scene.levelOfDetail.visibleIds).toBeUndefined();
      const rewrites = vi.spyOn(renderer.scene, 'rewriteRecords');
      atlasOf(renderer).insert('landing-face', 999, BASE_TIER, PAGE_BITMAP);
      renderer.renderFrame({ timeMs: 32, camera: CAMERA });
      expect(rewrittenIds(rewrites.mock.calls)).toEqual(['a', 'b']);
    } finally {
      renderer.destroy();
    }
  });
});
