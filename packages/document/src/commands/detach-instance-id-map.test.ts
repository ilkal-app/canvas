// `detachInstance` reports which new child came from which source child, keyed by the
// override path, so an agent (the MCP `detach_instance` tool) can address what it detached.
import { describe, expect, it } from 'vitest';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import {
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';
import { splitComponentDeletion, splitInstanceDetach } from './component-command-parts.js';
import { MAX_OBJECTS_PER_TRANSACTION } from './create-objects-parts.js';
import type { DeleteObjectsPlan, DeleteObjectsResult } from './delete-objects.js';
import type { DetachInstancePlan, DetachInstanceResult } from './detach-instance.js';

describe('detachInstance idMap', () => {
  it('maps each source child’s path to the new child made from it', () => {
    const store = new YjsDocumentStore();
    const card = seedMainWithChildren(store);
    const instanceId = placeInstance(store, card.mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: card.boxId,
      override: { fill: [0, 1, 0, 1] },
    });
    const { result } = applyCommand(store, mustFindCommand('detachInstance'), { id: instanceId });
    const { idMap, createdIds } = result as DetachInstanceResult;
    const sources = [card.noteId, card.boxId, card.captionId, card.photoId];
    expect(Object.keys(idMap).sort()).toEqual([...sources].sort());
    expect(Object.values(idMap).sort()).toEqual([...createdIds].sort());
    for (const source of sources) {
      const copy = mustGet(store, idMap[source] ?? '');
      expect(copy.type).toBe(mustGet(store, source).type);
      expect(copy.parentId).toBe(instanceId);
    }
    expect(mustGet(store, idMap[card.boxId] ?? '')).toMatchObject({ fill: [0, 1, 0, 1] });
  });

  it('names, when deleting a main detaches an instance, which main child each new child copies', () => {
    // The sync fuzz follows raw values a copy carries, from a detach or a deletion.
    const store = new YjsDocumentStore();
    const card = seedMainWithChildren(store);
    const instanceId = placeInstance(store, card.mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const { result } = applyCommand(store, mustFindCommand('deleteObjects'), {
      ids: [card.mainId],
    });
    const { copiedFrom, detachedIds } = result as DeleteObjectsResult;
    expect(detachedIds).toEqual([instanceId]);
    const sources = [card.noteId, card.boxId, card.captionId, card.photoId];
    expect(Object.values(copiedFrom ?? {}).sort()).toEqual([...sources].sort());
    for (const [copy, source] of Object.entries(copiedFrom ?? {})) {
      expect(mustGet(store, copy)).toMatchObject({
        type: mustGet(store, source).type,
        parentId: instanceId,
      });
    }
  });

  it('maps a nested instance by its own path, its content staying behind its main', () => {
    const store = new YjsDocumentStore();
    const outer = seedMainWithChildren(store, { prefix: 'outer' }).mainId;
    const leafId = seedLeafMain(store, 'main-leaf', { x: 1000, y: 1000 });
    const nested = placeInstance(store, 'main-leaf', {
      x: 120,
      y: 280,
      parentId: outer,
      instanceId: 'nested',
    });
    const instanceId = placeInstance(store, outer, { x: 2000, y: 0, instanceId: 'inst-1' });
    const { result } = applyCommand(store, mustFindCommand('detachInstance'), { id: instanceId });
    const { idMap } = result as DetachInstanceResult;
    expect(Object.keys(idMap)).toContain(nested);
    expect(Object.keys(idMap)).not.toContain(`${nested}/${leafId}`);
    expect(mustGet(store, idMap[nested] ?? '')).toMatchObject({
      type: 'instance',
      mainId: 'main-leaf',
      parentId: instanceId,
    });
  });

  it('keeps the whole map when a large detach is split into parts', () => {
    const children = Array.from({ length: MAX_OBJECTS_PER_TRANSACTION + 1 }, (unused, index) => ({
      id: `child-${String(index)}`,
      parentId: 'inst-1',
    }));
    const idMap = Object.fromEntries(children.map(({ id }) => [`source-${id}`, id]));
    const plan = { frame: { id: 'inst-1' }, children, idMap } as unknown as DetachInstancePlan;
    const split = splitInstanceDetach(plan);
    expect(split?.parts.length).toBeGreaterThan(1);
    expect(split?.result.idMap).toEqual(idMap);
  });

  it('keeps a retiring deletion’s whole result when it is split into parts', () => {
    // Every rewrite first, then the deletions, each in parts of at most the transaction size.
    const updated = Array.from({ length: MAX_OBJECTS_PER_TRANSACTION + 1 }, (unused, index) => ({
      id: `copy-${String(index)}`,
      parentId: 'inst-1',
    }));
    const retiring = {
      updated,
      deletedIds: ['main-1', 'main-1-child'],
      retiredIds: ['main-1'],
    };
    const plan = {
      ...retiring,
      detachedIds: ['inst-1'],
      copiedFrom: { 'copy-0': 'main-1-child' },
    } as unknown as DeleteObjectsPlan;
    const split = splitComponentDeletion(plan);
    expect(split?.parts.map((part) => [part.updated.length, part.deletedIds.length])).toEqual([
      [MAX_OBJECTS_PER_TRANSACTION, 0],
      [1, 0],
      [0, 2],
    ]);
    expect(split?.result).toMatchObject({
      deletedIds: ['main-1', 'main-1-child'],
      retiredIds: ['main-1'],
      detachedIds: ['inst-1'],
      copiedFrom: { 'copy-0': 'main-1-child' },
    });
    expect(split?.result.updatedIds).toHaveLength(MAX_OBJECTS_PER_TRANSACTION + 1);
    // The plan's detach fields are optional; a retirement that detached nothing reports none.
    const quiet = splitComponentDeletion(retiring as unknown as DeleteObjectsPlan);
    expect(quiet?.result).toMatchObject({ detachedIds: [], copiedFrom: {} });
  });
});
