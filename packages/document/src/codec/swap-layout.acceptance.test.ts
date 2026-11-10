// Acceptance: independent plain slot policy and override record fields.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import * as document from '@canvas/document';
import { importBoard, type BoardObject } from '@canvas/schema';

import { DOCUMENT_LAYOUT_VERSION, READABLE_LAYOUT_VERSIONS } from '../meta/document-meta.js';

import { createFixtureBoardJson } from './__fixtures__/fixture-board-json.js';
import { toYjs } from './object-codec.js';
import { fromYjs } from './object-reader.js';

function fixture(): BoardObject {
  const found = [...importBoard(createFixtureBoardJson(true)).objects.values()].find(
    (object) => object.type === 'instance',
  );
  if (found === undefined) throw new Error('missing instance fixture');
  return found;
}

function integrate(object: BoardObject): Y.Map<unknown> {
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(object.id, toYjs(object));
  return objects.get(object.id) as Y.Map<unknown>;
}

function read(id: string, map: Y.Map<unknown>): BoardObject {
  const decoded = fromYjs(id, map);
  if ('issue' in decoded) throw new Error(decoded.issue.message);
  return decoded.object;
}

describe('instance swap layout codec', () => {
  it('declares the new layout readable', () => {
    // Superseded by's stroke style and shadow layout: swap is no longer the newest.
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(SWAP_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toContain(SWAP_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toContain(SWAP_LAYOUT_VERSION - 1);
  });

  it('accepts mainId in the shared command input schema', () => {
    expect(
      document.setInstanceOverrideInputSchema.safeParse({
        id: 'placed',
        path: 'slot',
        override: { mainId: 'icon-b' },
      }).success,
    ).toBe(true);
  });

  it('round-trips a plain own swapOptions key and a plain override mainId', () => {
    const original = fixture();
    const object = {
      ...original,
      swapOptions: ['icon-a', 'icon-b'],
      overrides: { slot: { mainId: 'icon-b' } },
    } as unknown as BoardObject;
    const map = integrate(object);
    expect(map.get('swapOptions')).toEqual(['icon-a', 'icon-b']);
    expect(map.get('swapOptions')).not.toBeInstanceOf(Y.AbstractType);
    expect((map.get('overrides') as Y.Map<unknown>).get('slot')).toEqual({ mainId: 'icon-b' });
    expect(read(object.id, map)).toEqual(object);
  });

  it('skips malformed swapOptions alone while preserving valid overrides', () => {
    const original = fixture();
    const object = {
      ...original,
      swapOptions: ['icon-b'],
      overrides: { slot: { isHidden: true } },
    } as unknown as BoardObject;
    const map = integrate(object);
    expect(read(object.id, map)).toMatchObject({ swapOptions: ['icon-b'] });
    map.set('swapOptions', ['same', 'same']);
    expect(read(object.id, map)).toMatchObject({ overrides: { slot: { isHidden: true } } });
    expect(read(object.id, map)).not.toHaveProperty('swapOptions');
  });

  it('skips a malformed override record alone and keeps a valid swap neighbour', () => {
    const original = fixture();
    const object = {
      ...original,
      overrides: { good: { mainId: 'icon-b' }, bad: { isHidden: true } },
    } as unknown as BoardObject;
    const map = integrate(object);
    (map.get('overrides') as Y.Map<unknown>).set('bad', { mainId: 42 });
    const decoded = read(object.id, map);
    expect(decoded).toMatchObject({ overrides: { good: { mainId: 'icon-b' } } });
    if (decoded.type !== 'instance') throw new Error('not an instance');
    expect(decoded.overrides).not.toHaveProperty('bad');
  });

  it('keeps concurrent slot options and outer swap record edits', () => {
    const original = fixture();
    const seed = new Y.Doc();
    const objects = seed.getMap<unknown>('objects');
    objects.set(
      original.id,
      toYjs({ ...original, swapOptions: ['icon-a'] } as unknown as BoardObject),
    );
    objects.set('outer', toYjs({ ...original, id: 'outer', overrides: {} } as BoardObject));
    const left = new Y.Doc();
    const right = new Y.Doc();
    Y.applyUpdate(left, Y.encodeStateAsUpdate(seed));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(seed));
    (left.getMap('objects').get(original.id) as Y.Map<unknown>).set('swapOptions', [
      'icon-a',
      'icon-b',
    ]);
    (
      (right.getMap('objects').get('outer') as Y.Map<unknown>).get('overrides') as Y.Map<unknown>
    ).set('slot', { mainId: 'icon-b' });
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    for (const doc of [left, right]) {
      expect(
        read(original.id, doc.getMap('objects').get(original.id) as Y.Map<unknown>),
      ).toMatchObject({ swapOptions: ['icon-a', 'icon-b'] });
      expect(read('outer', doc.getMap('objects').get('outer') as Y.Map<unknown>)).toMatchObject({
        overrides: { slot: { mainId: 'icon-b' } },
      });
    }
  });
});
const SWAP_LAYOUT_VERSION = Reflect.get(document, 'SWAP_LAYOUT_VERSION') as number;
