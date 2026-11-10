import { describe, expect, it, vi } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import type { DrawListEntry } from './draw-list.js';
import type { SceneCuller } from './scene-culler.js';
import { SceneRenderer } from './scene-renderer.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };

/**
 * Loads a three-record paged pass and captures its culled draw lists.
 *
 * @param culler - An optional custom culler.
 * @returns The renderer, its captured draws and a page shift independent of document changes.
 */
function loaded(culler?: SceneCuller) {
  const shift = { value: 0 };
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    passes: [
      {
        ...FILLED_RECT_PASS,
        name: 'paged',
        pageOf: ({ object }) => (object.type === 'shape' ? object.cornerRadius : 0) + shift.value,
        pageEntries: () => [],
      },
    ],
    ...(culler === undefined ? {} : { culler }),
    isZOrdered: false,
  });
  const first = shapeObject('a');
  const document = new FakeSceneDocument();
  document.create(first, shapeObject('b', { cornerRadius: 1 }), shapeObject('c'));
  renderer.enqueue(document.takeChanges());
  const lists: DrawListEntry[][] = [];
  renderer.frame.insertStage('after', 'cull', {
    name: 'capture',
    run: ({ drawList }) => lists.push([...drawList]),
  });
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  return { renderer, lists, first, shift };
}

describe('paged culling on camera-only frames', () => {
  it('does not read paged records again when equivalent ranges are returned in a fresh array', () => {
    const { renderer, lists } = loaded({
      cull: () => new Map([['paged', [{ start: 0, count: 3 }]]]),
    });
    const pages = renderer.scene.pagesOf('paged');
    if (pages === undefined) throw new Error('fixture has no page table');
    let reads = 0;
    const counted = new Proxy(pages, {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, target) as unknown;
      },
    });
    vi.spyOn(renderer.scene, 'pagesOf').mockReturnValue(counted);
    renderer.renderFrame({ timeMs: 16, camera: { ...CAMERA, x: 1 } });
    const afterFirst = reads;
    renderer.renderFrame({ timeMs: 32, camera: { ...CAMERA, x: 2 } });
    expect(reads).toBe(afterFirst);
    expect(lists[2]).toEqual(lists[1]);
    renderer.destroy();
  });

  it('sees a custom culler mutating its reused range array', () => {
    const range = { start: 0, count: 3 };
    const ranges = [range];
    const { renderer, lists } = loaded({ cull: () => new Map([['paged', ranges]]) });
    range.start = 1;
    range.count = 1;
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(lists[1]).toEqual([{ passName: 'paged', page: 1, ranges: [{ start: 1, count: 1 }] }]);
    expect(lists[0]).toHaveLength(2);
    renderer.destroy();
  });

  it('invalidates the partition when an asynchronous rewrite changes only the page revision', () => {
    const { renderer, lists, first, shift } = loaded();
    shift.value = 5;
    renderer.scene.rewriteRecords('paged', [
      {
        object: first,
        transform: { cos: 1, sin: 0, x: 0, y: 0 },
      },
    ]);
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(lists[1]?.find(({ page }) => page === 5)?.ranges).toEqual([{ start: 0, count: 1 }]);
    expect(lists[1]?.find(({ page }) => page === 0)?.ranges).toEqual([{ start: 2, count: 1 }]);
    renderer.destroy();
  });
  it('connects default incremental culling to page patches without rereading retained records', () => {
    const culler = new SpatialCuller({ paddingFraction: 0 });
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      culler,
      isZOrdered: false,
      passes: [
        {
          ...FILLED_RECT_PASS,
          name: 'paged',
          pageOf: ({ object }) => (object.type === 'shape' ? object.cornerRadius : 0),
          pageEntries: () => [],
        },
      ],
    });
    const document = new FakeSceneDocument();
    for (let index = 0; index < 500; index += 1) {
      document.create(
        shapeObject(`s${String(index)}`, { x: index * 100, cornerRadius: index % 3 }),
      );
    }
    renderer.enqueue(document.takeChanges());
    const camera = { ...CAMERA, viewportWidthPx: 39_905 };
    renderer.renderFrame({ timeMs: 0, camera });
    const pages = renderer.scene.pagesOf('paged');
    if (!pages) throw new Error('No page table.');
    let reads = 0;
    const counted = new Proxy(pages, {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, target) as unknown;
      },
    });
    vi.spyOn(renderer.scene, 'pagesOf').mockReturnValue(counted);
    renderer.renderFrame({ timeMs: 16, camera });
    reads = 0;
    renderer.renderFrame({ timeMs: 32, camera: { ...camera, x: 1000 } });
    expect(reads).toBe(10);
    renderer.destroy();
  });
});
