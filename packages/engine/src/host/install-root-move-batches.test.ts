import { expect, it } from 'vitest';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { NO_FRAME_TIMERS, type FrameContext } from '../scene/frame-context.js';
import { Frame } from '../scene/frame.js';
import { getRootMoveBatch } from '../scene/root-move-batch.js';
import { markRootMoveChanges } from '../scene/root-move-changes.js';
import { SceneChangeQueue } from '../scene/scene-change-queue.js';
import type { SceneChangeSet } from '../scene/scene-source.js';
import { Scene } from '../scene/scene.js';

import { installRootMoveBatches } from './install-root-move-batches.js';

it('captures current coalesced positions only inside the core collection scope', () => {
  const base = shapeObject('a');
  let object = base;
  const changes: SceneChangeSet = markRootMoveChanges({
    created: [],
    updated: [base.id],
    deleted: [],
    get: () => object,
  });
  const scene = new Scene([]);
  scene.apply({ ...changes, created: [base.id], updated: [] });
  const queue = new SceneChangeQueue();
  queue.push(changes);
  const context = { scene, changes: queue, timers: NO_FRAME_TIMERS } as FrameContext;
  const frame = new Frame([
    {
      name: 'collectChanges',
      run: () => {
        const current = queue.drain();
        expect(current).toBe(changes);
        expect(getRootMoveBatch(changes)).toEqual([object]);
      },
    },
  ]);
  installRootMoveBatches(frame);
  frame.wrapStage('collectChanges', (inner) => ({
    name: inner.name,
    run: (current) => {
      expect(getRootMoveBatch(changes)).toBeUndefined();
      object = { ...base, x: 42 };
      inner.run(current);
      expect(getRootMoveBatch(changes)).toBeUndefined();
    },
  }));
  frame.run(context);
  expect(changes.get(base.id)).toBe(object);
});

it.each(['ordinary', 'missing', 'mixed'] as const)(
  'keeps %s batches on the ordinary path',
  (kind) => {
    const object = shapeObject('a');
    const scene = new Scene([]);
    scene.apply({ created: [object.id], updated: [], deleted: [], get: () => object });
    const changes: SceneChangeSet = {
      created: [],
      updated: [object.id],
      deleted: [],
      get: () => (kind === 'missing' ? undefined : object),
    };
    if (kind !== 'ordinary') markRootMoveChanges(changes);
    const queue = new SceneChangeQueue();
    if (kind === 'mixed') queue.push({ ...changes });
    queue.push(changes);
    const frame = new Frame([
      {
        name: 'collectChanges',
        run: () => {
          const current = queue.drain();
          expect(current).toBeDefined();
          if (!current) throw new Error('Missing changes');
          expect(getRootMoveBatch(current)).toBeUndefined();
        },
      },
    ]);
    installRootMoveBatches(frame);
    frame.run({ scene, changes: queue, timers: NO_FRAME_TIMERS } as FrameContext);
  },
);
