// Peers converge on the visibility field at layout 21.
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
import { DOCUMENT_LAYOUT_VERSION, LAYER_VISIBILITY_LAYOUT_VERSION } from './document-meta.js';
import { readBoardLayout } from './layout-gate.js';

describe('layer visibility layout and sync', () => {
  it('writes layout version 21 or later and reads absent visibility as shown', () => {
    const store = createFixtureStore();
    expect(LAYER_VISIBILITY_LAYOUT_VERSION).toBe(21);
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(LAYER_VISIBILITY_LAYOUT_VERSION);
    expect(store.get('shape-box' as never)).not.toHaveProperty('isHidden');
    store.destroy();
  });

  it('reads a refused stored visibility as shown and preserves it through an unrelated write', () => {
    const board = fixtureGateBoard();
    const store = board.writer;
    try {
      store.applyUpdate(
        rawUpdate(board, (objects) => {
          mergeGroup(objects, 'shape-box', 'style', { isHidden: 'yes' });
        }),
        RELAY,
      );
      expect(store.get('shape-box' as never)).not.toHaveProperty('isHidden');
      applyCommand(store, setStyleCommand, {
        changes: [{ id: 'shape-box', style: { fill: [0, 1, 0, 1] } }],
      });
      const doc = new Y.Doc();
      Y.applyUpdate(doc, store.encodeState());
      const style = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('shape-box')?.get('style');
      expect(style).toMatchObject({ isHidden: 'yes' });
      doc.destroy();
    } finally {
      store.destroy();
      board.hub.destroy();
    }
  });

  for (const isReversed of [false, true]) {
    it(`converges on visibility and an unrelated style write (isReversed ids: ${String(isReversed)})`, () => {
      const ada = createFixtureStore();
      const bob = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      exchange(ada, bob);
      applyCommand(
        ada,
        setStyleCommand,
        {
          changes: [{ id: 'shape-box', style: { isHidden: true } }],
        },
        ADA,
      );
      applyCommand(
        bob,
        setStyleCommand,
        {
          changes: [{ id: 'frame-plan', style: { background: [0, 1, 0, 1] } }],
        },
        BOB,
      );
      exchange(ada, bob);
      exchange(bob, ada);
      expect(ada.read().objects).toEqual(bob.read().objects);
      expect(bob.get('shape-box' as never)).toMatchObject({ isHidden: true });
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
