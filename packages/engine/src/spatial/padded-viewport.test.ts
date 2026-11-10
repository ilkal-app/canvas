import { describe, expect, it } from 'vitest';

import { isQueryReusable, padViewport } from './padded-viewport.js';

const VIEWPORT = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

describe('padViewport', () => {
  it('grows each side by the fraction of the viewport size on that axis', () => {
    expect(padViewport(VIEWPORT, 0.25)).toEqual({ minX: -50, minY: -25, maxX: 250, maxY: 125 });
    expect(padViewport(VIEWPORT, 0)).toEqual(VIEWPORT);
  });
});

describe('isQueryReusable', () => {
  const query = padViewport(VIEWPORT, 0.25);

  it('reuses the query while the viewport stays inside it', () => {
    expect(isQueryReusable(query, VIEWPORT, 0.25)).toBe(true);
    expect(isQueryReusable(query, { minX: 45, minY: -20, maxX: 245, maxY: 80 }, 0.25)).toBe(true);
  });

  it('re-queries when the viewport crosses the padded region', () => {
    expect(isQueryReusable(query, { minX: 55, minY: 0, maxX: 255, maxY: 100 }, 0.25)).toBe(false);
    expect(isQueryReusable(query, { minX: 0, minY: -30, maxX: 200, maxY: 70 }, 0.25)).toBe(false);
  });

  it('re-queries after zooming in more than twofold, so the drawn set tracks the view', () => {
    const zoomedTwice = { minX: 50, minY: 25, maxX: 150, maxY: 75 };
    expect(isQueryReusable(query, zoomedTwice, 0.25)).toBe(true);
    const zoomedThrice = { minX: 70, minY: 30, maxX: 136, maxY: 63 };
    expect(isQueryReusable(query, zoomedThrice, 0.25)).toBe(false);
  });

  it('re-queries a zero-padding query on any camera change', () => {
    const exact = padViewport(VIEWPORT, 0);
    expect(isQueryReusable(exact, VIEWPORT, 0)).toBe(true);
    expect(isQueryReusable(exact, { ...VIEWPORT, minX: 1, maxX: 201 }, 0)).toBe(false);
  });
});
