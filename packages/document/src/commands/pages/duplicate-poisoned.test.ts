import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { createFixtureStore, RELAY } from '../../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../../store/internal.js';
import { expectRejected } from '../__fixtures__/command-fixtures.js';

import { duplicatePageCommand } from './duplicate-page.js';

// A peer can leave a field invalid (remote updates are not validated); a copy is a new object,
// judged whole, so duplicating its page is refused as `invalid-object` naming the source object
// and field, never thrown (found by the sync fuzz with's new draws).

describe('duplicatePage over a field a peer left invalid', () => {
  it('refuses the copy naming the source and field', () => {
    const store = createFixtureStore();
    const { doc, objects } = internalsOf(store);
    // A peer's raw write, as a remote update lands it.
    doc.transact(() => {
      const image = objects.get('image-photo') as Y.Map<unknown>;
      const style = image.get('style') as Record<string, unknown>;
      image.set('style', { ...style, opacity: -1 });
    }, RELAY);
    const errors = expectRejected(store, duplicatePageCommand, { pageId: 'page-1' });
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'invalid-object',
        objectId: 'image-photo',
        path: ['opacity'],
      }),
    ]);
    store.destroy();
  });

  it('names the source and field when the copy is refused past what a renderer draws', () => {
    const store = createFixtureStore();
    const { doc, objects } = internalsOf(store);
    // A peer's raw write of a size no renderer draws, which the schema itself takes.
    doc.transact(() => {
      const box = objects.get('shape-box') as Y.Map<unknown>;
      const size = box.get('size') as Record<string, unknown>;
      box.set('size', { ...size, height: 1e12 });
    }, RELAY);
    const errors = expectRejected(store, duplicatePageCommand, { pageId: 'page-1' });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'invalid-object', objectId: 'shape-box', path: ['height'] }),
    ]);
    store.destroy();
  });
});
