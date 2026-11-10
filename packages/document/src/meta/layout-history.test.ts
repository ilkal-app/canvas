import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { guardProblemOf } from './__fixtures__/stamp-check-fixtures.js';
import { DOCUMENT_LAYOUT_VERSION } from './document-meta.js';
import { canReadBoardLayout, readBoardLayout } from './layout-gate.js';
import { preserveHighestLayout } from './layout-history.js';
import { UpdateStampCheck } from './update-stamp-check.js';

/**
 * Concurrent stamps whose larger client id wins independently of layout.
 *
 * @param newerId - The layout 2 writer.
 * @returns Both concurrent updates.
 */
function concurrent(newerId: number): Uint8Array[] {
  return [newerId, 1000 - newerId].map((id, index) => {
    const doc = new Y.Doc();
    doc.clientID = id;
    doc.getMap('meta').set('document', { schemaVersion: 1, layoutVersion: index === 0 ? 2 : 1 });
    doc.getMap('objects').set(`writer-${String(id)}`, new Y.Map());
    return Y.encodeStateAsUpdate(doc);
  });
}

describe('layout stamp history', () => {
  it('allows supported older historical stamps while keeping live and unsafe replay strict', () => {
    const hub = new Y.Doc();
    hub.getMap('meta').set('document', { schemaVersion: 1, layoutVersion: 2 });
    const update = (layoutVersion: number | undefined) => {
      const writer = new Y.Doc();
      if (layoutVersion !== undefined)
        writer.getMap('meta').set('document', { schemaVersion: 1, layoutVersion });
      writer.getMap('objects').set('object', 'entry');
      return Y.encodeStateAsUpdate(writer);
    };
    const old = update(1);
    expect(new UpdateStampCheck(hub).check(old).kind).toBe('invalid-stamp');
    const replay = new UpdateStampCheck(hub, undefined, true);
    expect(replay.check(old).kind).toBe('accepted');
    expect(replay.check(update(DOCUMENT_LAYOUT_VERSION + 1)).kind).toBe('invalid-stamp');
    expect(replay.check(update(undefined)).kind).toBe('unstamped');
  });

  it('ignores an unsupported stored stamp and repairs to the supported chain maximum', () => {
    const doc = new Y.Doc({ gc: false });
    doc.getMap('meta').set('document', { schemaVersion: 1, layoutVersion: 2 });
    doc.getMap('meta').set('document', { schemaVersion: 1, layoutVersion: 99 });
    expect(readBoardLayout(doc).layoutVersion).toBe(2);
    preserveHighestLayout(doc);
    expect(doc.getMap('meta').get('document')).toEqual({ schemaVersion: 1, layoutVersion: 2 });
  });

  it.each([100, 900])(
    'reads the highest layout even when writer %i loses the visible key',
    (newerId) => {
      for (const updates of [concurrent(newerId), concurrent(newerId).reverse()]) {
        const doc = new Y.Doc({ gc: false });
        for (const update of updates) Y.applyUpdate(doc, update);
        expect(readBoardLayout(doc)).toEqual({ isStamped: true, layoutVersion: 2 });
        expect(canReadBoardLayout(readBoardLayout(doc), [1])).toBe(false);
        doc.getMap('meta').delete('document');
        expect(readBoardLayout(doc).layoutVersion).toBe(2);
      }
    },
  );
  it.each([100, 900])(
    'restamps before GC and preserves writer stamps for live peers and reload (%i)',
    (newerId) => {
      for (const updates of [concurrent(newerId), concurrent(newerId).reverse()]) {
        const hub = new Y.Doc();
        preserveHighestLayout(hub);
        const peer = new Y.Doc();
        const emitted: Uint8Array[] = [];
        hub.on('update', (update: Uint8Array) => {
          emitted.push(update);
          Y.applyUpdate(peer, update);
          expect(guardProblemOf(peer)).toBeUndefined();
        });
        for (const update of updates) Y.applyUpdate(hub, update);
        expect(readBoardLayout(hub).layoutVersion).toBe(2);
        expect(hub.getMap('meta').get('document')).toEqual({ schemaVersion: 1, layoutVersion: 2 });
        expect(readBoardLayout(peer).layoutVersion).toBe(2);
        const reload = new Y.Doc();
        preserveHighestLayout(reload);
        const received: Uint8Array[] = [];
        reload.on('update', (update: Uint8Array) => received.push(update));
        Y.applyUpdate(reload, Y.encodeStateAsUpdate(hub));
        expect(received).toHaveLength(1);
        expect(readBoardLayout(reload).layoutVersion).toBe(2);
        expect(guardProblemOf(reload)).toBeUndefined();
        const before = emitted.length;
        hub.transact(() => undefined);
        Y.applyUpdate(hub, Y.encodeStateAsUpdate(hub));
        expect(emitted).toHaveLength(before);
      }
    },
  );

  it('converges two repair-enabled hubs without corrective ping-pong', () => {
    const hubs: readonly [Y.Doc, Y.Doc] = [new Y.Doc(), new Y.Doc()];
    const outbound: { target: Y.Doc; update: Uint8Array }[] = [];
    for (const [index, hub] of hubs.entries()) {
      preserveHighestLayout(hub);
      const target = hubs[1 - index];
      if (target === undefined) throw new Error('missing peer');
      hub.on('update', (update: Uint8Array) => outbound.push({ target, update }));
      for (const update of index === 0 ? concurrent(100) : concurrent(100).reverse()) {
        Y.applyUpdate(hub, update);
      }
    }
    let exchanges = 0;
    while (outbound.length > 0 && exchanges < 30) {
      const message = outbound.shift();
      if (message === undefined) throw new Error('missing message');
      Y.applyUpdate(message.target, message.update);
      exchanges += 1;
    }
    expect(outbound).toEqual([]);
    expect(exchanges).toBeLessThan(30);
    for (const hub of hubs) {
      expect(readBoardLayout(hub).layoutVersion).toBe(2);
      expect(hub.store.pendingStructs).toBeNull();
      expect(hub.store.pendingDs).toBeNull();
      expect(guardProblemOf(hub)).toBeUndefined();
    }
    expect(Y.encodeStateAsUpdate(hubs[0])).toEqual(Y.encodeStateAsUpdate(hubs[1]));
  });

  it.each([
    null,
    [],
    'bad',
    { schemaVersion: 0, layoutVersion: 2 },
    { schemaVersion: 1.5, layoutVersion: 2 },
    { schemaVersion: 1, layoutVersion: 0 },
    { schemaVersion: 1, layoutVersion: '2' },
    { schemaVersion: 1, layoutVersion: Infinity },
  ])('does not read malformed metadata as a layout: %j', (value) => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('document', value);
    expect(readBoardLayout(doc)).toEqual({ isStamped: true, layoutVersion: undefined });
  });

  it('keeps the highest schema at the highest layout and does not invent versions from malformed values', () => {
    const doc = new Y.Doc();
    const stop = preserveHighestLayout(doc);
    const meta = doc.getMap('meta');
    meta.set('document', { schemaVersion: 7, layoutVersion: 2 });
    meta.set('document', { schemaVersion: 1, layoutVersion: 2 });
    expect(meta.get('document')).toEqual({ schemaVersion: 7, layoutVersion: 2 });
    meta.set('document', { schemaVersion: 'bad', layoutVersion: 999 });
    expect(meta.get('document')).toEqual({ schemaVersion: 7, layoutVersion: 2 });
    meta.delete('document');
    expect(readBoardLayout(doc).layoutVersion).toBe(2);
    stop();
    meta.delete('document');
    expect(meta.has('document')).toBe(false);
    const empty = new Y.Doc();
    preserveHighestLayout(empty);
    empty.getMap('meta').set('document', null);
    expect(readBoardLayout(empty).layoutVersion).toBeUndefined();
  });
});
