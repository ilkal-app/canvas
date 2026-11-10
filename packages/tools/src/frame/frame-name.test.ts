import { describe, expect, it } from 'vitest';

import { frame, rect } from '../select/__fixtures__/select-board.js';

import { nextFrameName } from './frame-name.js';

const named = (id: string, name: string) => ({
  ...frame(id, null, { x: 0, y: 0, width: 10, height: 10 }),
  name,
});

describe('nextFrameName', () => {
  it('starts at Frame 1 on a board with no frames', () => {
    expect(nextFrameName([])).toBe('Frame 1');
    expect(nextFrameName([rect('r', null, { x: 0, y: 0, width: 1, height: 1 })])).toBe('Frame 1');
  });

  it('goes one past the highest default name, whatever the order and the gaps', () => {
    expect(nextFrameName([named('a', 'Frame 3'), named('b', 'Frame 1')])).toBe('Frame 4');
  });

  it('ignores names a person gave', () => {
    const names = [named('a', 'Ideas'), named('b', 'Frame 2 copy'), named('c', 'Frame x')];
    expect(nextFrameName(names)).toBe('Frame 1');
  });
});

describe('nextFrameName with a prefix (a floating whiteboard names sections)', () => {
  it('counts only the names with its own prefix', () => {
    const names = [named('a', 'Frame 5'), named('b', 'Section 2'), named('c', 'Section 1')];
    expect(nextFrameName(names, 'Section')).toBe('Section 3');
    expect(nextFrameName(names)).toBe('Frame 6');
  });

  it('starts at 1 and ignores near misses', () => {
    const names = [named('a', 'Section'), named('b', 'Section 2b'), named('c', 'Sections 4')];
    expect(nextFrameName(names, 'Section')).toBe('Section 1');
  });
});
