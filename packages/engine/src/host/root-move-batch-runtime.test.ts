import { expect, it, vi } from 'vitest';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { getRootMoveBatch } from '../scene/root-move-batch.js';
import { Scene } from '../scene/scene.js';

import {
  FakeCanvas,
  FakeHostPlatform,
  ReadableFakeGpuBackend,
} from './__fixtures__/fake-host-platform.js';
import { EngineRuntime } from './engine-runtime.js';
import type { RetainedMoveCommand } from './retained-move-command.js';

it('activates scoped collection for host moves and drops it on an ordinary edit', () => {
  const canvas = new FakeCanvas(32, 32);
  const platform = new FakeHostPlatform();
  const backend = new ReadableFakeGpuBackend(canvas);
  const faults: Error[] = [];
  const runtime = new EngineRuntime(
    backend,
    canvas,
    platform,
    {},
    {
      onFrame: () => undefined,
      onFault: (error) => {
        faults.push(error);
      },
    },
  );
  const batches: (readonly number[] | undefined)[] = [];
  const apply = Object.getOwnPropertyDescriptor(Scene.prototype, 'apply')?.value as Scene['apply'];
  const spy = vi.spyOn(Scene.prototype, 'apply').mockImplementation(function (
    this: Scene,
    changes,
  ) {
    batches.push(getRootMoveBatch(changes)?.map((object) => object.x));
    return apply.call(this, changes);
  });
  const object = shapeObject('a');
  const move = (retainedMove: RetainedMoveCommand) => {
    runtime.applyChangeSet({ created: [], updated: [], deleted: [], objects: {}, retainedMove });
  };
  try {
    runtime.setCamera({ x: 0, y: 0, zoom: 1, viewportWidthPx: 32, viewportHeightPx: 32, dpr: 1 });
    runtime.applyChangeSet({
      created: [object.id],
      updated: [],
      deleted: [],
      objects: { [object.id]: object },
    });
    platform.runFrame(16);
    move({
      kind: 'begin',
      session: 1,
      sequence: 0,
      objects: [object],
      positions: new Float64Array([3, 4]),
    });
    platform.runFrame(32);
    expect(batches.at(-1)).toBeUndefined();
    move({ kind: 'update', session: 1, sequence: 1, positions: new Float64Array([8, 9]) });
    platform.runFrame(48);
    expect(batches.at(-1)).toEqual([8]);
    runtime.applyChangeSet({
      created: [],
      updated: [object.id],
      deleted: [],
      objects: { [object.id]: { ...object, width: 60 } },
    });
    platform.runFrame(64);
    expect(batches.at(-1)).toBeUndefined();
    expect(faults).toEqual([]);
  } finally {
    spy.mockRestore();
    runtime.destroy();
  }
});
