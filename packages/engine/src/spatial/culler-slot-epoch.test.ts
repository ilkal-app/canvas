import { afterEach, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import type { ScenePass } from '../scene/scene-pass.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { SpatialCuller } from './spatial-culler.js';
import { visibleRanges } from './visible-ranges.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
const VIEW = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const renderers: SceneRenderer[] = [];
afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.destroy();
  vi.restoreAllMocks();
});

function fixture(pass: ScenePass = FILLED_RECT_PASS) {
  const culler = new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 });
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    culler,
    passes: [pass],
    isZOrdered: false,
  });
  renderers.push(renderer);
  const document = new FakeSceneDocument();
  const frame = (camera = CAMERA) => {
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera });
  };
  document.create(
    shapeObject('a'),
    shapeObject('b', { x: 20 }),
    shapeObject('outside', { x: 1000 }),
  );
  frame();
  const verify = () => {
    const ids = culler.visibleIdsFor(VIEW);
    expect(culler.cull(renderer.scene, VIEW)).toEqual(visibleRanges(renderer.scene, ids, false, 0));
  };
  return { culler, renderer, document, frame, verify };
}

it('skips the slot walk after an installed stage changes only record content', () => {
  const { renderer, document, frame, verify } = fixture();
  document.update('a', { x: 15 });
  const revisions = vi.spyOn(renderer.scene, 'slotRevisionOf');
  frame();
  expect(revisions).not.toHaveBeenCalled();
  verify();
});

it('still updates exact membership when stable slots cross the viewport', () => {
  const { renderer, document, frame, culler, verify } = fixture();
  const epoch = renderer.scene.slotOwnershipRevision;
  document.update('a', { x: 500 });
  document.update('outside', { x: 40 });
  frame();
  expect(renderer.scene.slotOwnershipRevision).toBe(epoch);
  expect(culler.visibleIdsFor(VIEW)).toEqual(expect.arrayContaining(['b', 'outside']));
  expect(culler.visibleIdsFor(VIEW)).not.toContain('a');
  verify();
});

it('invalidates ownership when a custom position-dependent pass changes record counts', () => {
  const { renderer, document, frame, verify } = fixture({
    ...FILLED_RECT_PASS,
    recordCount: (object) => (object.x < 10 ? 1 : 2),
  });
  const epoch = renderer.scene.slotOwnershipRevision;
  document.update('a', { x: 15 });
  frame();
  expect(renderer.scene.slotOwnershipRevision).toBeGreaterThan(epoch);
  verify();
});

it.each(['zero', 'delete'] as const)(
  'advances ownership when slots disappear through %s',
  (kind) => {
    const { renderer, document, frame, verify } = fixture();
    const epoch = renderer.scene.slotOwnershipRevision;
    if (kind === 'zero') document.update('a', { fill: null });
    else document.delete('a');
    frame();
    expect(renderer.scene.slotOwnershipRevision).toBeGreaterThan(epoch);
    verify();
    if (kind === 'zero') document.update('a', { fill: [1, 0, 0, 1] });
    else document.create(shapeObject('a'));
    frame();
    verify();
  },
);

it('keeps direct callers conservative when Scene changed outside the installed stage', () => {
  const { renderer, document, culler, verify } = fixture();
  document.update('a', { fill: null });
  const changes = document.takeChanges();
  renderer.scene.apply(changes);
  culler.applyChanges(changes);
  verify();
});

it('tracks LOD hide/reveal without slot ownership changes', () => {
  const { renderer, frame, verify } = fixture({
    ...FILLED_RECT_PASS,
    levelOfDetail: {
      rule: { kind: 'test', levels: [{ belowPx: 3, form: 'hidden' }], hysteresis: 0.2 },
      sizeOf: () => 10,
    },
  });
  const epoch = renderer.scene.slotOwnershipRevision;
  frame({ ...CAMERA, zoom: 0.1 });
  expect(renderer.scene.levelOfDetail.hiddenIn(FILLED_RECT_PASS.name).size).toBeGreaterThan(0);
  verify();
  frame();
  expect(renderer.scene.levelOfDetail.hiddenIn(FILLED_RECT_PASS.name).has('a' as ObjectId)).toBe(
    false,
  );
  expect(renderer.scene.slotOwnershipRevision).toBe(epoch);
  verify();
});

it('updates visibility from arrived drawing bounds without changing slots', () => {
  const { renderer, culler, verify } = fixture();
  const epoch = renderer.scene.slotOwnershipRevision;
  culler.setDrawingBounds('outside' as ObjectId, { minX: 40, minY: 0, maxX: 60, maxY: 10 });
  expect(culler.visibleIdsFor(VIEW)).toContain('outside');
  expect(renderer.scene.slotOwnershipRevision).toBe(epoch);
  verify();
});
