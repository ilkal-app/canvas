import { afterEach, expect, it, vi } from 'vitest';

import { DRAWABLE_EXTENT, type BoardObject, type ObjectId } from '@canvas/schema';

import type { GpuBackend } from '../gpu/gpu-backend.js';
import { TransformTable } from '../gpu/transform-table.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { Scene } from '../scene/scene.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { MovingBoxes } from '../spatial/moving-boxes.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import { isRetainedMoveCommand, type RetainedMoveCommand } from './retained-move-command.js';
import { SceneSourceMirror } from './scene-source-mirror.js';
import { serializeChangeSet } from './serializable-change-set.js';

const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 100, viewportHeightPx: 100 };
interface DeltaCommand {
  kind: 'update';
  session: number;
  sequence: number;
  delta: readonly [number, number];
}
interface Placement {
  x: number;
  y: number;
  cos: number;
  sin: number;
}

function fixture(objects: readonly BoardObject[], shapePass = SDF_SHAPE_PASS) {
  const backend = new FakeGpuBackend();
  const culler = new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 });
  const renderer = new SceneRenderer(backend, { culler, passes: [SOLID_RECT_PASS, shapePass] });
  const document = new FakeSceneDocument();
  const mirror = new SceneSourceMirror(true);
  const roots = objects.filter(({ parentId }) => parentId === null);
  const ids = roots.map(({ id }) => id);
  const frame = () => renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
  document.create(...objects);
  renderer.enqueue(mirror.apply(serializeChangeSet(document.takeChanges())));
  frame();
  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: roots,
    positions: new Float64Array(roots.flatMap(({ x, y }) => [x, y])),
  });
  if (!begin) throw new Error('Missing retained begin');
  renderer.enqueueRetainedMove(begin, ids);
  frame();
  const send = (command: RetainedMoveCommand) => {
    const changes = mirror.applyMove(command);
    if (!changes) throw new Error('Retained update was rejected');
    if (command.kind === 'end') renderer.enqueue(changes);
    else renderer.enqueueRetainedMove(changes, ids);
    frame();
  };
  const delta = (sequence: number, x: number, y: number) => {
    send({ kind: 'update', session: 1, sequence, delta: [x, y] } as unknown as RetainedMoveCommand);
  };
  const positions = (sequence: number, x: number, y: number) => {
    send({
      kind: 'update',
      session: 1,
      sequence,
      positions: new Float64Array(roots.flatMap((root) => [root.x + x, root.y + y])),
    });
  };
  return { backend, culler, renderer, mirror, frame, send, delta, positions };
}

function placementOf(renderer: SceneRenderer, id: ObjectId): Placement | undefined {
  //'s sole test-facing accessor: effective table placement plus session offset.
  return (
    renderer as SceneRenderer & {
      retainedPlacementOf(id: ObjectId): Placement | undefined;
    }
  ).retainedPlacementOf(id);
}

afterEach(() => vi.restoreAllMocks());

it('accepts only a finite two-number delta, exclusively of positions', () => {
  const valid: DeltaCommand = { kind: 'update', session: 1, sequence: 1, delta: [2, -3] };
  expect(isRetainedMoveCommand(valid)).toBe(true);
  for (const delta of [[], [1], [1, 2, 3], [NaN, 0], [Infinity, 0], [0, -Infinity], ['1', 2]]) {
    expect(isRetainedMoveCommand({ ...valid, delta }), JSON.stringify(delta)).toBe(false);
  }
  expect(isRetainedMoveCommand({ ...valid, positions: new Float64Array([2, -3]) })).toBe(false);
});

