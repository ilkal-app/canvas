// Acceptance: `detachInstance` keeps
// the instance's id as a frame and materialises the resolved children; `deleteObjects` of a main
// retires it, keeps its children and detaches its instances outside the cascade; each is one undo
// step.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import {
  CARD_BOX,
  CARD_CHILD_BOXES,
  createChild,
  newCommentOn,
  newConnectorTo,
  newFrame,
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
  type SeededMain,
} from './__fixtures__/component-boards.js';
import {
  fieldOf,
  instancesOf,
  mustFindCommand,
  overridesOf,
} from './__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from './delete-objects.js';

/** The result of `detachInstance`. */
interface DetachResult {
  readonly frameId: string;
  readonly createdIds: readonly string[];
}

/** The result of `deleteObjects` once mains are retired. */
interface DeleteResult {
  readonly deletedIds: readonly string[];
  readonly retiredIds: readonly string[];
  readonly detachedIds: readonly string[];
}

/**
 * A card main at the default place, an instance of it at (1000, 0) with the box constrained to
 * stretch and the note's text overridden, a connector attached to the instance and a comment
 * pinned to it.
 *
 * @param store - The store.
 * @returns The card's ids and the instance's.
 */
function seedInstanceWithAttachments(store: YjsDocumentStore): SeededMain & { instanceId: string } {
  const card = seedMainWithChildren(store);
  applyCommand(store, mustFindCommand('setConstraints'), { ids: [card.boxId], x: 'stretch' });
  const instanceId = placeInstance(store, card.mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
  applyCommand(store, mustFindCommand('setInstanceOverride'), {
    id: instanceId,
    path: card.noteId,
    override: { text: 'Hi' },
  });
  createChild(store, newConnectorTo('wire', instanceId, { x: 700, y: 50 }));
  createChild(store, newCommentOn('pin', instanceId));
  return { ...card, instanceId };
}

/**
 * The created children of a detach, by type.
 *
 * @param store - The store.
 * @param createdIds - The detach's `createdIds`.
 * @returns The objects by type; one per type in the card.
 */
function createdByType(store: YjsDocumentStore, createdIds: readonly string[]) {
  return new Map<string, BoardObject>(
    createdIds.map((id) => [mustGet(store, id).type, mustGet(store, id)]),
  );
}

describe('detachInstance', () => {
  it('turns the instance into a frame holding the materialised children, attachments kept', () => {
    const store = new YjsDocumentStore();
    const { mainId, instanceId, boxId } = seedInstanceWithAttachments(store);
    const { result } = applyCommand(store, mustFindCommand('detachInstance'), { id: instanceId });
    const { frameId, createdIds } = result as DetachResult;
    expect(frameId).toBe(instanceId);
    expect(mustGet(store, instanceId)).toMatchObject({
      type: 'frame',
      parentId: null,
      x: 1000,
      y: 0,
      rotation: 0,
      width: CARD_BOX.width,
      height: CARD_BOX.height,
      name: 'Card',
      clip: false,
      background: null,
    });
    expect(createdIds).toHaveLength(4);
    const created = createdByType(store, createdIds);
    expect([...created.keys()].sort()).toEqual(['image', 'shape', 'sticky', 'text']);
    for (const object of created.values()) expect(object.parentId).toBe(instanceId);
    expect(created.get('sticky')).toMatchObject({ ...CARD_CHILD_BOXES.note, text: 'Hi' });
    expect(created.get('shape')).toMatchObject({
      ...CARD_CHILD_BOXES.box,
      constraints: { x: 'stretch', y: 'start' },
    });
    expect(created.get('text')).toMatchObject(CARD_CHILD_BOXES.caption);
    expect(created.get('image')).toMatchObject(CARD_CHILD_BOXES.photo);
    expect(createdIds).not.toContain(boxId);
    // The connector and the comment are still attached to the same id.
    expect(mustGet(store, 'wire')).toMatchObject({ to: { kind: 'object', objectId: instanceId } });
    expect(mustGet(store, 'pin')).toMatchObject({
      anchor: { kind: 'object', objectId: instanceId },
    });
    expect([...instancesOf(store, mainId)]).toEqual([]);
    expect(mustGet(store, mainId)).toMatchObject({ type: 'component', retired: false });
  });

  it('materialises a nested instance as an instance carrying the overrides that passed through it', () => {
    const store = new YjsDocumentStore();
    const outer = seedMainWithChildren(store, { prefix: 'outer' }).mainId;
    const leafId = seedLeafMain(store, 'main-leaf', { x: 1000, y: 1000 });
    // `createInstance` takes board coordinates: the outer main sits at (100, 100), so this is
    // (20, 180) in its frame, where the materialised copy is expected below.
    const nested = placeInstance(store, 'main-leaf', {
      x: 120,
      y: 280,
      parentId: outer,
      instanceId: 'nested',
    });
    const instanceId = placeInstance(store, outer, { x: 2000, y: 0, instanceId: 'inst-1' });
    const override = { color: [0.2, 0.9, 0.2, 1] };
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: `${nested}/${leafId}`,
      override,
    });
    const { result } = applyCommand(store, mustFindCommand('detachInstance'), { id: instanceId });
    const { createdIds } = result as DetachResult;
    const created = createdByType(store, createdIds);
    expect(created.get('instance')).toMatchObject({
      parentId: instanceId,
      x: 20,
      y: 180,
      mainId: 'main-leaf',
      overrides: { [leafId]: override },
    });
    expect(created.get('instance')?.id).not.toBe(nested);
    expect(mustGet(store, nested)).toMatchObject({ type: 'instance', parentId: outer });
  });

  it('is one undo step: the instance is back with its overrides and every created id is gone', () => {
    const store = new YjsDocumentStore();
    const { mainId, instanceId } = seedInstanceWithAttachments(store);
    const before = mustGet(store, instanceId);
    const overridesBefore = fieldOf(store, instanceId, 'overrides');
    const history = createHistory(store, ADA.principalId);
    const { result } = applyCommand(store, mustFindCommand('detachInstance'), { id: instanceId });
    const { createdIds } = result as DetachResult;
    expect(history.undo()).toBe(true);
    expect(mustGet(store, instanceId)).toEqual(before);
    expect(overridesOf(store, instanceId)).toEqual(overridesBefore);
    for (const id of createdIds) expect(store.get(id as ObjectId)).toBeUndefined();
    expect([...instancesOf(store, mainId)]).toEqual([instanceId]);
    history.destroy();
  });
});

