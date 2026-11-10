// @vitest-environment jsdom
// Item 2, round 2: what each arrange menu last ran, kept per viewer and device.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ARRANGE_LAST_USED_STORAGE_KEY,
  DEFAULT_ARRANGE_LAST_USED,
  noteArrangeUsed,
  resetArrangeLastUsed,
  useArrangeLastUsed,
} from './arrange-last-used.js';

beforeEach(() => {
  localStorage.clear();
  resetArrangeLastUsed();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('arrange last used (item 2)', () => {
  it('starts at align left, align top and distribute horizontally', () => {
    const { result } = renderHook(() => useArrangeLastUsed());
    expect(result.current).toEqual(DEFAULT_ARRANGE_LAST_USED);
  });

  it('follows each menu’s last command and keeps it for the next page', () => {
    const { result } = renderHook(() => useArrangeLastUsed());
    act(() => {
      noteArrangeUsed('alignVertical', 'alignBottom');
      noteArrangeUsed('distribute', 'distributeVertically');
    });
    expect(result.current).toEqual({
      alignHorizontal: 'alignLeft',
      alignVertical: 'alignBottom',
      distribute: 'distributeVertically',
    });
    resetArrangeLastUsed();
    const { result: reopened } = renderHook(() => useArrangeLastUsed());
    expect(reopened.current.alignVertical).toBe('alignBottom');
  });

  it('ignores stored values that are not its commands, or not JSON', () => {
    localStorage.setItem(
      ARRANGE_LAST_USED_STORAGE_KEY,
      JSON.stringify({ alignHorizontal: 'alignTop', alignVertical: 'alignMiddle', distribute: 7 }),
    );
    const { result } = renderHook(() => useArrangeLastUsed());
    expect(result.current).toEqual({ ...DEFAULT_ARRANGE_LAST_USED, alignVertical: 'alignMiddle' });
    localStorage.setItem(ARRANGE_LAST_USED_STORAGE_KEY, '{not json');
    resetArrangeLastUsed();
    expect(renderHook(() => useArrangeLastUsed()).result.current).toEqual(
      DEFAULT_ARRANGE_LAST_USED,
    );
    localStorage.setItem(ARRANGE_LAST_USED_STORAGE_KEY, '"text"');
    resetArrangeLastUsed();
    expect(renderHook(() => useArrangeLastUsed()).result.current).toEqual(
      DEFAULT_ARRANGE_LAST_USED,
    );
  });

  it('works without storage, for this page only', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result, unmount } = renderHook(() => useArrangeLastUsed());
    expect(result.current).toEqual(DEFAULT_ARRANGE_LAST_USED);
    act(() => {
      noteArrangeUsed('alignHorizontal', 'alignRight');
    });
    expect(result.current.alignHorizontal).toBe('alignRight');
    unmount();
  });
});