it('updates a large membership without per-member table, pass hook or moving-box writes', () => {
  const roots = Array.from({ length: 128 }, (value, index) =>
    shapeObject(`leaf-${String(index)}`, {
      x: (index % 16) * 20,
      y: Math.floor(index / 16) * 20,
    }),
  );
  const retain = vi.fn();
  const pass = { ...SDF_SHAPE_PASS, retainMoveTarget: retain };
  const test = fixture(roots, pass);
  retain.mockClear();
  const table = vi.spyOn(TransformTable.prototype, 'set');
  const moving = vi.spyOn(MovingBoxes.prototype, 'move');
  const apply = vi.spyOn(Scene.prototype, 'apply');
  const gpu: GpuBackend = test.backend;
  const writes = vi.spyOn(gpu, 'writeTexture');
  const before = [table.mock.calls.length, moving.mock.calls.length, apply.mock.calls.length];
  test.delta(1, 4, 5);
  expect(table.mock.calls.length - (before[0] ?? 0)).toBe(0);
  expect(moving.mock.calls.length - (before[1] ?? 0)).toBe(0);
  expect(apply.mock.calls.length - (before[2] ?? 0)).toBe(0);
  expect(retain.mock.calls.length).toBe(0);
  expect(
    writes.mock.calls
      .filter(
        ([texture]) => (texture as { readonly label?: string }).label === 'move-transform-table',
      )
      .reduce((texels, [, , region]) => texels + (region?.width ?? 0) * (region?.height ?? 0), 0),
  ).toBeLessThanOrEqual(2);
  test.renderer.destroy();
});

it('matches positions for draw stream, effective placement and culler visibility', () => {
  const objects = [
    frameObject('frame', { x: 5, y: 5 }),
    shapeObject('child', { parentId: 'frame', x: 15, y: 5 }),
    shapeObject('outside', { x: 130, y: 10 }),
  ];
  const fast = fixture(objects);
  const reference = fixture(objects);
  const draws = (renderer: SceneRenderer) => {
    let stream: unknown;
    renderer.frame.insertStage('before', 'draw', {
      name: 'captureDeltaDraw',
      run: ({ drawList }) => {
        stream = drawList.map(({ passName, ranges }) => ({ passName, ranges }));
      },
    });
    return () => stream;
  };
  const fastDraw = draws(fast.renderer);
  const referenceDraw = draws(reference.renderer);
  fast.delta(1, -40, 8);
  reference.positions(1, -40, 8);
  expect(fastDraw()).toEqual(referenceDraw());
  expect(fast.culler.visibleIdsFor({ minX: 0, minY: 0, maxX: 100, maxY: 100 })).toEqual(
    reference.culler.visibleIdsFor({ minX: 0, minY: 0, maxX: 100, maxY: 100 }),
  );
  for (const object of objects) {
    expect(placementOf(fast.renderer, object.id)).toEqual(
      placementOf(reference.renderer, object.id),
    );
  }
  fast.renderer.destroy();
  reference.renderer.destroy();
});

it('refuses a delta whose descendant leaves the drawable envelope and falls back', () => {
  const root = frameObject('root', { x: 0, y: 0 });
  const group = groupObject('group', { parentId: root.id, x: DRAWABLE_EXTENT - 10 });
  const child = shapeObject('child', { parentId: group.id, x: -DRAWABLE_EXTENT + 20 });
  const test = fixture([root, group, child]);
  const apply = vi.spyOn(Scene.prototype, 'apply');
  test.delta(1, 20, 0);
  expect(apply).toHaveBeenCalled();
  expect(test.renderer.takeUndrawable().objects).toContainEqual({
    id: group.id,
    reason: 'past-extent',
  });
  test.renderer.destroy();
});

it('renders delta, positions, then delta like all-positions and materializes the final placement', () => {
  const roots = [
    shapeObject('first', { x: 10.125, y: 20.25 }),
    shapeObject('second', { x: 40, y: 30 }),
  ];
  const fast = fixture(roots);
  const reference = fixture(roots);
  fast.delta(1, 3, 4);
  reference.positions(1, 3, 4);
  fast.positions(2, 7, 8);
  reference.positions(2, 7, 8);
  fast.delta(3, 9, 10);
  reference.positions(3, 9, 10);
  for (const root of roots)
    expect(placementOf(fast.renderer, root.id)).toEqual(placementOf(reference.renderer, root.id));
  fast.send({ kind: 'end', session: 1, sequence: 4 });
  reference.send({ kind: 'end', session: 1, sequence: 4 });
  for (const root of roots) {
    expect(fast.mirror.get(root.id)).toEqual(reference.mirror.get(root.id));
    expect(fast.culler.index.boundsOf(root.id)).toEqual(reference.culler.index.boundsOf(root.id));
  }
  fast.renderer.destroy();
  reference.renderer.destroy();
});
