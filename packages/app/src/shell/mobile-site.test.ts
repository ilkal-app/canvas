// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeViewport } from './__fixtures__/fake-media.js';
import {
  DESKTOP_SITE_MIN_WIDTH,
  isMobileSiteWidth,
  MOBILE_SITE_QUERY,
  useIsMobileSite,
} from './mobile-site.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the mobile site’s breakpoint', () => {
  it('gives the mobile pages below 768 px wide and the desktop pages from 768', () => {
    expect(DESKTOP_SITE_MIN_WIDTH).toBe(768);
    expect(isMobileSiteWidth(320)).toBe(true);
    expect(isMobileSiteWidth(767)).toBe(true);
    expect(isMobileSiteWidth(767.5)).toBe(true);
    expect(isMobileSiteWidth(768)).toBe(false);
    expect(isMobileSiteWidth(1280)).toBe(false);
  });

  it('writes the query as the stylesheets do', () => {
    expect(MOBILE_SITE_QUERY).toBe('(width < 768px)');
  });
});

describe('useIsMobileSite', () => {
  it('follows the viewport across the breakpoint, and stops listening when unmounted', () => {
    const viewport = fakeViewport(767);
    const { result, unmount } = renderHook(() => useIsMobileSite(viewport.matchMedia));
    expect(result.current).toBe(true);
    act(() => {
      viewport.resize(768);
    });
    expect(result.current).toBe(false);
    act(() => {
      viewport.resize(390);
    });
    expect(result.current).toBe(true);
    unmount();
    // Nothing listens any more: a resize after unmounting changes nothing and throws nothing.
    viewport.resize(1024);
  });

  it('reads the page’s matchMedia by default, and says desktop where there is none', () => {
    const viewport = fakeViewport(500);
    vi.stubGlobal('matchMedia', viewport.matchMedia);
    expect(renderHook(() => useIsMobileSite()).result.current).toBe(true);
    vi.stubGlobal('matchMedia', undefined);
    expect(renderHook(() => useIsMobileSite()).result.current).toBe(false);
    expect(renderHook(() => useIsMobileSite(() => undefined)).result.current).toBe(false);
  });
});
