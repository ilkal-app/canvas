import { bench, describe } from 'vitest';

import type { PathObject } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, zKeyAt } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { pathObject } from '../spatial/__fixtures__/spatial-objects.js';

import { meshJobRequestOf, runMeshJob } from './mesh-job.js';
import { INLINE_MESH_BUILDER } from './path-mesh-builder.js';
import { createPathPass } from './path-pass.js';

// CPU cost of path meshing and of the path pass through a fake backend (budgets:
// camera-only frames under 1 ms of CPU; path flattening and mesh building time-sliced). The
// GPU side is the golden scene path-fills (tooling/golden/scenes). The 50k board's paths (7% of
// its objects, the synthetic board's six-vertex pen paths) are drawn by the frame-time suite's
// zoom sweep (tooling/bench) through the real engine host.

const PATH_COUNT = 1000;
const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1600,
  viewportHeightPx: 1000,
  dpr: 2,
};

/**
 * The synthetic board's pen path (`@canvas/document`'s large board): six vertices joined by
 * five curved segments, stroked 2 wide.
 *
 * @param id - The object id.
 * @param index - Its place on a 40-wide grid.
 * @returns The path.
 */
function penPath(id: string, index: number): PathObject {
  const points = Array.from({ length: 6 }, (unused, vertex) => ({
    x: vertex * 20,
    y: (vertex % 2) * 15,
  }));
  return pathObject(
    id,
    points,
    {
      handles: [
        { x: 5, y: 5 },
        { x: -5, y: -5 },
      ],
    },
    { x: (index % 40) * 130, y: Math.floor(index / 40) * 40, z: zKeyAt(index) },
  );
}

/**
 * A curved path of many segments: a zigzag of `count` curved segments.
 *
 * @param count - Its segments.
 * @returns The path.
 */
function longPath(count: number): PathObject {
  const points = Array.from({ length: count + 1 }, (unused, vertex) => ({
    x: vertex * 10,
    y: (vertex % 2) * 25,
  }));
  return pathObject('long', points, {
    handles: [
      { x: 3, y: 8 },
      { x: -3, y: -8 },
    ],
  });
}

/**
 * A renderer with the path pass over 1k pen paths, drawn once.
 *
 * @param meshByteBudget - The mesh cache's cap.
 * @returns The backend and renderer.
 */
function loadedRenderer(meshByteBudget?: number): {
  backend: FakeGpuBackend;
  renderer: SceneRenderer;
} {
  const backend = new FakeGpuBackend();
  const pass = createPathPass({
    meshBuilder: INLINE_MESH_BUILDER,
    maxMeshSegmentsPerFrame: Number.POSITIVE_INFINITY,
    ...(meshByteBudget === undefined ? {} : { meshByteBudget }),
  });
  const renderer = new SceneRenderer(backend, { passes: [pass] });
  const document = new FakeSceneDocument();
  for (let index = 0; index < PATH_COUNT; index += 1) {
    document.create(penPath(`p${String(index)}`, index));
  }
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  backend.resetCalls();
  return { backend, renderer };
}

describe('path meshing', () => {
  const requests = Array.from({ length: PATH_COUNT }, (unused, index) =>
    meshJobRequestOf(penPath(`p${String(index)}`, index), 1, 2),
  );
  bench(`flatten and mesh ${String(PATH_COUNT)} six-vertex pen paths`, () => {
    for (const request of requests) runMeshJob(request);
  });

  // The same paths dashed, mitred and butt-capped: the dash splitter's and the
  // explicit joins' cost over the solid paths above.
  const styled = Array.from({ length: PATH_COUNT }, (unused, index) =>
    meshJobRequestOf(
      {
        ...penPath(`p${String(index)}`, index),
        strokeDash: { pattern: [6, 3] },
        strokeJoin: 'miter',
        strokeCap: 'butt',
      },
      1,
      2,
    ),
  );
  bench(`flatten and mesh ${String(PATH_COUNT)} dashed, mitred pen paths`, () => {
    for (const request of styled) runMeshJob(request);
  });

  const long = meshJobRequestOf(longPath(1000), 1, 2);
  bench('flatten and mesh one 1k-segment curved path', () => {
    runMeshJob(long);
  });
});

describe(`path pass frame, ${String(PATH_COUNT)} pen paths`, () => {
  const panning = loadedRenderer();
  let panTimeMs = 0;
  bench('camera-only frame (pan within the bucket; cached meshes, draws only)', () => {
    panTimeMs += 16;
    const camera = { ...CAMERA, x: panTimeMs % 500 };
    panning.renderer.renderFrame({ timeMs: panTimeMs, camera });
    panning.backend.resetCalls();
  });

  // A zero budget keeps only the frame's own meshes, so every frame rebuilds all of them.
  const zooming = loadedRenderer(0);
  let zoomTimeMs = 0;
  bench('bucket change (mesh and upload every path, unbudgeted)', () => {
    zoomTimeMs += 16;
    const zoom = zoomTimeMs % 32 === 0 ? 1 : 2;
    zooming.renderer.renderFrame({ timeMs: zoomTimeMs, camera: { ...CAMERA, zoom } });
    zooming.backend.resetCalls();
  });
});

// A vector-edit drag previews the path it moves (fix round 1): each pointer move hands
// the engine the whole path with one vertex moved, so the path pass re-meshes the whole path and
// uploads it, whatever moved. One frame of that for a 1k-segment curved path, meshing
// unbudgeted (a budgeted frame would spread it over several).
describe('vector-edit preview of one 1k-segment path', () => {
  const backend = new FakeGpuBackend();
  const pass = createPathPass({
    meshBuilder: INLINE_MESH_BUILDER,
    maxMeshSegmentsPerFrame: Number.POSITIVE_INFINITY,
  });
  const renderer = new SceneRenderer(backend, { passes: [pass] });
  const document = new FakeSceneDocument();
  const path = longPath(1000);
  document.create(path);
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  let frame = 0;
  bench('one preview move: the whole path re-meshed and uploaded in a frame', () => {
    frame += 1;
    const vertices = path.vertices.map((vertex, index) =>
      index === 500 ? { ...vertex, y: vertex.y + (frame % 2) * 10 } : vertex,
    );
    document.update(path.id, { vertices });
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: frame * 16, camera: CAMERA });
    backend.resetCalls();
  });
});
