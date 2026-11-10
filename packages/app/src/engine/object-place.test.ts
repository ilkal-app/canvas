import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { hasSamePlace, placeKeyOf } from './object-place.js';

const NOTE = {
  id: 'note',
  type: 'note',
  x: 10,
  y: 20,
  rotation: 0,
  width: 200,
  height: 200,
} as unknown as BoardObject;

describe('hasSamePlace', () => {
  it('holds for the same place, whatever else differs', () => {
    expect(hasSamePlace(NOTE, { ...NOTE })).toBe(true);
    expect(hasSamePlace(NOTE, { ...NOTE, locked: true })).toBe(true);
  });

  it.each([
    ['moved', { x: 11 }],
    ['moved down', { y: 21 }],
    ['rotated', { rotation: 0.1 }],
    ['resized across', { width: 201 }],
    ['resized down', { height: 199 }],
    ['reparented', { parentId: 'frame' }],
  ])('fails once %s', (name, change) => {
    expect(name).not.toBe('');
    expect(hasSamePlace(NOTE, { ...NOTE, ...change } as BoardObject)).toBe(false);
  });
});

describe('placeKeyOf', () => {
  it('is the same for the same place and differs once the object is moved, resized or rotated', () => {
    expect(placeKeyOf(NOTE)).toBe(placeKeyOf({ ...NOTE, locked: true }));
    expect(placeKeyOf(NOTE)).not.toBe(placeKeyOf({ ...NOTE, width: 260 } as BoardObject));
    expect(placeKeyOf(NOTE)).not.toBe(placeKeyOf({ ...NOTE, rotation: 1 }));
  });
});
