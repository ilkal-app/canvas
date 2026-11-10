import { describe, expect, it } from 'vitest';

import { YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import type { PrincipalId } from '@canvas/schema';

import { createCanvasDocument } from './canvas-document.js';

const USER: TransactionOrigin = { kind: 'user', principalId: 'user:local' as PrincipalId };

/**
 * A document over a new, empty store, and the origins of its transactions.
 *
 * @returns The document and the origins seen so far.
 */
function emptyDocument() {
  const store = new YjsDocumentStore();
  const origins: TransactionOrigin[] = [];
  store.subscribe(({ origin }) => origins.push(origin));
  return { document: createCanvasDocument(store, USER), origins };
}

describe('the SDK document’s portable JSON', () => {
  it('exports a board and imports it into another as one command, with fresh ids', () => {
    const source = emptyDocument().document;
    const group = source.run('createObject', { object: { type: 'group', x: 10, y: 20 } });
    if (group.status !== 'applied') throw new Error('createObject was refused');
    const json: unknown = JSON.parse(JSON.stringify(source.export()));
    expect(json).toMatchObject({ format: 'canvas.board' });

    const { document: target, origins } = emptyDocument();
    const outcome = target.import(json, { origin: 'agent' });
    if (outcome.status !== 'applied') throw new Error(`the import was ${outcome.status}`);
    const [id] = outcome.ids;
    expect(outcome.ids).toHaveLength(1);
    expect(id).not.toBe(group.result.id);
    expect(outcome.idMap).toEqual({ [group.result.id]: id });
    expect(outcome.changes.created).toEqual([id]);
    expect(target.get(id ?? '')).toMatchObject({ type: 'group', x: 10, y: 20 });
    expect(origins).toEqual([
      { kind: 'agent', principalId: 'agent:sdk', operatorId: 'user:local' },
    ]);
  });

  it('exports the same board as the same JSON', () => {
    const { document } = emptyDocument();
    document.run('createObject', { object: { type: 'group', x: 1, y: 2 } });
    expect(JSON.stringify(document.export())).toBe(JSON.stringify(document.export()));
  });

  it('refuses a document that is not a portable board, writing nothing', () => {
    const { document, origins } = emptyDocument();
    const outcome = document.import({ format: 'something-else', objects: [] });
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') expect(outcome.issues.length).toBeGreaterThan(0);
    expect(origins).toEqual([]);
  });

  it('refuses objects the board cannot take whole, and a document with none, as MCP does', () => {
    const source = emptyDocument().document;
    source.run('createObject', { object: { type: 'group', x: 0, y: 0 } });
    const json: unknown = JSON.parse(JSON.stringify(source.export()));
    const { document, origins } = emptyDocument();
    const outcome = document.import(json, { parentId: 'missing-frame' });
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') expect(outcome.errors.length).toBeGreaterThan(0);
    expect(origins).toEqual([]);
    const empty = document.import(emptyDocument().document.export());
    expect(empty).toMatchObject({
      status: 'invalid',
      issues: [
        { code: 'invalid-format', path: ['objects'], message: 'The document has no objects.' },
      ],
    });
    expect(origins).toEqual([]);
  });
});
