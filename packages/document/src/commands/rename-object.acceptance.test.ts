import { describe, expect, it } from 'vitest';

import { copySelection } from '../duplicate/copy-selection.js';
import { planDuplicate } from '../duplicate/duplicate-plan.js';
import { planPaste } from '../duplicate/paste-plan.js';
import { createHistory } from '../history/undo-manager.js';
import * as document from '../index.js';
import {
  ADA,
  createFixtureStore,
  exchange,
  id,
  RELAY,
} from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  testEnvironment,
} from './__fixtures__/command-fixtures.js';
import { componentObject, instanceObject } from './__fixtures__/component-fixtures.js';
import { createObjectCommand } from './create-object.js';
import { createObjectsCommand } from './create-objects.js';
import { findCommand } from './registry.js';
import type { renameFrameCommand } from './rename-frame.js';

/**
 * Finds the planned public command without a missing-export type error on main.
 *
 * @returns The rename command.
 * @throws {Error} When the planned export is absent.
 */
function renameObjectCommand(): typeof renameFrameCommand {
  const command = (document as unknown as Record<string, unknown>).renameObjectCommand;
  if (command === undefined) throw new Error('missing export: renameObjectCommand');
  return command as typeof renameFrameCommand;
}

/**
 * Reads a name without assuming the earlier BoardObject type includes it.
 *
 * @param store - The board.
 * @param objectId - The object.
 * @returns Its name, when present.
 */
function nameOf(store: YjsDocumentStore, objectId: string): unknown {
  return (mustGet(store, objectId) as unknown as Record<string, unknown>).name;
}

/**
 * The legacy fixture plus one main and its instance.
 *
 * @returns The seeded store.
 */
function namedTypesStore(): YjsDocumentStore {
  const store = createFixtureStore();
  store.transact(ADA, (transaction) => {
    transaction.setObject(
      componentObject('main-name', { x: 2000, y: 0, width: 100, height: 100 }, 'Main'),
    );
    transaction.setObject(
      instanceObject('instance-name', 'main-name', { x: 2200, y: 0, width: 100, height: 100 }),
    );
  });
  return store;
}

const CASES = [
  ['shape', 'shape-box'],
  ['text', 'text-title'],
  ['group', 'group-diagram'],
  ['image', 'image-photo'],
  ['line', 'line-divider'],
  ['instance', 'instance-name'],
  ['frame', 'frame-plan'],
  ['component', 'main-name'],
] as const;

