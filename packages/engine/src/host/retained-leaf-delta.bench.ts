import { bench } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

import type { RetainedMoveCommand } from './retained-move-command.js';
import { SceneSourceMirror } from './scene-source-mirror.js';

// Mirrors retained-leaf-update.bench.ts: same 10k leaves, camera, begin and timed frame.
const COUNT = 10_000;
const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 1600, viewportHeightPx: 1000 };
const objects = Array.from({ length: COUNT }, (value, index) =>
  shapeObject(`leaf-${String(index)}`, {
    x: (index % 100) * 20,
    y: Math.floor(index / 100) * 20,
  }),
);
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
const begin = mirror.applyMove({
  kind: 'begin',
  session: 1,
  sequence: 0,
  objects,
  positions: new Float64Array(objects.flatMap(({ x, y }) => [x, y])),
});
if (!begin) throw new Error('Missing benchmark begin');
renderer.enqueueRetainedMove(begin, ids);
renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
let sequence = 0;

bench('retained delta of 10k root leaves (worker applyMove plus frame)', () => {
  sequence += 1;
  const update = mirror.applyMove({
    kind: 'update',
    session: 1,
    sequence,
    delta: [sequence, sequence],
  } as unknown as RetainedMoveCommand);
  if (!update) throw new Error('Missing benchmark update');
  renderer.enqueueRetainedMove(update, ids);
  renderer.renderFrame({ camera: CAMERA, timeMs: sequence * 16 });
});
