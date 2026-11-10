// Drop shadows in z order through the FULL standard pass list:
// `createStandardScenePasses` with a job pool that meshes paths on the main thread, the default
// R-tree culler and the z-order segments. A shadowed shape's shadow lands over a gradient frame,
// an image and a path below it that only the shadow covers; a shadowed frame nested in a shadowed
// frame casts its shadow over the outer background; a shadowed shape inside a clipped, shadowed
// frame draws over the frame, its records carrying the frame's clip slot while the frame's own
// shadow carries none.
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardObject, Gradient, ObjectId, Shadow } from '@canvas/schema';

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

/** A shadow dropped 60 below its object, sharp. */
const DROPPED: Shadow = { x: 0, y: 60, blur: 0, spread: 0, color: [0, 0, 0, 0.5] };

const GRADIENT: Gradient = {
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: [1, 0, 0, 1] },
    { offset: 1, color: [0, 0, 1, 1] },
  ],
};

/** The standard passes' names, longest first, so a pipeline label is matched to its own. */
const PASS_NAMES = [
  'sdf-shape-gradient',
  'path-gradient',
  'rect-gradient',
  'frame-shadow',
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

/**
 * Renders the board through the standard passes until path meshes have landed, then names the
 * pass of each run of draws in the final frame, in order.
 *
 * @param objects - The board.
 * @returns The renderer, still alive, and one pass name per run of draws.
 */
async function drawStandard(
  ...objects: BoardObject[]
): Promise<{ renderer: SceneRenderer; passes: string[] }> {
  const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { mesh: meshJob } });
  pools.push(pool);
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: createStandardScenePasses({ jobs: pool }),
  });
  const document = new FakeSceneDocument();
  document.create(...objects);
  renderer.enqueue(document.takeChanges());
  for (let frame = 0; frame < 3; frame += 1) {
    renderer.renderFrame({ timeMs: frame * 16, camera: CAMERA });
    pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
    // Mesh results land on settled promises.
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  }
  backend.resetCalls();
  renderer.renderFrame({ timeMs: 64, camera: CAMERA });
  const passes: string[] = [];
  let pipeline = '';
  for (const call of backend.calls) {
    if (call.method === 'setPipeline') pipeline = passOfLabel(call.label);
    if (call.method !== 'draw') continue;
    if (passes.at(-1) !== pipeline) passes.push(pipeline);
  }
  return { renderer, passes };
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

describe('drop shadows in z order through the standard passes', () => {
  it('lay a shape’s shadow over a gradient frame, an image and a path below it', async () => {
    // The shape (0, 0)–(100, 100) drops its shadow to (0, 60)–(100, 160): only the shadow meets
    // the content, all below y = 110.
    const content = (): BoardObject[] => [
      frameObject('gradient-frame', {
        z: 'a0',
        x: 0,
        y: 120,
        width: 100,
        height: 100,
        background: GRADIENT,
        showName: false,
      }),
      { ...imageObject({ id: 'photo' as ObjectId, x: 0, y: 115, width: 40, height: 30 }), z: 'a1' },
      pathObject(
        'triangle',
        [
          { x: 50, y: 115 },
          { x: 90, y: 115 },
          { x: 70, y: 150 },
        ],
        { isClosed: true, isFilled: true },
        { z: 'a2' },
      ),
    ];
    const box = { z: 'a3', x: 0, y: 0, width: 100, height: 100 };
    const shadowed = await drawStandard(
      ...content(),
      shapeObject('shadowed', { ...box, shadow: DROPPED }),
    );
    const shape = shadowed.passes.lastIndexOf('sdf-shape');
    for (const below of ['rect-gradient', 'image', 'path']) {
      expect(shadowed.passes, below).toContain(below);
      expect(shadowed.passes.lastIndexOf(below), below).toBeLessThan(shape);
    }
    // Without its shadow the shape meets none of them: one segment, the shape pass before the
    // image and path passes.
    const plain = await drawStandard(...content(), shapeObject('plain', box));
    expect(plain.passes.indexOf('sdf-shape')).toBeLessThan(plain.passes.indexOf('image'));
  });

  it('cast a nested frame’s shadow over its shadowed parent’s background', async () => {
    const { passes } = await drawStandard(
      frameObject('outer', { z: 'a0', width: 300, height: 300, shadow: DROPPED, showName: false }),
      frameObject('inner', {
        parentId: 'outer',
        z: 'a0',
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        shadow: DROPPED,
        showName: false,
      }),
    );
    expect(passes).toEqual(['frame-shadow', 'solid-rect', 'frame-shadow', 'solid-rect']);
  });

  it('draw a shadowed shape in a clipped, shadowed frame over it, clipped by it alone', async () => {
    const { renderer, passes } = await drawStandard(
      frameObject('clip', { z: 'a0', clip: true, shadow: DROPPED, showName: false }),
      shapeObject('child', { parentId: 'clip', z: 'a0', x: 20, y: 20, shadow: DROPPED }),
    );
    expect(passes).toEqual(['frame-shadow', 'solid-rect', 'sdf-shape']);
    const slot = renderer.scene.clipTable.slotOf('clip' as ObjectId);
    expect(slot).toBeGreaterThan(0);
    expect(clipIndicesOf(renderer, 'frame-shadow', 'clip')).toEqual([0]);
    expect(clipIndicesOf(renderer, 'sdf-shape', 'child')).toEqual([slot, slot]);
  });
});
