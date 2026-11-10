// Stored layout 12: a path's, line's or connector's stroke
// style and a shape's or frame's drop shadow are optional fields in the style group. A layout 11
// reader decodes only the style fields it knows and rewrites the whole group on a restyle,
// erasing them, so the layout rose. A board stored at layout 11 opens unchanged, two current
// clients edit it (one shadows a shape, the other dashes a line) and converge, its first write
// stamps it with this build's layout, and a reader of layouts 1 to 11 is then refused.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { validateBoard, type Shadow } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { setStyleCommand } from '../commands/set-style.js';
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
  READABLE_LAYOUT_VERSIONS,
  STROKE_STYLE_SHADOW_LAYOUT_VERSION,
} from './document-meta.js';
import { canReadBoardLayout, readBoardLayout } from './layout-gate.js';

/** The layout before the gate, and the layouts a build before it reads. */
const PREVIOUS = STROKE_STYLE_SHADOW_LAYOUT_VERSION - 1;
const BEFORE_GATE = Array.from({ length: PREVIOUS }, (unused, index) => index + 1);

const SHADOW: Shadow = { x: 0, y: 6, blur: 12, spread: 0, color: [0, 0, 0, 0.3] };
const DASH = { pattern: [8, 4] };

/**
 * The fixture board as a layout 11 build left it, under a stamp naming layout 11 and schema 13.
 *
 * @returns The board's bytes.
 */
function previousLayoutBoard(): Uint8Array {
  const source = createFixtureStore();
  const doc = new Y.Doc();
  doc.clientID = 61;
  Y.applyUpdate(doc, source.encodeState());
  doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, { schemaVersion: 13, layoutVersion: PREVIOUS });
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  source.destroy();
  return bytes;
}

describe('stored layout 12', () => {
  it('writes this layout or a later one and still reads every layout before it', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(STROKE_STYLE_SHADOW_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toEqual(
      expect.arrayContaining([...BEFORE_GATE, STROKE_STYLE_SHADOW_LAYOUT_VERSION]),
    );
  });

  for (const isReversed of [false, true]) {
    it(`opens a layout 11 board, converges on a shadow and a dash, and stamps it (reversed ids: ${String(isReversed)})`, () => {
      const bytes = previousLayoutBoard();
      const a = new YjsDocumentStore({ clientId: isReversed ? 200 : 100 });
      const b = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      for (const store of [a, b]) store.applyUpdate(bytes, RELAY);
      expect(readBoardLayout(internalsOf(a).doc)).toEqual({
        isStamped: true,
        layoutVersion: PREVIOUS,
      });

      const shadow = { changes: [{ id: 'shape-box', style: { shadow: SHADOW } }] };
      applyCommand(a, setStyleCommand, shadow, ADA);
      const dash = { changes: [{ id: 'line-divider', style: { strokeDash: DASH } }] };
      applyCommand(b, setStyleCommand, dash, BOB);
      exchange(a, b);
      exchange(b, a);

      expect(a.read().objects).toEqual(b.read().objects);
      expect(mustGet(a, 'shape-box')).toMatchObject({ shadow: SHADOW });
      expect(mustGet(a, 'line-divider')).toMatchObject({ strokeDash: DASH });
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
