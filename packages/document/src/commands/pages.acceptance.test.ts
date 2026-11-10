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

import { applyCommand, expectRejected, testEnvironment } from './__fixtures__/command-fixtures.js';
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

describe('page commands', () => {
  it('reads virtual Page 1 without writing and refuses its deletion atomically', () => {
    const store = createFixtureStore();
    const before = store.encodeState();
    expect(pages(store)).toMatchObject([{ id: 'page-1', name: 'Page 1' }]);
    expect(store.encodeState()).toEqual(before);
    expect(expectRejected(store, command('deletePage'), { pageId: 'page-1' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'last-page' })]),
    );
    store.destroy();
  });
  it('adds and renames with independent undo steps and rejects overlong names', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA.principalId);
    const pageId = add(store);
    expect(pages(store).map((p) => p.name)).toEqual(['Page 1', 'Page 2']);
    apply(store, 'renamePage', { pageId, name: 'Other' });
    expect(history.undo()).toBe(true);
    expect(pages(store).map((p) => p.name)).toEqual(['Page 1', 'Page 2']);
    expect(history.undo()).toBe(true);
    expect(pages(store)).toHaveLength(1);
    expect(history.redo()).toBe(true);
    expect(pages(store)).toHaveLength(2);
    expectRejected(store, command('renamePage'), { pageId, name: 'x'.repeat(201) });
    history.destroy();
    store.destroy();
  });
  it('moves a root then restores its placement with one undo', () => {
    const store = createFixtureStore();
    const pageId = add(store);
    const history = createHistory(store, ADA.principalId);
    const before = [...store.read().objects.values()].find((o) => o.id === 'frame-plan');
    apply(store, 'moveObjectsToPage', { ids: ['frame-plan'], pageId });
    const moved = [...store.read().objects.values()].find((o) => o.id === 'frame-plan');
    expect(moved).toMatchObject({
      pageId,
      parentId: null,
      x: before?.x,
      y: before?.y,
      rotation: before?.rotation,
    });
    expect(history.undo()).toBe(true);
    expect([...store.read().objects.values()].find((o) => o.id === 'frame-plan')).toEqual(before);
    history.destroy();
    store.destroy();
  });
  it('deletes a populated page and restores its objects in one undo', () => {
    const store = createFixtureStore();
    add(store);
    const history = createHistory(store, ADA.principalId);
    const before = [...store.read().objects.values()];
    apply(store, 'deletePage', { pageId: 'page-1' });
    expect(store.read().objects.size).toBe(0);
    expect(history.undo()).toBe(true);
    expect([...store.read().objects.values()]).toEqual(before);
    expect(pages(store)).toHaveLength(2);
    history.destroy();
    store.destroy();
  });
});

for (const hasReversedIds of [false, true]) {
  describe(`concurrent pages (reverse ids: ${String(hasReversedIds)})`, () => {
    it('keeps a virtual-page rename while another client materializes it', () => {
      const [a, b] = pair(hasReversedIds);
      apply(a, 'renamePage', { pageId: 'page-1', name: 'Kept' });
      add(b, 29);
      exchange(a, b);
      expect(pages(a)).toEqual(pages(b));
      expect(pages(a)[0]?.name).toBe('Kept');
      a.destroy();
      b.destroy();
    });
    it('does not undo page creation after a peer renames it', () => {
      const [a, b] = pair(hasReversedIds);
      const history = createHistory(a, ADA.principalId);
      const pageId = add(a);
      exchange(a, b);
      apply(b, 'renamePage', { pageId, name: 'Peer work' }, 29, BOB);
      exchange(a, b);
      const before = pages(a);
      history.undo();
      expect(pages(a)).toEqual(before);
      expect(pages(a).find((p) => p.id === pageId)?.name).toBe('Peer work');
      history.destroy();
      a.destroy();
      b.destroy();
    });
    for (const operations of [
      ['addPage', 'addPage'],
      ['addPage', 'duplicatePage'],
      ['duplicatePage', 'duplicatePage'],
    ] as const) {
      for (const hasReversedDelivery of [false, true]) {
        it(`keeps overflow for ${operations.join('/')} (reverse delivery: ${String(hasReversedDelivery)})`, () => {
          const [a, b] = pair(hasReversedIds);
          for (let i = 0; i < 98; i++) add(a, 1000 + i);
          exchange(a, b);
          expect(pages(a)).toHaveLength(99);
          const originalCount = a.read().objects.size;
          apply(a, operations[0], operations[0] === 'addPage' ? {} : { pageId: 'page-1' }, 8001);
          apply(
            b,
            operations[1],
            operations[1] === 'addPage' ? {} : { pageId: 'page-1' },
            8002,
            BOB,
          );
          const expectedObjects =
            originalCount * (1 + operations.filter((op) => op === 'duplicatePage').length);
          if (hasReversedDelivery) exchange(b, a);
          else exchange(a, b);
          expect(pages(a)).toHaveLength(101);
          expect(pages(a)).toEqual(pages(b));
          expect(a.read().objects.size).toBe(expectedObjects);
          expect(a.read().objects).toEqual(b.read().objects);
          expect(validateBoard(a.read())).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ code: 'page-count', severity: 'notice' }),
            ]),
          );
          for (const count of [101, 100]) {
            expect(pages(a)).toHaveLength(count);
            for (const name of ['addPage', 'duplicatePage']) {
              const input = name === 'addPage' ? {} : { pageId: 'page-1' };
              expect(expectRejected(a, command(name), input)).toEqual(
                expect.arrayContaining([expect.objectContaining({ code: 'too-many-pages' })]),
              );
            }
            const last = pages(a).at(-1);
            apply(a, 'deletePage', { pageId: last?.id });
          }
          expect(pages(a)).toHaveLength(99);
          add(a, 9000);
          expect(pages(a)).toHaveLength(100);
          a.destroy();
          b.destroy();
        });
      }
    }
  });
}
