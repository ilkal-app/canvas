import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { componentObjectSchema, importBoard, type BoardObject } from '@canvas/schema';

import { createFixtureBoardJson } from './__fixtures__/fixture-board-json.js';
import { toYjs } from './object-codec.js';
import { fromYjs } from './object-reader.js';

// Found by the sync fuzzer: the style group (holding a main's axes) and its presets
// key merge separately, so concurrent and undone variant edits can leave the presets key
// without the axes. Presets without axes are not a main the schema admits, so the reader reads
// such a main as having no presets, the same on every client.

/**
 * The fixture board's main, with axes and a preset, stored in a document.
 *
 * @returns The main's id and its integrated map.
 * @throws {Error} When the fixture board has no main.
 */
function storedMain(): { readonly id: string; readonly map: Y.Map<unknown> } {
  const main = [...importBoard(createFixtureBoardJson(true)).objects.values()].find(
    (object): object is Extract<BoardObject, { type: 'component' }> => object.type === 'component',
  );
  if (main === undefined) throw new Error('missing main');
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(
    main.id,
    toYjs({
      ...main,
      variantAxes: [{ name: 'state', values: ['rest', 'hover'] }],
      variantPresets: { 'state=rest': {}, 'state=hover': {} },
    }),
  );
  return { id: main.id, map: objects.get(main.id) as Y.Map<unknown> };
}

describe('a main whose presets outlived its axes', () => {
  it('reads as a valid main with no presets', () => {
    const { id, map } = storedMain();
    const style = map.get('style') as Record<string, unknown>;
    const withoutAxes = Object.fromEntries(
      Object.entries(style).filter(([key]) => key !== 'variantAxes'),
    );
    map.set('style', withoutAxes);
    expect(map.get('variantPresets')).toBeInstanceOf(Y.Map);
    const decoded = fromYjs(id, map);
    if ('issue' in decoded) throw new Error(decoded.issue.message);
    expect((decoded.object as { variantAxes?: unknown }).variantAxes).toBeUndefined();
    expect(decoded.object).not.toHaveProperty('variantPresets');
    expect(componentObjectSchema.safeParse(decoded.object).success).toBe(true);
  });

  it('keeps reading the presets while the axes are there', () => {
    const { id, map } = storedMain();
    const decoded = fromYjs(id, map);
    if ('issue' in decoded) throw new Error(decoded.issue.message);
    expect(decoded.object).toMatchObject({
      variantPresets: { 'state=rest': {}, 'state=hover': {} },
    });
  });
});
