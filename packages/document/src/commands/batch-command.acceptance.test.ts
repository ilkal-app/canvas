// Sequential, atomic batch planning over command writes.
import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import * as documentApi from '../index.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import {
  newRectangle,
  placeInstance,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';
import type { AnyCommand } from './command.js';
import { createObjectCommand } from './create-object.js';

const RED = [1, 0, 0, 1] as const;
const BLUE = [0, 0, 1, 1] as const;
const GREEN = [0, 1, 0, 1] as const;

/**
 * Loads the promised public export while retaining a useful red-test failure before implementation.
 *
 * @param command - The wrapped single-item command.
 * @param key - The batch input and result list name.
 * @returns The batch command.
 * @throws {Error} Until the public export exists.
 */
function batchCommand(command: AnyCommand, key: string): AnyCommand {
  const candidate: unknown = (documentApi as Record<string, unknown>).batchCommand;
  if (typeof candidate !== 'function')
    throw new Error('missing @canvas/document batchCommand export');
  const wrap = candidate as (item: AnyCommand, listKey: string) => AnyCommand;
  return wrap(command, key);
}

describe('batchCommand', () => {
  it('plans later overrides against earlier writes, returns ordered results, and undoes as one step', () => {
    const store = new YjsDocumentStore();
    const { mainId, boxId } = seedMainWithChildren(store);
    const instanceId = placeInstance(store, mainId, {
      x: 1000,
      y: 0,
      instanceId: 'batch-instance',
    });
    const before = store.get(instanceId);
    const history = createHistory(store, ADA.principalId);
    const changes: unknown[] = [];
    const unsubscribe = store.subscribe((change) => changes.push(change));
    const outcome = applyCommand(
      store,
      batchCommand(mustFindCommand('setInstanceOverride'), 'overrides'),
      {
        overrides: [
          { id: instanceId, path: boxId, override: { fill: RED } },
          { id: instanceId, path: boxId, override: { isHidden: true } },
          { id: instanceId, path: boxId, override: { fill: BLUE } },
        ],
      },
    );
    expect(outcome.result).toEqual({
      overrides: [{ path: boxId }, { path: boxId }, { path: boxId }],
    });
    expect(fieldOf(store, instanceId, 'overrides')).toEqual({
      [boxId]: { fill: BLUE, isHidden: true },
    });
    expect(changes).toHaveLength(1);
    expect(history.undo()).toBe(true);
    expect(store.get(instanceId)).toEqual(before);
    expect(history.undo()).toBe(false);
    unsubscribe();
    history.destroy();
  });

  it('lets a later token item detect a duplicate made earlier in the batch', () => {
    const store = new YjsDocumentStore();
    const errors = expectRejected(store, batchCommand(mustFindCommand('setColorToken'), 'tokens'), {
      tokens: [
        { name: 'Brand', light: RED, dark: BLUE },
        { name: 'Brand', light: GREEN, dark: BLUE },
      ],
    });
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'duplicate-token-name', path: ['tokens', 1, 'name'] }),
    );
  });

  it('refuses all writes at a failing item with prefixed paths and byte-identical state', () => {
    const store = new YjsDocumentStore();
    const { mainId, boxId } = seedMainWithChildren(store);
    const instanceId = placeInstance(store, mainId, {
      x: 1000,
      y: 0,
      instanceId: 'batch-instance',
    });
    const errors = expectRejected(
      store,
      batchCommand(mustFindCommand('setInstanceOverride'), 'overrides'),
      {
        overrides: [
          { id: instanceId, path: boxId, override: { fill: RED } },
          { id: instanceId, path: boxId, override: { fill: BLUE } },
          { id: instanceId, path: 'missing', override: { fill: GREEN } },
        ],
      },
    );
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) expect(error.path.slice(0, 2)).toEqual(['overrides', 2]);
    expect(errors).toContainEqual(expect.objectContaining({ path: ['overrides', 2, 'path'] }));
  });

  it('refuses structural writes and list lengths outside 1 to 100', () => {
    const store = new YjsDocumentStore();
    const errors = expectRejected(store, batchCommand(createObjectCommand, 'objects'), {
      objects: [{ object: newRectangle('new-shape', null, { x: 0, y: 0, width: 20, height: 20 }) }],
    });
    expect(errors).toContainEqual(
      expect.objectContaining({ code: 'invalid-input', path: ['objects', 0] }),
    );
    const command = batchCommand(mustFindCommand('setColorToken'), 'tokens');
    for (const tokens of [
      [],
      Array.from({ length: 101 }, (value, index) => ({
        name: `T${String(index)}`,
        light: RED,
        dark: BLUE,
      })),
    ]) {
      expect(expectRejected(store, command, { tokens }).length).toBeGreaterThan(0);
    }
  });
});
