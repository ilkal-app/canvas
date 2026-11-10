import { expect, it, vi } from 'vitest';

import type { DocumentStore } from '../index.js';
import { forwardUndoSteps, YjsDocumentStore } from '../index.js';
import * as document from '../index.js';

const whenStoreIdle = (
  document as unknown as {
    whenStoreIdle: (store: DocumentStore, work: () => void) => void;
  }
).whenStoreIdle;

it('runs synchronously when idle, waits through successive runs, follows forwarding stores, and drops destroyed work', async () => {
  const root = new YjsDocumentStore();
  const page = Object.create(null) as Parameters<typeof forwardUndoSteps>[0];
  forwardUndoSteps(page, root);
  const calls: string[] = [];
  whenStoreIdle(page, () => calls.push('immediate'));
  expect(calls).toEqual(['immediate']);

  const first = root.beginRun();
  whenStoreIdle(page, () => calls.push('deferred'));
  expect(calls).toEqual(['immediate']);
  // A waiter resumed after the first run must check that the replacement run is idle too.
  first.close();
  const second = root.beginRun();
  await Promise.resolve();
  expect(calls).toEqual(['immediate']);
  second.close();
  await vi.waitFor(() => {
    expect(calls).toEqual(['immediate', 'deferred']);
  });

  const third = root.beginRun();
  whenStoreIdle(root, () => calls.push('destroyed'));
  root.destroy();
  third.close();
  await Promise.resolve();
  expect(calls).toEqual(['immediate', 'deferred']);
});
