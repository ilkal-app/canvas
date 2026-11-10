import { bench, describe } from 'vitest';

import type { Camera } from '../camera/camera.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject, zKeyAt } from './__fixtures__/scene-objects.js';
import { SceneRenderer } from './scene-renderer.js';

// CPU cost of the frame loop through a fake backend (budget: a camera-only
// frame under 1 ms of CPU). The GPU side is exercised by the golden scene
// scene-graph-rects (tooling/golden/scenes).
// The frame includes z-order segments; segments/z-order-segments.bench.ts isolates them.
// Gated by `pnpm bench:ci` (its micro-benchmark suite).
// The 50k-object board and the 0.05×–32× zoom sweep are the frame-time suite's (tooling/bench,
// `zoom-sweep` on the 50k board), through the real engine host.

const OBJECT_COUNT = 10_000;
const CHANGE_COUNT = 100;
const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1600,
  viewportHeightPx: 1000,
  dpr: 2,
};

/**
 * A 100 × 100 grid of filled rectangles, stacked in creation order, rendered once so every
 * buffer is uploaded and clean.
 *
 * @returns The backend, the renderer and the document behind it.
 */
function loadedRenderer(): {
  backend: FakeGpuBackend;
  renderer: SceneRenderer;
  document: FakeSceneDocument;
} {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend);
  const document = new FakeSceneDocument();
  for (let index = 0; index < OBJECT_COUNT; index += 1) {
    const x = (index % 100) * 20;
    const y = Math.floor(index / 100) * 20;
    const z = zKeyAt(index);
    document.create(shapeObject(`s${String(index)}`, { x, y, z, width: 16, height: 16 }));
  }
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  backend.resetCalls();
  return { backend, renderer, document };
}

describe(`SceneRenderer frame, ${String(OBJECT_COUNT)} objects`, () => {
  const still = loadedRenderer();
  let stillTimeMs = 0;
  bench('still frame (nothing changed; uploads nothing)', () => {
    stillTimeMs += 16;
    still.renderer.renderFrame({ timeMs: stillTimeMs, camera: CAMERA });
    still.backend.resetCalls();
  });

  const panning = loadedRenderer();
  let panTimeMs = 0;
  bench('camera-only frame (pan and zoom; writes the camera uniform only)', () => {
    panTimeMs += 16;
    const camera = { ...CAMERA, x: panTimeMs % 500, zoom: 1 + (panTimeMs % 7) / 10 };
    panning.renderer.renderFrame({ timeMs: panTimeMs, camera });
    panning.backend.resetCalls();
  });

  const changing = loadedRenderer();
  let changeTimeMs = 0;
  bench(`apply and upload a ${String(CHANGE_COUNT)}-object change (scattered ids)`, () => {
    changeTimeMs += 16;
    for (let index = 0; index < CHANGE_COUNT; index += 1) {
      const id = `s${String((index * 97 + changeTimeMs) % OBJECT_COUNT)}`;
      changing.document.update(id, { rotation: changeTimeMs / 1000 });
    }
    changing.renderer.enqueue(changing.document.takeChanges());
    changing.renderer.renderFrame({ timeMs: changeTimeMs, camera: CAMERA });
    changing.backend.resetCalls();
  });

  const dragging = loadedRenderer();
  let dragTimeMs = 0;
  bench(`apply and upload a ${String(CHANGE_COUNT)}-object change (adjacent slots)`, () => {
    dragTimeMs += 16;
    for (let index = 0; index < CHANGE_COUNT; index += 1) {
      dragging.document.update(`s${String(index)}`, { x: dragTimeMs % 1000 });
    }
    dragging.renderer.enqueue(dragging.document.takeChanges());
    dragging.renderer.renderFrame({ timeMs: dragTimeMs, camera: CAMERA });
    dragging.backend.resetCalls();
  });
});
