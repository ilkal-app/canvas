// Item 19: setStyle moves a connector label in one undo step.
import { afterEach, describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import { ADA, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';
import { STYLE_FIELDS_BY_TYPE } from './style-fields.js';

const stores: YjsDocumentStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.destroy();
});

/**
 * The fixture board, whose connector has no explicit position. (A store holding only the
 * connector, without the objects its ends attach to, loses it on any undo.)
 *
 * @returns The seeded store.
 */
function seeded(): YjsDocumentStore {
  const store = createFixtureStore();
  stores.push(store);
  return store;
}

describe('connector label position via setStyle', () => {
  it('allows a connector style patch and undoes the move in one step', () => {
    expect(STYLE_FIELDS_BY_TYPE.connector).toContain('labelPosition');
    const store = seeded();
    const before = store.get('connector-flow' as never);
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'connector-flow', style: { labelPosition: 0.75 } }],
    });
    expect(store.get('connector-flow' as never)).toHaveProperty('labelPosition', 0.75);
    expect(history.undo()).toBe(true);
    expect(store.get('connector-flow' as never)).toEqual(before);
    expect(history.undo()).toBe(false);
    history.destroy();
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses invalid position %s without changing the document',
    (labelPosition) => {
      const store = seeded();
      expectRejected(store, setStyleCommand, {
        changes: [{ id: 'connector-flow', style: { labelPosition } }],
      });
      expect(store.get('connector-flow' as never)).not.toHaveProperty('labelPosition');
    },
  );
});
