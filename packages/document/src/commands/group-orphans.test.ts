// Objects whose parent a peer deleted, before the reference repair
// re-roots them, are drawn on the root and stay selectable, and grouping them made the group in
// the missing parent, refused as `missing-parent`. A group of such orphans is made on the root,
// where they are drawn.
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { createFixtureStore, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { groupCommand } from './group.js';

describe('grouping objects whose parent is no longer on the board', () => {
  it('makes the group on the root, where they are drawn, with them in it', () => {
    const store = createFixtureStore();
    const { doc, objects } = internalsOf(store);
    doc.transact(() => {
      for (const id of ['sticky-idea', 'shape-box']) {
        const map = objects.get(id) as Y.Map<unknown>;
        const placement = map.get('placement') as Record<string, unknown>;
        map.set('placement', { ...placement, parentId: 'gone', pageId: null });
      }
    }, RELAY);
    expect(mustGet(store, 'sticky-idea').parentId).toBe('gone');
    const { result } = applyCommand(store, groupCommand, { ids: ['sticky-idea', 'shape-box'] });
    const { groupId } = result as { readonly groupId: string };
    expect(mustGet(store, groupId).parentId).toBeNull();
    expect(mustGet(store, 'sticky-idea').parentId).toBe(groupId);
    expect(mustGet(store, 'shape-box').parentId).toBe(groupId);
    store.destroy();
  });
});
