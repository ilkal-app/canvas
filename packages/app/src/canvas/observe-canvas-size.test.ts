// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CanvasBackingSize } from './backing-store-size.js';
import { observeCanvasSize } from './observe-canvas-size.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A screen of a device pixel ratio that can change (a window moved to another screen, the page
 * zoomed): `matchMedia` gives one list per query, as a browser does, and `devicePixelRatio` reads
 * the ratio now.
 *
 * @param ratio - The ratio at first.
 * @returns The list of a ratio's query, if asked for, and the way to change the ratio, which
 *   tells the list of the old ratio's query, as a resolution query stops matching.
 */
function stubScreen(ratio: number) {
  const lists = new Map<string, EventTarget>();
  vi.stubGlobal('devicePixelRatio', ratio);
  vi.stubGlobal('matchMedia', (media: string) => {
    const list = Object.assign(new EventTarget(), { media, matches: true });
    lists.set(media, list);
    return list;
  });
  const listOf = (dppx: number) => lists.get(`(resolution: ${String(dppx)}dppx)`);
  return {
    listOf,
    change: (next: number) => {
      const old = window.devicePixelRatio;
      vi.stubGlobal('devicePixelRatio', next);
      listOf(old)?.dispatchEvent(new Event('change'));
    },
  };
}

/**
 * A canvas laid out 100 × 50 CSS px.
 *
 * @returns The canvas.
 */
function laidOutCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 50));
  return canvas;
}

describe('observeCanvasSize', () => {
  it('reports the size again when the device pixel ratio changes, listening for the new one', () => {
    const screen = stubScreen(1);
    const sizes: CanvasBackingSize[] = [];
    const stop = observeCanvasSize(laidOutCanvas(), (size) => sizes.push(size));
    expect(sizes).toEqual([
      { cssWidthPx: 100, cssHeightPx: 50, widthPx: 100, heightPx: 50, dpr: 1 },
    ]);
    screen.change(2);
    expect(sizes.at(-1)).toEqual({
      cssWidthPx: 100,
      cssHeightPx: 50,
      widthPx: 200,
      heightPx: 100,
      dpr: 2,
    });
    // The old ratio's query is no longer listened to; the new one's is.
    screen.listOf(1)?.dispatchEvent(new Event('change'));
    expect(sizes).toHaveLength(2);
    screen.change(3);
    expect(sizes.map(({ dpr }) => dpr)).toEqual([1, 2, 3]);
    stop();
    screen.change(1);
    expect(sizes).toHaveLength(3);
  });
});