describe('renameObject', () => {
  it('is exported with the registered name', () => {
    const command = renameObjectCommand();
    expect(command.name).toBe('renameObject');
    expect(findCommand('renameObject')).toBe(command);
  });

  for (const [type, objectId] of CASES) {
    it(`renames a ${type}, writes nothing for the same name, and clears it correctly`, () => {
      const store = namedTypesStore();
      const command = renameObjectCommand();
      const before = store.read();
      const changed = applyCommand(store, command, { id: objectId, name: 'New label' });
      expect(changed.result).toEqual({ isChanged: true });
      expectDiff(before, store.read(), changed.changes, { updated: [objectId] });
      expect(nameOf(store, objectId)).toBe('New label');
      const same = store.read();
      const repeated = applyCommand(store, command, { id: objectId, name: 'New label' });
      expect(repeated.result).toEqual({ isChanged: false });
      expectDiff(same, store.read(), repeated.changes, {});
      applyCommand(store, command, { id: objectId, name: '' });
      const cleared = mustGet(store, objectId) as unknown as Record<string, unknown>;
      if (type === 'frame' || type === 'component') expect(cleared.name).toBe('');
      else expect(Object.hasOwn(cleared, 'name')).toBe(false);
      store.destroy();
    });
  }

  it('refuses missing and overlong renames without writing', () => {
    const store = namedTypesStore();
    const command = renameObjectCommand();
    expect(expectRejected(store, command, { id: 'absent', name: 'A' }).map((e) => e.code)).toEqual([
      'missing-object',
    ]);
    expect(
      expectRejected(store, command, { id: 'shape-box', name: 'n'.repeat(201) }).map((e) => e.code),
    ).toEqual(['invalid-input']);
    store.destroy();
  });

  it('renames a locked object, as renameFrame does (lock covers position, size and rotation)', () => {
    const store = namedTypesStore();
    applyCommand(store, renameObjectCommand(), { id: 'shape-star', name: 'Star' });
    expect(nameOf(store, 'shape-star')).toBe('Star');
    store.destroy();
  });

  it('is one undo step, can redo, and converges after exchange', () => {
    const first = namedTypesStore();
    const second = new YjsDocumentStore();
    second.applyUpdate(first.encodeState(), RELAY);
    const history = createHistory(first, ADA.principalId);
    const original = nameOf(first, 'shape-box');
    applyCommand(first, renameObjectCommand(), { id: 'shape-box', name: 'Synced label' });
    exchange(first, second);
    expect(nameOf(second, 'shape-box')).toBe('Synced label');
    expect(history.undo()).toBe(true);
    expect(nameOf(first, 'shape-box')).toBe(original);
    expect(history.redo()).toBe(true);
    exchange(first, second);
    expect(first.read().objects).toEqual(second.read().objects);
    first.destroy();
    second.destroy();
  });

  it('carries a name through createObject, createObjects paste, and duplicate', () => {
    const store = createFixtureStore();
    const shape = {
      type: 'shape' as const,
      parentId: null,
      x: 1700,
      y: 0,
      width: 40,
      height: 30,
      kind: 'rectangle' as const,
      stroke: null,
      fill: null,
      cornerRadius: 0,
      sides: 4,
      label: null,
      name: 'Copy me',
    };
    const created = applyCommand(
      store,
      createObjectCommand,
      { object: shape },
      ADA,
      testEnvironment(11),
    ).result.id;
    expect(nameOf(store, created)).toBe('Copy me');
    const copied = copySelection(store.read(), [created]);
    if (copied === undefined) throw new Error('copy failed');
    const pasted = applyCommand(
      store,
      createObjectsCommand,
      { objects: planPaste(copied, undefined), parentId: null },
      ADA,
      testEnvironment(12),
    ).result.ids;
    expect(nameOf(store, pasted[0] ?? '')).toBe('Copy me');
    const duplicate = planDuplicate(store.read(), [created]);
    if (duplicate === undefined) throw new Error('duplicate plan failed');
    const duplicated = applyCommand(
      store,
      createObjectsCommand,
      duplicate,
      ADA,
      testEnvironment(13),
    ).result.ids;
    expect(nameOf(store, duplicated[0] ?? '')).toBe('Copy me');
    store.destroy();
  });

  for (const [type, objectId] of CASES) {
    it(`carries a ${type} name through both create commands, paste, and duplicate`, () => {
      const store = namedTypesStore();
      applyCommand(store, renameObjectCommand(), { id: objectId, name: 'Copied name' });
      const copied = copySelection(store.read(), [id(objectId)]);
      if (copied === undefined) throw new Error(`copy failed for ${type}`);
      const planned = planPaste(copied, undefined);
      const original = planned[0];
      if (original === undefined) throw new Error(`empty paste for ${type}`);
      const { id: listedId, ...entry } = original;
      expect(listedId).toBeDefined();
      const created = applyCommand(
        store,
        createObjectCommand,
        { object: entry },
        ADA,
        testEnvironment(11),
      ).result.id;
      expect(nameOf(store, created)).toBe('Copied name');
      const pasted = applyCommand(
        store,
        createObjectsCommand,
        { objects: planned, parentId: null },
        ADA,
        testEnvironment(12),
      ).result.ids;
      expect(nameOf(store, pasted[0] ?? '')).toBe('Copied name');
      const duplicate = planDuplicate(store.read(), [id(objectId)]);
      if (duplicate === undefined) throw new Error(`duplicate failed for ${type}`);
      const duplicated = applyCommand(
        store,
        createObjectsCommand,
        duplicate,
        ADA,
        testEnvironment(13),
      ).result.ids;
      expect(nameOf(store, duplicated[0] ?? '')).toBe('Copied name');
      store.destroy();
    });
  }
});
