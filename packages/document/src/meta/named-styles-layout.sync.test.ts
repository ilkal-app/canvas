// Stored layout 16: the board's named styles in the top-level maps
// `textStyles` and `effectStyles`, a run's `textStyleId` attribute, and a shape's or frame's
// `effectStyleId` and layered `shadow` in its style group. A layout 15 reader would refuse a
// layered shadow and rewrite a style group or a run's attributes without the ids, so the layout
// rose. A board stored at layout 15 opens unchanged, two current clients edit it (one makes and
// applies a text style, the other an effect style) and converge, its first write stamps it with
// this build's layout, and a reader of layouts 1 to 15 is then refused.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { validateBoard, type Shadow, type TextStyleValue } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { setStyleCommand } from '../commands/set-style.js';
import { setEffectStyleCommand, setTextStyleCommand } from '../commands/styles/set-named-style.js';
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
  NAMED_STYLES_LAYOUT_VERSION,
  READABLE_LAYOUT_VERSIONS,
} from './document-meta.js';
import { canReadBoardLayout, readBoardLayout } from './layout-gate.js';

/** The layout before the gate, and the layouts a build before it reads. */
const PREVIOUS = NAMED_STYLES_LAYOUT_VERSION - 1;
const BEFORE_GATE = Array.from({ length: PREVIOUS }, (unused, index) => index + 1);

const BODY: TextStyleValue = { fontFamily: 'Inter', fontSize: 20, weight: 500, italic: false };
const SHADOWS: Shadow[] = [
  { x: 0, y: 8, blur: 24, spread: 0, color: [0, 0, 0, 0.34] },
  { x: 0, y: 1, blur: 2, spread: 0, color: [0, 0, 0, 0.2] },
];

/**
 * The fixture board as a layout 15 build left it, under a stamp naming layout 15 and schema 18.
 *
 * @returns The board's bytes.
 */
function previousLayoutBoard(): Uint8Array {
  const source = createFixtureStore();
  const doc = new Y.Doc();
  doc.clientID = 61;
  Y.applyUpdate(doc, source.encodeState());
  doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, { schemaVersion: 18, layoutVersion: PREVIOUS });
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  source.destroy();
  return bytes;
}

describe('stored layout 16', () => {
  it('writes this layout or a later one and still reads every layout before it', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(NAMED_STYLES_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toEqual(
      expect.arrayContaining([...BEFORE_GATE, NAMED_STYLES_LAYOUT_VERSION]),
    );
  });

  for (const isReversed of [false, true]) {
    it(`opens a layout 15 board, converges on a text and an effect style, and stamps it (reversed ids: ${String(isReversed)})`, () => {
      const bytes = previousLayoutBoard();
      const a = new YjsDocumentStore({ clientId: isReversed ? 200 : 100 });
      const b = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      for (const store of [a, b]) store.applyUpdate(bytes, RELAY);
      expect(readBoardLayout(internalsOf(a).doc)).toEqual({
        isStamped: true,
        layoutVersion: PREVIOUS,
      });

      const text = applyCommand(a, setTextStyleCommand, { name: 'Body', value: BODY }, ADA);
      const textId = text.result.id;
      const bind = {
        changes: [{ id: 'text-title', style: { textStyle: { textStyleId: textId } } }],
      };
      applyCommand(a, setStyleCommand, bind, ADA);
      const effect = applyCommand(
        b,
        setEffectStyleCommand,
        { name: 'Float', value: { shadows: SHADOWS } },
        BOB,
      );
      const effectId = effect.result.id;
      const lift = { changes: [{ id: 'frame-plan', style: { effectStyleId: effectId } }] };
      applyCommand(b, setStyleCommand, lift, BOB);
      exchange(a, b);
      exchange(b, a);

      expect(a.read().objects).toEqual(b.read().objects);
      expect(a.readTextStyles()).toEqual(b.readTextStyles());
      expect(a.readEffectStyles()).toEqual(b.readEffectStyles());
      expect(mustGet(a, 'frame-plan')).toMatchObject({ effectStyleId: effectId, shadow: SHADOWS });
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
