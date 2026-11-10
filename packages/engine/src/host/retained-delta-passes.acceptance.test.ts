import { expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { imageObject } from '../images/__fixtures__/image-objects.js';
import { IMAGE_PASS } from '../images/image-pass.js';
import { SharedImageResidency } from '../images/shared-image-residency.js';
import { squarePath, zigzagPath } from '../paths/__fixtures__/path-scene.js';
import { INLINE_MESH_BUILDER } from '../paths/path-mesh-builder.js';
import { createPathPass } from '../paths/path-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import type { SceneRenderer } from '../scene/scene-renderer.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { SceneSpatialIndex } from '../spatial/scene-spatial-index.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';
import { CAMERA, createTextSetUp, textObject } from '../text/scene/__fixtures__/text-objects.js';
import { FRAME_TITLE_PASS } from '../text/scene/frame-title-pass.js';
import { TEXT_PASS } from '../text/scene/text-pass.js';

import type { RetainedMoveCommand } from './retained-move-command.js';
import { SceneSourceMirror } from './scene-source-mirror.js';
import { serializeChangeSet } from './serializable-change-set.js';

const OBJECTS: readonly BoardObject[] = [
  frameObject('frame', { x: 10, y: 10, width: 30, height: 20 }),
  shapeObject('shape', { x: 50, y: 10 }),
  imageObject({ id: 'image' as ObjectId, x: 80, y: 10, width: 40, height: 30 }),
  textObject('text', 'Delta', { x: 130, y: 10 }),
  squarePath('fill', 0, { x: 200, y: 10 }),
  zigzagPath('stroke-a', 1, { x: 240, y: 10 }),
  zigzagPath('stroke-b', 2, { x: 290, y: 10 }),
];
const PASS_MEMBERS: readonly [string, ObjectId][] = [
  ['solid-rect', 'frame' as ObjectId],
  ['sdf-shape', 'shape' as ObjectId],
  ['image', 'image' as ObjectId],
  ['text', 'text' as ObjectId],
  ['path', 'fill' as ObjectId],
  ['path', 'stroke-a' as ObjectId],
  ['path', 'stroke-b' as ObjectId],
];

async function fixture() {
  const culler = new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 });
  const setup = createTextSetUp(CAMERA, true, false, {
    culler,
    passes: [
      SOLID_RECT_PASS,
      SDF_SHAPE_PASS,
      IMAGE_PASS,
      TEXT_PASS,
      FRAME_TITLE_PASS,
      createPathPass({ meshBuilder: INLINE_MESH_BUILDER, isBatched: true }),
    ],
  });
  const mirror = new SceneSourceMirror(true);
  const document = new FakeSceneDocument();
  document.create(...OBJECTS);
  setup.renderer.enqueue(mirror.apply(serializeChangeSet(document.takeChanges())));
  await setup.settle();
  for (const [pass, id] of PASS_MEMBERS) {
    expect(setup.renderer.scene.slotsOf(id, pass), `${pass}/${id}`).not.toHaveLength(0);
  }
  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: OBJECTS,
    positions: new Float64Array(OBJECTS.flatMap(({ x, y }) => [x, y])),
  });
  if (!begin) throw new Error('Missing retained begin');
  setup.renderer.enqueueRetainedMove(
    begin,
    OBJECTS.map(({ id }) => id),
  );
  setup.renderer.renderFrame({ camera: CAMERA, timeMs: 100 });
  const update = (command: RetainedMoveCommand) => {
    const changes = mirror.applyMove(command);
    if (!changes) throw new Error('Retained command rejected');
    if (command.kind === 'end') setup.renderer.enqueue(changes);
    else
      setup.renderer.enqueueRetainedMove(
        changes,
        OBJECTS.map(({ id }) => id),
      );
    setup.renderer.renderFrame({ camera: CAMERA, timeMs: 116 });
  };
  return { ...setup, culler, mirror, update };
}

function placementOf(renderer: SceneRenderer, id: ObjectId) {
  // The one test-facing accessor, shared with the core acceptance cases.
  return (
    renderer as SceneRenderer & {
      retainedPlacementOf(
        id: ObjectId,
      ): { x: number; y: number; cos: number; sin: number } | undefined;
    }
  ).retainedPlacementOf(id);
}

it('matches every move pass including batched strokes, then restores text bounds and records', async () => {
  const fast = await fixture();
  const reference = await fixture();
  const images = vi.spyOn(SharedImageResidency.prototype, 'track');
  const textBounds = vi.spyOn(SceneSpatialIndex.prototype, 'setDrawingBounds');
  let fastStream: unknown;
  let referenceStream: unknown;
  fast.renderer.frame.insertStage('before', 'draw', {
    name: 'deltaPassDraw',
    run: ({ drawList }) => {
      fastStream = drawList.map(({ passName, ranges }) => ({ passName, ranges }));
    },
  });
  reference.renderer.frame.insertStage('before', 'draw', {
    name: 'positionsPassDraw',
    run: ({ drawList }) => {
      referenceStream = drawList.map(({ passName, ranges }) => ({ passName, ranges }));
    },
  });
  fast.update({
    kind: 'update',
    session: 1,
    sequence: 1,
    delta: [-5, 12],
  } as unknown as RetainedMoveCommand);
  // Image residency keeps its own world bounds, so it follows the translation each frame; text bounds ride in the culler's moving boxes until the end.
  const trackedOf = () =>
    images.mock.calls.find(([, target]) => target.object.id === ('image' as ObjectId))?.[1];
  const fastTracked = trackedOf();
  expect(fastTracked).toBeDefined();
  expect(textBounds).not.toHaveBeenCalled();
  images.mockClear();
  reference.update({
    kind: 'update',
    session: 1,
    sequence: 1,
    positions: new Float64Array(OBJECTS.flatMap(({ x, y }) => [x - 5, y + 12])),
  });
  expect(fastTracked?.transform).toEqual(trackedOf()?.transform);
  images.mockClear();
  expect(fastStream).toEqual(referenceStream);
  for (const [, id] of PASS_MEMBERS)
    expect(placementOf(fast.renderer, id)).toEqual(placementOf(reference.renderer, id));
  expect(fast.culler.visibleIdsFor({ minX: 0, minY: 0, maxX: 400, maxY: 300 })).toEqual(
    reference.culler.visibleIdsFor({ minX: 0, minY: 0, maxX: 400, maxY: 300 }),
  );
  fast.update({ kind: 'end', session: 1, sequence: 2 });
  const fastImage = images.mock.calls.find(
    ([, target]) => target.object.id === ('image' as ObjectId),
  );
  expect(fastImage).toBeDefined();
  // Drawing bounds are published by frame titles (the only text kind with them), so the frame's
  // title bounds are what the end must restore.
  expect(textBounds.mock.calls.some(([id]) => id === ('frame' as ObjectId))).toBe(true);
  images.mockClear();
  reference.update({ kind: 'end', session: 1, sequence: 2 });
  const referenceImage = images.mock.calls.find(
    ([, target]) => target.object.id === ('image' as ObjectId),
  );
  expect(fastImage?.[1]).toEqual(referenceImage?.[1]);
  for (const object of OBJECTS) {
    expect(fast.culler.index.boundsOf(object.id)).toEqual(
      reference.culler.index.boundsOf(object.id),
    );
    expect(fast.mirror.get(object.id)).toEqual(reference.mirror.get(object.id));
  }
  expect(fast.renderer.scene.instanceBufferOf('text').data).toEqual(
    reference.renderer.scene.instanceBufferOf('text').data,
  );
  fast.renderer.destroy();
  reference.renderer.destroy();
  vi.restoreAllMocks();
});
