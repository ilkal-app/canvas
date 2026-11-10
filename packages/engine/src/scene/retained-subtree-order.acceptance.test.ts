import { expect, it } from 'vitest';

import { SceneSourceMirror } from '../host/scene-source-mirror.js';
import { serializeChangeSet } from '../host/serializable-change-set.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
  zKeyAt,
} from './__fixtures__/scene-objects.js';
import type { DrawListEntry } from './draw-list.js';
import { SceneRenderer } from './scene-renderer.js';
import { ZOrderSegments } from './segments/z-order-segments.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 120, viewportHeightPx: 120 };

function setup() {
  const culler = new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 });
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    culler,
    passes: [SOLID_RECT_PASS, SDF_SHAPE_PASS],
    isZOrdered: false,
  });
  const segments = new ZOrderSegments({ spatial: culler.index });
  segments.install(renderer.frame);
  let drawn: readonly DrawListEntry[] = [];
  renderer.frame.insertStage('before', 'draw', {
    name: 'captureSubtreeOrder',
    run: ({ drawList }) => {
      drawn = [...drawList];
    },
  });
  return {
    renderer,
    frame: () => renderer.renderFrame({ camera: CAMERA, timeMs: 0 }),
    list: () => drawn,
  };
}

it('matches a fresh segment plan on every frame of a seeded overlapping subtree drag', () => {
  const test = setup();
  const mirror = new SceneSourceMirror(true);
  const document = new FakeSceneDocument();
  const roots = Array.from({ length: 4 }, (value, index) =>
    frameObject(`frame-${String(index)}`, {
      x: index * 20,
      y: index * 9,
      width: 50,
      height: 50,
      z: zKeyAt(index * 2),
    }),
  );
  const children = roots.flatMap((root, index) => [
    shapeObject(`child-a-${String(index)}`, { parentId: root.id, x: 2, y: 2, z: zKeyAt(0) }),
    shapeObject(`child-b-${String(index)}`, { parentId: root.id, x: 7, y: 7, z: zKeyAt(1) }),
  ]);
  const staticObjects = Array.from({ length: 4 }, (value, index) =>
    shapeObject(`static-${String(index)}`, {
      x: 25 + index * 10,
      y: 20,
      width: 50,
      height: 50,
      z: zKeyAt(index * 2 + 1),
    }),
  );
  document.create(...roots, ...children, ...staticObjects);
  test.renderer.enqueue(mirror.apply(serializeChangeSet(document.takeChanges())));
  test.frame();
  const ids = roots.map(({ id }) => id);
  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: roots,
    positions: new Float64Array(roots.flatMap(({ x, y }) => [x, y])),
  });
  if (!begin) throw new Error('Missing begin');
  test.renderer.enqueueRetainedMove(begin, ids);
  test.frame();
  let seed = 0x527;
  for (let frame = 1; frame <= 40; frame += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed % 75;
    const y = (seed >>> 8) % 50;
    const positions = new Float64Array(
      roots.flatMap((root, index) => [x + index * 3, y + index * 2]),
    );
    const update = mirror.applyMove({ kind: 'update', session: 1, sequence: frame, positions });
    if (!update) throw new Error('Missing update');
    test.renderer.enqueueRetainedMove(update, ids);
    test.frame();
    const fresh = setup();
    const moved = new FakeSceneDocument();
    moved.create(
      ...roots.map((root, index) => ({
        ...root,
        x: positions[index * 2] ?? 0,
        y: positions[index * 2 + 1] ?? 0,
      })),
      ...children,
      ...staticObjects,
    );
    fresh.renderer.enqueue(moved.takeChanges());
    fresh.frame();
    expect(test.list()).toEqual(fresh.list());
    fresh.renderer.destroy();
  }
  test.renderer.destroy();
});
