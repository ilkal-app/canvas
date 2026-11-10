import { expect, it, vi } from 'vitest';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { getRootMovePlacement } from '../scene/root-move-placement.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { FakeCanvas, FakeHostPlatform } from './__fixtures__/fake-host-platform.js';
import { createEngineWorkerEntry } from './engine-worker-entry.js';
import type { RetainedMoveCommand } from './retained-move-command.js';

it('enables exclusive placement provenance through worker entry, runtime and arrivals', async () => {
  const platform = new FakeHostPlatform();
  const entry = createEngineWorkerEntry(platform);
  const object = shapeObject('a');
  const owned: boolean[] = [];
  // What the renderer is handed for each move: a placing session places a trusted update
  // without passing it on, so provenance is read where it arrives.
  const enqueue = Object.getOwnPropertyDescriptor(SceneRenderer.prototype, 'enqueueRetainedMove')
    ?.value as SceneRenderer['enqueueRetainedMove'];
  const spy = vi.spyOn(SceneRenderer.prototype, 'enqueueRetainedMove').mockImplementation(function (
    this: SceneRenderer,
    changes,
    ids,
  ) {
    owned.push(getRootMovePlacement(changes) !== undefined);
    enqueue.call(this, changes, ids);
  });
  const post = () => undefined;
  const move = async (retainedMove: RetainedMoveCommand) => {
    await entry.onMessage(
      {
        type: 'engine-commands',
        commands: [
          {
            type: 'change-set',
            changes: { created: [], updated: [], deleted: [], objects: {}, retainedMove },
          },
        ],
      },
      post,
    );
    platform.runFrame(16);
  };
  try {
    await entry.onMessage(
      { type: 'engine-init', canvas: new FakeCanvas(32, 32), options: {} },
      post,
    );
    await entry.onMessage(
      {
        type: 'engine-commands',
        commands: [
          {
            type: 'camera',
            camera: { x: 0, y: 0, zoom: 1, viewportWidthPx: 32, viewportHeightPx: 32, dpr: 1 },
          },
        ],
      },
      post,
    );
    await move({
      kind: 'begin',
      session: 1,
      sequence: 0,
      objects: [object],
      positions: new Float64Array([0, 0]),
    });
    expect(owned.at(-1)).toBe(false);
    await move({ kind: 'update', session: 1, sequence: 1, positions: new Float64Array([5, 6]) });
    expect(owned.at(-1)).toBe(true);
    await move({
      kind: 'update',
      session: 1,
      sequence: 2,
      positions: new Float64Array(new SharedArrayBuffer(16)),
    });
    expect(owned.at(-1)).toBe(false);
  } finally {
    spy.mockRestore();
    await entry.onMessage({ type: 'engine-commands', commands: [{ type: 'destroy' }] }, post);
  }
});
