// Frame outlines in z order through the FULL standard pass list (
// above the frame's children, as in Figma): `createStandardScenePasses`, the default R-tree
// culler and the z-order segments. A frame's outline draws at its closing paint rank: over its
// own background and its whole subtree (shapes, images, paths, nested frames and their
// outlines), under later siblings whatever pass draws them (a shape, a frame's background or
// shadow, an image); an outline outside the frame lands over an image below the frame that only
// the outline reaches; a clipping frame's own outline carries no clip slot while its child
// carries the frame's, and an ancestor's clip still cuts it. Each draw is read back as
// `pass:object` per record, so the tests pin record order, not just pass order.
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId, Shadow, Stroke } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { imageObject } from '../../images/__fixtures__/image-objects.js';
import { meshJob } from '../../paths/mesh-job.js';
import { pathObject } from '../../spatial/__fixtures__/spatial-objects.js';
import { WorkerPool } from '../../workers/worker-pool.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, frameObject, shapeObject } from '../__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene-renderer.js';
import { createStandardScenePasses } from '../standard-passes.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/** A 4 px outline. */
const OUTLINE: Stroke = { color: [0.1, 0.2, 0.3, 1], width: 4 };

/** A sharp shadow 10 right and down. */
const SHADOW: Shadow = { x: 10, y: 10, blur: 0, spread: 0, color: [0, 0, 0, 0.5] };

/** The standard passes' names, longest first, so a pipeline label is matched to its own. */
const PASS_NAMES = [
  'sdf-shape-gradient',
  'path-gradient',
  'rect-gradient',
  'frame-shadow',
  'frame-stroke',
  'frame-title',
  'solid-rect',
  'sdf-shape',
  'connector',
  'image',
  'path',
  'text',
];

const pools: WorkerPool[] = [];

afterEach(() => {
  for (const pool of pools.splice(0)) pool.terminate();
});

/**
 * The pass a pipeline belongs to, by its label (`<pass>` or `<pass> <variant>`).
 *
 * @param label - The pipeline's label.
 * @returns The pass name, or the label itself.
 */
function passOfLabel(label: string): string {
  return PASS_NAMES.find((name) => label === name || label.startsWith(`${name} `)) ?? label;
}

/** What {@link drawStandard} read back. */
interface DrawnBoard {
  readonly renderer: SceneRenderer;
  readonly backend: FakeGpuBackend;
  readonly document: FakeSceneDocument;
  /** One `pass:object` per drawn record, in draw order. */
  readonly records: string[];
}

/**
 * Reads the last frame's draws back as `pass:object` per record.
 *
 * @param renderer - The renderer.
 * @param backend - Its backend, holding the frame's calls.
 * @param ids - The board's ids.
 * @returns One entry per drawn record, in draw order.
 */
function recordsOf(renderer: SceneRenderer, backend: FakeGpuBackend, ids: readonly string[]) {
  const records: string[] = [];
  let pass = '';
  for (const call of backend.calls) {
    if (call.method === 'setPipeline') pass = passOfLabel(call.label);
    if (call.method !== 'draw') continue;
    for (let index = 0; index < call.instanceCount; index += 1) {
      const slot = call.firstInstance + index;
      const owner = ids.find((id) => renderer.scene.slotsOf(id as ObjectId, pass).includes(slot));
      if (owner !== undefined) records.push(`${pass}:${owner}`);
    }
  }
  return records;
}

/**
 * Renders the board through the standard passes until path meshes have landed, then reads the
 * final frame's records back.
 *
 * @param objects - The board.
 * @returns The renderer, backend and document, still alive, and the drawn records.
 */
async function drawStandard(...objects: BoardObject[]): Promise<DrawnBoard> {
  const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { mesh: meshJob } });
  pools.push(pool);
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: createStandardScenePasses({ jobs: pool }),
  });
  const document = new FakeSceneDocument();
  document.create(...objects);
  renderer.enqueue(document.takeChanges());
  const records = await settle(renderer, backend, pool, objects);
  return { renderer, backend, document, records };
}

/**
 * Renders frames until path meshes have landed, then one more, and reads its records.
 *
 * @param renderer - The renderer.
 * @param backend - Its backend.
 * @param pool - Its job pool.
 * @param objects - The board.
 * @param camera - The camera; default the origin at 100%.
 * @returns The final frame's records.
 */
