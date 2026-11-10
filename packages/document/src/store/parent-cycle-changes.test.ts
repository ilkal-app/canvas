import { expect, it } from 'vitest';

import { createFrameClients, hostileUpdate } from '../repair/__fixtures__/cycle-fixtures.js';

import { RELAY } from './__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from './yjs-document-store.js';

it('names a virtually rerooted member when only another member closes an unwritten cycle', () => {
  // A viewer writes no repair, so the cycle stays virtual; a writer now repairs one
  // whose member a peer left invalid, which this test once relied on to block it.
  const [source] = createFrameClients([1]) as [YjsDocumentStore];
  const receiver = new YjsDocumentStore({ repairMode: 'read-only' });
  receiver.applyUpdate(source.encodeState(), RELAY);
  receiver.applyUpdate(
    hostileUpdate(source, {
      'frame-outer': { placement: { parentId: 'frame-side' }, size: { width: -1 } },
    }),
    RELAY,
  );
  const mirror = new Map(receiver.read().objects);
  receiver.subscribe(({ created, updated, deleted }) => {
    for (const id of deleted) mirror.delete(id);
    for (const id of [...created, ...updated]) {
      const object = receiver.get(id);
      if (object === undefined) mirror.delete(id);
      else mirror.set(id, object);
    }
  });
  receiver.applyUpdate(
    hostileUpdate(receiver, {
      'frame-side': { placement: { parentId: 'frame-outer' } },
    }),
    RELAY,
  );
  expect(receiver.read().issues.some(({ code }) => code === 'parent-cycle')).toBe(true);
  expect(mirror).toEqual(new Map(receiver.read().objects));
  source.destroy();
  receiver.destroy();
});
