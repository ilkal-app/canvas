// Stored layout 13: a shape's or frame's `strokeAlign` and
// a frame's `stroke` are optional fields in the style group. A layout 12 reader decodes only the
// style fields it knows and rewrites the whole group on a restyle, erasing them, so the layout
// rose. A board stored at layout 12 opens unchanged, two current clients edit it (one aligns a
// shape's outline outside, the other outlines a frame) and converge, its first write stamps it
// with this build's layout, and a reader of layouts 1 to 12 is then refused.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { validateBoard, type Stroke } from '@canvas/schema';

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
  STROKE_ALIGN_LAYOUT_VERSION,
} from './document-meta.js';
import { canReadBoardLayout, readBoardLayout } from './layout-gate.js';

/** The layout before the gate, and the layouts a build before it reads. */
const PREVIOUS = STROKE_ALIGN_LAYOUT_VERSION - 1;
const BEFORE_GATE = Array.from({ length: PREVIOUS }, (unused, index) => index + 1);

const OUTLINE: Stroke = { color: 'ink', width: 2 };

/**
 * The fixture board as a layout 12 build left it, under a stamp naming layout 12 and schema 15.
 *
 * @returns The board's bytes.
 */
function previousLayoutBoard(): Uint8Array {
  const source = createFixtureStore();
  const doc = new Y.Doc();
  doc.clientID = 61;
  Y.applyUpdate(doc, source.encodeState());
  doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, { schemaVersion: 15, layoutVersion: PREVIOUS });
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  source.destroy();
  return bytes;
}

describe('stored layout 13', () => {
  it('writes this layout or a later one and still reads every layout before it', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(STROKE_ALIGN_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toEqual(
      expect.arrayContaining([...BEFORE_GATE, STROKE_ALIGN_LAYOUT_VERSION]),
    );
  });

  for (const isReversed of [false, true]) {
    it(`opens a layout 12 board, converges on an alignment and a frame stroke, and stamps it (reversed ids: ${String(isReversed)})`, () => {
      const bytes = previousLayoutBoard();
      const a = new YjsDocumentStore({ clientId: isReversed ? 200 : 100 });
      const b = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      for (const store of [a, b]) store.applyUpdate(bytes, RELAY);
      expect(readBoardLayout(internalsOf(a).doc)).toEqual({
        isStamped: true,
        layoutVersion: PREVIOUS,
      });

      const align = { changes: [{ id: 'shape-box', style: { strokeAlign: 'outside' as const } }] };
      applyCommand(a, setStyleCommand, align, ADA);
      const outline = { changes: [{ id: 'frame-plan', style: { stroke: OUTLINE } }] };
      applyCommand(b, setStyleCommand, outline, BOB);
      exchange(a, b);
      exchange(b, a);

      expect(a.read().objects).toEqual(b.read().objects);
      expect(mustGet(a, 'shape-box')).toMatchObject({ strokeAlign: 'outside' });
      expect(mustGet(a, 'frame-plan')).toMatchObject({ stroke: OUTLINE });
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
