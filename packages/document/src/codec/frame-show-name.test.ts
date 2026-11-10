// A frame's `showName` in the stored layout: an optional field of the frame's `style`
// group, not a key of its own, so no layout version changes. The writer leaves it out when the
// frame has none (its default), and the reader takes a group without it.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { BoardObject, FrameObject } from '@canvas/schema';

import { fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import { toYjs } from './object-codec.js';
import { layoutOf } from './object-layout.js';
import { fromYjs } from './object-reader.js';

/**
 * Stores a frame in a fresh document's object map, as the store does.
 *
 * @param frame - The frame.
 * @returns Its integrated map.
 */
function integrate(frame: FrameObject): Y.Map<unknown> {
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(frame.id, toYjs(frame));
  return objects.get(frame.id) as Y.Map<unknown>;
}

/**
 * Reads a map back, failing on an issue.
 *
 * @param map - The object's map.
 * @returns The object.
 * @throws {Error} When the map cannot be read.
 */
function read(map: Y.Map<unknown>): BoardObject {
  const decoded = fromYjs('frame-plan', map);
  if ('issue' in decoded) throw new Error(decoded.issue.message);
  return decoded.object;
}

describe('a frame’s showName in the stored layout', () => {
  const frame = fixtureObject('frame-plan', 'frame');

  it('is a field of the style group and adds no key', () => {
    expect([...(layoutOf('frame')?.keys ?? [])].sort()).toEqual([
      'constraints',
      'identity',
      'locked',
      'placement',
      'size',
      'style',
      'updatedAt',
      'z',
    ]);
    const style = layoutOf('frame')?.codecs.find(
      (codec) => codec.kind === 'group' && codec.key === 'style',
    );
    expect(style).toMatchObject({ fields: expect.arrayContaining(['showName']) as unknown });
  });

  it('is left out of the group when the frame has none, and reads back as the default', () => {
    const map = integrate(frame);
    expect('showName' in (map.get('style') as object)).toBe(false);
    expect(read(map)).toMatchObject({ name: 'Launch plan', showName: undefined });
  });

  it('round-trips either explicit value', () => {
    for (const isShown of [true, false]) {
      const map = integrate({ ...frame, showName: isShown });
      expect(map.get('style')).toMatchObject({ showName: isShown });
      expect(read(map)).toMatchObject({ showName: isShown });
    }
  });

  it('refuses a peer’s showName that is not a boolean', () => {
    const map = integrate(frame);
    map.set('style', { ...(map.get('style') as object), showName: 'yes' });
    const decoded = fromYjs('frame-plan', map);
    expect('issue' in decoded && decoded.issue.field).toBe('showName');
  });

  it('still reports a required style field a peer left out', () => {
    const map = integrate(frame);
    const style = map.get('style') as Record<string, unknown>;
    map.set('style', Object.fromEntries(Object.entries(style).filter(([key]) => key !== 'name')));
    const decoded = fromYjs('frame-plan', map);
    expect('issue' in decoded && decoded.issue.field).toBe('name');
  });
});
