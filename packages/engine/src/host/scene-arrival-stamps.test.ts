import { expect, it, vi } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { SceneArrivals } from './scene-arrivals.js';
import type { SceneStamp } from './scene-certificate.js';
import type { SerializableChangeSet } from './serializable-change-set.js';

it('certifies every coalesced and retained arrival only after its state is enqueued', () => {
  const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [FILLED_RECT_PASS] });
  const events: unknown[] = [];
  const enqueue = vi.spyOn(renderer, 'enqueue');
  const retained = vi.spyOn(renderer, 'enqueueRetainedMove');
  const arrivals = new SceneArrivals(true, (stamp) => {
    events.push([stamp?.sequence, enqueue.mock.calls.length, retained.mock.calls.length]);
  });
  const object = shapeObject('a');
  let sequence = 0;
  const send = (changes: SerializableChangeSet) => {
    arrivals.addChangeSet(changes, { session: 'preview', sequence: sequence++ });
  };
  const ordinary = {
    created: [object.id],
    updated: [],
    deleted: [],
    objects: { [object.id]: object },
  };
  send(ordinary);
  send({ ...ordinary, created: [], updated: [object.id] });
  const move = (retainedMove: NonNullable<SerializableChangeSet['retainedMove']>) => {
    send({ created: [], updated: [], deleted: [], objects: {}, retainedMove });
  };
  move({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: [object],
    positions: new Float64Array([10, 20]),
  });
  move({ kind: 'update', session: 1, sequence: 1, positions: new Float64Array([30, 40]) });
  move({ kind: 'end', session: 1, sequence: 2 });
  send({ ...ordinary, created: [], updated: [object.id] });
  const fault = vi.fn();
  expect(events).toEqual([]);
  arrivals.apply(renderer, fault);
  expect(events).toEqual([
    [0, 1, 0],
    [1, 1, 0],
    [2, 1, 1],
    [3, 1, 2],
    [4, 2, 2],
    [5, 3, 2],
  ]);
  expect(fault).not.toHaveBeenCalled();
  renderer.destroy();
});

it('invalidates certification rather than acknowledging an obsolete retained update', () => {
  const observed: (SceneStamp | undefined)[] = [];
  const arrivals = new SceneArrivals(true, (stamp) => observed.push(stamp));
  const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [FILLED_RECT_PASS] });
  arrivals.addChangeSet(
    {
      created: [],
      updated: [],
      deleted: [],
      objects: {},
      retainedMove: {
        kind: 'update',
        session: 99,
        sequence: 1,
        positions: new Float64Array([1, 2]),
      },
    },
    { session: 'preview', sequence: 0 },
  );
  const fault = vi.fn();
  arrivals.apply(renderer, fault);
  expect(observed).toEqual([undefined]);
  expect(fault).toHaveBeenCalledOnce();
  renderer.destroy();
});
