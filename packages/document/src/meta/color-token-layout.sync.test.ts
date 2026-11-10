// Stored layout 9: the board's colour tokens are the map `tokens` and a colour may name
// a token. A layout 8 reader draws a token as no fill and refuses to write a reference back, so the
// layout rose. A board stored at layout 8 opens unchanged, two current clients edit it (one adds a
// token, the other colours a shape with it) and converge, its first write stamps it with this
// build's layout, and a reader of layouts 1 to 8 is then refused by the gate.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { validateBoard } from '@canvas/schema';

import {
  applyCommand,
  mustGet,
  testEnvironment,
} from '../commands/__fixtures__/command-fixtures.js';
import { setStyleCommand } from '../commands/set-style.js';
import { setColorTokenCommand } from '../commands/tokens/set-color-token.js';
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
} from './document-meta.js';
import { canReadBoardLayout, readBoardLayout } from './layout-gate.js';

/** The layouts a build before reads. */
const BEFORE_COLOUR_TOKENS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * The fixture board as a layout 8 build left it, under a stamp naming layout 8 and schema 10.
 *
 * @returns The board's bytes.
 */
function layoutEightBoard(): Uint8Array {
  const source = createFixtureStore();
  const doc = new Y.Doc();
  doc.clientID = 61;
  Y.applyUpdate(doc, source.encodeState());
  doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, { schemaVersion: 10, layoutVersion: 8 });
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  source.destroy();
  return bytes;
}

describe('stored layout 9', () => {
  it('writes a layout after 8 and still reads 1 to 8', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(9);
    expect(READABLE_LAYOUT_VERSIONS).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  for (const isReversed of [false, true]) {
    it(`opens a layout 8 board, converges on a token and its use, and stamps it (reversed ids: ${String(isReversed)})`, () => {
      const bytes = layoutEightBoard();
      const a = new YjsDocumentStore({ clientId: isReversed ? 200 : 100 });
      const b = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      for (const store of [a, b]) store.applyUpdate(bytes, RELAY);
      expect(readBoardLayout(internalsOf(a).doc)).toEqual({ isStamped: true, layoutVersion: 8 });
      expect(a.readTokens().size).toBe(0);

      const input = { name: 'Brand', light: [1, 0, 0, 1], dark: [0, 0, 1, 1] };
      const environment = testEnvironment(isReversed ? 8 : 9);
      const { id } = applyCommand(a, setColorTokenCommand, input as never, ADA, environment).result;
      const style = { changes: [{ id: 'shape-box', style: { fill: { token: id } } }] };
      applyCommand(b, setStyleCommand, style, BOB);
      exchange(a, b);
      exchange(b, a);

      expect(a.read().objects).toEqual(b.read().objects);
      expect([...a.readTokens().values()]).toEqual([...b.readTokens().values()]);
      expect(mustGet(a, 'shape-box')).toMatchObject({ fill: { token: id } });
      expect(validateBoard(a.read())).toEqual([]);
      for (const store of [a, b]) {
        const layout = readBoardLayout(internalsOf(store).doc);
        expect(layout).toEqual({ isStamped: true, layoutVersion: DOCUMENT_LAYOUT_VERSION });
        expect(canReadBoardLayout(layout, BEFORE_COLOUR_TOKENS)).toBe(false);
        expect(canReadBoardLayout(layout, READABLE_LAYOUT_VERSIONS)).toBe(true);
      }
      a.destroy();
      b.destroy();
    });
  }
});
