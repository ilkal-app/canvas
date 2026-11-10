import { describe, expect, it } from 'vitest';

import { createSeededIdGenerator, type PrincipalId } from '@canvas/schema';

import * as document from '../index.js';
import {
  createHistory,
  createLargeBoardObjects,
  createObjectsCommand,
  forwardUndoSteps,
  runAsOneStep,
  runCommand,
  YjsDocumentStore,
  type DocumentStore,
  type NewObject,
} from '../index.js';

// The public exports are introduced by this slice; keep this acceptance file lintable first.
const { afterParts, isApplyingInParts } = document as typeof document & {
  afterParts: (store: DocumentStore, listener: () => void) => () => void;
  isApplyingInParts: (store: DocumentStore) => boolean;
};

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const GENERATED = new Set(['z', 'createdBy', 'createdAt', 'updatedAt']);

function listed(count: number): NewObject[] {
  return createLargeBoardObjects(count, 557).map(
    (object) =>
      Object.fromEntries(
        Object.entries(object).filter(([key]) => !GENERATED.has(key)),
      ) as unknown as NewObject,
  );
}

function create(store: DocumentStore, seed: number): void {
  const outcome = runCommand(
    store,
    ORIGIN,
    createObjectsCommand,
    { objects: listed(1) },
    { clock: () => 1_770_000_000_000, createId: createSeededIdGenerator(seed) },
  );
  expect(outcome.status).toBe('applied');
}

describe('parts lifecycle', { timeout: 30_000 }, () => {
  it('reports an open outer scope through a forwarding store and fires once after nesting ends', () => {
    const store = new YjsDocumentStore();
    const wrapper = Object.create(store) as DocumentStore;
    forwardUndoSteps(wrapper, store);
    const observed: boolean[] = [];
    const stop = afterParts(wrapper, () => observed.push(isApplyingInParts(store)));

    expect(isApplyingInParts(store)).toBe(false);
    expect(isApplyingInParts(wrapper)).toBe(false);
    runAsOneStep(wrapper, () => {
      expect(isApplyingInParts(store)).toBe(true);
      expect(isApplyingInParts(wrapper)).toBe(true);
      runAsOneStep(store, () => {
        expect(isApplyingInParts(wrapper)).toBe(true);
      });
      expect(observed).toEqual([]);
    });
    expect(isApplyingInParts(store)).toBe(false);
    expect(observed).toEqual([false]);

    stop();
    store.destroy();
  });

  it('fires after a throwing outer scope and honours unsubscribe', () => {
    const store = new YjsDocumentStore();
    const observed: boolean[] = [];
    const stop = afterParts(store, () => observed.push(isApplyingInParts(store)));

    expect(() =>
      runAsOneStep(store, () => {
        expect(isApplyingInParts(store)).toBe(true);
        throw new Error('write failed');
      }),
    ).toThrow('write failed');
    expect(observed).toEqual([false]);
    expect(isApplyingInParts(store)).toBe(false);

    stop();
    runAsOneStep(store, () => undefined);
    expect(observed).toEqual([false]);
    store.destroy();
  });

  it('keeps grouped undo active for every transaction and fires once when undo returns', () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ORIGIN.principalId, { captureTimeout: 0 });
    const outcome = runCommand(
      store,
      ORIGIN,
      createObjectsCommand,
      { objects: listed(2_500) },
      { clock: () => 1_770_000_000_000, createId: createSeededIdGenerator(1) },
    );
    expect(outcome.status).toBe('applied');
    const duringUndo: boolean[] = [];
    const afterUndo: boolean[] = [];
    const stopChanges = store.subscribe((changes) => {
      if (changes.origin.kind === 'undo') duringUndo.push(isApplyingInParts(store));
    });
    const stopParts = afterParts(store, () => afterUndo.push(isApplyingInParts(store)));

    expect(isApplyingInParts(store)).toBe(false);
    expect(history.undo()).toBe(true);
    expect(duringUndo.length).toBeGreaterThan(1);
    expect(duringUndo.every(Boolean)).toBe(true);
    expect(afterUndo).toEqual([false]);
    expect(isApplyingInParts(store)).toBe(false);

    stopParts();
    stopChanges();
    history.destroy();
    store.destroy();
  });

  it('starts a separate undo step for a command run by an afterParts listener', () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ORIGIN.principalId, { captureTimeout: 0 });
    const observed: boolean[] = [];
    let didFollowUp = false;
    const stop = afterParts(store, () => {
      observed.push(isApplyingInParts(store));
      if (didFollowUp) return;
      didFollowUp = true;
      runAsOneStep(store, () => {
        create(store, 3);
        create(store, 4);
      });
    });

    runAsOneStep(store, () => {
      create(store, 1);
      create(store, 2);
    });

    expect(observed).toEqual([false, false]);
    expect(store.read().objects.size).toBe(4);
    expect(history.undo()).toBe(true);
    expect(store.read().objects.size).toBe(2);
    expect(history.undo()).toBe(true);
    expect(store.read().objects.size).toBe(0);

    stop();
    history.destroy();
    store.destroy();
  });

  it('keeps a follow-up after grouped redo separate from the restored group', () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ORIGIN.principalId, { captureTimeout: 0 });
    runAsOneStep(store, () => {
      create(store, 1);
      create(store, 2);
    });
    expect(history.undo()).toBe(true);
    expect(store.read().objects.size).toBe(0);

    const observed: boolean[] = [];
    let didFollowUp = false;
    const stop = afterParts(store, () => {
      observed.push(isApplyingInParts(store));
      if (didFollowUp) return;
      didFollowUp = true;
      runAsOneStep(store, () => {
        create(store, 3);
        create(store, 4);
      });
    });
    expect(history.redo()).toBe(true);

    expect(observed).toEqual([false, false]);
    expect(store.read().objects.size).toBe(4);
    expect(history.undo()).toBe(true);
    expect(store.read().objects.size).toBe(2);
    expect(history.undo()).toBe(true);
    expect(store.read().objects.size).toBe(0);

    stop();
    history.destroy();
    store.destroy();
  });

  it('starts a new undo step for a follow-up fired after grouped undo', () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ORIGIN.principalId, { captureTimeout: 0 });
    runAsOneStep(store, () => {
      create(store, 1);
      create(store, 2);
    });

    const observed: boolean[] = [];
    let didFollowUp = false;
    const stop = afterParts(store, () => {
      observed.push(isApplyingInParts(store));
      if (didFollowUp) return;
      didFollowUp = true;
      runAsOneStep(store, () => {
        create(store, 3);
        create(store, 4);
      });
    });
    expect(history.undo()).toBe(true);

    expect(observed).toEqual([false, false]);
    expect(store.read().objects.size).toBe(2);
    expect(history.undo()).toBe(true);
    expect(store.read().objects.size).toBe(0);
    expect(history.canUndo()).toBe(false);

    stop();
    history.destroy();
    store.destroy();
  });
});
