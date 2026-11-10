import { afterEach, expect, it, vi } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { ConnectorLinks } from '../connectors/connector-links.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import { imageObject } from '../images/__fixtures__/image-objects.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { Scene } from '../scene/scene.js';
import { stickyObject } from '../scene/segments/__fixtures__/note-and-text-passes.js';
import { ZOrderMirror } from '../scene/segments/z-order-mirror.js';
import { worldTransformOf } from '../scene/world-transform.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';
import { hitPoint } from '../spatial/hit-point.js';
import { SceneSpatialIndex } from '../spatial/scene-spatial-index.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';
import { textObject } from '../text/scene/__fixtures__/text-objects.js';

import { RetainedMoveMirror } from './retained-move-mirror.js';
import { SceneSourceMirror } from './scene-source-mirror.js';
import { serializeChangeSet } from './serializable-change-set.js';

const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 100, viewportHeightPx: 100 };
const bits = (values: readonly number[]) => [...new Uint32Array(new Float32Array(values).buffer)];

function setup(objects: readonly BoardObject[], roots: readonly BoardObject[]) {
  const backend = new FakeGpuBackend();
  const gpu: GpuBackend = backend;
  const textureWrites = vi.spyOn(gpu, 'writeTexture');
  const bufferWrites = vi.spyOn(backend, 'writeBuffer');
  const culler = new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 });
  const renderer = new SceneRenderer(backend, { culler, passes: [SDF_SHAPE_PASS] });
  const document = new FakeSceneDocument();
  const mirror = new SceneSourceMirror(true);
  document.create(...objects);
  renderer.enqueue(mirror.apply(serializeChangeSet(document.takeChanges())));
  const frame = () => renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
  frame();
  const ids = roots.map(({ id }) => id);
  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: roots,
    positions: new Float64Array(roots.flatMap(({ x, y }) => [x, y])),
  });
  if (!begin) throw new Error('Expected begin');
  renderer.enqueueRetainedMove(begin, ids);
  frame();
  const update = (sequence: number, positions: readonly number[]) => {
    const change = mirror.applyMove({
      kind: 'update',
      session: 1,
      sequence,
      positions: new Float64Array(positions),
    });
    if (!change) throw new Error('Expected update');
    renderer.enqueueRetainedMove(change, ids);
    frame();
  };
  const end = (sequence: number) => {
    const change = mirror.applyMove({ kind: 'end', session: 1, sequence });
    if (!change) throw new Error('Expected end');
    renderer.enqueue(change);
    frame();
  };
  return {
    backend,
    bufferWrites,
    textureWrites,
    culler,
    renderer,
    document,
    mirror,
    frame,
    update,
    end,
  };
}

afterEach(() => vi.restoreAllMocks());

it('places a frame and nested group without change-set hooks and moves every descendant spatially', () => {
  const root = frameObject('frame', { x: 150, y: 10 });
  const nested = groupObject('group', { parentId: 'frame', x: 5, y: 5 });
  const child = shapeObject('child', { parentId: 'group', x: 5, y: 5 });
  const test = setup([root, nested, child], [root]);
  const hooks = [
    vi.spyOn(Scene.prototype, 'apply'),
    vi.spyOn(ZOrderMirror.prototype, 'observe'),
    vi.spyOn(ConnectorLinks.prototype, 'observe'),
    vi.spyOn(SceneSpatialIndex.prototype, 'applyInto'),
    vi.spyOn(RetainedMoveMirror.prototype, 'get'),
  ];
  const before = hooks.map((hook) => hook.mock.calls.length);
  test.update(1, [10, 10]);
  expect(hooks.map((hook) => hook.mock.calls.length)).toEqual(before);
  expect(test.culler.index.searchPoint({ x: 22, y: 22 })).toContain(child.id);
  expect(hitPoint(test.culler.index, test.mirror, { x: 22, y: 22 }, { zoom: 1 })).toContain(
    child.id,
  );
  expect(test.culler.index.searchPoint({ x: 162, y: 22 })).not.toContain(child.id);
  test.end(2);
  const fresh = new SceneSpatialIndex();
  fresh.apply(test.mirror.everything());
  expect(test.culler.index.validate()).toEqual([]);
  expect(test.culler.index.boundsOf(child.id)).toEqual(fresh.boundsOf(child.id));
  expect(test.culler.index.searchRect({ minX: 0, minY: 0, maxX: 200, maxY: 100 })).toEqual(
    fresh.searchRect({ minX: 0, minY: 0, maxX: 200, maxY: 100 }),
  );
  test.renderer.destroy();
});

