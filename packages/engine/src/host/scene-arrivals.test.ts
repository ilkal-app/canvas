import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { RecordingOverlay } from './__fixtures__/recording-overlay.js';
import type { EngineOverlay } from './engine-overlay.js';
import { layerOverlays, overlayLayerModel } from './layered-overlay.js';
import { SceneArrivals } from './scene-arrivals.js';
import { serializeChangeSet, type SerializableChangeSet } from './serializable-change-set.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

/**
 * A layered overlay whose base and `peers` layer record each model they are given.
 *
 * @returns The overlay and what each layer was given.
 */
function layeredRecorder(): {
  overlay: EngineOverlay;
  given: { base: unknown[]; peers: unknown[] };
} {
  const given = { base: [] as unknown[], peers: [] as unknown[] };
  const recorder = (into: unknown[]) => (): EngineOverlay => ({
    install: () => undefined,
    setModel: (model) => {
      into.push(model);
      return true;
    },
    destroy: () => undefined,
  });
  const create = layerOverlays(recorder(given.base), { peers: recorder(given.peers) });
  return { overlay: create(new FakeGpuBackend()), given };
}

function setUp(hasOverlay = true) {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, { passes: [FILLED_RECT_PASS] });
  const overlay = hasOverlay ? new RecordingOverlay(backend) : undefined;
  overlay?.install(renderer.frame);
  const faults: Error[] = [];
  const arrivals = new SceneArrivals();
  arrivals.useOverlay(overlay);
  const apply = (): void => {
    arrivals.apply(renderer, (error) => faults.push(error));
  };
  return { renderer, overlay, faults, arrivals, apply };
}

