import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';
import { visibleRanges } from '../spatial/visible-ranges.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { splitRangesByPage } from './page-split.js';
import type { ScenePass } from './scene-pass.js';
import { SceneRenderer } from './scene-renderer.js';

/**
 * A multi-record paged pass whose hidden threshold and pages vary independently.
 *
 * @param name - The pass name.
 * @param shifts - Asynchronous per-object page changes.
 * @param divisor - Record count and LOD size divisor.
 * @returns The scene pass.
 */
function pagedPass(
  name: string,
  shifts: ReadonlyMap<ObjectId, number>,
  divisor: number,
): ScenePass {
  return {
    ...FILLED_RECT_PASS,
    name,
    recordCount: (object) => (object.type === 'shape' ? Math.ceil(object.width / divisor) : 0),
    pageOf: ({ object }, record) => ((shifts.get(object.id) ?? 0) + record) % 5,
    pageEntries: () => [],
    levelOfDetail: {
      rule: { kind: name, levels: [{ belowPx: 3, form: 'hidden' }] },
      sizeOf: (object) => (object.type === 'shape' ? object.width / divisor : 0),
    },
  };
}

describe('incremental cull pipeline reference comparison', () => {
  it('matches full slot marking and page splitting through mixed zoom and asynchronous changes', () => {
    const shifts = new Map<ObjectId, number>();
    const culler = new SpatialCuller();
    const passes = [pagedPass('first', shifts, 10), pagedPass('second', shifts, 20)];
    const renderer = new SceneRenderer(new FakeGpuBackend(), { passes, culler });
    const document = new FakeSceneDocument();
    for (let index = 0; index < 300; index += 1) {
      document.create(
        shapeObject(`s${String(index)}`, {
          x: (index % 20) * 100,
          y: Math.floor(index / 20) * 100,
          width: 10 + (index % 40),
        }),
      );
    }
    renderer.enqueue(document.takeChanges());
    let compared = 0;
    renderer.frame.insertStage('after', 'cull', {
      name: 'compareReference',
      run({ scene, viewport, drawList }) {
        const ids = culler.visibleIdsFor(viewport);
        const ranges = visibleRanges(scene, ids, ids.length === culler.index.size, 16);
        const expected = passes.flatMap(({ name }) => {
          const pages = scene.pagesOf(name);
          if (!pages) throw new Error('No page table.');
          return splitRangesByPage(ranges.get(name) ?? [], pages).map(
            ({ page, ranges: pageRanges }) => ({ passName: name, page, ranges: pageRanges }),
          );
        });
        expect(drawList).toEqual(expected);
        compared += 1;
      },
    });
    const camera: Camera = {
      x: 0,
      y: 0,
      zoom: 1,
      dpr: 1,
      viewportWidthPx: 600,
      viewportHeightPx: 400,
    };
    renderer.renderFrame({ camera, timeMs: 0 });
    let seed = 156;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (let frame = 1; frame <= 200; frame += 1) {
      const id = `s${String(frame % 300)}`;
      if (frame % 3 === 0) {
        document.update(id, { x: random() * 2000, width: 5 + Math.floor(random() * 70) });
        renderer.enqueue(document.takeChanges());
      } else {
        const object = document.get(id as ObjectId);
        if (!object) throw new Error('No object.');
        shifts.set(object.id, frame % 5);
        renderer.scene.rewriteRecords('first', [
          { object, transform: { x: object.x, y: object.y, cos: 1, sin: 0 } },
        ]);
      }
      const zoom = 0.01 * 400 ** random();
      renderer.renderFrame({
        timeMs: frame * 16,
        camera: { ...camera, x: random() * 1500 - 100, y: random() * 1000 - 100, zoom },
      });
    }
    expect(compared).toBe(201);
    renderer.destroy();
  });
});
