// Independent acceptance for stored layout 9 (written for layout 7; layouts 7 and 8
// went to image paint, and auto-layout, which landed first).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { SCHEMA_VERSION } from '@canvas/schema';

import { createChild, newSticky } from '../commands/__fixtures__/component-boards.js';
import {
  DOCUMENT_LAYOUT_VERSION,
  DOCUMENT_META_KEY,
  META_MAP_NAME,
  READABLE_LAYOUT_VERSIONS,
} from '../meta/document-meta.js';
import { RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

describe('layout 9', () => {
  it('writes layout 9 or a later one, while reading layouts 1 through 9', () => {
    // Superseded by's variants layout: layout 9 is no longer the newest.
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(9);
    expect([...READABLE_LAYOUT_VERSIONS]).toEqual(
      expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    );
  });

  it('opens a layout-8 board unchanged and stamps this build’s layout on its first write', () => {
    const old = new YjsDocumentStore();
    createChild(old, newSticky('old-note', null, { x: 0, y: 0, width: 100, height: 100 }));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, old.encodeState());
    doc
      .getMap(META_MAP_NAME)
      .set(DOCUMENT_META_KEY, { schemaVersion: SCHEMA_VERSION, layoutVersion: 8 });
    const current = new YjsDocumentStore();
    current.applyUpdate(Y.encodeStateAsUpdate(doc), RELAY);
    const before = current.get('old-note' as never);
    expect(before).toBeDefined();
    createChild(current, newSticky('new-note', null, { x: 200, y: 0, width: 100, height: 100 }));
    const written = new Y.Doc();
    Y.applyUpdate(written, current.encodeState());
    expect(written.getMap(META_MAP_NAME).get(DOCUMENT_META_KEY)).toMatchObject({
      layoutVersion: DOCUMENT_LAYOUT_VERSION,
    });
    expect(current.get('old-note' as never)).toEqual(before);
    written.destroy();
    current.destroy();
    doc.destroy();
    old.destroy();
  });
});
