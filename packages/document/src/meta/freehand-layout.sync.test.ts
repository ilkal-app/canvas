// Freehand layout stores point arrays and preserves malformed records.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import * as document from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { setStyleCommand } from '../commands/set-style.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  exchange,
  RELAY,
} from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../store/yjs-document-store.js';

import { DOCUMENT_LAYOUT_VERSION, READABLE_LAYOUT_VERSIONS } from './document-meta.js';

const FREEHAND_LAYOUT_VERSION = Reflect.get(document, 'FREEHAND_LAYOUT_VERSION') as number;
const ID = 'freehand-one' as ObjectId;
const POINTS = [0, 0, 40, 10, 80, 0];
const PRESSURES = [0.2, 0.6, 0.9];

function create(store: YjsDocumentStore): void {
  applyCommand(store, createObjectCommand, {
    object: {
      id: ID,
      type: 'freehand',
      parentId: null,
      x: 20,
      y: 30,
      tool: 'marker',
      points: POINTS,
      pressures: PRESSURES,
      stroke: { color: 'ink', width: 8 },
    },
  } as never);
}

function rawMap(store: YjsDocumentStore): Y.Map<unknown> {
  const map = internalsOf(store).doc.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(ID);
  if (map === undefined) throw new Error('created freehand has no stored map');
  return map;
}

describe('freehand layout and sync', () => {
  it('writes layout 29 and keeps layout 28 readable', () => {
    expect(FREEHAND_LAYOUT_VERSION).toBe(29);
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(29);
    expect(READABLE_LAYOUT_VERSIONS).toContain(28);
  });

  it('stores points and pressures under their own plain keys, strokePoints and strokePressures', () => {
    const store = createFixtureStore();
    try {
      create(store);
      const map = rawMap(store);
      expect(map.get('strokePoints')).toEqual(POINTS);
      expect(map.get('strokePressures')).toEqual(PRESSURES);
      expect(map.get('strokePoints')).not.toBeInstanceOf(Y.AbstractType);
      expect(map.get('strokePressures')).not.toBeInstanceOf(Y.AbstractType);
    } finally {
      store.destroy();
    }
  });

  it('converges after one peer moves and the other restyles the freehand', () => {
    const ada = createFixtureStore();
    const bob = new YjsDocumentStore({ clientId: 200 });
    try {
      create(ada);
      exchange(ada, bob);
      expect(bob.get(ID)).toMatchObject({
        points: POINTS,
        pressures: PRESSURES,
        stroke: { color: 'ink', width: 8 },
      });
      applyCommand(ada, moveObjectsCommand, { moves: [{ id: ID, by: { x: 10, y: 15 } }] }, ADA);
      applyCommand(
        bob,
        setStyleCommand,
        { changes: [{ id: ID, style: { stroke: { color: [1, 0, 0, 1], width: 5 } } }] },
        BOB,
      );
      exchange(ada, bob);
      exchange(bob, ada);
      expect(ada.get(ID)).toEqual(bob.get(ID));
      expect(ada.get(ID)).toMatchObject({
        x: 30,
        y: 45,
        points: POINTS,
        pressures: PRESSURES,
        stroke: { color: [1, 0, 0, 1], width: 5 },
      });
    } finally {
      ada.destroy();
      bob.destroy();
    }
  });

  it('reads an odd-length stored stroke as a decode issue and leaves its raw bytes through an unrelated style write', () => {
    const store = createFixtureStore();
    try {
      create(store);
      const bad = new Y.Doc();
      Y.applyUpdate(bad, store.encodeState());
      const map = bad.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(ID);
      if (map === undefined) throw new Error('missing raw freehand');
      map.set('strokePoints', [0, 0, 1]);
      store.applyUpdate(Y.encodeStateAsUpdate(bad), RELAY);
      expect(store.get(ID)).toBeUndefined();
      expect(store.read().issues.some((issue) => issue.key === ID)).toBe(true);
      applyCommand(store, setStyleCommand, {
        changes: [{ id: 'shape-box', style: { fill: [0, 1, 0, 1] } }],
      });
      expect(rawMap(store).get('strokePoints')).toEqual([0, 0, 1]);
      bad.destroy();
    } finally {
      store.destroy();
    }
  });
});
