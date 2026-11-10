import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { PageId, PrincipalId } from '@canvas/schema';

import { DocumentWriteError } from '../store/document-write-error.js';

import { firstPageIn, hasStoredPages, pageKey, parsePageKey, readPages } from './page-map.js';
import { erasePage, writePage } from './page-writes.js';

const CREATION = { createdBy: 'user:ada' as PrincipalId, createdAt: 5 };

/**
 * A pages map in a document of its own.
 *
 * @returns The map.
 */
function pagesMap(): Y.Map<unknown> {
  return new Y.Doc().getMap('pages');
}

describe('the pages map (layout 4)', () => {
  it('parses page keys and refuses other keys', () => {
    expect(parsePageKey('p-1.order')).toEqual({ pageId: 'p-1', field: 'order' });
    for (const key of ['p', 'p.extra', 'bad id.name', '.name']) {
      expect(parsePageKey(key)).toBeUndefined();
    }
  });

  it('reads the virtual Page 1 for an empty map, and ignores stray and malformed keys', () => {
    const map = pagesMap();
    expect([...readPages(map).values()]).toEqual([{ id: 'page-1', name: 'Page 1', order: 'a0' }]);
    map.doc?.transact(() => {
      map.set('gone.name', 'Stray');
      map.set('x.identity', { id: 'other' });
      map.set('junk', 1);
    });
    expect(hasStoredPages(map)).toBe(false);
    expect([...readPages(map).keys()]).toEqual(['page-1']);
    expect(firstPageIn(new Map())).toBe('page-1');
  });

  it('materialises Page 1 without a default name or order, and reads unreadable values', () => {
    const map = pagesMap();
    map.doc?.transact(() => {
      writePage(map, { id: 'p2' as PageId, name: 'Two', order: 'a1' }, CREATION);
    });
    expect([...map.keys()].sort()).toEqual([
      'p2.identity',
      'p2.name',
      'p2.order',
      'page-1.identity',
    ]);
    expect(map.get('p2.identity')).toEqual({ id: 'p2', createdBy: 'user:ada', createdAt: 5 });
    map.doc?.transact(() => {
      map.set(pageKey('p2', 'name'), 7);
      map.set(pageKey('p2', 'order'), 'not a key');
    });
    expect(readPages(map).get('p2' as PageId)).toEqual({ id: 'p2', name: '', order: 'a0' });
  });

  it('refuses an invalid page and erases every key of a page', () => {
    const map = pagesMap();
    expect(() =>
      map.doc?.transact(() => {
        writePage(map, { id: 'p' as PageId, name: 'x'.repeat(201), order: 'a0' }, CREATION);
      }),
    ).toThrow(DocumentWriteError);
    map.doc?.transact(() => {
      writePage(map, { id: 'p' as PageId, name: 'P', order: 'a0' }, CREATION);
    });
    map.doc?.transact(() => {
      expect(erasePage(map, 'p' as PageId)).toBe(true);
      expect(erasePage(map, 'p' as PageId)).toBe(false);
    });
    expect([...readPages(map).keys()]).toEqual(['page-1']);
  });
});
