import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import * as publicApi from '../index.js';

import type { DocumentStore } from './document-store.js';
import { internalsOf } from './internal.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from './yjs-document-store.js';

describe('internalsOf', () => {
  it("reaches a Yjs store's document and its objects map", () => {
    const store = new YjsDocumentStore();
    const { doc, objects } = internalsOf(store);
    expect(doc).toBeInstanceOf(Y.Doc);
    expect(objects).toBe(doc.getMap(OBJECTS_MAP_NAME));
  });

  it('gives each store its own document', () => {
    expect(internalsOf(new YjsDocumentStore()).doc).not.toBe(
      internalsOf(new YjsDocumentStore()).doc,
    );
  });

  it('refuses a store that is not a YjsDocumentStore', () => {
    const impostor = Object.create(YjsDocumentStore.prototype) as DocumentStore;
    expect(() => internalsOf(impostor)).toThrow(TypeError);
  });

  it('is not part of the public API, so the Y.Doc stays inside the package', () => {
    // A guard for the boundary README "Undo" describes: only `history/` reaches the document.
    expect(Object.keys(publicApi)).not.toContain('internalsOf');
    expect(Object.values(publicApi)).not.toContain(internalsOf);
  });
});