async function settle(
  renderer: SceneRenderer,
  backend: FakeGpuBackend,
  pool: WorkerPool,
  objects: readonly BoardObject[],
  camera: Camera = CAMERA,
): Promise<string[]> {
  for (let frame = 0; frame < 3; frame += 1) {
    renderer.renderFrame({ timeMs: frame * 16, camera });
    pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
    // Mesh results land on settled promises.
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  }
  backend.resetCalls();
  renderer.renderFrame({ timeMs: 64, camera });
  return recordsOf(
    renderer,
    backend,
    objects.map(({ id }) => id),
  );
}

/**
 * The clip index each of an object's records carries in a pass.
 *
 * @param renderer - The renderer.
 * @param passName - The pass.
 * @param id - The object.
 * @returns One clip index per record.
 */
function clipIndicesOf(renderer: SceneRenderer, passName: string, id: string): number[] {
  const buffer = renderer.scene.instanceBufferOf(passName);
  const { floatsPerRecord, clipFloat = -1 } = buffer.layout;
  return renderer.scene
    .slotsOf(id as ObjectId, passName)
    .map((slot) => buffer.data[slot * floatsPerRecord + clipFloat] ?? -1);
}

/**
 * A frame with no name drawn, so the frame title pass draws nothing.
 *
 * @param id - Its id.
 * @param overrides - Fields to change.
 * @returns The frame.
 */
const framed = (id: string, overrides: Parameters<typeof frameObject>[1] = {}) =>
  frameObject(id, { showName: false, ...overrides });

