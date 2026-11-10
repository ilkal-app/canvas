import { afterEach, expect, it, vi } from 'vitest';

import { SceneSourceMirror } from '../host/scene-source-mirror.js';
import { serializeChangeSet } from '../host/serializable-change-set.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject, zKeyAt } from './__fixtures__/scene-objects.js';
import type { DrawListEntry } from './draw-list.js';
import { SceneRenderer } from './scene-renderer.js';
import { ZOrderSegments } from './segments/z-order-segments.js';
import { worldTransformOf } from './world-transform.js';

const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 100, viewportHeightPx: 100 };
const bits = (values: readonly number[]) => [...new Uint32Array(new Float32Array(values).buffer)];

function renderFixture() {
  const backend = new FakeGpuBackend();
  const culler = new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 });
  const renderer = new SceneRenderer(backend, {
    culler,
    passes: [SDF_SHAPE_PASS],
    isZOrdered: false,
  });
  const segments = new ZOrderSegments({ spatial: culler.index });
  segments.install(renderer.frame);
  let drawList: readonly DrawListEntry[] = [];
  renderer.frame.insertStage('before', 'draw', {
    name: 'captureLeafOrder',
    run: (context) => {
      drawList = [...context.drawList];
    },
  });
  return {
    backend,
    culler,
    renderer,
    segments,
    frame: () => renderer.renderFrame({ camera: CAMERA, timeMs: 0 }),
    list: () => drawList,
  };
}

afterEach(() => vi.restoreAllMocks());

it('writes retained transform-table placements bit-for-bit like ordinary preparation', () => {
  const test = renderFixture();
  const mirror = new SceneSourceMirror(true);
  const document = new FakeSceneDocument();
  const objects = [
    shapeObject('a', { x: 10.123, y: 20.456, rotation: 0.371 }),
    shapeObject('b', { x: 50.789, y: 40.123, rotation: -0.27 }),
  ];
  document.create(...objects);
  test.renderer.enqueue(mirror.apply(serializeChangeSet(document.takeChanges())));
  test.frame();
  const ids = objects.map(({ id }) => id);
  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects,
    positions: new Float64Array([10.123, 20.456, 50.789, 40.123]),
  });
  if (!begin) throw new Error('Missing begin');
  test.renderer.enqueueRetainedMove(begin, ids);
  test.frame();
  const positions = new Float64Array([22.456789123, -16.77777777, 77.13579, 61.22222222]);
  const update = mirror.applyMove({ kind: 'update', session: 1, sequence: 1, positions });
  if (!update) throw new Error('Missing update');
  const writes = vi.spyOn(test.backend, 'writeTexture');
  test.renderer.enqueueRetainedMove(update, ids);
  test.frame();
  const tableWrite = writes.mock.calls.find(
    ([texture]) => (texture as { readonly label?: string }).label === 'move-transform-table',
  );
  expect(tableWrite).toBeDefined();
  const bytes = tableWrite?.[1];
  if (!bytes) throw new Error('Missing retained transform write');
  const actual = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  for (let index = 0; index < ids.length; index += 1) {
    const base = objects[index];
    const x = positions[index * 2];
    const y = positions[index * 2 + 1];
    if (!base || x === undefined || y === undefined) throw new Error('Missing position');
    const object = { ...base, x, y };
    const expected = new Float32Array(SDF_SHAPE_PASS.layout.floatsPerRecord);
    SDF_SHAPE_PASS.prepare(expected, { object, transform: worldTransformOf(object, document) }, 0);
    expect(bits([...actual.subarray(index * 4, index * 4 + 4)])).toEqual(
      bits([expected[0] ?? 0, expected[1] ?? 0, expected[11] ?? 0, expected[12] ?? 0]),
    );
  }
  test.renderer.destroy();
});

it('keeps draw order equal to a fresh segment plan through seeded overlaps and static edits', () => {
  const test = renderFixture();
  const mirror = new SceneSourceMirror(true);
  const document = new FakeSceneDocument();
  const objects = Array.from({ length: 12 }, (value, index) => {
    return shapeObject(`s${String(index)}`, {
      x: index * 7,
      y: (index % 3) * 7,
      z: zKeyAt(index),
    });
  });
  document.create(...objects);
  test.renderer.enqueue(mirror.apply(serializeChangeSet(document.takeChanges())));
  test.frame();
  const moving = objects.filter((object) => Number(object.id.slice(1)) % 3 === 0);
  const ids = moving.map(({ id }) => id);
  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: moving,
    positions: new Float64Array(moving.flatMap(({ x, y }) => [x, y])),
  });
  if (!begin) throw new Error('Missing begin');
  test.renderer.enqueueRetainedMove(begin, ids);
  test.frame();
  let counts = test.segments.counts;
  let seed = 0x527;
  let lastPositions = new Float64Array(moving.flatMap(({ x, y }) => [x, y]));
  for (let frame = 1; frame <= 100; frame += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed % 60;
    const y = (seed >>> 8) % 35;
    const positions = new Float64Array(
      moving.flatMap((object) => [x + ids.indexOf(object.id) * 3, y]),
    );
    lastPositions = positions;
    const update = mirror.applyMove({ kind: 'update', session: 1, sequence: frame, positions });
    if (!update) throw new Error(`Retained session ended before update frame ${String(frame)}`);
    test.renderer.enqueueRetainedMove(update, ids);
    test.frame();
    const fresh = renderFixture();
    const expected = new FakeSceneDocument();
    expected.create(
      ...objects.map((object) => {
        const index = ids.indexOf(object.id);
        return index < 0
          ? object
          : { ...object, x: positions[index * 2] ?? 0, y: positions[index * 2 + 1] ?? 0 };
      }),
    );
    fresh.renderer.enqueue(expected.takeChanges());
    fresh.frame();
    expect(test.list()).toEqual(fresh.list());
    expect(test.segments.counts).toEqual(counts);
    fresh.renderer.destroy();
    if (frame % 20 === 0) {
      const staticObject = objects[1];
      if (!staticObject) throw new Error('Missing static object');
      objects[1] = { ...staticObject, fill: [0, 0, 1, 1] };
      test.renderer.enqueue(
        mirror.apply({
          created: [],
          updated: [staticObject.id],
          deleted: [],
          objects: { [staticObject.id]: objects[1] },
        }),
      );
      test.frame();
      counts = test.segments.counts;
    }
  }
  const end = mirror.applyMove({ kind: 'end', session: 1, sequence: 101 });
  if (!end) throw new Error('Missing end');
  test.renderer.enqueue(end);
  test.frame();
  const final = new FakeSceneDocument();
  final.create(
    ...objects.map((object) => {
      const index = ids.indexOf(object.id);
      return index < 0
        ? object
        : { ...object, x: lastPositions[index * 2] ?? 0, y: lastPositions[index * 2 + 1] ?? 0 };
    }),
  );
  const fresh = renderFixture();
  fresh.renderer.enqueue(final.takeChanges());
  fresh.frame();
  expect(test.list()).toEqual(fresh.list());
  fresh.renderer.destroy();
  test.renderer.destroy();
});
