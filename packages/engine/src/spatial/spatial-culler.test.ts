import { describe, expect, it } from 'vitest';

import type { Camera, WorldBounds } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { Scene } from '../scene/scene.js';

import { nestedBoard } from './__fixtures__/nested-board.js';
import { SpatialCuller } from './spatial-culler.js';

// A viewport 200 × 100 world units with its top-left corner at (x, y).
function viewportAt(x: number, y: number): WorldBounds {
  return { minX: x, minY: y, maxX: x + 200, maxY: y + 100 };
}

// A row of `count` 10 × 10 shapes, one every 100 units along x from 0 (slot n holds shape
// `s<n>`), in a scene and a culler fed the same change sets; `apply` feeds the next one.
function rowOfShapes(
  count: number,
  culler = new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 }),
) {
  const scene = new Scene([FILLED_RECT_PASS]);
  const document = new FakeSceneDocument();
  for (let index = 0; index < count; index += 1) {
    document.create(shapeObject(`s${String(index)}`, { x: index * 100 }));
  }
  const apply = () => {
    const changes = document.takeChanges();
    scene.apply(changes);
    culler.applyChanges(changes);
  };
  apply();
  return { scene, culler, document, apply };
}

describe('SpatialCuller', () => {
  it('draws only the objects whose boxes meet the padded viewport', () => {
    const { scene, culler } = rowOfShapes(20);
    // x 250..450 meets s3 (300..310) and s4 (400..410).
    expect(culler.cull(scene, viewportAt(250, 0))).toEqual(
      new Map([['solid-rect', [{ start: 3, count: 2 }]]]),
    );
  });

  it('pads the viewport by a fraction of its size, 25% by default', () => {
    const { scene, culler } = rowOfShapes(20, new SpatialCuller({ maxGapRecords: 0 }));
    // Padded by 50 on each side: x 200..500 meets s2 (200..210) to s5 (500..510).
    expect(culler.cull(scene, viewportAt(250, 0))).toEqual(
      new Map([['solid-rect', [{ start: 2, count: 4 }]]]),
    );
  });

  it('reuses the visible set while the camera stays inside the padded region', () => {
    const { scene, culler } = rowOfShapes(20, new SpatialCuller({ paddingFraction: 0.25 }));
    const first = culler.cull(scene, viewportAt(250, 0));
    expect(culler.queryCount).toBe(1);
    expect(culler.cull(scene, viewportAt(250, 0))).toBe(first);
    expect(culler.cull(scene, viewportAt(290, 10))).toBe(first);
    expect(culler.queryCount).toBe(1);
    culler.cull(scene, viewportAt(320, 0));
    expect(culler.queryCount).toBe(2);
  });

  it('adds and drops objects that enter or leave the padded region, searching the same region', () => {
    const { scene, culler, document, apply } = rowOfShapes(20);
    culler.cull(scene, viewportAt(250, 0));
    document.create(shapeObject('new', { x: 260 }));
    document.update('s4', { y: 5000 });
    apply();
    // `new` took slot 20; s4 (slot 4) moved away.
    expect(culler.cull(scene, viewportAt(250, 0))).toEqual(
      new Map([
        [
          'solid-rect',
          [
            { start: 3, count: 1 },
            { start: 20, count: 1 },
          ],
        ],
      ]),
    );
    document.delete('new');
    apply();
    expect(culler.cull(scene, viewportAt(250, 0))).toEqual(
      new Map([['solid-rect', [{ start: 3, count: 1 }]]]),
    );
    expect(culler.queryCount).toBe(3);
  });

  it('keeps its ranges when an object outside the visible set changes', () => {
    const { scene, culler, document, apply } = rowOfShapes(20);
    const ranges = culler.cull(scene, viewportAt(250, 0));
    document.update('s15', { fill: [0, 1, 0, 1] });
    apply();
    expect(culler.cull(scene, viewportAt(250, 0))).toBe(ranges);
  });

  it('keeps its ranges when a visible object moves within the view', () => {
    const { scene, culler, document, apply } = rowOfShapes(20);
    const ranges = culler.cull(scene, viewportAt(250, 0));
    document.update('s3', { x: 320, y: 40 });
    apply();
    expect(culler.cull(scene, viewportAt(250, 0))).toBe(ranges);
    expect(culler.queryCount).toBe(1);
  });

  it('rebuilds its ranges when a visible object gains a record they do not draw', () => {
    const { scene, culler, document, apply } = rowOfShapes(20);
    document.create(shapeObject('hollow', { x: 350, fill: null }));
    apply();
    expect(culler.cull(scene, viewportAt(250, 0))).toEqual(
      new Map([['solid-rect', [{ start: 3, count: 2 }]]]),
    );
    // Filled, it takes slot 20: still visible, but now it has a record to draw.
    document.update('hollow', { fill: [0, 0, 1, 1] });
    apply();
    expect(culler.cull(scene, viewportAt(250, 0))).toEqual(
      new Map([
        [
          'solid-rect',
          [
            { start: 3, count: 2 },
            { start: 20, count: 1 },
          ],
        ],
      ]),
    );
  });

  it('bridges short gaps of hidden records into one draw', () => {
    const view = { minX: 250, minY: 0, maxX: 1050, maxY: 100 };
    const exact = rowOfShapes(20, new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 }));
    const bridged = rowOfShapes(20, new SpatialCuller({ paddingFraction: 0, maxGapRecords: 16 }));
    for (const { document, apply } of [exact, bridged]) {
      document.update('s5', { y: 5000 });
      apply();
    }
    // x 250..1050 meets s3 … s10 but not s5, which moved away: slots 3, 4 and 6 … 10.
    expect(exact.culler.cull(exact.scene, view)).toEqual(
      new Map([
        [
          'solid-rect',
          [
            { start: 3, count: 2 },
            { start: 6, count: 5 },
          ],
        ],
      ]),
    );
    expect(bridged.culler.cull(bridged.scene, view)).toEqual(
      new Map([['solid-rect', [{ start: 3, count: 8 }]]]),
    );
  });

  it('draws every record at once when the query covers the whole board', () => {
    const { scene, culler } = rowOfShapes(20);
    expect(culler.cull(scene, { minX: -10, minY: -10, maxX: 5000, maxY: 100 })).toEqual(
      new Map([['solid-rect', [{ start: 0, count: 20 }]]]),
    );
  });

  it('culls the children of a frame that moves off-screen with it', () => {
    const scene = new Scene([FILLED_RECT_PASS]);
    const culler = new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 });
    const document = new FakeSceneDocument();
    document.create(...nestedBoard());
    const apply = () => {
      const changes = document.takeChanges();
      scene.apply(changes);
      culler.applyChanges(changes);
    };
    apply();
    const view = { minX: 0, minY: 100, maxX: 100, maxY: 200 };
    const visibleSlots = () =>
      [...(culler.cull(scene, view).get('solid-rect') ?? [])].flatMap(({ start, count }) =>
        Array.from({ length: count }, (unused, offset) => start + offset),
      );
    const slotOf = (id: string) => scene.slotsOf(id as never, 'solid-rect')[0];
    expect(visibleSlots()).toEqual([slotOf('f'), slotOf('f-a'), slotOf('g-b')].sort());
    document.update('f', { x: 1000 });
    apply();
    expect(visibleSlots()).toEqual([]);
  });

  it('is the SceneRenderer default and is fed the change sets the renderer applies', () => {
    const backend = new FakeGpuBackend();
    // Without z-order segments the draws are the culler's ranges as it made them, in slot order.
    const renderer = new SceneRenderer(backend, { isZOrdered: false });
    const document = new FakeSceneDocument();
    for (let index = 0; index < 50; index += 1) {
      document.create(shapeObject(`s${String(index)}`, { x: index * 100 }));
    }
    renderer.enqueue(document.takeChanges());
    const camera: Camera = {
      x: 1000,
      y: 0,
      zoom: 1,
      viewportWidthPx: 400,
      viewportHeightPx: 100,
      dpr: 1,
    };
    renderer.renderFrame({ timeMs: 0, camera });
    // x 1000..1400 padded by 100: 900..1500 meets s9 … s15.
    expect(backend.draws()).toEqual([
      { method: 'draw', vertexCount: 6, instanceCount: 7, firstVertex: 0, firstInstance: 9 },
    ]);
    document.update('s30', { x: 1200 });
    renderer.enqueue(document.takeChanges());
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 16, camera });
    expect(backend.draws()).toEqual([
      { method: 'draw', vertexCount: 6, instanceCount: 22, firstVertex: 0, firstInstance: 9 },
    ]);
  });

  it('culls the same objects when z-order segments reorder the draws', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend);
    const document = new FakeSceneDocument();
    for (let index = 0; index < 50; index += 1) {
      document.create(shapeObject(`s${String(index)}`, { x: index * 100 }));
    }
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({
      timeMs: 0,
      camera: { x: 1000, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 100, dpr: 1 },
    });
    // x 1000..1400 padded by 100: 900..1500 meets s9 … s15, whatever order they draw in.
    const drawnSlots = backend
      .draws()
      .flatMap(({ firstInstance, instanceCount }) =>
        Array.from({ length: instanceCount }, (unused, offset) => firstInstance + offset),
      )
      .sort((a, b) => a - b);
    expect(drawnSlots).toEqual([9, 10, 11, 12, 13, 14, 15]);
  });

  it('can be handed to SceneRenderer, which feeds it too', () => {
    const culler = new SpatialCuller();
    const renderer = new SceneRenderer(new FakeGpuBackend(), { culler });
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'));
    renderer.enqueue(document.takeChanges());
    expect(renderer.frame.stageNames).toContain('collectChanges');
    renderer.renderFrame({
      timeMs: 0,
      camera: { x: 0, y: 0, zoom: 1, viewportWidthPx: 10, viewportHeightPx: 10, dpr: 1 },
    });
    expect(culler.index.size).toBe(1);
  });

  it('rejects a negative or non-finite padding and a negative or fractional gap', () => {
    expect(() => new SpatialCuller({ paddingFraction: -0.1 })).toThrow(RangeError);
    expect(() => new SpatialCuller({ paddingFraction: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    expect(() => new SpatialCuller({ maxGapRecords: -1 })).toThrow(RangeError);
    expect(() => new SpatialCuller({ maxGapRecords: 1.5 })).toThrow(RangeError);
  });
});
