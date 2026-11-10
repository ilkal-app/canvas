import { expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import type { ObjectId, PrincipalId } from '@canvas/schema';

import { commentPlacement, placeThreadPin } from './comment-placement.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

it('does the network phase before idle and writes its one pin after the run ends', async () => {
  const store = new YjsDocumentStore();
  const placement = commentPlacement(store.read(), { x: 40, y: 50 });
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal) writes();
  });
  const network = vi.fn(() => Promise.resolve('thread-from-service'));
  const run = store.beginRun();
  const threadId = await network();
  expect(network).toHaveBeenCalledOnce();
  try {
    expect(() => placeThreadPin({ store, origin: ORIGIN }, placement, threadId)).not.toThrow();
    expect(store.get(placement.id)).toBeUndefined();
    expect(writes).not.toHaveBeenCalled();
  } finally {
    run.close();
  }
  await vi.waitFor(() => {
    expect(store.get(placement.id)).toMatchObject({ threadId });
  });
  expect(writes).toHaveBeenCalledOnce();
  store.destroy();
});

it('uses the point fallback if the anchored object disappears before the held pin writes', async () => {
  const store = new YjsDocumentStore();
  const target = 'gone' as ObjectId;
  const placement = {
    id: 'pin' as ObjectId,
    point: { x: 1, y: 2 },
    anchor: { kind: 'object' as const, objectId: target, offset: { x: 1, y: 2 } },
  };
  const run = store.beginRun();
  expect(() => placeThreadPin({ store, origin: ORIGIN }, placement, 'thread')).not.toThrow();
  run.close();
  await vi.waitFor(() => {
    expect(store.get(placement.id)).toMatchObject({ anchor: { kind: 'point' } });
  });
  store.destroy();
});
