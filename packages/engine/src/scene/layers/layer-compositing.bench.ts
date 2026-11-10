import { bench, describe } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { SDF_SHAPE_PASS } from '../../shapes/shape-pass.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
  zKeyAt,
} from '../__fixtures__/scene-objects.js';
import { FRAME_STROKE_PASS } from '../frame-stroke-pass.js';
import { SceneRenderer } from '../scene-renderer.js';
import { SOLID_RECT_PASS } from '../solid-rect-pass.js';

import { LAYER_COMPOSITE_PASS } from './layer-composite-pass.js';

// CPU cost of layer opacity in layer form through a fake backend: the plan's risk
// was 1–2 ms of CPU at 16 layers against the camera-only budget of 1 ms.
// A 10k grid of shapes, opaque, or with 16 of its 100-shape blocks in translucent containers
// (8 groups, 8 frames), so 1,600 of the objects draw through layers; or 24 of them, past the
// limit of 16, so 8 of them draw in the multiply form. Gated by
// `pnpm bench:ci` (its micro-benchmark suite).

const OBJECT_COUNT = 10_000;
const LAYER_COUNT = 16;
/** Past the per-frame limit of 16. */
const OVER_LIMIT = 24;
const BLOCK = 100;
const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1600,
  viewportHeightPx: 1000,
  dpr: 2,
};

/**
 * The board: 100 blocks of 100 shapes in a grid; the first `layers` blocks under a translucent
 * group (even) or frame (odd).
 *
 * @param layers - How many blocks are layers.
 * @returns The objects.
 */
function board(layers: number): BoardObject[] {
  const objects: BoardObject[] = [];
  for (let block = 0; block < OBJECT_COUNT / BLOCK; block += 1) {
    const blockX = (block % 10) * 200;
    const blockY = Math.floor(block / 10) * 200;
    const parent = block < layers ? `layer${String(block)}` : undefined;
    if (parent !== undefined) {
      const z = zKeyAt(block * (BLOCK + 1));
      objects.push(
        block % 2 === 0
          ? groupObject(parent, { z, opacity: 0.5 })
          : frameObject(parent, { x: blockX, y: blockY, width: 200, height: 200, z, opacity: 0.5 }),
      );
    }
    for (let index = 0; index < BLOCK; index += 1) {
      const isFrameChild = parent !== undefined && block % 2 === 1;
      const x = (isFrameChild ? 0 : blockX) + (index % 10) * 20;
      const y = (isFrameChild ? 0 : blockY) + Math.floor(index / 10) * 20;
      const z = zKeyAt(block * (BLOCK + 1) + index + 1);
      objects.push(
        shapeObject(`s${String(block)}-${String(index)}`, {
          x,
          y,
          z,
          width: 24,
          height: 24,
          ...(parent === undefined ? {} : { parentId: parent }),
        }),
      );
    }
  }
  return objects;
}

/**
 * A renderer over the board, rendered once so every buffer is uploaded and clean.
 *
 * @param layers - How many blocks are layers.
 * @returns The backend, the renderer and the document.
 */
function loadedRenderer(layers: number): {
  backend: FakeGpuBackend;
  renderer: SceneRenderer;
  document: FakeSceneDocument;
} {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [SOLID_RECT_PASS, FRAME_STROKE_PASS, LAYER_COMPOSITE_PASS, SDF_SHAPE_PASS],
  });
  const document = new FakeSceneDocument();
  document.create(...board(layers));
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  backend.resetCalls();
  return { backend, renderer, document };
}

for (const layers of [0, LAYER_COUNT, OVER_LIMIT]) {
  describe(`layer compositing, ${String(OBJECT_COUNT)} objects, ${String(layers)} layers`, () => {
    const still = loadedRenderer(layers);
    let stillTimeMs = 0;
    bench('still frame', () => {
      stillTimeMs += 16;
      still.renderer.renderFrame({ timeMs: stillTimeMs, camera: CAMERA });
      still.backend.resetCalls();
    });

    const panning = loadedRenderer(layers);
    let panTimeMs = 0;
    bench('camera-only frame (pan and zoom)', () => {
      panTimeMs += 16;
      const camera = { ...CAMERA, x: panTimeMs % 500, zoom: 1 + (panTimeMs % 7) / 10 };
      panning.renderer.renderFrame({ timeMs: panTimeMs, camera });
      panning.backend.resetCalls();
    });

    const dragging = loadedRenderer(layers);
    let dragTimeMs = 0;
    bench('drag one shape in the first block', () => {
      dragTimeMs += 16;
      dragging.document.update('s0-0', { x: dragTimeMs % 150 });
      dragging.renderer.enqueue(dragging.document.takeChanges());
      dragging.renderer.renderFrame({ timeMs: dragTimeMs, camera: CAMERA });
      dragging.backend.resetCalls();
    });
  });
}