describe('frame outlines in z order through the standard passes', () => {
  it('draw over the frame’s background and over its children', async () => {
    const { records } = await drawStandard(
      framed('frame', { z: 'a0', width: 300, height: 200, stroke: OUTLINE }),
      shapeObject('child', { parentId: 'frame', z: 'a0', x: -10, y: 20, width: 60, height: 40 }),
    );
    expect(records).toEqual(['solid-rect:frame', 'sdf-shape:child', 'frame-stroke:frame']);
  });

  it('draw over every pass of the subtree: images and paths too', async () => {
    const { records } = await drawStandard(
      framed('frame', { z: 'a0', width: 300, height: 200, stroke: OUTLINE }),
      {
        ...imageObject({ id: 'photo' as ObjectId, x: -10, y: 10, width: 80, height: 60 }),
        parentId: 'frame' as ObjectId,
        z: 'a0',
      },
      pathObject(
        'pen',
        [
          { x: 0, y: 100 },
          { x: 320, y: 100 },
        ],
        {},
        { parentId: 'frame', z: 'a1' },
      ),
    );
    expect(records.at(-1)).toBe('frame-stroke:frame');
    expect(records).toContain('image:photo');
    expect(records).toContain('path:pen');
  });

  it('close a nested frame inside its parent: inner outline over its child, outer over both', async () => {
    const { records } = await drawStandard(
      framed('outer', { z: 'a0', width: 300, height: 300, stroke: OUTLINE }),
      framed('inner', {
        parentId: 'outer',
        z: 'a0',
        x: -20,
        y: 50,
        width: 100,
        height: 100,
        stroke: OUTLINE,
        strokeAlign: 'outside',
      }),
      shapeObject('leaf', { parentId: 'inner', z: 'a0', x: -10, y: 10, width: 40, height: 40 }),
    );
    expect(records).toEqual([
      'solid-rect:outer',
      'solid-rect:inner',
      'sdf-shape:leaf',
      'frame-stroke:inner',
      'frame-stroke:outer',
    ]);
  });

  it('go under later siblings, whatever pass draws them', async () => {
    const outlined = framed('frame', { z: 'a0', width: 200, height: 200, stroke: OUTLINE });
    // Each later sibling covers the frame's right edge, where the outline is.
    const shape = await drawStandard(
      outlined,
      shapeObject('above', { z: 'a1', x: 180, y: 50, width: 60, height: 40 }),
    );
    expect(shape.records).toEqual(['solid-rect:frame', 'frame-stroke:frame', 'sdf-shape:above']);
    const frame = await drawStandard(
      outlined,
      framed('next', { z: 'a1', x: 180, y: 50, width: 60, height: 40, shadow: SHADOW }),
    );
    expect(frame.records).toEqual([
      'solid-rect:frame',
      'frame-stroke:frame',
      'frame-shadow:next',
      'solid-rect:next',
    ]);
    const image = await drawStandard(outlined, {
      ...imageObject({ id: 'photo' as ObjectId, x: 180, y: 50, width: 60, height: 40 }),
      z: 'a1',
    });
    expect(image.records).toEqual(['solid-rect:frame', 'frame-stroke:frame', 'image:photo']);
  });

  it('lay an outline reaching outside the frame over an image below it', async () => {
    // The frame (0, 0)–(100, 100) has a 4 px outline outside it, to y = 104; the image below the
    // frame starts at y = 102, so only the outline meets it.
    const content = (): BoardObject => ({
      ...imageObject({ id: 'photo' as ObjectId, x: 0, y: 102, width: 40, height: 30 }),
      z: 'a0',
    });
    const box = { z: 'a1', width: 100, height: 100, background: null };
    const outside = await drawStandard(
      content(),
      framed('frame', { ...box, stroke: OUTLINE, strokeAlign: 'outside' }),
    );
    expect(outside.records).toEqual(['image:photo', 'frame-stroke:frame']);
  });

  it('are never cut by the frame’s own clip, which still cuts its child; an ancestor’s is', async () => {
    const { renderer, records } = await drawStandard(
      framed('outer', { z: 'a0', clip: true, width: 400, height: 400 }),
      framed('clip', { parentId: 'outer', z: 'a0', clip: true, stroke: OUTLINE }),
      shapeObject('child', { parentId: 'clip', z: 'a0', x: 20, y: 20 }),
    );
    expect(records).toEqual([
      'solid-rect:outer',
      'solid-rect:clip',
      'sdf-shape:child',
      'frame-stroke:clip',
    ]);
    const outerSlot = renderer.scene.clipTable.slotOf('outer' as ObjectId);
    const slot = renderer.scene.clipTable.slotOf('clip' as ObjectId);
    expect(slot).toBeGreaterThan(0);
    expect(clipIndicesOf(renderer, 'frame-stroke', 'clip')).toEqual([outerSlot]);
    expect(clipIndicesOf(renderer, 'sdf-shape', 'child')).toEqual([slot]);
  });

  it('move to the subtree’s end when a stroke is given, and back when it is taken', async () => {
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { mesh: meshJob } });
    pools.push(pool);
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: createStandardScenePasses({ jobs: pool }),
    });
    const document = new FakeSceneDocument();
    const board = [
      framed('frame', { z: 'a0', width: 300, height: 200 }),
      shapeObject('child', { parentId: 'frame', z: 'a0', x: -10, y: 20, width: 60, height: 40 }),
    ];
    document.create(...board);
    renderer.enqueue(document.takeChanges());
    expect(await settle(renderer, backend, pool, board)).toEqual([
      'solid-rect:frame',
      'sdf-shape:child',
    ]);
    document.update('frame', { stroke: OUTLINE });
    renderer.enqueue(document.takeChanges());
    expect(await settle(renderer, backend, pool, board)).toEqual([
      'solid-rect:frame',
      'sdf-shape:child',
      'frame-stroke:frame',
    ]);
    document.update('frame', { stroke: null });
    renderer.enqueue(document.takeChanges());
    expect(await settle(renderer, backend, pool, board)).toEqual([
      'solid-rect:frame',
      'sdf-shape:child',
    ]);
  });

  it('keep their place through culling and through a sibling moved onto the outline', async () => {
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { mesh: meshJob } });
    pools.push(pool);
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: createStandardScenePasses({ jobs: pool }),
    });
    const document = new FakeSceneDocument();
    const board = [
      framed('frame', { z: 'a0', width: 300, height: 200, stroke: OUTLINE }),
      shapeObject('child', { parentId: 'frame', z: 'a0', x: -10, y: 20, width: 60, height: 40 }),
      shapeObject('far', { z: 'a1', x: 600, y: 0, width: 60, height: 40 }),
    ];
    document.create(...board);
    renderer.enqueue(document.takeChanges());
    const whole = ['solid-rect:frame', 'sdf-shape:child', 'frame-stroke:frame', 'sdf-shape:far'];
    expect(await settle(renderer, backend, pool, board)).toEqual(whole);
    // Panned so only the far shape shows, then back: the cull deltas patch the plan.
    const panned = { ...CAMERA, x: 560 };
    expect(await settle(renderer, backend, pool, board, panned)).toEqual(['sdf-shape:far']);
    expect(await settle(renderer, backend, pool, board)).toEqual(whole);
    // The far shape dragged onto the frame's right edge stays over the outline.
    document.update('far', { x: 280, y: 50 });
    renderer.enqueue(document.takeChanges());
    expect(await settle(renderer, backend, pool, board)).toEqual(whole);
  });
});
