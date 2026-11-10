// (layer opacity): refused replayed values stay stored until explicitly removed.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { ShapeObject } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { setStyleCommand } from '../commands/set-style.js';
import { fixtureGateBoard, mergeGroup, rawUpdate } from '../meta/__fixtures__/gate-boards.js';
import { exchange, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../store/yjs-document-store.js';

import { layoutOf } from './object-layout.js';

const SHAPE = 'shape-box';
const REFUSED = 2;
const boards: { destroy: () => void }[] = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.destroy();
});

function writerWithRefusedOpacity(): YjsDocumentStore {
  const board = fixtureGateBoard();
  boards.push(
    {
      destroy: () => {
        board.hub.destroy();
      },
    },
    board.writer,
  );
  board.writer.applyUpdate(
    rawUpdate(board, (objects) => {
      mergeGroup(objects, SHAPE, 'style', { opacity: REFUSED });
    }),
    RELAY,
  );
  return board.writer;
}

function storedStyle(store: YjsDocumentStore): Readonly<Record<string, unknown>> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, store.encodeState());
  const style = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(SHAPE)?.get('style');
  doc.destroy();
  return style as Readonly<Record<string, unknown>>;
}

describe('layer opacity in stored layout', () => {
  it('lives in the shape style group', () => {
    const style = layoutOf('shape')?.codecs.find(
      (codec) => codec.kind === 'group' && codec.key === 'style',
    );
    expect(style).toMatchObject({ fields: expect.arrayContaining(['opacity']) as unknown });
  });

  it('reads a refused replay as absent without deleting it', () => {
    const store = writerWithRefusedOpacity();
    expect(store.read().issues).toEqual([]);
    expect((store.get(SHAPE as never) as ShapeObject).opacity).toBeUndefined();
    expect(storedStyle(store).opacity).toBe(REFUSED);
  });

  it('carries the refused value through unrelated writes on two clients', () => {
    const ada = writerWithRefusedOpacity();
    const bob = new YjsDocumentStore({ clientId: 3 });
    boards.push(bob);
    exchange(ada, bob);
    applyCommand(bob, moveObjectsCommand, { moves: [{ id: SHAPE, by: { x: 0, y: 40 } }] });
    applyCommand(ada, setStyleCommand, { changes: [{ id: SHAPE, style: { fill: [0, 1, 0, 1] } }] });
    exchange(ada, bob);
    for (const store of [ada, bob]) expect(storedStyle(store).opacity).toBe(REFUSED);
    expect(ada.read().objects).toEqual(bob.read().objects);
  });

  it('clears the refused value on explicit undefined removal', () => {
    const store = writerWithRefusedOpacity();
    applyCommand(store, setStyleCommand, {
      changes: [{ id: SHAPE, style: { opacity: undefined } }],
    });
    expect(storedStyle(store)).not.toHaveProperty('opacity');
    applyCommand(store, setStyleCommand, {
      changes: [{ id: SHAPE, style: { fill: [0, 1, 0, 1] } }],
    });
    expect(storedStyle(store)).not.toHaveProperty('opacity');
  });
});
