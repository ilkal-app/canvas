import { bench } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { frameObject, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import { SceneSourceMirror } from './scene-source-mirror.js';

// Worker applyMove plus a frame. Setup and the 10k-object first paint are outside timing.
const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 1600, viewportHeightPx: 1000 };
const roots = Array.from({ length: 100 }, (value, index) =>
  frameObject(`frame-${String(index)}`, {
    x: (index % 10) * 200,
    y: Math.floor(index / 10) * 150,
  }),
);
const children = roots.flatMap((root, frameIndex) =>
  Array.from({ length: 99 }, (value, childIndex) =>
    shapeObject(`child-${String(frameIndex)}-${String(childIndex)}`, {
      parentId: root.id,
      x: (childIndex % 10) * 9,
      y: Math.floor(childIndex / 10) * 9,
    }),
  ),
);
const objects = [...roots, ...children];
const ids = roots.map(({ id }) => id);
const mirror = new SceneSourceMirror(true);
const renderer = new SceneRenderer(new FakeGpuBackend(), {
  culler: new SpatialCuller(),
  passes: [SOLID_RECT_PASS, SDF_SHAPE_PASS],
});
renderer.enqueue(
  mirror.apply({
    created: objects.map(({ id }) => id),
    updated: [],
    deleted: [],
    objects: Object.fromEntries(objects.map((object) => [object.id, object])),
  }),
);
renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
const base = new Float64Array(roots.flatMap(({ x, y }) => [x, y]));
const begin = mirror.applyMove({
  kind: 'begin',
  session: 1,
  sequence: 0,
  objects: roots,
  positions: base,
});
if (!begin) throw new Error('Missing benchmark begin');
renderer.enqueueRetainedMove(begin, ids);
renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
let sequence = 0;

bench('retained update of 100 frames × 99 children (worker applyMove plus frame)', () => {
  sequence += 1;
  const positions = new Float64Array(base);
  for (let index = 0; index < positions.length; index += 2) {
    positions[index] = (base[index] ?? 0) + sequence;
    positions[index + 1] = (base[index + 1] ?? 0) + sequence;
  }
  const update = mirror.applyMove({ kind: 'update', session: 1, sequence, positions });
  if (!update) throw new Error('Missing benchmark update');
  renderer.enqueueRetainedMove(update, ids);
  renderer.renderFrame({ camera: CAMERA, timeMs: sequence * 16 });
});
