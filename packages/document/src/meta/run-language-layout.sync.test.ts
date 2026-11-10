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
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { fixtureGateBoard, rawUpdate } from './__fixtures__/gate-boards.js';
import { DOCUMENT_LAYOUT_VERSION, READABLE_LAYOUT_VERSIONS } from './document-meta.js';
import * as meta from './document-meta.js';
import { readBoardLayout } from './layout-gate.js';

const { RUN_LANGUAGE_LAYOUT_VERSION } = meta as unknown as Record<string, number>;

describe('run language stored layout and sync', () => {
  it('writes layout 24 or later and still reads layout 23', () => {
    expect(RUN_LANGUAGE_LAYOUT_VERSION).toBe(24);
    // Bump-stable (took 25): this build writes layout 24 or later.
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(24);
    expect(READABLE_LAYOUT_VERSIONS).toContain(23);
    expect(READABLE_LAYOUT_VERSIONS).toContain(24);
  });

  it('reads an invalid peer-written language as absent and keeps its bytes through another write', () => {
    const board = fixtureGateBoard();
    const store = board.writer;
    try {
      store.applyUpdate(
        rawUpdate(board, (objects) => {
          const object = objects.get('text-title');
          const stored = object?.get('text');
          if (!(stored instanceof Y.Text)) throw new Error('Missing stored text');
          stored.format(0, 2, { lang: 'japanese!' });
        }),
        RELAY,
      );
      expect(store.get('text-title' as never)).not.toHaveProperty('runs.0.style.lang');
      applyCommand(store, setStyleCommand, {
        changes: [{ id: 'text-title', style: { textStyle: { italic: true } } }],
      });
      const doc = new Y.Doc();
      Y.applyUpdate(doc, store.encodeState());
      const object = doc.getMap<Y.Map<unknown>>('objects').get('text-title');
      const stored = object?.get('text');
      // The first stretch keeps the peer's bytes (the text fixture has several runs).
      const delta = stored instanceof Y.Text ? (stored.toDelta() as unknown[]) : [];
      expect(delta[0]).toMatchObject({ attributes: { lang: 'japanese!' } });
      doc.destroy();
    } finally {
      store.destroy();
      board.hub.destroy();
    }
  });

  for (const isReversed of [false, true]) {
    it(`converges on language and another text attribute with reversed ids ${String(isReversed)}`, () => {
      const ada = createFixtureStore();
      const bob = new YjsDocumentStore({ clientId: isReversed ? 100 : 200 });
      try {
        exchange(ada, bob);
        applyCommand(
          ada,
          setStyleCommand,
          { changes: [{ id: 'text-title', style: { textStyle: { lang: 'ja' } } }] },
          ADA,
        );
        applyCommand(
          bob,
          setStyleCommand,
          { changes: [{ id: 'text-title', style: { textStyle: { weight: 700 } } }] },
          BOB,
        );
        exchange(ada, bob);
        exchange(bob, ada);
        expect(ada.read().objects).toEqual(bob.read().objects);
        for (const store of [ada, bob]) {
          const { runs } = store.get('text-title' as never) as unknown as {
            runs: readonly { style: { lang?: string; weight: number } }[];
          };
          for (const run of runs) expect(run.style).toMatchObject({ lang: 'ja', weight: 700 });
          expect(readBoardLayout(internalsOf(store).doc)).toEqual({
            isStamped: true,
            layoutVersion: DOCUMENT_LAYOUT_VERSION,
          });
        }
      } finally {
        ada.destroy();
        bob.destroy();
      }
    });
  }
});