describe('deleteObjects of a main', () => {
  /**
   * The card with two instances at the root and a third inside a frame, which the deletion
   * cascades over.
   *
   * @param store - The store.
   * @returns The card's ids and the instances'.
   */
  function seedMainWithInstances(store: YjsDocumentStore) {
    const card = seedMainWithChildren(store);
    const first = placeInstance(store, card.mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const second = placeInstance(store, card.mainId, { x: 2000, y: 0, instanceId: 'inst-2' });
    createChild(store, newFrame('frame-f', null, { x: 3000, y: 0, width: 600, height: 600 }));
    const inside = placeInstance(store, card.mainId, {
      x: 3010,
      y: 10,
      parentId: 'frame-f',
      instanceId: 'inst-3',
    });
    return { ...card, first, second, inside };
  }

  it('retires the main, keeps its children, detaches outside instances and deletes inside ones', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId, boxId, captionId, photoId, first, second, inside } =
      seedMainWithInstances(store);
    const count = store.read().objects.size;
    const { result } = applyCommand(store, deleteObjectsCommand, { ids: [mainId, 'frame-f'] });
    const { deletedIds, retiredIds, detachedIds } = result as unknown as DeleteResult;
    expect(retiredIds).toEqual([mainId]);
    expect([...detachedIds].sort()).toEqual([first, second].sort());
    expect(deletedIds).toEqual(expect.arrayContaining(['frame-f', inside]));
    expect(deletedIds).not.toContain(mainId);
    expect(mustGet(store, mainId)).toMatchObject({
      type: 'component',
      retired: true,
      name: 'Card',
    });
    for (const id of [noteId, boxId, captionId, photoId]) {
      expect(mustGet(store, id).parentId).toBe(mainId);
    }
    for (const id of [first, second]) {
      expect(mustGet(store, id)).toMatchObject({ type: 'frame', name: 'Card' });
      expect(store.references.childrenOf(id).size).toBe(4);
    }
    expect(store.get(inside)).toBeUndefined();
    expect(store.get('frame-f' as ObjectId)).toBeUndefined();
    expect([...instancesOf(store, mainId)]).toEqual([]);
    // Two detached frames gained four children each; the frame and its instance went.
    expect(store.read().objects.size).toBe(count + 8 - 2);
  });

  it('is one undo step: the main is back unretired, with its instances', () => {
    const store = new YjsDocumentStore();
    const { mainId, first, second, inside } = seedMainWithInstances(store);
    const before = new Map<string, BoardObject>(store.read().objects);
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, deleteObjectsCommand, { ids: [mainId, 'frame-f'] });
    expect(history.undo()).toBe(true);
    expect(fieldOf(store, mainId, 'retired')).toBe(false);
    for (const id of [first, second, inside]) {
      expect(mustGet(store, id)).toMatchObject({ type: 'instance', mainId });
    }
    expect([...instancesOf(store, mainId)].sort()).toEqual([first, second, inside].sort());
    expect(new Map(store.read().objects)).toEqual(before);
    history.destroy();
  });
});
