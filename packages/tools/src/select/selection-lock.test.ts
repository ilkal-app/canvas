import { describe, expect, it } from 'vitest';

import { id, mapSource, selectBoardObjects } from './__fixtures__/select-board.js';
import { isLockedSelection, lockToggleOf } from './selection-lock.js';

const SOURCE = mapSource(selectBoardObjects());

describe('isLockedSelection', () => {
  it('holds when every selected object is locked', () => {
    expect(isLockedSelection([id('rect-locked')], SOURCE)).toBe(true);
    expect(isLockedSelection([id('rect-locked'), id('gone')], SOURCE)).toBe(true);
  });

  it('does not hold for a mixed, unlocked or empty selection', () => {
    expect(isLockedSelection([id('rect-locked'), id('rect-a')], SOURCE)).toBe(false);
    expect(isLockedSelection([id('rect-a')], SOURCE)).toBe(false);
    expect(isLockedSelection([], SOURCE)).toBe(false);
    expect(isLockedSelection([id('gone')], SOURCE)).toBe(false);
  });
});

describe('lockToggleOf', () => {
  it('locks every selected object when any of them is unlocked', () => {
    expect(lockToggleOf([id('rect-a'), id('rect-locked')], SOURCE)).toEqual({
      ids: ['rect-a', 'rect-locked'],
      isLocked: true,
    });
  });

  it('unlocks every selected object when all are locked', () => {
    expect(lockToggleOf([id('rect-locked')], SOURCE)).toEqual({
      ids: ['rect-locked'],
      isLocked: false,
    });
  });

  it('leaves out ids with no object, and is undefined when none is left', () => {
    expect(lockToggleOf([id('gone'), id('rect-a')], SOURCE)).toEqual({
      ids: ['rect-a'],
      isLocked: true,
    });
    expect(lockToggleOf([id('gone')], SOURCE)).toBeUndefined();
    expect(lockToggleOf([], SOURCE)).toBeUndefined();
  });
});
