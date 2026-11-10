import { expect, it, vi } from 'vitest';

import { DRAWABLE_EXTENT } from '@canvas/schema';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { Scene } from '../scene/scene.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import { SceneSourceMirror } from './scene-source-mirror.js';
import { serializeChangeSet } from './serializable-change-set.js';

const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 100, viewportHeightPx: 100 };

it('does not bypass the drawable gate when a boxless descendant origin leaves the extent', () => {
  const root = frameObject('root', { x: 0, y: 0 });
  const group = groupObject('group', { parentId: root.id, x: DRAWABLE_EXTENT - 10, y: 0 });
  const child = shapeObject('child', { parentId: group.id, x: -DRAWABLE_EXTENT + 20, y: 0 });
  const document = new FakeSceneDocument();
  document.create(root, group, child);
  const mirror = new SceneSourceMirror(true);
  const renderer = new SceneRenderer(new FakeGpuBackend(), { culler: new SpatialCuller() });
  const frame = () => renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
  renderer.enqueue(mirror.apply(serializeChangeSet(document.takeChanges())));
  frame();
  expect(renderer.takeUndrawable().count).toBe(0);

  const freshDocument = new FakeSceneDocument();
  freshDocument.create({ ...root, x: 20 }, group, child);
  const fresh = new SceneRenderer(new FakeGpuBackend(), { culler: new SpatialCuller() });
  fresh.enqueue(freshDocument.takeChanges());
  fresh.renderFrame({ camera: CAMERA, timeMs: 0 });
  expect(fresh.takeUndrawable().objects).toContainEqual({ id: group.id, reason: 'past-extent' });
  fresh.destroy();

  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: [root],
    positions: new Float64Array([0, 0]),
  });
  if (!begin) throw new Error('Expected begin');
  renderer.enqueueRetainedMove(begin, [root.id]);
  frame();
  const apply = vi.spyOn(Scene.prototype, 'apply');
  const update = mirror.applyMove({
    kind: 'update',
    session: 1,
    sequence: 1,
    positions: new Float64Array([20, 0]),
  });
  if (!update) throw new Error('Expected update');
  renderer.enqueueRetainedMove(update, [root.id]);
  frame();

  expect(apply).toHaveBeenCalled();
  expect(renderer.takeUndrawable().objects).toContainEqual({ id: group.id, reason: 'past-extent' });
  renderer.destroy();
  vi.restoreAllMocks();
});
