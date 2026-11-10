// Peers converge on a text's direction and start/end alignment at layout 22.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { setStyleCommand } from '../commands/set-style.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  exchange,
  RELAY,
} from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../store/yjs-document-store.js';

import { fixtureGateBoard, mergeGroup, rawUpdate } from './__fixtures__/gate-boards.js';
import { DOCUMENT_LAYOUT_VERSION, TEXT_DIRECTION_LAYOUT_VERSION } from './document-meta.js';
import { readBoardLayout } from './layout-gate.js';

describe('text direction layout and sync', () => {
  it('writes layout version 22 or later and reads an absent direction as auto', () => {
    const store = createFixtureStore();
    expect(TEXT_DIRECTION_LAYOUT_VERSION).toBe(22);
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(TEXT_DIRECTION_LAYOUT_VERSION);
    expect(store.get('text-title' as never)).not.toHaveProperty('direction');
    store.destroy();
  });

  it('reads a refused stored direction as auto and preserves it through an unrelated write', () => {
    const board = fixtureGateBoard();
    const store = board.writer;
    try {
      store.applyUpdate(
        rawUpdate(board, (objects) => {
          mergeGroup(objects, 'text-title', 'style', { direction: 'up' });
        }),
        RELAY,
      );
      expect(store.get('text-title' as never)).not.toHaveProperty('direction');
      applyCommand(store, setStyleCommand, {
        changes: [{ id: 'text-title', style: { verticalAlign: 'bottom' } }],
      });
      const doc = new Y.Doc();
      Y.applyUpdate(doc, store.encodeState());
      const style = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('text-title')?.get('style');
      expect(style).toMatchObject({ direction: 'up', verticalAlign: 'bottom' });
      doc.destroy();
    } finally {
      store.destroy();
      board.hub.destroy();
    }
  });

  for (const isReversed of [false, true]) {
    it(`converges on a direction and an unrelated write (isReversed ids: ${String(isReversed)})`, () => {
      const ada = createFixtureStore();
      const bob = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      exchange(ada, bob);
      applyCommand(
        ada,
        setStyleCommand,
        { changes: [{ id: 'sticky-idea', style: { direction: 'rtl', align: 'start' } }] },
        ADA,
      );
      applyCommand(
        bob,
        setStyleCommand,
        { changes: [{ id: 'text-title', style: { align: 'end' } }] },
        BOB,
      );
      exchange(ada, bob);
      exchange(bob, ada);
      expect(ada.read().objects).toEqual(bob.read().objects);
      expect(bob.get('sticky-idea' as never)).toMatchObject({ direction: 'rtl', align: 'start' });
      expect(ada.get('text-title' as never)).toMatchObject({ align: 'end' });
      for (const store of [ada, bob]) {
        expect(readBoardLayout(internalsOf(store).doc)).toEqual({
          isStamped: true,
          layoutVersion: DOCUMENT_LAYOUT_VERSION,
        });
      }
      ada.destroy();
      bob.destroy();
    });
  }
});