it("writes a rotated group's descendant placement bit-for-bit like full preparation", () => {
  const root = groupObject('root', { x: 10.123, y: 20.456, rotation: 0.371 });
  const frame = frameObject('frame', { parentId: 'root', x: 4.5, y: 6.25 });
  const nested = groupObject('nested', { parentId: 'frame', x: 7.25, y: -3.5, rotation: -0.27 });
  const child = shapeObject('child', { parentId: 'nested', x: 2.75, y: 9.125 });
  const note = stickyObject('note', { parentId: frame.id, x: 10.5, y: 20.25 });
  const shadowed = shapeObject('shadowed', {
    parentId: 'frame',
    x: 30.125,
    y: 11.5,
    shadow: { x: 2, y: 3, blur: 4, spread: 0, color: [0, 0, 0, 0.3] },
  });
  const test = setup([root, frame, nested, child, note, shadowed], [root]);
  test.update(1, [33.333333333, -16.77777777]);
  const texture = test.backend.textures.find(
    (candidate) => candidate.label === 'move-transform-table',
  );
  expect(texture).toBeDefined();
  if (!texture) throw new Error('Missing transform table');
  const table = new Float32Array(texture.width * texture.height * 4);
  for (const [candidate, bytes, region] of test.textureWrites.mock.calls) {
    if (candidate !== texture) continue;
    const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const area = region as { readonly x?: number; readonly y?: number } | undefined;
    table.set(values, ((area?.y ?? 0) * texture.width + (area?.x ?? 0)) * 4);
  }
  const indexWrite = test.bufferWrites.mock.calls.find(([buffer]) =>
    test.backend.buffers.some(
      (candidate) => candidate === buffer && candidate.label === 'sdf-shape move indices',
    ),
  );
  expect(indexWrite).toBeDefined();
  const indices = indexWrite?.[2] as Float32Array | undefined;
  if (!indices) throw new Error('Missing move indices');
  const moved = new FakeSceneDocument();
  moved.create({ ...root, x: 33.333333333, y: -16.77777777 }, frame, nested, child, note, shadowed);
  for (const object of [child, note, shadowed]) {
    test.renderer.scene.slotsOf(object.id, SDF_SHAPE_PASS.name).forEach((slot, recordIndex) => {
      const expected = new Float32Array(SDF_SHAPE_PASS.layout.floatsPerRecord);
      SDF_SHAPE_PASS.prepare(
        expected,
        { object, transform: worldTransformOf(object, moved) },
        recordIndex,
      );
      const offset = (indices[slot] ?? 0) * 4;
      expect(bits([...table.subarray(offset, offset + 4)])).toEqual(
        bits([expected[0] ?? 0, expected[1] ?? 0, expected[11] ?? 0, expected[12] ?? 0]),
      );
    });
  }
  test.renderer.destroy();
});

it.each([
  ['clipping root', (root: ReturnType<typeof frameObject>) => ({ ...root, clip: true })],
  ['clipping descendant', (root: ReturnType<typeof frameObject>) => ({ ...root, clip: false })],
])('keeps a %s on ordinary change sets', (name, editRoot) => {
  const root = editRoot(frameObject('frame', { x: 10 }));
  const child = frameObject('child', {
    parentId: 'frame',
    x: 5,
    clip: name === 'clipping descendant',
  });
  const test = setup([root, child], [root]);
  const apply = vi.spyOn(Scene.prototype, 'apply');
  test.update(1, [20, 10]);
  expect(apply).toHaveBeenCalled();
  test.renderer.destroy();
});

