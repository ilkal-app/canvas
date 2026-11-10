// Stored layout 6: an override record may hold `textStyle` and `runs`. A layout 5
// reader drops such a record whole and refuses later writes of one (its record is strict), so
// the layout rose. A board stored at layout 5 opens unchanged, two current clients edit it and
// converge, its first write stamps it with this build's layout, and a reader of layouts 1 to 5
// is then refused by the gate.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { validateBoard, type InstanceObject } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { placeInstance, seedMainWithChildren } from '../commands/__fixtures__/component-boards.js';
import { setInstanceOverrideCommand } from '../commands/set-instance-override.js';
import { BOB, exchange, RELAY } from '../store/__fixtures__/store-fixtures.js';
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
const BEFORE_TEXT_OVERRIDE_STYLE = [1, 2, 3, 4, 5];

const RED: [number, number, number, number] = [1, 0, 0, 1];

/** A layout 5 board: a main with children, an instance with a text override, stamped 5. */
interface LayoutFiveBoard {
  readonly bytes: Uint8Array;
  readonly instanceId: string;
  readonly captionId: string;
  readonly noteId: string;
}

/**
 * Builds the board as a layout 5 build left it: records with only layout 5 keys, under a
 * metadata stamp naming layout 5 and schema 4.
 *
 * @returns The board's bytes and ids.
 */
function layoutFiveBoard(): LayoutFiveBoard {
  const source = new YjsDocumentStore({ clientId: 50 });
  const { mainId, captionId, noteId } = seedMainWithChildren(source);
  const instanceId = placeInstance(source, mainId, {
    x: 1000,
    y: 0,
    instanceId: 'inst',
    overrides: { [captionId]: { text: 'Old' } },
  });
  const doc = new Y.Doc();
  doc.clientID = 51;
  Y.applyUpdate(doc, source.encodeState());
  doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, { schemaVersion: 4, layoutVersion: 5 });
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  source.destroy();
  return { bytes, instanceId, captionId, noteId };
}

describe('stored layout 6', () => {
  it('writes a layout after 5 and still reads 1 to 5', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(6);
    expect(READABLE_LAYOUT_VERSIONS).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6]));
  });

  for (const isReversed of [false, true]) {
    it(`opens a layout 5 board, converges on two clients' style overrides and stamps it (reversed ids: ${String(isReversed)})`, () => {
      const board = layoutFiveBoard();
      const a = new YjsDocumentStore({ clientId: isReversed ? 200 : 100 });
      const b = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      for (const store of [a, b]) store.applyUpdate(board.bytes, RELAY);
      expect(readBoardLayout(internalsOf(a).doc)).toEqual({ isStamped: true, layoutVersion: 5 });
      const before = mustGet(a, board.instanceId) as InstanceObject;
      expect(before.overrides).toEqual({ [board.captionId]: { text: 'Old' } });

      const caption = mustGet(a, board.captionId);
      const body = caption.type === 'text' ? caption.runs[0]?.style : undefined;
      if (body === undefined) throw new Error('the caption has no runs');
      const runs = [
        { length: 1, style: { ...body, weight: 700 as const } },
        { length: 1, style: body },
      ];
      applyCommand(a, setInstanceOverrideCommand, {
        id: board.instanceId,
        path: board.captionId,
        override: { textStyle: { color: RED } },
      });
      applyCommand(
        b,
        setInstanceOverrideCommand,
        { id: board.instanceId, path: board.noteId, override: { text: 'Hi', runs } },
        BOB,
      );
      exchange(a, b);
      exchange(b, a);

      expect(a.read().objects).toEqual(b.read().objects);
      expect(validateBoard(a.read())).toEqual([]);
      expect((mustGet(a, board.instanceId) as InstanceObject).overrides).toEqual({
        [board.captionId]: { text: 'Old', textStyle: { color: RED } },
        [board.noteId]: { text: 'Hi', runs },
      });
      for (const store of [a, b]) {
        const layout = readBoardLayout(internalsOf(store).doc);
        expect(layout).toEqual({ isStamped: true, layoutVersion: DOCUMENT_LAYOUT_VERSION });
        expect(canReadBoardLayout(layout, BEFORE_TEXT_OVERRIDE_STYLE)).toBe(false);
        expect(canReadBoardLayout(layout, READABLE_LAYOUT_VERSIONS)).toBe(true);
      }
      a.destroy();
      b.destroy();
    });
  }
});
