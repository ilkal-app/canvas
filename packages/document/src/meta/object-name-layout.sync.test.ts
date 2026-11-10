// Stored layout for layer names: any object's optional `name` lives in its style group,
// as a frame's and a main's already did. A reader of the layout before refuses a name on any other
// type (objects are strict) and rewrites the whole group on a restyle, so the layout rose. A board
// stored at the layout before opens unchanged, two current clients edit it (one names a shape, the
// other names a group, which gains a style key) and converge, its first write stamps it with this
// build's layout, and a reader of the layouts before is then refused.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { OBJECT_NAME_VERSION, validateBoard } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { renameObjectCommand } from '../commands/rename-object.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  exchange,
  RELAY,
} from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  DOCUMENT_LAYOUT_VERSION,
  DOCUMENT_META_KEY,
  META_MAP_NAME,
  OBJECT_NAME_LAYOUT_VERSION,
  READABLE_LAYOUT_VERSIONS,
} from './document-meta.js';
import { canReadBoardLayout, readBoardLayout } from './layout-gate.js';

/** The layout before the gate, and the layouts a build before it reads. */
const PREVIOUS = OBJECT_NAME_LAYOUT_VERSION - 1;
const BEFORE_GATE = Array.from({ length: PREVIOUS }, (unused, index) => index + 1);

/**
 * The fixture board as a build of the layout before left it, stamped with that layout and the
 * schema before names.
 *
 * @returns The board's bytes.
 */
function previousLayoutBoard(): Uint8Array {
  const source = createFixtureStore();
  const doc = new Y.Doc();
  doc.clientID = 61;
  Y.applyUpdate(doc, source.encodeState());
  doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, {
    schemaVersion: OBJECT_NAME_VERSION - 1,
    layoutVersion: PREVIOUS,
  });
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  source.destroy();
  return bytes;
}

describe('the layer name layout', () => {
  it('writes this layout or a later one and still reads every layout before it', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(OBJECT_NAME_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toEqual(
      expect.arrayContaining([...BEFORE_GATE, OBJECT_NAME_LAYOUT_VERSION]),
    );
  });

  for (const isReversed of [false, true]) {
    it(`opens a board of the layout before, converges on two names, and stamps it (reversed ids: ${String(isReversed)})`, () => {
      const bytes = previousLayoutBoard();
      const a = new YjsDocumentStore({ clientId: isReversed ? 200 : 100 });
      const b = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      for (const store of [a, b]) store.applyUpdate(bytes, RELAY);
      expect(readBoardLayout(internalsOf(a).doc)).toEqual({
        isStamped: true,
        layoutVersion: PREVIOUS,
      });

      applyCommand(a, renameObjectCommand, { id: 'shape-box', name: 'Card background' }, ADA);
      applyCommand(b, renameObjectCommand, { id: 'group-diagram', name: 'Diagram' }, BOB);
      exchange(a, b);
      exchange(b, a);

      expect(a.read().objects).toEqual(b.read().objects);
      expect(mustGet(a, 'shape-box')).toMatchObject({ name: 'Card background' });
      expect(mustGet(b, 'group-diagram')).toMatchObject({ name: 'Diagram' });
      expect(validateBoard(a.read())).toEqual([]);
      for (const store of [a, b]) {
        const layout = readBoardLayout(internalsOf(store).doc);
        expect(layout).toEqual({ isStamped: true, layoutVersion: DOCUMENT_LAYOUT_VERSION });
        expect(canReadBoardLayout(layout, BEFORE_GATE)).toBe(false);
        expect(canReadBoardLayout(layout, READABLE_LAYOUT_VERSIONS)).toBe(true);
      }
      a.destroy();
      b.destroy();
    });
  }
});
