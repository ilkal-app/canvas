// A layout-13 reader erases a frame radius on a whole style-group rewrite.
// Current clients preserve it and stamp the board at the named frame-radius layout.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { FRAME_RADIUS_VERSION, validateBoard } from '@canvas/schema';

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
  FRAME_RADIUS_LAYOUT_VERSION,
} from './document-meta.js';
import { canReadBoardLayout, readBoardLayout } from './layout-gate.js';

/** The layout before the gate, and the layouts a build before it reads. */
const PREVIOUS = FRAME_RADIUS_LAYOUT_VERSION - 1;
const BEFORE_GATE = Array.from({ length: PREVIOUS }, (unused, index) => index + 1);

const RADIUS = [4, 8, 12, 16] as const;

/**
 * The fixture board as the preceding layout and schema left it.
 *
 * @returns The board's bytes.
 */
function previousLayoutBoard(): Uint8Array {
  const source = createFixtureStore();
  const doc = new Y.Doc();
  doc.clientID = 61;
  Y.applyUpdate(doc, source.encodeState());
  doc
    .getMap(META_MAP_NAME)
    .set(DOCUMENT_META_KEY, { schemaVersion: FRAME_RADIUS_VERSION - 1, layoutVersion: PREVIOUS });
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  source.destroy();
  return bytes;
}

describe('frame radius layout', () => {
  it('writes this layout or a later one and still reads every layout before it', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(FRAME_RADIUS_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toEqual(
      expect.arrayContaining([...BEFORE_GATE, FRAME_RADIUS_LAYOUT_VERSION]),
    );
  });

  for (const isReversed of [false, true]) {
    it(`opens a previous layout board, converges on a frame radius, and stamps it (reversed ids: ${String(isReversed)})`, () => {
      const bytes = previousLayoutBoard();
      const a = new YjsDocumentStore({ clientId: isReversed ? 200 : 100 });
      const b = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      for (const store of [a, b]) store.applyUpdate(bytes, RELAY);
      expect(readBoardLayout(internalsOf(a).doc)).toEqual({
        isStamped: true,
        layoutVersion: PREVIOUS,
      });

      applyCommand(
        a,
        setStyleCommand,
        { changes: [{ id: 'frame-plan', style: { cornerRadius: RADIUS } }] },
        ADA,
      );
      applyCommand(
        b,
        setStyleCommand,
        { changes: [{ id: 'shape-box', style: { fill: [0, 1, 0, 1] } }] },
        BOB,
      );
      exchange(a, b);
      exchange(b, a);

      expect(a.read().objects).toEqual(b.read().objects);
      expect(mustGet(a, 'shape-box')).toMatchObject({ fill: [0, 1, 0, 1] });
      expect(mustGet(a, 'frame-plan')).toMatchObject({ cornerRadius: RADIUS });
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
