import { describe, expect, it } from 'vitest';

import { READABLE_LAYOUT_VERSIONS } from './document-meta.js';
import { formatReadableLayouts, parseReadableLayouts } from './layout-declaration.js';

describe('the readable layouts declaration', () => {
  it('round-trips this build’s readable layouts', () => {
    expect(parseReadableLayouts(formatReadableLayouts(READABLE_LAYOUT_VERSIONS))).toEqual(
      READABLE_LAYOUT_VERSIONS,
    );
  });

  it('writes versions ascending, once each, joined by commas', () => {
    expect(formatReadableLayouts([3, 1, 3, 2])).toBe('1,2,3');
    expect(formatReadableLayouts([])).toBe('');
  });

  it('reads a missing, empty or malformed declaration as none, so the gate fails closed', () => {
    expect(parseReadableLayouts(null)).toEqual([]);
    expect(parseReadableLayouts(undefined)).toEqual([]);
    expect(parseReadableLayouts('')).toEqual([]);
    expect(parseReadableLayouts('one,two')).toEqual([]);
    expect(parseReadableLayouts('0,-1,1.5,1e3')).toEqual([]);
  });

  it('keeps the whole positive numbers of a declaration, ascending, without repeats', () => {
    const parsed = parseReadableLayouts(' 2 ,x,1,2');
    expect(parsed).toEqual([1, 2]);
    expect(Object.isFrozen(parsed)).toBe(true);
  });
});
