// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as TextModule from '@canvas/text';

// The face's bytes only pass through: their axes are what the stubbed reader gives.
const bytes = new Uint8Array([1, 2, 3, 4]);
const WGHT = {
  tag: 'wght',
  minimum: 100,
  default: 400,
  maximum: 900,
  name: 'Weight',
  isHidden: false,
};

vi.mock('@canvas/text', async (original) => ({
  ...(await original<typeof TextModule>()),
  readVariationAxes: (read: Uint8Array) =>
    read.length === 4 ? { axes: [WGHT], instances: [] } : undefined,
}));

const page = vi.hoisted(() => ({
  revision: 0,
  listeners: new Set<() => void>(),
  loaded: new Map<string, ArrayBuffer>(),
  ensure: vi.fn(),
}));

vi.mock('./page-fonts.js', () => ({
  ensurePageFont: page.ensure,
  pageFontRevision: () => page.revision,
  subscribePageFonts: (listener: () => void) => {
    page.listeners.add(listener);
    return () => page.listeners.delete(listener);
  },
  pageTextFonts: () => ({
    get: (faceId: string) => {
      const loaded = page.loaded.get(faceId);
      return loaded === undefined ? undefined : { jobResource: { bytes: loaded } };
    },
  }),
}));

import { useFamilyAxes } from './family-axes.js';

afterEach(() => {
  page.loaded.clear();
  page.listeners.clear();
  vi.clearAllMocks();
});

describe('useFamilyAxes', () => {
  it('loads the family, then renders its axes once its face arrives', () => {
    page.revision = 10;
    const { result } = renderHook(() => useFamilyAxes('Inter Variable'));
    expect(result.current).toBeUndefined();
    expect(page.ensure).toHaveBeenCalledWith('Inter Variable');
    act(() => {
      page.loaded.set('400|n|Inter Variable', bytes.slice().buffer);
      page.revision = 11;
      for (const listener of page.listeners) listener();
    });
    expect(result.current?.axes.map(({ tag }) => tag)).toEqual(['wght']);
  });

  it('gives a static family no axes, loading nothing', () => {
    const { result } = renderHook(() => useFamilyAxes('Inter'));
    expect(result.current).toEqual({ axes: [], instances: [] });
    expect(page.ensure).not.toHaveBeenCalled();
  });

  it('reads nothing for no family', () => {
    const { result } = renderHook(() => useFamilyAxes(undefined));
    expect(result.current).toBeUndefined();
    expect(page.ensure).not.toHaveBeenCalled();
  });
});
