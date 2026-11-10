// Nightly 40240436854 refused an honest setConnectorEnd as `missing-connector-target`.
// A peer's write can leave one end of a connector on an object no longer on the board (a
// concurrent delete the reference repair has not reached, or one it cannot place), and the
// command judged both ends of the connector it wrote: moving the other end, or reattaching it,
// was refused for a field the command does not write. It now judges only the end it writes.
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { createFixtureStore, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { setConnectorEndCommand } from './set-connector-end.js';

/**
 * The fixture board with `connector-flow`'s start left on an object that is not on the board,
 * as a peer's write leaves it.
 *
 * @returns The store.
 */
function danglingStart(): YjsDocumentStore {
  const store = createFixtureStore();
  const { doc, objects } = internalsOf(store);
  doc.transact(() => {
    const connector = objects.get('connector-flow') as Y.Map<unknown>;
    connector.set('from', { kind: 'object', objectId: 'gone', anchor: null });
  }, RELAY);
  return store;
}

describe('setConnectorEnd with the other end on an object no longer on the board', () => {
  it('frees or reattaches the end it writes', () => {
    const store = danglingStart();
    applyCommand(store, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'to',
      target: { point: { x: 5, y: 5 } },
    });
    expect(mustGet(store, 'connector-flow')).toMatchObject({ to: { kind: 'point' } });
    applyCommand(store, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'to',
      target: { objectId: 'shape-box', anchor: null },
    });
    expect(mustGet(store, 'connector-flow')).toMatchObject({
      to: { kind: 'object', objectId: 'shape-box' },
    });
    store.destroy();
  });

  it('reattaches the dangling end itself, and still refuses a missing target for it', () => {
    const store = danglingStart();
    expect(
      expectRejected(store, setConnectorEndCommand, {
        id: 'connector-flow',
        end: 'from',
        target: { objectId: 'also-gone', anchor: null },
      }),
    ).toEqual([
      expect.objectContaining({ code: 'missing-connector-target', path: ['from', 'objectId'] }),
    ]);
    applyCommand(store, setConnectorEndCommand, {
      id: 'connector-flow',
      end: 'from',
      target: { objectId: 'sticky-idea', anchor: null },
    });
    expect(mustGet(store, 'connector-flow')).toMatchObject({
      from: { kind: 'object', objectId: 'sticky-idea' },
    });
    store.destroy();
  });
});
