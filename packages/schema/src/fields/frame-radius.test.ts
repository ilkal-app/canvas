import { describe, expect, it } from 'vitest';

import { frameCornerRadii } from './frame-radius.js';

describe('frame corner radii', () => {
  it('reads one radius as every corner and four as given', () => {
    expect(frameCornerRadii(6)).toEqual([6, 6, 6, 6]);
    expect(frameCornerRadii([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it.each([undefined, null, -1, Number.NaN, Infinity, '4', [1, 2, 3], [1, -2, 3, 4], {}])(
    'reads %j as sharp',
    (value) => {
      expect(frameCornerRadii(value)).toEqual([0, 0, 0, 0]);
    },
  );
});
