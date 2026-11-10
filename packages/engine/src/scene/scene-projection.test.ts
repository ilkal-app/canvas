import { expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { AllVisibleCuller } from './scene-culler.js';
import { SceneRenderer } from './scene-renderer.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
const BOUNDS = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

it('refuses a stale projection until queued scene changes reach a frame', () => {
  const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [FILLED_RECT_PASS] });
  const document = new FakeSceneDocument();
  const inside = shapeObject('inside', { x: 20 });
  document.create(inside);
  document.create(shapeObject('outside', { x: 500 }));
  renderer.enqueue(document.takeChanges());
  expect(renderer.projectionCandidates(BOUNDS)).toBeUndefined();
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(renderer.projectionCandidates(BOUNDS)).toEqual([inside.id]);
});

it('includes overflow drawing bounds without changing the active visible query', () => {
  const culler = new SpatialCuller();
  const renderer = new SceneRenderer(new FakeGpuBackend(), { culler, passes: [FILLED_RECT_PASS] });
  const document = new FakeSceneDocument();
  const outside = shapeObject('overflow', { x: 500 });
  document.create(outside);
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  culler.setDrawingBounds(outside.id, BOUNDS);
  const visible = culler.visibleIdsFor(BOUNDS);
  expect(renderer.projectionCandidates(BOUNDS)).toEqual([outside.id]);
  renderer.projectionCandidates({ minX: 1000, minY: 1000, maxX: 1100, maxY: 1100 });
  expect(culler.visibleIdsFor(BOUNDS)).toBe(visible);
});

it('does not claim a projection for a custom non-spatial culler', () => {
  const renderer = new SceneRenderer(new FakeGpuBackend(), { culler: new AllVisibleCuller() });
  expect(renderer.projectionCandidates(BOUNDS)).toBeUndefined();
});
