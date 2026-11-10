import { expect, it } from 'vitest';

import type { WorldBounds } from '../camera/camera.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { NO_FRAME_TIMERS, type FrameContext } from '../scene/frame-context.js';
import { Frame } from '../scene/frame.js';
import { SceneChangeQueue } from '../scene/scene-change-queue.js';
import { Scene } from '../scene/scene.js';

import { SpatialCuller } from './spatial-culler.js';

const view = (x: number): WorldBounds => ({ minX: x, maxX: x + 200, minY: -5, maxY: 20 });

it('admits one batch per installed frame, carrying what a moved view finds later in it', () => {
  const document = new FakeSceneDocument();
  for (let index = 0; index < 40; index += 1)
    document.create(shapeObject(`s${String(index)}`, { x: index * 20, width: 10 }));
  const scene = new Scene([FILLED_RECT_PASS]);
  const culler = new SpatialCuller({ entriesPerFrame: 3, paddingFraction: 0 });
  const frame = new Frame([{ name: 'collectChanges', run: () => undefined }]);
  culler.install(frame);
  const changes = document.takeChanges();
  scene.apply(changes);
  culler.applyChanges(changes);
  const run = (): void => {
    frame.run({ changes: new SceneChangeQueue(), scene, timers: NO_FRAME_TIMERS } as FrameContext);
  };
  run();
  const first = culler.visibilityFor(view(0));
  expect(first.entered).toHaveLength(3);
  // The view moves within the same frame: its changes are found and carried, none admitted.
  const moved = culler.visibilityFor(view(400));
  expect(moved.revision).toBe(first.revision);
  expect([...moved.members].sort()).toEqual([...first.members].sort());
  expect(culler.hasPendingAdmissions()).toBe(true);
  run();
  const next = culler.visibilityFor(view(400));
  expect(next.revision).toBe(first.revision + 1);
  expect(next.entered.length + next.left.length).toBe(3);
});
