import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_LAYOUT_VERSION,
  FRAME_RADIUS_LAYOUT_VERSION,
  LAYER_OPACITY_LAYOUT_VERSION,
} from '@canvas/document';

import {
  DEFAULT_LAYOUT_CONVERTERS,
  findLayoutConverter,
  layoutStepKey,
  type LayoutConverter,
} from './layout-converters.js';

/**
 * A converter that appends a marker byte, so a chain's order shows in its output.
 *
 * @param marker - The byte appended.
 * @returns The converter.
 */
function appending(marker: number): LayoutConverter {
  return (unsent) => new Uint8Array([...unsent, marker]);
}

describe('findLayoutConverter', () => {
  it('carries layout 1 to layout 2 unchanged: the ruled identity', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    const convert = findLayoutConverter(1, 2);
    expect(convert?.(unsent)).toBe(unsent);
    expect(DEFAULT_LAYOUT_CONVERTERS.has('1->2')).toBe(true);
  });

  it('carries layout 2 to layout 3 unchanged: paint adds values, not keys', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    expect(findLayoutConverter(2, 3)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, 3)?.(unsent)).toBe(unsent);
  });

  it('carries layout 3 to layout 4 unchanged: pages read placements without a page', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    expect(findLayoutConverter(3, 4)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, 4)?.(unsent)).toBe(unsent);
  });

  it('carries layout 4 to layout 5 unchanged: components add types and keys', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    expect(findLayoutConverter(4, 5)?.(unsent)).toBe(unsent);
  });

  it('carries layout 5 to layout 6 unchanged: override records gain optional keys', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    expect(findLayoutConverter(5, 6)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, 6)?.(unsent)).toBe(unsent);
  });

  it('carries layout 6 to layout 7 unchanged: a fill may be an image paint', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    expect(findLayoutConverter(6, 7)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, 7)?.(unsent)).toBe(unsent);
  });

  it('carries layout 7 to layout 8 unchanged: groups gain optional auto-layout fields', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    expect(findLayoutConverter(7, 8)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, 8)?.(unsent)).toBe(unsent);
  });

  it('carries layout 8 to layout 9 unchanged: colour tokens add a map and values', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    expect(findLayoutConverter(8, 9)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, 9)?.(unsent)).toBe(unsent);
  });

  it('carries layout 9 to layout 10 unchanged: mains and instances gain optional variants', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    expect(findLayoutConverter(9, 10)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, 10)?.(unsent)).toBe(unsent);
  });

  it('carries layout 10 to layout 11 unchanged: slots gain optional swaps', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    expect(findLayoutConverter(10, 11)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, 11)?.(unsent)).toBe(unsent);
  });

  it('carries layout 11 to layout 12 unchanged: style groups gain stroke styles and shadows', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    expect(findLayoutConverter(11, 12)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, 12)?.(unsent)).toBe(unsent);
  });

  it('carries the layout before the frame radius gate to it unchanged', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    const radius = FRAME_RADIUS_LAYOUT_VERSION;
    expect(findLayoutConverter(radius - 1, radius)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, radius)?.(unsent)).toBe(unsent);
  });

  it('carries the layout before the layer opacity gate to it unchanged', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    const opacity = LAYER_OPACITY_LAYOUT_VERSION;
    expect(findLayoutConverter(opacity - 1, opacity)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, opacity)?.(unsent)).toBe(unsent);
  });

  it('carries layout 12 to layout 13 unchanged: shapes and frames gain stroke alignment', () => {
    const unsent = new Uint8Array([1, 2, 3]);
    expect(findLayoutConverter(12, 13)?.(unsent)).toBe(unsent);
    expect(findLayoutConverter(1, 13)?.(unsent)).toBe(unsent);
  });

  it('has no converter for a bump nobody registered', () => {
    const future = DOCUMENT_LAYOUT_VERSION + 1;
    expect(findLayoutConverter(DOCUMENT_LAYOUT_VERSION, future)).toBeUndefined();
    expect(findLayoutConverter(1, future)).toBeUndefined();
  });

  it('chains single steps in order when no converter covers the whole bump', () => {
    const converters = new Map([
      [layoutStepKey(2, 3), appending(3)],
      [layoutStepKey(3, 4), appending(4)],
    ]);
    const unsent = new Uint8Array([9]);
    expect(findLayoutConverter(2, 4, converters)?.(unsent)).toEqual(new Uint8Array([9, 3, 4]));
    expect(unsent).toEqual(new Uint8Array([9]));
  });

  it('prefers a converter registered for the whole bump', () => {
    const converters = new Map([
      [layoutStepKey(2, 4), appending(24)],
      [layoutStepKey(2, 3), appending(3)],
    ]);
    expect(findLayoutConverter(2, 4, converters)?.(new Uint8Array())).toEqual(new Uint8Array([24]));
  });

  it('has nothing to carry to the same or an older layout', () => {
    expect(findLayoutConverter(2, 2)).toBeUndefined();
    expect(findLayoutConverter(3, 2)).toBeUndefined();
  });
});
