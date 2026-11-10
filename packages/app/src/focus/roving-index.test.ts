import { describe, expect, it } from 'vitest';

import { nextRovingIndex } from './roving-index.js';

describe('nextRovingIndex', () => {
  it('steps with the arrows, wrapping at both ends', () => {
    expect(nextRovingIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextRovingIndex('ArrowDown', 2, 3)).toBe(0);
    expect(nextRovingIndex('ArrowUp', 0, 3)).toBe(2);
    expect(nextRovingIndex('ArrowUp', 2, 3)).toBe(1);
  });

  it('jumps with Home and End, and leaves other keys alone', () => {
    expect(nextRovingIndex('Home', 2, 3)).toBe(0);
    expect(nextRovingIndex('End', 0, 3)).toBe(2);
    expect(nextRovingIndex('Enter', 1, 3)).toBeUndefined();
    expect(nextRovingIndex('a', 1, 3)).toBeUndefined();
  });
});
