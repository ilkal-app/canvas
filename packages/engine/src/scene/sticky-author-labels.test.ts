// The sticky author labels as the renderer's queue reads them: an author
// change queued in the same frame as other change sets never hides their objects, and a retained
// move keeps a moving sticky's label.
import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId, PrincipalId, StickyObject } from '@canvas/schema';

import { FontLibrary } from '../text/font/font-library.js';
import { preloadLayoutShaper } from '../text/layout/layout-job.js';
import { addBundledFaces, CAMERA, textObject } from '../text/scene/__fixtures__/text-objects.js';
import { resolvedStickyAuthorOf, type StickyAuthors } from '../text/scene/sticky-author-box.js';
import { STICKY_AUTHOR_PASS_NAME } from '../text/scene/sticky-author-pass.js';
import { createDefaultJobHandlers } from '../workers/default-job-handlers.js';
import { WorkerPool } from '../workers/worker-pool.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { isRootMoveChanges, markRootMoveChanges } from './root-move-changes.js';
import { SceneChangeQueue } from './scene-change-queue.js';
import { SceneRenderer } from './scene-renderer.js';
import type { SceneChangeSet } from './scene-source.js';
import { createStandardScenePasses } from './standard-passes.js';
import { StickyAuthorLabels } from './sticky-author-labels.js';

const AUTHORS: StickyAuthors = {
  isShown: true,
  names: new Map([['user:ada', 'Ada']]),
  fallback: 'Former member',
};

/**
 * A sticky by Ada.
 *
 * @param id - Its id.
 * @param x - Its left edge.
 * @returns The sticky.
 */
function sticky(id: string, x = 0): StickyObject {
  return {
    ...textObject(id, 'Note', { createdBy: 'user:ada' as PrincipalId }),
    x,
    type: 'sticky',
    width: 200,
    height: 200,
    autoWidth: false,
    verticalAlign: 'middle',
    color: [1, 0.92, 0.55, 1],
  };
}

/**
 * A change set creating objects, read from a live map as a document's would be.
 *
 * @param board - The objects by id, read when asked.
 * @param created - The ids created.
 * @returns The change set.
 */
function created(board: Map<string, BoardObject>, created: readonly string[]): SceneChangeSet {
  return {
    created: created as ObjectId[],
    updated: [],
    deleted: [],
    get: (id) => board.get(id),
  };
}

describe('StickyAuthorLabels in the renderer queue', () => {
  it('leaves other objects of the same frame readable after an author change', () => {
    const board = new Map<string, BoardObject>([
      ['note', sticky('note')],
      ['box', shapeObject('box')],
    ]);
    const labels = new StickyAuthorLabels();
    const queue = new SceneChangeQueue();
    queue.push(labels.resolve(created(board, ['note'])));
    queue.push(labels.resolve(created(board, ['box'])));
    const { changes } = labels.set(AUTHORS);
    if (changes === undefined) throw new Error('Expected a label change.');
    queue.push(changes);
    const merged = queue.drain();
    expect(merged?.get('box' as ObjectId)).toEqual(board.get('box'));
    const note = merged?.get('note' as ObjectId);
    expect(note === undefined ? undefined : resolvedStickyAuthorOf(note)).toBe('Ada');
  });

  it('keeps every sticky of two author changes before one frame', () => {
    const board = new Map<string, BoardObject>([
      ['one', sticky('one')],
      ['two', { ...sticky('two'), createdBy: 'user:lin' as PrincipalId }],
    ]);
    const labels = new StickyAuthorLabels();
    const queue = new SceneChangeQueue();
    queue.push(labels.resolve(created(board, ['one', 'two'])));
    queue.drain();
    for (const authors of [AUTHORS, { ...AUTHORS, names: new Map([['user:lin', 'Lin']]) }]) {
      const { changes } = labels.set(authors);
      if (changes !== undefined) queue.push(changes);
    }
    const merged = queue.drain();
    expect(merged?.updated).toEqual(['one', 'two']);
    const labelOf = (id: string): string | undefined => {
      const object = merged?.get(id as ObjectId);
      return object === undefined ? undefined : resolvedStickyAuthorOf(object);
    };
    expect([labelOf('one'), labelOf('two')]).toEqual(['Former member', 'Lin']);
  });

  it('keeps a retained root move one, labelled, and its moved place for a later author change', () => {
    const board = new Map<string, BoardObject>([['note', sticky('note')]]);
    const labels = new StickyAuthorLabels();
    labels.set(AUTHORS);
    labels.resolve(created(board, ['note']));
    const moved = sticky('note', 300);
    const move = markRootMoveChanges({
      created: [],
      updated: ['note' as ObjectId],
      deleted: [],
      get: () => moved,
    });
    const read = labels.resolve(move);
    expect(isRootMoveChanges(read)).toBe(true);
    const during = read.get('note' as ObjectId);
    expect(during === undefined ? undefined : resolvedStickyAuthorOf(during)).toBe('Ada');
    const { changes } = labels.set({ ...AUTHORS, names: new Map([['user:ada', 'Ada L']]) });
    expect(changes?.get('note' as ObjectId)).toMatchObject({ x: 300 });
  });

  it('reads a change set it labels only through its own lookup', () => {
    const get = vi.fn((id: ObjectId) => (id === 'note' ? sticky('note') : undefined));
    const labels = new StickyAuthorLabels();
    const read = labels.resolve({ created: ['note' as ObjectId], updated: [], deleted: [], get });
    read.get('note' as ObjectId);
    expect(get).toHaveBeenCalledWith('note');
  });
});

describe('a retained move in the renderer', () => {
  it('keeps a moving sticky’s author label drawn', async () => {
    const fonts = new FontLibrary();
    addBundledFaces(fonts);
    const jobs = new WorkerPool({ workerCount: 0, fallbackHandlers: createDefaultJobHandlers() });
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: createStandardScenePasses({ jobs }),
      environment: { now: () => 0, requestFrame: () => undefined, text: { fonts, jobs } },
    });
    const frame = async (): Promise<void> => {
      await preloadLayoutShaper();
      for (let step = 0; step < 12; step += 1) {
        renderer.renderFrame({ timeMs: step * 16, camera: CAMERA });
        jobs.drainMainThread(1_000, () => step * 16);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    const document = new FakeSceneDocument();
    renderer.setStickyAuthors(AUTHORS);
    document.create(sticky('note'));
    renderer.enqueue(document.takeChanges());
    await frame();
    const labelRecords = (): number =>
      renderer.scene.instanceBufferOf(STICKY_AUTHOR_PASS_NAME).recordCount;
    expect(labelRecords()).toBe(3);
    for (const x of [100, 200, 300]) {
      const moved = sticky('note', x);
      renderer.enqueueRetainedMove(
        { created: [], updated: ['note' as ObjectId], deleted: [], get: () => moved },
        ['note' as ObjectId],
      );
      await frame();
      expect(labelRecords()).toBe(3);
    }
    jobs.terminate();
  });
});
