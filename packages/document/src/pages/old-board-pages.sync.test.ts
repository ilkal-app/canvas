import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { validateBoard, type BoardObject } from '@canvas/schema';

import { toYjs } from '../codec/object-codec.js';
import {
  applyCommand,
  mustGet,
  testEnvironment,
} from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { addPageCommand } from '../commands/pages/add-page.js';
import { moveObjectsToPageCommand } from '../commands/pages/move-to-page.js';
import { renamePageCommand } from '../commands/pages/rename-page.js';
import { DOCUMENT_LAYOUT_VERSION } from '../meta/document-meta.js';
import { DOCUMENT_META_KEY, META_MAP_NAME } from '../meta/document-meta.js';
import { readBoardLayout } from '../meta/layout-gate.js';
import { BOB, exchange, fixtureBoard, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../store/yjs-document-store.js';

/**
 * The fixture board as a layout 3 build stored it: stamped 3, no placement names a page, no
 * pages map.
 *
 * @returns The board's bytes.
 */
function layoutThreeBoard(): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = 50;
  doc.transact(() => {
    doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, { schemaVersion: 2, layoutVersion: 3 });
    const objects = doc.getMap(OBJECTS_MAP_NAME);
    for (const object of fixtureBoard().objects.values()) {
      const legacy: Partial<BoardObject> = { ...object };
      delete legacy.pageId;
      objects.set(object.id, toYjs(legacy as BoardObject));
    }
  });
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}

describe('a layout 3 board edited by two current-layout clients', () => {
  for (const isReversed of [false, true]) {
    it(`reads one Page 1 and converges on concurrent page edits (reversed ids: ${String(isReversed)})`, () => {
      const a = new YjsDocumentStore({ clientId: isReversed ? 200 : 100 });
      const b = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      for (const store of [a, b]) store.applyUpdate(layoutThreeBoard(), RELAY);
      expect([...a.read().pages.keys()]).toEqual(['page-1']);
      expect(mustGet(a, 'frame-plan').pageId).toBe('page-1');
      expect(mustGet(a, 'shape-box').pageId).toBeNull();
      const pageId = applyCommand(a, addPageCommand, {}).result.pageId;
      applyCommand(a, moveObjectsToPageCommand, { ids: ['frame-plan'], pageId });
      applyCommand(b, renamePageCommand, { pageId: 'page-1', name: 'Old' }, BOB);
      const drag = { moves: [{ id: 'image-photo', by: { x: 10, y: 0 } }] };
      applyCommand(b, moveObjectsCommand, drag, BOB, testEnvironment(29));
      exchange(a, b);
      exchange(b, a);
      expect(a.read().objects).toEqual(b.read().objects);
      expect([...a.read().pages.values()].map(({ name }) => name)).toEqual(['Old', 'Page 2']);
      expect(mustGet(a, 'frame-plan').pageId).toBe(pageId);
      expect(mustGet(b, 'image-photo')).toMatchObject({ pageId: 'page-1' });
      expect(validateBoard(a.read())).toEqual([]);
      expect(readBoardLayout(internalsOf(a).doc)).toEqual({
        isStamped: true,
        layoutVersion: DOCUMENT_LAYOUT_VERSION,
      });
      a.destroy();
      b.destroy();
    });
  }
});
