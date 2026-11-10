import { describe, expect, it, vi } from 'vitest';

import { shapeObject } from '../../scene/__fixtures__/scene-objects.js';
import type { DrawListEntry } from '../../scene/draw-list.js';
import type { ScenePass } from '../../scene/scene-pass.js';
import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';

import { CAMERA, createTextSetUp, STYLE, textObject } from './__fixtures__/text-objects.js';
import { FRAME_TITLE_PASS, FRAME_TITLE_PASS_NAME } from './frame-title-pass.js';
import { TEXT_PASS, TEXT_PASS_NAME } from './text-pass.js';

const PAGE_BITMAP = {
  field: 'sdf' as const,
  width: 2044,
  height: 2044,
  pixels: new Uint8Array(2044 * 2044).fill(200),
  left: 0,
  top: 24,
  advance: 24,
};

/**
 * Reaches the pass-owned atlas whose glyphs can be replaced after layout settles.
 *
 * @param pass - The scene text or frame-title pass.
 * @returns Its atlas.
 */
function atlasOf(pass: ScenePass): GlyphAtlas {
  return (pass as ScenePass & { readonly atlas: GlyphAtlas }).atlas;
}

describe('text page-group draws', () => {
  it('draws alternating glyphs from two atlas pages in one scene text draw', async () => {
    const setup = createTextSetUp(CAMERA, true, false, { passes: [TEXT_PASS] });
    const { renderer, document, settle, backend } = setup;
    const pass = renderer.scene.passes.find((candidate) => candidate.name === TEXT_PASS_NAME);
    if (pass === undefined) throw new Error('Scene text pass is missing.');
    const atlas = atlasOf(pass);
    const lookup = vi.spyOn(atlas, 'lookup');
    document.create(textObject('t', 'ABA'));
    renderer.enqueue(document.takeChanges());
    await settle();
    const keys = [
      ...new Map(
        lookup.mock.calls
          .filter(([, , tier]) => tier === BASE_TIER)
          .map(([face, key, tier]) => [`${face}|${String(key)}`, { face, key, tier }] as const),
      ).values(),
    ];
    expect(keys).toHaveLength(2);
    atlas.clear();
    const pageIds = keys.map(
      ({ face, key, tier }) => atlas.insert(face, key, tier, PAGE_BITMAP)?.pageId,
    );
    expect(pageIds[0]).toBeDefined();
    expect(pageIds[1]).toBeDefined();
    expect(pageIds[0]).not.toBe(pageIds[1]);
    document.update('t', { text: 'ABA ', runs: [{ length: 4, style: STYLE }] });
    renderer.enqueue(document.takeChanges());
    await settle();
    const lists: DrawListEntry[][] = [];
    renderer.frame.insertStage('before', 'draw', {
      name: 'capture-page-group-draws',
      run: ({ drawList }) => lists.push(drawList.map((entry) => ({ ...entry }))),
    });
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 2_000, camera: CAMERA });
    expect(setup.records().map((record) => record[16])).toEqual([0, 1, 0]);
    expect(lists.at(-1)).toEqual([
      { passName: TEXT_PASS_NAME, page: 0, ranges: [{ start: 0, count: 3 }] },
    ]);
    expect(backend.draws()).toHaveLength(1);
    lookup.mockRestore();
    renderer.destroy();
  });

  it('keeps frame titles on one atlas page per draw', async () => {
    const setup = createTextSetUp(CAMERA, true, false, { passes: [FRAME_TITLE_PASS] });
    const { renderer, document, settle, backend } = setup;
    const pass = renderer.scene.passes.find(
      (candidate) => candidate.name === FRAME_TITLE_PASS_NAME,
    );
    if (pass === undefined) throw new Error('Frame title pass is missing.');
    const atlas = atlasOf(pass);
    const lookup = vi.spyOn(atlas, 'lookup');
    document.create({
      ...shapeObject('f'),
      type: 'frame',
      y: 80,
      width: 200,
      height: 100,
      name: 'ABA',
      clip: false,
      background: null,
    });
    renderer.enqueue(document.takeChanges());
    await settle();
    const keys = [
      ...new Map(
        lookup.mock.calls
          .filter(([, , tier]) => tier === BASE_TIER)
          .map(([face, key, tier]) => [`${face}|${String(key)}`, { face, key, tier }] as const),
      ).values(),
    ];
    expect(keys).toHaveLength(2);
    atlas.clear();
    const pageIds = keys.map(
      ({ face, key, tier }) => atlas.insert(face, key, tier, PAGE_BITMAP)?.pageId,
    );
    expect(pageIds[0]).not.toBe(pageIds[1]);
    document.update('f', { name: 'ABA ' });
    renderer.enqueue(document.takeChanges());
    await settle();
    const lists: DrawListEntry[][] = [];
    renderer.frame.insertStage('before', 'draw', {
      name: 'capture-title-page-draws',
      run: ({ drawList }) => lists.push(drawList.map((entry) => ({ ...entry }))),
    });
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 2_000, camera: CAMERA });
    expect(lists.at(-1)).toEqual([
      {
        passName: FRAME_TITLE_PASS_NAME,
        page: 0,
        ranges: [
          { start: 0, count: 1 },
          { start: 2, count: 1 },
        ],
      },
      { passName: FRAME_TITLE_PASS_NAME, page: 1, ranges: [{ start: 1, count: 1 }] },
    ]);
    expect(backend.draws()).toHaveLength(3);
    lookup.mockRestore();
    renderer.destroy();
  });
});
