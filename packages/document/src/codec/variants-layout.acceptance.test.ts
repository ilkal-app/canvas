// Acceptance
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { VARIANTS_LAYOUT_VERSION } from '@canvas/document';
import { importBoard, type BoardObject } from '@canvas/schema';

import { DOCUMENT_LAYOUT_VERSION, READABLE_LAYOUT_VERSIONS } from '../meta/document-meta.js';

import { createFixtureBoardJson } from './__fixtures__/fixture-board-json.js';
import { toYjs } from './object-codec.js';
import { fromYjs } from './object-reader.js';

const AXES = [{ name: 'State', values: ['Idle', 'Busy'] }];
const PRESETS = { 'State=Busy': { 'text-title': { text: 'Busy', variant: { Size: 'Large' } } } };

/**
 * Integrates an encoded fixture as the object map in a Y.Doc.
 *
 * @param object - The fixture object.
 * @returns Its integrated map.
 */
function integrate(object: BoardObject): Y.Map<unknown> {
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(object.id, toYjs(object));
  return objects.get(object.id) as Y.Map<unknown>;
}

/**
 * Reads a stored object and fails the test on a codec issue.
 *
 * @param id - The stored object id.
 * @param map - The stored map.
 * @returns The decoded object.
 * @throws {Error} If the codec reports an issue.
 */
function read(id: string, map: Y.Map<unknown>): BoardObject {
  const decoded = fromYjs(id, map);
  if ('issue' in decoded) throw new Error(decoded.issue.message);
  return decoded.object;
}

/**
 * Gets an existing component or instance fixture.
 *
 * @param type - The fixture object type.
 * @returns The fixture object.
 * @throws {Error} If the fixture has no such object.
 */
function fixture(type: 'component' | 'instance'): BoardObject {
  const found = [...importBoard(createFixtureBoardJson(true)).objects.values()].find(
    (object) => object.type === type,
  );
  if (found === undefined) throw new Error(`missing ${type}`);
  return found;
}

describe('variant layout codec', () => {
  it('exports the new layout and declares it readable', () => {
    // Superseded by's swap layout: the variants layout is no longer the newest.
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(VARIANTS_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toContain(VARIANTS_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toContain(VARIANTS_LAYOUT_VERSION - 1);
  });

  it('round-trips axes in component style and presets as two levels of Y.Map', () => {
    const original = fixture('component');
    const object = { ...original, variantAxes: AXES, variantPresets: PRESETS } as BoardObject;
    const map = integrate(object);
    expect(map.get('style')).toMatchObject({ variantAxes: AXES });
    expect(map.has('variantAxes')).toBe(false);
    const presets = map.get('variantPresets');
    expect(presets).toBeInstanceOf(Y.Map);
    const paths = (presets as Y.Map<unknown>).get('State=Busy');
    expect(paths).toBeInstanceOf(Y.Map);
    expect((paths as Y.Map<unknown>).get('text-title')).toEqual(
      PRESETS['State=Busy']['text-title'],
    );
    expect((paths as Y.Map<unknown>).get('text-title')).not.toBeInstanceOf(Y.AbstractType);
    expect(read(object.id, map)).toEqual(object);
  });

  it('round-trips an instance selection as its own plain key and record selection inside overrides', () => {
    const original = fixture('instance');
    const object = {
      ...original,
      variant: { State: 'Busy' },
      overrides: { 'text-title': { variant: { Size: 'Large' } } },
    } as BoardObject;
    const map = integrate(object);
    expect(map.get('variant')).toEqual({ State: 'Busy' });
    expect(map.get('variant')).not.toBeInstanceOf(Y.AbstractType);
    expect(map.has('style')).toBe(false);
    expect((map.get('overrides') as Y.Map<unknown>).get('text-title')).toEqual({
      variant: { Size: 'Large' },
    });
    expect(read(object.id, map)).toEqual(object);
  });

  it.each(['different presets', 'different paths'] as const)(
    'keeps concurrent writes to %s',
    (kind) => {
      const original = fixture('component');
      const seed = new Y.Doc();
      seed.getMap<unknown>('objects').set(
        original.id,
        toYjs({
          ...original,
          variantAxes: AXES,
          variantPresets: {
            'State=Idle': { first: { isHidden: false } },
            'State=Busy': { first: { isHidden: false } },
          },
        } as BoardObject),
      );
      const left = new Y.Doc();
      const right = new Y.Doc();
      Y.applyUpdate(left, Y.encodeStateAsUpdate(seed));
      Y.applyUpdate(right, Y.encodeStateAsUpdate(seed));
      const leftPresets = (left.getMap('objects').get(original.id) as Y.Map<unknown>).get(
        'variantPresets',
      ) as Y.Map<unknown>;
      const rightPresets = (right.getMap('objects').get(original.id) as Y.Map<unknown>).get(
        'variantPresets',
      ) as Y.Map<unknown>;
      (leftPresets.get('State=Idle') as Y.Map<unknown>).set('left', { isHidden: true });
      const rightKey = kind === 'different presets' ? 'State=Busy' : 'State=Idle';
      (rightPresets.get(rightKey) as Y.Map<unknown>).set('right', { isHidden: true });
      Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
      Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
      for (const doc of [left, right]) {
        const map = doc.getMap('objects').get(original.id) as Y.Map<unknown>;
        const decoded = read(original.id, map);
        if (decoded.type !== 'component') throw new Error('not a component');
        expect(decoded.variantPresets?.['State=Idle']?.left).toEqual({ isHidden: true });
        expect(decoded.variantPresets?.[rightKey]?.right).toEqual({ isHidden: true });
      }
    },
  );

  it('skips each malformed preset entry alone while retaining valid neighbours', () => {
    const original = fixture('component');
    const map = integrate({
      ...original,
      variantAxes: AXES,
      variantPresets: { 'State=Busy': { first: { isHidden: true } } },
    } as BoardObject);
    const presets = map.get('variantPresets') as Y.Map<unknown>;
    const partlyValid = new Y.Map<unknown>();
    partlyValid.set('good', { isHidden: false });
    partlyValid.set('bad', { runs: [] });
    presets.set('State=Idle', partlyValid);
    presets.set('bad-key', new Y.Map());
    presets.set('State=Unknown', new Y.Map());
    const decoded = read(original.id, map);
    if (decoded.type !== 'component') throw new Error('not a component');
    expect(decoded.variantPresets).toEqual({
      'State=Busy': { first: { isHidden: true } },
      'State=Idle': { good: { isHidden: false } },
    });
  });
});
