import { describe, expect, it } from 'vitest';

import { YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import type { PrincipalId } from '@canvas/schema';

import { createCanvasDocument } from './canvas-document.js';

const USER: TransactionOrigin = { kind: 'user', principalId: 'user:local' as PrincipalId };

/**
 * A document over a new, empty store, and the origins of its transactions.
 *
 * @returns The document, its store, and the origins seen so far.
 */
function emptyDocument() {
  const store = new YjsDocumentStore();
  const origins: TransactionOrigin[] = [];
  store.subscribe(({ origin }) => origins.push(origin));
  return { store, document: createCanvasDocument(store, USER), origins };
}

describe('the SDK document', () => {
  it('runs a command as the board’s user and reads what it wrote', () => {
    const { document, origins } = emptyDocument();
    expect(document.objects()).toEqual([]);
    const outcome = document.run('createObject', { object: { type: 'group', x: 10, y: 20 } });
    if (outcome.status !== 'applied') throw new Error('createObject was refused');
    const { id } = outcome.result;
    expect(outcome.changes).toEqual({ created: [id], updated: [], deleted: [] });
    expect(document.get(id)).toMatchObject({ id, type: 'group', x: 10, y: 20 });
    expect(document.objects().map((object) => object.id)).toEqual([id]);
    expect(origins).toEqual([USER]);
  });

  it('attributes an agent’s command to the SDK’s agent, operated by the user', () => {
    const { document, origins } = emptyDocument();
    const outcome = document.run(
      'createObject',
      { object: { type: 'group', x: 0, y: 0 } },
      { origin: 'agent' },
    );
    expect(outcome.status).toBe('applied');
    expect(origins).toEqual([
      { kind: 'agent', principalId: 'agent:sdk', operatorId: 'user:local' },
    ]);
  });

  it('refuses a command whole, writing nothing', () => {
    const { document, origins } = emptyDocument();
    const outcome = document.run('moveObjects', {
      moves: [{ id: 'missing', by: { x: 5, y: 5 } }],
    });
    if (outcome.status !== 'rejected') throw new Error('moving a missing object was applied');
    expect(outcome.errors.map(({ code }) => code)).toEqual(['missing-object']);
    expect(origins).toEqual([]);
    expect(document.get('missing')).toBeUndefined();
  });

  it('throws for a name that is no command, as a host without types might send', () => {
    const { document } = emptyDocument();
    expect(() => document.run('dropTable' as 'group', { ids: [] })).toThrow(
      'There is no command named "dropTable".',
    );
  });
});
