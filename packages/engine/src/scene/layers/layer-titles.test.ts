import { afterEach, describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FRAME_TITLE_SHADER } from '../../gpu/shaders/frame-title.generated.js';
import { hitPoint } from '../../spatial/hit-point.js';
import { SceneSpatialIndex } from '../../spatial/scene-spatial-index.js';
import { FontLibrary } from '../../text/font/font-library.js';
import { addBundledFaces } from '../../text/scene/__fixtures__/text-objects.js';
import { FRAME_TITLE_PASS_NAME } from '../../text/scene/frame-title-pass.js';
import { createDefaultJobHandlers } from '../../workers/default-job-handlers.js';
import { WorkerPool } from '../../workers/worker-pool.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, frameObject, groupObject } from '../__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene-renderer.js';
import {
  createDrawn,
  drawOrder,
  STANDARD_CAMERA,
  type Drawn,
} from '../segments/__fixtures__/standard-draw-order.js';
import { createStandardScenePasses } from '../standard-passes.js';

// Review (): a frame's name never fades at partial opacity, but at
// opacity 0, the frame's own or an ancestor's, it is hidden with the frame, which still hits.

const pools: WorkerPool[] = [];
afterEach(() => {
  for (const pool of pools.splice(0)) pool.terminate();
});

const BOARD = [
  frameObject('zero', { x: 0, y: 40, width: 80, height: 60, name: 'Zero', opacity: 0 }),
  groupObject('hidden', { opacity: 0 }),
  frameObject('inside', {
    parentId: 'hidden',
    x: 120,
    y: 40,
    width: 80,
    height: 60,
    name: 'Inside',
    showName: true,
  }),
  frameObject('half', { x: 240, y: 40, width: 80, height: 60, name: 'Half', opacity: 0.5 }),
];

/**
 * The transparency each of an object's records carries in a pass.
 *
 * @param drawn - The renderer.
 * @param id - The object.
 * @param pass - The pass.
 * @returns One value per record.
 */
function transparencies(drawn: Pick<Drawn, 'renderer'>, id: string, pass: string): number[] {
  const buffer = drawn.renderer.scene.instanceBufferOf(pass);
  const { floatsPerRecord, opacityFloat = -1 } = buffer.layout;
  return drawn.renderer.scene
    .slotsOf(id as ObjectId, pass)
    .map((slot) => buffer.data[slot * floatsPerRecord + opacityFloat] ?? -1);
}

describe('frame names under layer opacity', () => {
  it('hides the name of a frame at opacity 0, or under one, and keeps it whole at 0.5', async () => {
    const drawn = createDrawn(pools);
    drawn.document.create(...BOARD);
    drawn.renderer.enqueue(drawn.document.takeChanges());
    const order = await drawOrder(drawn);
    expect(order).not.toContain(`${FRAME_TITLE_PASS_NAME}:zero`);
    expect(order).not.toContain(`${FRAME_TITLE_PASS_NAME}:inside`);
    expect(order).toContain(`${FRAME_TITLE_PASS_NAME}:half`);
    const half = transparencies(drawn, 'half', FRAME_TITLE_PASS_NAME);
    expect(half.length).toBeGreaterThan(0);
    expect(half.every((value) => value === 0)).toBe(true);
    // The titled records exist; they are planned out, not dropped from the scene.
    expect(transparencies(drawn, 'zero', FRAME_TITLE_PASS_NAME).length).toBeGreaterThan(0);
  });

  it('keeps a frame at opacity 0, and one under such a group, hittable', () => {
    const document = new FakeSceneDocument();
    document.create(...BOARD);
    const index = new SceneSpatialIndex();
    index.apply(document.takeChanges());
    const options = { zoom: 1, tolerancePx: 0 };
    expect(hitPoint(index, document, { x: 40, y: 70 }, options)).toContain('zero');
    expect(hitPoint(index, document, { x: 160, y: 70 }, options)).toContain('inside');
  });

  it('hides those names without z-order segments too, where every opacity multiplies', async () => {
    const fonts = new FontLibrary();
    addBundledFaces(fonts);
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: createDefaultJobHandlers() });
    pools.push(pool);
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: createStandardScenePasses({ jobs: pool }),
      environment: { text: { fonts, jobs: pool } },
      isZOrdered: false,
    });
    const document = new FakeSceneDocument();
    document.create(...BOARD);
    renderer.enqueue(document.takeChanges());
    for (let frame = 0; frame < 6; frame += 1) {
      renderer.renderFrame({ timeMs: frame * 16, camera: STANDARD_CAMERA });
      pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // The title shader draws a name at full strength unless its record's transparency is 1: a
    // cumulative opacity of 0, the frame's own or an ancestor's.
    expect(FRAME_TITLE_SHADER.wgsl).toContain(
      'output.layerAlpha = select(1.0, 0.0, input.layerTransparency >= 1.0);',
    );
    for (const hidden of ['zero', 'inside']) {
      const values = transparencies({ renderer }, hidden, FRAME_TITLE_PASS_NAME);
      expect(values.length, hidden).toBeGreaterThan(0);
      expect(
        values.every((value) => value === 1),
        hidden,
      ).toBe(true);
    }
    const half = transparencies({ renderer }, 'half', FRAME_TITLE_PASS_NAME);
    expect(half.length).toBeGreaterThan(0);
    expect(half.every((value) => value > 0 && value < 1)).toBe(true);
  });
});