describe('SceneArrivals', () => {
  it('queues the change sets in arrival order for the next frame, through its mirror', () => {
    const { renderer, arrivals, apply } = setUp();
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'), shapeObject('b'));
    arrivals.addChangeSet(serializeChangeSet(document.takeChanges()));
    document.delete('b');
    arrivals.addChangeSet(serializeChangeSet(document.takeChanges()));
    apply();
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(renderer.scene.objectCount).toBe(1);
    expect(renderer.scene.slotsOf('a' as ObjectId, 'solid-rect')).toHaveLength(1);
    apply();
    expect(renderer.renderFrame({ timeMs: 16, camera: CAMERA }).changedObjects).toBe(0);
  });

  it('judges the final state once after multiple translated arrivals in a worker frame', () => {
    const { renderer, arrivals, apply } = setUp();
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'));
    arrivals.addChangeSet(serializeChangeSet(document.takeChanges()));
    apply();
    const enqueue = vi.spyOn(renderer, 'enqueue');
    const id = 'a' as ObjectId;
    for (const x of [10, -3, 8]) {
      arrivals.addChangeSet({
        created: [],
        updated: [id],
        deleted: [],
        objects: {},
        translation: { ids: [id], x, y: 0 },
      });
    }
    apply();
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]?.[0].get(id)?.x).toBe(shapeObject('a').x + 15);
    expect(renderer.renderFrame({ timeMs: 0, camera: CAMERA }).changedObjects).toBe(1);
  });

  it('shows only the latest overlay model, once', () => {
    const { renderer, overlay, arrivals, apply } = setUp();
    arrivals.setOverlay({ label: 'first' });
    arrivals.setOverlay({ label: 'second' });
    apply();
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    apply();
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(overlay?.drawn).toEqual(['second', 'second']);
  });

  it('gives each layer its latest model when several layers send in one frame', () => {
    const { overlay, given } = layeredRecorder();
    const arrivals = new SceneArrivals();
    arrivals.useOverlay(overlay);
    arrivals.setOverlay(overlayLayerModel('peers', 'old box'));
    arrivals.setOverlay(overlayLayerModel('peers', 'moved box'));
    arrivals.setOverlay('drag handles');
    arrivals.apply(new SceneRenderer(new FakeGpuBackend()), () => undefined);
    expect(given).toEqual({ base: ['drag handles'], peers: ['moved box'] });

    // A rebuilt overlay gets every layer's last model again.
    const rebuilt = layeredRecorder();
    arrivals.useOverlay(rebuilt.overlay);
    arrivals.apply(new SceneRenderer(new FakeGpuBackend()), () => undefined);
    expect(rebuilt.given).toEqual({ base: ['drag handles'], peers: ['moved box'] });
  });

  it('reports a malformed change set and a refused model, and applies the rest', () => {
    const { renderer, overlay, faults, arrivals, apply } = setUp();
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'));
    arrivals.addChangeSet({ created: [3] } as never);
    arrivals.addChangeSet(serializeChangeSet(document.takeChanges()));
    arrivals.setOverlay({ label: 7 });
    apply();
    expect(renderer.renderFrame({ timeMs: 0, camera: CAMERA }).changedObjects).toBe(1);
    expect(overlay?.drawn).toEqual([undefined]);
    expect(faults.map(({ message }) => message)).toEqual([
      'The engine received a malformed change set.',
      'The engine received a malformed overlay model.',
    ]);
  });

  it('reports a model when there is no overlay layer to show it on', () => {
    const { faults, arrivals, apply } = setUp(false);
    arrivals.setOverlay({ label: 'lost' });
    apply();
    expect(faults.map(({ message }) => message)).toEqual([
      'The engine has no overlay layer to show a model on.',
    ]);
  });

  it('replays the whole mirrored document into a new renderer', () => {
    const { renderer, arrivals, apply } = setUp();
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'), shapeObject('b'));
    arrivals.addChangeSet(serializeChangeSet(document.takeChanges()));
    apply();
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const rebuilt = new SceneRenderer(new FakeGpuBackend(), { passes: [FILLED_RECT_PASS] });

    arrivals.replay(rebuilt);
    rebuilt.renderFrame({ timeMs: 16, camera: CAMERA });

    expect(rebuilt.scene.objectCount).toBe(2);
    expect(rebuilt.scene.slotsOf('b' as ObjectId, 'solid-rect')).toHaveLength(1);
  });

  it('shows the last model shown on a new overlay layer', () => {
    const { renderer, arrivals, apply } = setUp();
    arrivals.setOverlay({ label: 'selection' });
    apply();
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const backend = new FakeGpuBackend();
    const rebuilt = new SceneRenderer(backend);
    const layer = new RecordingOverlay(backend);
    layer.install(rebuilt.frame);

    arrivals.useOverlay(layer);
    arrivals.apply(rebuilt, () => undefined);
    rebuilt.renderFrame({ timeMs: 16, camera: CAMERA });

    expect(layer.drawn).toEqual(['selection']);
  });
});

it('orders retained sessions, preserves replay positions and restores the ordinary document on end', () => {
  const { renderer, arrivals, apply, faults } = setUp();
  const object = shapeObject('a');
  const send = (retainedMove: NonNullable<SerializableChangeSet['retainedMove']>) => {
    arrivals.addChangeSet({ created: [], updated: [], deleted: [], objects: {}, retainedMove });
  };
  send({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: [object],
    positions: new Float64Array([10, -0]),
  });
  send({ kind: 'update', session: 1, sequence: 1, positions: new Float64Array([20, 30]) });
  apply();
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  const replay = vi.spyOn(renderer, 'enqueue');
  arrivals.replay(renderer);
  expect(replay.mock.calls[0]?.[0].get(object.id)).toEqual({ ...object, x: 20, y: 30 });
  send({ kind: 'end', session: 1, sequence: 2 });
  arrivals.addChangeSet({
    created: [],
    updated: [object.id],
    deleted: [],
    objects: { [object.id]: object },
  });
  apply();
  renderer.renderFrame({ timeMs: 16, camera: CAMERA });
  replay.mockClear();
  arrivals.replay(renderer);
  expect(replay.mock.calls[0]?.[0].get(object.id)).toEqual(object);
  expect(faults).toEqual([]);
});
