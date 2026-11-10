// A nightly-size sync fuzz (seed 46) refused an honest placeObjects as `cross-page`. An
// object whose parent a peer deleted, before the reference repair re-roots it, is shown on the
// first page (`shownPageIdOf`), but the command read its page as unknown and so another than the
// frame's: dragging such an object into a frame on the page it is shown on was refused. Pages are
// now compared as they are shown.
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { createChild, newFrame, newSticky } from './__fixtures__/component-boards.js';
import { placeObjectsCommand } from './place-objects.js';

describe('placing an object whose parent is no longer on the board', () => {
  it('places it into a frame on the page it is shown on', () => {
    const store = new YjsDocumentStore();
    createChild(store, newFrame('target', null, { x: 0, y: 0, width: 600, height: 400 }));
    createChild(store, newSticky('orphan', null, { x: 700, y: 0, width: 100, height: 100 }));
    const { doc, objects } = internalsOf(store);
    doc.transact(() => {
      const map = objects.get('orphan') as Y.Map<unknown>;
      const placement = map.get('placement') as Record<string, unknown>;
      map.set('placement', { ...placement, parentId: 'gone', pageId: null });
    }, RELAY);
    expect(mustGet(store, 'orphan').parentId).toBe('gone');
    applyCommand(store, placeObjectsCommand, { ids: ['orphan'], parentId: 'target' });
    expect(mustGet(store, 'orphan').parentId).toBe('target');
    store.destroy();
  });
});
