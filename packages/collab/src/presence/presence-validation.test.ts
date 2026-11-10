import { describe, expect, it } from 'vitest';

import { isValidCursor, isValidSelection, isValidViewport } from './presence-validation.js';

describe('isValidCursor', () => {
  it('accepts a cursor with finite world coordinates, including negative ones', () => {
    expect(isValidCursor({ x: -120.5, y: 3e6 })).toBe(true);
  });

  it('rejects non-finite coordinates, which would poison interpolation', () => {
    expect(isValidCursor({ x: Number.NaN, y: 0 })).toBe(false);
    expect(isValidCursor({ x: 0, y: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('rejects values that are not cursor objects', () => {
    expect(isValidCursor(null)).toBe(false);
    expect(isValidCursor([1, 2])).toBe(false);
    expect(isValidCursor({ x: '1', y: 2 })).toBe(false);
    expect(isValidCursor({ x: 1 })).toBe(false);
  });
});

describe('isValidViewport', () => {
  const viewport = { x: -50, y: 20, w: 1280, h: 720, zoom: 1.5 };

  it('accepts a region with a positive size and zoom', () => {
    expect(isValidViewport(viewport)).toBe(true);
  });

  it('rejects an empty or inverted region', () => {
    expect(isValidViewport({ ...viewport, w: 0 })).toBe(false);
    expect(isValidViewport({ ...viewport, h: -10 })).toBe(false);
  });

  it('rejects a zoom that is not a positive finite factor', () => {
    expect(isValidViewport({ ...viewport, zoom: 0 })).toBe(false);
    expect(isValidViewport({ ...viewport, zoom: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('rejects non-finite edges and values that are not viewport objects', () => {
    expect(isValidViewport({ ...viewport, x: Number.NaN })).toBe(false);
    expect(isValidViewport({ x: 0, y: 0, w: 1, h: 1 })).toBe(false);
    expect(isValidViewport('viewport')).toBe(false);
  });
});

describe('isValidSelection', () => {
  it('accepts an empty selection and a list of object ids', () => {
    expect(isValidSelection([])).toBe(true);
    expect(isValidSelection(['a1', 'b2'])).toBe(true);
  });

  it('rejects empty ids, non-string ids and values that are not lists', () => {
    expect(isValidSelection([''])).toBe(false);
    expect(isValidSelection(['a1', 7])).toBe(false);
    expect(isValidSelection('a1')).toBe(false);
  });
});
