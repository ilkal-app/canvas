import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { updateOf } from './__fixtures__/stamp-check-fixtures.js';
import { discardPendingUpdates } from './pending-updates.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// An older relay could hold a fragment without the writer's earlier clocks.
describe('stamp checks on contaminated hubs', () => {
  it('does not approve filler that would release an unstamped pending object', () => {
    const writer = new Y.Doc();
    const filler = updateOf(writer, () => {
      writer.getText('note').insert(0, 'a');
    });
    const object = updateOf(writer, () => writer.getMap('objects').set('bad', 'unstamped'));
    const hub = new Y.Doc();
    Y.applyUpdate(hub, object);
    expect(hub.store.pendingStructs).not.toBeNull();
    expect(new UpdateStampCheck(hub).check(filler).kind).not.toBe('accepted');
  });
  it('drops pending structs and deletes without touching integrated data, then permits honest resync', () => {
    const writer = new Y.Doc();
    const initial = updateOf(writer, () => {
      writer.getText('note').insert(0, 'a');
    });
    const fragment = updateOf(writer, () => {
      writer.getText('note').insert(1, 'b');
    });
    const deletion = updateOf(writer, () => {
      writer.getText('note').delete(0, 1);
    });
    const hub = new Y.Doc();
    hub.getText('safe').insert(0, 'kept');
    Y.applyUpdate(hub, fragment);
    Y.applyUpdate(hub, deletion);
    expect(new UpdateStampCheck(hub).check(initial).kind).toBe('unprovable');
    const removed = discardPendingUpdates(hub);
    expect(removed.structBytes).toBeGreaterThan(0);
    expect(removed.deleteBytes).toBeGreaterThan(0);
    expect(removed.missing).toHaveLength(1);
    expect(hub.getText('safe').toJSON()).toBe('kept');
    expect(new UpdateStampCheck(hub).check(initial).kind).toBe('accepted');
    Y.applyUpdate(hub, initial);
    expect(hub.getText('note').toJSON()).toBe('a');
    Y.applyUpdate(hub, Y.encodeStateAsUpdate(writer));
    expect(hub.getText('note').toJSON()).toBe('b');
    expect(discardPendingUpdates(hub)).toEqual({ structBytes: 0, deleteBytes: 0, missing: [] });
  });
});
