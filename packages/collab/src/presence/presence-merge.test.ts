import { describe, expect, it } from 'vitest';

import { mergePresence } from './presence-merge.js';
import type { PresenceState } from './presence-state.js';

const base: PresenceState = Object.freeze({
  principal: Object.freeze({ id: 'user-1', kind: 'user', name: 'Ada', color: '#1f77b4' }),
  cursor: Object.freeze({ x: 1, y: 2 }),
  selection: Object.freeze(['a']),
  updatedAt: 100,
});

describe('mergePresence', () => {
  it('replaces the fields the update names and keeps the rest', () => {
    const merged = mergePresence(base, { cursor: { x: 5, y: 6 } }, 200);

    expect(merged).toEqual({
      principal: base.principal,
      cursor: { x: 5, y: 6 },
      selection: ['a'],
      updatedAt: 200,
    });
  });

  it('removes a field the update sets to null, leaving no undefined key behind', () => {
    const merged = mergePresence(base, { cursor: null, selection: null }, 200);

    expect(merged).toEqual({ principal: base.principal, updatedAt: 200 });
    expect(Object.keys(merged)).toEqual(['principal', 'updatedAt']);
  });

  it('adds a viewport', () => {
    const viewport = { x: 0, y: 0, w: 800, h: 600, zoom: 2 };

    expect(mergePresence(base, { viewport }, 200).viewport).toEqual(viewport);
  });

  it('never mutates the current state or keeps a reference to the caller selection', () => {
    const selection = ['b', 'c'];
    const merged = mergePresence(base, { selection }, 200);
    selection.push('d');

    expect(merged.selection).toEqual(['b', 'c']);
    expect(base.selection).toEqual(['a']);
  });

  it('rejects a malformed cursor, viewport or selection, which only a local bug produces', () => {
    expect(() => mergePresence(base, { cursor: { x: Number.NaN, y: 0 } }, 200)).toThrow(RangeError);
    expect(() =>
      mergePresence(base, { viewport: { x: 0, y: 0, w: 0, h: 1, zoom: 1 } }, 200),
    ).toThrow(RangeError);
    expect(() => mergePresence(base, { selection: [''] }, 200)).toThrow(RangeError);
  });
});
