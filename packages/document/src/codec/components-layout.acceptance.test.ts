// Acceptance, the stored layout 5:
// the layout constants, the keys an instance's and a component's `Y.Map` hold, constraints
// absent by default and on their own key otherwise, old objects decoded without `constraints`,
// and the portable migration step 4.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { MIGRATIONS, type BoardObject } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { placeInstance, seedMainWithChildren } from '../commands/__fixtures__/component-boards.js';
import { mustFindCommand, schemaFunction } from '../commands/__fixtures__/component-fixtures.js';
import {
  createDocumentMeta,
  DOCUMENT_LAYOUT_VERSION,
  READABLE_LAYOUT_VERSIONS,
} from '../meta/document-meta.js';
import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

/**
 * The raw `Y.Map` of a stored object.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @returns Its map.
 * @throws {Error} When the objects map holds no `Y.Map` under that id.
 */
function rawMapOf(store: DocumentStore, objectId: string): Y.Map<unknown> {
  const map = internalsOf(store).objects.get(objectId);
  if (!(map instanceof Y.Map)) throw new Error(`no stored map "${objectId}"`);
  return map;
}

describe('layout 5', () => {
  it('stays readable after later layouts (writes 6), as does every earlier layout', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(5);
    expect([...READABLE_LAYOUT_VERSIONS]).toEqual(expect.arrayContaining([1, 2, 3, 4, 5]));
    expect(createDocumentMeta().layoutVersion).toBe(DOCUMENT_LAYOUT_VERSION);
  });

  it('has a portable migration step 4', () => {
    expect(MIGRATIONS.has(4)).toBe(true);
    expect(MIGRATIONS.get(4)?.({ schemaVersion: 3, objects: [] })).toMatchObject({ objects: [] });
  });

  it('stores an instance’s main in identity and its overrides as a map of plain records by path', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId, boxId } = seedMainWithChildren(store);
    const instanceId = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const set = mustFindCommand('setInstanceOverride');
    applyCommand(store, set, { id: instanceId, path: noteId, override: { color: [0, 0, 1, 1] } });
    applyCommand(store, set, { id: instanceId, path: boxId, override: { fill: [0, 1, 0, 1] } });
    const map = rawMapOf(store, instanceId);
    expect(map.get('identity')).toMatchObject({ id: instanceId, type: 'instance', mainId });
    const overrides = map.get('overrides');
    expect(overrides).toBeInstanceOf(Y.Map);
    const records = overrides as Y.Map<unknown>;
    expect([...records.keys()].sort()).toEqual([boxId, noteId].sort());
    expect(records.get(noteId)).toEqual({ color: [0, 0, 1, 1] });
    expect(records.get(noteId)).not.toBeInstanceOf(Y.AbstractType);
    expect(records.get(boxId)).toEqual({ fill: [0, 1, 0, 1] });
    expect(map.has('constraints')).toBe(false);
    expect(map.get('size')).toEqual({ width: 400, height: 300 });
  });

  it('stores a component’s retired flag under its own key', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    const map = rawMapOf(store, mainId);
    expect(map.get('identity')).toMatchObject({ id: mainId, type: 'component' });
    expect(map.has('retired')).toBe(true);
    expect(map.get('retired')).toBe(false);
    expect(map.has('constraints')).toBe(false);
  });

  it('stores constraints on their own key and removes the key at start/start', () => {
    const store = new YjsDocumentStore();
    const { boxId } = seedMainWithChildren(store);
    const command = mustFindCommand('setConstraints');
    applyCommand(store, command, { ids: [boxId], x: 'stretch', y: 'end' });
    const map = rawMapOf(store, boxId);
    expect(map.get('constraints')).toEqual({ x: 'stretch', y: 'end' });
    applyCommand(store, command, { ids: [boxId], x: 'start', y: 'start' });
    expect(map.has('constraints')).toBe(false);
    expect('constraints' in mustGet(store, boxId)).toBe(false);
  });

  it('decodes an object stored without constraints with no constraints property', () => {
    const store = createFixtureStore();
    const object = mustGet(store, 'shape-box');
    expect(rawMapOf(store, 'shape-box').has('constraints')).toBe(false);
    expect('constraints' in object).toBe(false);
    const effectiveConstraints = schemaFunction('effectiveConstraints') as (
      object: BoardObject,
    ) => { x: string; y: string };
    expect(effectiveConstraints(object)).toEqual({ x: 'start', y: 'start' });
    expect(effectiveConstraints(mustGet(store, 'frame-plan'))).toEqual({ x: 'start', y: 'start' });
  });
});
