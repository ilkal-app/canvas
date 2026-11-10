// Independent acceptance from, the pages design and the owner's overflow approval.
import { describe, expect, it } from 'vitest';

import { validateBoard } from '@canvas/schema';

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
  describe(`repairs and placement (reverse ids ${String(hasReversedIds)})`, () => {
    it('keeps an object moved onto a concurrently deleted page on the first page', () => {
      const [a, b] = pair(hasReversedIds);
      const target = add(a);
      exchange(a, b);
      apply(a, 'moveObjectsToPage', { ids: ['shape-box'], pageId: target });
      const moved = mustGet(a, 'shape-box');
      apply(b, 'deletePage', { pageId: target }, 29, BOB);
      exchange(a, b);
      exchange(b, a);
      expect(mustGet(a, 'shape-box')).toMatchObject({
        pageId: 'page-1',
        x: moved.x,
        y: moved.y,
        rotation: moved.rotation,
      });
      expect(a.read().objects).toEqual(b.read().objects);
      const before = a.encodeState();
      exchange(a, b);
      expect(a.encodeState()).toEqual(before);
      a.destroy();
      b.destroy();
    });
    it('keeps one whole placement when page move races a drag', () => {
      const [a, b] = pair(hasReversedIds);
      const target = add(a);
      exchange(a, b);
      apply(a, 'moveObjectsToPage', { ids: ['frame-plan'], pageId: target });
      apply(b, 'moveObjects', { moves: [{ id: 'frame-plan', by: { x: 73, y: 41 } }] }, 29, BOB);
      const choices = [mustGet(a, 'frame-plan'), mustGet(b, 'frame-plan')];
      exchange(a, b);
      expect(a.read().objects).toEqual(b.read().objects);
      expect(choices).toContainEqual(mustGet(a, 'frame-plan'));
      a.destroy();
      b.destroy();
    });
    it('deletes edited contents with their source page and undo restores them', () => {
      const [a, b] = pair(hasReversedIds);
      add(a);
      exchange(a, b);
      const history = createHistory(a, ADA.principalId);
      apply(a, 'deletePage', { pageId: 'page-1' });
      apply(
        b,
        'setStyle',
        { changes: [{ id: 'shape-box', style: { fill: [0, 1, 0, 1] } }] },
        29,
        BOB,
      );
      exchange(a, b);
      expect([...a.read().objects.values()].some((o) => o.id === 'shape-box')).toBe(false);
      history.undo();
      exchange(a, b);
      expect(mustGet(a, 'shape-box')).toMatchObject({ pageId: null, parentId: 'group-diagram' });
      expect(a.read().objects).toEqual(b.read().objects);
      history.destroy();
      a.destroy();
      b.destroy();
    });
    it.each(['renamePage', 'reorderPage'])(
      'ignores stray fields from %s concurrent with deletion',
      (operation) => {
        const [a, b] = pair(hasReversedIds);
        const target = add(a);
        exchange(a, b);
        apply(a, 'deletePage', { pageId: target });
        apply(
          b,
          operation,
          operation === 'renamePage'
            ? { pageId: target, name: 'Must not resurrect' }
            : { pageId: target, before: 'page-1' },
          29,
          BOB,
        );
        exchange(a, b);
        expect(pages(a)).toEqual(pages(b));
        expect(pages(a).some((p) => p.id === target)).toBe(false);
        a.destroy();
        b.destroy();
      },
    );
    it('falls back to virtual Page 1 after concurrent deletion of the only two pages', () => {
      const [a, b] = pair(hasReversedIds);
      const target = add(a);
      exchange(a, b);
      apply(a, 'deletePage', { pageId: target });
      apply(b, 'deletePage', { pageId: 'page-1' }, 29, BOB);
      exchange(a, b);
      expect(pages(a)).toMatchObject([{ id: 'page-1', name: 'Page 1' }]);
      expect(pages(a)).toEqual(pages(b));
      a.destroy();
      b.destroy();
    });
    it('merges rename and reorder independently', () => {
      const [a, b] = pair(hasReversedIds);
      const second = add(a, 11);
      const third = add(a, 12);
      exchange(a, b);
      apply(a, 'renamePage', { pageId: second, name: 'Renamed' });
      apply(b, 'reorderPage', { pageId: second, after: third }, 29, BOB);
      exchange(a, b);
      expect(pages(a).at(-1)).toMatchObject({ id: second, name: 'Renamed' });
      expect(pages(a)).toEqual(pages(b));
      a.destroy();
      b.destroy();
    });
    it('detaches connectors left behind by a target page move', () => {
      const [a, b] = pair(hasReversedIds);
      const target = add(a);
      exchange(a, b);
      expect(mustGet(a, 'connector-flow')).toMatchObject({
        to: { kind: 'object', objectId: 'shape-box' },
      });
      apply(a, 'moveObjectsToPage', { ids: ['shape-box'], pageId: target });
      exchange(a, b);
      expect(validateBoard(a.read())).toEqual([]);
      expect(a.read().objects).toEqual(b.read().objects);
      const originalTargets = [...b.read().objects.values()].filter((o) => o.type === 'connector');
      for (const object of originalTargets) {
        for (const end of [object.from, object.to]) {
          if (end.kind === 'object') expect(end.objectId).not.toBe('shape-box');
        }
      }
      a.destroy();
      b.destroy();
    });
  });
}
