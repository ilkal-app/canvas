// Stored layout for an instance's content scale: an instance may store `scale` in its
// `size` group. A reader of the layout before refuses it (its instance schema is strict) and would
// erase it on a whole-group rewrite, so the layout rose. A board stored at the layout before opens
// unchanged, two current clients edit it (one scales an instance, the other names a shape) and
// converge, its first write stamps it with this build's layout, and a reader of the layouts before
// is then refused.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  buildChildIndex,
  resolveInstance,
  validateBoard,
  type InstanceObject,
} from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from '../commands/__fixtures__/component-boards.js';
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
  INSTANCE_SCALE_LAYOUT_VERSION,
  META_MAP_NAME,
  READABLE_LAYOUT_VERSIONS,
} from './document-meta.js';
import { canReadBoardLayout, readBoardLayout } from './layout-gate.js';

/** The schema version before instance scale. */
const SCHEMA_BEFORE = 21;

/** The layout before the gate, and the layouts a build before it reads. */
const PREVIOUS = INSTANCE_SCALE_LAYOUT_VERSION - 1;
const BEFORE_GATE = Array.from({ length: PREVIOUS }, (unused, index) => index + 1);

/**
 * The fixture board, with a main and an instance of it, as a build of the layout before left it.
 *
 * @returns The board's bytes and the instance's id.
 */
function previousLayoutBoard(): { readonly bytes: Uint8Array; readonly instanceId: string } {
  const source = createFixtureStore();
  seedLeafMain(source, 'badge', { x: 2000, y: 0 });
  const instanceId = placeInstance(source, 'badge', { x: 2400, y: 0 });
  const doc = new Y.Doc();
  doc.clientID = 61;
  Y.applyUpdate(doc, source.encodeState());
  doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, {
    schemaVersion: SCHEMA_BEFORE,
    layoutVersion: PREVIOUS,
  });
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  source.destroy();
  return { bytes, instanceId };
}

describe('the instance scale layout', () => {
  it('writes this layout or a later one and still reads every layout before it', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(INSTANCE_SCALE_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toEqual(
      expect.arrayContaining([...BEFORE_GATE, INSTANCE_SCALE_LAYOUT_VERSION]),
    );
  });

  for (const isReversed of [false, true]) {
    it(`opens a board of the layout before, converges on a scaled instance, and stamps it (reversed ids: ${String(isReversed)})`, () => {
      const { bytes, instanceId } = previousLayoutBoard();
      const a = new YjsDocumentStore({ clientId: isReversed ? 200 : 100 });
      const b = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      for (const store of [a, b]) store.applyUpdate(bytes, RELAY);
      expect(readBoardLayout(internalsOf(a).doc)).toEqual({
        isStamped: true,
        layoutVersion: PREVIOUS,
      });

      const placed = mustGet(a, instanceId) as InstanceObject;
      a.transact(ADA, (transaction) => {
        transaction.setObject({
          ...placed,
          width: placed.width * 2,
          height: placed.height * 2,
          scale: 2,
        });
      });
      applyCommand(b, renameObjectCommand, { id: 'shape-box', name: 'Card background' }, BOB);
      exchange(a, b);
      exchange(b, a);

      expect(a.read().objects).toEqual(b.read().objects);
      const scaled = mustGet(b, instanceId) as InstanceObject;
      expect(scaled).toMatchObject({ scale: 2, width: placed.width * 2 });
      const board = b.read();
      const leaf = resolveInstance(board, scaled, buildChildIndex(board)).objects[0];
      expect(leaf).toMatchObject({ width: 320, height: 320 });
      expect(mustGet(a, 'shape-box')).toMatchObject({ name: 'Card background' });
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
