import { describe, expect, it } from 'vitest';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import { createObjectsCommand } from './create-objects.js';

// A main written as a component set is drawn as its default combination, every
// instance keeping what it drew; what cannot be drawn on the main is refused.

const RED = [1, 0, 0, 1];
const BLUE = [0, 0, 1, 1];
const GREEN = [0, 1, 0, 1];

/**
 * A listed shape.
 *
 * @param id - Its listed id.
 * @param fields - Fields over the defaults.
 * @returns The entry.
 */
function box(id: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'shape',
    id,
    parentId: 'main',
    name: id,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    kind: 'rectangle',
    fill: RED,
    stroke: null,
    cornerRadius: 0,
    sides: 4,
    label: null,
    ...fields,
  };
}

/**
 * A listed main with one axis and the presets given.
 *
 * @param presets - Its presets by `axis=value`.
 * @returns The entry.
 */
function main(presets: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'component',
    id: 'main',
    parentId: null,
    name: 'Main',
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    retired: false,
    variantAxes: [{ name: 'tone', values: ['calm', 'warm', 'loud'] }],
    variantPresets: presets,
  };
}

/**
 * Creates the entries with `main` drawn as a set.
 *
 * @param entries - The listed entries.
 * @returns The store and the new ids by listed id.
 */
function created(entries: readonly Record<string, unknown>[]): {
  readonly store: YjsDocumentStore;
  readonly ids: Record<string, string>;
} {
  const store = new YjsDocumentStore();
  const { result } = applyCommand(store, createObjectsCommand, {
    objects: entries as never,
    drawnDefaults: ['main'],
  });
  const ids: Record<string, string> = {};
  entries.forEach((entry, index) => {
    ids[String(entry.id)] = String(result.ids[index]);
  });
  return { store, ids };
}

describe('a component set main drawn as its default', () => {
  it('draws the default records on the main and gives the other values them back', () => {
    const { store, ids } = created([
      main({
        'tone=calm': { a: { fill: BLUE, isHidden: true }, main: { width: 60 } },
        'tone=loud': { a: { fill: GREEN } },
      }),
      box('a'),
    ]);
    const [mainId, a] = [ids.main ?? '', ids.a ?? ''];
    expect(store.get(a as never)).toMatchObject({ fill: BLUE, isHidden: true });
    expect(store.get(mainId as never)).toMatchObject({ width: 60 });
    expect(store.get(mainId as never)).toMatchObject({
      variantPresets: {
        // The default's own records stay, as instances compose them.
        'tone=calm': { [a]: { fill: BLUE, isHidden: true }, [mainId]: { width: 60 } },
        // A value without the field gets the main's previous value back.
        'tone=warm': { [a]: { fill: RED, isHidden: false }, [mainId]: { width: 40 } },
        // A value with its own fill keeps it, and gets the rest back.
        'tone=loud': { [a]: { fill: GREEN, isHidden: false }, [mainId]: { width: 40 } },
      },
    });
    store.destroy();
  });

  it('refuses a default field another axis sets too, at any value', () => {
    const store = new YjsDocumentStore();
    const twoAxes = {
      ...main({ 'tone=calm': { a: { fill: BLUE } }, 'size=big': { a: { fill: GREEN } } }),
      variantAxes: [
        { name: 'tone', values: ['calm', 'warm'] },
        { name: 'size', values: ['small', 'big'] },
      ],
    };
    const errors = expectRejected(store, createObjectsCommand, {
      objects: [twoAxes, box('a')],
      drawnDefaults: ['main'],
    });
    expect(errors.map((error) => error.message).join(' ')).toContain('which size also sets');
    store.destroy();
  });

  it.each([
    ['text', { a: { text: 'x' } }, 'write the default text in the main'],
    ['a nested path', { 'inner/c': { fill: BLUE } }, 'nested instance'],
    ['an undrawn field', { photo: { assetId: 'asset-2' } }, 'does not draw'],
    ['a field with no value to give back', { a: { strokeColor: BLUE } }, 'none to give back'],
  ])('refuses a default that sets %s', (unused, record, message) => {
    const store = new YjsDocumentStore();
    const other = { ...main({}), id: 'other', name: 'Other', x: 200 };
    Reflect.deleteProperty(other, 'variantAxes');
    Reflect.deleteProperty(other, 'variantPresets');
    const photo = {
      ...box('photo'),
      type: 'image',
      assetId: 'asset-1',
      naturalSize: { width: 10, height: 10 },
      crop: { x: 0, y: 0, width: 1, height: 1 },
      opacity: 1,
    };
    for (const key of ['kind', 'fill', 'stroke', 'cornerRadius', 'sides', 'label'])
      Reflect.deleteProperty(photo, key);
    const errors = expectRejected(store, createObjectsCommand, {
      objects: [
        main({ 'tone=calm': record }),
        box('a'),
        photo,
        other,
        box('c', { parentId: 'other' }),
        {
          type: 'instance',
          id: 'inner',
          parentId: 'main',
          name: 'Inner',
          mainId: 'other',
          overrides: {},
          x: 0,
          y: 0,
          width: 40,
          height: 40,
        },
      ],
      drawnDefaults: ['main'],
    });
    expect(errors.map((error) => error.message).join(' ')).toContain(message);
    store.destroy();
  });
});
