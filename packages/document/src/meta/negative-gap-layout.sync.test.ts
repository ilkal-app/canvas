// Stored layout for a negative gap: an auto-layout's gap may be negative, overlapping its
// children. A reader of the layout before floors the gap at 0 and refuses a negative one, so the
// layout rose. A board stored at the layout before opens unchanged, two current clients edit it
// (one lays a frame out with a gap of -4, the other names a shape) and converge, its first write
// stamps it with this build's layout, and a reader of the layouts before is then refused.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { validateBoard } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { renameObjectCommand } from '../commands/rename-object.js';
import { setAutoLayoutCommand } from '../commands/set-auto-layout.js';
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
  NEGATIVE_GAP_LAYOUT_VERSION,
  READABLE_LAYOUT_VERSIONS,
} from './document-meta.js';
import { canReadBoardLayout, readBoardLayout } from './layout-gate.js';

/** The schema version before negative gaps ('s frame radius). */
const SCHEMA_BEFORE = 20;

/** A row overlapping its children by 4, hugging both ways. */
const OVERLAPPING = {
  direction: 'row',
  gap: -4,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
} as const;

/** The layout before the gate, and the layouts a build before it reads. */
const PREVIOUS = NEGATIVE_GAP_LAYOUT_VERSION - 1;
const BEFORE_GATE = Array.from({ length: PREVIOUS }, (unused, index) => index + 1);

/**
 * The fixture board as a build of the layout before left it, stamped with that layout and the
 * schema before negative gaps.
 *
 * @returns The board's bytes.
 */
function previousLayoutBoard(): Uint8Array {
  const source = createFixtureStore();
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
  return bytes;
}

describe('the negative gap layout', () => {
  it('writes this layout or a later one and still reads every layout before it', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(NEGATIVE_GAP_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toEqual(
      expect.arrayContaining([...BEFORE_GATE, NEGATIVE_GAP_LAYOUT_VERSION]),
    );
  });

  for (const isReversed of [false, true]) {
    it(`opens a board of the layout before, converges on a negative gap, and stamps it (reversed ids: ${String(isReversed)})`, () => {
      const bytes = previousLayoutBoard();
      const a = new YjsDocumentStore({ clientId: isReversed ? 200 : 100 });
      const b = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      for (const store of [a, b]) store.applyUpdate(bytes, RELAY);
      expect(readBoardLayout(internalsOf(a).doc)).toEqual({
        isStamped: true,
        layoutVersion: PREVIOUS,
      });

      applyCommand(a, setAutoLayoutCommand, { ids: ['frame-plan'], autoLayout: OVERLAPPING }, ADA);
      applyCommand(b, renameObjectCommand, { id: 'shape-box', name: 'Card background' }, BOB);
      exchange(a, b);
      exchange(b, a);

      expect(a.read().objects).toEqual(b.read().objects);
      expect(mustGet(b, 'frame-plan')).toMatchObject({ autoLayout: { gap: -4 } });
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
