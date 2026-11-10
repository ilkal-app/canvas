// Independent acceptance for styled override commands and sync.
import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';
import { resolveInstance } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import {
  ORDERS,
  boardOf,
  expectValidAndConverged,
} from '../repair/__fixtures__/repair-fixtures.js';
import { ADA, BOB, BODY, exchange, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import {
  createComponentPair,
  placeInstance,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { codesOf, mustFindCommand, overridesOf } from './__fixtures__/component-fixtures.js';

const RED = [1, 0, 0, 1];
const runs = [
  { length: 2, style: BODY },
  { length: 2, style: { ...BODY, weight: 700 } },
];

function resolvedText(
  store: YjsDocumentStore,
  instanceId: string,
  path: string,
): BoardObject | undefined {
  return resolveInstance(boardOf(store), mustGet(store, instanceId) as never).objects.find(
    (object) => object.id === `${instanceId}/${path}`,
  );
}

describe('commands', () => {
  it('sets a textStyle and text with runs through the codec in one undo step each', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    const instanceId = placeInstance(store, mainId, { instanceId: 'inst-1' });
    const history = createHistory(store, ADA.principalId);
    const set = mustFindCommand('setInstanceOverride');
    applyCommand(store, set, {
      id: instanceId,
      path: noteId,
      override: { textStyle: { color: RED } },
    });
    expect(overridesOf(store, instanceId)[noteId]).toEqual({ textStyle: { color: RED } });
    expect(history.undo()).toBe(true);
    expect(overridesOf(store, instanceId)).toEqual({});
    applyCommand(store, set, { id: instanceId, path: noteId, override: { text: 'Note', runs } });
    expect(overridesOf(store, instanceId)[noteId]).toEqual({ text: 'Note', runs });
    expect(history.undo()).toBe(true);
    expect(overridesOf(store, instanceId)).toEqual({});
    history.destroy();
  });

  it('refuses runs without text and a textStyle on an image without writing', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId, photoId } = seedMainWithChildren(store);
    const id = placeInstance(store, mainId, { instanceId: 'inst-1' });
    const set = mustFindCommand('setInstanceOverride');
    expect(codesOf(expectRejected(store, set, { id, path: noteId, override: { runs } }))).toEqual([
      'invalid-override',
    ]);
    expect(
      codesOf(
        expectRejected(store, set, { id, path: photoId, override: { textStyle: { color: RED } } }),
      ),
    ).toEqual(['invalid-override']);
  });

  it('resets textStyle and runs separately and creates an instance with both fields', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    const id = placeInstance(store, mainId, {
      instanceId: 'inst-1',
      overrides: { [noteId]: { text: 'Note', runs, textStyle: { color: RED } } },
    });
    const reset = mustFindCommand('resetInstanceOverrides');
    expect(overridesOf(store, id)[noteId]).toEqual({
      text: 'Note',
      runs,
      textStyle: { color: RED },
    });
    applyCommand(store, reset, { id, path: noteId, fields: ['textStyle'] });
    expect(overridesOf(store, id)[noteId]).toEqual({ text: 'Note', runs });
    applyCommand(store, reset, { id, path: noteId, fields: ['runs'] });
    expect(overridesOf(store, id)[noteId]).toEqual({ text: 'Note' });
    const copy = new YjsDocumentStore();
    copy.applyUpdate(store.encodeState(), RELAY);
    expect(overridesOf(copy, id)).toEqual(overridesOf(store, id));
  });
});

describe.each(ORDERS)('concurrent overrides ($name)', ({ adaClientId, bobClientId }) => {
  function pair() {
    let ids: ReturnType<typeof seedMainWithChildren> | undefined;
    const [ada, bob] = createComponentPair(adaClientId, bobClientId, (store) => {
      ids = seedMainWithChildren(store);
      placeInstance(store, ids.mainId, { instanceId: 'inst-1' });
    });
    if (ids === undefined) throw new Error('main not seeded');
    return { ada, bob, ids };
  }

  it('converges a style override with a concurrent main text edit', () => {
    const { ada, bob, ids } = pair();
    applyCommand(ada, mustFindCommand('setInstanceOverride'), {
      id: 'inst-1',
      path: ids.noteId,
      override: { textStyle: { color: RED } },
    });
    const source = mustGet(bob, ids.noteId);
    bob.transact(BOB, (transaction) => {
      transaction.setObject({
        ...source,
        text: 'Later',
        runs: [{ length: 5, style: BODY }],
      } as BoardObject);
    });
    exchange(ada, bob);
    expectValidAndConverged(ada, bob);
    for (const store of [ada, bob])
      expect(resolvedText(store, 'inst-1', ids.noteId)).toMatchObject({
        text: 'Later',
        runs: [{ length: 5, style: { ...BODY, color: RED } }],
      });
  });

  it('converges two fields written concurrently on the same path as one whole LWW record', () => {
    const { ada, bob, ids } = pair();
    const a = { textStyle: { color: RED } };
    const b = { textStyle: { fontSize: 40 } };
    applyCommand(ada, mustFindCommand('setInstanceOverride'), {
      id: 'inst-1',
      path: ids.noteId,
      override: a,
    });
    applyCommand(
      bob,
      mustFindCommand('setInstanceOverride'),
      { id: 'inst-1', path: ids.noteId, override: b },
      BOB,
    );
    exchange(ada, bob);
    expectValidAndConverged(ada, bob);
    // The codec stores one plain record under each path in a Y.Map, so a concurrent write
    // chooses one complete record; field-level survival applies only to sequential merges.
    const winner = overridesOf(ada, 'inst-1')[ids.noteId];
    expect([a, b]).toContainEqual(winner);
    expect(overridesOf(bob, 'inst-1')[ids.noteId]).toEqual(winner);
    const isColor = 'color' in (winner?.textStyle as Record<string, unknown>);
    const expected = isColor ? RED : BODY.color;
    for (const store of [ada, bob])
      expect(resolvedText(store, 'inst-1', ids.noteId)).toMatchObject({
        runs: [
          {
            length: 4,
            style: { ...BODY, color: expected, ...(isColor ? {} : { fontSize: 40 }) },
          },
        ],
      });
  });
});
