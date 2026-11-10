import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { importBoard, type BoardObject } from '@canvas/schema';

import { DOCUMENT_LAYOUT_VERSION, READABLE_LAYOUT_VERSIONS } from '../meta/document-meta.js';
import { fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import { createFixtureBoardJson } from './__fixtures__/fixture-board-json.js';
import { toYjs } from './object-codec.js';
import { layoutOf } from './object-layout.js';
import { fromYjs } from './object-reader.js';

const AUTO_LAYOUT = {
  direction: 'row' as const,
  gap: 8,
  padding: { top: 1, right: 2, bottom: 3, left: 4 },
  align: 'center' as const,
  justify: 'space-between' as const,
  width: 'fixed' as const,
  height: 'hug' as const,
};

/**
 * Integrates an object map in a Yjs document as the store does.
 *
 * @param object - The object to encode.
 * @returns Its integrated map.
 */
function integrate(object: BoardObject): Y.Map<unknown> {
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(object.id, toYjs(object));
  return objects.get(object.id) as Y.Map<unknown>;
}

/**
 * Decodes an integrated object or throws its issue.
 *
 * @param id - The object's key in the object map.
 * @param map - The stored object map.
 * @returns The decoded object.
 * @throws {Error} If the codec reports an issue.
 */
function read(id: string, map: Y.Map<unknown>): BoardObject {
  const decoded = fromYjs(id, map);
  if ('issue' in decoded) throw new Error(decoded.issue.message);
  return decoded.object;
}

/**
 * Finds a component fixture or an instance fixture by type.
 *
 * @param type - The fixture type.
 * @returns The fixture object.
 * @throws {Error} If the fixture has no object of that type.
 */
function componentFixture(type: 'component' | 'instance'): BoardObject {
  const object = [...importBoard(createFixtureBoardJson(true)).objects.values()].find(
    (candidate) => candidate.type === type,
  );
  if (object === undefined) throw new Error(`missing ${type} fixture`);
  return object;
}

describe('auto-layout in the grouped document codec', () => {
  it('keeps the document layout version at the end of the existing readable list', () => {
    expect(READABLE_LAYOUT_VERSIONS.at(-1)).toBe(DOCUMENT_LAYOUT_VERSION);
    expect(DOCUMENT_LAYOUT_VERSION).toBe(READABLE_LAYOUT_VERSIONS.length);
  });

  it.each(['frame', 'component'] as const)(
    'round-trips %s autoLayout in style without a new key',
    (type) => {
      const original =
        type === 'frame' ? fixtureObject('frame-plan', 'frame') : componentFixture('component');
      const object = { ...original, autoLayout: AUTO_LAYOUT } as BoardObject;
      const map = integrate(object);
      expect([...map.keys()].sort()).toEqual([...integrate(original).keys()].sort());
      expect(map.get('style')).toMatchObject({ autoLayout: AUTO_LAYOUT });
      expect(map.has('autoLayout')).toBe(false);
      const styleCodec = layoutOf(type)?.codecs.find(
        (codec) => codec.kind === 'group' && codec.key === 'style',
      );
      expect(styleCodec?.kind === 'group' && styleCodec.fields.includes('autoLayout')).toBe(true);
      expect(read(object.id, map)).toEqual(object);
      expect(read(original.id, integrate(original))).toEqual(original);
    },
  );

  it('round-trips layoutChild in the existing size group of every box type', () => {
    const objects = [...importBoard(createFixtureBoardJson(true)).objects.values()];
    for (const type of [
      'text',
      'sticky',
      'image',
      'video',
      'shape',
      'frame',
      'component',
      'instance',
    ] as const) {
      const original = objects.find((candidate) => candidate.type === type);
      if (original === undefined) throw new Error(`missing ${type} fixture`);
      const object = { ...original, layoutChild: { fill: true } } as BoardObject;
      const map = integrate(object);
      expect([...map.keys()].sort()).toEqual([...integrate(original).keys()].sort());
      expect(map.get('size')).toMatchObject({ layoutChild: { fill: true } });
      expect(map.has('layoutChild')).toBe(false);
      expect(read(object.id, map)).toEqual(object);
      expect(read(original.id, integrate(original))).toEqual(original);
    }
  });

  it('round-trips instance fixed-size flags in size and measuredSize in an override record', () => {
    const original = componentFixture('instance');
    const object = {
      ...original,
      isWidthFixed: true,
      isHeightFixed: false,
      overrides: { 'text-title': { measuredSize: { width: 75, height: 32, fonts: 'Inter' } } },
    } as BoardObject;
    const map = integrate(object);
    expect([...map.keys()].sort()).toEqual([...integrate(original).keys()].sort());
    expect(map.get('size')).toMatchObject({ isWidthFixed: true, isHeightFixed: false });
    expect(map.has('style')).toBe(false);
    expect(integrate(original).has('style')).toBe(false);
    expect(map.has('isWidthFixed')).toBe(false);
    expect(map.has('isHeightFixed')).toBe(false);
    expect(map.has('overrides')).toBe(true);
    expect(read(object.id, map)).toEqual(object);
    expect(read(original.id, integrate(original))).toEqual(original);
  });
});
