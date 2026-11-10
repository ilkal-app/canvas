import { expect, it, vi } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { TransformTable } from '../gpu/transform-table.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import type { RetainedMoveCommand } from './retained-move-command.js';
import { SceneSourceMirror } from './scene-source-mirror.js';
import { serializeChangeSet } from './serializable-change-set.js';

/**
 * A session over root shapes, updated by delta or by the equivalent positions.
 *
 * @param roots - The roots.
 * @returns The renderer and a function sending one update.
 */
function session(roots: readonly BoardObject[]) {
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    culler: new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 }),
    passes: [SDF_SHAPE_PASS],
  });
  const document = new FakeSceneDocument();
  const mirror = new SceneSourceMirror(true);
  const ids = roots.map(({ id }) => id);
  const frame = () =>
    renderer.renderFrame({
      camera: { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 100, viewportHeightPx: 100 },
      timeMs: 0,
    });
  document.create(...roots);
  renderer.enqueue(mirror.apply(serializeChangeSet(document.takeChanges())));
  frame();
  const begin = new Float64Array(roots.flatMap(({ x, y }) => [x, y]));
  const send = (command: RetainedMoveCommand) => {
    const changes = mirror.applyMove(command);
    if (!changes) throw new Error('Retained command rejected');
    renderer.enqueueRetainedMove(changes, ids);
    frame();
  };
  send({ kind: 'begin', session: 1, sequence: 0, objects: roots, positions: begin });
  const update = (sequence: number, dx: number, dy: number, isDelta: boolean) => {
    send(
      isDelta
        ? { kind: 'update', session: 1, sequence, delta: [dx, dy] }
        : {
            kind: 'update',
            session: 1,
            sequence,
            positions: new Float64Array(roots.flatMap(({ x, y }) => [x + dx, y + dy])),
          },
    );
  };
  return { renderer, update };
}

it('places a translation beyond the precise extent exactly as positions', () => {
  // Float32 steps are 2 world units here: a float32 offset would land one step off.
  const roots = [shapeObject('far', { x: 16_777_217, y: 3 }), shapeObject('near', { x: 0, y: 0 })];
  const fast = session(roots);
  const reference = session(roots);
  const offset = vi.spyOn(TransformTable.prototype, 'setOffset');
  fast.update(1, -1, 0.5, true);
  reference.update(1, -1, 0.5, false);
  for (const { id } of roots) {
    expect(fast.renderer.retainedPlacementOf(id)).toEqual(
      reference.renderer.retainedPlacementOf(id),
    );
  }
  expect(fast.renderer.retainedPlacementOf(roots[0]?.id ?? ('' as never))?.x).toBe(16_777_216);
  // Placed as positions: no offset was set for this frame.
  expect(offset.mock.calls.every(([dx, dy]) => dx === 0 && dy === 0)).toBe(true);
  fast.renderer.destroy();
  reference.renderer.destroy();
  offset.mockRestore();
});

it('places a large cancelling translation exactly as positions', () => {
  // Lands at x = 1, inside the precise extent, but starts far beyond it: float32 would give 0.
  const roots = [
    shapeObject('far', { x: 16_777_217, y: 0 }),
    shapeObject('farther', { x: 16_777_317, y: 5 }),
  ];
  const fast = session(roots);
  const reference = session(roots);
  const offset = vi.spyOn(TransformTable.prototype, 'setOffset');
  fast.update(1, -16_777_216, 0, true);
  reference.update(1, -16_777_216, 0, false);
  for (const { id } of roots) {
    expect(fast.renderer.retainedPlacementOf(id)).toEqual(
      reference.renderer.retainedPlacementOf(id),
    );
  }
  expect(fast.renderer.retainedPlacementOf(roots[0]?.id ?? ('' as never))?.x).toBe(1);
  expect(offset.mock.calls.every(([dx, dy]) => dx === 0 && dy === 0)).toBe(true);
  fast.renderer.destroy();
  reference.renderer.destroy();
  offset.mockRestore();
});

it('translates through the offset within the precise extent', () => {
  const roots = [shapeObject('a', { x: 1000.5, y: -40.25 }), shapeObject('b', { x: 10, y: 20 })];
  const fast = session(roots);
  const offset = vi.spyOn(TransformTable.prototype, 'setOffset');
  fast.update(1, 12.5, -3, true);
  expect(offset).toHaveBeenLastCalledWith(12.5, -3);
  expect(fast.renderer.retainedPlacementOf(roots[0]?.id ?? ('' as never))).toMatchObject({
    x: 1013,
    y: -43.25,
  });
  fast.renderer.destroy();
  offset.mockRestore();
});
