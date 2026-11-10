import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { importBoard, type ComponentObject } from '@canvas/schema';

import { createFixtureBoardJson } from './__fixtures__/fixture-board-json.js';
import { toYjs, writeObject } from './object-codec.js';
import { fromYjs } from './object-reader.js';
import { readPresetsMap } from './presets-codec.js';

// Rewriting a main's presets in place: only changed presets and paths are written, so
// the maps others are editing stay the same Y.Maps; a main without presets drops the key.

const AXES = [{ name: 'state', values: ['rest', 'hover'] }];

/**
 * The fixture board's main with variants, stored in a document.
 *
 * @returns The main and its integrated map.
 * @throws {Error} When the fixture board has no main.
 */
function storedMain(): { readonly main: ComponentObject; readonly map: Y.Map<unknown> } {
  const found = [...importBoard(createFixtureBoardJson(true)).objects.values()].find(
    (object): object is ComponentObject => object.type === 'component',
  );
  if (found === undefined) throw new Error('missing main');
  const main: ComponentObject = {
    ...found,
    variantAxes: AXES,
    variantPresets: { 'state=rest': {}, 'state=hover': { a: { isHidden: true } } },
  };
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(main.id, toYjs(main));
  return { main, map: objects.get(main.id) as Y.Map<unknown> };
}

describe('writing a main whose presets are stored', () => {
  it('keeps each preset map and writes only what changed', () => {
    const { main, map } = storedMain();
    const presets = map.get('variantPresets') as Y.Map<unknown>;
    const hover = presets.get('state=hover');
    writeObject(map, {
      ...main,
      variantPresets: { 'state=hover': { a: { isHidden: false }, b: { isHidden: true } } },
    });
    expect(map.get('variantPresets')).toBe(presets);
    expect(presets.get('state=hover')).toBe(hover);
    expect(presets.has('state=rest')).toBe(false);
    expect(readPresetsMap(presets, AXES)).toEqual({
      'state=hover': { a: { isHidden: false }, b: { isHidden: true } },
    });
  });

  it('creates a preset map that a later write adds', () => {
    const { main, map } = storedMain();
    writeObject(map, {
      ...main,
      variantPresets: { ...main.variantPresets, 'state=rest': { a: { isHidden: true } } },
    });
    const decoded = fromYjs(main.id, map);
    expect('object' in decoded && decoded.object).toMatchObject({
      variantPresets: { 'state=rest': { a: { isHidden: true } } },
    });
  });

  it('adds a map for a new preset, and the whole field to a main that had none', () => {
    const { main, map } = storedMain();
    const axes = [{ name: 'state', values: ['rest', 'hover', 'open'] }];
    writeObject(map, {
      ...main,
      variantAxes: axes,
      variantPresets: { ...main.variantPresets, 'state=open': { a: { isHidden: true } } },
    });
    expect(readPresetsMap(map.get('variantPresets'), axes)).toMatchObject({
      'state=open': { a: { isHidden: true } },
    });
    const bare: Partial<ComponentObject> = { ...main };
    delete bare.variantPresets;
    delete bare.variantAxes;
    const objects = new Y.Doc().getMap<unknown>('objects');
    objects.set(main.id, toYjs(bare as ComponentObject));
    const stored = objects.get(main.id) as Y.Map<unknown>;
    expect(stored.has('variantPresets')).toBe(false);
    writeObject(stored, main);
    expect(readPresetsMap(stored.get('variantPresets'), AXES)).toEqual(main.variantPresets);
  });

  it('drops the key when the main no longer has presets', () => {
    const { main, map } = storedMain();
    const rest: Partial<ComponentObject> = { ...main };
    delete rest.variantPresets;
    delete rest.variantAxes;
    writeObject(map, rest as ComponentObject);
    expect(map.has('variantPresets')).toBe(false);
  });

  it('skips stored entries no main could use, keeping the rest', () => {
    const { map } = storedMain();
    const presets = map.get('variantPresets') as Y.Map<unknown>;
    presets.set('nonsense', new Y.Map());
    presets.set('state=hover', 'not a map');
    (presets.get('state=rest') as Y.Map<unknown>).set('a', { isHidden: 'yes' });
    (presets.get('state=rest') as Y.Map<unknown>).set('b', new Y.Map());
    expect(readPresetsMap(presets, AXES)).toEqual({ 'state=rest': {} });
    expect(readPresetsMap('not a map', AXES)).toBe('the variant presets are not a keyed map');
  });
});
