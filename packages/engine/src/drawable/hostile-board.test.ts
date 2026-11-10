// A board holding one hostile object of each kind beside honest ones: every reader of
// stored geometry treats the hostile ones as absent, the honest ones stay indexed, drawn, hittable
// and selectable, and nothing that is not finite reaches an index box or a GPU buffer.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { Camera, WorldBounds } from '../camera/camera.js';
import {
  FakeCanvas,
  FakeHostPlatform,
  ReadableFakeGpuBackend,
} from '../host/__fixtures__/fake-host-platform.js';
import type { EngineFrameReport } from '../host/engine-host.js';
import { EngineRuntime } from '../host/engine-runtime.js';
import { serializeChangeSet } from '../host/serializable-change-set.js';
import { createFixtureAssetSource } from '../images/fixture-asset-source.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, sourceOf } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { hitPoint } from '../spatial/hit-point.js';
import { hitRect } from '../spatial/hit-rect.js';
import { SceneSpatialIndex } from '../spatial/scene-spatial-index.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';
import { FontLibrary } from '../text/font/font-library.js';
import { addBundledFaces } from '../text/scene/__fixtures__/text-objects.js';
import { createDecodeJobHandler } from '../workers/decode-job.js';

import { BILLION_SIDES_AT, hostileBoard } from './__fixtures__/hostile-board.js';
import { DrawableGate } from './drawable-gate.js';

/** A camera over the honest objects, (-50, -50) to (750, 550). */
const CAMERA: Camera = {
  x: -50,
  y: -50,
  zoom: 1,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

/** Everything, and more: a marquee over the whole board. */
const EVERYWHERE: WorldBounds = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 };

/**
 * Whether a box has four finite edges.
 *
 * @param box - The box.
 * @returns True when every edge is finite.
 */
function isFiniteBox(box: WorldBounds | undefined): boolean {
  return box !== undefined && [box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite);
}

/**
 * Checks what an index holds: exactly the honest objects, each at a finite box, a sound tree.
 *
 * @param index - The index.
 * @param board - The board it was fed.
 */
function expectOnlyHonestBoxes(index: SceneSpatialIndex, board: ReturnType<typeof hostileBoard>) {
  expect(index.validate()).toEqual([]);
  for (const { object } of board.honest) expect(isFiniteBox(index.boundsOf(object.id))).toBe(true);
  for (const [id] of board.undrawable) expect(index.boundsOf(id)).toBeUndefined();
  expect(index.size).toBe(board.honest.length);
  expect(isFiniteBox(index.bounds)).toBe(true);
}

/**
 * Builds a hit-test index over a board as the app keeps one: every change set through a
 * `DrawableGate` first.
 *
 * @param objects - The board.
 * @returns The index, the gate and the document, for later changes.
 */
function gatedIndexOf(objects: readonly BoardObject[]) {
  const index = new SceneSpatialIndex();
  const gate = new DrawableGate();
  const document = new FakeSceneDocument();
  document.create(...objects);
  index.apply(gate.filter(document.takeChanges()));
  const change = (): void => {
    index.apply(gate.filter(document.takeChanges()));
  };
  return { index, document, change };
}

describe('a board with hostile objects: the hit-test index', () => {
  it('indexes the honest objects only, at finite boxes, and zoom to fit frames them', () => {
    const board = hostileBoard();
    const { index } = gatedIndexOf(board.objects);
    expectOnlyHonestBoxes(index, board);
    // Zoom to fit reads the index's bounds: the honest objects' union, nowhere near 1e308.
    const boxes = board.honest.flatMap(({ object }) => index.boundsOf(object.id) ?? []);
    expect(index.bounds).toEqual({
      minX: Math.min(...boxes.map((box) => box.minX)),
      minY: Math.min(...boxes.map((box) => box.minY)),
      maxX: Math.max(...boxes.map((box) => box.maxX)),
      maxY: Math.max(...boxes.map((box) => box.maxY)),
    });
    expect(index.bounds?.maxX).toBeLessThan(1000);
  });

  it('hits and marquee-selects every honest object and never a hostile one', () => {
    const board = hostileBoard();
    const { index } = gatedIndexOf(board.objects);
    const source = sourceOf(board.objects);
    for (const { object, inside } of board.honest) {
      expect(hitPoint(index, source, inside, { zoom: 1 })).toContain(object.id);
    }
    const marquee = hitRect(index, source, EVERYWHERE, 'intersect');
    expect(new Set(marquee)).toEqual(new Set(board.honest.map(({ object }) => object.id)));
  });

  it('follows an object into and out of undrawable, its children with it', () => {
    const board = hostileBoard();
    const { index, document, change } = gatedIndexOf(board.objects);
    document.update('honest-frame', { width: Number.POSITIVE_INFINITY });
    change();
    expect(index.boundsOf('honest-frame' as ObjectId)).toBeUndefined();
    expect(index.boundsOf('honest-child' as ObjectId)).toBeUndefined();
    document.update('honest-frame', { width: 100 });
    document.update('nan-frame', { x: 900 });
    change();
    for (const id of ['honest-frame', 'honest-child', 'nan-frame', 'orphan-shape']) {
      expect(isFiniteBox(index.boundsOf(id as ObjectId))).toBe(true);
    }
    expect(index.validate()).toEqual([]);
  });

  it('answers a hit test over the polygon with a billion sides at once, with nothing', () => {
    const board = hostileBoard();
    const { index } = gatedIndexOf(board.objects);
    const source = sourceOf(board.objects);
    const point = { x: BILLION_SIDES_AT.x + 5, y: BILLION_SIDES_AT.y + 5 };
    const start = performance.now();
    expect(hitPoint(index, source, point, { zoom: 1 })).toEqual([]);
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('never holds a box that is not finite, even fed the board without a gate', () => {
    const board = hostileBoard();
    const index = new SceneSpatialIndex();
    const source = sourceOf(board.objects);
    const ids = board.objects.map((object) => object.id);
    index.apply({ created: ids, updated: [], deleted: [], get: (id) => source.get(id) });
    expect(index.validate()).toEqual([]);
    for (const id of ids) {
      const box = index.boundsOf(id);
      if (box !== undefined) expect(isFiniteBox(box)).toBe(true);
    }
  });
});

describe('a board with hostile objects: the scene renderer', () => {
  it('culls against an index of honest boxes only, and draws them', () => {
    const board = hostileBoard();
    const culler = new SpatialCuller();
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: [SOLID_RECT_PASS, SDF_SHAPE_PASS],
      culler,
    });
    const document = new FakeSceneDocument();
    document.create(...board.objects);
    renderer.enqueue(document.takeChanges());
    const stats = renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expectOnlyHonestBoxes(culler.index, board);
    expect(stats.drawCalls).toBeGreaterThan(0);
    expect(
      new Map(renderer.takeUndrawable().objects.map(({ id, reason }) => [id, reason])),
    ).toEqual(board.undrawable);
  });
});

