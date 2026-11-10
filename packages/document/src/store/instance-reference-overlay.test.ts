import { describe, expect, it } from 'vitest';

import { validateBoard } from '@canvas/schema';

import {
  createComponentPair,
  placeInstance,
  seedLeafMain,
} from '../commands/__fixtures__/component-boards.js';

import { id, RELAY } from './__fixtures__/store-fixtures.js';
import type { ChangeSet, DocumentUpdate, RepairMode } from './document-store.js';
import { YjsDocumentStore } from './yjs-document-store.js';

/**
 * Concurrent individually valid placements closing a two-main reference cycle.
 *
 * @returns The independent writers before exchanging their placements.
 */
function cycleWriters() {
  const [first, second] = createComponentPair(31, 32, (store) => {
    seedLeafMain(store, 'main-a', { x: 100, y: 100 });
    seedLeafMain(store, 'main-b', { x: 500, y: 100 });
  });
  placeInstance(first, 'main-b', { x: 120, y: 130, parentId: 'main-a', instanceId: 'inst-a' });
  placeInstance(second, 'main-a', { x: 540, y: 150, parentId: 'main-b', instanceId: 'inst-b' });
  return [first, second] as const;
}

describe('component reference projection', () => {
  it.each(['read-only', 'agent-write'] satisfies RepairMode[])(
    '%s projects before notifications and emits no component repair',
    (repairMode) => {
      const [first, second] = cycleWriters();
      const reader = new YjsDocumentStore({ clientId: 33, repairMode });
      reader.applyUpdate(first.encodeState(), RELAY);
      const updates: DocumentUpdate[] = [];
      const changes: ChangeSet[] = [];
      reader.subscribeUpdates((update) => updates.push(update));
      reader.subscribe((change) => {
        changes.push(change);
        expect(validateBoard(reader.read())).toEqual([]);
      });
      reader.applyUpdate(second.encodeState(reader.encodeStateVector()), RELAY);
      expect(reader.get(id('inst-a'))).toMatchObject({ parentId: null, x: 120, y: 130 });
      expect(changes.flatMap((change) => change.updated)).toContain('inst-a');
      expect(updates.filter((update) => update.isLocal)).toEqual([]);
      const cold = new YjsDocumentStore({ repairMode });
      cold.applyUpdate(reader.encodeState(), RELAY);
      expect(cold.get(id('inst-a'))).toEqual(reader.get(id('inst-a')));
      reader.setRepairMode('write');
      expect(updates.filter((update) => update.isLocal)).toHaveLength(1);
      const materialized = new YjsDocumentStore({ repairMode: 'read-only' });
      materialized.applyUpdate(reader.encodeState(), RELAY);
      expect(materialized.get(id('inst-a'))).toEqual(reader.get(id('inst-a')));
      for (const store of [first, second, reader, cold, materialized]) store.destroy();
    },
  );
});
