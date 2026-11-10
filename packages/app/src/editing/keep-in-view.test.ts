import { describe, expect, it } from 'vitest';

import { keepInViewDeltaPx, screenSpanOf, unionOfBounds } from './keep-in-view.js';
import { keyboardInsetPx } from './keyboard-inset.js';

const VISIBLE = { top: 76, bottom: 660 } as const;

describe('keepInViewDeltaPx', () => {
  it('leaves what is in view, with its margin, where it is', () => {
    expect(keepInViewDeltaPx({ top: 200, bottom: 300 }, VISIBLE, 16)).toBe(0);
    expect(keepInViewDeltaPx({ top: 92, bottom: 644 }, VISIBLE, 16)).toBe(0);
  });

  it('scrolls the board up by what reaches under the chrome, and its margin', () => {
    expect(keepInViewDeltaPx({ top: 700, bottom: 780 }, VISIBLE, 16)).toBe(780 + 16 - 660);
  });

  it('scrolls the board down by what reaches above the top bar', () => {
    expect(keepInViewDeltaPx({ top: 40, bottom: 140 }, VISIBLE, 16)).toBe(40 - 16 - 76);
  });

  it('places what is taller than the visible span by its top', () => {
    expect(keepInViewDeltaPx({ top: 300, bottom: 1300 }, VISIBLE, 16)).toBe(300 - 16 - 76);
  });

  it('keeps 16 px by default: a selection handle’s reach and a gap', () => {
    expect(keepInViewDeltaPx({ top: 600, bottom: 650 }, VISIBLE)).toBe(6);
  });
});

describe('unionOfBounds', () => {
  it('is nothing for no bounds, and the box holding them all otherwise', () => {
    expect(unionOfBounds([])).toBeUndefined();
    const first = { minX: 0, minY: 10, maxX: 20, maxY: 30 };
    const second = { minX: -5, minY: 15, maxX: 10, maxY: 50 };
    expect(unionOfBounds([first, second])).toEqual({ minX: -5, minY: 10, maxX: 20, maxY: 50 });
    expect(first).toEqual({ minX: 0, minY: 10, maxX: 20, maxY: 30 });
  });
});

describe('screenSpanOf', () => {
  it('maps world bounds to the page through the camera and the canvas’s top edge', () => {
    const camera = { x: 100, y: 50, zoom: 2, viewportWidthPx: 390, viewportHeightPx: 844, dpr: 1 };
    const span = screenSpanOf({ minX: 0, minY: 100, maxX: 10, maxY: 150 }, camera, 0);
    expect(span).toEqual({ top: 100, bottom: 200 });
    expect(screenSpanOf({ minX: 0, minY: 100, maxX: 10, maxY: 150 }, camera, 30)).toEqual({
      top: 130,
      bottom: 230,
    });
  });
});

describe('keyboardInsetPx', () => {
  it('is what the visual viewport leaves of the layout viewport’s bottom', () => {
    expect(keyboardInsetPx(844, { height: 844, offsetTop: 0 })).toBe(0);
    expect(keyboardInsetPx(844, { height: 544, offsetTop: 0 })).toBe(300);
    expect(keyboardInsetPx(844, { height: 544, offsetTop: 20 })).toBe(280);
  });

  it('is nothing without a visual viewport, and never negative', () => {
    expect(keyboardInsetPx(844, undefined)).toBe(0);
    expect(keyboardInsetPx(844, null)).toBe(0);
    expect(keyboardInsetPx(500, { height: 844, offsetTop: 0 })).toBe(0);
  });
});
