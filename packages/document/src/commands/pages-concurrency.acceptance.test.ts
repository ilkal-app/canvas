// Independent acceptance from, the pages design and the owner's overflow approval.
import { describe, expect, it } from 'vitest';

import { applyTransform, objectToBoardTransform, validateBoard } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  exchange,
  RELAY,
} from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';
import { YjsDocumentStore as Store } from '../store/yjs-document-store.js';

import { applyCommand, testEnvironment } from './__fixtures__/command-fixtures.js';
import { mustGet } from './__fixtures__/command-fixtures.js';
import { findCommand } from './registry.js';

interface Page {
  readonly id: string;
  readonly name: string;
  readonly order: string;
}
const command = (name: string) => {
  const found = findCommand(name);
  expect(found, `the pages model requires ${name}`).toBeDefined();
  if (!found) throw new Error(`missing page command ${name}`);
  return found;
};
const pages = (store: YjsDocumentStore): readonly Page[] => {
  const board = store.read() as unknown as { pages: ReadonlyMap<string, Page> };
  expect(board.pages, 'snapshot must expose pages').toBeDefined();
  return [...board.pages.values()].sort((a, b) =>
    a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
};
const apply = (store: YjsDocumentStore, name: string, input: unknown, seed = 17, origin = ADA) =>
  applyCommand(store, command(name), input, origin, testEnvironment(seed)).result;
const add = (store: YjsDocumentStore, seed = 17): string => {
  const result = apply(store, 'addPage', {}, seed) as { pageId: string };
  expect(typeof result.pageId).toBe('string');
  return result.pageId;
};
const pair = (hasReversedIds: boolean): [YjsDocumentStore, YjsDocumentStore] => {
  const fixture = createFixtureStore();
  const a = new Store({ clientId: hasReversedIds ? 200 : 100 });
  const b = new Store({ clientId: hasReversedIds ? 100 : 200 });
  a.applyUpdate(fixture.encodeState(), RELAY);
  fixture.destroy();
  exchange(a, b);
  return [a, b];
};

for (const hasReversedIds of [false, true]) {
  describe(`remaining concurrent rows (${String(hasReversedIds)})`, () => {
    it('keeps a newly created object on a concurrently deleted destination', () => {
      const [a, b] = pair(hasReversedIds);
      const target = add(a);
      exchange(a, b);
      apply(a, 'deletePage', { pageId: target });
      const original = mustGet(b, 'frame-plan');
      b.transact(BOB, (tx) => {
        tx.setObject({
          ...original,
          id: 'new-frame',
          pageId: target,
        } as unknown as typeof original);
      });
      exchange(a, b);
      exchange(b, a);
      expect(mustGet(a, 'new-frame')).toMatchObject({
        pageId: 'page-1',
        x: original.x,
        y: original.y,
      });
      expect(a.read().objects).toEqual(b.read().objects);
      a.destroy();
      b.destroy();
    });
    it('source deletion beats a concurrent move out, and undo restores the source', () => {
      const [a, b] = pair(hasReversedIds);
      const target = add(a);
      exchange(a, b);
      const history = createHistory(b, BOB.principalId);
      apply(a, 'moveObjectsToPage', { ids: ['frame-plan'], pageId: target });
      apply(b, 'deletePage', { pageId: 'page-1' }, 29, BOB);
      exchange(a, b);
      expect([...a.read().objects.values()].some((o) => o.id === 'frame-plan')).toBe(false);
      expect(history.undo()).toBe(true);
      exchange(a, b);
      expect(mustGet(a, 'frame-plan')).toMatchObject({ pageId: 'page-1' });
      expect(a.read().objects).toEqual(b.read().objects);
      history.destroy();
      a.destroy();
      b.destroy();
    });
    it('keeps one whole placement for concurrent moves to different pages', () => {
      const [a, b] = pair(hasReversedIds);
      const second = add(a, 11);
      const third = add(a, 12);
      exchange(a, b);
      apply(a, 'moveObjectsToPage', { ids: ['frame-plan'], pageId: second });
      apply(b, 'moveObjectsToPage', { ids: ['frame-plan'], pageId: third }, 29, BOB);
      const choices = [mustGet(a, 'frame-plan'), mustGet(b, 'frame-plan')];
      exchange(a, b);
      expect(choices).toContainEqual(mustGet(a, 'frame-plan'));
      expect(a.read().objects).toEqual(b.read().objects);
      a.destroy();
      b.destroy();
    });
    it('inherits a moved frame page when another client reparents an object into it', () => {
      const [a, b] = pair(hasReversedIds);
      const target = add(a);
      exchange(a, b);
      apply(a, 'moveObjectsToPage', { ids: ['frame-plan'], pageId: target });
      apply(
        b,
        'moveObjects',
        { moves: [{ id: 'image-photo', by: { x: 0, y: 0 }, parentId: 'frame-plan' }] },
        29,
        BOB,
      );
      exchange(a, b);
      exchange(b, a);
      expect(mustGet(a, 'image-photo')).toMatchObject({ parentId: 'frame-plan', pageId: null });
      expect(mustGet(a, 'frame-plan')).toMatchObject({ pageId: target });
      expect(validateBoard(a.read())).toEqual([]);
      expect(a.read().objects).toEqual(b.read().objects);
      a.destroy();
      b.destroy();
    });
    it('detaches an end concurrently attached across the new page boundary', () => {
      const [a, b] = pair(hasReversedIds);
      const target = add(a);
      exchange(a, b);
      apply(a, 'moveObjectsToPage', { ids: ['shape-box'], pageId: target });
      apply(
        b,
        'setConnectorEnd',
        {
          id: 'connector-flow',
          end: 'from',
          target: { objectId: 'shape-box', anchor: { x: 0.5, y: 0.5 } },
        },
        29,
        BOB,
      );
      exchange(a, b);
      exchange(b, a);
      expect(mustGet(a, 'connector-flow')).toMatchObject({
        from: { kind: 'point' },
        to: { kind: 'point' },
      });
      expect(validateBoard(a.read())).toEqual([]);
      expect(a.read().objects).toEqual(b.read().objects);
      a.destroy();
      b.destroy();
    });
    it.each([false, true])('converges on simultaneous reorder (same page %s)', (isSamePage) => {
      const [a, b] = pair(hasReversedIds);
      const second = add(a, 11);
      const third = add(a, 12);
      exchange(a, b);
      apply(a, 'reorderPage', { pageId: second, before: 'page-1' });
      apply(b, 'reorderPage', { pageId: isSamePage ? second : third, before: 'page-1' }, 29, BOB);
      exchange(a, b);
      expect(pages(a)).toEqual(pages(b));
      expect(pages(a)).toHaveLength(3);
      a.destroy();
      b.destroy();
    });
    it('lifting a nested child preserves its world transform and undo restores nesting', () => {
      const [a, b] = pair(hasReversedIds);
      const target = add(a);
      const before = mustGet(a, 'shape-box');
      const transform = objectToBoardTransform(a.read(), before);
      const origin = applyTransform(transform, { x: 0, y: 0 });
      const history = createHistory(a, ADA.principalId);
      apply(a, 'moveObjectsToPage', { ids: ['shape-box'], pageId: target });
      const moved = mustGet(a, 'shape-box');
      expect(moved).toMatchObject({ parentId: null, pageId: target });
      expect(moved.x).toBeCloseTo(origin.x, 10);
      expect(moved.y).toBeCloseTo(origin.y, 10);
      expect(moved.rotation).toBeCloseTo(0.25, 10);
      expect(history.undo()).toBe(true);
      expect(mustGet(a, 'shape-box')).toEqual(before);
      history.destroy();
      a.destroy();
      b.destroy();
    });
  });
}

describe('copied and moved references', () => {
  it('duplicates a page with only fresh internal object references', () => {
    const store = createFixtureStore();
    const original = new Set(store.read().objects.keys());
    const result = apply(store, 'duplicatePage', { pageId: 'page-1' }, 78) as { pageId: string };
    const copied = [...store.read().objects.values()].filter((object) => !original.has(object.id));
    expect(copied).toHaveLength(original.size);
    const copiedIds = new Set(copied.map((object) => object.id));
    for (const object of copied) {
      if (object.parentId !== null) expect(copiedIds.has(object.parentId)).toBe(true);
      else expect(object).toMatchObject({ pageId: result.pageId });
      if (object.type === 'connector')
        for (const end of [object.from, object.to])
          if (end.kind === 'object') expect(copiedIds.has(end.objectId)).toBe(true);
      if (object.type === 'comment' && object.anchor.kind === 'object')
        expect(copiedIds.has(object.anchor.objectId)).toBe(true);
    }
    expect(validateBoard(store.read())).toEqual([]);
    store.destroy();
  });
  it('moves an anchored comment with its target and undoes both together', () => {
    const store = createFixtureStore();
    const target = add(store);
    const before = [...store.read().objects.values()];
    const history = createHistory(store, ADA.principalId);
    const comment = before.find(
      (object) =>
        object.type === 'comment' &&
        object.anchor.kind === 'object' &&
        object.anchor.objectId === 'image-photo',
    );
    expect(comment).toBeDefined();
    apply(store, 'moveObjectsToPage', { ids: ['image-photo'], pageId: target });
    expect(
      [...store.read().objects.values()].find((object) => object.id === comment?.id),
    ).toMatchObject({ pageId: target });
    expect(validateBoard(store.read())).toEqual([]);
    expect(history.undo()).toBe(true);
    expect([...store.read().objects.values()]).toEqual(before);
    history.destroy();
    store.destroy();
  });
});
