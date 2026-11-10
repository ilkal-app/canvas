import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { validateBoard } from '@canvas/schema';

import { createFrameClients, hostileUpdate } from '../repair/__fixtures__/cycle-fixtures.js';

import { ADA, createFixtureStore, id, RELAY } from './__fixtures__/store-fixtures.js';
import type { DocumentUpdate } from './document-store.js';
import { YjsDocumentStore } from './yjs-document-store.js';

describe('read-only automatic repair mode', () => {
  it.each(['missing-parent', 'parent-cycle'] as const)(
    'shows the same repaired %s view without changing persisted history',
    (kind) => {
      const [source, editor] = createFrameClients([1, 2]) as [YjsDocumentStore, YjsDocumentStore];
      const viewer = new YjsDocumentStore({ repairMode: 'read-only' });
      viewer.applyUpdate(source.encodeState(), RELAY);
      const updates: DocumentUpdate[] = [];
      viewer.subscribeUpdates((update) => updates.push(update));
      const update = hostileUpdate(
        source,
        kind === 'missing-parent'
          ? { 'frame-outer': null }
          : {
              'frame-outer': { placement: { parentId: 'frame-side' } },
              'frame-side': { placement: { parentId: 'frame-outer' } },
            },
      );
      const expected = new Y.Doc();
      Y.applyUpdate(expected, source.encodeState());
      Y.applyUpdate(expected, update);
      viewer.applyUpdate(update, RELAY);
      editor.applyUpdate(update, RELAY);
      expect(updates.filter(({ isLocal }) => isLocal)).toEqual([]);
      expect(viewer.encodeState()).toEqual(Y.encodeStateAsUpdate(expected));
      expect(new Map(viewer.read().objects)).toEqual(new Map(editor.read().objects));
      expect(validateBoard(viewer.read())).toEqual([]);
      for (const store of [source, editor, viewer]) store.destroy();
      expected.destroy();
    },
  );
  it('reprojects repeated changes, detaches endpoints and comments, and preserves bytes', () => {
    const source = createFixtureStore();
    const viewer = new YjsDocumentStore({ repairMode: 'read-only' });
    const editor = new YjsDocumentStore();
    viewer.applyUpdate(source.encodeState(), RELAY);
    editor.applyUpdate(source.encodeState(), RELAY);
    const raw = new Y.Doc();
    Y.applyUpdate(raw, source.encodeState());
    const changes = [
      { 'sticky-idea': null, 'shape-box': null, 'image-photo': null },
      { 'frame-plan': { placement: { x: 40 } } },
      { 'frame-plan': { placement: { x: 50 } } },
    ];
    source.setRepairMode('read-only');
    for (const change of changes) {
      const update = hostileUpdate(source, change);
      source.applyUpdate(update, RELAY);
      viewer.applyUpdate(update, RELAY);
      editor.applyUpdate(update, RELAY);
      Y.applyUpdate(raw, update);
      expect(new Map(viewer.read().objects)).toEqual(new Map(editor.read().objects));
      expect(viewer.encodeState()).toEqual(Y.encodeStateAsUpdate(raw));
    }
    // Role changes materialize through normal validated writes, and future remote changes work.
    viewer.setRepairMode('write');
    expect(new Map(viewer.read().objects)).toEqual(new Map(editor.read().objects));
    expect(viewer.encodeState()).not.toEqual(Y.encodeStateAsUpdate(raw));
    for (const store of [source, viewer, editor]) store.destroy();
    raw.destroy();
  });

  it('keeps explicit local edits available while automatic repair stays read-only', () => {
    const [source] = createFrameClients([1]);
    if (source === undefined) throw new Error('missing fixture');
    source.setRepairMode('read-only');
    const before = source.encodeState();
    source.transact(ADA, (transaction) => {
      transaction.patchObject(id('frame-side'), { locked: true });
    });
    expect(source.get(id('frame-side'))?.locked).toBe(true);
    expect(source.encodeState()).not.toEqual(before);
    source.destroy();
  });
  it('reports virtual deletion and restoration through their lifecycle lists', () => {
    const source = createFixtureStore();
    const viewer = new YjsDocumentStore({ repairMode: 'read-only' });
    viewer.applyUpdate(source.encodeState(), RELAY);
    const connector = id('connector-flow');
    const deleted: string[] = [];
    const created: string[] = [];
    viewer.subscribe((changes) => {
      deleted.push(...changes.deleted);
      created.push(...changes.created);
    });
    viewer.applyUpdate(hostileUpdate(source, { 'sticky-idea': null, 'shape-box': null }), RELAY);
    expect(viewer.get(connector)).toBeUndefined();
    expect(deleted).toContain(connector);
    viewer.setRepairMode('write');
    // The restored raw connector is then deleted by the writer's normal repair transaction.
    expect(created).toContain(connector);
    expect(deleted.filter((value) => value === connector)).toHaveLength(2);
    expect(viewer.get(connector)).toBeUndefined();
    source.destroy();
    viewer.destroy();
  });

  it.each([false, true])('preserves a single listener failure when isLocal=%s', (isLocal) => {
    const [source] = createFrameClients([1]);
    if (source === undefined) throw new Error('missing fixture');
    const viewer = new YjsDocumentStore({ repairMode: 'read-only' });
    viewer.applyUpdate(source.encodeState(), RELAY);
    viewer.applyUpdate(hostileUpdate(source, { 'frame-outer': null }), RELAY);
    const before = viewer.encodeState();
    const failure = new Error('observer failed');
    viewer.subscribe((changes) => {
      if (changes.isLocal === isLocal) throw failure;
    });
    expect(() => {
      viewer.setRepairMode('write');
    }).toThrow(failure);
    expect(viewer.encodeState()).not.toEqual(before);
    expect(validateBoard(viewer.read())).toEqual([]);
    source.destroy();
    viewer.destroy();
  });

  it('still materializes a role-transition repair when view listeners throw', () => {
    const [source] = createFrameClients([1]);
    if (source === undefined) throw new Error('missing fixture');
    const viewer = new YjsDocumentStore({ repairMode: 'read-only' });
    viewer.applyUpdate(source.encodeState(), RELAY);
    viewer.applyUpdate(hostileUpdate(source, { 'frame-outer': null }), RELAY);
    const before = viewer.encodeState();
    const failure = new Error('observer failed');
    viewer.subscribe(() => {
      throw failure;
    });
    expect(() => {
      viewer.setRepairMode('write');
    }).toThrow(AggregateError);
    expect(viewer.encodeState()).not.toEqual(before);
    expect(validateBoard(viewer.read())).toEqual([]);
    source.destroy();
    viewer.destroy();
  });
});
