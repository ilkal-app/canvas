import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN } from '@canvas/document';

import {
  BOARD,
  carryOverOf,
  openSynced,
  seedPreLayoutCache,
} from './__fixtures__/carry-over-harness.js';
import {
  earlierLayoutBoard as fixture,
  holdsObject as holds,
} from './__fixtures__/earlier-layout-board.js';

/**
 * A layout-1 stamp, as a build before wrote it.
 *
 * @param state - The board the stamp is written on, if any.
 * @returns The stamped document's full state.
 */
function layoutOneStamp(state?: Uint8Array): Uint8Array {
  const stamp = new Y.Doc();
  stamp.clientID = 11;
  if (state !== undefined) Y.applyUpdate(stamp, state);
  stamp.getMap('meta').set('document', { schemaVersion: 1, layoutVersion: 1 });
  const bytes = Y.encodeStateAsUpdate(stamp);
  stamp.destroy();
  return bytes;
}

describe('LayoutCarryOver of the pre- cache', () => {
  it('never converts a board left behind, and deletes it only on dismissal', async () => {
    const factory = new IDBFactory();
    const { relay, offline } = fixture();
    const layoutOne = layoutOneStamp();
    await seedPreLayoutCache(factory, { [BOARD]: [layoutOne, offline], synced: [layoutOne] });
    const opened = await openSynced(factory, 2, relay);
    const carryOver = carryOverOf(opened);
    await carryOver.run(true);
    expect(holds(opened.store, 'offline')).toBe(false);
    expect(carryOver.stranded).toEqual([
      {
        boardId: BOARD,
        source: 'canvas-board-cache',
        fromLayoutVersion: 1,
        toLayoutVersion: 2,
        unsentChangeCount: 2,
      },
    ]);
    await carryOver.dismiss('canvas-board-cache');
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toEqual([]);
    expect(await opened.cache.earlierLayouts?.find('synced')).toHaveLength(1);
  });

  it('leaves a copy holding nothing unsent where it is, and says nothing', async () => {
    const factory = new IDBFactory();
    const { relay } = fixture();
    const layoutOne = layoutOneStamp(relay.encodeState());
    await seedPreLayoutCache(factory, { [BOARD]: [layoutOne] });
    const opened = await openSynced(factory, 2, relay);
    opened.store.applyUpdate(layoutOne, SYSTEM_ORIGIN);
    const carryOver = carryOverOf(opened);
    await carryOver.run(true);
    expect(carryOver.stranded).toEqual([]);
    expect(await opened.cache.earlierLayouts?.find(BOARD)).toHaveLength(1);
  });
});
