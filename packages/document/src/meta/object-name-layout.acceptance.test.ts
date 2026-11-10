import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { OBJECT_TYPES, type BoardObject, type ObjectType } from '@canvas/schema';

import * as document from '../index.js';
import { ADA, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { DOCUMENT_LAYOUT_VERSION, READABLE_LAYOUT_VERSIONS } from './document-meta.js';

/**
 * One valid object of each kind, with small deterministic geometry.
 *
 * @param type - The object type.
 * @param id - Its id.
 * @param name - Its optional name.
 * @returns The object.
 */
function sampleObject(type: ObjectType, id: string, name?: string): BoardObject {
  const shared = {
    id,
    parentId: null,
    x: 10,
    y: 20,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...(name === undefined ? {} : { name }),
  };
  const style = {
    fontFamily: 'Inter',
    fontSize: 24,
    color: [0, 0, 0, 1],
    weight: 400,
    italic: false,
  };
  const stroke = { color: [0, 0, 0, 1], width: 2 };
  const fields: Record<ObjectType, Record<string, unknown>> = {
    freehand: { tool: 'pencil', points: [0, 0, 10, 10], stroke },
    link: {
      width: 320,
      height: 280,
      url: 'https://example.com/',
      title: '',
      description: '',
      siteName: '',
      layout: 'vertical',
      status: 'pending',
      unfurlKey: 'paste',
    },
    component: { width: 200, height: 100, name: name ?? 'Main', retired: false },
    instance: { width: 200, height: 100, mainId: 'main', overrides: {} },
    text: {
      width: 100,
      height: 30,
      text: 'Hi',
      runs: [{ length: 2, style }],
      align: 'left',
      autoWidth: true,
      verticalAlign: 'top',
    },
    sticky: {
      width: 100,
      height: 100,
      text: '',
      runs: [{ length: 0, style }],
      align: 'center',
      autoWidth: false,
      verticalAlign: 'middle',
      color: [1, 1, 0, 1],
    },
    image: {
      width: 100,
      height: 100,
      assetId: 'asset',
      crop: { x: 0, y: 0, width: 1, height: 1 },
      naturalSize: { width: 100, height: 100 },
      opacity: 1,
    },
    video: {
      width: 100,
      height: 100,
      assetId: 'asset',
      poster: null,
      loop: false,
      muted: true,
      trim: null,
    },
    shape: {
      width: 100,
      height: 80,
      kind: 'rectangle',
      stroke,
      fill: null,
      cornerRadius: 0,
      sides: 4,
      label: null,
    },
    line: {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      route: 'straight',
      stroke,
      startCap: 'none',
      endCap: 'arrow',
    },
    connector: {
      from: { kind: 'point', x: 0, y: 0 },
      to: { kind: 'point', x: 50, y: 50 },
      route: 'straight',
      stroke,
      startCap: 'none',
      endCap: 'arrow',
      label: null,
    },
    path: { vertices: [], segments: [], stroke, fill: null },
    group: {},
    frame: { width: 100, height: 100, name: name ?? 'Frame', clip: false, background: null },
    comment: { threadId: 'thread', anchor: { kind: 'point' } },
  };
  return { ...shared, type, ...fields[type] } as unknown as BoardObject;
}

/**
 * Reads a planned public constant while this suite compiles on the preceding layout.
 *
 * @returns The object name layout version.
 * @throws {Error} When the planned export is absent.
 */
function objectNameLayoutVersion(): number {
  const value = (document as unknown as Record<string, unknown>).OBJECT_NAME_LAYOUT_VERSION;
  if (typeof value !== 'number') {
    throw new Error('missing export: OBJECT_NAME_LAYOUT_VERSION');
  }
  return value;
}

describe('object name stored layout', () => {
  it('makes the name layout current and keeps its predecessor readable', () => {
    const version = objectNameLayoutVersion();
    // This layout or a later one, once a later gate lands.
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(version);
    expect(READABLE_LAYOUT_VERSIONS).toContain(version - 1);
  });

  for (const type of OBJECT_TYPES) {
    it(`round trips a named ${type} through the stored style group`, () => {
      const id = `named-${type}`;
      const source = new YjsDocumentStore();
      source.transact(ADA, (transaction) => {
        if (type === 'instance') transaction.setObject(sampleObject('component', 'main'));
        transaction.setObject(sampleObject(type, id, 'Shared label'));
        if (type !== 'frame' && type !== 'component') {
          transaction.setObject(sampleObject(type, `unnamed-${type}`));
        }
      });
      const raw = internalsOf(source).objects.get(id);
      expect(raw).toBeInstanceOf(Y.Map);
      expect((raw as Y.Map<unknown>).get('style')).toMatchObject({ name: 'Shared label' });

      const peer = new YjsDocumentStore();
      peer.applyUpdate(source.encodeState(), RELAY);
      expect(peer.get(id as Parameters<typeof peer.get>[0])).toMatchObject({
        name: 'Shared label',
      });
      if (type !== 'frame' && type !== 'component') {
        const unnamed = peer.get(`unnamed-${type}` as Parameters<typeof peer.get>[0]);
        expect(unnamed).toBeDefined();
        expect(Object.hasOwn(unnamed ?? {}, 'name')).toBe(false);
      }
      peer.destroy();
      source.destroy();
    });
  }

  it('gives an unnamed group no name key, while a named group gains style', () => {
    const store = new YjsDocumentStore();
    store.transact(ADA, (transaction) => {
      transaction.setObject(sampleObject('group', 'unnamed'));
      transaction.setObject(sampleObject('group', 'named', 'Cluster'));
    });
    const unnamed = store.get('unnamed' as Parameters<typeof store.get>[0]);
    expect(unnamed).toBeDefined();
    expect(Object.hasOwn(unnamed ?? {}, 'name')).toBe(false);
    const unnamedRaw = internalsOf(store).objects.get('unnamed') as Y.Map<unknown>;
    const namedRaw = internalsOf(store).objects.get('named') as Y.Map<unknown>;
    expect(unnamedRaw.has('style')).toBe(false);
    expect(namedRaw.get('style')).toMatchObject({ name: 'Cluster' });
    store.destroy();
  });
});
