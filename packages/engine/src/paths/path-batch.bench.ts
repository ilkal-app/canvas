import { bench, describe } from 'vitest';

import { createPathScene, PATH_CAMERA, zigzagPath } from './__fixtures__/path-scene.js';

// CPU drawEntry cost for the 50k fit's 6,000 opaque 2 px paths. The timed frame
// changes only the camera; meshes, draw-list entries and batch buffers are warm.
const PATH_COUNT = 6000;

function loadedScene(isBatched: boolean): ReturnType<typeof createPathScene> {
  const scene = createPathScene({ isBatched, maxMeshSegmentsPerFrame: Infinity });
  for (let index = 0; index < PATH_COUNT; index += 1) {
    scene.document.create(zigzagPath(`p${String(index)}`, index, { x: 100, y: 10 }));
  }
  scene.frame();
  return scene;
}

const batched = loadedScene(true);
const perPath = loadedScene(false);
let cameraX = 0;

describe('6,000 cached opaque path strokes, camera-only frame', () => {
  bench('batched drawEntry', () => {
    cameraX = cameraX === 0 ? 0.01 : 0;
    batched.backend.resetCalls();
    batched.frame({ ...PATH_CAMERA, x: cameraX });
  });

  bench('per-path drawEntry', () => {
    cameraX = cameraX === 0 ? 0.01 : 0;
    perPath.backend.resetCalls();
    perPath.frame({ ...PATH_CAMERA, x: cameraX });
  });
});
