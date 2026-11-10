// A nightly-size sync fuzz (seed 42) threw from an honest deleteObjects. Deleting a frame
// that holds a main retires the main and puts it on the root where it was on the board, through
// its ancestors' placements; a frame a peer left at an infinite x put the main at an infinite x,
// and that write, which validate never judged, threw inside the transaction. The command now
// judges the retired main too, and refuses the deletion naming its place.
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { createChild, newFrame, newSticky } from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';

/**
 * A frame `holder` holding a main `main-inside`, the frame's x as given.
 *
 * @param x - The frame's x, written raw as a peer leaves it.
 * @returns The store.
 */
function mainInFrame(x: number): YjsDocumentStore {
  const store = new YjsDocumentStore();
  createChild(store, newFrame('holder', null, { x: 0, y: 0, width: 600, height: 400 }));
  createChild(store, newSticky('inside-leaf', 'holder', { x: 20, y: 20, width: 160, height: 160 }));
  applyCommand(store, mustFindCommand('createComponent'), {
    ids: ['inside-leaf'],
    name: 'Inside',
    componentId: 'main-inside',
  });
  const { doc, objects } = internalsOf(store);
  doc.transact(() => {
    const frame = objects.get('holder') as Y.Map<unknown>;
    const placement = frame.get('placement') as Record<string, unknown>;
    frame.set('placement', { ...placement, x });
  }, RELAY);
  return store;
}

describe('deleting a frame that holds a main, the frame left at an infinite x', () => {
  it('refuses, naming the retired main’s place, and never throws', () => {
    const store = mainInFrame(Number.POSITIVE_INFINITY);
    expect(mustGet(store, 'main-inside').parentId).toBe('holder');
    const errors = expectRejected(store, mustFindCommand('deleteObjects'), { ids: ['holder'] });
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'invalid-object', objectId: 'main-inside', path: ['x'] }),
    );
    store.destroy();
  });

  it('retires the main onto the root where it was when the frame is placed', () => {
    const store = mainInFrame(100);
    applyCommand(store, mustFindCommand('deleteObjects'), { ids: ['holder'] });
    expect(mustGet(store, 'main-inside')).toMatchObject({ retired: true, parentId: null });
    store.destroy();
  });
});
