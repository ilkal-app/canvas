// The index follows store change sets, page ancestry, grouping, and limits.
import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_ID, type ObjectId, type PageId } from '@canvas/schema';

import {
  ADA,
  BODY,
  createFixtureStore,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import type { BoardSnapshot, ChangeSet } from '../store/document-store.js';

import { SearchIndex } from './search-index.js';

const PAGE_TWO = 'page-2' as PageId;

function hitIds(index: SearchIndex, query: string, pageId?: PageId): readonly ObjectId[] {
  return index
    .search(query, pageId === undefined ? {} : { pageId })
    .map((hit: { readonly id: ObjectId }) => hit.id);
}

describe('SearchIndex', () => {
  it('indexes the initial board by group, reports the nearest frame ancestor, and keeps stable order', () => {
    const store = createFixtureStore();
    const board = store.read();
    const index = new SearchIndex(board);
    const first = index.search('plan', {});
    expect(first.map((hit: { readonly group: string }) => hit.group)).toEqual(['text', 'sections']);
    expect(first.map((hit: { readonly id: ObjectId }) => hit.id)).toEqual([
      id('text-title'),
      id('frame-plan'),
    ]);
    expect(index.search('plan', {})).toEqual(first);
    expect(index.search('plan', { limit: 1 })).toEqual(first.slice(0, 1));
    expect(index.search('plan', { limit: 0 })).toEqual([]);
    expect(index.search('plan', { pageId: DEFAULT_PAGE_ID })).toEqual(first);
    expect(first[0]).toEqual({
      id: id('text-title'),
      group: 'text',
      text: 'Launch plan v2',
      pageId: DEFAULT_PAGE_ID,
      sectionName: 'Launch plan',
    });
    expect(first[1]?.sectionName).toBeUndefined();
    expect(index.search('ship', {})[0]).toMatchObject({
      id: id('sticky-idea'),
      group: 'stickies',
      sectionName: 'Launch plan',
    });
    expect(index.search('api', {})[0]?.sectionName).toBe('Launch plan');
    expect(index.search('becomes', {})[0]?.sectionName).toBeUndefined();
    expect(index.search('photo', {})).toEqual([]);
  });

  it('orders stickies before text before sections and names the nearest nested frame', () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('sticky-idea'), {
        text: 'Launch note',
        runs: [{ length: 11, style: BODY }],
      });
      transaction.setObject({
        ...fixtureObject('frame-plan', 'frame'),
        id: id('frame-inner'),
        parentId: id('frame-plan'),
        pageId: null,
        name: 'Inner section',
      });
      transaction.patchObject(id('text-title'), { parentId: id('frame-inner') });
    });
    const index = new SearchIndex(store.read());
    expect(hitIds(index, 'launch')).toEqual([
      id('sticky-idea'),
      id('text-title'),
      id('frame-plan'),
    ]);
    expect(index.search('launch', {})[1]?.sectionName).toBe('Inner section');
    expect(index.search('inner', {})[0]?.sectionName).toBe('Launch plan');
  });

  it('applies real created, updated, and deleted change sets without mutating earlier snapshots', () => {
    const store = createFixtureStore();
    const initial = store.read();
    const index = new SearchIndex(initial);
    const changes: ChangeSet[] = [];
    store.subscribe((change) => changes.push(change));

    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('sticky-idea'), {
        text: 'Fresh sprint',
        runs: [{ length: 12, style: BODY }],
      });
      transaction.setObject({
        ...fixtureObject('text-title', 'text'),
        id: id('text-new'),
        text: 'Fresh draft',
        runs: [{ length: 11, style: BODY }],
      });
      transaction.deleteObject(id('shape-box'));
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]?.created).toContain(id('text-new'));
    expect(changes[0]?.updated).toContain(id('sticky-idea'));
    expect(changes[0]?.deleted).toContain(id('shape-box'));
    const after = store.read();
    const change = changes[0];
    if (change === undefined) throw new Error('expected one change set');
    const changeBefore = structuredClone(change);
    index.apply(change, after);
    expect(hitIds(index, 'fresh')).toEqual([id('sticky-idea'), id('text-new')]);
    expect(hitIds(index, 'ship')).toEqual([]);
    expect(hitIds(index, 'api')).toEqual([]);
    expect(initial.objects.get(id('sticky-idea'))).toMatchObject({ text: 'Ship the beta 😀' });
    expect(after.objects.get(id('sticky-idea'))).toMatchObject({ text: 'Fresh sprint' });
    expect(change).toEqual(changeBefore);
  });

  it('uses a root ancestor page after a move and the nearest frame name after a rename', () => {
    const store = createFixtureStore();
    const changes: ChangeSet[] = [];
    store.subscribe((change) => changes.push(change));
    const index = new SearchIndex(store.read());

    store.transact(ADA, (transaction) => {
      transaction.setPage(
        { id: PAGE_TWO, name: 'Second page', order: 'a1' },
        { createdBy: ADA.principalId, createdAt: 1_760_000_000_000 },
      );
      transaction.patchObject(id('frame-plan'), { pageId: PAGE_TWO, name: 'Moved section' });
    });
    for (const change of changes) index.apply(change, store.read());

    expect(hitIds(index, 'ship', DEFAULT_PAGE_ID)).toEqual([]);
    expect(hitIds(index, 'ship', PAGE_TWO)).toEqual([id('sticky-idea')]);
    expect(index.search('ship', { pageId: PAGE_TWO })[0]).toMatchObject({
      pageId: PAGE_TWO,
      sectionName: 'Moved section',
    });
    expect(index.search('moved', { pageId: PAGE_TWO })).toEqual([
      {
        id: id('frame-plan'),
        group: 'sections',
        text: 'Moved section',
        pageId: PAGE_TWO,
        sectionName: undefined,
      },
    ]);
    expect(hitIds(index, 'photo', PAGE_TWO)).toEqual([]);
  });

  it('reads only changed ids during apply, leaving untouched objects unvisited', () => {
    const store = createFixtureStore();
    const index = new SearchIndex(store.read());
    const changes: ChangeSet[] = [];
    store.subscribe((change) => changes.push(change));
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('connector-flow'), {
        label: { text: 'handoff', runs: [{ length: 7, style: BODY }] },
      });
    });
    const board = store.read();
    const guardedObjects = new Proxy(board.objects, {
      get(target, property) {
        if (property === 'get') {
          return (objectId: ObjectId) => {
            if (objectId !== id('connector-flow'))
              throw new Error(`untouched object read: ${objectId}`);
            return target.get(objectId);
          };
        }
        if (
          property === 'values' ||
          property === 'entries' ||
          property === 'keys' ||
          property === 'forEach' ||
          property === Symbol.iterator
        ) {
          throw new Error('all objects scanned during apply');
        }
        if (property === 'has') return target.has.bind(target);
        return Reflect.get(target, property, target) as unknown;
      },
    });
    const guardedBoard: BoardSnapshot = { ...board, objects: guardedObjects };
    const change = changes[0];
    if (change === undefined) throw new Error('expected one change set');
    expect(() => {
      index.apply(change, guardedBoard);
    }).not.toThrow();
    expect(hitIds(index, 'handoff')).toEqual([id('connector-flow')]);
    expect(hitIds(index, 'becomes')).toEqual([]);
  });
});
