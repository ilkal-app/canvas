// Board search's edges: parent chains that dangle or loop, an object that stops being
// searchable or leaves the snapshot, kana voicing marks, and the default limit.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import {
  ADA,
  BODY,
  createFixtureStore,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import type { BoardSnapshot, ChangeSet } from '../store/document-store.js';

import { foldForSearch, matchesQuery } from './fold-and-match.js';
import { DEFAULT_SEARCH_LIMIT, SearchIndex } from './search-index.js';

/**
 * A board with one sticky whose parent chain is replaced.
 *
 * @param parents - The sticky's ancestors as objects, nearest first.
 * @returns The board.
 */
function boardWithParents(parents: readonly BoardObject[]): BoardSnapshot {
  const board = createFixtureStore().read();
  const sticky = fixtureObject('sticky-idea', 'sticky');
  const objects = new Map<ObjectId, BoardObject>([
    [sticky.id, { ...sticky, parentId: parents[0]?.id ?? null }],
  ]);
  for (const parent of parents) objects.set(parent.id, parent);
  return { ...board, objects };
}

describe('SearchIndex edges', () => {
  it('gives no section for a dangling or looping parent chain', () => {
    const group = { ...fixtureObject('shape-box', 'shape'), type: 'group' } as BoardObject;
    const dangling = boardWithParents([{ ...group, parentId: id('missing') }]);
    expect(new SearchIndex(dangling).search('ship', {})[0]?.sectionName).toBeUndefined();
    const looping = boardWithParents([{ ...group, parentId: id('sticky-idea') }]);
    expect(new SearchIndex(looping).search('ship', {})[0]?.sectionName).toBeUndefined();
  });

  it('drops an object updated to blank text', () => {
    const store = createFixtureStore();
    const index = new SearchIndex(store.read());
    const changes: ChangeSet[] = [];
    store.subscribe((change) => changes.push(change));
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('sticky-idea'), {
        text: '   ',
        runs: [{ length: 3, style: BODY }],
      });
    });
    for (const change of changes) index.apply(change, store.read());
    expect(index.search('ship', {})).toEqual([]);
  });

  it('drops a changed id the board no longer has and skips entries missing from it', () => {
    const store = createFixtureStore();
    const index = new SearchIndex(store.read());
    const changes: ChangeSet[] = [];
    store.subscribe((change) => changes.push(change));
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('text-title'), { name: 'Title' });
    });
    const change = changes[0];
    if (change === undefined) throw new Error('expected one change set');
    const board = store.read();
    const objects = new Map(board.objects);
    objects.delete(id('text-title'));
    objects.delete(id('sticky-idea'));
    index.apply(change, { ...board, objects });
    expect(index.search('launch', {}).map((hit) => hit.id)).toEqual([id('frame-plan')]);
    expect(index.search('ship', {})).toEqual([]);
  });

  it('keeps the kana voicing marks, which change the word', () => {
    expect(foldForSearch('が')).toBe('が');
    expect(matchesQuery('がっこう', 'か')).toBe(false);
  });

  it('returns at most the default limit', () => {
    expect(DEFAULT_SEARCH_LIMIT).toBe(200);
  });
});