it.each([
  [
    'external connector',
    () => {
      const root = frameObject('frame', { x: 10 });
      const inside = shapeObject('inside', { parentId: 'frame', x: 5 });
      const outside = shapeObject('outside', { x: 150 });
      const connector = {
        ...connectorObject('link'),
        from: { kind: 'object' as const, objectId: inside.id, anchor: null },
        to: { kind: 'object' as const, objectId: outside.id, anchor: null },
      };
      return { objects: [root, inside, outside, connector], root };
    },
  ],
  [
    'component instance',
    () => {
      const root = frameObject('frame', { x: 10 });
      const instance = {
        ...groupObject('instance', { parentId: 'frame', x: 5 }),
        type: 'instance' as const,
        mainId: groupObject('main').id,
        overrides: {},
        width: 20,
        height: 20,
      };
      return { objects: [root, instance], root };
    },
  ],
  [
    'translucent layer',
    () => {
      const root = frameObject('frame', { x: 10 });
      const layer = groupObject('layer', { parentId: 'frame', x: 5, opacity: 0.5 });
      const child = shapeObject('child', { parentId: 'layer', x: 3 });
      return { objects: [root, layer, child], root };
    },
  ],
])('keeps a subtree with %s on the ordinary update path', (name, build) => {
  const { objects, root } = build();
  const test = setup(objects, [root]);
  const apply = vi.spyOn(Scene.prototype, 'apply');
  test.update(1, [20, 10]);
  expect(apply, name).toHaveBeenCalled();
  const fresh = new SceneRenderer(new FakeGpuBackend(), { passes: [SDF_SHAPE_PASS] });
  const document = new FakeSceneDocument();
  document.create(
    ...objects.map((object) => (object.id === root.id ? { ...root, x: 20, y: 10 } : object)),
  );
  fresh.enqueue(document.takeChanges());
  fresh.renderFrame({ camera: CAMERA, timeMs: 0 });
  expect(test.renderer.scene.instanceBufferOf(SDF_SHAPE_PASS.name).data).toEqual(
    fresh.scene.instanceBufferOf(SDF_SHAPE_PASS.name).data,
  );
  fresh.destroy();
  test.renderer.destroy();
});

it('retains a mixed-content subtree with an internal sibling connector', () => {
  const root = frameObject('frame', { x: 160, y: 10 });
  const group = groupObject('group', { parentId: 'frame', x: 5, y: 5 });
  const first = shapeObject('first', {
    parentId: 'group',
    x: 5,
    y: 5,
    shadow: { x: 2, y: 3, blur: 4, spread: 0, color: [0, 0, 0, 0.3] },
  });
  const second = shapeObject('second', { parentId: 'group', x: 35, y: 5 });
  const note = stickyObject('note', { parentId: root.id, x: 10, y: 50 });
  const text = textObject('text', 'Hello', { parentId: 'frame', x: 40, y: 50 });
  const image = imageObject({ parentId: root.id, x: 60, y: 50 });
  const connector = {
    ...connectorObject('link'),
    parentId: group.id,
    from: { kind: 'object' as const, objectId: first.id, anchor: null },
    to: { kind: 'object' as const, objectId: second.id, anchor: null },
  };
  const test = setup([root, group, first, second, note, text, image, connector], [root]);
  const apply = vi.spyOn(Scene.prototype, 'apply');
  test.update(1, [10, 10]);
  expect(apply).not.toHaveBeenCalled();
  expect(test.culler.index.searchPoint({ x: 22, y: 22 })).toContain(first.id);
  test.end(2);
  // A renderer built from scratch, not a bare index: a renderer indexes a connector by its route.
  const freshCuller = new SpatialCuller();
  const fresh = new SceneRenderer(new FakeGpuBackend(), {
    culler: freshCuller,
    passes: [SDF_SHAPE_PASS],
  });
  fresh.enqueue(test.mirror.everything());
  fresh.renderFrame({ camera: CAMERA, timeMs: 0 });
  for (const object of [root, group, first, second, note, text, image, connector]) {
    expect(test.culler.index.boundsOf(object.id), object.id).toEqual(
      freshCuller.index.boundsOf(object.id),
    );
  }
  fresh.destroy();
  test.renderer.destroy();
});
