import { bench } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

import { SceneSourceMirror } from './scene-source-mirror.js';

// Worker-side applyMove plus a rendered frame. Setup is outside the timed callback.
const COUNT = 10_000;
const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 1600, viewportHeightPx: 1000 };
const objects = Array.from({ length: COUNT }, (value, index) => {
  return shapeObject(`leaf-${String(index)}`, {
    x: (index % 100) * 20,
    y: Math.floor(index / 100) * 20,
  });
});
const ids = objects.map(({ id }) => id);
const mirror = new SceneSourceMirror(true);
const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [SDF_SHAPE_PASS] });
renderer.enqueue(
  mirror.apply({
    created: ids,
    updated: [],
    deleted: [],
    objects: Object.fromEntries(objects.map((object) => [object.id, object])),
  }),
);
renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
const base = new Float64Array(objects.flatMap(({ x, y }) => [x, y]));
const begin = mirror.applyMove({
  kind: 'begin',
  session: 1,
  sequence: 0,
  objects,
  positions: base,
});
if (!begin) throw new Error('Missing benchmark begin');
renderer.enqueueRetainedMove(begin, ids);
renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
let sequence = 0;

bench('retained update of 10k root leaves (worker applyMove plus frame)', () => {
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
