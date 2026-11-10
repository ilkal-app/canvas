import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectorLinks } from '../connectors/connector-links.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { Scene } from '../scene/scene.js';
import { ZOrderMirror } from '../scene/segments/z-order-mirror.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { hitPoint } from '../spatial/hit-point.js';
import { SceneSpatialIndex } from '../spatial/scene-spatial-index.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';

import { RetainedMoveMirror } from './retained-move-mirror.js';
import { SceneSourceMirror } from './scene-source-mirror.js';
import { serializeChangeSet } from './serializable-change-set.js';

const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 100, viewportHeightPx: 100 };

/**
 * Work counters: Scene.apply, ZOrderMirror.observe, RetainedMoveMirror.get, and
 * ZOrderSegments.counts. Zero per update after begin is the acceptance contract.
 *
 * @param objects - Root leaves to load and retain.
 * @returns The worker-side mirror, renderer and frame drivers.
 * @throws {Error} If the fixture cannot begin its session.
 */
function fixture(objects = [shapeObject('moving', { x: 10 })]) {
  const backend = new FakeGpuBackend();
  const culler = new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 });
  const renderer = new SceneRenderer(backend, { culler, passes: [SDF_SHAPE_PASS] });
  const document = new FakeSceneDocument();
  const mirror = new SceneSourceMirror(true);
  document.create(...objects);
  renderer.enqueue(mirror.apply(serializeChangeSet(document.takeChanges())));
  const frame = () => renderer.renderFrame({ camera: CAMERA, timeMs: 0 });
  frame();
  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects,
    positions: new Float64Array(objects.flatMap(({ x, y }) => [x, y])),
  });
  if (!begin) throw new Error('Expected begin');
  renderer.enqueueRetainedMove(
    begin,
    objects.map(({ id }) => id),
  );
  frame();
  const update = (sequence: number, positions: readonly number[]) => {
    const changes = mirror.applyMove({
      kind: 'update',
      session: 1,
      sequence,
      positions: new Float64Array(positions),
    });
    if (!changes) throw new Error('Expected update');
    renderer.enqueueRetainedMove(
      changes,
      objects.map(({ id }) => id),
    );
    frame();
  };
  const end = (sequence: number) => {
    const changes = mirror.applyMove({ kind: 'end', session: 1, sequence });
    if (!changes) throw new Error('Expected end');
    renderer.enqueue(changes);
    frame();
  };
  return { backend, culler, document, mirror, renderer, frame, update, end };
}

afterEach(() => vi.restoreAllMocks());

describe('retained worker leaf placement', () => {
  it('keeps every update out of scene apply, z-order observation, routing and object reads', () => {
    const test = fixture();
    const apply = vi.spyOn(Scene.prototype, 'apply');
    const observe = vi.spyOn(ZOrderMirror.prototype, 'observe');
    const read = vi.spyOn(RetainedMoveMirror.prototype, 'get');
    const route = vi.spyOn(ConnectorLinks.prototype, 'observe');
    const spatial = vi.spyOn(SceneSpatialIndex.prototype, 'applyInto');
    for (let sequence = 1; sequence <= 4; sequence += 1) {
      const before = [
        apply.mock.calls.length,
        observe.mock.calls.length,
        read.mock.calls.length,
        route.mock.calls.length,
        spatial.mock.calls.length,
      ];
      test.update(sequence, [10 + sequence * 3, 20 + sequence]);
      expect([
        apply.mock.calls.length,
        observe.mock.calls.length,
        read.mock.calls.length,
        route.mock.calls.length,
        spatial.mock.calls.length,
      ]).toEqual(before);
    }
    test.renderer.destroy();
  });

  it('places moved leaves into and out of the view and answers spatial queries mid-session', () => {
    const test = fixture([
      shapeObject('outside', { x: 150, y: 10 }),
      shapeObject('inside', { x: 20, y: 20 }),
    ]);
    const visible: string[][] = [];
    test.renderer.frame.insertStage('before', 'draw', {
      name: 'captureMovingVisibility',
      run: ({ drawList, scene }) => {
        visible.push(
          drawList
            .filter(({ passName }) => passName === SDF_SHAPE_PASS.name)
            .flatMap(({ ranges }) =>
              ranges.flatMap(({ start, count }) =>
                Array.from({ length: count }, (value, offset) => {
                  const slot = start + offset;
                  return (
                    ['outside', 'inside'].find((id) =>
                      scene
                        .slotsOf(id as ReturnType<typeof shapeObject>['id'], SDF_SHAPE_PASS.name)
                        .includes(slot),
                    ) ?? ''
                  );
                }),
              ),
            ),
        );
      },
    });
    test.update(1, [30, 10, 160, 20]);
    expect(visible.at(-1)).toContain('outside');
    expect(visible.at(-1)).not.toContain('inside');
    expect(test.culler.index.searchRect({ minX: 25, minY: 5, maxX: 45, maxY: 25 })).toContain(
      'outside',
    );
    expect(test.culler.index.searchPoint({ x: 35, y: 15 })).toContain('outside');
    expect(test.culler.index.searchPoint({ x: 155, y: 25 })).not.toContain('inside');
    expect(hitPoint(test.culler.index, test.mirror, { x: 35, y: 15 }, { zoom: 1 })).toContain(
      'outside',
    );
    expect(test.culler.index).toHaveProperty('movingCount', 2);
    test.end(2);
    const fresh = new SpatialCuller().index;
    fresh.apply(test.mirror.everything());
    expect(test.culler.index.validate()).toEqual([]);
    expect(test.culler.index.searchRect({ minX: 0, minY: 0, maxX: 200, maxY: 100 })).toEqual(
      fresh.searchRect({ minX: 0, minY: 0, maxX: 200, maxY: 100 }),
    );
    for (const id of ['outside', 'inside'] as const)
      expect(test.culler.index.boundsOf(id as ReturnType<typeof shapeObject>['id'])).toEqual(
        fresh.boundsOf(id as ReturnType<typeof shapeObject>['id']),
      );
    expect(test.culler.index).toHaveProperty('movingCount', 0);
    test.renderer.destroy();
  });

  it('materializes a moved object before an ordinary remote replacement', () => {
    const test = fixture();
    test.update(1, [43, 17]);
    const replacement = shapeObject('moving', { x: 70, y: 30, width: 25 });
    test.renderer.enqueue(
      test.mirror.apply({
        created: [],
        updated: [replacement.id],
        deleted: [],
        objects: { [replacement.id]: replacement },
      }),
    );
    test.frame();
    const ordinary = new SceneRenderer(new FakeGpuBackend(), { passes: [SDF_SHAPE_PASS] });
    const document = new FakeSceneDocument();
    document.create(replacement);
    ordinary.enqueue(document.takeChanges());
    ordinary.renderFrame({ camera: CAMERA, timeMs: 0 });
    expect(test.renderer.scene.instanceBufferOf(SDF_SHAPE_PASS.name).data).toEqual(
      ordinary.scene.instanceBufferOf(SDF_SHAPE_PASS.name).data,
    );
    expect(test.culler.index.boundsOf(replacement.id)).toEqual({
      minX: 70,
      minY: 30,
      maxX: 95,
      maxY: 40,
    });
    ordinary.destroy();
    test.renderer.destroy();
  });
});