/** A fake backend that notes every buffer write holding a float that is not finite. */
class FiniteCheckingBackend extends ReadableFakeGpuBackend {
  /** The labels of buffers written with a value that is not finite. */
  readonly nonFiniteWrites: string[] = [];

  override writeBuffer(
    buffer: Parameters<ReadableFakeGpuBackend['writeBuffer']>[0],
    byteOffset: number,
    data: ArrayBufferView<ArrayBuffer>,
  ): void {
    super.writeBuffer(buffer, byteOffset, data);
    const floats = new Float32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
    if (!floats.every(Number.isFinite)) {
      this.nonFiniteWrites.push((buffer as unknown as { label: string }).label);
    }
  }
}

/**
 * Runs an engine on the thread over a board until it has no work left, text laid out and images
 * decoded: every standard pass (shapes, images, paths, text) over a fake GPU.
 *
 * @param objects - The board.
 * @returns The runtime, its backend, its frame reports and its faults.
 */
async function runEngineOver(objects: readonly BoardObject[]) {
  const platform = new FakeHostPlatform();
  const canvas = new FakeCanvas(800, 600);
  const backend = new FiniteCheckingBackend(canvas);
  const reports: EngineFrameReport[] = [];
  const faults: Error[] = [];
  const fonts = new FontLibrary();
  addBundledFaces(fonts);
  const runtime = new EngineRuntime(
    backend,
    canvas,
    platform,
    {},
    { onFrame: (report) => reports.push(report), onFault: (error) => faults.push(error) },
    {
      createTextResources: () => fonts,
      images: { assets: createFixtureAssetSource(1), decodeFallback: createDecodeJobHandler() },
    },
  );
  const document = new FakeSceneDocument();
  document.create(...objects);
  runtime.applyChangeSet(serializeChangeSet(document.takeChanges()));
  runtime.setCamera(CAMERA);
  let timeMs = 0;
  while (platform.pendingFrames > 0 && timeMs < 4000) {
    timeMs += 16;
    platform.runFrame(timeMs);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { runtime, backend, reports, faults };
}

describe('a board with hostile objects: the engine on its thread', () => {
  it('reports each undrawable object once, draws the honest ones, writes only finite values', async () => {
    const board = hostileBoard();
    const { runtime, backend, reports, faults } = await runEngineOver(board.objects);
    expect(faults).toEqual([]);
    expect(backend.nonFiniteWrites).toEqual([]);
    const reported = reports.flatMap((report) => report.undrawable ?? []);
    expect(reported.length).toBe(board.undrawable.size);
    expect(new Map(reported.map(({ id, reason }) => [id, reason]))).toEqual(board.undrawable);
    const { scene } = runtime.renderer;
    const slotsOf = (id: ObjectId): number =>
      scene.passes.reduce((count, pass) => count + scene.slotsOf(id, pass.name).length, 0);
    for (const { object } of board.honest) expect(slotsOf(object.id)).toBeGreaterThan(0);
    for (const [id] of board.undrawable) expect(slotsOf(id)).toBe(0);
    expect(reports.at(-1)?.stats.drawCalls).toBeGreaterThan(0);
    runtime.destroy();
  });
});
