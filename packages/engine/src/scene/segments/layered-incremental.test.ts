// Incremental layered planning against a fresh renderer: a layered board is drawn,
// then edited and viewed step by step, and after every step the renderer, which plans again only
// the windows that changed (layer windows kept, the canvas patched by its interval cache, records
// routed by the culler's coverage changes), draws exactly what a fresh renderer given the board as
// it now is draws: the same records in the same order on the same targets. The steps move objects
// inside a layer, across a layer's bounds and from one layer to another, change the coverage by
// zooming and panning, and flip layers to the small fallback and back.
import { afterEach, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import type { WorkerPool } from '../../workers/worker-pool.js';
import {
  type FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
  zKeyAt,
} from '../__fixtures__/scene-objects.js';

import { createDrawn, type Drawn, STANDARD_CAMERA } from './__fixtures__/standard-draw-order.js';

const pools: WorkerPool[] = [];

afterEach(() => {
  for (const pool of pools.splice(0)) pool.terminate();
});

/**
 * Renders until meshes and glyphs have landed, then renders once more with the calls recorded.
 *
 * @param drawn - The renderer.
 * @param camera - The camera.
 */
async function settle(drawn: Drawn, camera: Camera): Promise<void> {
  for (let frame = 0; frame < 6; frame += 1) {
    drawn.renderer.renderFrame({ timeMs: frame * 16, camera });
    drawn.pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  drawn.backend.resetCalls();
  drawn.renderer.renderFrame({ timeMs: 200, camera });
}

/**
 * The last frame's records in draw order, each as `target:pass:object`, the target numbered in
 * the order the frame began it (0 for the canvas).
 *
 * @param drawn - The renderer.
 * @returns The records.
 */
function signature(drawn: Drawn): string[] {
  const owners = new Map<string, Map<number, string>>();
  for (const { name } of drawn.renderer.scene.passes) {
    const slots = new Map<number, string>();
    for (const [id, entries] of drawn.renderer.scene.slotEntriesOf(name)) {
      for (const slot of entries) slots.set(slot, id);
    }
    owners.set(name, slots);
  }
  const result: string[] = [];
  const targets = new Map<unknown, number>();
  let pipeline = '';
  let target = 0;
  for (const call of drawn.backend.calls) {
    if (call.method === 'beginRenderPass') {
      const key = call.target ?? 'canvas';
      if (!targets.has(key)) targets.set(key, call.target === undefined ? 0 : targets.size + 1);
      target = targets.get(key) ?? 0;
    }
    if (call.method === 'setPipeline') pipeline = call.label.split(' ')[0] ?? '';
    if (call.method !== 'draw') continue;
    for (let index = 0; index < call.instanceCount; index += 1) {
      const owner = owners.get(pipeline)?.get(call.firstInstance + index);
      if (owner !== undefined) result.push(`${String(target)}:${pipeline}:${owner}`);
    }
  }
  return result;
}

/**
 * Four translucent frames of overlapping shapes in a row, one with a translucent group inside,
 * canvas shapes over and under them, and a fifth frame far to the right.
 *
 * @returns The board, bottom first.
 */
function board(): BoardObject[] {
  const objects: BoardObject[] = [];
  const add = (object: BoardObject) => objects.push({ ...object, z: zKeyAt(objects.length) });
  add(shapeObject('under', { x: 40, y: 40, width: 500, height: 40, fill: [0, 0, 1, 1] }));
  // Enough canvas records, overlapping in alternating passes so they form many segments, that a
  // small change patches the canvas's plan rather than planning it again.
  for (let index = 0; index < 288; index += 1) {
    const x = (index % 24) * 25;
    const y = 160 + Math.floor(index / 24) * 25;
    const kind = index % 2 === 0 ? 'rectangle' : 'ellipse';
    add(shapeObject(`grid${String(index)}`, { x, y, width: 30, height: 30, kind }));
  }
  for (let index = 0; index < 4; index += 1) {
    const x = index * 150;
    // Groups: a frame's name is drawn at a screen size, so zooming changes its drawing bounds.
    add(groupObject(`f${String(index)}`, { opacity: 0.5 }));
    for (let child = 0; child < 3; child += 1) {
      add(
        shapeObject(`s${String(index)}${String(child)}`, {
          parentId: `f${String(index)}`,
          x: x + 10 + child * 25,
          y: 10 + child * 25,
          width: 60,
          height: 60,
          fill: [child / 3, 0.5, 0, 1],
        }),
      );
    }
    add(shapeObject(`c${String(index)}`, { x: x + 100, y: 90, width: 60, height: 60 }));
  }
  add(groupObject('g', { parentId: 'f1', opacity: 0.5 }));
  add(shapeObject('g0', { parentId: 'g', x: 160, y: 40, width: 50, height: 50 }));
  add(shapeObject('g1', { parentId: 'g', x: 210, y: 90, width: 50, height: 50 }));
  // 75 px across: small (under 51.2 px) at 65%, a layer again (over 80 px) at 110%.
  add(groupObject('tiny', { opacity: 0.5 }));
  add(shapeObject('tiny0', { parentId: 'tiny', x: 640, y: 0, width: 50, height: 50 }));
  add(shapeObject('tiny1', { parentId: 'tiny', x: 665, y: 25, width: 50, height: 50 }));
  add(frameObject('far', { x: 2000, y: 0, width: 200, height: 200, opacity: 0.5 }));
  add(shapeObject('far0', { parentId: 'far', x: 2020, y: 20, width: 100, height: 100 }));
  add(shapeObject('over', { x: 0, y: 100, width: 600, height: 20, fill: [0, 1, 0, 1] }));
  return objects;
}

/** One step: an edit to the board (or none) and the camera it is viewed with. */
interface Step {
  readonly name: string;
  readonly edit?: (document: FakeSceneDocument) => void;
  readonly camera: Camera;
}

const AT_ONE = STANDARD_CAMERA;
const SLIGHTLY_OUT: Camera = { ...STANDARD_CAMERA, zoom: 0.65 };
const SLIGHTLY_IN: Camera = { ...STANDARD_CAMERA, zoom: 1.1 };
const ZOOMED_OUT: Camera = { ...STANDARD_CAMERA, zoom: 0.3 };
const PANNED: Camera = { ...STANDARD_CAMERA, x: 1500 };

const STEPS: readonly Step[] = [
  { name: 'the board', camera: AT_ONE },
  {
    name: 'a move inside a layer',
    edit: (document) => {
      document.update('s01', { x: 50 });
    },
    camera: AT_ONE,
  },
  {
    name: 'a canvas shape moved over a layer',
    edit: (document) => {
      document.update('c3', { x: 320, y: 30 });
    },
    camera: AT_ONE,
  },
  {
    name: 'a shape moved from one layer to another',
    edit: (document) => {
      document.update('s02', { parentId: 'f3' as ObjectId, x: 470, y: 20, z: 'a0zz' });
    },
    camera: AT_ONE,
  },
  { name: 'one layer falls back as small, the coverage the same', camera: SLIGHTLY_OUT },
  { name: 'and composites again', camera: SLIGHTLY_IN },
  { name: 'zoomed out: the layers fall back as small', camera: ZOOMED_OUT },
  {
    name: 'a move while fallen back',
    edit: (document) => {
      document.update('s11', { x: 170, y: 40 });
    },
    camera: ZOOMED_OUT,
  },
  { name: 'zoomed in again: the layers composite again', camera: SLIGHTLY_IN },
  {
    name: 'a move inside a nested layer',
    edit: (document) => {
      document.update('g1', { x: 200, y: 30 });
    },
    camera: AT_ONE,
  },
  { name: 'panned to the far layer', camera: PANNED },
  {
    name: 'panned back, with a move',
    edit: (document) => {
      document.update('c0', { x: 10, y: 10 });
    },
    camera: AT_ONE,
  },
];

it('draws what a fresh renderer draws after every move, coverage change and form flip', async () => {
  const retained = createDrawn(pools);
  retained.document.create(...board());
  const ids = board().map(({ id }) => id);
  for (const step of STEPS) {
    step.edit?.(retained.document);
    retained.renderer.enqueue(retained.document.takeChanges());
    await settle(retained, step.camera);
    const fresh = createDrawn(pools);
    fresh.document.create(
      ...ids
        .map((id) => retained.document.get(id))
        .filter((object): object is BoardObject => object !== undefined),
    );
    fresh.renderer.enqueue(fresh.document.takeChanges());
    await settle(fresh, step.camera);
    expect(signature(retained), step.name).toEqual(signature(fresh));
  }
});
