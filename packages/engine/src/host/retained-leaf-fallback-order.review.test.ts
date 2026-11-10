import { expect, it } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import { SceneSourceMirror } from './scene-source-mirror.js';
import { serializeChangeSet } from './serializable-change-set.js';

const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 100, viewportHeightPx: 100 };

it('keeps moving bounds current after an unowned retained update falls back', () => {
  const culler = new SpatialCuller({ paddingFraction: 0 });
  const renderer = new SceneRenderer(new FakeGpuBackend(), { culler, passes: [SDF_SHAPE_PASS] });
  const mirror = new SceneSourceMirror(true);
  const document = new FakeSceneDocument();
  const object = shapeObject('moving', { x: 10, y: 10 });
  document.create(object);
  renderer.enqueue(mirror.apply(serializeChangeSet(document.takeChanges())));
  const frame = () => renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
  frame();
  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: [object],
    positions: new Float64Array([10, 10]),
  });
  if (!begin) throw new Error('Missing begin');
  const ids = mirror.retainedMove?.ids;
  if (!ids) throw new Error('Missing membership');
  renderer.enqueueRetainedMove(begin, ids);
  frame();

  const owned = mirror.applyMove({
    kind: 'update',
    session: 1,
    sequence: 1,
    positions: new Float64Array([20, 10]),
  });
  if (!owned) throw new Error('Missing owned update');
  renderer.enqueueRetainedMove(owned, ids);
  frame();
  expect(culler.index.movingCount).toBe(1);

  // SharedArrayBuffer positions are valid, but cannot grant placement-only provenance.
  const shared = new Float64Array(new SharedArrayBuffer(16));
  shared.set([30, 10]);
  const fallback = mirror.applyMove({ kind: 'update', session: 1, sequence: 2, positions: shared });
  if (!fallback) throw new Error('Missing fallback update');
  renderer.enqueueRetainedMove(fallback, ids);
  frame();

  const resumed = mirror.applyMove({
    kind: 'update',
    session: 1,
    sequence: 3,
    positions: new Float64Array([150, 10]),
  });
  if (!resumed) throw new Error('Missing resumed update');
  renderer.enqueueRetainedMove(resumed, ids);
  frame();
  expect(culler.index.boundsOf(object.id)?.minX).toBe(150);
  expect(culler.index.searchPoint({ x: 155, y: 15 })).toContain(object.id);
  renderer.destroy();
});
